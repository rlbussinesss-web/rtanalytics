import { query } from "./db.js";
import { CHECKOUT_PATH_PATTERN } from "@rtanalytics/shared-types";
import type { RangeKey } from "./metrics.js";

/**
 * The recordings actually worth watching.
 *
 * Nobody watches 200 session replays, so an unranked list is the same as no
 * list: whatever sits on top gets watched, and it is usually a bounce. This
 * ranks by how much a session has to teach, and says why in one line, so the
 * time spent watching goes where the money is leaking.
 *
 * Only sessions with recorded frames are returned — an interesting session
 * with nothing to play is a dead end.
 */

const RANGE_INTERVAL: Record<RangeKey, string> = {
  "24h": "24 hours",
  "7d": "7 days",
  "30d": "30 days",
};

export interface Highlight {
  sessionId: string;
  score: number;
  /** Plain-language justification, strongest signal first. */
  reason: string;
  durationSec: number;
  pages: number;
  rageClicks: number;
  deadClicks: number;
  errors: number;
  reachedCheckout: boolean;
  converted: boolean;
  country: string | null;
  device: string | null;
}

interface Row {
  session_id: string;
  duration_sec: string | null;
  pages: string;
  rage: string;
  dead: string;
  errors: string;
  reached_checkout: boolean;
  converted: boolean;
  country: string | null;
  device: string | null;
}

export async function listHighlights(
  siteId: string,
  range: RangeKey,
  limit = 8
): Promise<Highlight[]> {
  const interval = RANGE_INTERVAL[range];

  const rows = await query<Row>(
    `SELECT
        e.session_id,
        max((e.payload->>'sessionDurationSec')::float) FILTER (WHERE e.event_type = 'heartbeat') AS duration_sec,
        count(*) FILTER (WHERE e.event_type = 'pageview')::int AS pages,
        count(*) FILTER (WHERE e.event_type = 'click' AND (e.payload->>'rage')::boolean)::int AS rage,
        count(*) FILTER (WHERE e.event_type = 'click' AND (e.payload->>'dead')::boolean)::int AS dead,
        count(*) FILTER (WHERE e.event_type = 'error')::int AS errors,
        bool_or(e.path ~* $2) AS reached_checkout,
        bool_or(e.event_type = 'conversion') AS converted,
        max(e.country) AS country,
        max(e.device) AS device
      FROM events e
      WHERE e.site_id = $1
        AND e.is_bot IS NOT TRUE
        AND e.time >= now() - interval '${interval}'
        -- Only sessions that can actually be played back.
        AND EXISTS (
          SELECT 1 FROM replay_chunks r
           WHERE r.site_id = e.site_id AND r.session_id = e.session_id
        )
      GROUP BY e.session_id
      -- Deterministic slice: without an ORDER BY the cap would hand the
      -- ranking an arbitrary subset, so the "best" recordings would shuffle
      -- between identical requests on a busy site.
      ORDER BY max(e.time) DESC
      LIMIT 500`,
    [siteId, CHECKOUT_PATH_PATTERN]
  );

  return rows
    .map(toHighlight)
    .filter((h) => h.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/**
 * Scores a session by how much watching it would teach.
 *
 * The weights encode what costs money, in order: someone who reached checkout
 * and walked away is the most expensive thing on the list, because the traffic
 * was already paid for and the sale was one step away. Frustration and errors
 * come next — they explain *why* that happens. A successful conversion still
 * scores something (worth seeing what works), just far less than a near miss.
 */
function toHighlight(r: Row): Highlight {
  const rageClicks = Number(r.rage);
  const deadClicks = Number(r.dead);
  const errors = Number(r.errors);
  const pages = Number(r.pages);
  const durationSec = Math.round(Number(r.duration_sec ?? 0));
  const reachedCheckout = r.reached_checkout === true;
  const converted = r.converted === true;

  const nearMiss = reachedCheckout && !converted;

  let score = 0;
  const reasons: string[] = [];

  if (nearMiss) {
    score += 50;
    reasons.push("chegou no checkout e não converteu");
  }
  if (errors > 0) {
    score += 20 + Math.min(errors, 5) * 3;
    reasons.push(`${errors} erro(s) de JavaScript`);
  }
  if (rageClicks > 0) {
    score += 15 + Math.min(rageClicks, 5) * 3;
    reasons.push(`${rageClicks} clique(s) de raiva`);
  }
  if (deadClicks > 0) {
    score += 8 + Math.min(deadClicks, 5) * 2;
    reasons.push(`${deadClicks} clique(s) sem resposta`);
  }
  if (converted) {
    score += 12;
    reasons.push("converteu");
  }
  // A long, multi-page visit that went nowhere is worth a look on its own.
  if (!converted && pages >= 4 && durationSec >= 120) {
    score += 10;
    reasons.push("navegou bastante sem converter");
  }

  return {
    sessionId: r.session_id,
    score,
    reason: reasons.join(" · "),
    durationSec,
    pages,
    rageClicks,
    deadClicks,
    errors,
    reachedCheckout,
    converted,
    country: r.country,
    device: r.device,
  };
}
