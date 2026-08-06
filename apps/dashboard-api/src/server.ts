import Fastify from "fastify";
import websocketPlugin from "@fastify/websocket";
import cors from "@fastify/cors";
import type { WebSocket } from "ws";
import type { Redis } from "ioredis";
import {
  createRedisClient,
  getOnlineCount,
  getOnlineSessions,
  sendRecordingCommand,
} from "./redis.js";
import { extractToken, isValidToken } from "./auth.js";
import { computeMetrics, type RangeKey } from "./metrics.js";
import { computeFunnel, type FunnelStepInput } from "./funnel.js";
import { listReplays, getReplayFrames, getSessionMarkers } from "./replays.js";
import { computeHeatmap } from "./heatmap.js";
import { setSessionMeta, listTags } from "./session-meta.js";

const PORT = Number(process.env.DASHBOARD_API_PORT ?? process.env.PORT ?? 8082);

// Comma-separated list of dashboard origins; unset means allow any, which is
// only appropriate locally. Requests are token-guarded either way.
const CORS_ORIGINS = (process.env.CORS_ORIGINS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const app = Fastify({ logger: true });

await app.register(cors, { origin: CORS_ORIGINS.length > 0 ? CORS_ORIGINS : true });
await app.register(websocketPlugin);

// Every route except the health check requires the shared dashboard token.
// WebSocket upgrades pass it as ?token=… since browsers can't set headers there.
app.addHook("onRequest", async (req, reply) => {
  if (req.url === "/healthz" || req.url.startsWith("/healthz?")) return;
  if (isValidToken(extractToken(req.headers as Record<string, unknown>, req.query))) return;
  await reply.code(401).send({ error: "unauthorized" });
});

app.get("/healthz", async () => ({ status: "ok" }));

/** Lets the dashboard UI check a password before storing it. */
app.post("/api/login", async () => ({ ok: true }));

app.get("/api/sites/:siteId/online-count", async (req) => {
  const { siteId } = req.params as { siteId: string };
  const count = await getOnlineCount(siteId);
  return { siteId, onlineCount: count };
});

app.get("/api/sites/:siteId/sessions", async (req) => {
  const { siteId } = req.params as { siteId: string };
  return { siteId, sessions: await getOnlineSessions(siteId) };
});

app.get("/api/sites/:siteId/metrics", async (req) => {
  const { siteId } = req.params as { siteId: string };
  const q = req.query as { range?: string };
  const range: RangeKey =
    q.range === "7d" || q.range === "30d" ? q.range : "24h";
  return computeMetrics(siteId, range);
});

app.post("/api/sites/:siteId/funnel", async (req, reply) => {
  const { siteId } = req.params as { siteId: string };
  const body = req.body as { range?: string; steps?: FunnelStepInput[] };
  const range: RangeKey =
    body.range === "7d" || body.range === "30d" ? body.range : "24h";
  const steps = (body.steps ?? []).filter(
    (s) => (s.kind === "path" || s.kind === "event") && typeof s.value === "string" && s.value
  );
  if (steps.length < 2) {
    return reply.code(400).send({ error: "funnel needs at least 2 steps" });
  }
  return { range, steps: await computeFunnel(siteId, range, steps.slice(0, 10)) };
});

app.get("/api/sites/:siteId/heatmap", async (req) => {
  const { siteId } = req.params as { siteId: string };
  const q = req.query as { range?: string; path?: string };
  const range: RangeKey = q.range === "7d" || q.range === "30d" ? q.range : "24h";
  return computeHeatmap(siteId, q.path ?? "", range);
});

app.get("/api/sites/:siteId/replays", async (req) => {
  const { siteId } = req.params as { siteId: string };
  const q = req.query as { favorites?: string; device?: string; tag?: string; conversion?: string };
  return {
    siteId,
    replays: await listReplays(siteId, {
      favoritesOnly: q.favorites === "true",
      device: q.device,
      tag: q.tag,
      conversion: q.conversion,
    }),
    tags: await listTags(siteId),
  };
});

app.post("/api/sites/:siteId/sessions/:sessionId/meta", async (req) => {
  const { siteId, sessionId } = req.params as { siteId: string; sessionId: string };
  const body = req.body as { favorite?: boolean; tags?: string[] };
  const tags = Array.isArray(body.tags)
    ? body.tags.map((t) => String(t).trim().slice(0, 40)).filter(Boolean).slice(0, 20)
    : undefined;
  return setSessionMeta(siteId, sessionId, { favorite: body.favorite, tags });
});

app.get("/api/sites/:siteId/replays/:sessionId", async (req) => {
  const { siteId, sessionId } = req.params as { siteId: string; sessionId: string };
  const [frames, markers] = await Promise.all([
    getReplayFrames(siteId, sessionId),
    getSessionMarkers(siteId, sessionId),
  ]);
  return { sessionId, frames, markers };
});

app.register(async (fastify) => {
  fastify.get("/live/:siteId", { websocket: true }, (socket: WebSocket, req) => {
    const { siteId } = req.params as { siteId: string };
    const subscriber: Redis = createRedisClient();
    const channel = `live:${siteId}`;

    subscriber.subscribe(channel).catch((err) => {
      app.log.error({ err, channel }, "failed to subscribe to redis channel");
    });

    subscriber.on("message", (_chan: string, message: string) => {
      if (socket.readyState === socket.OPEN) {
        socket.send(message);
      }
    });

    const cleanup = () => {
      subscriber.unsubscribe(channel).catch(() => undefined);
      subscriber.quit().catch(() => undefined);
    };

    socket.on("close", cleanup);
    socket.on("error", cleanup);
  });

  /**
   * Live screen viewing for one session.
   *
   * Opening this socket tells the visitor's browser to start recording;
   * closing it tells it to stop. Recording therefore costs the visitor
   * nothing unless someone is actually watching — the main reason this is
   * cheaper on the visitor's device than always-on session recorders.
   */
  fastify.get("/watch/:siteId/:sessionId", { websocket: true }, (socket: WebSocket, req) => {
    const { siteId, sessionId } = req.params as { siteId: string; sessionId: string };
    const subscriber: Redis = createRedisClient();
    const channel = `replay:${siteId}:${sessionId}`;
    let stopped = false;

    subscriber.subscribe(channel).catch((err) => {
      app.log.error({ err, channel }, "failed to subscribe to replay channel");
    });

    subscriber.on("message", (_chan: string, message: string) => {
      if (socket.readyState === socket.OPEN) socket.send(message);
    });

    void sendRecordingCommand(sessionId, "start-recording").catch((err) =>
      app.log.error({ err, sessionId }, "failed to send start-recording")
    );

    // Re-issue periodically: a visitor who navigates to a new page arrives on
    // a fresh socket with no recorder running, and would otherwise go dark
    // for as long as the viewer keeps watching.
    const rearm = setInterval(() => {
      void sendRecordingCommand(sessionId, "resume-recording").catch(() => undefined);
    }, 10_000);

    const cleanup = () => {
      if (stopped) return;
      stopped = true;
      clearInterval(rearm);
      void sendRecordingCommand(sessionId, "stop-recording").catch(() => undefined);
      subscriber.unsubscribe(channel).catch(() => undefined);
      subscriber.quit().catch(() => undefined);
    };

    socket.on("close", cleanup);
    socket.on("error", cleanup);
  });
});

try {
  await app.listen({ port: PORT, host: "0.0.0.0" });
  app.log.info(`dashboard-api listening on :${PORT}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
