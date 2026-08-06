import { Redis } from "ioredis";

const PRESENCE_TTL_SEC = 60;

/** Creates a fresh Redis connection — used for pub/sub subscribers, which
 * must not share a connection with regular command usage (ioredis puts a
 * connection in subscriber mode once SUBSCRIBE is called). */
export function createRedisClient(): Redis {
  const url = process.env.REDIS_URL ?? "redis://localhost:6379";
  return new Redis(url);
}

let commandClient: Redis | null = null;
export function getRedis(): Redis {
  if (commandClient) return commandClient;
  commandClient = createRedisClient();
  return commandClient;
}

export async function getOnlineCount(siteId: string): Promise<number> {
  const redis = getRedis();
  const key = `online:${siteId}`;
  const now = Date.now();
  await redis.zremrangebyscore(key, 0, now - PRESENCE_TTL_SEC * 1000);
  return redis.zcard(key);
}

/** Session ids currently online, most recently seen first. */
export async function getOnlineSessions(siteId: string): Promise<string[]> {
  const redis = getRedis();
  const key = `online:${siteId}`;
  const now = Date.now();
  await redis.zremrangebyscore(key, 0, now - PRESENCE_TTL_SEC * 1000);
  return redis.zrevrange(key, 0, 199);
}

/**
 * Asks the visitor's browser to start or stop recording its screen.
 *
 * The command is broadcast on one channel rather than addressed to a specific
 * ingest instance: we don't track which replica holds which socket, and every
 * ingest ignores sessions it doesn't have. That keeps ingest horizontally
 * scalable without a session-to-instance directory to maintain.
 */
export async function sendRecordingCommand(
  sessionId: string,
  action: "start-recording" | "stop-recording"
): Promise<void> {
  const redis = getRedis();
  await redis.publish("control", JSON.stringify({ sessionId, action }));
}
