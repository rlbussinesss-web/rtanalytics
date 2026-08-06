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
  siteId: string;
  sessionId: string;
  visitorId: string;
  eventType: string;
  path: string;
  payload: Record<string, unknown>;
  country: string | null;
  city: string | null;
  device: string | null;
  browser: string | null;
  os: string | null;
  time: Date;
}

/** Batch inserts rows into the `events` hypertable using a single multi-row INSERT. */
export async function insertEventsBatch(rows: EventInsertRow[]): Promise<void> {
  if (rows.length === 0) return;

  const columns = [
    "site_id",
    "session_id",
    "visitor_id",
    "event_type",
    "path",
    "payload",
    "country",
    "city",
    "device",
    "browser",
    "os",
    "time",
  ];

  const values: unknown[] = [];
  const valuePlaceholders: string[] = [];

  rows.forEach((row, i) => {
    const base = i * columns.length;
    valuePlaceholders.push(
      `(${columns.map((_, j) => `$${base + j + 1}`).join(", ")})`
    );
    values.push(
      row.siteId,
      row.sessionId,
      row.visitorId,
      row.eventType,
      row.path,
      JSON.stringify(row.payload),
      row.country,
      row.city,
      row.device,
      row.browser,
      row.os,
      row.time
    );
  });

  const sql = `INSERT INTO events (${columns.join(", ")}) VALUES ${valuePlaceholders.join(", ")}`;
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
