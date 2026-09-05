import { describe, it, expect } from "vitest";
import {
  median,
  mad,
  buildBaseline,
  robustZ,
  detectSpike,
  hourOfWeek,
  MIN_BASELINE_SAMPLES,
} from "./baseline.js";

describe("median / mad", () => {
  it("takes the middle of an odd sample", () => {
    expect(median([3, 1, 2])).toBe(2);
  });

  it("averages the middle pair of an even sample", () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it("survives an empty sample", () => {
    expect(median([])).toBe(0);
    expect(mad([])).toBe(0);
  });

  it("ignores an outlier that would wreck a mean", () => {
    // One viral hour must not redefine "normal" for the following week.
    const ordinary = [10, 11, 9, 10, 12];
    const withSpike = [...ordinary, 5000];
    expect(median(withSpike)).toBeCloseTo(10.5, 1);
    expect(median(withSpike)).toBeLessThan(20);
  });
});

describe("buildBaseline", () => {
  it("refuses to call itself reliable on thin history", () => {
    const b = buildBaseline([10, 12]);
    expect(b.reliable).toBe(false);
    expect(b.samples).toBe(2);
  });

  it("becomes reliable once enough slots have been observed", () => {
    const b = buildBaseline(new Array(MIN_BASELINE_SAMPLES).fill(10));
    expect(b.reliable).toBe(true);
    expect(b.expected).toBe(10);
  });
});

describe("robustZ", () => {
  it("scores a value at the baseline as zero", () => {
    expect(robustZ(10, buildBaseline([10, 10, 10, 10, 10]))).toBe(0);
  });

  it("does not divide by zero on a perfectly flat history", () => {
    // A flat baseline has spread 0; without a floor this would be Infinity.
    const z = robustZ(11, buildBaseline([10, 10, 10, 10, 10]));
    expect(Number.isFinite(z)).toBe(true);
  });

  it("grows with distance from normal", () => {
    const b = buildBaseline([10, 12, 8, 11, 9]);
    expect(robustZ(30, b)).toBeGreaterThan(robustZ(15, b));
  });
});

describe("detectSpike", () => {
  const opts = { minVisitors: 5, multiplier: 2 };

  it("ignores a statistically dramatic but practically meaningless jump", () => {
    // 3 people when 1 is normal is 3x, and still nobody cares.
    const quiet = buildBaseline([1, 1, 1, 1, 1]);
    expect(detectSpike(3, quiet, opts).isSpike).toBe(false);
  });

  it("fires when traffic is both meaningful and well above normal", () => {
    const quiet = buildBaseline([2, 1, 2, 3, 2]);
    const verdict = detectSpike(20, quiet, opts);
    expect(verdict.isSpike).toBe(true);
    expect(verdict.ratio).toBeGreaterThan(2);
  });

  it("stays quiet on a busy but ordinary evening", () => {
    // 30 visitors is a lot in absolute terms, but it is simply this hour's norm.
    const busy = buildBaseline([28, 30, 32, 29, 31]);
    expect(detectSpike(30, busy, opts).isSpike).toBe(false);
  });

  it("falls back to the absolute floor when normal is still unknown", () => {
    // A brand new site should still be able to say "traffic arrived".
    const unknown = buildBaseline([]);
    expect(detectSpike(9, unknown, opts).isSpike).toBe(true);
    expect(detectSpike(2, unknown, opts).isSpike).toBe(false);
    expect(detectSpike(9, unknown, opts).ratio).toBeNull();
  });

  it("does not treat any arrival as infinite when the norm is zero", () => {
    const dead = buildBaseline([0, 0, 0, 0, 0]);
    const verdict = detectSpike(6, dead, opts);
    expect(Number.isFinite(verdict.ratio!)).toBe(true);
    expect(verdict.isSpike).toBe(true);
  });
});

describe("hourOfWeek", () => {
  it("separates the same hour on different weekdays", () => {
    const saturday = new Date(2026, 8, 5, 21, 0, 0);
    const tuesday = new Date(2026, 8, 8, 21, 0, 0);
    expect(hourOfWeek(saturday)).not.toBe(hourOfWeek(tuesday));
  });

  it("matches the same hour a week apart", () => {
    const a = new Date(2026, 8, 5, 21, 30, 0);
    const b = new Date(2026, 8, 12, 21, 5, 0);
    expect(hourOfWeek(a)).toBe(hourOfWeek(b));
  });

  it("stays inside the week", () => {
    for (const d of [new Date(2026, 8, 5, 0), new Date(2026, 8, 11, 23)]) {
      expect(hourOfWeek(d)).toBeGreaterThanOrEqual(0);
      expect(hourOfWeek(d)).toBeLessThan(168);
    }
  });
});
