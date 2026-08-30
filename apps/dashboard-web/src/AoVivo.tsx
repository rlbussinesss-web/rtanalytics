import { useMemo } from "react";
import { CornerDownRight, Play, Target } from "lucide-react";
import type { LiveEvent } from "./useLiveEvents";
import { useMetrics } from "./useMetrics";
import { useAudience } from "./useAudience";
import { deviceLabel, sinceLabel } from "./lib/ui";

/**
 * Ao Vivo — the bento/radar screen.
 *
 * A glass bento grid: live presence up top-left, a bold conversion tile, a
 * traffic-by-hour line, a live event feed, session recordings and the top
 * converting campaigns. Live tiles come from the WebSocket feed (no polling);
 * the historical tiles (traffic, conversions, campaigns) come from the metrics
 * and audience endpoints over the last 24h. Every number is real — nothing is
 * mocked, so empty tiles simply read as "sem dados ainda".
 */

interface Props {
  siteId: string;
  onlineCount: number;
  sessions: string[];
  events: LiveEvent[];
  infoBySession: Map<string, LiveEvent>;
  visibilityBySession: Map<string, "visible" | "hidden" | "left">;
  firstSeen: Map<string, number>;
  onWatch: (id: string) => void;
}

const HOT = /\/(pagamento|checkout|carrinho|cart|payment)/i;
const nf = new Intl.NumberFormat("pt-BR");
const money = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

export function AoVivo(p: Props) {
  const { metrics: m } = useMetrics(p.siteId, "24h");
  const { audience: a } = useAudience(p.siteId, "24h");

  const converted = useMemo(() => {
    const s = new Set<string>();
    for (const e of p.events) if (e.eventType === "conversion") s.add(e.sessionId);
    return s;
  }, [p.events]);

  const spark = useMemo(() => bucketize(p.events, 26, 8_000), [p.events]);

  const liveCount = useMemo(
    () => p.sessions.filter((s) => { const v = p.visibilityBySession.get(s); return v !== "hidden" && v !== "left"; }).length,
    [p.sessions, p.visibilityBySession]
  );

  const feed = useMemo(
    () => p.events.filter((e) => e.eventType !== "visibility" && e.eventType !== "heartbeat").slice(0, 6),
    [p.events]
  );

  const sessionCards = useMemo(() => p.sessions.slice(0, 6).map((sessionId) => {
    const info = p.infoBySession.get(sessionId);
    const path = info?.path ?? "/";
    return {
      sessionId,
      path,
      host: info?.host,
      device: info?.device,
      hot: converted.has(sessionId) || HOT.test(path),
      since: sinceLabel(p.firstSeen.get(sessionId) ?? Date.now()),
    };
  }), [p.sessions, p.infoBySession, p.firstSeen, converted]);

  // Top converting campaigns → falls back to source when campaigns are absent.
  const topCampaigns = useMemo(() => {
    const rows = (a?.dimensions.campaign?.length ? a.dimensions.campaign : a?.dimensions.source) ?? [];
    return rows.filter((r) => r.conversions > 0).slice(0, 4);
  }, [a]);
  const campMax = Math.max(...topCampaigns.map((r) => r.conversionRate), 0.0001);

  const convRate = m ? Math.round(m.conversionRate * 1000) / 10 : 0;
  const uniquePct = m && m.pageviews > 0 ? Math.round((m.visitors / m.pageviews) * 100) : 0;

  return (
    <div className="bento">
      {/* Visitantes Ativos */}
      <section className="bt-tile bt-viz">
        <div className="bt-viz-top">
          <div className="bt-big"><span className="bt-num">{p.onlineCount}</span>
            <span className="bt-live"><span className="d" /> Ao vivo</span>
          </div>
          <div style={{ textAlign: "right" }}>
            <span className="bt-upd">tempo real</span>
          </div>
        </div>
        <div className="bt-viz-chart"><Spark values={spark} /></div>
        <div className="bt-viz-foot">
          <div><div className="k">Pageviews · 24h</div><div className="v o bt-num">{m ? nf.format(m.pageviews) : "—"}</div></div>
          <div><div className="k">Pessoas · 24h</div><div className="v bt-num">{m ? nf.format(m.visitors) : "—"}</div></div>
        </div>
      </section>

      {/* Dados de Tráfego */}
      <section className="bt-tile bt-traf">
        <div className="bt-h"><span className="t">Dados de Tráfego</span><span className="bt-kick">24h</span></div>
        <div className="row"><span className="lab">Visitas</span><span className="val"><b className="bt-num">{m ? nf.format(m.pageviews) : "—"}</b> <small>· 100%</small></span></div>
        <div className="bt-uline" />
        <div className="row"><span className="lab">Pessoas únicas</span><span className="val"><b className="bt-num">{m ? nf.format(m.visitors) : "—"}</b> <small>· {uniquePct}%</small></span></div>
        <div className="bt-uline g"><i style={{ width: `${uniquePct}%` }} /></div>
      </section>

      {/* Conversões (hero tile) */}
      <section className="bt-tile bt-hero">
        <div className="bt-h"><span className="ic"><Target size={15} /></span><span className="bt-kick" style={{ color: "rgba(255,255,255,.75)" }}>conversões</span></div>
        <div className="big bt-num">{m ? nf.format(m.conversions) : "—"}</div>
        <div className="sub">Conversões nas últimas 24h</div>
        <div className="bar"><i style={{ width: `${Math.min(100, convRate * 5)}%` }} /></div>
        <div className="legend"><span>Taxa {convRate.toFixed(1)}%</span><span>{m ? nf.format(m.sessions) : "—"} sessões</span></div>
      </section>

      {/* Visitantes por hora */}
      <section className="bt-tile bt-chart">
        <div className="bt-h"><span className="t">Visitantes por hora</span><span className="bt-kick">24h</span></div>
        <LineChart series={m?.timeseries.map((t) => t.visitors) ?? []} />
        <div className="legend"><span><i style={{ background: "var(--cyan)" }} />Visitantes</span></div>
      </section>

      {/* Eventos ao Vivo */}
      <section className="bt-tile bt-req">
        <div className="bt-h"><span className="t">Eventos ao Vivo</span><span className="cnt"><span className="d" /> {liveCount}</span></div>
        <div className="bt-req-list">
          {feed.length === 0 && <div className="bt-empty" style={{ padding: "14px 0" }}>aguardando eventos…</div>}
          {feed.map((e) => {
            const conv = e.eventType === "conversion";
            return (
              <div key={e.eventId} className="bt-req-row">
                <span className={`ic${conv ? " conv" : ""}`}>{conv ? <Target size={13} /> : <CornerDownRight size={13} />}</span>
                <div className="m">
                  <b>{eventLabel(e.eventType)} {e.country && <span className="fl">· {e.country}</span>}</b>
                  <p>{e.host ? e.host + e.path : e.path}</p>
                </div>
                <span className="tm">{new Date(e.timestamp).toLocaleTimeString()}</span>
              </div>
            );
          })}
        </div>
      </section>

      {/* Gravações de Sessão */}
      <section className="bt-tile bt-sess">
        <div className="bt-h"><span className="t">Gravações de Sessão <small>· {p.sessions.length} ao vivo</small></span></div>
        <div className="bt-sess-grid">
          {sessionCards.length === 0 && <div className="bt-empty">Nenhuma sessão ativa agora.</div>}
          {sessionCards.map((s) => (
            <button key={s.sessionId} className={`bt-scard${s.hot ? " hot" : ""}`} onClick={() => p.onWatch(s.sessionId)} title="Assistir ao vivo">
              <span className="sic"><Play size={15} fill="currentColor" stroke="none" /></span>
              <div className="sm">
                <b>Sessão {s.sessionId.slice(0, 4)} <span className="plat">{deviceLabel(s.device)}</span></b>
                <p><span>◷ {s.since}</span><span>{s.host ? s.host + s.path : s.path}</span></p>
              </div>
            </button>
          ))}
        </div>
      </section>

      {/* Conversões · comportamento */}
      <section className="bt-tile bt-vendas">
        <div className="bt-h"><span className="t">Conversões · Comportamento</span><span className="bt-kick">24h</span></div>
        <div className="bt-vgrid">
          <div><div className="k">Conversões</div><div className="v bt-num">{m ? nf.format(m.conversions) : "—"}</div></div>
          <div><div className="k">Taxa de conversão</div><div className="v o bt-num">{convRate.toFixed(1)}%</div></div>
          <div><div className="k">Novos visitantes</div><div className="v bt-num">{m ? nf.format(m.newVisitors) : "—"}</div></div>
          <div><div className="k">Recorrentes</div><div className="v bt-num">{m ? nf.format(m.returningVisitors) : "—"}</div></div>
          <div><div className="k">Rejeição</div><div className="v bt-num">{m ? Math.round(m.bounceRate * 100) : "—"}%</div></div>
          <div><div className="k">Págs / sessão</div><div className="v bt-num">{m ? m.pagesPerSession.toFixed(1) : "—"}</div></div>
        </div>
      </section>

      {/* Top campanhas por conversão */}
      <section className="bt-tile bt-criat">
        <div className="bt-h"><span className="t">Top campanhas · por conversão</span><span className="bt-kick">24h</span></div>
        {topCampaigns.length === 0 && <div className="bt-empty" style={{ textAlign: "left", padding: "16px 0" }}>Sem conversões atribuídas a campanhas ainda. Marque os links com <code>utm_campaign</code> para ver o ranking.</div>}
        {topCampaigns.map((r, i) => (
          <div key={r.label} className="bt-crow">
            <span className="rk">{i + 1}</span>
            <div className="cb">
              <div className="r1"><span className="nm">{r.label}</span><span className="amt">{r.revenue > 0 ? money(r.revenue) : `${(r.conversionRate * 100).toFixed(1)}%`}</span></div>
              <div className="track"><span className="fill" style={{ width: `${(r.conversionRate / campMax) * 100}%` }} /></div>
            </div>
            <span className="sales">{r.conversions} conv.</span>
          </div>
        ))}
      </section>
    </div>
  );
}

function eventLabel(type: string): string {
  return ({ pageview: "Pageview", conversion: "Conversão", click: "Clique", scroll: "Scroll", error: "Erro", "web-vitals": "Web Vitals", "replay-chunk": "Gravação" } as Record<string, string>)[type] ?? type;
}

function Spark({ values }: { values: number[] }) {
  const w = 520, h = 120, max = Math.max(...values, 1);
  const step = values.length > 1 ? w / (values.length - 1) : w;
  const pts = values.map((v, i) => [i * step, h - 8 - (v / max) * (h - 22)] as const);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" fill="none" aria-hidden="true">
      <defs><linearGradient id="btViz" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="var(--accent)" stopOpacity="0.28" /><stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
      </linearGradient></defs>
      {pts.length > 1 && <>
        <path d={`${line} L${w} ${h} L0 ${h} Z`} fill="url(#btViz)" />
        <path d={line} fill="none" stroke="var(--accent)" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
      </>}
    </svg>
  );
}

function LineChart({ series }: { series: number[] }) {
  const w = 520, h = 150, max = Math.max(...series, 1);
  const step = series.length > 1 ? w / (series.length - 1) : w;
  const pts = series.map((v, i) => `${(i * step).toFixed(1)},${(h - 12 - (v / max) * (h - 30)).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" fill="none" aria-hidden="true">
      {series.length > 1 && <polyline points={pts} fill="none" stroke="var(--cyan)" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />}
    </svg>
  );
}

/** Counts events into N trailing time buckets, for the live sparkline. */
function bucketize(events: LiveEvent[], buckets: number, sizeMs: number): number[] {
  const now = Date.now();
  const out = new Array(buckets).fill(0);
  for (const e of events) {
    const idx = buckets - 1 - Math.floor((now - e.timestamp) / sizeMs);
    if (idx >= 0 && idx < buckets) out[idx]++;
  }
  return out;
}
