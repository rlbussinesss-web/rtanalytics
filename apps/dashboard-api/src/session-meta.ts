import { query } from "./db.js";

/**
 * Favorites and tags on sessions. Small mutable curation state kept in its own
 * table so the event log stays append-only. The dashboard writes here; the
 * recordings list reads it back joined onto each recording.
 */

export interface SessionMeta {
  favorite: boolean;
  tags: string[];
}

export async function setSessionMeta(
  siteId: string,
  sessionId: string,
  patch: { favorite?: boolean; tags?: string[] }
): Promise<SessionMeta> {
  const rows = await query<{ favorite: boolean; tags: string[] }>(
    `INSERT INTO session_meta (site_id, session_id, favorite, tags, updated_at)
       VALUES ($1, $2, coalesce($3::boolean, false), coalesce($4::text[], '{}'::text[]), now())
     ON CONFLICT (site_id, session_id) DO UPDATE SET
       favorite = coalesce($3::boolean, session_meta.favorite),
       tags     = coalesce($4::text[], session_meta.tags),
       updated_at = now()
     RETURNING favorite, tags`,
    [siteId, sessionId, patch.favorite ?? null, patch.tags ?? null]
  );
  const row = rows[0]!;
  return { favorite: row.favorite, tags: row.tags };
}

/** All distinct tags in use for a site, for autocomplete/filtering. */
export async function listTags(siteId: string): Promise<string[]> {
  const rows = await query<{ tag: string }>(
    `SELECT DISTINCT unnest(tags) AS tag FROM session_meta WHERE site_id = $1 ORDER BY tag`,
    [siteId]
  );
  return rows.map((r) => r.tag);
}
