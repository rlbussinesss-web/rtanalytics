import Fastify from "fastify";
import websocketPlugin from "@fastify/websocket";
import type { WebSocket } from "ws";
import { parseTrackerEvent } from "@rtanalytics/protocol";
import { publishEvent } from "./stream.js";
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
    await publishReplayChunk(event.siteId, event.sessionId, event).catch((err) =>
      app.log.warn({ err }, "replay chunk publish failed")
    );
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
