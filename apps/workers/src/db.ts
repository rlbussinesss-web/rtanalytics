import pg from "pg";

const { Pool } = pg;

let pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (pool) return pool;
  pool = new Pool({
    connectionString:
      process.env.DATABASE_URL ??
      "postgres://rtanalytics:rtanalytics_dev_password@localhost:5432/rtanalytics",
    max: 10,
  });
  return pool;
}

export interface EventInsertRow {
  eventId: string;
  siteId: string;
  sessionId: string;
  visitorId: string;
  eventType: string;
  path: string;
  payload: Record<string, unknown>;
  country: string | null;
  region: string | null;
  host: string | null;
  isBot: boolean;
  city: string | null;
  device: string | null;
  browser: string | null;
  os: string | null;
  time: Date;
}

/**
 * Collapses duplicate rows within one batch, keyed by (event_id, time).
 *
 * A redelivery can land in the same flush as the original, and a single INSERT
 * conflicting with itself is fragile; removing them here keeps the statement
 * clean and smaller. Rows with no event_id can't be identified, so they always
 * pass through rather than being silently merged.
 */
export function dedupeRows<T extends { eventId: string; time: Date }>(rows: T[]): T[] {
  const seen = new Set<string>();
  return rows.filter((r) => {
    if (!r.eventId) return true;
    const key = `${r.eventId}|${r.time.getTime()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Batch inserts rows into the `events` hypertable using a single multi-row
 * INSERT, deduplicated by the client's event_id so metrics stay exact.
 *
 * Two layers of dedupe: within the batch (a redelivery could land in the same
 * flush) rows are collapsed by (event_id, time) before building the statement,
 * and across batches `ON CONFLICT (event_id, time) DO NOTHING` drops anything
 * already persisted. Together they make ingestion idempotent under the
 * pipeline's at-least-once delivery, so no event is ever counted twice.
 */
export async function insertEventsBatch(rows: EventInsertRow[]): Promise<void> {
  if (rows.length === 0) return;

  const deduped = dedupeRows(rows);

  const columns = [
    "event_id",
    "site_id",
    "session_id",
    "visitor_id",
    "event_type",
    "path",
    "payload",
    "country",
    "region",
    "host",
    "is_bot",
    "city",
    "device",
    "browser",
    "os",
    "time",
  ];

  const values: unknown[] = [];
  const valuePlaceholders: string[] = [];

  deduped.forEach((row, i) => {
    const base = i * columns.length;
    valuePlaceholders.push(
      `(${columns.map((_, j) => `$${base + j + 1}`).join(", ")})`
    );
    values.push(
      row.eventId || null,
      row.siteId,
      row.sessionId,
      row.visitorId,
      row.eventType,
      row.path,
      JSON.stringify(row.payload),
      row.country,
      row.region,
      row.host,
      row.isBot,
      row.city,
      row.device,
      row.browser,
      row.os,
      row.time
    );
  });

  const sql =
    `INSERT INTO events (${columns.join(", ")}) VALUES ${valuePlaceholders.join(", ")} ` +
    `ON CONFLICT (event_id, time) DO NOTHING`;
  const client = getPool();
  await client.query(sql, values);
}

export interface ReplayChunkRow {
  siteId: string;
  sessionId: string;
  seq: number;
  frames: unknown;
  time: Date;
}

/** Batch inserts recorded replay chunks for later playback. */
export async function insertReplayChunks(rows: ReplayChunkRow[]): Promise<void> {
  if (rows.length === 0) return;
  const values: unknown[] = [];
  const placeholders: string[] = [];
  rows.forEach((row, i) => {
    const b = i * 5;
    placeholders.push(`($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5})`);
    values.push(
      row.siteId,
      row.sessionId,
      row.seq,
      JSON.stringify(row.frames),
      row.time
    );
  });
  const sql = `INSERT INTO replay_chunks (site_id, session_id, seq, frames, time) VALUES ${placeholders.join(", ")}`;
  await getPool().query(sql, values);
}

export interface PageMapRow {
  siteId: string;
  path: string;
  structureHash: string;
  height: number;
  width: number;
  blocks: unknown;
}

/**
 * Stores one version of a page's content map.
 *
 * A re-send always rewrites the content. The structure hash intentionally
 * ignores text, so that a countdown or a personalised name does not spawn a new
 * version on every visit — but that also means a rewritten headline keeps the
 * same hash, and skipping the update would leave the autopsy quoting copy that
 * no longer exists on the page.
 */
export async function upsertPageMap(row: PageMapRow): Promise<void> {
  await getPool().query(
    `INSERT INTO page_maps (site_id, path, structure_hash, height, width, blocks)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (site_id, path, structure_hash)
     DO UPDATE SET blocks = EXCLUDED.blocks,
                   height = EXCLUDED.height,
                   width = EXCLUDED.width,
                   last_seen = now()`,
    [row.siteId, row.path, row.structureHash, row.height, row.width, JSON.stringify(row.blocks)]
  );
}

export interface AdClickRow {
  siteId: string;
  sessionId: string;
  adClickId: string;
  platform: "google" | "meta" | "tiktok" | "bing";
}

/**
 * Persists the ad click id for a session so that server-side conversions
 * arriving hours later can be attributed back to the original gclid/fbclid/
 * ttclid even if Redis has been flushed or the key expired.
 *
 * Uses ON CONFLICT DO NOTHING because the first pageview in a session is the
 * authoritative source — subsequent pageviews from the same session (e.g.
 * SPA navigation) must not overwrite the original attribution.
 */
export async function upsertAdClick(row: AdClickRow): Promise<void> {
  await getPool().query(
    `INSERT INTO session_ad_clicks (site_id, session_id, ad_click_id, platform)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (site_id, session_id) DO NOTHING`,
    [row.siteId, row.sessionId, row.adClickId, row.platform]
  );
}
