import { SCHEMA_VERSION } from "./types";
import type { AnyTrackerEvent } from "./types";
import { getVisitorId, getSessionId, uuid } from "./ids";
import { Transport } from "./transport";

const HEARTBEAT_INTERVAL_MS = 15_000;

interface TrackerConfig {
  siteId: string;
  wsUrl: string;
}

function readConfigFromScriptTag(): TrackerConfig {
  const current =
    (document.currentScript as HTMLScriptElement | null) ??
    document.querySelector<HTMLScriptElement>("script[data-site-id]");

  const siteId = current?.dataset.siteId ?? "unknown";
  const wsUrl = current?.dataset.wsUrl ?? "ws://localhost:8081";

  return { siteId, wsUrl };
}

class RTATracker {
  private readonly config: TrackerConfig;
  private readonly transport: Transport;
  private readonly visitorId: string;
  private readonly sessionId: string;
  private readonly startedAt = Date.now();

  constructor(config: TrackerConfig) {
    this.config = config;
    this.visitorId = getVisitorId();
    this.sessionId = getSessionId();
    this.transport = new Transport(config.wsUrl);
  }

  private baseEnvelope(): Pick<
    AnyTrackerEvent,
    "schemaVersion" | "eventId" | "siteId" | "visitorId" | "sessionId" | "timestamp" | "path" | "referrer"
  > {
    return {
      schemaVersion: SCHEMA_VERSION,
      eventId: uuid(),
      siteId: this.config.siteId,
      visitorId: this.visitorId,
      sessionId: this.sessionId,
      timestamp: Date.now(),
      path: location.pathname + location.search,
      referrer: document.referrer || undefined,
    };
  }

  private trackPageview(): void {
    this.transport.send({
      ...this.baseEnvelope(),
      eventType: "pageview",
      payload: {
        title: document.title,
        screenWidth: window.screen?.width,
        screenHeight: window.screen?.height,
      },
    });
  }

  private trackHeartbeat(): void {
    this.transport.send({
      ...this.baseEnvelope(),
      eventType: "heartbeat",
      payload: {
        sessionDurationSec: Math.round((Date.now() - this.startedAt) / 1000),
      },
    });
  }

  start(): void {
    this.transport.connect();
    this.trackPageview();
    setInterval(() => this.trackHeartbeat(), HEARTBEAT_INTERVAL_MS);

    // Best-effort: flush a final heartbeat-ish signal before unload.
    window.addEventListener("pagehide", () => {
      this.trackHeartbeat();
    });
  }
}

(function bootstrap() {
  const config = readConfigFromScriptTag();
  const tracker = new RTATracker(config);
  tracker.start();

  // Expose minimal global for manual/custom event tracking in later phases.
  (window as unknown as { rta?: RTATracker }).rta = tracker;
})();
