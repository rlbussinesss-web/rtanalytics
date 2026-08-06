import { useCallback, useEffect, useRef, useState } from "react";
import { Replayer } from "rrweb";
import "rrweb/dist/style.css";
import { Bug, Flame, MousePointerClick, Plus, Star, X } from "lucide-react";
import { API_BASE_URL, getToken } from "./token";
import { avatarFor, deviceLabel, flag, fmtDuration } from "./lib/ui";

interface ReplaySummary {
  sessionId: string;
  chunks: number;
  startedAt: string;
  endedAt: string;
  durationSec: number;
  pages: number;
  clicks: number;
  rageClicks: number;
  errors: number;
  country: string | null;
  device: string | null;
  browser: string | null;
  entryPath: string | null;
  favorite: boolean;
  tags: string[];
}

export function ReplaysPanel({ siteId }: { siteId: string }) {
  const [replays, setReplays] = useState<ReplaySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [playing, setPlaying] = useState<string | null>(null);
  const [favOnly, setFavOnly] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `${API_BASE_URL}/api/sites/${siteId}/replays${favOnly ? "?favorites=true" : ""}`,
        { headers: { Authorization: `Bearer ${getToken() ?? ""}` } }
      );
      if (res.ok) setReplays((await res.json()).replays as ReplaySummary[]);
    } finally {
      setLoading(false);
    }
  }, [siteId, favOnly]);

  useEffect(() => {
    void load();
  }, [load]);

  const patchMeta = useCallback(
    async (sessionId: string, patch: { favorite?: boolean; tags?: string[] }) => {
      // Optimistic update.
      setReplays((prev) => prev.map((r) => (r.sessionId === sessionId ? { ...r, ...patch } : r)));
      await fetch(`${API_BASE_URL}/api/sites/${siteId}/sessions/${sessionId}/meta`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken() ?? ""}` },
        body: JSON.stringify(patch),
      }).catch(() => undefined);
    },
    [siteId]
  );

  return (
    <section>
      <div className="segment" style={{ marginBottom: 16 }}>
        <button className={!favOnly ? "is-active" : ""} onClick={() => setFavOnly(false)}>Todas</button>
        <button className={favOnly ? "is-active" : ""} onClick={() => setFavOnly(true)}>
          <Star size={13} /> Favoritas
        </button>
      </div>

      {loading && <p className="empty">Carregando…</p>}
      {!loading && replays.length === 0 && (
        <div className="card empty-rich">
          <span className="ico"><MousePointerClick size={20} /></span>
          <b>Nenhuma gravação {favOnly ? "favorita" : "ainda"}</b>
          <p>Assista uma sessão ao vivo — ela fica gravada para rever aqui depois.</p>
        </div>
      )}

      <div className="replay-grid">
        {replays.map((r) => (
          <ReplayCard key={r.sessionId} r={r} onPlay={() => setPlaying(r.sessionId)} onPatch={patchMeta} />
        ))}
      </div>

      {playing && (
        <RecordedPlayer siteId={siteId} sessionId={playing} onClose={() => setPlaying(null)} />
      )}
    </section>
  );
}

function ReplayCard({
  r,
  onPlay,
  onPatch,
}: {
  r: ReplaySummary;
  onPlay: () => void;
  onPatch: (id: string, patch: { favorite?: boolean; tags?: string[] }) => void;
}) {
  const av = avatarFor(r.sessionId);
  const [adding, setAdding] = useState(false);
  const [tagInput, setTagInput] = useState("");

  const addTag = () => {
    const t = tagInput.trim();
    if (t && !r.tags.includes(t)) onPatch(r.sessionId, { tags: [...r.tags, t] });
    setTagInput("");
    setAdding(false);
  };

  return (
    <div className="card replay-card">
      <div className="vc-top">
        <span className="avatar" style={{ background: av.color }}>{av.initials}</span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="vc-id">Sessão {r.sessionId.slice(0, 6)}</div>
          <div className="vc-loc">{[flag(r.country ?? undefined), r.country, r.browser].filter(Boolean).join(" · ") || "—"}</div>
        </div>
        <button
          className={`star-btn${r.favorite ? " is-fav" : ""}`}
          title="Favoritar"
          onClick={() => onPatch(r.sessionId, { favorite: !r.favorite })}
        >
          <Star size={16} fill={r.favorite ? "currentColor" : "none"} />
        </button>
      </div>

      <div className="replay-stats">
        <div><b>{fmtDuration(r.durationSec)}</b><span>duração</span></div>
        <div><b>{r.pages}</b><span>páginas</span></div>
        <div><b>{r.clicks}</b><span>cliques</span></div>
        <div><b>{deviceLabel(r.device ?? undefined)}</b><span>dispositivo</span></div>
      </div>

      <div className="vc-meta">
        {r.rageClicks > 0 && <span className="chip chip-warn"><Flame />{r.rageClicks} rage</span>}
        {r.errors > 0 && <span className="chip chip-bad"><Bug />{r.errors} erro(s)</span>}
        {r.entryPath && <span className="chip">{r.entryPath}</span>}
      </div>

      <div className="tag-row">
        {r.tags.map((t) => (
          <span key={t} className="tag-chip">
            {t}
            <button onClick={() => onPatch(r.sessionId, { tags: r.tags.filter((x) => x !== t) })}><X size={11} /></button>
          </span>
        ))}
        {adding ? (
          <input
            className="tag-input"
            autoFocus
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addTag()}
            onBlur={addTag}
            placeholder="tag…"
          />
        ) : (
          <button className="tag-add" onClick={() => setAdding(true)}><Plus size={12} /> tag</button>
        )}
      </div>

      <button className="btn btn-primary btn-sm" style={{ justifyContent: "center" }} onClick={onPlay}>
        Reproduzir
      </button>
    </div>
  );
}

function RecordedPlayer({ siteId, sessionId, onClose }: { siteId: string; sessionId: string; onClose: () => void }) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState("carregando gravação…");

  const fit = useCallback(() => {
    const stage = stageRef.current;
    const host = hostRef.current;
    const wrapper = host?.querySelector<HTMLElement>(".replayer-wrapper");
    const iframe = host?.querySelector("iframe");
    if (!stage || !host || !wrapper || !iframe) return;
    const w = iframe.offsetWidth, h = iframe.offsetHeight;
    if (!w || !h) return;
    // Fit to width, scroll vertically (see LiveScreen for the rationale).
    const scale = Math.min((stage.clientWidth - 24) / w, 1);
    wrapper.style.transformOrigin = "top left";
    wrapper.style.transform = `scale(${scale})`;
    host.style.width = `${w * scale}px`;
    host.style.height = `${h * scale}px`;
    host.style.margin = "0 auto";
  }, []);

  useEffect(() => {
    let replayer: Replayer | null = null;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/sites/${siteId}/replays/${sessionId}`, {
          headers: { Authorization: `Bearer ${getToken() ?? ""}` },
        });
        if (!res.ok) { setStatus("não foi possível carregar"); return; }
        const data = (await res.json()) as { frames: unknown[] };
        if (cancelled || !hostRef.current) return;
        if (data.frames.length < 2) { setStatus("gravação muito curta"); return; }
        replayer = new Replayer(data.frames as never[], { root: hostRef.current, skipInactive: true, mouseTail: { duration: 800 } });
        replayer.play();
        setStatus("");
        requestAnimationFrame(fit);
      } catch {
        setStatus("erro ao carregar");
      }
    })();
    return () => { cancelled = true; replayer?.destroy?.(); };
  }, [siteId, sessionId, fit]);

  // Refit repeatedly: the iframe gets its real size a beat after mount.
  useEffect(() => {
    window.addEventListener("resize", fit);
    const iv = setInterval(fit, 400);
    return () => {
      window.removeEventListener("resize", fit);
      clearInterval(iv);
    };
  }, [fit]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="backdrop" onClick={onClose}>
      <div className="viewer" onClick={(e) => e.stopPropagation()}>
        <header className="viewer-head">
          <strong>Gravação</strong>
          <span className="mono">{sessionId.slice(0, 8)}</span>
          {status && <span className="section-count">{status}</span>}
          <button className="btn btn-ghost btn-sm spacer" onClick={onClose}>Fechar</button>
        </header>
        <div className="stage" ref={stageRef}><div ref={hostRef} /></div>
      </div>
    </div>
  );
}
