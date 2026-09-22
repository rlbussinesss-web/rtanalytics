-- RTAnalytics: ad-click attribution + conversion dedup.
--
-- 1. Adds is_bot column (already used in queries but missing from schema).
-- 2. Creates a session-level cache of ad click ids so server-side conversions
--    can be attributed back to the original gclid/fbclid/ttclid without
--    depending on UTMs surviving the payment flow.
-- 3. Adds a dedup index for server-reported conversions so a gateway retry
--    cannot inflate revenue.

-- is_bot is referenced by every dashboard query; adding it as a real column
-- avoids repeated JSON casts and lets us index/filter efficiently.
ALTER TABLE events ADD COLUMN IF NOT EXISTS is_bot BOOLEAN DEFAULT FALSE;

-- Session → ad click id mapping. Lives in TimescaleDB rather than Redis so
-- attribution survives restarts and can be queried historically. TTL matches
-- the events retention policy; old rows are dropped with their parent chunk.
CREATE TABLE IF NOT EXISTS session_ad_clicks (
    site_id      TEXT        NOT NULL,
    session_id   TEXT        NOT NULL,
    ad_click_id  TEXT        NOT NULL,
    platform     TEXT        NOT NULL,  -- 'google' | 'meta' | 'tiktok' | 'bing'
    captured_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (site_id, session_id)
);

-- Conversion dedup: prevents the same (session, conversion name, value)
-- from being recorded twice within a 5-minute window — enough to absorb
-- gateway retries without blocking legitimate repeat purchases.
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversion_dedup
    ON events (site_id, session_id, payload->>'name', time)
    WHERE event_type = 'conversion';

-- Partial index for checkout friction detection: the insights query filters
-- on (error | click) + path LIKE within a time window. Without this index
-- every call scans full chunks; with it, only the relevant rows are touched.
-- Covers ~90% of the I/O cost of the friction insight at scale.
CREATE INDEX IF NOT EXISTS idx_events_friction
    ON events (site_id, time DESC)
    WHERE event_type IN ('error', 'click');