import { useEffect, useState } from "react";
import { TrendingDown } from "lucide-react";
import { API_BASE_URL, getToken } from "./token";
import type { RangeKey } from "./useMetrics";

/**
 * Funnel discovery: the leaks found without being asked.
 *
 * Sits above the manual funnel because it answers a different question. A
 * configured funnel confirms a route you already suspect; this one walks the
 * routes visitors actually take, so the expensive step surfaces even when it
 * is somewhere nobody thought to look.
 */

interface DiscoveredStep {
  path: string;
  sessions: number;
  exits: number;
  exitRate: number;
  conversions: number;
  conversionRate: number;
}

interface DiscoveredTransition {
  from: string;
  to: string;
  sessions: number;
}

interface FunnelDiscovery {
  range: RangeKey;
  enoughData: boolean;
  steps: DiscoveredStep[];
  transitions: DiscoveredTransition[];
  biggestLeak: DiscoveredStep | null;
}

const pct = (n: number) => `${Math.round(n * 100)}%`;

export function DiscoveryPanel({ siteId, range }: { siteId: string; range: RangeKey }) {
  const [data, setData] = useState<FunnelDiscovery | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/sites/${siteId}/discovery?range=${range}`, {
          headers: { Authorization: `Bearer ${getToken() ?? ""}` },
        });
        if (res.ok && !cancelled) setData((await res.json()) as FunnelDiscovery);
      } catch {
        /* keep whatever is on screen */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [siteId, range]);

  if (!data) return null;

  if (!data.enoughData) {
    return (
      <div className="card disc-empty">
        <b>Ainda não dá para mapear a jornada</b>
        <p>
          Preciso de pelo menos 10 sessões por página para que as taxas signifiquem alguma coisa.
          Assim que o tráfego subir, os vazamentos aparecem aqui sozinhos.
        </p>
      </div>
    );
  }

  const max = Math.max(...data.steps.map((s) => s.sessions), 1);

  return (
    <div className="disc">
      {data.biggestLeak && (
        <div className="card disc-leak">
          <span className="disc-leak-tag">
            <TrendingDown size={14} /> Maior vazamento
          </span>
          <h3>{data.biggestLeak.path}</h3>
          <p>
            <b>{data.biggestLeak.exits}</b> de {data.biggestLeak.sessions} sessões terminaram aqui
            {" "}({pct(data.biggestLeak.exitRate)}). É onde mais gente desiste.
          </p>
        </div>
      )}

      <div className="card disc-table">
        <div className="disc-head">
          <span>Página</span>
          <span>Sessões</span>
          <span>Saíram aqui</span>
          <span>Converteram</span>
        </div>
        {data.steps.map((s) => (
          <div key={s.path} className="disc-row">
            <span className="disc-path" title={s.path}>
              <span className="disc-bar" style={{ width: `${(s.sessions / max) * 100}%` }} />
              <span className="disc-path-t">{s.path}</span>
            </span>
            <span className="disc-n">{s.sessions}</span>
            <span className={`disc-n${s.exitRate >= 0.5 ? " bad" : ""}`}>{pct(s.exitRate)}</span>
            <span className={`disc-n${s.conversionRate > 0 ? " good" : ""}`}>
              {pct(s.conversionRate)}
            </span>
          </div>
        ))}
      </div>

      {data.transitions.length > 0 && (
        <div className="card disc-flows">
          <div className="disc-flows-t">Caminhos mais percorridos</div>
          {data.transitions.slice(0, 6).map((t) => (
            <div key={`${t.from}->${t.to}`} className="disc-flow">
              <span>{t.from}</span>
              <span className="disc-arrow">→</span>
              <span>{t.to}</span>
              <span className="disc-flow-n">{t.sessions}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
