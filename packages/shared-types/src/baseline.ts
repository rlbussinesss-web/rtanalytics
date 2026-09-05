/**
 * Robust baselines for "is this number normal?".
 *
 * Traffic is seasonal: 40 visitors at 8pm can be a quiet evening while 40
 * visitors at 4am is a spike worth waking up for. Comparing a window against
 * the one immediately before it ignores that entirely, which is how alerting
 * systems end up crying wolf every night.
 *
 * The statistics here are deliberately robust rather than textbook:
 *  - median and MAD instead of mean and standard deviation, because one viral
 *    hour would drag a mean-based baseline up for days and then suppress every
 *    real alert afterwards;
 *  - every function states how much evidence it had, so callers can refuse to
 *    judge instead of inventing confidence they do not have.
 */

/** Middle value of a sample. Returns 0 for an empty sample. */
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

/**
 * Median absolute deviation — a spread measure that a single outlier cannot
 * inflate, unlike standard deviation.
 */
export function mad(values: number[]): number {
  if (values.length === 0) return 0;
  const m = median(values);
  return median(values.map((v) => Math.abs(v - m)));
}

export interface Baseline {
  /** Typical value for this slot. */
  expected: number;
  /** Robust spread around it. */
  spread: number;
  /** How many historical observations backed this. */
  samples: number;
  /** False when there was too little history to claim a normal level. */
  reliable: boolean;
}

/** Fewer observations than this and "normal" is a guess, not a baseline. */
export const MIN_BASELINE_SAMPLES = 5;

export function buildBaseline(history: number[]): Baseline {
  const samples = history.length;
  return {
    expected: median(history),
    spread: mad(history),
    samples,
    reliable: samples >= MIN_BASELINE_SAMPLES,
  };
}

/**
 * How unusual `value` is, in robust standard deviations.
 *
 * The 1.4826 factor rescales MAD so the result is comparable to a normal
 * z-score. The floor on spread stops a perfectly flat history (spread 0) from
 * turning any tiny movement into an infinite score.
 */
export function robustZ(value: number, baseline: Baseline): number {
  const scale = Math.max(baseline.spread * 1.4826, 0.5);
  return (value - baseline.expected) / scale;
}

/**
 * Decides whether a live reading is a genuine traffic spike.
 *
 * Two conditions must both hold, which is what keeps this useful at low volume
 * without becoming noise at high volume:
 *  - an absolute floor, because "3 people instead of the usual 1" is
 *    statistically dramatic and practically meaningless;
 *  - a relative jump over the seasonal norm, so a busy-but-ordinary evening
 *    does not alert every single night.
 *
 * When there is not enough history to know what is normal, the absolute floor
 * alone decides — a new site should still be able to tell you traffic arrived.
 */
export interface SpikeVerdict {
  isSpike: boolean;
  value: number;
  expected: number;
  /** Multiple of the normal level, when a baseline was available. */
  ratio: number | null;
}

export function detectSpike(
  value: number,
  baseline: Baseline,
  opts: { minVisitors: number; multiplier: number }
): SpikeVerdict {
  const meetsFloor = value >= opts.minVisitors;

  if (!baseline.reliable) {
    return { isSpike: meetsFloor, value, expected: baseline.expected, ratio: null };
  }

  // Guard against a zero baseline making every arrival an infinite ratio.
  const denom = Math.max(baseline.expected, 1);
  const ratio = value / denom;
  return {
    isSpike: meetsFloor && ratio >= opts.multiplier,
    value,
    expected: baseline.expected,
    ratio,
  };
}

/**
 * The slot a timestamp belongs to, for seasonal comparison.
 *
 * Hour of week rather than hour of day: Saturday 9pm and Tuesday 9pm are
 * different animals for a consumer offer, and lumping them together blunts
 * both the baseline and every alert built on it.
 */
export function hourOfWeek(date: Date): number {
  return date.getDay() * 24 + date.getHours();
}
