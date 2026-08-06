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
