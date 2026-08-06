import { useCallback, useEffect, useState } from "react";
import { MousePointerClick, ZapOff, Flame } from "lucide-react";
import { API_BASE_URL, getToken } from "./token";
import { useMetrics, type RangeKey } from "./useMetrics";
import { Heatmap, type ClickPoint } from "./components/Heatmap";

interface HeatmapData {
  path: string;
  clicks: ClickPoint[];
  topElements: { selector: string; count: number; rage: number; dead: number }[];
  scrollReach: { depth: number; pct: number }[];
  totalClicks: number;
}

type Filter = "all" | "rage" | "dead";

export function HeatmapView({ siteId, range }: { siteId: string; range: RangeKey }) {
  const { metrics } = useMetrics(siteId, range);
  const pages = metrics?.topPages.map((p) => p.label) ?? [];
  const [path, setPath] = useState<string>("");
  const [filter, setFilter] = useState<Filter>("all");
  const [data, setData] = useState<HeatmapData | null>(null);
  const [loading, setLoading] = useState(false);

  // Default to the busiest page once metrics arrive.
  useEffect(() => {
    if (!path && pages.length) setPath(pages[0]!);
  }, [pages, path]);

  const load = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    try {
      const res = await fetch(
        `${API_BASE_URL}/api/sites/${siteId}/heatmap?range=${range}&path=${encodeURIComponent(path)}`,
        { headers: { Authorization: `Bearer ${getToken() ?? ""}` } }
      );
      if (res.ok) setData((await res.json()) as HeatmapData);
    } finally {
      setLoading(false);
    }
  }, [siteId, range, path]);

  useEffect(() => {
    void load();
  }, [load]);

  const filters: [Filter, string, React.ReactNode][] = [
    ["all", "Todos os cliques", <MousePointerClick key="a" size={14} />],
    ["rage", "Rage clicks", <Flame key="r" size={14} />],
    ["dead", "Dead clicks", <ZapOff key="d" size={14} />],
  ];

  return (
    <div className="heatmap-layout">
      <div className="card heatmap-main">
        <div className="heatmap-toolbar">
          <select className="input" value={path} onChange={(e) => setPath(e.target.value)} style={{ maxWidth: 320 }}>
            {pages.length === 0 && <option>Sem páginas no período</option>}
            {pages.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
          <div className="segment">
            {filters.map(([k, label, icon]) => (
              <button key={k} className={k === filter ? "is-active" : ""} onClick={() => setFilter(k)}>
                {icon} {label}
              </button>
            ))}
          </div>
          <span className="section-count spacer">
            {data ? `${data.clicks.length} cliques` : loading ? "carregando…" : ""}
          </span>
        </div>
        <div className="heatmap-stage">
          {data && data.clicks.length > 0 ? (
            <Heatmap points={data.clicks} filter={filter} />
          ) : (
            <div className="empty-rich" style={{ margin: "auto" }}>
              <span className="ico"><Flame size={20} /></span>
              <b>Sem cliques nesta página</b>
              <p>Assim que houver cliques capturados aqui, o mapa de calor aparece.</p>
            </div>
          )}
        </div>
      </div>

      <div className="heatmap-side">
        <div className="card top-card">
          <div className="top-title">Elementos mais clicados</div>
          {(!data || data.topElements.length === 0) && <div className="empty">—</div>}
          {data?.topElements.map((el) => {
            const max = data.topElements[0]!.count || 1;
            return (
              <div key={el.selector} className="top-row" title={el.selector}>
                <span className="top-bar" style={{ width: `${(el.count / max) * 100}%` }} />
                <span className="top-label mono" style={{ fontSize: 11.5 }}>{el.selector}</span>
                {el.rage > 0 && <span className="mini-badge warn">{el.rage} rage</span>}
                {el.dead > 0 && <span className="mini-badge bad">{el.dead} dead</span>}
                <span className="top-count">{el.count}</span>
              </div>
            );
          })}
        </div>

        <div className="card top-card">
          <div className="top-title">Alcance de rolagem</div>
          {data?.scrollReach.map((s) => (
            <div key={s.depth} className="scroll-row">
              <span className="scroll-depth">{s.depth}%</span>
              <div className="scroll-track">
                <div className="scroll-fill" style={{ width: `${s.pct * 100}%` }} />
              </div>
              <span className="scroll-pct">{Math.round(s.pct * 100)}%</span>
            </div>
          ))}
          {!data?.scrollReach.some((s) => s.pct > 0) && <div className="empty">Sem dados de rolagem.</div>}
        </div>
      </div>
    </div>
  );
}
