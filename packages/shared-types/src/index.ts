/**
 * Shared TypeScript types for RTAnalytics event pipeline.
 * Used by: apps/tracker (producer), apps/ingest (consumer/validator),
 * apps/dashboard-api & apps/dashboard-web (consumers), apps/workers (persistence).
 *
 * These types describe the *shape* of events. The runtime validation (zod)
 * lives in packages/protocol, which infers its types from schemas that
 * mirror these definitions.
 */

export const SCHEMA_VERSION = 1 as const;

/** Discriminator for all event kinds captured by the tracker SDK. */
export type EventType =
  | "pageview"
  | "heartbeat"
  | "click"
  | "scroll"
  | "web-vitals"
  | "error"
  | "replay-chunk"
  | "conversion"
  | "visibility";

/** Fields common to every event envelope, regardless of type. */
export interface BaseEvent {
  /** Schema version, allows evolving the event format without breaking older ingest/workers. */
  schemaVersion: typeof SCHEMA_VERSION;
  /** Client-generated UUID, used for idempotency/dedupe downstream. */
  eventId: string;
  /** Which site/tenant this event belongs to (public tracking key). */
  siteId: string;
  /** Anonymous long-lived visitor identifier, persisted in localStorage. */
  visitorId: string;
  /** Session identifier, rotated after inactivity. */
  sessionId: string;
  /** Event kind discriminator. */
  eventType: EventType;
  /** Client-side timestamp (ms since epoch) when the event was captured. */
  timestamp: number;
  /** Page path the event occurred on. */
  path: string;
  /** Raw referrer, if any. */
  referrer?: string;
}

export interface PageviewPayload {
  title?: string;
  screenWidth?: number;
  screenHeight?: number;
  vw?: number;
  vh?: number;
  dpr?: number;
  lang?: string;
  tz?: string;
  conn?: string;
  mem?: number;
  cores?: number;
  /** navigator.webdriver — the browser admitting it is automated. */
  wd?: boolean;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
  gclid?: string;
  fbclid?: string;
  ttclid?: string;
  msclkid?: string;
}

export interface PageviewEvent extends BaseEvent {
  eventType: "pageview";
  payload: PageviewPayload;
}

export interface HeartbeatPayload {
  /** Seconds since the session started. */
  sessionDurationSec: number;
}

export interface HeartbeatEvent extends BaseEvent {
  eventType: "heartbeat";
  payload: HeartbeatPayload;
}

export interface ClickPayload {
  /** Simplified CSS-like selector of the clicked element. */
  target: string;
  /** Page coordinates (include scroll), so heatmaps can place the point. */
  x: number;
  y: number;
  /** Viewport width at click time, to normalize across screen sizes. */
  vw?: number;
  text?: string;
  /** Rapid repeated clicks in the same spot — a frustration signal. */
  rage?: boolean;
  /** Click that produced no DOM change or navigation — likely a broken element. */
  dead?: boolean;
}

export interface ClickEvent extends BaseEvent {
  eventType: "click";
  payload: ClickPayload;
}

export interface ScrollPayload {
  /** Max scroll depth reached, 0-100. */
  depthPct: number;
}

export interface ScrollEvent extends BaseEvent {
  eventType: "scroll";
  payload: ScrollPayload;
}

export type WebVitalName = "CLS" | "FID" | "LCP" | "FCP" | "TTFB" | "INP";

export interface WebVitalsPayload {
  name: WebVitalName;
  value: number;
  rating?: "good" | "needs-improvement" | "poor";
}

export interface WebVitalsEvent extends BaseEvent {
  eventType: "web-vitals";
  payload: WebVitalsPayload;
}

export interface ErrorPayload {
  message: string;
  stack?: string;
  filename?: string;
  lineno?: number;
  colno?: number;
}

export interface ErrorEvent extends BaseEvent {
  eventType: "error";
  payload: ErrorPayload;
}

/**
 * A batch of rrweb recording events — the raw material for reconstructing the
 * visitor's screen. Emitted only while a viewer is actively watching this
 * session (see the control channel in apps/ingest), so an unwatched visitor
 * pays no CPU or bandwidth cost for replay.
 */
export interface ReplayChunkPayload {
  /** rrweb eventWithTime objects. Opaque here — only the replayer interprets them. */
  frames: unknown[];
  /** Monotonic counter per session, so the viewer can detect gaps. */
  seq: number;
}

export interface ReplayChunkEvent extends BaseEvent {
  eventType: "replay-chunk";
  payload: ReplayChunkPayload;
}

export interface ConversionPayload {
  /** Site-defined goal name, e.g. "purchase", "signup". */
  name: string;
  /** Optional monetary or numeric value of the conversion. */
  value?: number;
}

export interface ConversionEvent extends BaseEvent {
  eventType: "conversion";
  payload: ConversionPayload;
}

export interface VisibilityPayload {
  /** "hidden" = tab backgrounded, "visible" = returned, "left" = page unloaded. */
  state: "hidden" | "visible" | "left";
}

export interface VisibilityEvent extends BaseEvent {
  eventType: "visibility";
  payload: VisibilityPayload;
}

/** Commands the server pushes down to a connected tracker. */
export type TrackerCommand =
  | { type: "start-recording" }
  | { type: "stop-recording" };

/** Union of every concrete event the tracker can emit. */
export type TrackerEvent =
  | PageviewEvent
  | HeartbeatEvent
  | ClickEvent
  | ScrollEvent
  | WebVitalsEvent
  | ErrorEvent
  | ReplayChunkEvent
  | ConversionEvent
  | VisibilityEvent;

/** Enriched fields that ingest attaches server-side before persistence/broadcast. */
export interface EnrichedFields {
  country?: string;
  region?: string;
  city?: string;
  device?: string;
  browser?: string;
  os?: string;
  /** The page's own domain, derived from the connection's Origin/Referer. */
  host?: string;
  /** True when the connection was classified as a crawler/automation tool. */
  isBot?: boolean;
  /** Why it was classified as a bot, for auditing false positives. */
  botReason?: string;
}

export type EnrichedEvent = TrackerEvent & EnrichedFields;

/** Row shape matching infra/migrations/001_init.sql `events` table. */
export interface EventRow {
  id: string;
  site_id: string;
  session_id: string;
  visitor_id: string;
  event_type: EventType;
  path: string;
  payload: Record<string, unknown>;
  country: string | null;
  city: string | null;
  device: string | null;
  browser: string | null;
  os: string | null;
  time: string; // ISO timestamp, hypertable partition column
  created_at: string;
}
