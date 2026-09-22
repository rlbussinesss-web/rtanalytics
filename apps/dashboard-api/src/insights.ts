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

  // --- Campaigns burning budget without converting -----------------------
  // Alerts when a campaign brings significant traffic but zero sales — the
  // exact "why am I not selling?" signal for paid traffic managers. Uses
  // utm_campaign as the grouping key since ad_click_id attribution is only
  // available on conversions (which by definition don't exist here).
  //
  // PERFORMANCE: replaced correlated NOT EXISTS subquery (O(n²) with many
  // campaigns) with a CTE + LEFT JOIN anti-join pattern. The converting
  // campaigns set is materialized once, then matched in a single pass.
  const MIN_SESSIONS_FOR_CAMPAIGN_ALERT = 50;
  const bleedingCampaigns = await query<{ campaign: string; sessions: string }>(
    `WITH converting AS (
        SELECT DISTINCT payload->>'utm_campaign' AS campaign
          FROM events
         WHERE site_id = $1
           AND is_bot IS NOT TRUE
           AND event_type = 'conversion'
           AND time >= now() - interval '${length}'
           AND payload->>'utm_campaign' IS NOT NULL
           AND payload->>'utm_campaign' <> ''
     ),
     campaign_traffic AS (
        SELECT payload->>'utm_campaign' AS campaign,
               count(DISTINCT session_id)::int AS sessions
          FROM events
         WHERE site_id = $1
           AND is_bot IS NOT TRUE
           AND event_type = 'pageview'
           AND payload->>'utm_campaign' IS NOT NULL
           AND payload->>'utm_campaign' <> ''
           AND time >= now() - interval '${length}'
         GROUP BY payload->>'utm_campaign'
        HAVING count(DISTINCT session_id) >= ${MIN_SESSIONS_FOR_CAMPAIGN_ALERT}
     )
     SELECT ct.campaign, ct.sessions
       FROM campaign_traffic ct
       LEFT JOIN converting c ON c.campaign = ct.campaign
      WHERE c.campaign IS NULL
      ORDER BY ct.sessions DESC
      LIMIT 3`,
    [siteId]
  );
  for (const bc of bleedingCampaigns) {
    insights.push({
      id: `campaign-no-sales-${bc.campaign}`,
      severity: "bad",
      title: `${bc.campaign}: ${bc.sessions} visitas e zero vendas`,
      detail:
        `Essa campanha trouxe ${bc.sessions} sessões no período mas nenhuma conversão registrada. ` +
        "Vale revisar a landing page, o público-alvo ou pausar para evitar desperdício de verba.",
    });
  }

  // --- Checkout friction: error + rage click after checkout step -----------
  // Sessions that hit an error AND a rage click on a checkout-like path are
  // almost certainly stuck on something broken. This is the "why aren't they
  // buying?" answer that a plain drop-off rate cannot give.
  //
  // SECURITY: checkout path keywords are matched via parameterized LIKE
  // clauses rather than a dynamically-built regex. Concatenating user-facing
  // strings into a regex pattern inside SQL would be an injection vector if
  // the keyword list ever became configurable or was read from external input.
  const frictionSessions = await query<{ session_id: string; path: string }>(
    `SELECT DISTINCT e.session_id, e.path
       FROM events e
      WHERE e.site_id = $1
        AND e.is_bot IS NOT TRUE
        AND e.time >= now() - interval '${length}'
        AND e.event_type IN ('error', 'click')
        AND (
          lower(e.path) LIKE '%checkout%'
          OR lower(e.path) LIKE '%pagamento%'
          OR lower(e.path) LIKE '%payment%'
          OR lower(e.path) LIKE '%cart%'
          OR lower(e.path) LIKE '%carrinho%'
          OR lower(e.path) LIKE '%finalizar%'
        )
      GROUP BY e.session_id, e.path
     HAVING count(*) FILTER (WHERE e.event_type = 'error') > 0
        AND count(*) FILTER (
              WHERE e.event_type = 'click' AND (e.payload->>'rage')::boolean
            ) > 0
      LIMIT 20`,
    [siteId]
  );
  if (frictionSessions.length >= 3) {
    const sampleIds = frictionSessions.slice(0, 3).map((r) => r.session_id);
    insights.push({
      id: "checkout-friction",
      severity: "bad",
      title: `${frictionSessions.length} sessões com erro + rage click no checkout`,
      detail:
        `Essas sessões tiveram erro JavaScript E cliques de irritação em páginas de pagamento/checkout. ` +
        "Algo está quebrando a compra. Assista aos replays para identificar a causa.",
    });
  }

  // --- Conversion speed by campaign --------------------------------------
  // Two campaigns with the same conversion rate can have completely different
  // cash-flow profiles: one converts in 2 minutes (Pix instantâneo), the other
  // takes 4 hours (boleto). For paid traffic managers this changes bidding,
  // remarketing windows and budget allocation. p50/p90 per utm_campaign.
  const conversionSpeeds = await query<{
    campaign: string;
    p50_min: string;
    p90_min: string;
    conversions: string;
  }>(
    `WITH conv AS (
        SELECT c.payload->>'utm_campaign' AS campaign,
               extract(epoch FROM c.time - pv.first_pv) / 60.0 AS delay_min
          FROM events c
          JOIN LATERAL (
            SELECT min(time) AS first_pv
              FROM events pv
             WHERE pv.site_id = c.site_id
               AND pv.session_id = c.session_id
               AND pv.event_type = 'pageview'
               AND pv.is_bot IS NOT TRUE
               -- PERFORMANCE: bound the lateral scan to the same window as the
               -- outer conversion. Without this, each conversion triggers a full
               -- historical scan of the session's pageviews, which degrades
               -- quadratically as the events table grows.
               AND pv.time >= now() - interval '${length}'
          ) pv ON true
         WHERE c.site_id = $1
           AND c.is_bot IS NOT TRUE
           AND c.event_type = 'conversion'
           AND c.payload->>'utm_campaign' IS NOT NULL
           AND c.payload->>'utm_campaign' <> ''
           AND c.time >= now() - interval '${length}'
           AND extract(epoch FROM c.time - pv.first_pv) BETWEEN 0 AND 86400
     )
     SELECT campaign,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY delay_min)::numeric(8,1) AS p50_min,
            percentile_cont(0.9) WITHIN GROUP (ORDER BY delay_min)::numeric(8,1) AS p90_min,
            count(*)::int AS conversions
       FROM conv
      GROUP BY campaign
     HAVING count(*) >= 5
      ORDER BY p50_min DESC
      LIMIT 3`,
    [siteId]
  );
  for (const cs of conversionSpeeds) {
    const p50 = Number(cs.p50_min);
    const p90 = Number(cs.p90_min);
    if (p90 > 60) {
      insights.push({
        id: `slow-conversion-${cs.campaign}`,
        severity: "warn",
        title: `${cs.campaign}: conversão mediana em ${Math.round(p50)}min (p90 ${Math.round(p90)}min)`,
        detail:
          `${cs.conversions} conversões no período. A janela longa sugere boleto ou atraso na confirmação. ` +
          "Considere remarketing mais cedo ou ajustar a expectativa de ROAS intraday.",
      });
    } else if (p50 < 5) {
      insights.push({
        id: `fast-conversion-${cs.campaign}`,
        severity: "good",
        title: `${cs.campaign}: conversão rápida (mediana ${Math.round(p50)}min)`,
        detail:
          `${cs.conversions} conversões com tempo médio baixo. Ideal para ofertas com janela curta e Pix. ` +
          "Campanhas assim escalam bem com orçamento intraday.",
      });
    }
  }

  // --- Pixel health watchdog ---------------------------------------------
  // Detects campaigns that are sending clicks (ad_click_id present in pageviews)
  // but the ingest has received ZERO pageviews in the last 30 minutes despite
  // having received them earlier. This catches broken pixels after a deploy or
  // a landing page update without waiting for the daily report.
  const PIXEL_WINDOW = "30 minutes";
  const STALE_CAMPAIGNS = "6 hours";
  const pixelDead = await query<{ campaign: string; last_seen: string; recent_sessions: string }>(
    `SELECT payload->>'utm_campaign' AS campaign,
            max(time) AS last_seen,
            count(DISTINCT session_id) FILTER (
              WHERE time >= now() - interval '${PIXEL_WINDOW}'
            )::int AS recent_sessions
       FROM events
      WHERE site_id = $1
        AND is_bot IS NOT TRUE
        AND event_type = 'pageview'
        AND payload->>'utm_campaign' IS NOT NULL
        AND payload->>'utm_campaign' <> ''
        AND time >= now() - interval '${STALE_CAMPAIGNS}'
      GROUP BY payload->>'utm_campaign'
     HAVING max(time) < now() - interval '${PIXEL_WINDOW}'
        AND count(DISTINCT session_id) FILTER (
              WHERE time >= now() - interval '${STALE_CAMPAIGNS}'
                AND time < now() - interval '${PIXEL_WINDOW}'
            ) >= 10
      ORDER BY last_seen DESC
      LIMIT 3`,
    [siteId]
  );
  for (const pd of pixelDead) {
    const minsAgo = Math.round(
      (Date.now() - new Date(pd.last_seen).getTime()) / 60_000
    );
    insights.push({
      id: `pixel-dead-${pd.campaign}`,
      severity: "bad",
      title: `${pd.campaign}: zero eventos há ${minsAgo}min`,
      detail:
        `Essa campanha trouxe tráfego nas últimas ${STALE_CAMPAIGNS} mas parou de enviar eventos ` +
        `há ${minsAgo} minutos. Verifique se o pixel foi removido ou quebrado após uma atualização da landing.`,
    });
  }

  // --- Predictive ROAS: intent score by campaign -------------------------
  // Crosses the client-side intent-score with utm_campaign to surface which
  // campaigns are attracting high-intent visitors *before* conversions land.
  // This is the "should I scale this campaign right now?" signal that revenue
  // alone cannot answer during the attribution lag window (Pix takes minutes,
  // boleto takes hours). A campaign with avg intent > 60 and zero sales yet
  // is likely about to convert; one with avg intent < 35 after 100+ sessions
  // is burning budget on the wrong audience.
  const INTENT_WINDOW = "2 hours";
  const MIN_SESSIONS_FOR_INTENT = 30;
  const intentByCampaign = await query<{
    campaign: string;
    avg_intent: string;
    sessions: string;
  }>(
    `SELECT payload->>'utm_campaign' AS campaign,
            round(avg((payload->>'score')::numeric), 1)::text AS avg_intent,
            count(DISTINCT session_id)::int AS sessions
       FROM events
      WHERE site_id = $1
        AND is_bot IS NOT TRUE
        AND event_type = 'intent-score'
        AND payload->>'utm_campaign' IS NOT NULL
        AND payload->>'utm_campaign' <> ''
        AND time >= now() - interval '${INTENT_WINDOW}'
      GROUP BY payload->>'utm_campaign'
     HAVING count(DISTINCT session_id) >= ${MIN_SESSIONS_FOR_INTENT}
      ORDER BY avg((payload->>'score')::numeric) DESC
      LIMIT 5`,
    [siteId]
  );
  for (const ic of intentByCampaign) {
    const avgIntent = Number(ic.avg_intent);
    if (avgIntent >= 60) {
      insights.push({
        id: `high-intent-campaign-${ic.campaign}`,
        severity: "good",
        title: `${ic.campaign}: intent médio ${Math.round(avgIntent)} (${ic.sessions} sessões/2h)`,
        detail:
          "Essa campanha está atraindo visitantes com alto sinal de compra. " +
          "Mesmo sem vendas confirmadas ainda, o comportamento sugere que conversões devem chegar em breve. " +
          "Considere aumentar o orçamento antes que o custo por clique suba.",
      });
    } else if (avgIntent < 35 && Number(ic.sessions) >= 100) {
      insights.push({
        id: `low-intent-campaign-${ic.campaign}`,
        severity: "warn",
        title: `${ic.campaign}: intent médio baixo (${Math.round(avgIntent)}) com ${ic.sessions} sessões`,
        detail:
          "Apesar do volume, os visitantes dessa campanha mostram pouco interesse real (scroll raso, poucas interações). " +
          "O público pode estar desalinhado com a oferta. Revise segmentação ou criativo antes de escalar.",
      });
    }
  }

  // --- Audience mismatch: campaign vs converter profile ------------------
  // Detects when a campaign's visitor profile (device mix) diverges sharply
  // from the profile of sessions that actually converted. A campaign sending
  // 90% mobile traffic when 80% of buyers are on desktop is a targeting or
  // landing-page problem that CTR alone never reveals.
  //
  // Uses a simplified divergence metric: sum of absolute differences in
  // device share between campaign visitors and converters. Above 0.4 (on a
  // 0-2 scale) counts as meaningful mismatch.
  const MISMATCH_THRESHOLD = 0.4;
  const MIN_CONVERSIONS_FOR_MISMATCH = 10;
  const mismatches = await query<{
    campaign: string;
    divergence: string;
    camp_mobile_pct: string;
    conv_mobile_pct: string;
    sessions: string;
  }>(
    `WITH converter_device AS (
        SELECT device,
               count(DISTINCT session_id)::float AS cnt
          FROM events
         WHERE site_id = $1
           AND is_bot IS NOT TRUE
           AND event_type = 'conversion'
           AND time >= now() - interval '${length}'
         GROUP BY device
     ),
     converter_total AS (
        SELECT sum(cnt) AS total FROM converter_device
     ),
     converter_share AS (
        SELECT cd.device,
               cd.cnt / GREATEST(ct.total, 1) AS share
          FROM converter_device cd
          CROSS JOIN converter_total ct
     ),
     campaign_device AS (
        SELECT payload->>'utm_campaign' AS campaign,
               device,
               count(DISTINCT session_id)::float AS cnt
          FROM events
         WHERE site_id = $1
           AND is_bot IS NOT TRUE
           AND event_type = 'pageview'
           AND payload->>'utm_campaign' IS NOT NULL
           AND payload->>'utm_campaign' <> ''
           AND time >= now() - interval '${length}'
         GROUP BY payload->>'utm_campaign', device
     ),
     campaign_total AS (
        SELECT campaign, sum(cnt) AS total
          FROM campaign_device
         GROUP BY campaign
        HAVING sum(cnt) >= 50
     ),
     campaign_share AS (
        SELECT cd.campaign,
               cd.device,
               cd.cnt / GREATEST(ct.total, 1) AS share
          FROM campaign_device cd
          JOIN campaign_total ct ON ct.campaign = cd.campaign
     ),
     divergence_calc AS (
        SELECT cs.campaign,
               sum(abs(COALESCE(cs.share, 0) - COALESCE(cv.share, 0))) AS divergence,
               max(CASE WHEN cs.device = 'mobile' THEN cs.share ELSE 0 END) AS camp_mobile_pct,
               max(CASE WHEN cv.device = 'mobile' THEN cv.share ELSE 0 END) AS conv_mobile_pct,
               max(ct.total)::int AS sessions
          FROM campaign_share cs
          LEFT JOIN converter_share cv ON cv.device = cs.device
          JOIN campaign_total ct ON ct.campaign = cs.campaign
         GROUP BY cs.campaign
     )
     SELECT campaign,
            round(divergence::numeric, 2)::text AS divergence,
            round(camp_mobile_pct * 100)::text AS camp_mobile_pct,
            round(conv_mobile_pct * 100)::text AS conv_mobile_pct,
            sessions::text AS sessions
       FROM divergence_calc
      WHERE divergence >= ${MISMATCH_THRESHOLD}
      ORDER BY divergence DESC
      LIMIT 3`,
    [siteId]
  );
  // Only report if there are enough conversions for the baseline to mean something.
  if (cur.conversions >= MIN_CONVERSIONS_FOR_MISMATCH) {
    for (const mm of mismatches) {
      insights.push({
        id: `audience-mismatch-${mm.campaign}`,
        severity: "warn",
        title: `${mm.campaign}: público diferente do comprador típico`,
        detail:
          `Divergência de perfil de ${mm.divergence}. ` +
          `${mm.camp_mobile_pct}% do tráfego é mobile, mas apenas ${mm.conv_mobile_pct}% das vendas vêm de mobile. ` +
          "Revise se a landing page funciona bem no dispositivo que essa campanha envia, ou ajuste a segmentação.",
      });
    }
  }

  // --- Dayparting: conversion concentration by hour --------------------
  // Some campaigns sell only in specific hours (e.g. evening impulse buys).
  // Knowing this lets the manager concentrate budget where it converts and
  // pause wasted morning spend. Alerts when >70% of a campaign's conversions
  // happen in ≤4 hours of the day.
  const DAYPART_MIN_CONVERSIONS = 10;
  const dayparting = await query<{
    campaign: string;
    peak_hours: string;
    peak_share: string;
    total_conversions: string;
  }>(
    `WITH hourly AS (
        SELECT payload->>'utm_campaign' AS campaign,
               extract(hour FROM time)::int AS hr,
               count(*)::int AS conversions
          FROM events
         WHERE site_id = $1
           AND is_bot IS NOT TRUE
           AND event_type = 'conversion'
           AND payload->>'utm_campaign' IS NOT NULL
           AND payload->>'utm_campaign' <> ''
           AND time >= now() - interval '${length}'
         GROUP BY payload->>'utm_campaign', extract(hour FROM time)::int
     ),
     ranked AS (
        SELECT campaign,
               hr,
               conversions,
               sum(conversions) OVER (PARTITION BY campaign) AS total,
               row_number() OVER (PARTITION BY campaign ORDER BY conversions DESC) AS rn
          FROM hourly
     ),
     top4 AS (
        SELECT campaign,
               total,
               array_agg(hr ORDER BY conversions DESC) FILTER (WHERE rn <= 4) AS peak_hrs,
               sum(conversions) FILTER (WHERE rn <= 4)::float / GREATEST(total, 1) AS peak_share
          FROM ranked
         GROUP BY campaign, total
        HAVING sum(conversions) FILTER (WHERE rn <= 4)::float / GREATEST(total, 1) >= 0.7
           AND total >= ${DAYPART_MIN_CONVERSIONS}
     )
     SELECT campaign,
            peak_hrs::text AS peak_hours,
            round(peak_share::numeric * 100)::text AS peak_share,
            total::text AS total_conversions
       FROM top4
      ORDER BY peak_share DESC
      LIMIT 3`,
    [siteId]
  );
  for (const dp of dayparting) {
    insights.push({
      id: `dayparting-${dp.campaign}`,
      severity: "info",
      title: `${dp.campaign}: ${dp.peak_share}% das vendas em poucas horas`,
      detail:
        `${dp.total_conversions} conversões no período, concentradas nas horas ${dp.peak_hours.replace(/[{}]/g, "")}. ` +
        "Considere dayparting no gerenciador de anúncios para focar o orçamento nessas janelas e reduzir desperdício.",
    });
  }

  // --- Performance × Conversion: web vitals impact by device -----------
  // Crosses LCP rating with conversion rate segmented by device. When mobile
  // users with "poor" LCP convert at less than half the rate of "good" LCP,
  // that is a concrete, fixable revenue leak — not a vague "optimize performance"
  // recommendation. Desktop and mobile are analyzed separately because the
  // same LCP value has different user-experience implications on each.
  const VITALS_MIN_SESSIONS = 30;
  const vitalsImpact = await query<{
    device: string;
    good_rate: string;
    poor_rate: string;
    good_sessions: string;
    poor_sessions: string;
    ratio: string;
  }>(
    `WITH session_vitals AS (
        SELECT session_id,
               device,
               -- Take the worst LCP rating per session as the representative.
               -- If any paint was poor, the experience was poor regardless of
               -- other metrics being fine.
               bool_or(payload->>'rating' = 'good') AS has_good,
               bool_or(payload->>'rating' = 'poor') AS has_poor
          FROM events
         WHERE site_id = $1
           AND is_bot IS NOT TRUE
           AND event_type = 'web-vitals'
           AND payload->>'name' = 'LCP'
           AND time >= now() - interval '${length}'
         GROUP BY session_id, device
     ),
     session_converted AS (
        SELECT session_id,
               bool_or(event_type = 'conversion') AS converted
          FROM events
         WHERE site_id = $1
           AND is_bot IS NOT TRUE
           AND time >= now() - interval '${length}'
         GROUP BY session_id
     ),
     joined AS (
        SELECT sv.device,
               sv.has_good,
               sv.has_poor,
               sc.converted
          FROM session_vitals sv
          JOIN session_converted sc ON sc.session_id = sv.session_id
     )
     SELECT device,
            round(
              count(*) FILTER (WHERE has_good AND NOT has_poor AND converted)::numeric /
              GREATEST(count(*) FILTER (WHERE has_good AND NOT has_poor), 1),
              3
            )::text AS good_rate,
            round(
              count(*) FILTER (WHERE has_poor AND converted)::numeric /
              GREATEST(count(*) FILTER (WHERE has_poor), 1),
              3
            )::text AS poor_rate,
            count(*) FILTER (WHERE has_good AND NOT has_poor)::text AS good_sessions,
            count(*) FILTER (WHERE has_poor)::text AS poor_sessions,
            round(
              (count(*) FILTER (WHERE has_good AND NOT has_poor AND converted)::numeric /
               GREATEST(count(*) FILTER (WHERE has_good AND NOT has_poor), 1)) /
              NULLIF(
                count(*) FILTER (WHERE has_poor AND converted)::numeric /
                GREATEST(count(*) FILTER (WHERE has_poor), 1),
                0
              ),
              1
            )::text AS ratio
       FROM joined
      GROUP BY device
     HAVING count(*) FILTER (WHERE has_good AND NOT has_poor) >= ${VITALS_MIN_SESSIONS}
        AND count(*) FILTER (WHERE has_poor) >= ${VITALS_MIN_SESSIONS}
        AND count(*) FILTER (WHERE has_poor AND converted) > 0`,
    [siteId]
  );
  for (const vi of vitalsImpact) {
    const ratio = Number(vi.ratio);
    if (ratio >= 2) {
      insights.push({
        id: `vitals-impact-${vi.device}`,
        severity: "bad",
        title: `${vi.device}: LCP ruim converte ${ratio.toFixed(1)}x menos`,
        detail:
          `Taxa de conversão com LCP bom: ${(Number(vi.good_rate) * 100).toFixed(1)}% (${vi.good_sessions} sessões). ` +
          `Com LCP pobre: ${(Number(vi.poor_rate) * 100).toFixed(1)}% (${vi.poor_sessions} sessões). ` +
          `Otimizar imagens acima da dobra e reduzir JavaScript bloqueante em ${vi.device} pode recuperar essas vendas perdidas.`,
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
