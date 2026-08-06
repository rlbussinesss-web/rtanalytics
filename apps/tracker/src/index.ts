import { SCHEMA_VERSION } from "./types";
import type { AnyTrackerEvent } from "./types";
import { getVisitorId, getSessionId, uuid } from "./ids";
import { Transport } from "./transport";
import { Recorder } from "./recorder";

const HEARTBEAT_INTERVAL_MS = 15_000;

interface TrackerConfig {
  siteId: string;
  wsUrl: string;
  /** Where the on-demand rrweb recorder bundle is hosted. */
  recorderUrl: string;
}

function readConfigFromScriptTag(): TrackerConfig {
  const current =
    (document.currentScript as HTMLScriptElement | null) ??
    document.querySelector<HTMLScriptElement>("script[data-site-id]");

  const siteId = current?.dataset.siteId ?? "unknown";

  // Both spellings are accepted: `data-ingest-url` reads better on a customer's
  // page, `data-ws-url` is the original name. Silently falling back to the
  // localhost dev default on a live site is the failure mode this guards
  // against — it looks like the tracker works while nothing is ever delivered.
  const configured = current?.dataset.ingestUrl ?? current?.dataset.wsUrl;
  if (!configured) {
    console.warn(
      "[rtanalytics] no data-ingest-url on the script tag — falling back to " +
        "ws://localhost:8081, which only works in local development."
    );
  }

  // Defaults to a sibling of the tracker script, so self-hosting both files
  // together needs no extra configuration.
  const recorderUrl =
    current?.dataset.recorderUrl ??
    (current?.src ? current.src.replace(/[^/]+$/, "recorder.js") : "/recorder.js");

  return { siteId, wsUrl: configured ?? "ws://localhost:8081", recorderUrl };
}

class RTATracker {
  private readonly config: TrackerConfig;
  private readonly transport: Transport;
  private readonly visitorId: string;
  private readonly sessionId: string;
  private readonly startedAt = Date.now();

  private readonly recorder: Recorder;

  constructor(config: TrackerConfig) {
    this.config = config;
    this.visitorId = getVisitorId();
    this.sessionId = getSessionId();
    this.transport = new Transport(config.wsUrl);
    this.recorder = new Recorder(config.recorderUrl, (frames, seq) => {
      this.transport.send({
        ...this.baseEnvelope(),
        eventType: "replay-chunk",
        payload: { frames, seq },
      });
    });
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
    this.transport.setCommandHandler((type) => {
      if (type === "start-recording" || type === "resume-recording") {
        // "start" means a viewer just arrived and needs a fresh DOM snapshot;
        // "resume" is the 10s keepalive that only matters after a navigation.
        void this.recorder.start(type === "start-recording").catch((err) => {
          console.warn("[rtanalytics] could not start recorder:", err);
        });
      } else if (type === "stop-recording") {
        this.recorder.stop();
      }
    });

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
