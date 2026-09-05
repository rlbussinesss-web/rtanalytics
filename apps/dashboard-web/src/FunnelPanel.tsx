import { useCallback, useEffect, useState } from "react";
import { API_BASE_URL, getToken } from "./token";
import type { RangeKey } from "./useMetrics";
import { DiscoveryPanel } from "./DiscoveryPanel";

/**
 * Conversion funnel builder + viewer.
 *
 * Steps are configured here and kept in localStorage (per browser) rather than
 * a backend config store — for a two-person team that's enough, and it keeps
 * the funnel definition editable without a schema migration. Each step is a
 * page path or a conversion goal name.
 */

interface Step {
  kind: "path" | "event";
  value: string;
}

interface StepResult {
  label: string;
  sessions: number;
  rate: number;
  dropoff: number;
}

const STORAGE_KEY = "rtanalytics_funnel_steps";

function loadSteps(): Step[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as Step[];
  } catch {
    /* ignore */
  }
  return [
    { kind: "path", value: "/demo.html" },
    { kind: "event", value: "purchase" },
  ];
}

export function FunnelPanel({ siteId, range }: { siteId: string; range: RangeKey }) {
  const [steps, setSteps] = useState<Step[]>(loadSteps);
  const [results, setResults] = useState<StepResult[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(steps));
  }, [steps]);

  const run = useCallback(async () => {
    const valid = steps.filter((s) => s.value.trim());
    if (valid.length < 2) {
      setResults(null);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/sites/${siteId}/funnel`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${getToken() ?? ""}`,
        },
        body: JSON.stringify({ range, steps: valid }),
      });
      if (res.ok) {
        const data = (await res.json()) as { steps: StepResult[] };
        setResults(data.steps);
      }
    } catch {
      /* keep previous results */
    } finally {
      setLoading(false);
    }
  }, [siteId, range, steps]);

  useEffect(() => {
    void run();
    // Re-run when range changes; step edits are applied via the Update button.
  }, [range]); // eslint-disable-line react-hooks/exhaustive-deps

  const setStep = (i: number, patch: Partial<Step>) =>
    setSteps((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  const addStep = () => setSteps((prev) => [...prev, { kind: "path", value: "" }]);
  const removeStep = (i: number) => setSteps((prev) => prev.filter((_, idx) => idx !== i));

  const maxSessions = results && results.length ? results[0]!.sessions : 0;

  return (
    <>
      {/* Found automatically; the configured funnel below answers a question
          you already have, this one finds the one you don't. */}
      <DiscoveryPanel siteId={siteId} range={range} />

      <div className="funnel-layout">
      <div className="card funnel-config">
        <div className="top-title">Etapas do funil</div>
        {steps.map((step, i) => (
          <div key={i} className="funnel-step-edit">
            <select
              className="input funnel-kind"
              value={step.kind}
              onChange={(e) => setStep(i, { kind: e.target.value as Step["kind"] })}
            >
              <option value="path">Página</option>
              <option value="event">Conversão</option>
            </select>
            <input
              className="input"
              value={step.value}
              placeholder={step.kind === "path" ? "/checkout" : "purchase"}
              onChange={(e) => setStep(i, { value: e.target.value })}
            />
            <button className="btn btn-ghost btn-sm" onClick={() => removeStep(i)}>
              ✕
            </button>
          </div>
        ))}
        <div className="funnel-actions">
          <button className="btn btn-ghost btn-sm" onClick={addStep}>
            + Etapa
          </button>
          <button className="btn btn-primary btn-sm" onClick={run} disabled={loading}>
            {loading ? "Calculando…" : "Atualizar"}
          </button>
        </div>
      </div>

      <div className="funnel-view">
        {!results && <p className="empty">Defina ao menos 2 etapas e clique em Atualizar.</p>}
        {results?.map((r, i) => (
          <div key={i} className="funnel-bar-row">
            <div className="funnel-bar-head">
              <span className="funnel-step-label">{r.label}</span>
              <span className="funnel-step-num">
                {r.sessions}
                <span className="funnel-rate"> · {Math.round(r.rate * 100)}%</span>
              </span>
            </div>
            <div className="funnel-track">
              <div
                className="funnel-fill"
                style={{ width: `${maxSessions ? (r.sessions / maxSessions) * 100 : 0}%` }}
              />
            </div>
            {i > 0 && r.dropoff > 0 && (
              <div className="funnel-drop">↓ {Math.round(r.dropoff * 100)}% desistiram</div>
            )}
          </div>
        ))}
      </div>
    </div>
    </>
  );
}
