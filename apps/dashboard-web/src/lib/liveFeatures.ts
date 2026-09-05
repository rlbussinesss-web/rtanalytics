import { isCheckoutPath, type SessionFeatures } from "@rtanalytics/shared-types";
import type { LiveEvent } from "../useLiveEvents";

/**
 * Builds per-session features from the live event stream.
 *
 * These are the same features the model was trained on, produced from what has
 * actually been observed on this connection. Two honest limitations follow
 * from that, and both are the right trade:
 *  - the live buffer is capped, so counts reflect the recent window rather than
 *    the whole session — the score answers "how promising does this visitor
 *    look right now", which is the live question;
 *  - a dashboard opened mid-session sees only what arrived after it connected.
 */
export function buildLiveFeatures(events: LiveEvent[]): Map<string, SessionFeatures> {
  const out = new Map<string, SessionFeatures>();

  // Oldest first so "first seen" values win where that matters.
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    const f =
      out.get(e.sessionId) ??
      ({
        reachedCheckout: false,
        pageviews: 0,
        clicks: 0,
        maxScroll: 0,
      } as SessionFeatures);

    // Enriched fields ride on every event; keep the first non-empty value.
    f.device ??= e.device;
    f.country ??= e.country;

    if (e.eventType === "pageview") {
      f.pageviews += 1;
      const src = e.payload?.utm_source;
      if (typeof src === "string" && src && !f.source) f.source = src;
    } else if (e.eventType === "click") {
      f.clicks += 1;
    } else if (e.eventType === "scroll") {
      const depth = Number(e.payload?.depthPct ?? 0);
      if (Number.isFinite(depth) && depth > f.maxScroll) f.maxScroll = depth;
    }

    if (isCheckoutPath(e.path)) f.reachedCheckout = true;

    out.set(e.sessionId, f);
  }

  return out;
}
