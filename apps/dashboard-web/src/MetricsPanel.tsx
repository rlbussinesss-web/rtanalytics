import { useMetrics, type Metrics, type RangeKey, type TopItem } from "./useMetrics";

const RANGES: { key: RangeKey; label: string }[] = [
  { key: "24h", label: "24 horas" },
  { key: "7d", label: "7 dias" },
  { key: "30d", label: "30 dias" },
];

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
      <div className="range-tabs">
        {RANGES.map((r) => (
          <button
            key={r.key}
            className={`range-tab${r.key === range ? " is-active" : ""}`}
            onClick={() => onRangeChange(r.key)}
          >
            {r.label}
          </button>
        ))}
      </div>

      {!metrics && loading && <p className="empty">Carregando métricas…</p>}
      {metrics && <MetricsBody m={metrics} />}
    </div>
  );
}

function MetricsBody({ m }: { m: Metrics }) {
  return (
    <>
      <div className="grid">
        <Stat value={String(m.visitors)} label="visitantes únicos" />
        <Stat value={String(m.sessions)} label="sessões" />
        <Stat value={String(m.pageviews)} label="pageviews" />
        <Stat value={fmtDuration(m.avgSessionSec)} label="tempo médio de sessão" />
        <Stat value={`${Math.round(m.bounceRate * 100)}%`} label="taxa de rejeição" />
      </div>

      <section className="section">
        <div className="section-head">
          <h2 className="section-title">Visitantes ao longo do tempo</h2>
        </div>
        <div className="card chart-card">
          <BarChart data={m.timeseries} />
        </div>
      </section>

      <div className="tops">
        <TopList title="Top páginas" items={m.topPages} />
        <TopList title="Top países" items={m.topCountries} format={flagLabel} />
        <TopList title="Dispositivos" items={m.topDevices} format={deviceLabel} />
        <TopList title="Navegadores" items={m.topBrowsers} />
        <TopList title="Origens" items={m.topReferrers} />
      </div>
    </>
  );
}

function BarChart({ data }: { data: { bucket: string; visitors: number }[] }) {
  if (data.length === 0) return <p className="empty">Sem dados no período.</p>;

  const max = Math.max(...data.map((d) => d.visitors), 1);
  const W = 100;
  const H = 34;
  const gap = 1.5;
  const bw = (W - gap * (data.length - 1)) / data.length;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="bars">
      {data.map((d, i) => {
        const h = (d.visitors / max) * (H - 2);
        const x = i * (bw + gap);
        return (
          <rect
            key={d.bucket}
            x={x}
            y={H - h}
            width={bw}
            height={h}
            rx={0.4}
            className="bar"
          >
            <title>
              {new Date(d.bucket).toLocaleString()}: {d.visitors} visitantes
            </title>
          </rect>
        );
      })}
    </svg>
  );
}

function TopList({
  title,
  items,
  format,
}: {
  title: string;
  items: TopItem[];
  format?: (label: string) => string;
}) {
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

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="card stat">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

function fmtDuration(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${s}s`;
}

function flagLabel(code: string): string {
  if (code.length !== 2) return code;
  const A = 0x1f1e6;
  const flag = String.fromCodePoint(
    A + code.charCodeAt(0) - 65,
    A + code.charCodeAt(1) - 65
  );
  return `${flag} ${code}`;
}

function deviceLabel(d: string): string {
  return { mobile: "Celular", tablet: "Tablet", desktop: "Desktop" }[d] ?? d;
}
