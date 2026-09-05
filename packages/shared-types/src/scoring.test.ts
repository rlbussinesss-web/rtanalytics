import { describe, it, expect } from "vitest";
import {
  fitWeights,
  featureKeys,
  scoreSession,
  explainScore,
  sigmoid,
  logit,
  isCheckoutPath,
  MIN_TRAINING_SESSIONS,
  type SessionFeatures,
} from "./scoring.js";

const base = (over: Partial<SessionFeatures> = {}): SessionFeatures => ({
  reachedCheckout: false,
  pageviews: 1,
  clicks: 0,
  maxScroll: 0,
  ...over,
});

/** Builds per-key counts where every key shares the same rate. */
function counts(entries: [string, number, number][]) {
  const m = new Map<string, { sessions: number; conversions: number }>();
  for (const [key, sessions, conversions] of entries) m.set(key, { sessions, conversions });
  return m;
}

describe("featureKeys", () => {
  it("produces one key per feature, stably ordered", () => {
    const keys = featureKeys(base());
    expect(keys).toHaveLength(7);
    expect(featureKeys(base())).toEqual(keys);
  });

  it("buckets counts instead of using raw numbers", () => {
    // 7 vs 8 pageviews carries no signal; 1 vs 5 carries a lot.
    const a = featureKeys(base({ pageviews: 7 })).find((k) => k.startsWith("pageviews:"));
    const b = featureKeys(base({ pageviews: 8 })).find((k) => k.startsWith("pageviews:"));
    const c = featureKeys(base({ pageviews: 1 })).find((k) => k.startsWith("pageviews:"));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it("normalises case and blanks so the same visitor maps to one key", () => {
    expect(featureKeys(base({ source: "Instagram" }))).toContain("source:instagram");
    expect(featureKeys(base({ source: "  " }))).toContain("source:(direto)");
    expect(featureKeys(base({ source: undefined }))).toContain("source:(direto)");
  });
});

describe("isCheckoutPath", () => {
  it.each(["/pagamento", "/checkout/step-2", "/carrinho", "/cart", "/recarga-pay/payment"])(
    "recognises %s",
    (p) => expect(isCheckoutPath(p)).toBe(true)
  );

  it.each(["/", "/produto/kit", "/blog/pagamentos-online-guia", "/cartao-de-credito"])(
    "leaves %s alone",
    (p) => {
      // A loose match here would flag an article about payments as a checkout
      // step, inflating both the score and the model's training data.
      expect(isCheckoutPath(p)).toBe(false);
    }
  );

  it.each(["/pagamentos", "/carrinhos"])("still accepts the plural %s", (p) => {
    expect(isCheckoutPath(p)).toBe(true);
  });
});

describe("fitWeights", () => {
  it("refuses to train on too little history", () => {
    const model = fitWeights({ sessions: 50, conversions: 5 }, counts([["source:x", 50, 5]]));
    expect(model.ready).toBe(false);
    expect(model.weights).toEqual({});
  });

  it("refuses to train when almost nobody converted", () => {
    // Plenty of sessions but no signal to learn from.
    const model = fitWeights({ sessions: 5000, conversions: 2 }, counts([["source:x", 5000, 2]]));
    expect(model.ready).toBe(false);
  });

  it("trains once there is enough evidence", () => {
    const model = fitWeights(
      { sessions: MIN_TRAINING_SESSIONS, conversions: 20 },
      counts([["source:x", 200, 20]])
    );
    expect(model.ready).toBe(true);
    expect(model.baseRate).toBeCloseTo(0.1);
  });

  it("gives a strong category a positive weight and a weak one a negative weight", () => {
    const model = fitWeights(
      { sessions: 1000, conversions: 100 }, // 10% base
      counts([
        ["checkout:yes", 200, 80], // 40% — much better
        ["checkout:no", 800, 20], // 2.5% — much worse
      ])
    );
    expect(model.weights["checkout:yes"]!).toBeGreaterThan(0);
    expect(model.weights["checkout:no"]!).toBeLessThan(0);
  });

  it("shrinks a tiny sample toward the site average", () => {
    // 2 sessions and 1 conversion is not a 50% converter.
    const model = fitWeights(
      { sessions: 1000, conversions: 100 },
      counts([
        ["source:lucky", 2, 1],
        ["source:proven", 400, 200],
      ])
    );
    expect(model.weights["source:lucky"]!).toBeLessThan(model.weights["source:proven"]!);
    // Barely moved off the base rate at all.
    expect(Math.abs(model.weights["source:lucky"]!)).toBeLessThan(0.5);
  });

  it("caps any single feature so one signal cannot dominate", () => {
    const model = fitWeights(
      { sessions: 1000, conversions: 100 },
      counts([["source:perfect", 500, 500]])
    );
    expect(model.weights["source:perfect"]!).toBeLessThanOrEqual(2);
  });
});

describe("scoreSession", () => {
  const trained = fitWeights(
    { sessions: 1000, conversions: 100 },
    counts([
      ["checkout:yes", 200, 80],
      ["checkout:no", 800, 20],
    ])
  );

  it("falls back to the site average when the model is not ready", () => {
    const cold = fitWeights({ sessions: 10, conversions: 1 }, counts([]));
    expect(scoreSession(cold, base())).toBe(cold.baseRate);
  });

  it("scores a checkout visitor above one who never got there", () => {
    const atCheckout = scoreSession(trained, base({ reachedCheckout: true }));
    const browsing = scoreSession(trained, base({ reachedCheckout: false }));
    expect(atCheckout).toBeGreaterThan(browsing);
  });

  it("always returns a probability", () => {
    for (const f of [base(), base({ reachedCheckout: true, clicks: 50, maxScroll: 100 })]) {
      const s = scoreSession(trained, f);
      expect(s).toBeGreaterThan(0);
      expect(s).toBeLessThan(1);
    }
  });

  it("treats an unseen category as neutral rather than as a penalty", () => {
    // A brand new campaign should start at the site average, not at zero.
    const unseen = scoreSession(trained, base({ source: "campanha-nova-de-hoje" }));
    const noSource = scoreSession(trained, base());
    expect(unseen).toBeCloseTo(noSource, 10);
  });
});

describe("explainScore", () => {
  const trained = fitWeights(
    { sessions: 1000, conversions: 100 },
    counts([
      ["checkout:yes", 200, 80],
      ["source:instagram", 300, 60],
    ])
  );

  it("names the signals that moved the score, strongest first", () => {
    const reasons = explainScore(trained, base({ reachedCheckout: true, source: "instagram" }));
    expect(reasons.length).toBeGreaterThan(0);
    const weights = reasons.map((r) => Math.abs(r.weight));
    expect([...weights].sort((a, b) => b - a)).toEqual(weights);
  });

  it("explains nothing when the model is not ready", () => {
    const cold = fitWeights({ sessions: 5, conversions: 0 }, counts([]));
    expect(explainScore(cold, base())).toEqual([]);
  });
});

describe("sigmoid/logit", () => {
  it("round-trips a probability", () => {
    expect(sigmoid(logit(0.3))).toBeCloseTo(0.3);
  });

  it("does not blow up at the extremes", () => {
    expect(Number.isFinite(logit(0))).toBe(true);
    expect(Number.isFinite(logit(1))).toBe(true);
  });
});
