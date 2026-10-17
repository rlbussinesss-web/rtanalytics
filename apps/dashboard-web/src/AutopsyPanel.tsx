import { useEffect, useState } from "react";
import { AlertTriangle, Play, ShoppingCart, XCircle } from "lucide-react";
import { API_BASE_URL, getToken } from "./token";
import { RecordedPlayer } from "./ReplaysPanel";
import type { RangeKey } from "./useMetrics";

/**
 * Simplified abandonment report: focuses on what matters for paid traffic —
 * how many people reached checkout but didn't buy, and at which step they
 * got stuck. No technical block-level detail; just the funnel drop-off.
 */

interface FunnelStep {
  step: string;
  label: string;
  sessions: number;
  droppedHere: number;
  dropRate: number;
  sampleSessions: string[];
}

interface CheckoutReport {
  range: RangeKey;
  totalSessions: number;
  reachedCheckout: number;
  converted: number;
  abandoned: number;
  abandonmentRate: number;
  steps: FunnelStep[];
  enoughData: boolean;
}

const RANGES: [RangeKey, string][] = [["24h", "24 horas"], ["7d", "7 dias"], ["30d", "30 dias"]];

export function AutopsyPanel({
  siteId,
  range,
  onRangeChange,
}: {
  siteId: string;
  range: RangeKey;
  onRangeChange: (r: RangeKey) => void;
}) {
  const [data, setData] = useState<CheckoutReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [playing, setPlaying] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/sites/${siteId}/autopsy?range=${range}`, {
          headers: { Authorization: `Bearer ${getToken() ?? ""}` },
        });
        if (res.ok && !cancelled) setData((await res.json()) as CheckoutReport);
      } catch {
        /* keep previous data */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [siteId, range]);

  return (
    <div>
      <div className="segment" style={{ marginBottom: 18 }}>
        {RANGES.map(([k, label]) => (
          <button key={k} className={k === range ? "is-active" : ""} onClick={() => onRangeChange(k)}>
            {label}
          </button>
        ))}
      </div>

      {loading && !data && <div className="card ap-empty">analisando desistências…</div>}

      {data && !data.enoughData && (
        <div className="card ap-empty">
          <AlertTriangle size={20} />
          <b>Ainda sem dados suficientes</b>
          <p>
            Assim que visitantes chegarem ao checkout, o relatório de abandono aparece aqui —
            quantos chegaram, quantos compraram, e em qual passo travaram.
          </p>
        </div>
      )}

      {data && data.enoughData && (
        <>
          {/* Summary cards */}
          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", marginBottom: 22 }}>
            <div className="card stat-card">
              <ShoppingCart size={16} style={{ color: "#8b5cf6", marginBottom: 8 }} />
              <div style={{ fontSize: 28, fontWeight: 700 }}>{data.reachedCheckout}</div>
              <div style={{ opacity: 0.6, fontSize: 13 }}>Chegaram no checkout</div>
            </div>
            <div className="card stat-card">
              <XCircle size={16} style={{ color: "#ef4444", marginBottom: 8 }} />
              <div style={{ fontSize: 28, fontWeight: 700 }}>{data.abandoned}</div>
              <div style={{ opacity: 0.6, fontSize: 13 }}>Abandonaram</div>
            </div>
            <div className="card stat-card">
              <AlertTriangle size={16} style={{ color: "#fbbf24", marginBottom: 8 }} />
              <div style={{ fontSize: 28, fontWeight: 700 }}>{(data.abandonmentRate * 100).toFixed(0)}%</div>
              <div style={{ opacity: 0.6, fontSize: 13 }}>Taxa de abandono</div>
            </div>
            <div className="card stat-card">
              <Play size={16} style={{ color: "#10b981", marginBottom: 8 }} />
              <div style={{ fontSize: 28, fontWeight: 700 }}>{data.converted}</div>
              <div style={{ opacity: 0.6, fontSize: 13 }}>Converteram</div>
            </div>
          </div>

          {/* Funnel steps — where they got stuck */}
          <div className="card" style={{ padding: "20px 24px" }}>
            <h3 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 600 }}>
              Em qual passo travaram?
            </h3>
            {data.steps.length === 0 && (
              <div style={{ opacity: 0.5 }}>Sem dados de passos do funil ainda.</div>
            )}
            {data.steps.map((step, i) => {
              const maxDrop = Math.max(...data.steps.map((s) => s.droppedHere), 1);
              return (
                <div key={step.step} style={{ marginBottom: i < data.steps.length - 1 ? 14 : 0 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                    <span style={{ fontWeight: 500, fontSize: 14 }}>{step.label}</span>
                    <span style={{ fontSize: 13, opacity: 0.7 }}>
                      {step.droppedHere} desistiram aqui ({(step.dropRate * 100).toFixed(0)}%)
                    </span>
                  </div>
                  <div style={{ height: 8, borderRadius: 4, background: "var(--surface-2, #1e1e2e)", overflow: "hidden" }}>
                    <div
                      style={{
                        height: "100%",
                        width: `${(step.droppedHere / maxDrop) * 100}%`,
                        borderRadius: 4,
                        background: step.dropRate > 0.4 ? "#ef4444" : step.dropRate > 0.2 ? "#fbbf24" : "#10b981",
                        transition: "width 0.3s ease",
                      }}
                    />
                  </div>
                  {step.sampleSessions.length > 0 && (
                    <div style={{ marginTop: 6, display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {step.sampleSessions.slice(0, 3).map((s) => (
                        <button
                          key={s}
                          className="btn btn-ghost btn-sm"
                          style={{ fontSize: 11, padding: "2px 8px" }}
                          onClick={() => setPlaying(s)}
                        >
                          <Play size={10} fill="currentColor" stroke="none" /> Ver sessão {s.slice(0, 6)}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {playing && (
        <RecordedPlayer siteId={siteId} sessionId={playing} onClose={() => setPlaying(null)} />
      )}
    </div>
  );
}