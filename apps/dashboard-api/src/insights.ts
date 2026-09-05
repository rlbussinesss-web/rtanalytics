import { query } from "./db.js";
import type { RangeKey } from "./metrics.js";

/**
 * Automatic insights: what changed, and what is worth acting on.
 *
 * The dashboard already shows *what* the numbers are. This answers the harder
 * question a person actually asks — "is that good, and what changed?" — by
 * comparing the current window against the immediately preceding one of the
 * same length, plus a few pattern checks that surface a specific page or
 * source rather than a global average.
 *
 * Two rules keep it honest rather than noisy:
 *  - Nothing is reported below MIN_SESSIONS: with 3 sessions a "-50%" is one
 *    person changing their mind, not a trend.
 *  - Nothing is reported below MIN_CHANGE: small drifts are normal traffic.
 * Bot traffic is excluded everywhere, so a crawler wave can't fake a spike.
 */

const RANGE_INTERVAL: Record<RangeKey, string> = {
  "24h": "24 hours",
  "7d": "7 days",
  "30d": "30 days",
};

/** Below this many sessions in a window, percentage changes are noise. */
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
  visitors: number;
  pageviews: number;
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
  const interval = RANGE_INTERVAL[range];

  // Both windows in one pass: current is [now-interval, now), previous is the
  // equally long stretch right before it, so the comparison is like-for-like.
  const totalsRows = await query<{
    bucket: string;
    sessions: string;
    visitors: string;
    pageviews: string;
    conversions: string;
    errors: string;
    rage_sessions: string;
  }>(
    `SELECT
        CASE WHEN time >= now() - interval '${interval}' THEN 'cur' ELSE 'prev' END AS bucket,
        count(DISTINCT session_id)::int AS sessions,
        count(DISTINCT visitor_id)::int AS visitors,
        count(*) FILTER (WHERE event_type = 'pageview')::int AS pageviews,
        count(DISTINCT session_id) FILTER (WHERE event_type = 'conversion')::int AS conversions,
        count(*) FILTER (WHERE event_type = 'error')::int AS errors,
        count(DISTINCT session_id) FILTER (WHERE event_type = 'click' AND (payload->>'rage')::boolean)::int AS rage_sessions
      FROM events
      WHERE site_id = $1
        AND is_bot IS NOT TRUE
        AND time >= now() - interval '${interval}' - interval '${interval}'
      GROUP BY 1`,
    [siteId]
  );

  const pick = (bucket: string): WindowTotals => {
    const r = totalsRows.find((x) => x.bucket === bucket);
    return {
      sessions: Number(r?.sessions ?? 0),
      visitors: Number(r?.visitors ?? 0),
      pageviews: Number(r?.pageviews ?? 0),
      conversions: Number(r?.conversions ?? 0),
      errors: Number(r?.errors ?? 0),
      rageSessions: Number(r?.rage_sessions ?? 0),
    };
  };

  const cur = pick("cur");
  const prev = pick("prev");
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
            "eu passo a comparar com o período anterior e apontar o que mudou.",
        },
      ],
    };
  }

  // --- Traffic ---------------------------------------------------------
  const sessionsChange = change(cur.sessions, prev.sessions);
  if (sessionsChange !== null && Math.abs(sessionsChange) >= MIN_CHANGE && prev.sessions >= MIN_SESSIONS) {
    const up = sessionsChange > 0;
    insights.push({
      id: "sessions-change",
      severity: up ? "good" : "warn",
      change: sessionsChange,
      title: `Tráfego ${up ? "subiu" : "caiu"} ${pct(sessionsChange)}`,
      detail: `${cur.sessions} sessões contra ${prev.sessions} no período anterior.`,
    });
  }

  // --- Conversion ------------------------------------------------------
  const curRate = ratio(cur.conversions, cur.sessions);
  const prevRate = ratio(prev.conversions, prev.sessions);
  const rateChange = change(curRate, prevRate);
  if (rateChange !== null && Math.abs(rateChange) >= MIN_CHANGE && prev.sessions >= MIN_SESSIONS) {
    const up = rateChange > 0;
    insights.push({
      id: "conversion-rate-change",
      severity: up ? "good" : "bad",
      change: rateChange,
      title: `Taxa de conversão ${up ? "subiu" : "caiu"} ${pct(rateChange)}`,
      detail:
        `${(curRate * 100).toFixed(1)}% agora contra ${(prevRate * 100).toFixed(1)}% antes ` +
        `(${cur.conversions} de ${cur.sessions} sessões).`,
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

  // --- Frustration -----------------------------------------------------
  const curRageRate = ratio(cur.rageSessions, cur.sessions);
  const prevRageRate = ratio(prev.rageSessions, prev.sessions);
  const rageChange = change(curRageRate, prevRageRate);
  if (curRageRate > 0.05 && rageChange !== null && rageChange >= MIN_CHANGE) {
    insights.push({
      id: "rage-up",
      severity: "warn",
      change: rageChange,
      title: `Cliques de raiva subiram ${pct(rageChange)}`,
      detail: `${(curRageRate * 100).toFixed(0)}% das sessões tiveram cliques repetidos de irritação — algo parou de responder.`,
    });
  }

  const errorsChange = change(cur.errors, prev.errors);
  if (cur.errors > 0 && errorsChange !== null && errorsChange >= MIN_CHANGE) {
    insights.push({
      id: "errors-up",
      severity: "bad",
      change: errorsChange,
      title: `Erros de JavaScript subiram ${pct(errorsChange)}`,
      detail: `${cur.errors} erro(s) no período contra ${prev.errors} antes.`,
    });
  }

  // --- Worst page by frustration ---------------------------------------
  const [worstPage] = await query<{ path: string; clicks: string; rage: string }>(
    `SELECT path,
            count(*)::int AS clicks,
            count(*) FILTER (WHERE (payload->>'rage')::boolean)::int AS rage
       FROM events
      WHERE site_id = $1 AND is_bot IS NOT TRUE AND event_type = 'click'
        AND time >= now() - interval '${interval}'
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

  // --- Best converting source ------------------------------------------
  const [bestSource] = await query<{ label: string; sessions: string; conversions: string }>(
    `SELECT val AS label,
            count(*)::int AS sessions,
            count(*) FILTER (WHERE converted)::int AS conversions
       FROM (
         SELECT session_id,
                max(payload->>'utm_source') AS val,
                bool_or(event_type = 'conversion') AS converted
           FROM events
          WHERE site_id = $1 AND is_bot IS NOT TRUE AND time >= now() - interval '${interval}'
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
      detail: "Os números estão em linha com o período anterior — nada fora do normal para apontar.",
    });
  }

  return { range, enoughData: true, insights };
}
