import { describe, it, expect } from "vitest";
import { change } from "./insights.js";

/**
 * `change` decides whether an insight is shown at all, so its edge cases are
 * the difference between a useful alert and a scary-looking lie. Dividing by a
 * zero baseline is the one that matters: "conversions went from 0 to 1" is not
 * an infinite improvement, it is no baseline at all.
 */
describe("change", () => {
  it("computes a relative increase", () => {
    expect(change(150, 100)).toBeCloseTo(0.5);
  });

  it("computes a relative decrease", () => {
    expect(change(50, 100)).toBeCloseTo(-0.5);
  });

  it("reports no change when the value held steady", () => {
    expect(change(100, 100)).toBe(0);
  });

  it("returns null when there is no baseline to compare against", () => {
    // Guards against rendering "+Infinity%" the first time anything happens.
    expect(change(5, 0)).toBeNull();
  });

  it("treats zero-to-zero as flat rather than unknown", () => {
    expect(change(0, 0)).toBe(0);
  });

  it("reports a total collapse as -100%", () => {
    expect(change(0, 80)).toBe(-1);
  });

  it("handles fractional rates, not just counts", () => {
    // Conversion rates are compared the same way as raw counts.
    expect(change(0.02, 0.04)).toBeCloseTo(-0.5);
  });
});
