import { useCallback, useEffect, useState } from "react";
import { API_BASE_URL, getToken } from "./token";

export type RangeKey = "24h" | "7d" | "30d";

export interface TopItem {
  label: string;
  count: number;
}

export interface Metrics {
  range: RangeKey;
  visitors: number;
  sessions: number;
  pageviews: number;
  events: number;
  avgSessionSec: number;
  bounceRate: number;
  timeseries: { bucket: string; visitors: number }[];
  topPages: TopItem[];
  topCountries: TopItem[];
  topDevices: TopItem[];
  topBrowsers: TopItem[];
  topReferrers: TopItem[];
}

/**
 * Historical metrics for a range. Unlike the live hooks this is a plain
 * request/response — history doesn't change second to second, so it is
 * fetched on range change and can be refreshed on demand.
 */
export function useMetrics(siteId: string, range: RangeKey) {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `${API_BASE_URL}/api/sites/${siteId}/metrics?range=${range}`,
        { headers: { Authorization: `Bearer ${getToken() ?? ""}` } }
      );
      if (res.ok) setMetrics((await res.json()) as Metrics);
    } catch {
      // leave previous metrics visible on a transient failure
    } finally {
      setLoading(false);
    }
  }, [siteId, range]);

  useEffect(() => {
    void load();
  }, [load]);

  return { metrics, loading, reload: load };
}
