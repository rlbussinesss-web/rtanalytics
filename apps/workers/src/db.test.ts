import { describe, it, expect } from "vitest";
import { dedupeRows } from "./db.js";

/**
 * Redeliveries are normal in an at-least-once pipeline, so this is the guard
 * that stops one event being counted twice. Every case here maps to something
 * that actually happens: a redelivery landing in the same flush, two genuinely
 * different events sharing a timestamp, and rows arriving without an id.
 */
describe("dedupeRows", () => {
  const at = (ms: number) => new Date(ms);

  it("collapses a redelivery of the same event", () => {
    const rows = [
      { eventId: "a", time: at(1000) },
      { eventId: "a", time: at(1000) },
      { eventId: "b", time: at(1000) },
    ];
    expect(dedupeRows(rows).map((r) => r.eventId)).toEqual(["a", "b"]);
  });

  it("keeps distinct events that share a timestamp", () => {
    // A click and a scroll can be captured in the same millisecond.
    const rows = [
      { eventId: "a", time: at(1000) },
      { eventId: "b", time: at(1000) },
    ];
    expect(dedupeRows(rows)).toHaveLength(2);
  });

  it("keeps the same id at a different timestamp", () => {
    // Different times mean different rows under the (event_id, time) key.
    const rows = [
      { eventId: "a", time: at(1000) },
      { eventId: "a", time: at(2000) },
    ];
    expect(dedupeRows(rows)).toHaveLength(2);
  });

  it("passes through rows with no event id rather than merging them", () => {
    // Without an id they can't be identified, and merging would drop real data.
    const rows = [
      { eventId: "", time: at(1000) },
      { eventId: "", time: at(1000) },
    ];
    expect(dedupeRows(rows)).toHaveLength(2);
  });

  it("keeps the first occurrence and preserves order", () => {
    const rows = [
      { eventId: "a", time: at(1), tag: "first" },
      { eventId: "b", time: at(2), tag: "second" },
      { eventId: "a", time: at(1), tag: "duplicate" },
    ];
    expect(dedupeRows(rows).map((r) => r.tag)).toEqual(["first", "second"]);
  });

  it("handles an empty batch", () => {
    expect(dedupeRows([])).toEqual([]);
  });
});
