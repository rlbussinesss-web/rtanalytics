import { useEffect, useState } from "react";
import type { PropensityModel } from "@rtanalytics/shared-types";
import { API_BASE_URL, getToken } from "./token";

/**
 * The site's trained propensity model.
 *
 * Fetched once and refreshed slowly: the model describes the shape of a funnel
 * over thirty days, so re-fetching it per visitor would be pure overhead. Live
 * visitors are then scored locally, which is what makes the score update at the
 * speed of the event stream instead of the speed of the network.
 */
const REFRESH_MS = 10 * 60 * 1000;

export function useModel(siteId: string) {
  const [model, setModel] = useState<PropensityModel | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch(`${API_BASE_URL}/api/sites/${siteId}/model`, {
          headers: { Authorization: `Bearer ${getToken() ?? ""}` },
        });
        if (res.ok && !cancelled) setModel((await res.json()) as PropensityModel);
      } catch {
        // Keep the previous model; a stale model beats no scoring at all.
      }
    }

    void load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [siteId]);

  return model;
}
