import { query } from "./db.js";
import type { RangeKey } from "./metrics.js";

/**
 * Heatmap data: every click's normalized position for a page, the most-clicked
 * elements, and scroll-reach distribution.
 *
 * Coordinates are stored as page pixels plus the viewport width at click time,
 * so the client can normalize x across screen sizes (x / vw) and plot a
 * device-agnostic map. Element-level ranking is included because "which button
 * gets the rage clicks" is often more actionable than the pixel blob alone.
 */

const RANGE_INTERVAL: Record<RangeKey, string> = {
  "24h": "24 hours",
  "7d": "7 days",
  "30d": "30 days",
};

export interface HeatmapPoint {
  x: number;
  y: number;
  vw: number;
  rage: boolean;
  dead: boolean;
}

export interface HeatmapData {
  path: string;
  clicks: HeatmapPoint[];
  topElements: { selector: string; count: number; rage: number; dead: number }[];
  scrollReach: { depth: number; pct: number }[];
  totalClicks: number;
}

export async function computeHeatmap(
  siteId: string,
  path: string,
  range: RangeKey
): Promise<HeatmapData> {
  const since = `now() - interval '${RANGE_INTERVAL[range]}'`;
  const pathFilter = path ? "AND path = $2" : "";
  const params = path ? [siteId, path] : [siteId];

  const [clicks, elements, scroll] = await Promise.all([
    query<{ x: string; y: string; vw: string; rage: boolean; dead: boolean }>(
      `SELECT (payload->>'x')::float AS x,
              (payload->>'y')::float AS y,
              coalesce((payload->>'vw')::float, 1440) AS vw,
              coalesce((payload->>'rage')::boolean, false) AS rage,
              coalesce((payload->>'dead')::boolean, false) AS dead
         FROM events
        WHERE site_id = $1 AND event_type = 'click' AND time >= ${since} ${pathFilter}
              AND payload ? 'x'
        LIMIT 8000`,
      params
    ),
    query<{ selector: string; count: string; rage: string; dead: string }>(
      `SELECT payload->>'target' AS selector,
              count(*)::int AS count,
              count(*) FILTER (WHERE (payload->>'rage')::boolean)::int AS rage,
              count(*) FILTER (WHERE (payload->>'dead')::boolean)::int AS dead
         FROM events
        WHERE site_id = $1 AND event_type = 'click' AND time >= ${since} ${pathFilter}
              AND coalesce(payload->>'target','') <> ''
        GROUP BY 1 ORDER BY count DESC LIMIT 15`,
      params
    ),
    query<{ d: string }>(
      `SELECT max((payload->>'depthPct')::float) AS d
         FROM events
        WHERE site_id = $1 AND event_type = 'scroll' AND time >= ${since} ${pathFilter}
        GROUP BY session_id`,
      params
    ),
  ]);

  // Scroll reach: share of sessions that reached each 10% depth band.
  const depths = scroll.map((r) => Number(r.d));
  const scrollReach = [];
  for (let band = 10; band <= 100; band += 10) {
    const reached = depths.filter((d) => d >= band).length;
    scrollReach.push({ depth: band, pct: depths.length ? reached / depths.length : 0 });
  }

  return {
    path,
    clicks: clicks.map((c) => ({
      x: Number(c.x),
      y: Number(c.y),
      vw: Number(c.vw),
      rage: c.rage,
      dead: c.dead,
    })),
    topElements: elements.map((e) => ({
      selector: e.selector,
      count: Number(e.count),
      rage: Number(e.rage),
      dead: Number(e.dead),
    })),
    scrollReach,
    totalClicks: clicks.length,
  };
}
