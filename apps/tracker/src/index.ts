import { SCHEMA_VERSION } from "./types";
import type { AnyTrackerEvent } from "./types";
import { getVisitorId, getSessionId, touchSession, uuid } from "./ids";
import { Transport } from "./transport";
import { Recorder } from "./recorder";
import { installBehavior } from "./behavior";
import { collectAttributes } from "./attributes";
import { buildPageMap, shouldSendMap } from "./pagemap";

const HEARTBEAT_INTERVAL_MS = 15_000;

interface TrackerConfig {
  siteId: string;
  wsUrl: string;
  /** Where the on-demand rrweb recorder bundle is hosted. */
  recorderUrl: string;
  /** URL-triggered conversions: reaching a path auto-fires a named conversion. */
  conversionPaths: { name: string; path: string }[];
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

  // data-conversion-paths="pix_gerado:/pagamento,recarga:/recarga" — reaching a
  // path auto-fires the named conversion. Generation is on-screen, so this is
  // reliable (unlike detecting an actual payment).
  const conversionPaths = (current?.dataset.conversionPaths ?? "")
    .split(",")
    .map((pair) => {
      const i = pair.indexOf(":");
      return { name: pair.slice(0, i).trim(), path: pair.slice(i + 1).trim() };
    })
    .filter((c) => c.name && c.path);

  return { siteId, wsUrl: configured ?? "ws://localhost:8081", recorderUrl, conversionPaths };
}

class RTATracker {
  private readonly config: TrackerConfig;
  private readonly transport: Transport;
  private readonly visitorId: string;
  private readonly sessionId: string;
  private readonly startedAt = Date.now();

  private readonly recorder: Recorder;
  private readonly firedConversions = new Set<string>();

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

  /**
   * Sends the page's content map, if this version hasn't been mapped recently.
   *
   * Deferred rather than measured immediately: positions taken before images,
   * fonts and late-rendered blocks settle would describe a page that no visitor
   * ever saw, and every analysis built on it would point at the wrong content.
   */
  private trackPageMap(): void {
    const send = () => {
      try {
        const map = buildPageMap();
        if (!map) return;
        if (!shouldSendMap(location.pathname, map.structureHash)) return;
        this.transport.send({
          ...this.baseEnvelope(),
          // Without the query string: the content of a page is the same
          // whatever campaign tagged the link, and keying by the full URL would
          // store one map per click id while the analysis — which looks the map
          // up by page — would never find one for tagged traffic.
          path: location.pathname,
          eventType: "page-map",
          payload: map,
        } as AnyTrackerEvent);
      } catch {
        /* mapping is best-effort and must never break the host page */
      }
    };
    if (document.readyState === "complete") setTimeout(send, 1500);
    else window.addEventListener("load", () => setTimeout(send, 1500), { once: true });
  }

  private trackPageview(): void {
    this.transport.send({
      ...this.baseEnvelope(),
      eventType: "pageview",
      payload: { title: document.title, ...collectAttributes() },
    } as AnyTrackerEvent);
  }

  /**
   * Records a conversion. Called by the site as `window.rta.track('purchase')`
   * or with a value: `window.rta.track('purchase', 79.9)`. Generic on purpose —
   * "conversion" is whatever the site decides matters (a sale, a signup, a
   * form submit), so the funnel and conversion-rate metrics work for any goal.
   */
  track(name: string, value?: number): void {
    if (!name) return;
    this.transport.send({
      ...this.baseEnvelope(),
      eventType: "conversion",
      payload: { name: String(name).slice(0, 128), value },
    });
  }

  /**
   * Identifiers for this visitor/session. The host site reads these when a
   * payment is created (`window.rta.identify()`) and stores them with the
   * order, so its backend can later report the confirmed payment back to
   * RTAnalytics tied to the right session.
   */
  identify(): { visitorId: string; sessionId: string } {
    return { visitorId: this.visitorId, sessionId: this.sessionId };
  }

  /**
   * Fires configured URL-triggered conversions when the current path matches,
   * at most once per session per goal (a reload of the same page shouldn't
   * double-count). Called on load and on SPA navigations.
   */
  private checkConversionPaths(): void {
    const p = location.pathname;
    for (const c of this.config.conversionPaths) {
      const matches = p === c.path || p.startsWith(c.path.replace(/\/?$/, "/"));
      if (matches && !this.hasFired(c.name)) {
        this.markFired(c.name);
        this.track(c.name);
      }
    }
  }

  private hasFired(name: string): boolean {
    try {
      return sessionStorage.getItem("rta_conv_" + name) === "1";
    } catch {
      return this.firedConversions.has(name);
    }
  }

  private markFired(name: string): void {
    this.firedConversions.add(name);
    try {
      sessionStorage.setItem("rta_conv_" + name, "1");
    } catch {
      /* sessionStorage unavailable — in-memory dedupe still applies */
    }
  }

  private trackHeartbeat(): void {
    touchSession();
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
    this.trackPageMap();
    this.checkConversionPaths();
    setInterval(() => this.trackHeartbeat(), HEARTBEAT_INTERVAL_MS);

    // Catch SPA navigations (history API + back/forward) so a client-routed
    // arrival at /pagamento still fires the conversion. Full page loads are
    // already covered by the check above.
    if (this.config.conversionPaths.length > 0) {
      const recheck = () => setTimeout(() => this.checkConversionPaths(), 0);
      for (const m of ["pushState", "replaceState"] as const) {
        const orig = history[m];
        history[m] = function (this: History, ...args: unknown[]) {
          const r = (orig as (...a: unknown[]) => unknown).apply(this, args);
          recheck();
          return r;
        } as typeof history[typeof m];
      }
      window.addEventListener("popstate", recheck);
    }

    // Always-on behavioural capture (clicks, scroll, errors, web vitals).
    installBehavior((eventType, payload) => {
      this.transport.send({ ...this.baseEnvelope(), eventType, payload } as AnyTrackerEvent);
    });

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
