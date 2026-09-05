import { query } from "./db.js";
import { buildBaseline, robustZ, type Baseline } from "@rtanalytics/shared-types";
import type { RangeKey } from "./metrics.js";

/**
 * Automatic insights: what changed, and what is worth acting on.
 *
 * The dashboard already shows *what* the numbers are. This answers the harder
 * question a person actually asks — "is that good, and what changed?".
 *
 * The comparison is seasonal rather than sequential. Comparing the last 24h
 * against the 24h before it treats Sunday night and Monday morning as the same
 * thing, which is how an alerting system ends up shouting every weekend. Each
 * window is instead compared against the *same window on previous weeks*, and
 * the "normal" level is a median rather than a mean so one viral day cannot
 * poison the baseline for a month afterwards.
 *
 * Two rules keep it honest rather than noisy:
 *  - nothing is reported below MIN_SESSIONS: with 3 sessions a "-50%" is one
 *    person changing their mind, not a trend;
 *  - nothing is reported below MIN_CHANGE, and never without a reliable
 *    baseline behind it.
 * Bot traffic is excluded everywhere, so a crawler wave cannot fake a spike.
 */

/**
 * Window length, how far back each comparison window sits, and how many of them
 * form the baseline.
 *
 * `history` must be at least MIN_BASELINE_SAMPLES for a comparison to ever be
 * published — a guard test enforces that, because getting it wrong disables
 * every comparison silently rather than failing loudly.
 *
 * The 30d range deliberately asks for fewer than the threshold: six 30-day
 * windows would reach 180 days, far past the 90-day retention, so most of them
 * would come back empty and a baseline of zeros would make ordinary traffic
 * look like a permanent spike. Asking for what cannot be answered honestly is
 * worse than reporting nothing, so the 30d range simply skips comparisons.
 */
export const RANGE_WINDOW: Record<RangeKey, { length: string; shift: string; history: number }> = {
  // A day is compared against the same weekday, not against yesterday.
  "24h": { length: "24 hours", shift: "7 days", history: 6 },
  "7d": { length: "7 days", shift: "7 days", history: 6 },
  "30d": { length: "30 days", shift: "30 days", history: 2 },
};

/** Below this many sessions, percentage changes are noise. */
const MIN_SESSIONS = 20;
/** Relative change that counts as a real move rather than normal drift. */
const MIN_CHANGE = 0.15;
/** A page needs this many clicks before its frustration rate means anything. */
const MIN_CLICKS_FOR_PAGE = 30;

export type InsightSeverity = "good" | "warn" | "bad" | "info";

export interface Insight {
  id: string;
  severity: InsightSeverity;
  title: string;
  detail: string;
  /** Relative change (0.25 = +25%), when the insight is a comparison. */
  change?: number;
}

export interface InsightsReport {
  range: RangeKey;
  /** False when the window is too small for comparisons to mean anything. */
  enoughData: boolean;
  insights: Insight[];
}

interface WindowTotals {
  sessions: number;
  conversions: number;
  errors: number;
  rageSessions: number;
}

const pct = (n: number) => `${(Math.abs(n) * 100).toFixed(0)}%`;
const ratio = (a: number, b: number) => (b > 0 ? a / b : 0);

/** Relative change from `before` to `after`; null when there is no baseline. */
export function change(after: number, before: number): number | null {
  if (before === 0) return after === 0 ? 0 : null;
  return (after - before) / before;
}

export async function computeInsights(siteId: string, range: RangeKey): Promise<InsightsReport> {
  const { length, shift, history: historyWindows } = RANGE_WINDOW[range];

  // Window 0 is now; window k is the same slot k shifts ago. One query covers
  // the current period and its whole seasonal history.
  const rows = await query<{
    k: string;
    sessions: string;
    conversions: string;
    errors: string;
    rage_sessions: string;
  }>(
    `SELECT k::int AS k,
            count(DISTINCT e.session_id)::int AS sessions,
            count(DISTINCT e.session_id) FILTER (WHERE e.event_type = 'conversion')::int AS conversions,
            count(*) FILTER (WHERE e.event_type = 'error')::int AS errors,
            count(DISTINCT e.session_id) FILTER (
              WHERE e.event_type = 'click' AND (e.payload->>'rage')::boolean
            )::int AS rage_sessions
       FROM generate_series(0, ${historyWindows}) AS k
       LEFT JOIN events e
         ON e.site_id = $1
        AND e.is_bot IS NOT TRUE
        AND e.time >= now() - (interval '${shift}' * k) - interval '${length}'
        AND e.time <  now() - (interval '${shift}' * k)
      GROUP BY k
      ORDER BY k`,
    [siteId]
  );

  const at = (k: number): WindowTotals => {
    const r = rows.find((x) => Number(x.k) === k);
    return {
      sessions: Number(r?.sessions ?? 0),
      conversions: Number(r?.conversions ?? 0),
      errors: Number(r?.errors ?? 0),
      rageSessions: Number(r?.rage_sessions ?? 0),
    };
  };

  const cur = at(0);
  const history: WindowTotals[] = [];
  for (let k = 1; k <= historyWindows; k++) history.push(at(k));

  const insights: Insight[] = [];

  if (cur.sessions < MIN_SESSIONS) {
    return {
      range,
      enoughData: false,
      insights: [
        {
          id: "low-volume",
          severity: "info",
          title: "Volume ainda baixo para comparar",
          detail:
            `Foram ${cur.sessions} sessão(ões) no período. A partir de ${MIN_SESSIONS} ` +
            "eu passo a comparar com as mesmas janelas de semanas anteriores e apontar o que mudou.",
        },
      ],
    };
  }

  // --- Traffic, against the seasonal norm --------------------------------
  const sessionsBaseline = buildBaseline(history.map((h) => h.sessions));
  const trafficChange = change(cur.sessions, sessionsBaseline.expected);
  if (
    sessionsBaseline.reliable &&
    trafficChange !== null &&
    Math.abs(trafficChange) >= MIN_CHANGE &&
    Math.abs(robustZ(cur.sessions, sessionsBaseline)) >= 1.5
  ) {
    const up = trafficChange > 0;
    insights.push({
      id: "sessions-change",
      severity: up ? "good" : "warn",
      change: trafficChange,
      title: `Tráfego ${up ? "acima" : "abaixo"} do normal em ${pct(trafficChange)}`,
      detail:
        `${cur.sessions} sessões, contra ${Math.round(sessionsBaseline.expected)} de costume ` +
        `neste mesmo período da semana.`,
    });
  }

  // --- Conversion --------------------------------------------------------
  const curRate = ratio(cur.conversions, cur.sessions);
  const historicalRates = history
    .filter((h) => h.sessions >= MIN_SESSIONS)
    .map((h) => ratio(h.conversions, h.sessions));
  const rateBaseline: Baseline = buildBaseline(historicalRates);
  const rateChange = change(curRate, rateBaseline.expected);

  if (rateBaseline.reliable && rateChange !== null && Math.abs(rateChange) >= MIN_CHANGE) {
    const up = rateChange > 0;
    insights.push({
      id: "conversion-rate-change",
      severity: up ? "good" : "bad",
      change: rateChange,
      title: `Taxa de conversão ${up ? "subiu" : "caiu"} ${pct(rateChange)}`,
      detail:
        `${(curRate * 100).toFixed(1)}% agora contra ${(rateBaseline.expected * 100).toFixed(1)}% ` +
        `de costume (${cur.conversions} de ${cur.sessions} sessões).`,
    });
  } else if (cur.conversions === 0) {
    insights.push({
      id: "no-conversions",
      severity: "bad",
      title: "Nenhuma conversão no período",
      detail:
        `${cur.sessions} sessões e nenhuma conversão registrada. ` +
        "Vale conferir se o disparo de conversão está ativo na página.",
    });
  }

  // --- Frustration -------------------------------------------------------
  const curRageRate = ratio(cur.rageSessions, cur.sessions);
  const rageBaseline = buildBaseline(
    history.filter((h) => h.sessions > 0).map((h) => ratio(h.rageSessions, h.sessions))
  );
  const rageChange = change(curRageRate, rageBaseline.expected);
  if (curRageRate > 0.05 && rageBaseline.reliable && rageChange !== null && rageChange >= MIN_CHANGE) {
    insights.push({
      id: "rage-up",
      severity: "warn",
      change: rageChange,
      title: `Cliques de raiva subiram ${pct(rageChange)}`,
      detail: `${(curRageRate * 100).toFixed(0)}% das sessões tiveram cliques repetidos de irritação — algo parou de responder.`,
    });
  }

  const errorsBaseline = buildBaseline(history.map((h) => h.errors));
  const errorsChange = change(cur.errors, errorsBaseline.expected);
  if (cur.errors > 0 && errorsBaseline.reliable && errorsChange !== null && errorsChange >= MIN_CHANGE) {
    insights.push({
      id: "errors-up",
      severity: "bad",
      change: errorsChange,
      title: `Erros de JavaScript acima do normal (${pct(errorsChange)})`,
      detail: `${cur.errors} erro(s) no período, contra ${Math.round(errorsBaseline.expected)} de costume.`,
    });
  }

  // --- Worst page by frustration -----------------------------------------
  const [worstPage] = await query<{ path: string; clicks: string; rage: string }>(
    `SELECT path,
            count(*)::int AS clicks,
            count(*) FILTER (WHERE (payload->>'rage')::boolean)::int AS rage
       FROM events
      WHERE site_id = $1 AND is_bot IS NOT TRUE AND event_type = 'click'
        AND time >= now() - interval '${length}'
      GROUP BY path
     HAVING count(*) >= ${MIN_CLICKS_FOR_PAGE}
        AND count(*) FILTER (WHERE (payload->>'rage')::boolean) > 0
      ORDER BY (count(*) FILTER (WHERE (payload->>'rage')::boolean))::float / count(*) DESC
      LIMIT 1`,
    [siteId]
  );
  if (worstPage) {
    const r = Number(worstPage.rage) / Number(worstPage.clicks);
    if (r >= 0.1) {
      insights.push({
        id: "worst-page-rage",
        severity: "warn",
        title: `${worstPage.path} concentra cliques de raiva`,
        detail:
          `${(r * 100).toFixed(0)}% dos cliques nessa página são de irritação ` +
          `(${worstPage.rage} de ${worstPage.clicks}). Vale assistir uma gravação dela.`,
      });
    }
  }

  // --- Best converting source --------------------------------------------
  const [bestSource] = await query<{ label: string; sessions: string; conversions: string }>(
    `SELECT val AS label,
            count(*)::int AS sessions,
            count(*) FILTER (WHERE converted)::int AS conversions
       FROM (
         SELECT session_id,
                max(payload->>'utm_source') AS val,
                bool_or(event_type = 'conversion') AS converted
           FROM events
          WHERE site_id = $1 AND is_bot IS NOT TRUE AND time >= now() - interval '${length}'
          GROUP BY session_id
       ) s
      WHERE val IS NOT NULL AND val <> ''
      GROUP BY val
     HAVING count(*) >= 10 AND count(*) FILTER (WHERE converted) > 0
      ORDER BY (count(*) FILTER (WHERE converted))::float / count(*) DESC
      LIMIT 1`,
    [siteId]
  );
  if (bestSource) {
    const srcRate = Number(bestSource.conversions) / Number(bestSource.sessions);
    if (curRate > 0 && srcRate > curRate * 1.3) {
      insights.push({
        id: "best-source",
        severity: "good",
        title: `${bestSource.label} converte acima da média`,
        detail:
          `${(srcRate * 100).toFixed(1)}% de conversão contra ${(curRate * 100).toFixed(1)}% do site inteiro ` +
          `(${bestSource.conversions} de ${bestSource.sessions} sessões). É onde a próxima verba rende mais.`,
      });
    }
  }

  if (insights.length === 0) {
    insights.push({
      id: "stable",
      severity: "info",
      title: "Sem mudanças relevantes",
      detail: "Os números estão em linha com o normal para este período — nada fora do padrão para apontar.",
    });
  }

  return { range, enoughData: true, insights };
}
