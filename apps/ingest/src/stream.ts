import { getRedis } from "./redis.js";

/**
 * Durable event log backed by a Redis Stream.
 *
 * Replaces the NATS JetStream dependency: at this scale a single Redis
 * Stream with a consumer group gives the same at-least-once delivery and
 * replay-after-crash guarantees, without running a second broker. Consumers
 * (see apps/workers) read via XREADGROUP and acknowledge with XACK, so an
 * event is only dropped from the pending list once it is safely persisted.
 *
 * MAXLEN caps the log so it cannot grow without bound — it is a buffer in
 * front of TimescaleDB, not the system of record.
 */
export const EVENTS_STREAM = "events";
export const EVENTS_GROUP = "persist-workers";

const MAX_STREAM_LEN = 1_000_000;

export async function publishEvent(
  siteId: string,
  eventType: string,
  data: unknown
): Promise<void> {
  const redis = getRedis();
  await redis.xadd(
    EVENTS_STREAM,
    "MAXLEN",
    "~",
    MAX_STREAM_LEN,
    "*",
    "siteId",
    siteId,
    "eventType",
    eventType,
    "payload",
    JSON.stringify(data)
  );
}
