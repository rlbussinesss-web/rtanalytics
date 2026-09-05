import { describe, it, expect, beforeEach, vi } from "vitest";
import { EventQueue } from "./queue.js";
import type { AnyTrackerEvent } from "./types.js";

/**
 * The queue is what stands between a flaky network and a lost event. These
 * tests pin the behaviour that makes metrics trustworthy: an event survives
 * until the server acknowledges it by id, and it survives a page reload.
 */

/** Minimal in-memory localStorage, matching what the queue actually uses. */
function fakeStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    get size() {
      return map.size;
    },
  };
}

const evt = (id: string): AnyTrackerEvent =>
  ({
    schemaVersion: 1,
    eventId: id,
    siteId: "s",
    visitorId: "v",
    sessionId: "sess",
    eventType: "pageview",
    timestamp: 1,
    path: "/",
    payload: {},
  }) as unknown as AnyTrackerEvent;

describe("EventQueue", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", fakeStorage());
  });

  it("keeps events until they are acknowledged", () => {
    const q = new EventQueue();
    q.push(evt("a"));
    q.push(evt("b"));
    expect(q.size).toBe(2);

    q.ack("a");
    expect(q.peekAll().map((e) => e.eventId)).toEqual(["b"]);
  });

  it("acknowledges out of order", () => {
    // Acks are per-event replies and can arrive in any order.
    const q = new EventQueue();
    q.push(evt("a"));
    q.push(evt("b"));
    q.push(evt("c"));

    q.ack("b");
    expect(q.peekAll().map((e) => e.eventId)).toEqual(["a", "c"]);
  });

  it("ignores an ack for an unknown event", () => {
    const q = new EventQueue();
    q.push(evt("a"));
    q.ack("does-not-exist");
    expect(q.size).toBe(1);
  });

  it("survives a page reload while the socket was down", () => {
    const storage = fakeStorage();
    vi.stubGlobal("localStorage", storage);

    const before = new EventQueue();
    before.push(evt("a"));
    before.push(evt("b"));

    // A reload builds a fresh queue from the same storage.
    const after = new EventQueue();
    expect(after.peekAll().map((e) => e.eventId)).toEqual(["a", "b"]);
  });

  it("drops the oldest events instead of growing without bound", () => {
    const q = new EventQueue();
    for (let i = 0; i < 520; i++) q.push(evt(`e${i}`));

    expect(q.size).toBe(500);
    // The newest are the ones worth keeping.
    expect(q.peekAll()[499]!.eventId).toBe("e519");
  });

  it("keeps working when storage is unavailable", () => {
    // Private mode / disabled storage: the in-memory path must still work.
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    });

    const q = new EventQueue();
    expect(() => q.push(evt("a"))).not.toThrow();
    expect(q.size).toBe(1);
  });
});
