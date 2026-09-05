import { query } from "./db.js";

/**
 * Sites that have actually sent data.
 *
 * The dashboard used to be built for one hard-coded site id, which meant a
 * second project needed a second build. Discovering sites from the event log
 * instead means pointing a new project's tracker at the same ingest is the
 * entire setup — the site appears in the switcher on its first pageview, with
 * no configuration anywhere.
 */

export interface SiteSummary {
  siteId: string;
  /** Domain last seen sending events, to tell similar site ids apart. */
  host: string | null;
  sessions: number;
  lastSeen: string;
}

export async function listSites(): Promise<SiteSummary[]> {
  const rows = await query<{
    site_id: string;
    host: string | null;
    sessions: string;
    last_seen: Date;
  }>(
    `SELECT
        site_id,
        (array_agg(host ORDER BY time DESC) FILTER (WHERE host IS NOT NULL))[1] AS host,
        count(DISTINCT session_id)::int AS sessions,
        max(time) AS last_seen
      FROM events
      WHERE is_bot IS NOT TRUE
        AND time >= now() - interval '30 days'
      GROUP BY site_id
      ORDER BY max(time) DESC
      LIMIT 50`
  );

  return rows.map((r) => ({
    siteId: r.site_id,
    host: r.host,
    sessions: Number(r.sessions),
    lastSeen: r.last_seen.toISOString(),
  }));
}
