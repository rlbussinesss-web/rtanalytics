import Fastify from "fastify";
import websocketPlugin from "@fastify/websocket";
import cors from "@fastify/cors";
import type { WebSocket } from "ws";
import type { Redis } from "ioredis";
import { createRedisClient, getOnlineCount } from "./redis.js";
import { extractToken, isValidToken } from "./auth.js";

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
});

try {
  await app.listen({ port: PORT, host: "0.0.0.0" });
  app.log.info(`dashboard-api listening on :${PORT}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
