import { query } from "./db.js";
import type { RangeKey } from "./metrics.js";

/**
 * Audience segmentation: for each acquisition/context attribute, how many
 * sessions came in and how many of them converted — so the "winning audience
 * that buys" surfaces on its own (e.g. utm_source=instagram converts 8%,
 * device=mobile from region=SP converts best).
 *
 * The unit of analysis is the *session*, not the event: a session's attribute
 * value is taken from its events (UTMs live on the pageview payload; country/
 * device/region are enriched onto every row), and the session counts as a
 * conversion if it produced any conversion event. Grouping by session first
 * stops a chatty visitor from skewing the rate.
 */

const RANGE_INTERVAL: Record<RangeKey, string> = {
  "24h": "24 hours",
  "7d": "7 days",
  "30d": "30 days",
};

export interface SegmentRow {
  label: string;
  sessions: number;
  conversions: number;
  conversionRate: number;
  revenue: number;
}

export interface AudienceReport {
  range: RangeKey;
  dimensions: Record<string, SegmentRow[]>;
}

/**
 * SQL expression that extracts a dimension's value from an events row.
 * Column dimensions read the enriched column directly; UTM/ad dimensions read
 * the pageview payload (null on non-pageview rows, which max() ignores).
 * Every expression here is an internal constant — never user input — so it is
 * safe to interpolate.
 */
const DIMENSIONS: Record<string, string> = {
  source: "payload->>'utm_source'",
  medium: "payload->>'utm_medium'",
  campaign: "payload->>'utm_campaign'",
  country: "country",
  region: "region",
  device: "device",
  browser: "browser",
};

async function segmentBy(siteId: string, since: string, valueExpr: string): Promise<SegmentRow[]> {
  const rows = await query<{
    label: string;
    sessions: string;
    conversions: string;
    revenue: string | null;
  }>(
    `SELECT val AS label,
            count(*)::int AS sessions,
            count(*) FILTER (WHERE converted)::int AS conversions,
            coalesce(sum(sess_value), 0)::float AS revenue
       FROM (
         SELECT session_id,
                max(${valueExpr}) AS val,
                bool_or(event_type = 'conversion') AS converted,
                sum((payload->>'value')::float) FILTER (WHERE event_type = 'conversion') AS sess_value
           FROM events
          WHERE site_id = $1 AND time >= ${since}
          GROUP BY session_id
       ) s
      WHERE val IS NOT NULL AND val <> ''
      GROUP BY val
      ORDER BY conversions DESC, sessions DESC
      LIMIT 12`,
    [siteId]
  );

  return rows.map((r) => {
    const sessions = Number(r.sessions);
    const conversions = Number(r.conversions);
    return {
      label: r.label,
      sessions,
      conversions,
      conversionRate: sessions > 0 ? conversions / sessions : 0,
      revenue: Math.round(Number(r.revenue ?? 0) * 100) / 100,
    };
  });
}

export async function computeAudience(siteId: string, range: RangeKey): Promise<AudienceReport> {
  const since = `now() - interval '${RANGE_INTERVAL[range]}'`;

  const keys = Object.keys(DIMENSIONS);
  const results = await Promise.all(keys.map((k) => segmentBy(siteId, since, DIMENSIONS[k]!)));

  const dimensions: Record<string, SegmentRow[]> = {};
  keys.forEach((k, i) => {
    dimensions[k] = results[i]!;
  });

  return { range, dimensions };
}
