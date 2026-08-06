import { BarChart3, Clock, LogOut, MousePointerClick, Target, TrendingDown, Users } from "lucide-react";
import { useMetrics, type Metrics, type RangeKey, type TopItem } from "./useMetrics";
import { StatCard } from "./components/StatCard";
import { AreaChart } from "./components/AreaChart";
import { flag, fmtDuration, deviceLabel } from "./lib/ui";

const RANGES: [RangeKey, string][] = [["24h", "24 horas"], ["7d", "7 dias"], ["30d", "30 dias"]];

export function MetricsPanel({
  siteId,
  range,
  onRangeChange,
}: {
  siteId: string;
  range: RangeKey;
  onRangeChange: (r: RangeKey) => void;
}) {
  const { metrics, loading } = useMetrics(siteId, range);

  return (
    <div>
      <div className="segment" style={{ marginBottom: 18 }}>
        {RANGES.map(([k, label]) => (
          <button key={k} className={k === range ? "is-active" : ""} onClick={() => onRangeChange(k)}>
            {label}
          </button>
        ))}
      </div>

      {!metrics && loading && <SkeletonMetrics />}
      {metrics && <MetricsBody m={metrics} />}
    </div>
  );
}

function MetricsBody({ m }: { m: Metrics }) {
  const spark = m.timeseries.map((t) => t.visitors);
  return (
    <>
      <div className="grid">
        <StatCard icon={<Users size={16} />} name="Visitantes únicos" value={m.visitors} spark={spark} />
        <StatCard icon={<BarChart3 size={16} />} name="Sessões" value={m.sessions} accent="#8b5cf6" />
        <StatCard icon={<MousePointerClick size={16} />} name="Pageviews" value={m.pageviews} accent="#06b6d4" />
        <StatCard icon={<Clock size={16} />} name="Tempo médio" value={fmtDuration(m.avgSessionSec)} accent="#10b981" />
        <StatCard icon={<TrendingDown size={16} />} name="Taxa de rejeição" value={`${Math.round(m.bounceRate * 100)}%`} accent="#fbbf24" />
        <StatCard icon={<Target size={16} />} name="Conversões" value={m.conversions} accent="#34d399" />
        <StatCard icon={<LogOut size={16} />} name="Taxa de conversão" value={`${(m.conversionRate * 100).toFixed(1)}%`} accent="#34d399" />
      </div>

      <div className="card chart-card" style={{ marginBottom: 22 }}>
        <div className="chart-head">
          <h3>Visitantes ao longo do tempo</h3>
          <span className="big">{m.visitors}</span>
        </div>
        <AreaChart data={m.timeseries.map((t) => ({ label: t.bucket, value: t.visitors }))} />
      </div>

      <div className="tops">
        <TopList title="Top páginas" items={m.topPages} />
        <TopList title="Top países" items={m.topCountries} format={(c) => `${flag(c)} ${c}`} />
        <TopList title="Dispositivos" items={m.topDevices} format={deviceLabel} />
        <TopList title="Navegadores" items={m.topBrowsers} />
        <TopList title="Origens" items={m.topReferrers} />
      </div>
    </>
  );
}

function TopList({ title, items, format }: { title: string; items: TopItem[]; format?: (l: string) => string }) {
  const max = Math.max(...items.map((i) => i.count), 1);
  return (
    <div className="card top-card">
      <div className="top-title">{title}</div>
      {items.length === 0 && <div className="empty">—</div>}
      {items.map((it) => (
        <div key={it.label} className="top-row">
          <span className="top-bar" style={{ width: `${(it.count / max) * 100}%` }} />
          <span className="top-label">{format ? format(it.label) : it.label}</span>
          <span className="top-count">{it.count}</span>
        </div>
      ))}
    </div>
  );
}

function SkeletonMetrics() {
  return (
    <>
      <div className="grid">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="card stat-card">
            <div className="skel" style={{ width: 30, height: 30, borderRadius: 8, marginBottom: 12 }} />
            <div className="skel" style={{ width: 80, height: 30, marginBottom: 10 }} />
            <div className="skel" style={{ width: "60%", height: 12 }} />
          </div>
        ))}
      </div>
      <div className="card chart-card" style={{ marginBottom: 22 }}>
        <div className="skel" style={{ width: "100%", height: 200 }} />
      </div>
    </>
  );
}
