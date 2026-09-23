import { AlertTriangle, Bug, MousePointer2, MoveVertical, ZapOff } from "lucide-react";
import type { Metrics } from "../useMetrics";

/**
 * Behaviour insights + performance, the Pathora take on Clarity's
 * "Insights" and "Performance" cards. Each frustration signal is a share of
 * sessions with a one-line explanation; Core Web Vitals show the p75 value
 * with its rating and an overall score.
 */
export function InsightsPanel({ m }: { m: Metrics }) {
  return (
    <>
      <div className="section-head" style={{ marginTop: 6 }}>
        <h2 className="section-title">Sinais de frustração</h2>
      </div>
      <div className="grid" style={{ marginBottom: 22 }}>
        <InsightCard
          icon={<MousePointer2 size={16} />}
          name="Rage clicks"
          value={pct(m.rageClickRate)}
          hint="Cliques repetidos no mesmo ponto — sinal de irritação."
          tone={m.rageClickRate > 0.05 ? "warn" : "ok"}
        />
        <InsightCard
          icon={<ZapOff size={16} />}
          name="Dead clicks"
          value={pct(m.deadClickRate)}
          hint="Cliques que não fizeram nada — elemento quebrado ou confuso."
          tone={m.deadClickRate > 0.1 ? "warn" : "ok"}
        />
        <InsightCard
          icon={<Bug size={16} />}
          name="Erros de JavaScript"
          value={pct(m.errorRate)}
          hint={`${m.errorCount} erro(s) no período.`}
          tone={m.errorRate > 0 ? "bad" : "ok"}
        />
        <InsightCard
          icon={<MoveVertical size={16} />}
          name="Profundidade de rolagem"
          value={`${m.avgScrollDepth}%`}
          hint="Quão fundo os visitantes rolam, em média."
          tone="ok"
        />
      </div>

      <div className="cols-2" style={{ marginBottom: 22 }}>
        <div className="card chart-card">
          <div className="chart-head">
            <h3>Core Web Vitals</h3>
            <PerfScore score={m.performanceScore} />
          </div>
          {m.webVitals.length === 0 ? (
            <p className="empty">Coletando métricas de desempenho…</p>
          ) : (
            <div className="vitals">
              {m.webVitals.map((v) => (
                <div key={v.name} className={`vital vital-${v.rating}`}>
                  <div className="vital-name">{v.name}</div>
                  <div className="vital-value">{formatVital(v.name, v.value)}</div>
                  <div className="vital-rating">{ratingLabel(v.rating)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="card chart-card">
          <div className="chart-head"><h3>O que observar</h3></div>
          <ul className="advice">
            <Advice ok={m.errorRate === 0} bad={`${m.errorCount} erro(s) de JS afetando ${pct(m.errorRate)} das sessões`} good="Nenhum erro de JavaScript" icon={<AlertTriangle size={14} />} />
            <Advice ok={m.rageClickRate < 0.05} bad={`Rage clicks em ${pct(m.rageClickRate)} das sessões`} good="Poucos sinais de frustração por clique" icon={<MousePointer2 size={14} />} />
            <Advice ok={m.performanceScore >= 80 || m.webVitals.length === 0} bad={`Desempenho em ${m.performanceScore}/100 — Web Vitals precisam de atenção`} good="Desempenho saudável nos Core Web Vitals" icon={<ZapOff size={14} />} />
          </ul>
        </div>
      </div>
    </>
  );
}

function InsightCard({ icon, name, value, hint, tone }: { icon: React.ReactNode; name: string; value: string; hint: string; tone: "ok" | "warn" | "bad" }) {
  const accent = tone === "bad" ? "#f87171" : tone === "warn" ? "#fbbf24" : "#34d399";
  return (
    <div className="card stat-card">
      <div className="stat-top">
        <span className="stat-ico" style={{ background: `color-mix(in srgb, ${accent} 16%, transparent)`, color: accent }}>{icon}</span>
        <span className="stat-name">{name}</span>
      </div>
      <div className="stat-value">{value}</div>
      <div className="stat-hint">{hint}</div>
    </div>
  );
}

function PerfScore({ score }: { score: number }) {
  const color = score >= 80 ? "#34d399" : score >= 50 ? "#fbbf24" : "#f87171";
  return <span className="perf-score" style={{ color }}>{score || "—"}<small>/100</small></span>;
}

function Advice({ ok, good, bad, icon }: { ok: boolean; good: string; bad: string; icon: React.ReactNode }) {
  return (
    <li className={`advice-row ${ok ? "ok" : "bad"}`}>
      {icon}
      {ok ? good : bad}
    </li>
  );
}

const pct = (f: number) => `${(f * 100).toFixed(1)}%`;
const ratingLabel = (r: string) => (r === "good" ? "bom" : r === "needs-improvement" ? "regular" : "ruim");
function formatVital(name: string, v: number): string {
  if (name === "CLS") return v.toFixed(3);
  if (v >= 1000) return `${(v / 1000).toFixed(2)}s`;
  return `${Math.round(v)}ms`;
}
