-- RTAnalytics initial schema: raw events hypertable.
-- Applied automatically by the timescaledb container on first boot
-- (mounted into /docker-entrypoint-initdb.d), or manually via:
--   psql "$DATABASE_URL" -f infra/migrations/001_init.sql

CREATE EXTENSION IF NOT EXISTS timescaledb;
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
    city        TEXT,
    device      TEXT,
    browser     TEXT,
    os          TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (id, time)
);

-- Partition the table by the `time` column, chunked in 1-day intervals.
SELECT create_hypertable(
    'events',
    'time',
    chunk_time_interval => INTERVAL '1 day',
    if_not_exists => TRUE
);

CREATE INDEX IF NOT EXISTS idx_events_site_time ON events (site_id, time DESC);
CREATE INDEX IF NOT EXISTS idx_events_session ON events (session_id, time DESC);
CREATE INDEX IF NOT EXISTS idx_events_type ON events (event_type, time DESC);
CREATE INDEX IF NOT EXISTS idx_events_payload_gin ON events USING GIN (payload);

-- Keep raw event data manageable: compress chunks older than 7 days.
ALTER TABLE events SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'site_id, event_type'
);

SELECT add_compression_policy('events', INTERVAL '7 days', if_not_exists => TRUE);

-- Default retention: drop chunks older than 90 days (adjust per site later).
SELECT add_retention_policy('events', INTERVAL '90 days', if_not_exists => TRUE);
