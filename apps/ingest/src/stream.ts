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
export const REPLAY_STREAM = "replay";

const MAX_STREAM_LEN = 1_000_000;
// Replay frames are bulky; keep a shorter buffer in front of the DB.
const MAX_REPLAY_STREAM_LEN = 200_000;

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

/**
 * Durably records a replay chunk so the session can be watched again later.
 * Separate from the live pub/sub fan-out: pub/sub reaches whoever is watching
 * now, this stream feeds the worker that writes frames to Postgres for
 * on-demand playback of past sessions.
 */
export async function recordReplayChunk(
  siteId: string,
  sessionId: string,
  seq: number,
  frames: unknown
): Promise<void> {
  const redis = getRedis();
  await redis.xadd(
    REPLAY_STREAM,
    "MAXLEN",
    "~",
    MAX_REPLAY_STREAM_LEN,
    "*",
    "siteId",
    siteId,
    "sessionId",
    sessionId,
    "seq",
    String(seq),
    "frames",
    JSON.stringify(frames)
  );
}
