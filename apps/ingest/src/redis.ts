import { Redis } from "ioredis";

let client: Redis | null = null;

export function getRedis(): Redis {
  if (client) return client;
  const url = process.env.REDIS_URL ?? "redis://localhost:6379";
  client = new Redis(url);
  return client;
}

const PRESENCE_TTL_SEC = 60; // must be renewed by heartbeats (every 15s from tracker)

/**
 * Marks a session as "online" for a site using a sorted set keyed by
 * site, scored by last-seen timestamp. Expiring members is done by
 * querying only members with score within the TTL window (ZREMRANGEBYSCORE
 * is used opportunistically to prune stale entries), which is simpler to
 * operate than per-key TTLs on thousands of individual keys.
 */
export async function touchPresence(siteId: string, sessionId: string): Promise<void> {
  const redis = getRedis();
  const key = `online:${siteId}`;
  const now = Date.now();
  await redis.zadd(key, now, sessionId);
  // Opportunistic cleanup of stale sessions on every write (cheap, O(log N + M)).
  await redis.zremrangebyscore(key, 0, now - PRESENCE_TTL_SEC * 1000);
}

export async function getOnlineCount(siteId: string): Promise<number> {
  const redis = getRedis();
  const key = `online:${siteId}`;
  const now = Date.now();
  await redis.zremrangebyscore(key, 0, now - PRESENCE_TTL_SEC * 1000);
  return redis.zcard(key);
}

export async function publishLiveEvent(siteId: string, event: unknown): Promise<void> {
  const redis = getRedis();
  await redis.publish(`live:${siteId}`, JSON.stringify(event));
}

/**
 * Replay frames go to a per-session channel so a viewer watching one visitor
 * never receives another visitor's frames, and so nothing is fanned out when
 * nobody is subscribed.
 */
export async function publishReplayChunk(
  siteId: string,
  sessionId: string,
  event: unknown
): Promise<void> {
  const redis = getRedis();
  await redis.publish(`replay:${siteId}:${sessionId}`, JSON.stringify(event));
}

/** Reads the set of site keys the dashboard has registered as projects. */
export async function readAllowedSites(key: string): Promise<string[]> {
  return getRedis().smembers(key);
}

// ---------------------------------------------------------------------------
// Ad-click attribution cache
// ---------------------------------------------------------------------------

/**
 * Stores the ad click id (gclid/fbclid/ttclid/msclkid) for a session so that
 * server-side conversions arriving hours later can be attributed back to the
 * original ad without depending on UTMs surviving the payment flow.
 *
 * TTL is 24h — long enough for Pix/boleto confirmations, short enough to
 * bound memory. The durable copy lives in session_ad_clicks (TimescaleDB).
 */
const AD_CLICK_TTL_SEC = 86_400;

export interface AdClickInfo {
  adClickId: string;
  platform: "google" | "meta" | "tiktok" | "bing";
}

export async function storeAdClick(
  siteId: string,
  sessionId: string,
  info: AdClickInfo
): Promise<void> {
  const redis = getRedis();
  const key = `adclick:${siteId}:${sessionId}`;
  await redis.set(key, JSON.stringify(info), "EX", AD_CLICK_TTL_SEC);
}

export async function getAdClick(
  siteId: string,
  sessionId: string
): Promise<AdClickInfo | null> {
  const redis = getRedis();
  const key = `adclick:${siteId}:${sessionId}`;
  const raw = await redis.get(key);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    // Validate shape: a corrupted or tampered value must not crash the
    // conversion pipeline downstream.
    if (
      parsed &&
      typeof parsed.adClickId === "string" &&
      parsed.adClickId.length > 0 &&
      (parsed.platform === "google" ||
        parsed.platform === "meta" ||
        parsed.platform === "tiktok" ||
        parsed.platform === "bing")
    ) {
      return parsed as AdClickInfo;
    }
    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Conversion dedup
// ---------------------------------------------------------------------------

/**
 * Short-lived lock that prevents the same (session, conversion name, value)
 * from being recorded twice within the dedup window. Absorbs gateway retries
 * without blocking legitimate repeat purchases after the window expires.
 */
const DEDUP_WINDOW_SEC = 300; // 5 minutes

export async function tryAcquireConversionLock(
  siteId: string,
  sessionId: string,
  name: string,
  value: number | undefined
): Promise<boolean> {
  const redis = getRedis();
  // Hash the name to avoid key collision or injection when the conversion name
  // contains `:` or other Redis-key-sensitive characters. The value is safe as
  // a literal because it is either a number or the fixed sentinel "n".
  const nameSafe = Buffer.from(name).toString("base64url").slice(0, 64);
  const key = `dedup:${siteId}:${sessionId}:${nameSafe}:${value ?? "n"}`;
  const result = await redis.set(key, "1", "EX", DEDUP_WINDOW_SEC, "NX");
  return result === "OK";
}