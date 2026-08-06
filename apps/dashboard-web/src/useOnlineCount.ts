import { useCallback, useEffect, useState } from "react";
import type { LiveEvent } from "./useLiveEvents";
import { API_BASE_URL, getToken } from "./token";

/**
 * Online-visitor counter. Fetches the initial value once via REST, then
 * re-syncs whenever live activity arrives on the WS stream — never on a
 * timer, so the "no polling" guarantee holds for the live path.
 */
export function useOnlineCount(siteId: string, liveEvents: LiveEvent[]): number {
  const [count, setCount] = useState<number>(0);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/sites/${siteId}/online-count`, {
        headers: { Authorization: `Bearer ${getToken() ?? ""}` },
      });
      if (!response.ok) return;
      const data = (await response.json()) as { onlineCount: number };
      setCount(data.onlineCount);
    } catch {
      // transient network error — the next live event triggers another refresh
    }
  }, [siteId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const latest = liveEvents[0];
    if (!latest) return;
    if (latest.eventType === "pageview" || latest.eventType === "heartbeat") {
      void refresh();
    }
  }, [liveEvents, refresh]);

  return count;
}
