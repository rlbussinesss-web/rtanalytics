import { useEffect, useMemo, useRef, useState } from "react";
import { Users } from "lucide-react";
import type { LiveEvent } from "./useLiveEvents";
import { flag, deviceLabel, fmtDuration, sinceLabel } from "./lib/ui";

/**
 * Ao Vivo — the control room.
 *
 * Not a session table: a live stream of visitor "presences" on the left and a
 * breathing focal panel on the right. Buying intent (reaching checkout/cart, or
 * a recorded conversion) surfaces as a gold chip the moment it happens, so what
 * matters reads at a glance. Everything derives from the live event feed — no
 * polling, the panel only moves when the server pushes.
 */

interface Props {
  onlineCount: number;
  sessions: string[];
  events: LiveEvent[];
  infoBySession: Map<string, LiveEvent>;
  visibilityBySession: Map<string, "visible" | "hidden" | "left">;
  firstSeen: Map<string, number>;
  onWatch: (id: string) => void;
}

const HOT = /\/(pagamento|checkout|carrinho|cart|payment)/i;

type Intent = "converted" | "checkout" | "cart" | "browsing" | "away";

function classify(path: string, active: boolean, converted: boolean): Intent {
  if (converted) return "converted";
  if (/\/(pagamento|checkout|payment)/i.test(path)) return "checkout";
  if (/\/(carrinho|cart)/i.test(path)) return "cart";
  return active ? "browsing" : "away";
}

const INTENT_LABEL: Record<Intent, string> = {
  converted: "Convertido",
  checkout: "No checkout",
  cart: "No carrinho",
  browsing: "Navegando",
  away: "",
};

export function AoVivo({ onlineCount, sessions, events, infoBySession, visibilityBySession, firstSeen, onWatch }: Props) {
  // Sessions that produced a conversion this live window — the strongest signal.
  const converted = useMemo(() => {
    const s = new Set<string>();
    for (const e of events) if (e.eventType === "conversion") s.add(e.sessionId);
    return s;
  }, [events]);

  const rows = useMemo(() => {
    const out = sessions.map((sessionId) => {
      const info = infoBySession.get(sessionId);
      const vis = visibilityBySession.get(sessionId);
      const active = vis !== "hidden" && vis !== "left";
      const path = info?.path ?? "/";
      const isConv = converted.has(sessionId);
      const intent = classify(path, active, isConv);
      const source =
        (info?.payload?.utm_source as string | undefined) ??
        (info?.payload?.utm_campaign as string | undefined);
      return {
        sessionId,
        path,
        intent,
        active,
        hot: isConv || HOT.test(path),
        country: info?.country,
        city: info?.city,
        device: info?.device,
        source,
        since: firstSeen.get(sessionId) ?? Date.now(),
      };
    });
    // Buyers first, then active browsers, then backgrounded.
    const rank = (r: (typeof out)[number]) =>
      r.intent === "converted" ? 0 : r.hot ? 1 : r.active ? 2 : 3;
    return out.sort((a, b) => rank(a) - rank(b) || b.since - a.since);
  }, [sessions, infoBySession, visibilityBySession, converted, firstSeen]);

  const liveCount = rows.filter((r) => r.active).length;
  const awayCount = rows.length - liveCount;
  const checkoutCount = rows.filter((r) => r.intent === "checkout" || r.intent === "cart").length;

  const spark = useMemo(() => bucketize(events, 22, 8_000), [events]);
  const delta = useDelta(onlineCount);

  const tape = useMemo(
    () =>
      events
        .filter((e) => e.eventType === "conversion" || e.eventType === "pageview")
        .slice(0, 8),
    [events]
  );

  return (
    <div className="floor">
      <div className="floor-stream">
        <div className="stream-head">
          <span className="t">Fluxo de visitantes</span>
          <span className="c">{rows.length} · tempo real</span>
        </div>
        <div className="stream-rows">
          {rows.length === 0 && (
            <div className="floor-empty">
              <div>
                <span className="ico"><Users size={22} /></span>
                <p>Aguardando visitantes.<br />Quem chegar aparece aqui na hora.</p>
              </div>
            </div>
          )}
          {rows.map((r) => (
            <button
              key={r.sessionId}
              className={`vpresence${r.hot ? " hot" : ""}`}
              onClick={() => onWatch(r.sessionId)}
              title="Assistir sessão ao vivo"
            >
              <span className="vp-flag">{flag(r.country) || "🌐"}</span>
              <span className="vp-meta">
                <span className="vp-l1"><span className="pg">{r.path}</span></span>
                <span className="vp-l2">
                  {[locationOf(r.city, r.country), deviceLabel(r.device), r.source]
                    .filter(Boolean)
                    .map((part, i, arr) => (
                      <span key={i}>
                        {part}
                        {i < arr.length - 1 && <span className="sep">·</span>}
                      </span>
                    ))}
                </span>
              </span>
              {r.intent === "away" ? (
                <span className="vp-dwell">{sinceLabel(r.since)}</span>
              ) : (
                <span className={`vp-intent ${r.intent === "converted" || r.intent === "checkout" || r.intent === "cart" ? "buy" : "browse"}`}>
                  {INTENT_LABEL[r.intent]}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="floor-focal">
        <div className="focal-top">
          <div className="focal-now">
            <span className="k">Visitantes agora</span>
            <span className="v">
              {onlineCount}
              {delta !== 0 && (
                <span className="delta" style={{ color: delta > 0 ? "var(--live)" : "var(--text-muted)" }}>
                  {delta > 0 ? "▲" : "▼"} {Math.abs(delta)}
                </span>
              )}
            </span>
            <div className="focal-split">
              <div><span className="n live">{liveCount}</span><span className="s">interagindo</span></div>
              <div><span className="n bg">{awayCount}</span><span className="s">segundo plano</span></div>
              <div><span className="n buy">{checkoutCount}</span><span className="s">no checkout</span></div>
            </div>
          </div>
          <Spark values={spark} />
        </div>

        {checkoutCount > 0 ? (
          <div className="focal-signal">
            <span className="ic">{checkoutCount}</span>
            <div className="tx">
              <b>{checkoutCount === 1 ? "1 pessoa no checkout agora" : `${checkoutCount} pessoas no checkout agora`}</b>
              <p>Pico de intenção de compra. Momento de assistir ou intervir.</p>
            </div>
            <button className="go" onClick={() => onWatch(rows.find((r) => r.intent === "checkout" || r.intent === "cart")!.sessionId)}>
              Assistir ao vivo →
            </button>
          </div>
        ) : (
          <div className="focal-signal" style={{ borderColor: "var(--border)", background: "none" }}>
            <span className="ic" style={{ background: "var(--surface-3)", color: "var(--text-muted)" }}>
              {liveCount}
            </span>
            <div className="tx">
              <b>{liveCount} {liveCount === 1 ? "visitante interagindo" : "visitantes interagindo"}</b>
              <p>Sem ninguém no checkout no momento. O sinal de compra aparece aqui.</p>
            </div>
          </div>
        )}

        <div className="focal-tape">
          {tape.length === 0 && <span className="ts">aguardando eventos…</span>}
          {tape.map((e) => (
            <span key={e.eventId}>
              <span className="ts">{new Date(e.timestamp).toLocaleTimeString()}</span>{" "}
              <b>{e.eventType === "conversion" ? "Conversão" : "Pageview"}</b> · {e.path}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function locationOf(city?: string, country?: string): string {
  if (city && country) return `${city}, ${country}`;
  return city ?? country ?? "";
}

/** Tracks the change in a value between renders — for the ▲/▼ delta chip. */
function useDelta(value: number): number {
  const prev = useRef(value);
  const [delta, setDelta] = useState(0);
  useEffect(() => {
    setDelta(value - prev.current);
    prev.current = value;
  }, [value]);
  return delta;
}

function Spark({ values }: { values: number[] }) {
  const w = 220, h = 86, max = Math.max(...values, 1);
  const step = values.length > 1 ? w / (values.length - 1) : w;
  const pts = values.map((v, i) => [i * step, h - 6 - (v / max) * (h - 16)] as const);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const area = `${line} L${w} ${h} L0 ${h} Z`;
  const last = pts[pts.length - 1];
  return (
    <svg className="focal-spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`} fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="floorSpark" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--live)" stopOpacity="0.33" />
          <stop offset="1" stopColor="var(--live)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#floorSpark)" />
      <path d={line} fill="none" stroke="var(--live)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {last && <circle cx={last[0]} cy={last[1]} r="3.5" fill="var(--live)" />}
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
