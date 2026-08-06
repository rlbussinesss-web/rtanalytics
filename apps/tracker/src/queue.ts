import type { AnyTrackerEvent } from "./types";

const STORAGE_KEY = "__rta_event_queue";
const MAX_QUEUE_SIZE = 500;

/**
 * Local event queue: in-memory array as the fast path, with a localStorage
 * mirror as a fallback so events survive a page reload while the socket
 * was down. Not IndexedDB (per the plan, IndexedDB is the eventual choice
 * for the full replay pipeline) — localStorage is enough for small
 * JSON event envelopes in Phase 1.
 */
export class EventQueue {
  private queue: AnyTrackerEvent[] = [];

  constructor() {
    this.queue = this.loadFromStorage();
  }

  private loadFromStorage(): AnyTrackerEvent[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as AnyTrackerEvent[]) : [];
    } catch {
      return [];
    }
  }

  private persist(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.queue));
    } catch {
      /* storage unavailable/full; in-memory queue still works for this tab */
    }
  }

  push(event: AnyTrackerEvent): void {
    this.queue.push(event);
    if (this.queue.length > MAX_QUEUE_SIZE) {
      this.queue.splice(0, this.queue.length - MAX_QUEUE_SIZE);
    }
    this.persist();
  }

  peekAll(): AnyTrackerEvent[] {
    return [...this.queue];
  }

  /** Removes the given number of oldest events (after successful flush). */
  drop(count: number): void {
    this.queue.splice(0, count);
    this.persist();
  }

  get size(): number {
    return this.queue.length;
  }

  isEmpty(): boolean {
    return this.queue.length === 0;
  }
}
