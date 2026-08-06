import Fastify from "fastify";
import websocketPlugin from "@fastify/websocket";
import type { WebSocket } from "ws";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { parseTrackerEvent } from "@rtanalytics/protocol";
import { publishEvent, recordReplayChunk } from "./stream.js";
import { touchPresence, publishLiveEvent, publishReplayChunk } from "./redis.js";
import { registerSession, unregisterSession, connectionCount, subscribeToCommands } from "./sessions.js";
import { enrichFromConnection } from "./enrich.js";
import type { EnrichedFields } from "@rtanalytics/shared-types";

const PORT = Number(process.env.INGEST_PORT ?? process.env.PORT ?? 8081);

/**
 * Sites allowed to send events, as a comma-separated list in ALLOWED_SITE_IDS.
 * The ingest endpoint is necessarily public (it receives traffic from visitors'
 * browsers), so this is what stops a stranger who finds the URL from filling
 * the database with events for site IDs we don't own. Empty means allow all,
 * which is only appropriate for local development.
 */
const ALLOWED_SITE_IDS = new Set(
  (process.env.ALLOWED_SITE_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
);

function isSiteAllowed(siteId: string): boolean {
  return ALLOWED_SITE_IDS.size === 0 || ALLOWED_SITE_IDS.has(siteId);
}

/**
 * Server-to-server key for the payment/conversion webhook. This is how a
 * *confirmed* payment is reported — the browser can't reliably know a Pix was
 * paid (the visitor may have closed the tab and paid later), so the site's
 * backend / payment gateway calls this endpoint from its own payment-confirmed
 * handler. Empty key means the endpoint is disabled (secure by default).
 */
const SERVER_INGEST_KEY = process.env.SERVER_INGEST_KEY ?? "";

function validServerKey(candidate: unknown): boolean {
  if (!SERVER_INGEST_KEY || typeof candidate !== "string") return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(SERVER_INGEST_KEY);
  return a.length === b.length && timingSafeEqual(a, b);
}

// trustProxy makes req.ip read X-Forwarded-For, which is how the real visitor
// IP reaches us behind Railway's proxy — without it every visitor would look
// like they came from the proxy's address and geo would be useless.
const app = Fastify({ logger: true, trustProxy: true });

await app.register(websocketPlugin);

subscribeToCommands(process.env.REDIS_URL ?? "redis://localhost:6379", (msg) =>
  app.log.info(msg)
);

app.get("/healthz", async () => ({
  status: "ok",
  connections: connectionCount(),
}));

/**
 * Server-side conversion webhook. Called by the site's backend / payment
 * gateway when a payment is *confirmed* (e.g. Pix paid). Works regardless of
 * whether the visitor's browser is still open — this is the reliable source of
 * truth for "paid", unlike any client-side guess.
 *
 * The caller links it to the visitor by passing the visitorId/sessionId it
 * captured from window.rta when the payment was created.
 */
app.post("/api/server-event", async (req, reply) => {
  if (!validServerKey(req.headers["x-rta-key"])) {
    return reply.code(401).send({ error: "unauthorized" });
  }
  const b = (req.body ?? {}) as {
    siteId?: string;
    visitorId?: string;
    sessionId?: string;
    name?: string;
    value?: number;
    path?: string;
  };
  if (!b.siteId || !isSiteAllowed(b.siteId)) {
    return reply.code(403).send({ error: "unknown_site" });
  }
  if (!b.visitorId || !b.sessionId || !b.name) {
    return reply.code(400).send({ error: "missing visitorId, sessionId or name" });
  }

  const event = {
    schemaVersion: 1 as const,
    eventId: randomUUID(),
    siteId: b.siteId,
    visitorId: b.visitorId,
    sessionId: b.sessionId,
    eventType: "conversion" as const,
    timestamp: Date.now(),
    path: (b.path ?? "(servidor)").slice(0, 2048),
    payload: {
      name: String(b.name).slice(0, 128),
      value: typeof b.value === "number" ? b.value : undefined,
    },
  };

  // Validate against the same schema browser events use, then push it through
  // the normal pipeline so it lands in metrics/funnel and pops in the live feed.
  const parsed = parseTrackerEvent(event);
  if (!parsed.success) {
    return reply.code(400).send({ error: `validation_error: ${parsed.error}` });
  }
  await Promise.all([
    publishEvent(event.siteId, event.eventType, event),
    publishLiveEvent(event.siteId, event).catch((err) =>
      app.log.warn({ err }, "server-event live publish failed")
    ),
  ]);
  app.log.info({ sessionId: event.sessionId, name: event.payload.name }, "server conversion recorded");
  return { ok: true };
});

app.register(async (fastify) => {
  fastify.get("/", { websocket: true }, (socket: WebSocket, req) => {
    // The session id only becomes known once the first event arrives, so the
    // registry is populated lazily and cleaned up on close.
    let sessionId: string | null = null;

    // IP and User-Agent are constant for a connection, so enrich once here
    // rather than on every event.
    const enrichment = enrichFromConnection(req.ip, req.headers["user-agent"]);

    socket.on("message", (raw: Buffer) => {
      void handleMessage(socket, raw, enrichment, (id) => {
        if (sessionId !== id) {
          sessionId = id;
          registerSession(id, socket);
        }
      });
    });

    socket.on("close", () => {
      if (sessionId) unregisterSession(sessionId);
    });

    socket.on("error", (err) => {
      app.log.warn({ err }, "ws connection error");
    });
  });
});

async function handleMessage(
  socket: WebSocket,
  raw: Buffer,
  enrichment: EnrichedFields,
  onSessionKnown: (sessionId: string) => void
): Promise<void> {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw.toString("utf-8"));
  } catch {
    sendError(socket, "invalid_json");
    return;
  }

  const result = parseTrackerEvent(parsedJson);
  if (!result.success) {
    sendError(socket, `validation_error: ${result.error}`);
    return;
  }

  const event = result.data;

  if (!isSiteAllowed(event.siteId)) {
    sendError(socket, "unknown_site");
    return;
  }

  onSessionKnown(event.sessionId);

  // Replay frames take a different path: they are high-volume, only useful to
  // whoever is watching right now, and would drown both the event log and the
  // dashboard's activity feed. They go straight to that session's channel.
  if (event.eventType === "replay-chunk") {
    await Promise.all([
      // Live fan-out to whoever is watching this session right now.
      publishReplayChunk(event.siteId, event.sessionId, event).catch((err) =>
        app.log.warn({ err }, "replay chunk publish failed")
      ),
      // Durable copy so the session can be replayed later.
      recordReplayChunk(
        event.siteId,
        event.sessionId,
        event.payload.seq,
        event.payload.frames
      ).catch((err) => app.log.warn({ err }, "replay chunk record failed")),
    ]);
    return;
  }

  // Attach server-derived geo/device fields so both the persisted row and the
  // live dashboard carry them.
  const enriched = { ...event, ...enrichment };

  try {
    // The durable write (publishEvent) must settle before we ack the client,
    // so a client that got an ack knows its event is in the log. Presence and
    // live fan-out are best-effort and never fail the whole message.
    await Promise.all([
      publishEvent(enriched.siteId, enriched.eventType, enriched),
      touchPresence(enriched.siteId, enriched.sessionId).catch((err) =>
        app.log.warn({ err }, "presence update failed")
      ),
      publishLiveEvent(enriched.siteId, enriched).catch((err) =>
        app.log.warn({ err }, "live pubsub publish failed")
      ),
    ]);
  } catch (err) {
    app.log.error({ err }, "failed to process event");
    sendError(socket, "processing_error");
    return;
  }

  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify({ type: "ack", eventId: event.eventId }));
  }
}

function sendError(socket: WebSocket, message: string): void {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify({ type: "error", message }));
  }
}

try {
  await app.listen({ port: PORT, host: "0.0.0.0" });
  app.log.info(`ingest listening on :${PORT}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
