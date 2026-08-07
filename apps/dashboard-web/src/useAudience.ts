import { useCallback, useEffect, useState } from "react";
import { API_BASE_URL, getToken } from "./token";
import type { RangeKey } from "./useMetrics";

export interface SegmentRow {
  label: string;
  sessions: number;
  conversions: number;
  conversionRate: number;
  revenue: number;
}

export interface Audience {
  range: RangeKey;
  dimensions: Record<string, SegmentRow[]>;
}

/**
 * Audience segmentation for a range: conversion rate broken down by acquisition
 * source, campaign, device, country and region — the data behind "which
 * audience actually buys". Plain request/response like useMetrics.
 */
export function useAudience(siteId: string, range: RangeKey) {
  const [audience, setAudience] = useState<Audience | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `${API_BASE_URL}/api/sites/${siteId}/audience?range=${range}`,
        { headers: { Authorization: `Bearer ${getToken() ?? ""}` } }
      );
      if (res.ok) setAudience((await res.json()) as Audience);
    } catch {
      // keep previous data on a transient failure
    } finally {
      setLoading(false);
    }
  }, [siteId, range]);

  useEffect(() => {
    void load();
  }, [load]);

  return { audience, loading, reload: load };
}
