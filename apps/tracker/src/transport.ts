import type { AnyTrackerEvent } from "./types";
import { EventQueue } from "./queue";

const MAX_BACKOFF_MS = 30_000;
const BASE_BACKOFF_MS = 500;
const FLUSH_BATCH_SIZE = 50;

/**
 * WebSocket transport with a local queue, automatic reconnect and
 * exponential backoff + jitter. Events are serialized as JSON for now.
 *
 * NOTE (future optimization, per architecture plan): switch payload framing
 * to MessagePack for smaller wire size once the binary encoder is added as
 * a lazy-loaded chunk — keeping the core bundle JSON-only keeps it simpler
 * and dependency-free for Phase 1.
 */
export class Transport {
  private ws: WebSocket | null = null;
  private queue = new EventQueue();
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private closedByUser = false;

  private onCommand: ((type: string) => void) | null = null;

  constructor(private readonly url: string) {}

  /** Registers a handler for commands pushed down by the server. */
  setCommandHandler(handler: (type: string) => void): void {
    this.onCommand = handler;
  }

  connect(): void {
    this.closedByUser = false;
    this.openSocket();
  }

  private openSocket(): void {
    try {
      this.ws = new WebSocket(this.url);
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.ws.addEventListener("open", () => {
      this.attempt = 0;
      this.flush();
    });

    this.ws.addEventListener("message", (ev: MessageEvent) => {
      try {
        const msg = JSON.parse(String(ev.data)) as { type?: string };
        // "ack" and "error" are per-event replies; anything else is a command.
        if (msg.type && msg.type !== "ack" && msg.type !== "error") {
          this.onCommand?.(msg.type);
        }
      } catch {
        // ignore unparseable frames
      }
    });

    this.ws.addEventListener("close", () => {
      if (!this.closedByUser) this.scheduleReconnect();
    });

    this.ws.addEventListener("error", () => {
      this.ws?.close();
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    const exp = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** this.attempt);
    const jitter = Math.random() * exp * 0.25;
    const delay = exp + jitter;
    this.attempt += 1;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.openSocket();
    }, delay);
  }

  private get isOpen(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  /** Enqueues an event and attempts an immediate flush if connected. */
  send(event: AnyTrackerEvent): void {
    this.queue.push(event);
    this.flush();
  }

  private flush(): void {
    if (!this.isOpen || this.queue.isEmpty()) return;

    const batch = this.queue.peekAll().slice(0, FLUSH_BATCH_SIZE);
    let sent = 0;
    for (const event of batch) {
      try {
        this.ws!.send(JSON.stringify(event));
        sent += 1;
      } catch {
        break; // stop on first failure, keep remainder queued
      }
    }
    if (sent > 0) this.queue.drop(sent);
    if (!this.queue.isEmpty()) {
      // more events queued than this batch covered; drain on next tick
      queueMicrotask(() => this.flush());
    }
  }

  close(): void {
    this.closedByUser = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
  }
}
