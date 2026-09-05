import Fastify from "fastify";
import websocketPlugin from "@fastify/websocket";
import type { WebSocket } from "ws";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { parseTrackerEvent } from "@rtanalytics/protocol";
import { publishEvent, recordReplayChunk } from "./stream.js";
import { touchPresence, publishLiveEvent, publishReplayChunk, readAllowedSites } from "./redis.js";
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

/**
 * Site keys registered by the dashboard when a project is created.
 *
 * Without this, adding an offer would mean editing an environment variable and
 * redeploying — so the allow list is read from Redis and refreshed on a timer.
 * It is a cache of what the dashboard already persisted, so a Redis flush costs
 * a few seconds of rejected events, not the configuration itself.
 */
const ALLOWED_SITES_KEY = "rta:sites:allowed";
const ALLOWED_REFRESH_MS = 30_000;
let registeredSites = new Set<string>();

async function refreshRegisteredSites(): Promise<void> {
  try {
    const members = await readAllowedSites(ALLOWED_SITES_KEY);
    registeredSites = new Set(members);
  } catch (err) {
    // Keep the previous set: dropping it would reject live traffic over a
    // transient Redis hiccup.
    app.log.warn({ err }, "could not refresh registered sites");
  }
}

function isSiteAllowed(siteId: string): boolean {
  if (registeredSites.has(siteId)) return true;
  // Both empty means an unconfigured local environment, where allowing
  // everything is the useful default.
  if (ALLOWED_SITE_IDS.size === 0 && registeredSites.size === 0) return true;
  return ALLOWED_SITE_IDS.has(siteId);
}

/**
 * Server-to-server key for the payment/conversion webhook. This is how a
 * *confirmed* payment is reported — the browser can't reliably know a Pix was
 * paid (the visitor may have closed the tab and paid later), so the site's
 * backend / payment gateway calls this endpoint from its own payment-confirmed
 * handler. Empty key means the endpoint is disabled (secure by default).
 */
const SERVER_INGEST_KEY = process.env.SERVER_INGEST_KEY ?? "";

/**
 * Per-connection message budget.
 *
 * The endpoint is public, so one misbehaving page (a runaway loop firing
 * events) or a deliberate flood could both cost money and skew the numbers.
 * A refilling budget lets normal bursts through — a page load emits a handful
 * of events at once — while capping sustained throughput per socket.
 */
const RATE_BURST = Number(process.env.INGEST_RATE_BURST ?? 120);
const RATE_PER_SECOND = Number(process.env.INGEST_RATE_PER_SECOND ?? 20);

class RateBudget {
  private tokens = RATE_BURST;
  private last = Date.now();

  /** Consumes one message; false means the sender is over budget. */
  take(): boolean {
    const now = Date.now();
    this.tokens = Math.min(RATE_BURST, this.tokens + ((now - this.last) / 1000) * RATE_PER_SECOND);
    this.last = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

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

await refreshRegisteredSites();
setInterval(() => void refreshRegisteredSites(), ALLOWED_REFRESH_MS);

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
    const enrichment = enrichFromConnection(
      req.ip,
      req.headers["user-agent"],
      req.headers["origin"] as string | undefined,
      req.headers["referer"] as string | undefined
    );

    const budget = new RateBudget();

    socket.on("message", (raw: Buffer) => {
      if (!budget.take()) {
        // Dropped rather than disconnected: a legitimate page that briefly
        // overshoots keeps its socket (and its queued events) alive.
        sendError(socket, "rate_limited");
        return;
      }
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
    const rawId = (parsedJson as { eventId?: unknown } | null)?.eventId;
    sendError(
      socket,
      `validation_error: ${result.error}`,
      typeof rawId === "string" ? rawId : undefined
    );
    return;
  }

  const event = result.data;

  if (!isSiteAllowed(event.siteId)) {
    sendError(socket, "unknown_site", event.eventId);
    return;
  }

  onSessionKnown(event.sessionId);

  // A driven browser reports navigator.webdriver on its pageview. The user
  // agent alone can look perfectly human, so this upgrades the verdict for
  // the rest of the connection once the client admits automation.
  if (event.eventType === "pageview" && event.payload.wd === true && !enrichment.isBot) {
    enrichment.isBot = true;
    enrichment.botReason = "webdriver";
  }

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
    sendError(socket, "processing_error", event.eventId);
    return;
  }

  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify({ type: "ack", eventId: event.eventId }));
  }
}

/**
 * Rejects one event. The eventId is echoed whenever it is known so the client
 * can drop that event instead of retrying it forever — a malformed event is
 * never going to become valid, and without the id it would block the queue.
 */
function sendError(socket: WebSocket, message: string, eventId?: string): void {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify({ type: "error", message, eventId }));
  }
}

try {
  await app.listen({ port: PORT, host: "0.0.0.0" });
  app.log.info(`ingest listening on :${PORT}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
