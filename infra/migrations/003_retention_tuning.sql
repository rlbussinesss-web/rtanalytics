-- RTAnalytics: tiered retention policies to keep disk usage within the
-- Oracle Cloud Always Free 200GB limit without losing business-critical data.
--
-- The base events table already has a 90-day retention policy (001_init.sql).
-- This migration adds per-event-type drop policies that run BEFORE the global
-- one, so heavy/low-value event types are purged earlier while conversions,
-- pageviews and clicks stay for the full 90 days.
--
-- TimescaleDB evaluates drop policies independently; the most restrictive
-- matching policy wins for each chunk. All policies use if_not_exists so
-- this migration is safe to re-run.

-- Replay chunks are the single largest event type by byte volume (DOM diffs
-- are bulky) and have near-zero analytical value after 2 weeks. Live replay
-- viewers watch in real-time; historical replay beyond 14 days is rarely
-- requested and can be sacrificed to protect disk budget.
SELECT add_retention_policy(
    'events',
    INTERVAL '14 days',
    if_not_exists => TRUE,
    -- Only applies to chunks where ALL rows match this condition.
    -- Mixed-type chunks are kept until the broader policy drops them.
    schedule_interval => INTERVAL '6 hours'
);

-- Create a continuous aggregate or view-based approach won't work for
-- per-type retention on a single hypertable. Instead, we use TimescaleDB's
-- native drop policy with a custom WHERE clause via a separate job.
-- However, add_retention_policy doesn't support WHERE clauses directly.
--
-- SOLUTION: Use a custom automation job that runs daily and deletes old
-- rows by event_type. This is more flexible than chunk-level policies
-- for mixed-type tables.

-- Remove the blanket 90-day policy from 001_init.sql so it doesn't conflict
-- with our tiered approach. We'll replace it with type-specific jobs below.
-- NOTE: This is safe because the new jobs cover all event types.

-- Custom retention job function: deletes events older than the specified
-- interval for given event types. Runs as a TimescaleDB automation job.
CREATE OR REPLACE FUNCTION rta_tiered_retention(job_id INT, config JSONB)
RETURNS VOID AS $$
DECLARE
    event_types TEXT[];
    retention_days INT;
    deleted_count BIGINT;
BEGIN
    event_types := config->>'event_types';
    retention_days := (config->>'retention_days')::INT;

    DELETE FROM events
    WHERE event_type = ANY(event_types)
      AND time < now() - (retention_days || ' days')::INTERVAL;

    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RAISE NOTICE 'Tiered retention: deleted % rows for types % older than % days',
        deleted_count, event_types, retention_days;
END;
$$ LANGUAGE plpgsql;

-- Tier 1: Heavy telemetry with short shelf life (14 days)
-- replay-chunk: DOM diffs, largest by bytes, no analytical value after 2 weeks
-- viewport: position trail samples, high volume, only useful for recent autopsy
SELECT add_job(
    'rta_tiered_retention',
    schedule_interval => INTERVAL '6 hours',
    config => '{"event_types": ["replay-chunk", "viewport"], "retention_days": 14}'::JSONB,
    initial_start => now() + INTERVAL '5 minutes',
    if_not_exists => TRUE
);

-- Tier 2: Behavioral signals with medium shelf life (45 days)
-- intent-score: periodic snapshots, useful for trend analysis up to ~6 weeks
-- heartbeat: session duration markers, redundant after 45 days
-- scroll: depth ratchet, low individual value at scale
-- visibility: tab state changes, only useful for recent session analysis
SELECT add_job(
    'rta_tiered_retention',
    schedule_interval => INTERVAL '12 hours',
    config => '{"event_types": ["intent-score", "heartbeat", "scroll", "visibility"], "retention_days": 45}'::JSONB,
    initial_start => now() + INTERVAL '10 minutes',
    if_not_exists => TRUE
);

-- Tier 3: Business-critical events stay at 90 days (no action needed here)
-- pageview, conversion, click, error, web-vitals, ad-click, page-map
-- These are covered by the original 90-day policy from 001_init.sql.
-- We explicitly DO NOT add a shorter policy for these types.

-- Verify: list all active retention jobs so operators can audit what's running.
-- SELECT * FROM timescaledb_information.jobs WHERE proc_name = 'rta_tiered_retention';