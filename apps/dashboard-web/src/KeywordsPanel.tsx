import { Download, Search } from "lucide-react";
import { useKeywords, type KeywordRow } from "./useKeywords";
import type { RangeKey } from "./useMetrics";
import { downloadCsv } from "./lib/export";

const RANGES: [RangeKey, string][] = [["24h", "24 horas"], ["7d", "7 dias"], ["30d", "30 dias"]];

export function KeywordsPanel({
  siteId,
  range,
  onRangeChange,
}: {
  siteId: string;
  range: RangeKey;
  onRangeChange: (r: RangeKey) => void;
}) {
  const { data, loading } = useKeywords(siteId, range);

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
        {data && data.rows.length > 0 && (
          <button className="btn btn-ghost btn-sm spacer" onClick={() => exportKeywords(data)}>
            <Download size={14} /> Exportar CSV
          </button>
        )}
      </div>

      {!data && loading && (
        <div className="card"><div className="skel" style={{ width: "100%", height: 120 }} /></div>
      )}

      {data && data.rows.length === 0 && (
        <div className="card empty-state">
          <Search size={22} />
          <h3>Sem palavras-chave ainda</h3>
          <p>
            Quando visitantes chegarem via Google Ads Pesquisa com o parâmetro{" "}
            <code>keyword=...</code> na URL, as palavras-chave que mais trazem
            tráfego até o pagamento aparecem aqui.
          </p>
        </div>
      )}

      {data && data.rows.length > 0 && (
        <>
          {/* Summary */}
          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", marginBottom: 22 }}>
            <div className="card stat-card">
              <Search size={16} style={{ color: "#8b5cf6", marginBottom: 8 }} />
              <div style={{ fontSize: 28, fontWeight: 700 }}>{data.totalSessions}</div>
              <div style={{ opacity: 0.6, fontSize: 13 }}>Sessões por keyword</div>
            </div>
            <div className="card stat-card">
              <div style={{ fontSize: 14, color: "#fbbf24", marginBottom: 8 }}>💳</div>
              <div style={{ fontSize: 28, fontWeight: 700 }}>{data.totalReachedPayment}</div>
              <div style={{ opacity: 0.6, fontSize: 13 }}>Chegaram no pagamento</div>
            </div>
            <div className="card stat-card">
              <div style={{ fontSize: 14, color: "#10b981", marginBottom: 8 }}>📊</div>
              <div style={{ fontSize: 28, fontWeight: 700 }}>
                {data.totalSessions > 0
                  ? ((data.totalReachedPayment / data.totalSessions) * 100).toFixed(1)
                  : "0"}%
              </div>
              <div style={{ opacity: 0.6, fontSize: 13 }}>Taxa até pagamento</div>
            </div>
          </div>

          {/* Table */}
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border, #2a2a3a)" }}>
                  <th style={thStyle}>Palavra-chave</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>Sessões</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>Chegaram no pagamento</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>Taxa pagamento</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>Converteram</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>Taxa conversão</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row, i) => (
                  <tr
                    key={row.keyword}
                    style={{
                      borderBottom: i < data.rows.length - 1 ? "1px solid var(--border, #2a2a3a)" : "none",
                    }}
                  >
                    <td style={{ ...tdStyle, fontWeight: 500, maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {row.keyword}
                    </td>
                    <td style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                      {row.sessions}
                    </td>
                    <td style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                      <span style={{ color: row.reachedPayment > 0 ? "#fbbf24" : undefined }}>
                        {row.reachedPayment}
                      </span>
                    </td>
                    <td style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                      <PaymentBar rate={row.paymentRate} />
                    </td>
                    <td style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                      <span style={{ color: row.converted > 0 ? "#10b981" : undefined }}>
                        {row.converted}
                      </span>
                    </td>
                    <td style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                      {(row.conversionRate * 100).toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function PaymentBar({ rate }: { rate: number }) {
  const pct = Math.round(rate * 100);
  const color = pct >= 50 ? "#10b981" : pct >= 20 ? "#fbbf24" : "#ef4444";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span
        style={{
          display: "inline-block",
          width: 48,
          height: 6,
          borderRadius: 3,
          background: "var(--surface-2, #1e1e2e)",
          overflow: "hidden",
        }}
      >
        <span
          style={{
            display: "block",
            height: "100%",
            width: `${Math.min(pct, 100)}%`,
            borderRadius: 3,
            background: color,
          }}
        />
      </span>
      <span>{pct}%</span>
    </span>
  );
}

const thStyle: React.CSSProperties = {
  padding: "12px 16px",
  textAlign: "left",
  fontWeight: 600,
  fontSize: 12,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  opacity: 0.6,
};

const tdStyle: React.CSSProperties = {
  padding: "10px 16px",
};

function exportKeywords(data: { rows: KeywordRow[]; range: string }) {
  const rows: (string | number)[][] = [
    ["Palavra-chave", "Sessões", "Chegaram no pagamento", "Taxa pagamento", "Converteram", "Taxa conversão"],
    ...data.rows.map((r) => [
      r.keyword,
      r.sessions,
      r.reachedPayment,
      `${(r.paymentRate * 100).toFixed(1)}%`,
      r.converted,
      `${(r.conversionRate * 100).toFixed(1)}%`,
    ]),
  ];
  downloadCsv(`rtanalytics-keywords-${data.range}.csv`, rows);
}