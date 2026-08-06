import { useCallback, useEffect, useState } from "react";
import type { LiveEvent } from "./useLiveEvents";
import { API_BASE_URL, getToken } from "./token";

/**
 * Sessions currently online. Seeded from REST, then refreshed whenever the
 * live feed shows activity — the same push-driven approach as the online
 * counter, so there is no polling timer.
 */
export function useSessions(siteId: string, liveEvents: LiveEvent[]): string[] {
  const [sessions, setSessions] = useState<string[]>([]);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/sites/${siteId}/sessions`, {
        headers: { Authorization: `Bearer ${getToken() ?? ""}` },
      });
      if (!response.ok) return;
      const data = (await response.json()) as { sessions: string[] };
      setSessions(data.sessions);
    } catch {
      // transient failure — the next live event triggers another refresh
    }
  }, [siteId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (liveEvents.length === 0) return;
    void refresh();
  }, [liveEvents, refresh]);

  return sessions;
}
