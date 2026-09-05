/**
 * Persistence worker: consumes events from the Redis Stream `events` via a
 * consumer group and batch-inserts them into TimescaleDB. Batches flush every
 * 200ms or after 500 events, whichever comes first.
 *
 * Delivery is at-least-once: entries stay in the group's pending list until
 * XACK, so a crash mid-batch redelivers rather than loses. Duplicates are
 * possible by design and are cheap here (an event landing twice skews a count
 * marginally; losing one is worse).
 */
import { Redis } from "ioredis";
import { insertEventsBatch, upsertPageMap, type EventInsertRow } from "./db.js";
import { runMigrations } from "./migrate.js";
import { runReplayConsumer } from "./replay-consumer.js";
import { runAlertsWorker } from "./alerts-worker.js";

const STREAM = "events";
const GROUP = "persist-workers";
const CONSUMER = process.env.WORKER_NAME ?? `worker-${process.pid}`;
const BATCH_MAX_SIZE = 500;
const BATCH_MAX_WAIT_MS = 200;
const BLOCK_MS = 5_000;

function createRedis(): Redis {
  return new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
    maxRetriesPerRequest: null,
  });
}

interface Pending {
  id: string;
  row: EventInsertRow;
}

function toRow(payloadJson: string): EventInsertRow {
  const data = JSON.parse(payloadJson) as Record<string, unknown>;
  return {
    eventId: typeof data.eventId === "string" ? data.eventId : "",
    siteId: String(data.siteId),
    sessionId: String(data.sessionId),
    visitorId: String(data.visitorId),
    eventType: String(data.eventType),
    path: String(data.path ?? ""),
    payload: (data.payload as Record<string, unknown>) ?? {},
    country: (data.country as string) ?? null,
    region: (data.region as string) ?? null,
    host: (data.host as string) ?? null,
    isBot: data.isBot === true,
    city: (data.city as string) ?? null,
    device: (data.device as string) ?? null,
    browser: (data.browser as string) ?? null,
    os: (data.os as string) ?? null,
    time: new Date((data.timestamp as number) ?? Date.now()),
  };
}

async function main(): Promise<void> {
  await runMigrations();

  // Replay chunks are persisted by an independent consumer on its own
  // connection, running concurrently with the events consumer below. If it
  // ever throws, take the whole process down so Railway restarts it rather
  // than silently losing replay recording.
  void runReplayConsumer(process.env.REDIS_URL ?? "redis://localhost:6379").catch(
    (err) => {
      console.error("[replay-consumer] fatal", err);
      process.exit(1);
    }
  );

  const redis = createRedis();

  // Spike alerts share this process: they are a periodic read, not a stream
  // consumer, so a separate service would cost a container to run a query a
  // minute. Failures are logged and never take persistence down with them.
  runAlertsWorker(createRedis());

  // MKSTREAM creates the stream if the ingest side hasn't written to it yet.
  try {
    await redis.xgroup("CREATE", STREAM, GROUP, "0", "MKSTREAM");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!message.includes("BUSYGROUP")) throw err;
  }

  let batch: Pending[] = [];
  let flushTimer: NodeJS.Timeout | null = null;

  async function flush(): Promise<void> {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    if (batch.length === 0) return;

    const current = batch;
    batch = [];

    try {
      await insertEventsBatch(current.map((p) => p.row));
      await redis.xack(STREAM, GROUP, ...current.map((p) => p.id));
      console.log(`[persist-worker] flushed ${current.length} events`);
    } catch (err) {
      // No XACK: entries stay pending and are redelivered to this or another
      // consumer after the idle timeout, so nothing is lost.
      console.error("[persist-worker] batch insert failed, leaving unacked", err);
    }
  }

  function scheduleFlush(): void {
    if (flushTimer) return;
    flushTimer = setTimeout(() => void flush(), BATCH_MAX_WAIT_MS);
  }

  console.log(`[persist-worker] consuming ${STREAM} as ${CONSUMER} in group ${GROUP}`);

  for (;;) {
    const response = await redis.xreadgroup(
      "GROUP",
      GROUP,
      CONSUMER,
      "COUNT",
      BATCH_MAX_SIZE,
      "BLOCK",
      BLOCK_MS,
      "STREAMS",
      STREAM,
      ">"
    );

    if (!response) {
      // Idle tick: nothing arrived within BLOCK_MS. Flush whatever partial
      // batch is sitting around rather than letting it wait indefinitely.
      await flush();
      continue;
    }

    for (const [, entries] of response as [string, [string, string[]][]][]) {
      for (const [id, fields] of entries) {
        try {
          const payloadIndex = fields.indexOf("payload");
          if (payloadIndex === -1) throw new Error("missing payload field");
          const json = fields[payloadIndex + 1]!;

          // A page map describes a page version, not a moment in a session, so
          // it belongs in its own table rather than in the event log — where it
          // would be a large duplicated blob on every re-send.
          const parsed = JSON.parse(json) as Record<string, unknown>;
          if (parsed.eventType === "page-map") {
            // Storage failures are handled separately from malformed input: a
            // database blip must leave the entry pending for redelivery, not
            // ack it away and lose the map until the next visitor sends one.
            const p = parsed.payload as {
              structureHash: string;
              height: number;
              width: number;
              blocks: unknown;
            };
            try {
              await upsertPageMap({
                siteId: String(parsed.siteId),
                path: String(parsed.path ?? ""),
                structureHash: p.structureHash,
                height: p.height,
                width: p.width,
                blocks: p.blocks,
              });
              await redis.xack(STREAM, GROUP, id);
            } catch (err) {
              console.error("[persist-worker] page map store failed, leaving unacked", err);
            }
            continue;
          }

          batch.push({ id, row: toRow(json) });
        } catch (err) {
          console.error("[persist-worker] malformed entry, acking to unblock", id, err);
          await redis.xack(STREAM, GROUP, id);
        }
      }
    }

    if (batch.length >= BATCH_MAX_SIZE) {
      await flush();
    } else {
      scheduleFlush();
    }
  }
}

main().catch((err) => {
  console.error("[persist-worker] fatal error", err);
  process.exit(1);
});
