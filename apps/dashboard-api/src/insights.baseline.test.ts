import { describe, it, expect } from "vitest";
import { MIN_BASELINE_SAMPLES, buildBaseline } from "@rtanalytics/shared-types";
import { RANGE_WINDOW } from "./insights.js";

/**
 * Guards the coupling between how much history a caller asks for and how much
 * the baseline requires before it will commit to an opinion.
 *
 * This exists because getting it wrong is invisible. When the caller supplies
 * fewer windows than MIN_BASELINE_SAMPLES, every baseline silently reports
 * `reliable: false`, every comparison insight quietly stops firing, and the
 * panel simply looks like a quiet week — no error, no warning, nothing to
 * debug. The unit tests for `buildBaseline` all passed while this was broken,
 * because they called it directly with enough samples instead of going through
 * the code that decides how many to fetch.
 */
describe("insight ranges vs the baseline threshold", () => {
  it("asks for enough history wherever it intends to compare", () => {
    // 24h and 7d compare against the same window on previous weeks, which is
    // well inside the 90-day retention, so they must clear the threshold.
    for (const range of ["24h", "7d"] as const) {
      const { history } = RANGE_WINDOW[range];
      expect(
        history,
        `${range} asks for ${history} windows but a baseline needs ${MIN_BASELINE_SAMPLES}`
      ).toBeGreaterThanOrEqual(MIN_BASELINE_SAMPLES);
    }
  });

  it("produces a reliable baseline for those ranges", () => {
    // The real check: what the caller asks for actually yields an opinion.
    for (const range of ["24h", "7d"] as const) {
      const history = new Array(RANGE_WINDOW[range].history).fill(10);
      expect(buildBaseline(history).reliable, range).toBe(true);
    }
  });

  it("keeps 30d below the threshold on purpose", () => {
    // Six 30-day windows would reach 180 days, far past retention, and the
    // empty windows would come back as zeros — making ordinary traffic look
    // like a permanent spike. Reporting nothing is the honest outcome, so this
    // asserts the intent rather than letting a later edit "fix" it.
    const { history } = RANGE_WINDOW["30d"];
    expect(history).toBeLessThan(MIN_BASELINE_SAMPLES);
    expect(buildBaseline(new Array(history).fill(10)).reliable).toBe(false);
  });

  it("never shifts a window by less than its own length", () => {
    // Overlapping windows would compare a period against itself, which makes
    // any change look smaller than it is.
    const lengthDays: Record<string, number> = { "24 hours": 1, "7 days": 7, "30 days": 30 };
    const shiftDays: Record<string, number> = { "7 days": 7, "30 days": 30 };
    for (const range of ["24h", "7d", "30d"] as const) {
      const { length, shift } = RANGE_WINDOW[range];
      expect(shiftDays[shift], `${range} shift`).toBeGreaterThanOrEqual(lengthDays[length]!);
    }
  });
});
