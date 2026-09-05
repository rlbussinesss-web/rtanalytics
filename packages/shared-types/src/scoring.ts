/**
 * Conversion propensity: shared feature extraction and scoring.
 *
 * This module is deliberately shared between the API (which trains the model
 * from historical sessions) and the dashboard (which scores live visitors as
 * their events arrive). Feature extraction living in one place is the whole
 * point: if training bucketed "4 pageviews" differently from scoring, every
 * number the model produced would be quietly wrong — the classic
 * training/serving skew bug, and one that never announces itself.
 *
 * The model is additive log-odds over categorical features (naive Bayes).
 * That choice is on purpose rather than something heavier:
 *  - it trains in one SQL pass plus a little arithmetic, with no dependency,
 *    no training infrastructure and no external service;
 *  - it stays explainable — every score decomposes into the exact signals that
 *    produced it, so the dashboard can say *why* someone looks likely to buy;
 *  - it degrades honestly on small data, which is the normal case for a site
 *    that just started running traffic.
 */

export interface SessionFeatures {
  /** utm_source, or "(direto)" when the visitor arrived with no campaign. */
  source?: string;
  device?: string;
  country?: string;
  /** Whether the session ever reached a checkout/cart style path. */
  reachedCheckout: boolean;
  pageviews: number;
  clicks: number;
  /** Deepest scroll reached, 0-100. */
  maxScroll: number;
}

/** A trained model: base rate plus a log-odds weight per feature value. */
export interface PropensityModel {
  /**
   * False when the site has not produced enough history for the score to mean
   * anything. Consumers must show nothing rather than invent a number.
   */
  ready: boolean;
  /** Log-odds of the site's overall conversion rate. */
  baseLogOdds: number;
  /** Log-odds adjustment per feature key, relative to the base rate. */
  weights: Record<string, number>;
  /** Sessions the model was fitted on. */
  trainedOn: number;
  conversions: number;
  baseRate: number;
}

/** Below this, percentages are noise and a model would be superstition. */
export const MIN_TRAINING_SESSIONS = 200;
export const MIN_TRAINING_CONVERSIONS = 10;

/**
 * Pulls a category's rate toward the site average in proportion to how little
 * evidence supports it. A source with 2 sessions and 1 conversion is not a 50%
 * converter; this is what stops the model betting the farm on three visits.
 */
export const SMOOTHING = 20;

/** Caps how far one feature can move a score, so no single signal dominates. */
export const MAX_WEIGHT = 2;

/**
 * Checkout keywords as a whole path segment.
 *
 * The boundary matters: a loose match flags "/blog/pagamentos-online-guia" as a
 * checkout step, which both inflates propensity scores and corrupts the
 * "reached checkout" feature the model learns from. The keyword must end the
 * segment, so plurals are allowed but longer words are not.
 *
 * Exported as a source string because the training query needs the identical
 * pattern in SQL — two hand-written copies would drift, and a feature that
 * means one thing at training time and another at scoring time is worse than
 * no feature at all.
 */
export const CHECKOUT_PATH_PATTERN =
  "(^|/)(pagamentos?|checkout|carrinhos?|cart|payments?)([/?#]|$)";

const CHECKOUT_PATH = new RegExp(CHECKOUT_PATH_PATTERN, "i");

/** True when a path looks like a checkout/cart step. */
export function isCheckoutPath(path: string): boolean {
  return CHECKOUT_PATH.test(path);
}

function norm(value: string | undefined, fallback: string): string {
  const v = (value ?? "").trim().toLowerCase();
  return v === "" ? fallback : v.slice(0, 60);
}

function bucket(value: number, edges: number[]): string {
  for (let i = 0; i < edges.length; i++) {
    if (value <= edges[i]!) return `<=${edges[i]}`;
  }
  return `>${edges[edges.length - 1]}`;
}

/**
 * Turns a session into the categorical keys the model is indexed by.
 *
 * Continuous counts are bucketed rather than used raw: the difference between
 * 7 and 8 pageviews carries no signal, while the difference between 1 and 5
 * carries a lot, and buckets keep every category populated enough to estimate.
 */
export function featureKeys(f: SessionFeatures): string[] {
  return [
    `source:${norm(f.source, "(direto)")}`,
    `device:${norm(f.device, "(desconhecido)")}`,
    `country:${norm(f.country, "(desconhecido)")}`,
    `checkout:${f.reachedCheckout ? "yes" : "no"}`,
    `pageviews:${bucket(f.pageviews, [1, 3, 6])}`,
    `clicks:${bucket(f.clicks, [0, 4, 10])}`,
    `scroll:${bucket(f.maxScroll, [25, 50, 75])}`,
  ];
}

export function logit(p: number): number {
  const clamped = Math.min(0.999999, Math.max(0.000001, p));
  return Math.log(clamped / (1 - clamped));
}

export function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/**
 * Probability that a session converts, given the model.
 *
 * A feature value the model has never seen contributes nothing rather than
 * being penalised — absence of evidence is not evidence of absence, and a new
 * campaign should start at the site average instead of at zero.
 */
export function scoreSession(model: PropensityModel, features: SessionFeatures): number {
  if (!model.ready) return model.baseRate;
  let logOdds = model.baseLogOdds;
  for (const key of featureKeys(features)) {
    logOdds += model.weights[key] ?? 0;
  }
  return sigmoid(logOdds);
}

/**
 * The signals that moved a score the most, strongest first.
 *
 * Returned alongside the score so the interface can explain itself: "likely to
 * buy *because* they reached checkout and came from this campaign" is
 * actionable, while a bare 87% is a number to distrust.
 */
export function explainScore(
  model: PropensityModel,
  features: SessionFeatures,
  limit = 3
): { key: string; weight: number }[] {
  if (!model.ready) return [];
  return featureKeys(features)
    .map((key) => ({ key, weight: model.weights[key] ?? 0 }))
    .filter((w) => Math.abs(w.weight) > 0.05)
    .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight))
    .slice(0, limit);
}

/**
 * Fits weights from per-category counts.
 *
 * Kept pure and separate from any database so it can be tested directly and so
 * the API layer only has to supply counts.
 */
export function fitWeights(
  totals: { sessions: number; conversions: number },
  perKey: Map<string, { sessions: number; conversions: number }>
): PropensityModel {
  const baseRate = totals.sessions > 0 ? totals.conversions / totals.sessions : 0;
  const ready =
    totals.sessions >= MIN_TRAINING_SESSIONS && totals.conversions >= MIN_TRAINING_CONVERSIONS;

  const baseLogOdds = logit(baseRate);
  const weights: Record<string, number> = {};

  if (ready) {
    for (const [key, c] of perKey) {
      // Shrink toward the site average by the amount of evidence available.
      const smoothed = (c.conversions + SMOOTHING * baseRate) / (c.sessions + SMOOTHING);
      const w = logit(smoothed) - baseLogOdds;
      weights[key] = Math.max(-MAX_WEIGHT, Math.min(MAX_WEIGHT, w));
    }
  }

  return {
    ready,
    baseLogOdds,
    weights,
    trainedOn: totals.sessions,
    conversions: totals.conversions,
    baseRate,
  };
}
