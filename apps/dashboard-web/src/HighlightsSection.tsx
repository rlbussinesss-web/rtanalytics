import { useEffect, useState } from "react";
import { Play, Sparkles } from "lucide-react";
import { API_BASE_URL, getToken } from "./token";
import { deviceLabel, fmtDuration, flag } from "./lib/ui";

/**
 * The recordings worth watching, ranked.
 *
 * An unranked list of 200 replays is the same as no list — whatever sits on
 * top gets watched, and it is usually a bounce. This puts the expensive
 * sessions first (paid traffic that reached checkout and left, pages throwing
 * errors) and says why in one line, so the time spent watching goes where the
 * money is leaking.
 */

interface Highlight {
  sessionId: string;
  score: number;
  reason: string;
  durationSec: number;
  pages: number;
  rageClicks: number;
  errors: number;
  reachedCheckout: boolean;
  converted: boolean;
  country: string | null;
  device: string | null;
}

export function HighlightsSection({
  siteId,
  onPlay,
}: {
  siteId: string;
  onPlay: (sessionId: string) => void;
}) {
  const [items, setItems] = useState<Highlight[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/sites/${siteId}/highlights?range=7d`, {
          headers: { Authorization: `Bearer ${getToken() ?? ""}` },
        });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { highlights: Highlight[] };
        setItems(data.highlights);
      } catch {
        /* leave the section out rather than showing a broken state */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [siteId]);

  // Nothing notable is a fine outcome, not an error worth a placeholder.
  if (!items || items.length === 0) return null;

  return (
    <section className="hl">
      <div className="hl-head">
        <span className="hl-title">
          <Sparkles size={14} /> Vale assistir
        </span>
        <span className="hl-sub">as sessões com mais a ensinar · 7 dias</span>
      </div>
      <div className="hl-grid">
        {items.map((h) => (
          <button key={h.sessionId} className="hl-card" onClick={() => onPlay(h.sessionId)}>
            <span className={`hl-play${h.reachedCheckout && !h.converted ? " hot" : ""}`}>
              <Play size={14} fill="currentColor" stroke="none" />
            </span>
            <span className="hl-body">
              <span className="hl-top">
                <b>Sessão {h.sessionId.slice(0, 4)}</b>
                <span className="hl-meta">
                  {flag(h.country ?? undefined)} {deviceLabel(h.device ?? undefined)} ·{" "}
                  {fmtDuration(h.durationSec)} · {h.pages} pág.
                </span>
              </span>
              <span className="hl-reason">{h.reason}</span>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
