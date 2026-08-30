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
  city: string | null;
  device: string | null;
  browser: string | null;
  os: string | null;
  time: Date;
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

  // Collapse intra-batch duplicates so the single statement can't conflict with
  // itself (and to keep the payload small). Rows without an event_id can't be
  // deduped, so they always pass through.
  const seen = new Set<string>();
  const deduped = rows.filter((r) => {
    if (!r.eventId) return true;
    const key = `${r.eventId}|${r.time.getTime()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

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
