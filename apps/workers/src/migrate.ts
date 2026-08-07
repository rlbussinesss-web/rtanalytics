import { getPool } from "./db.js";

/**
 * Applies the schema at worker startup.
 *
 * Running migrations from the worker (rather than a manual psql step) means a
 * fresh deploy of the whole stack comes up working with no human in the loop —
 * which matters on a hosting platform where the database password is generated
 * for us and never leaves the platform.
 *
 * Every statement is idempotent, so running it on every boot is safe. The
 * TimescaleDB-specific parts degrade gracefully: on a plain Postgres (no
 * timescaledb extension available) the table, indexes and inserts all still
 * work — only partitioning and compression are skipped.
 */

const BASE_SCHEMA = `
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS events (
    id          UUID        NOT NULL DEFAULT uuid_generate_v4(),
    time        TIMESTAMPTZ NOT NULL DEFAULT now(),
    site_id     TEXT        NOT NULL,
    session_id  TEXT        NOT NULL,
    visitor_id  TEXT        NOT NULL,
    event_type  TEXT        NOT NULL,
    path        TEXT        NOT NULL,
    payload     JSONB       NOT NULL DEFAULT '{}'::jsonb,
    country     TEXT,
    region      TEXT,
    city        TEXT,
    device      TEXT,
    browser     TEXT,
    os          TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (id, time)
);

-- Backfill-safe: existing deployments created the table before the region column.
ALTER TABLE events ADD COLUMN IF NOT EXISTS region TEXT;

CREATE INDEX IF NOT EXISTS idx_events_site_time ON events (site_id, time DESC);
CREATE INDEX IF NOT EXISTS idx_events_session ON events (session_id, time DESC);
CREATE INDEX IF NOT EXISTS idx_events_type ON events (event_type, time DESC);
CREATE INDEX IF NOT EXISTS idx_events_payload_gin ON events USING GIN (payload);

-- Recorded replay frames: one row per chunk. Kept separate from events
-- because frames are bulky and only read when replaying a specific session.
CREATE TABLE IF NOT EXISTS replay_chunks (
    id          BIGSERIAL   PRIMARY KEY,
    site_id     TEXT        NOT NULL,
    session_id  TEXT        NOT NULL,
    seq         INTEGER     NOT NULL,
    frames      JSONB       NOT NULL,
    time        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_replay_session ON replay_chunks (site_id, session_id, seq);
CREATE INDEX IF NOT EXISTS idx_replay_time ON replay_chunks (site_id, time DESC);

-- Per-session curation: favorite flag and free-form tags, set from the
-- dashboard. Separate from event data so it can be updated without touching
-- the immutable event log.
CREATE TABLE IF NOT EXISTS session_meta (
    site_id     TEXT        NOT NULL,
    session_id  TEXT        NOT NULL,
    favorite    BOOLEAN     NOT NULL DEFAULT false,
    tags        TEXT[]      NOT NULL DEFAULT '{}',
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (site_id, session_id)
);
`;

const TIMESCALE_SETUP = `
SELECT create_hypertable('events', 'time',
    chunk_time_interval => INTERVAL '1 day', if_not_exists => TRUE);

ALTER TABLE events SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'site_id, event_type'
);

SELECT add_compression_policy('events', INTERVAL '7 days', if_not_exists => TRUE);
SELECT add_retention_policy('events', INTERVAL '90 days', if_not_exists => TRUE);
`;

export async function runMigrations(): Promise<void> {
  const pool = getPool();

  await pool.query(BASE_SCHEMA);
  console.log("[migrate] base schema ready");

  try {
    await pool.query('CREATE EXTENSION IF NOT EXISTS timescaledb');
  } catch (err) {
    console.warn(
      "[migrate] timescaledb extension unavailable — continuing on plain " +
        "Postgres without partitioning or compression:",
      err instanceof Error ? err.message : err
    );
    return;
  }

  try {
    await pool.query(TIMESCALE_SETUP);
    console.log("[migrate] timescale hypertable, compression and retention ready");
  } catch (err) {
    // Most likely cause: the table already holds rows and cannot be converted
    // in place. Not fatal — inserts keep working against the plain table.
    console.warn(
      "[migrate] timescale setup skipped:",
      err instanceof Error ? err.message : err
    );
  }
}
