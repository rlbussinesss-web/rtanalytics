import { query } from "./db.js";

/**
 * Recorded session playback + the recordings list.
 *
 * Recordings exist only for sessions that were watched live (frames are
 * captured on-demand, see the tracker). The list joins each recording with
 * session metadata derived from the event log (device, country, browser,
 * counts) and the curation table (favorite, tags), so the UI can show rich
 * cards and filter — closer to a real session explorer than a bare list.
 */

export interface ReplaySummary {
  sessionId: string;
  chunks: number;
  startedAt: string;
  endedAt: string;
  durationSec: number;
  pages: number;
  clicks: number;
  rageClicks: number;
  errors: number;
  country: string | null;
  device: string | null;
  browser: string | null;
  entryPath: string | null;
  favorite: boolean;
  tags: string[];
}

export interface ReplayFilter {
  favoritesOnly?: boolean;
  device?: string;
  tag?: string;
}

export async function listReplays(siteId: string, filter: ReplayFilter = {}): Promise<ReplaySummary[]> {
  const conds: string[] = ["true"];
  const params: unknown[] = [siteId];
  if (filter.favoritesOnly) conds.push("coalesce(m.favorite, false) = true");
  if (filter.device) {
    params.push(filter.device);
    conds.push(`ev.device = $${params.length}`);
  }
  if (filter.tag) {
    params.push(filter.tag);
    conds.push(`$${params.length} = ANY(m.tags)`);
  }

  const rows = await query<{
    session_id: string;
    chunks: string;
    started: Date;
    ended: Date;
    duration: string | null;
    pages: string;
    clicks: string;
    rage: string;
    errors: string;
    country: string | null;
    device: string | null;
    browser: string | null;
    entry: string | null;
    favorite: boolean | null;
    tags: string[] | null;
  }>(
    `SELECT r.session_id,
            r.chunks, r.started, r.ended,
            ev.duration, ev.pages, ev.clicks, ev.rage, ev.errors,
            ev.country, ev.device, ev.browser, ev.entry,
            m.favorite, m.tags
       FROM (
         SELECT session_id, count(*)::int AS chunks, min(time) AS started, max(time) AS ended
           FROM replay_chunks WHERE site_id = $1 GROUP BY session_id
       ) r
       LEFT JOIN LATERAL (
         SELECT
           extract(epoch FROM (max(time) - min(time)))::int AS duration,
           count(*) FILTER (WHERE event_type='pageview')::int AS pages,
           count(*) FILTER (WHERE event_type='click')::int AS clicks,
           count(*) FILTER (WHERE event_type='click' AND (payload->>'rage')::boolean)::int AS rage,
           count(*) FILTER (WHERE event_type='error')::int AS errors,
           max(country) AS country, max(device) AS device, max(browser) AS browser,
           (array_agg(path ORDER BY time) FILTER (WHERE event_type='pageview'))[1] AS entry
           FROM events e WHERE e.site_id = $1 AND e.session_id = r.session_id
       ) ev ON true
       LEFT JOIN session_meta m ON m.site_id = $1 AND m.session_id = r.session_id
      WHERE ${conds.join(" AND ")}
      ORDER BY r.ended DESC
      LIMIT 100`,
    params
  );

  return rows.map((r) => ({
    sessionId: r.session_id,
    chunks: Number(r.chunks),
    startedAt: r.started.toISOString(),
    endedAt: r.ended.toISOString(),
    durationSec: Number(r.duration ?? 0),
    pages: Number(r.pages ?? 0),
    clicks: Number(r.clicks ?? 0),
    rageClicks: Number(r.rage ?? 0),
    errors: Number(r.errors ?? 0),
    country: r.country,
    device: r.device,
    browser: r.browser,
    entryPath: r.entry,
    favorite: r.favorite ?? false,
    tags: r.tags ?? [],
  }));
}

/** All frames for one session, flattened and ordered as recorded. */
export async function getReplayFrames(siteId: string, sessionId: string): Promise<unknown[]> {
  const rows = await query<{ frames: unknown[] }>(
    `SELECT frames FROM replay_chunks
      WHERE site_id = $1 AND session_id = $2
      ORDER BY seq ASC, time ASC`,
    [siteId, sessionId]
  );
  const all: unknown[] = [];
  for (const row of rows) if (Array.isArray(row.frames)) all.push(...row.frames);
  return all;
}
