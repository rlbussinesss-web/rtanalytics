import { query } from "./db.js";
import type { RangeKey } from "./metrics.js";

/**
 * Funnel discovery: finds where people actually leak, without being told.
 *
 * A configured funnel only answers the question you already thought to ask —
 * it confirms a hypothesis and stays silent about the step you never suspected.
 * This walks the real page sequences instead, so the biggest leak surfaces on
 * its own even when it sits on a page nobody was watching.
 *
 * Everything is measured per session (not per pageview) and excludes bots, so
 * a crawler sweeping every page cannot invent a path nobody walks.
 */

const RANGE_INTERVAL: Record<RangeKey, string> = {
  "24h": "24 hours",
  "7d": "7 days",
  "30d": "30 days",
};

/** A path needs this many sessions before its rates mean anything. */
const MIN_SESSIONS_PER_STEP = 10;

export interface DiscoveredStep {
  path: string;
  /** Sessions that saw this page at least once. */
  sessions: number;
  /** Sessions whose last page was this one — where the journey ended. */
  exits: number;
  exitRate: number;
  /** Sessions that saw this page and converted at some point. */
  conversions: number;
  conversionRate: number;
}

export interface DiscoveredTransition {
  from: string;
  to: string;
  sessions: number;
}

export interface FunnelDiscovery {
  range: RangeKey;
  enoughData: boolean;
  steps: DiscoveredStep[];
  transitions: DiscoveredTransition[];
  /** The step losing the most people in absolute terms. */
  biggestLeak: DiscoveredStep | null;
}

export async function discoverFunnel(siteId: string, range: RangeKey): Promise<FunnelDiscovery> {
  const interval = RANGE_INTERVAL[range];

  // One pass over pageviews, ordered per session, is enough to derive both the
  // per-page aggregates and the page-to-page transitions.
  const [steps, transitions] = await Promise.all([
    query<{
      path: string;
      sessions: string;
      exits: string;
      conversions: string;
    }>(
      `WITH pv AS (
         SELECT session_id, path, time,
                row_number() OVER (PARTITION BY session_id ORDER BY time DESC) AS from_end
           FROM events
          WHERE site_id = $1 AND is_bot IS NOT TRUE
            AND event_type = 'pageview'
            AND time >= now() - interval '${interval}'
       ),
       conv AS (
         SELECT DISTINCT session_id
           FROM events
          WHERE site_id = $1 AND is_bot IS NOT TRUE
            AND event_type = 'conversion'
            AND time >= now() - interval '${interval}'
       )
       SELECT p.path,
              count(DISTINCT p.session_id)::int AS sessions,
              count(DISTINCT p.session_id) FILTER (WHERE p.from_end = 1)::int AS exits,
              count(DISTINCT p.session_id) FILTER (WHERE c.session_id IS NOT NULL)::int AS conversions
         FROM pv p
         LEFT JOIN conv c ON c.session_id = p.session_id
        GROUP BY p.path
       HAVING count(DISTINCT p.session_id) >= ${MIN_SESSIONS_PER_STEP}
        ORDER BY sessions DESC
        LIMIT 20`,
      [siteId]
    ),
    query<{ from_path: string; to_path: string; sessions: string }>(
      `WITH pv AS (
         SELECT session_id, path, time,
                lead(path) OVER (PARTITION BY session_id ORDER BY time) AS next_path
           FROM events
          WHERE site_id = $1 AND is_bot IS NOT TRUE
            AND event_type = 'pageview'
            AND time >= now() - interval '${interval}'
       )
       SELECT path AS from_path, next_path AS to_path,
              count(DISTINCT session_id)::int AS sessions
         FROM pv
        WHERE next_path IS NOT NULL AND next_path <> path
        GROUP BY 1, 2
        ORDER BY sessions DESC
        LIMIT 20`,
      [siteId]
    ),
  ]);

  const mapped: DiscoveredStep[] = steps.map((r) => {
    const sessions = Number(r.sessions);
    const exits = Number(r.exits);
    const conversions = Number(r.conversions);
    return {
      path: r.path,
      sessions,
      exits,
      exitRate: sessions > 0 ? exits / sessions : 0,
      conversions,
      conversionRate: sessions > 0 ? conversions / sessions : 0,
    };
  });

  // The most expensive leak is the one losing the most *people*, not the one
  // with the scariest percentage — a 90% exit rate on 11 sessions matters less
  // than a 40% exit on 800. Pages where visitors already converted are not
  // leaks; leaving after buying is the expected ending.
  const biggestLeak =
    mapped
      .filter((s) => s.conversionRate < 0.5)
      .sort((a, b) => b.exits - a.exits)[0] ?? null;

  return {
    range,
    enoughData: mapped.length > 0,
    steps: mapped,
    transitions: transitions.map((t) => ({
      from: t.from_path,
      to: t.to_path,
      sessions: Number(t.sessions),
    })),
    biggestLeak,
  };
}
