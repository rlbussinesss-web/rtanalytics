import { Crown, Download, Trophy } from "lucide-react";
import { useAudience, type Audience, type SegmentRow } from "./useAudience";
import type { RangeKey } from "./useMetrics";
import { flag, deviceLabel } from "./lib/ui";
import { downloadCsv } from "./lib/export";

const RANGES: [RangeKey, string][] = [["24h", "24 horas"], ["7d", "7 dias"], ["30d", "30 dias"]];

/** How each dimension is titled and how its labels are rendered. */
const DIMENSIONS: { key: string; title: string; format?: (l: string) => string }[] = [
  { key: "source", title: "Origem (utm_source)" },
  { key: "campaign", title: "Campanha (utm_campaign)" },
  { key: "medium", title: "Mídia (utm_medium)" },
  { key: "device", title: "Dispositivo", format: deviceLabel },
  { key: "country", title: "País", format: (c) => `${flag(c)} ${c}` },
  { key: "region", title: "Estado / região" },
  { key: "browser", title: "Navegador" },
];

/** Minimum sessions before a segment's conversion rate is trustworthy enough
 * to crown as the "winning audience" — a 1-session 100% rate is noise. */
const MIN_SESSIONS_FOR_WINNER = 5;

export function AudiencePanel({
  siteId,
  range,
  onRangeChange,
}: {
  siteId: string;
  range: RangeKey;
  onRangeChange: (r: RangeKey) => void;
}) {
  const { audience, loading } = useAudience(siteId, range);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 18 }}>
        <div className="segment">
          {RANGES.map(([k, label]) => (
            <button key={k} className={k === range ? "is-active" : ""} onClick={() => onRangeChange(k)}>
              {label}
            </button>
          ))}
        </div>
        {audience && (
          <button className="btn btn-ghost btn-sm spacer" onClick={() => exportAudience(audience)}>
            <Download size={14} /> Exportar CSV
          </button>
        )}
      </div>

      {!audience && loading && <div className="card"><div className="skel" style={{ width: "100%", height: 120 }} /></div>}
      {audience && <AudienceBody a={audience} />}
    </div>
  );
}

function AudienceBody({ a }: { a: Audience }) {
  const winner = findWinner(a);
  const hasAny = Object.values(a.dimensions).some((rows) => rows.length > 0);

  if (!hasAny) {
    return (
      <div className="card empty-state">
        <Trophy size={22} />
        <h3>Ainda sem dados de público</h3>
        <p>
          Assim que os visitantes chegarem com parâmetros de campanha (utm_source, utm_campaign…) e
          gerarem conversões, o público que mais compra aparece aqui — cruzado por origem, campanha,
          dispositivo, país e estado.
        </p>
      </div>
    );
  }

  return (
    <>
      {winner && (
        <div className="card winner-card">
          <div className="winner-badge"><Crown size={16} /> Público vencedor</div>
          <div className="winner-main">
            <div>
              <span className="winner-dim">{winner.dimTitle}</span>
              <h2>{winner.format ? winner.format(winner.row.label) : winner.row.label}</h2>
            </div>
            <div className="winner-stats">
              <div>
                <b>{(winner.row.conversionRate * 100).toFixed(1)}%</b>
                <span>conversão</span>
              </div>
              <div>
                <b>{winner.row.conversions}</b>
                <span>de {winner.row.sessions} sessões</span>
              </div>
              {winner.row.revenue > 0 && (
                <div>
                  <b>{fmtMoney(winner.row.revenue)}</b>
                  <span>receita</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="tops audience-grid">
        {DIMENSIONS.map((d) => (
          <SegmentCard
            key={d.key}
            title={d.title}
            rows={a.dimensions[d.key] ?? []}
            format={d.format}
          />
        ))}
      </div>
    </>
  );
}

function SegmentCard({
  title,
  rows,
  format,
}: {
  title: string;
  rows: SegmentRow[];
  format?: (l: string) => string;
}) {
  const maxRate = Math.max(...rows.map((r) => r.conversionRate), 0.0001);
  return (
    <div className="card top-card">
      <div className="top-title">{title}</div>
      {rows.length === 0 && <div className="empty">—</div>}
      {rows.map((r) => (
        <div key={r.label} className="seg-row">
          <div className="seg-head">
            <span className="seg-label">{format ? format(r.label) : r.label}</span>
            <span className="seg-rate">{(r.conversionRate * 100).toFixed(1)}%</span>
          </div>
          <div className="seg-bar-track">
            <span
              className="seg-bar"
              style={{ width: `${(r.conversionRate / maxRate) * 100}%` }}
            />
          </div>
          <div className="seg-meta">
            {r.conversions}/{r.sessions} sessões
            {r.revenue > 0 && <span className="seg-rev"> · {fmtMoney(r.revenue)}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

/** The best-converting segment across every dimension, ignoring tiny samples. */
function findWinner(
  a: Audience
): { dimTitle: string; row: SegmentRow; format?: (l: string) => string } | null {
  let best: { dimTitle: string; row: SegmentRow; format?: (l: string) => string } | null = null;
  for (const d of DIMENSIONS) {
    for (const row of a.dimensions[d.key] ?? []) {
      if (row.sessions < MIN_SESSIONS_FOR_WINNER || row.conversions === 0) continue;
      if (!best || row.conversionRate > best.row.conversionRate) {
        best = { dimTitle: d.title, row, format: d.format };
      }
    }
  }
  return best;
}

function fmtMoney(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function exportAudience(a: Audience) {
  const rows: (string | number)[][] = [["Dimensão", "Segmento", "Sessões", "Conversões", "Taxa", "Receita"]];
  for (const d of DIMENSIONS) {
    for (const r of a.dimensions[d.key] ?? []) {
      rows.push([
        d.title,
        r.label,
        r.sessions,
        r.conversions,
        `${(r.conversionRate * 100).toFixed(1)}%`,
        r.revenue,
      ]);
    }
  }
  downloadCsv(`rtanalytics-publico-${a.range}.csv`, rows);
}
