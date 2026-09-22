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
    // Ad attribution fields injected by the ingest server when a cached
    // gclid/fbclid/ttclid exists for this session. Optional because browser-
    // reported conversions (if any) will not carry them.
    adClickId: z.string().max(200).optional(),
    adPlatform: z.enum(["google", "meta", "tiktok", "bing"]).optional(),
  }),
});

/**
 * Periodic intent score snapshot computed client-side from behavioural
 * signals (scroll depth, time on page, interaction count, rage/dead clicks).
 * Lets the dashboard filter "high-intent sessions that did NOT convert" —
 * the hottest remarketing audience and the clearest friction signal.
 */
export const intentScoreSchema = z.object({
  ...baseFields,
  eventType: z.literal("intent-score"),
  payload: z.object({
    score: z.number().int().min(0).max(100),
    maxScrollPct: z.number().min(0).max(100),
    sessionDurationSec: z.number().nonnegative(),
    interactionCount: z.number().int().nonnegative(),
    rageClicks: z.number().int().nonnegative(),
    deadClicks: z.number().int().nonnegative(),
  }),
});

/**
 * Internal event published by the ingest server when a pageview carries an
 * ad click id (gclid/fbclid/ttclid/msclkid). Not sent by the browser tracker;
 * consumed exclusively by the persist-worker to durably write session_ad_clicks
 * so attribution survives Redis restarts and key expiry.
 */
export const adClickSchema = z.object({
  ...baseFields,
  eventType: z.literal("ad-click"),
  payload: z.object({
    adClickId: z.string().min(1).max(200),
    platform: z.enum(["google", "meta", "tiktok", "bing"]),
  }),
});

export const visibilitySchema = z.object({
  ...baseFields,
  eventType: z.literal("visibility"),
  payload: z.object({
    state: z.enum(["hidden", "visible", "left"]),
  }),
});

export const viewportSchema = z.object({
  ...baseFields,
  eventType: z.literal("viewport"),
  payload: z.object({
    samples: z
      .array(
        z.object({
          t: z.number().int().nonnegative(),
          y: z.number().int().nonnegative(),
          h: z.number().int().nonnegative(),
        })
      )
      .max(120),
  }),
});

/**
 * The page's content mapped to vertical position. `blocks` is capped because
 * this is a description of a page, not a copy of it — an unbounded map would
 * let one enormous page dominate ingestion.
 */
export const pageMapSchema = z.object({
  ...baseFields,
  eventType: z.literal("page-map"),
  payload: z.object({
    structureHash: z.string().min(1).max(32),
    height: z.number().int().nonnegative(),
    width: z.number().int().nonnegative(),
    blocks: z
      .array(
        z.object({
          y: z.number().int(),
          h: z.number().int().nonnegative(),
          tag: z.string().max(20),
          id: z.string().max(120).optional(),
          text: z.string().max(200).optional(),
          input: z.boolean().optional(),
        })
      )
      .max(200),
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
  intentScoreSchema,
  adClickSchema,
  visibilitySchema,
  viewportSchema,
  pageMapSchema,
]);

export type IntentScoreEvent = z.infer<typeof intentScoreSchema>;

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
