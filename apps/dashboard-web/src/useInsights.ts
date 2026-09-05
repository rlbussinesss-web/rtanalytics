import { useCallback, useEffect, useState } from "react";
import { API_BASE_URL, getToken } from "./token";
import type { RangeKey } from "./useMetrics";

export type InsightSeverity = "good" | "warn" | "bad" | "info";

export interface Insight {
  id: string;
  severity: InsightSeverity;
  title: string;
  detail: string;
  change?: number;
}

export interface InsightsReport {
  range: RangeKey;
  enoughData: boolean;
  insights: Insight[];
}

/**
 * Automatic insights for a range: what changed versus the previous period and
 * what is worth acting on. Plain request/response — the server does the
 * comparison, the UI only renders the verdict.
 */
export function useInsights(siteId: string, range: RangeKey) {
  const [report, setReport] = useState<InsightsReport | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/sites/${siteId}/insights?range=${range}`, {
        headers: { Authorization: `Bearer ${getToken() ?? ""}` },
      });
      if (res.ok) setReport((await res.json()) as InsightsReport);
    } catch {
      // keep the previous report on a transient failure
    } finally {
      setLoading(false);
    }
  }, [siteId, range]);

  useEffect(() => {
    void load();
  }, [load]);

  return { report, loading, reload: load };
}
