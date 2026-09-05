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
  pagesPerSession: number;
  newVisitors: number;
  returningVisitors: number;
  /** Crawler/automation traffic kept out of every number above. */
  botSessions: number;
  botEvents: number;
  // Behaviour insights (share of sessions unless noted).
  rageClickRate: number;
  deadClickRate: number;
  errorRate: number;
  errorCount: number;
  avgScrollDepth: number;
  webVitals: { name: string; value: number; rating: "good" | "needs-improvement" | "poor" }[];
  performanceScore: number;
  timeseries: { bucket: string; visitors: number }[];
  topPages: { label: string; count: number }[];
  topCountries: { label: string; count: number }[];
  topDevices: { label: string; count: number }[];
  topBrowsers: { label: string; count: number }[];
  topReferrers: { label: string; count: number }[];
}

const VITAL_THRESHOLDS: Record<string, [number, number]> = {
  LCP: [2500, 4000],
  CLS: [0.1, 0.25],
  INP: [200, 500],
  FCP: [1800, 3000],
  TTFB: [800, 1800],
};

function rateVital(name: string, value: number): "good" | "needs-improvement" | "poor" {
  const t = VITAL_THRESHOLDS[name];
  if (!t) return "good";
  return value <= t[0] ? "good" : value <= t[1] ? "needs-improvement" : "poor";
}

/** 0-100 score: average of each captured vital's rating (good=100, ni=60, poor=20). */
function performanceScore(vitals: { rating: string }[]): number {
  if (vitals.length === 0) return 0;
  const pts = vitals.map((v) => (v.rating === "good" ? 100 : v.rating === "needs-improvement" ? 60 : 20));
  return Math.round(pts.reduce((a, b) => a + b, 0) / pts.length);
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
        WHERE site_id = $1 AND is_bot IS NOT TRUE AND time >= ${since} AND ${column} IS NOT NULL AND ${column} <> ''
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
    visitorMix,
    behavior,
    scrollDepth,
    vitals,
    bots,
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
        WHERE site_id = $1 AND is_bot IS NOT TRUE AND time >= ${since}`,
      [siteId]
    ),
    // Longest heartbeat per session carries the session length; average those.
    query<{ avg: string | null }>(
      `SELECT avg(max_dur)::float AS avg FROM (
          SELECT session_id, max((payload->>'sessionDurationSec')::float) AS max_dur
            FROM events
           WHERE site_id = $1 AND is_bot IS NOT TRUE AND time >= ${since} AND event_type = 'heartbeat'
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
           WHERE site_id = $1 AND is_bot IS NOT TRUE AND time >= ${since}
           GROUP BY session_id
        ) s`,
      [siteId]
    ),
    query<{ bucket: Date; visitors: string }>(
      `SELECT date_trunc('${bucket}', time) AS bucket,
              count(DISTINCT visitor_id)::int AS visitors
         FROM events
        WHERE site_id = $1 AND is_bot IS NOT TRUE AND time >= ${since}
        GROUP BY 1
        ORDER BY 1`,
      [siteId]
    ),
    query<{ label: string; count: string }>(
      `SELECT path AS label, count(*)::int AS count
         FROM events
        WHERE site_id = $1 AND is_bot IS NOT TRUE AND time >= ${since} AND event_type = 'pageview'
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
        WHERE site_id = $1 AND is_bot IS NOT TRUE AND time >= ${since} AND event_type = 'pageview'
        GROUP BY 1 ORDER BY count DESC LIMIT 8`,
      [siteId]
    ),
    // New vs returning: a visitor active in the window is "returning" if their
    // very first event ever predates the window. Computed from the events
    // table itself — no extra state to store.
    query<{ new_visitors: string; returning: string }>(
      `SELECT
          count(*) FILTER (WHERE first_seen >= ${since})::int AS new_visitors,
          count(*) FILTER (WHERE first_seen <  ${since})::int AS returning
        FROM (
          SELECT visitor_id, min(time) AS first_seen
            FROM events
           WHERE site_id = $1 AND is_bot IS NOT TRUE
           GROUP BY visitor_id
          HAVING max(time) >= ${since}
        ) v`,
      [siteId]
    ),
    // Frustration signals: sessions with a rage/dead click and JS errors.
    query<{ rage: string; dead: string; err_sessions: string; err_count: string }>(
      `SELECT
          count(DISTINCT session_id) FILTER (WHERE event_type='click' AND (payload->>'rage')::boolean)::int AS rage,
          count(DISTINCT session_id) FILTER (WHERE event_type='click' AND (payload->>'dead')::boolean)::int AS dead,
          count(DISTINCT session_id) FILTER (WHERE event_type='error')::int AS err_sessions,
          count(*) FILTER (WHERE event_type='error')::int AS err_count
        FROM events WHERE site_id = $1 AND is_bot IS NOT TRUE AND time >= ${since}`,
      [siteId]
    ),
    // Average of each session's deepest scroll.
    query<{ avg: string | null }>(
      `SELECT avg(maxd)::float AS avg FROM (
          SELECT session_id, max((payload->>'depthPct')::float) AS maxd
            FROM events WHERE site_id = $1 AND is_bot IS NOT TRUE AND time >= ${since} AND event_type = 'scroll'
            GROUP BY session_id
        ) s`,
      [siteId]
    ),
    // p75 of each Core Web Vital, the standard way to report them.
    query<{ name: string; p75: string }>(
      `SELECT name, percentile_cont(0.75) WITHIN GROUP (ORDER BY val) AS p75 FROM (
          SELECT payload->>'name' AS name, (payload->>'value')::float AS val
            FROM events WHERE site_id = $1 AND is_bot IS NOT TRUE AND time >= ${since} AND event_type = 'web-vitals'
        ) v GROUP BY name`,
      [siteId]
    ),
    // Bot traffic that every other query above excluded. Reported rather than
    // hidden, so the filtering is visible and auditable instead of silent.
    query<{ sessions: string; events: string }>(
      `SELECT
          count(DISTINCT session_id)::int AS sessions,
          count(*)::int AS events
        FROM events
        WHERE site_id = $1 AND is_bot = true AND time >= ${since}`,
      [siteId]
    ),
  ]);

  const t =
    totals[0] ??
    { visitors: "0", sessions: "0", pageviews: "0", events: "0", conversions: "0" };
  const b = bounce[0] ?? { bounced: "0", total: "0" };
  const totalSessions = Number(b.total);
  const sessionsCount = Number(t.sessions);
  const mix = visitorMix[0] ?? { new_visitors: "0", returning: "0" };
  const bh = behavior[0] ?? { rage: "0", dead: "0", err_sessions: "0", err_count: "0" };
  const vitalsOut = vitals.map((v) => {
    const value = Math.round(Number(v.p75) * 1000) / 1000;
    return { name: v.name, value, rating: rateVital(v.name, value) };
  });

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
    pagesPerSession: sessionsCount > 0 ? Number(t.pageviews) / sessionsCount : 0,
    newVisitors: Number(mix.new_visitors),
    returningVisitors: Number(mix.returning),
    botSessions: Number(bots[0]?.sessions ?? 0),
    botEvents: Number(bots[0]?.events ?? 0),
    rageClickRate: sessionsCount > 0 ? Number(bh.rage) / sessionsCount : 0,
    deadClickRate: sessionsCount > 0 ? Number(bh.dead) / sessionsCount : 0,
    errorRate: sessionsCount > 0 ? Number(bh.err_sessions) / sessionsCount : 0,
    errorCount: Number(bh.err_count),
    avgScrollDepth: Math.round(Number(scrollDepth[0]?.avg ?? 0)),
    webVitals: vitalsOut,
    performanceScore: performanceScore(vitalsOut),
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
