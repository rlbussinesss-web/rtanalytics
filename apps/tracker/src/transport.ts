import type { AnyTrackerEvent } from "./types";
import { EventQueue } from "./queue";

const MAX_BACKOFF_MS = 30_000;
const BASE_BACKOFF_MS = 500;
const FLUSH_BATCH_SIZE = 50;
/** Give up on an event after this many delivery attempts. */
const MAX_SEND_ATTEMPTS = 5;

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
  /** Event ids sent on the current socket but not yet acknowledged. */
  private inFlight = new Set<string>();
  /** Delivery attempts per event id, so a poison event can't block forever. */
  private attempts = new Map<string, number>();

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
        const msg = JSON.parse(String(ev.data)) as { type?: string; eventId?: string };
        if (msg.type === "ack") {
          // Confirmed durable server-side: only now is it safe to forget.
          if (msg.eventId) {
            this.forget(msg.eventId);
          }
          this.flush();
        } else if (msg.type === "error") {
          // The server rejected this event; retrying it would fail forever.
          if (msg.eventId) this.forget(msg.eventId);
        } else if (msg.type) {
          this.onCommand?.(msg.type);
        }
      } catch {
        // ignore unparseable frames
      }
    });

    this.ws.addEventListener("close", () => {
      // Anything unacknowledged never made it. Clearing in-flight puts those
      // events back in line so the next socket resends them; the server
      // deduplicates by eventId, so a resend can never double-count.
      this.inFlight.clear();
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

  /**
   * Sends everything queued that isn't already awaiting an ack. Events stay in
   * the queue until the server confirms them, so a socket that dies mid-flight
   * costs a resend rather than the data. Each incoming ack re-triggers a flush,
   * which drains anything beyond one batch.
   */
  private flush(): void {
    if (!this.isOpen || this.queue.isEmpty()) return;

    const pending = this.queue.peekAll().filter((e) => !this.inFlight.has(e.eventId));
    for (const event of pending.slice(0, FLUSH_BATCH_SIZE)) {
      const tries = (this.attempts.get(event.eventId) ?? 0) + 1;
      if (tries > MAX_SEND_ATTEMPTS) {
        // Repeatedly unacknowledged: drop it rather than stall everything
        // behind it. Losing one event beats losing the whole queue.
        this.forget(event.eventId);
        continue;
      }
      try {
        this.ws!.send(JSON.stringify(event));
        this.attempts.set(event.eventId, tries);
        this.inFlight.add(event.eventId);
      } catch {
        break; // stop on first failure, keep the remainder queued
      }
    }
  }

  /** Drops an event from the queue and all delivery bookkeeping. */
  private forget(eventId: string): void {
    this.queue.ack(eventId);
    this.inFlight.delete(eventId);
    this.attempts.delete(eventId);
  }

  close(): void {
    this.closedByUser = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
  }
}
