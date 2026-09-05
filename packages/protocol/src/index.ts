/**
 * Runtime validation (zod) for tracker events. Schemas mirror the shapes
 * declared in @rtanalytics/shared-types; types are inferred from the
 * schemas (not hand-duplicated) so validation and typing can never drift.
 */
import { z } from "zod";
import { SCHEMA_VERSION } from "@rtanalytics/shared-types";

const baseFields = {
  schemaVersion: z.literal(SCHEMA_VERSION),
  eventId: z.string().uuid(),
  siteId: z.string().min(1).max(128),
  visitorId: z.string().min(1).max(128),
  sessionId: z.string().min(1).max(128),
  timestamp: z.number().int().positive(),
  path: z.string().min(1).max(2048),
  referrer: z.string().max(2048).optional(),
};

export const pageviewSchema = z.object({
  ...baseFields,
  eventType: z.literal("pageview"),
  payload: z.object({
    title: z.string().max(512).optional(),
    screenWidth: z.number().int().nonnegative().optional(),
    screenHeight: z.number().int().nonnegative().optional(),
    // Device/context attributes for audience analysis.
    vw: z.number().int().nonnegative().optional(),
    vh: z.number().int().nonnegative().optional(),
    dpr: z.number().nonnegative().optional(),
    lang: z.string().max(35).optional(),
    tz: z.string().max(64).optional(),
    conn: z.string().max(16).optional(),
    mem: z.number().nonnegative().optional(),
    cores: z.number().int().nonnegative().optional(),
    wd: z.boolean().optional(),
    // Acquisition: campaign + ad click ids from the landing URL.
    utm_source: z.string().max(200).optional(),
    utm_medium: z.string().max(200).optional(),
    utm_campaign: z.string().max(200).optional(),
    utm_content: z.string().max(200).optional(),
    utm_term: z.string().max(200).optional(),
    gclid: z.string().max(200).optional(),
    fbclid: z.string().max(200).optional(),
    ttclid: z.string().max(200).optional(),
    msclkid: z.string().max(200).optional(),
  }),
});

export const heartbeatSchema = z.object({
  ...baseFields,
  eventType: z.literal("heartbeat"),
  payload: z.object({
    sessionDurationSec: z.number().nonnegative(),
  }),
});

export const clickSchema = z.object({
  ...baseFields,
  eventType: z.literal("click"),
  payload: z.object({
    target: z.string().max(512),
    x: z.number(),
    y: z.number(),
    vw: z.number().optional(),
    text: z.string().max(256).optional(),
    rage: z.boolean().optional(),
    dead: z.boolean().optional(),
  }),
});

export const scrollSchema = z.object({
  ...baseFields,
  eventType: z.literal("scroll"),
  payload: z.object({
    depthPct: z.number().min(0).max(100),
  }),
});

export const webVitalsSchema = z.object({
  ...baseFields,
  eventType: z.literal("web-vitals"),
  payload: z.object({
    name: z.enum(["CLS", "FID", "LCP", "FCP", "TTFB", "INP"]),
    value: z.number(),
    rating: z.enum(["good", "needs-improvement", "poor"]).optional(),
  }),
});

export const errorSchema = z.object({
  ...baseFields,
  eventType: z.literal("error"),
  payload: z.object({
    message: z.string().max(2048),
    stack: z.string().max(8192).optional(),
    filename: z.string().max(2048).optional(),
    lineno: z.number().int().optional(),
    colno: z.number().int().optional(),
  }),
});

/**
 * Batch of rrweb frames for live screen reconstruction.
 *
 * `frames` stays `unknown` on purpose: rrweb's event shape is large, versioned
 * by rrweb itself, and only ever interpreted by the replayer. Validating its
 * internals here would couple the protocol to an rrweb version for no safety
 * gain. The cap on array length is what actually matters — it bounds how much
 * a single message can cost us.
 */
export const replayChunkSchema = z.object({
  ...baseFields,
  eventType: z.literal("replay-chunk"),
  payload: z.object({
    frames: z.array(z.unknown()).max(500),
    seq: z.number().int().nonnegative(),
  }),
});

export const conversionSchema = z.object({
  ...baseFields,
  eventType: z.literal("conversion"),
  payload: z.object({
    name: z.string().min(1).max(128),
    value: z.number().optional(),
  }),
});

export const visibilitySchema = z.object({
  ...baseFields,
  eventType: z.literal("visibility"),
  payload: z.object({
    state: z.enum(["hidden", "visible", "left"]),
  }),
});

/** Discriminated union covering every event type the ingest server accepts. */
export const trackerEventSchema = z.discriminatedUnion("eventType", [
  pageviewSchema,
  heartbeatSchema,
  clickSchema,
  scrollSchema,
  webVitalsSchema,
  errorSchema,
  replayChunkSchema,
  conversionSchema,
  visibilitySchema,
]);

export type PageviewEvent = z.infer<typeof pageviewSchema>;
export type HeartbeatEvent = z.infer<typeof heartbeatSchema>;
export type ClickEvent = z.infer<typeof clickSchema>;
export type ScrollEvent = z.infer<typeof scrollSchema>;
export type WebVitalsEvent = z.infer<typeof webVitalsSchema>;
export type ErrorEvent = z.infer<typeof errorSchema>;
export type ReplayChunkEvent = z.infer<typeof replayChunkSchema>;
export type ConversionEvent = z.infer<typeof conversionSchema>;
export type TrackerEvent = z.infer<typeof trackerEventSchema>;

/**
 * Parses and validates a raw (already JSON.parsed) payload.
 * Returns a discriminated result instead of throwing, so callers
 * (e.g. the ingest WS handler) can reject a single bad message
 * without tearing down the connection.
 */
export function parseTrackerEvent(
  raw: unknown
):
  | { success: true; data: TrackerEvent }
  | { success: false; error: string } {
  const result = trackerEventSchema.safeParse(raw);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, error: result.error.message };
}
