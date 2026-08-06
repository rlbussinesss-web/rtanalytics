import { Redis } from "ioredis";
import { insertReplayChunks, type ReplayChunkRow } from "./db.js";

/**
 * Consumes recorded replay chunks from the Redis `replay` stream into the
 * replay_chunks table, so past sessions can be watched again.
 *
 * Runs as its own consumer on its own connection because XREADGROUP with BLOCK
 * monopolizes a connection — it can't share the events consumer's socket. Same
 * at-least-once contract: unacked entries are redelivered after a crash.
 */

const STREAM = "replay";
const GROUP = "replay-workers";
const CONSUMER = process.env.WORKER_NAME ?? `replay-${process.pid}`;
const BATCH_MAX_SIZE = 200;
const BATCH_MAX_WAIT_MS = 400;
const BLOCK_MS = 5_000;

interface Pending {
  id: string;
  row: ReplayChunkRow;
}

function fieldMap(fields: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (let i = 0; i < fields.length; i += 2) map[fields[i]!] = fields[i + 1]!;
  return map;
}

export async function runReplayConsumer(redisUrl: string): Promise<void> {
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: null });

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
      await insertReplayChunks(current.map((p) => p.row));
      await redis.xack(STREAM, GROUP, ...current.map((p) => p.id));
    } catch (err) {
      console.error("[replay-consumer] insert failed, leaving unacked", err);
    }
  }

  function scheduleFlush(): void {
    if (flushTimer) return;
    flushTimer = setTimeout(() => void flush(), BATCH_MAX_WAIT_MS);
  }

  console.log(`[replay-consumer] consuming ${STREAM} as ${CONSUMER}`);

  for (;;) {
    const response = await redis.xreadgroup(
      "GROUP", GROUP, CONSUMER,
      "COUNT", BATCH_MAX_SIZE,
      "BLOCK", BLOCK_MS,
      "STREAMS", STREAM, ">"
    );

    if (!response) {
      await flush();
      continue;
    }

    for (const [, entries] of response as [string, [string, string[]][]][]) {
      for (const [id, fields] of entries) {
        try {
          const f = fieldMap(fields);
          batch.push({
            id,
            row: {
              siteId: f.siteId!,
              sessionId: f.sessionId!,
              seq: Number(f.seq),
              frames: JSON.parse(f.frames!),
              time: new Date(),
            },
          });
        } catch (err) {
          console.error("[replay-consumer] malformed entry, acking", id, err);
          await redis.xack(STREAM, GROUP, id);
        }
      }
    }

    if (batch.length >= BATCH_MAX_SIZE) await flush();
    else scheduleFlush();
  }
}
