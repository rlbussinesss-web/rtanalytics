import { useEffect, useState } from "react";
import { API_BASE_URL, getToken } from "./token";
import type { RangeKey } from "./useMetrics";

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

export function useKeywords(siteId: string, range: RangeKey) {
  const [data, setData] = useState<KeywordsReport | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const res = await fetch(
          `${API_BASE_URL}/api/sites/${siteId}/keywords?range=${range}`,
          { headers: { Authorization: `Bearer ${getToken() ?? ""}` } }
        );
        if (res.ok && !cancelled) setData((await res.json()) as KeywordsReport);
      } catch {
        /* keep previous */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [siteId, range]);

  return { data, loading };
}