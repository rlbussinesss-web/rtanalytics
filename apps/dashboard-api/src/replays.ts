import { query } from "./db.js";

/**
 * Recorded session playback.
 *
 * Recordings exist only for sessions that were watched live (frames are
 * captured on-demand, see the tracker). So this lists sessions that produced
 * stored frames, and returns their frames in order for offline replay.
 */

export interface ReplaySummary {
  sessionId: string;
  chunks: number;
  startedAt: string;
  endedAt: string;
}

export async function listReplays(siteId: string): Promise<ReplaySummary[]> {
  const rows = await query<{
    session_id: string;
    chunks: string;
    started: Date;
    ended: Date;
  }>(
    `SELECT session_id,
            count(*)::int AS chunks,
            min(time) AS started,
            max(time) AS ended
       FROM replay_chunks
      WHERE site_id = $1
      GROUP BY session_id
      ORDER BY max(time) DESC
      LIMIT 100`,
    [siteId]
  );
  return rows.map((r) => ({
    sessionId: r.session_id,
    chunks: Number(r.chunks),
    startedAt: r.started.toISOString(),
    endedAt: r.ended.toISOString(),
  }));
}

/** All frames for one session, flattened and ordered as recorded. */
export async function getReplayFrames(
  siteId: string,
  sessionId: string
): Promise<unknown[]> {
  const rows = await query<{ frames: unknown[] }>(
    `SELECT frames FROM replay_chunks
      WHERE site_id = $1 AND session_id = $2
      ORDER BY seq ASC, time ASC`,
    [siteId, sessionId]
  );
  const all: unknown[] = [];
  for (const row of rows) {
    if (Array.isArray(row.frames)) all.push(...row.frames);
  }
  return all;
}
