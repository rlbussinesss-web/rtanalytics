import { query } from "./db.js";
import type { RangeKey } from "./metrics.js";

/**
 * Google Ads Search keyword performance: for each keyword that drove traffic,
 * how many sessions arrived and how many reached the payment step.
 *
 * The keyword is captured from the `keyword` URL parameter (Google Ads Search
 * passes it as `keyword=tapete%20para%20carro`). Payment-step detection uses
 * the same URL patterns as the autopsy funnel.
 */

const RANGE_INTERVAL: Record<RangeKey, string> = {
  "24h": "24 hours",
  "7d": "7 days",
  "30d": "30 days",
};

export interface KeywordRow {
  keyword: string;
  sessions: number;
  reachedPayment: number;
  paymentRate: number;
  converted: number;
  conversionRate: number;
}

export interface KeywordsReport {
  range: RangeKey;
  rows: KeywordRow[];
  totalSessions: number;
  totalReachedPayment: number;
}

export async function computeKeywords(siteId: string, range: RangeKey): Promise<KeywordsReport> {
  const since = `now() - interval '${RANGE_INTERVAL[range]}'`;

  const rows = await query<{
    keyword: string;
    sessions: string;
    reached_payment: string;
    converted: string;
  }>(
    `SELECT kw AS keyword,
            count(*)::int AS sessions,
            count(*) FILTER (WHERE reached_payment)::int AS reached_payment,
            count(*) FILTER (WHERE did_convert)::int AS converted
       FROM (
         SELECT session_id,
                max(payload->>'keyword') AS kw,
                bool_or(
                  event_type = 'pageview' AND path ~* '/(pagamento|payment|pay|pix|boleto|card|credit)'
                ) AS reached_payment,
                bool_or(event_type = 'conversion') AS did_convert
           FROM events
          WHERE site_id = $1 AND is_bot IS NOT TRUE AND time >= ${since}
          GROUP BY session_id
       ) s
      WHERE kw IS NOT NULL AND kw <> ''
      GROUP BY kw
      ORDER BY sessions DESC
      LIMIT 50`,
    [siteId]
  );

  const result: KeywordRow[] = rows.map((r) => {
    const sessions = Number(r.sessions);
    const reachedPayment = Number(r.reached_payment);
    const converted = Number(r.converted);
    return {
      keyword: r.keyword,
      sessions,
      reachedPayment,
      paymentRate: sessions > 0 ? reachedPayment / sessions : 0,
      converted,
      conversionRate: sessions > 0 ? converted / sessions : 0,
    };
  });

  const totalSessions = result.reduce((sum, r) => sum + r.sessions, 0);
  const totalReachedPayment = result.reduce((sum, r) => sum + r.reachedPayment, 0);

  return { range, rows: result, totalSessions, totalReachedPayment };
}