/**
 * Local, dependency-free mirror of the event shapes in
 * @rtanalytics/shared-types. The tracker intentionally does NOT depend on
 * any workspace package at runtime (zero runtime deps requirement) — these
 * types are duplicated on purpose, kept in sync manually with
 * packages/shared-types/src/index.ts.
 */

export const SCHEMA_VERSION = 1 as const;

export type EventType =
  | "pageview"
  | "heartbeat"
  | "click"
  | "scroll"
  | "web-vitals"
  | "error"
  | "replay-chunk"
  | "conversion"
  | "visibility"
  | "viewport"
  | "page-map";

export interface BaseEvent {
  schemaVersion: typeof SCHEMA_VERSION;
  eventId: string;
  siteId: string;
  visitorId: string;
  sessionId: string;
  eventType: EventType;
  timestamp: number;
  path: string;
  referrer?: string;
}

export interface TrackerEventEnvelope<TType extends EventType, TPayload> extends BaseEvent {
  eventType: TType;
  payload: TPayload;
}

export type PageviewEvent = TrackerEventEnvelope<
  "pageview",
  { title?: string; screenWidth?: number; screenHeight?: number }
>;

export type HeartbeatEvent = TrackerEventEnvelope<
  "heartbeat",
  { sessionDurationSec: number }
>;

export type ClickEvent = TrackerEventEnvelope<
  "click",
  { target: string; x: number; y: number; text?: string }
>;

export type ScrollEvent = TrackerEventEnvelope<"scroll", { depthPct: number }>;

export type ReplayChunkEvent = TrackerEventEnvelope<
  "replay-chunk",
  { frames: unknown[]; seq: number }
>;

export type ConversionEvent = TrackerEventEnvelope<
  "conversion",
  { name: string; value?: number }
>;

export type VisibilityEvent = TrackerEventEnvelope<
  "visibility",
  { state: "hidden" | "visible" | "left" }
>;

/** Where the viewport sat over time — position as a function of time. */
export type ViewportEvent = TrackerEventEnvelope<
  "viewport",
  { samples: { t: number; y: number; h: number }[] }
>;

/** The page's content mapped to vertical position, sent per page version. */
export type PageMapEvent = TrackerEventEnvelope<
  "page-map",
  {
    structureHash: string;
    height: number;
    width: number;
    blocks: { y: number; h: number; tag: string; id?: string; text?: string; input?: boolean }[];
  }
>;

export type ErrorEvent = TrackerEventEnvelope<
  "error",
  { message: string; stack?: string; filename?: string; lineno?: number }
>;

export type AnyTrackerEvent =
  | PageviewEvent
  | HeartbeatEvent
  | ClickEvent
  | ScrollEvent
  | ReplayChunkEvent
  | ConversionEvent
  | VisibilityEvent
  | ViewportEvent
  | PageMapEvent
  | ErrorEvent;
