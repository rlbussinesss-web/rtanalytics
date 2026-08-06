import { query } from "./db.js";

/**
 * Historical analytics computed from the events table.
 *
 * All queries are scoped by site_id and a time window, and rely on the
 * (site_id, time) index. `date_trunc` is used instead of Timescale's
 * `time_bucket` so the same queries work whether or not the TimescaleDB
 * extension is installed (see migrate.ts, which degrades to plain Postgres).
 */

export type RangeKey = "24h" | "7d" | "30d";

const RANGE_SQL: Record<RangeKey, { interval: string; bucket: string }> = {
  "24h": { interval: "24 hours", bucket: "hour" },
  "7d": { interval: "7 days", bucket: "day" },
  "30d": { interval: "30 days", bucket: "day" },
};

export interface Metrics {
  range: RangeKey;
  visitors: number;
  sessions: number;
  pageviews: number;
  events: number;
  conversions: number;
  conversionRate: number;
  avgSessionSec: number;
  bounceRate: number;
  timeseries: { bucket: string; visitors: number }[];
  topPages: { label: string; count: number }[];
  topCountries: { label: string; count: number }[];
  topDevices: { label: string; count: number }[];
  topBrowsers: { label: string; count: number }[];
  topReferrers: { label: string; count: number }[];
}

export async function computeMetrics(siteId: string, range: RangeKey): Promise<Metrics> {
  const { interval, bucket } = RANGE_SQL[range];
  const since = `now() - interval '${interval}'`;

  // A "top N" over one column, counting distinct sessions per value so a chatty
  // visitor doesn't dominate. Parameterized only by siteId; column/table are
  // internal constants, never user input.
  const topBy = (column: string) =>
    query<{ label: string; count: string }>(
      `SELECT ${column} AS label, count(DISTINCT session_id)::int AS count
         FROM events
        WHERE site_id = $1 AND time >= ${since} AND ${column} IS NOT NULL AND ${column} <> ''
        GROUP BY ${column}
        ORDER BY count DESC
        LIMIT 8`,
      [siteId]
    );

  const [
    totals,
    duration,
    bounce,
    series,
    topPages,
    topCountries,
    topDevices,
    topBrowsers,
    topReferrers,
  ] = await Promise.all([
    query<{
      visitors: string;
      sessions: string;
      pageviews: string;
      events: string;
      conversions: string;
    }>(
      `SELECT
          count(DISTINCT visitor_id)::int AS visitors,
          count(DISTINCT session_id)::int AS sessions,
          count(*) FILTER (WHERE event_type = 'pageview')::int AS pageviews,
          count(*)::int AS events,
          count(DISTINCT session_id) FILTER (WHERE event_type = 'conversion')::int AS conversions
        FROM events
        WHERE site_id = $1 AND time >= ${since}`,
      [siteId]
    ),
    // Longest heartbeat per session carries the session length; average those.
    query<{ avg: string | null }>(
      `SELECT avg(max_dur)::float AS avg FROM (
          SELECT session_id, max((payload->>'sessionDurationSec')::float) AS max_dur
            FROM events
           WHERE site_id = $1 AND time >= ${since} AND event_type = 'heartbeat'
           GROUP BY session_id
        ) s`,
      [siteId]
    ),
    // A session is a bounce when it produced a single pageview and no click or
    // scroll — i.e. the visitor looked and left.
    query<{ bounced: string; total: string }>(
      `SELECT
          count(*) FILTER (WHERE pv <= 1 AND interactions = 0)::int AS bounced,
          count(*)::int AS total
        FROM (
          SELECT session_id,
                 count(*) FILTER (WHERE event_type = 'pageview') AS pv,
                 count(*) FILTER (WHERE event_type IN ('click','scroll')) AS interactions
            FROM events
           WHERE site_id = $1 AND time >= ${since}
           GROUP BY session_id
        ) s`,
      [siteId]
    ),
    query<{ bucket: Date; visitors: string }>(
      `SELECT date_trunc('${bucket}', time) AS bucket,
              count(DISTINCT visitor_id)::int AS visitors
         FROM events
        WHERE site_id = $1 AND time >= ${since}
        GROUP BY 1
        ORDER BY 1`,
      [siteId]
    ),
    query<{ label: string; count: string }>(
      `SELECT path AS label, count(*)::int AS count
         FROM events
        WHERE site_id = $1 AND time >= ${since} AND event_type = 'pageview'
        GROUP BY path ORDER BY count DESC LIMIT 8`,
      [siteId]
    ),
    topBy("country"),
    topBy("device"),
    topBy("browser"),
    query<{ label: string; count: string }>(
      `SELECT coalesce(nullif(payload->>'referrer',''), '(direto)') AS label,
              count(DISTINCT session_id)::int AS count
         FROM events
        WHERE site_id = $1 AND time >= ${since} AND event_type = 'pageview'
        GROUP BY 1 ORDER BY count DESC LIMIT 8`,
      [siteId]
    ),
  ]);

  const t =
    totals[0] ??
    { visitors: "0", sessions: "0", pageviews: "0", events: "0", conversions: "0" };
  const b = bounce[0] ?? { bounced: "0", total: "0" };
  const totalSessions = Number(b.total);
  const sessionsCount = Number(t.sessions);

  const asItems = (rows: { label: string; count: string | number }[]) =>
    rows.map((r) => ({ label: r.label, count: Number(r.count) }));

  return {
    range,
    visitors: Number(t.visitors),
    sessions: Number(t.sessions),
    pageviews: Number(t.pageviews),
    events: Number(t.events),
    conversions: Number(t.conversions),
    conversionRate: sessionsCount > 0 ? Number(t.conversions) / sessionsCount : 0,
    avgSessionSec: Math.round(Number(duration[0]?.avg ?? 0)),
    bounceRate: totalSessions > 0 ? Number(b.bounced) / totalSessions : 0,
    timeseries: series.map((r) => ({
      bucket: r.bucket.toISOString(),
      visitors: Number(r.visitors),
    })),
    topPages: asItems(topPages),
    topCountries: asItems(topCountries),
    topDevices: asItems(topDevices),
    topBrowsers: asItems(topBrowsers),
    topReferrers: asItems(topReferrers),
  };
}
