import { query } from "./db.js";
import type { RangeKey } from "./metrics.js";

/**
 * Simplified checkout abandonment report.
 *
 * For paid-traffic operators the only question that matters is: how many
 * people reached checkout, how many bought, and at which step did the rest
 * get stuck? The old block-level "objection" analysis was technically
 * interesting but operationally useless — you can't fix a CSS block, you
 * fix a funnel step.
 *
 * Steps are detected by common checkout URL patterns. Each step counts
 * sessions that visited it; "dropped here" = visited this step but never
 * reached the next one (and never converted).
 */

const RANGE_INTERVAL: Record<RangeKey, string> = {
  "24h": "24 hours",
  "7d": "7 days",
  "30d": "30 days",
};

/** Ordered funnel steps: regex pattern → human label. A session is "in" a
 * step if any of its pageview paths match the pattern. Steps are checked in
 * order; a session's deepest matched step is where it got to. */
const FUNNEL_STEPS: { pattern: RegExp; step: string; label: string }[] = [
  { pattern: /\/(carrinho|cart|basket)/i, step: "cart", label: "Carrinho" },
  { pattern: /\/(checkout|informacoes|informations?|dados|contato|contact|shipping|frete|entrega)/i, step: "info", label: "Informações / Frete" },
  { pattern: /\/(pagamento|payment|pay|pix|boleto|card|credit)/i, step: "payment", label: "Pagamento" },
  { pattern: /\/(obrigado|thank|success|confirmacao|confirmation|pedido-realizado)/i, step: "thanks", label: "Confirmação" },
];

export interface FunnelStep {
  step: string;
  label: string;
  /** Sessions that visited this step. */
  sessions: number;
  /** Sessions whose deepest step was this one (and who didn't convert). */
  droppedHere: number;
  /** droppedHere / sessions for this step. */
  dropRate: number;
  /** A few session ids to watch as evidence. */
  sampleSessions: string[];
}

export interface CheckoutReport {
  range: RangeKey;
  totalSessions: number;
  reachedCheckout: number;
  converted: number;
  abandoned: number;
  abandonmentRate: number;
  steps: FunnelStep[];
  enoughData: boolean;
}

interface SessionPath {
  session_id: string;
  path: string;
}

interface ConversionRow {
  session_id: string;
}

export async function computeAutopsy(siteId: string, range: RangeKey): Promise<CheckoutReport> {
  const interval = RANGE_INTERVAL[range];

  const [allPaths, conversions, totals] = await Promise.all([
    // Every pageview path per session in the window.
    query<SessionPath>(
      `SELECT DISTINCT session_id, path
         FROM events
        WHERE site_id = $1
          AND is_bot IS NOT TRUE
          AND event_type = 'pageview'
          AND time >= now() - interval '${interval}'`,
      [siteId]
    ),
    // Sessions that converted.
    query<ConversionRow>(
      `SELECT DISTINCT session_id
         FROM events
        WHERE site_id = $1
          AND event_type = 'conversion'
          AND time >= now() - interval '${interval}'`,
      [siteId]
    ),
    // Totals for context.
    query<{ sessions: string; conversions: string }>(
      `SELECT count(DISTINCT session_id)::int AS sessions,
              count(DISTINCT session_id) FILTER (WHERE event_type = 'conversion')::int AS conversions
         FROM events
        WHERE site_id = $1 AND is_bot IS NOT TRUE
          AND time >= now() - interval '${interval}'`,
      [siteId]
    ),
  ]);

  const convertedSet = new Set(conversions.map((c) => c.session_id));
  const totalSessions = Number(totals[0]?.sessions ?? 0);
  const converted = Number(totals[0]?.conversions ?? 0);

  // Group paths by session.
  const pathsBySession = new Map<string, string[]>();
  for (const row of allPaths) {
    const list = pathsBySession.get(row.session_id) ?? [];
    list.push(row.path);
    pathsBySession.set(row.session_id, list);
  }

  // For each session, find the deepest funnel step it reached.
  // Step depth = index in FUNNEL_STEPS (higher = deeper).
  const sessionDeepest = new Map<string, number>(); // session_id → deepest step index
  const sessionsInStep = new Map<string, Set<string>>(); // step → set of session_ids that visited it
  const checkoutSessions = new Set<string>();

  for (const [sessionId, paths] of pathsBySession) {
    let deepest = -1;
    for (const p of paths) {
      for (let i = 0; i < FUNNEL_STEPS.length; i++) {
        const step = FUNNEL_STEPS[i]!;
        if (step.pattern.test(p)) {
          if (i > deepest) deepest = i;
          // Track that this session visited this step.
          const stepKey = step.step;
          if (!sessionsInStep.has(stepKey)) sessionsInStep.set(stepKey, new Set());
          sessionsInStep.get(stepKey)!.add(sessionId);
          // Any checkout-step visit counts as "reached checkout".
          if (i >= 0) checkoutSessions.add(sessionId);
        }
      }
    }
    if (deepest >= 0) sessionDeepest.set(sessionId, deepest);
  }

  const reachedCheckout = checkoutSessions.size;

  // Build per-step stats. "Dropped here" = sessions whose deepest step was
  // this one AND who did not convert.
  const steps: FunnelStep[] = FUNNEL_STEPS.map((def, idx) => {
    const visitors = sessionsInStep.get(def.step)?.size ?? 0;
    const droppedIds: string[] = [];
    for (const [sid, deepest] of sessionDeepest) {
      if (deepest === idx && !convertedSet.has(sid)) {
        droppedIds.push(sid);
      }
    }
    return {
      step: def.step,
      label: def.label,
      sessions: visitors,
      droppedHere: droppedIds.length,
      dropRate: visitors > 0 ? droppedIds.length / visitors : 0,
      sampleSessions: droppedIds.slice(0, 5),
    };
  });

  // Abandoned = reached checkout but didn't convert.
  const abandoned = [...checkoutSessions].filter((s) => !convertedSet.has(s)).length;
  const abandonmentRate = reachedCheckout > 0 ? abandoned / reachedCheckout : 0;

  return {
    range,
    totalSessions,
    reachedCheckout,
    converted,
    abandoned,
    abandonmentRate,
    steps: steps.filter((s) => s.sessions > 0),
    enoughData: reachedCheckout > 0,
  };
}