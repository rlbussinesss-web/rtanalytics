import { useCallback, useEffect, useState } from "react";
import { API_BASE_URL, getToken } from "./token";

export interface SiteSummary {
  siteId: string;
  host: string | null;
  sessions: number;
  lastSeen: string;
}

const STORAGE_KEY = "rtanalytics_site_id";
/** Used until the site list arrives, and as the fallback for a fresh browser. */
const BUILD_DEFAULT = (import.meta.env.VITE_SITE_ID as string | undefined) ?? "meu-site";

function readStored(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * The list of tracked sites plus the one currently being viewed.
 *
 * Sites are discovered from the data rather than configured, so pointing a new
 * project's tracker at the same ingest is the whole setup. The choice is kept
 * in localStorage so the dashboard reopens where it was left, and it falls back
 * to the busiest site rather than an arbitrary one when nothing is stored.
 */
export function useSites() {
  const [sites, setSites] = useState<SiteSummary[]>([]);
  const [siteId, setSiteIdState] = useState<string>(() => readStored() ?? BUILD_DEFAULT);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch(`${API_BASE_URL}/api/sites`, {
          headers: { Authorization: `Bearer ${getToken() ?? ""}` },
        });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { sites: SiteSummary[] };
        setSites(data.sites);

        // Only auto-pick when the stored choice no longer exists, so a site
        // that goes quiet for a day doesn't yank the user somewhere else.
        const stored = readStored();
        const known = data.sites.some((s) => s.siteId === stored);
        if (!known && data.sites.length > 0) {
          const busiest = [...data.sites].sort((a, b) => b.sessions - a.sessions)[0]!;
          setSiteIdState(busiest.siteId);
        }
      } catch {
        // Offline or unauthorized: keep whatever site is already selected.
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const setSiteId = useCallback((next: string) => {
    setSiteIdState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* storage unavailable — the choice just won't survive a reload */
    }
  }, []);

  return { sites, siteId, setSiteId };
}
