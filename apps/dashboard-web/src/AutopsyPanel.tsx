import { useEffect, useState } from "react";
import { CircleDollarSign, Image, MousePointerClick, Play, TextCursorInput, Type } from "lucide-react";
import { API_BASE_URL, getToken } from "./token";
import { RecordedPlayer } from "./ReplaysPanel";
import type { RangeKey } from "./useMetrics";

/**
 * Abandonment autopsy.
 *
 * Deliberately not a dashboard. It reads as a report: a ranked list of
 * objections, each one a sentence about a specific thing on the page that
 * people were looking at when they gave up — with the recordings that prove it,
 * so the reader can disagree in twenty seconds instead of taking it on faith.
 */

interface Objection {
  id: string;
  label: string;
  kind: "campo" | "botão" | "texto" | "imagem" | "preço";
  path: string;
  sessions: number;
  share: number;
  estimatedLostConversions: number;
  estimatedLostRevenue: number | null;
  y: number;
  h: number;
  sampleSessions: string[];
}

interface AutopsyReport {
  range: RangeKey;
  examined: number;
  skippedNoTrail: number;
  enoughData: boolean;
  objections: Objection[];
  missingMaps: string[];
}

const RANGES: [RangeKey, string][] = [["24h", "24 horas"], ["7d", "7 dias"], ["30d", "30 dias"]];

const KIND_ICON: Record<Objection["kind"], React.ReactNode> = {
  campo: <TextCursorInput size={15} />,
  botão: <MousePointerClick size={15} />,
  preço: <CircleDollarSign size={15} />,
  imagem: <Image size={15} />,
  texto: <Type size={15} />,
};

const money = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

export function AutopsyPanel({
  siteId,
  range,
  onRangeChange,
}: {
  siteId: string;
  range: RangeKey;
  onRangeChange: (r: RangeKey) => void;
}) {
  const [data, setData] = useState<AutopsyReport | null>(null);
  const [loading, setLoading] = useState(true);
  // The evidence is always a past session, so it plays in the recorded player;
  // the live viewer would sit waiting for frames that will never arrive.
  const [playing, setPlaying] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/sites/${siteId}/autopsy?range=${range}`, {
          headers: { Authorization: `Bearer ${getToken() ?? ""}` },
        });
        if (res.ok && !cancelled) setData((await res.json()) as AutopsyReport);
      } catch {
        /* keep the previous report */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [siteId, range]);

  return (
    <div>
      <div className="segment" style={{ marginBottom: 18 }}>
        {RANGES.map(([k, label]) => (
          <button key={k} className={k === range ? "is-active" : ""} onClick={() => onRangeChange(k)}>
            {label}
          </button>
        ))}
      </div>

      {loading && !data && <div className="card ap-empty">analisando desistências…</div>}

      {data && (
        <>
          <div className="ap-summary">
            <b>{data.examined}</b> desistência(s) examinada(s)
            {data.skippedNoTrail > 0 && (
              <span className="ap-note">
                {" "}· {data.skippedNoTrail} sem trilha de posição (ignoradas, não estimadas)
              </span>
            )}
          </div>

          {data.missingMaps.length > 0 && (
            <div className="card ap-warn">
              Ainda sem mapa de conteúdo para: <code>{data.missingMaps.join(", ")}</code>. O mapa é
              capturado na primeira visita após a publicação — sem ele, a posição não vira conteúdo.
            </div>
          )}

          {!data.enoughData && (
            <div className="card ap-empty">
              <b>Ainda não há padrão para relatar</b>
              <p>
                Um grupo só vira objeção a partir de 3 pessoas parando no mesmo ponto — abaixo disso
                é anedota, não padrão. Conforme o tráfego chegar, os grupos se formam aqui sozinhos.
              </p>
            </div>
          )}

          {data.objections.map((o) => (
            <article key={o.id} className="card ap-card">
              <div className="ap-kind">
                {KIND_ICON[o.kind]} {o.kind}
                <span className="ap-path">{o.path}</span>
              </div>

              <h3 className="ap-label">“{o.label}”</h3>

              <p className="ap-verdict">
                <b>{o.sessions}</b> pessoa(s) pararam aqui e não converteram —{" "}
                {Math.round(o.share * 100)}% de todas as desistências.
              </p>

              <div className="ap-cost">
                <span>
                  ≈ <b>{o.estimatedLostConversions}</b> conversões perdidas
                </span>
                {o.estimatedLostRevenue != null && (
                  <span className="ap-money">≈ {money(o.estimatedLostRevenue)}</span>
                )}
              </div>

              {o.sampleSessions.length > 0 && (
                <div className="ap-proof">
                  <span>Confira você mesmo:</span>
                  {o.sampleSessions.map((s) => (
                    <button key={s} className="ap-watch" onClick={() => setPlaying(s)}>
                      <Play size={12} fill="currentColor" stroke="none" /> {s.slice(0, 4)}
                    </button>
                  ))}
                </div>
              )}
            </article>
          ))}
        </>
      )}

      {playing && (
        <RecordedPlayer siteId={siteId} sessionId={playing} onClose={() => setPlaying(null)} />
      )}
    </div>
  );
}
