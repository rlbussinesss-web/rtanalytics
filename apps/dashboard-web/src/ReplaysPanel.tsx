import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Replayer } from "rrweb";
import "rrweb/dist/style.css";
import { Bug, EyeOff, Flame, LogOut, MousePointerClick, Pause, Play, Plus, Star, X } from "lucide-react";
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

// Minimal view of the rrweb Replayer methods this player drives.
interface ReplayerCtl {
  play: (offsetMs?: number) => void;
  pause: (offsetMs?: number) => void;
  getCurrentTime: () => number;
  getMetaData: () => { totalTime: number; startTime: number };
  setConfig: (c: { speed?: number }) => void;
  destroy?: () => void;
}

interface TimelineMarker {
  offsetMs: number;
  pct: number;
  state: string;
}

const SPEEDS = [1, 2, 4, 8];

function RecordedPlayer({ siteId, sessionId, onClose }: { siteId: string; sessionId: string; onClose: () => void }) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const replayerRef = useRef<ReplayerCtl | null>(null);
  const rafRef = useRef<number>(0);
  const scrubbingRef = useRef(false);
  const [status, setStatus] = useState("carregando gravação…");
  const [playing, setPlaying] = useState(false);
  const [currentMs, setCurrentMs] = useState(0);
  const [totalMs, setTotalMs] = useState(0);
  const [speed, setSpeed] = useState(1);
  // Full visibility timeline (offset + state) so we can both draw ticks and,
  // during playback, show an overlay while the visitor was away.
  const [visEvents, setVisEvents] = useState<{ offsetMs: number; state: string }[]>([]);
  const [dismissedEpisode, setDismissedEpisode] = useState<number | null>(null);

  const markers = useMemo<TimelineMarker[]>(
    () =>
      totalMs
        ? visEvents
            .filter((v) => v.state === "hidden" || v.state === "left")
            .map((v) => ({ ...v, pct: (v.offsetMs / totalMs) * 100 }))
        : [],
    [visEvents, totalMs]
  );

  // Which state is in effect at the current playback position, and when that
  // episode began (used to key dismissals so a new away-episode re-shows).
  const away = useMemo(() => {
    let state = "visible";
    let since = 0;
    for (const v of visEvents) {
      if (v.offsetMs <= currentMs) {
        state = v.state;
        since = v.offsetMs;
      } else break;
    }
    return { active: state === "hidden" || state === "left", state, since };
  }, [visEvents, currentMs]);

  // While playing, poll the replayer's clock to move the scrubber. rrweb
  // doesn't expose a reliable per-frame time event across versions, so a rAF
  // poll of getCurrentTime() is the robust way to stay in sync.
  const startTicking = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    const tick = () => {
      const r = replayerRef.current;
      if (r && !scrubbingRef.current) {
        const t = Math.min(r.getCurrentTime(), totalMs || Infinity);
        setCurrentMs(t);
        if (totalMs && t >= totalMs) {
          setPlaying(false);
          return;
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [totalMs]);

  const togglePlay = useCallback(() => {
    const r = replayerRef.current;
    if (!r) return;
    if (playing) {
      r.pause();
      setPlaying(false);
    } else {
      // Restart from the beginning if we're at the end.
      const from = totalMs && currentMs >= totalMs - 50 ? 0 : currentMs;
      r.play(from);
      setPlaying(true);
      startTicking();
    }
  }, [playing, currentMs, totalMs, startTicking]);

  const seekTo = useCallback((ms: number) => {
    const r = replayerRef.current;
    if (!r) return;
    setCurrentMs(ms);
    if (playing) r.play(ms);
    else r.pause(ms);
  }, [playing]);

  // Jump to a marker and PAUSE there. Markers point at away periods, which
  // skipInactive fast-forwards through — so if we kept playing, the player
  // would immediately skip past the very moment the marker points to and the
  // badge would flip back to "active". Pausing lets the viewer inspect it.
  const seekPausedTo = useCallback((ms: number) => {
    const r = replayerRef.current;
    if (!r) return;
    r.pause(ms);
    setPlaying(false);
    setCurrentMs(ms);
  }, []);

  const changeSpeed = useCallback((s: number) => {
    setSpeed(s);
    replayerRef.current?.setConfig({ speed: s });
  }, []);

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
        const data = (await res.json()) as {
          frames: unknown[];
          markers?: { tMs: number; state: string }[];
        };
        if (cancelled || !hostRef.current) return;
        if (data.frames.length < 2) { setStatus("gravação muito curta"); return; }
        replayer = new Replayer(data.frames as never[], { root: hostRef.current, skipInactive: true, mouseTail: { duration: 800 } });
        replayerRef.current = replayer as unknown as ReplayerCtl;
        const meta = (replayer as unknown as ReplayerCtl).getMetaData();
        const total = meta.totalTime;
        setTotalMs(total);
        // Full visibility timeline mapped onto the recording (offset = event
        // epoch minus recording start). Kept complete (incl. "visible") so the
        // overlay knows when the visitor came back.
        setVisEvents(
          (data.markers ?? [])
            .map((m) => ({ offsetMs: m.tMs - meta.startTime, state: m.state }))
            .filter((m) => m.offsetMs >= 0 && total > 0 && m.offsetMs <= total)
            .sort((a, b) => a.offsetMs - b.offsetMs)
        );
        replayer.play();
        setPlaying(true);
        setStatus("");
        requestAnimationFrame(fit);
      } catch {
        setStatus("erro ao carregar");
      }
    })();
    return () => {
      cancelled = true;
      cancelAnimationFrame(rafRef.current);
      replayer?.destroy?.();
      replayerRef.current = null;
    };
  }, [siteId, sessionId, fit]);

  // Kick off the scrubber clock once we know the total duration.
  useEffect(() => {
    if (totalMs > 0) startTicking();
    return () => cancelAnimationFrame(rafRef.current);
  }, [totalMs, startTicking]);

  // The away overlay is a momentary notice, not a persistent block: it appears
  // when playback enters an away episode and clears itself after a beat so the
  // (frozen) screen stays visible without the viewer clicking anything. The
  // header badge below keeps the state visible for the whole episode, and the
  // overlay also clears instantly the moment the visitor returns (away.active
  // flips false), which is exactly "disappears when the user comes back".
  useEffect(() => {
    if (away.active && dismissedEpisode !== away.since) {
      const id = setTimeout(() => setDismissedEpisode(away.since), 2800);
      return () => clearTimeout(id);
    }
  }, [away.active, away.since, dismissedEpisode]);

  // Refit repeatedly: the iframe gets its real size a beat after mount.
  useEffect(() => {
    window.addEventListener("resize", fit);
    const iv = setInterval(fit, 400);
    return () => {
      window.removeEventListener("resize", fit);
      clearInterval(iv);
    };
  }, [fit]);

  // Keyboard shortcuts: Esc closes, Space play/pause, ← / → skip 5s.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === " ") { e.preventDefault(); togglePlay(); }
      else if (e.key === "ArrowLeft") seekTo(Math.max(0, currentMs - 5000));
      else if (e.key === "ArrowRight") seekTo(Math.min(totalMs, currentMs + 5000));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, togglePlay, seekTo, currentMs, totalMs]);

  return (
    <div className="backdrop" onClick={onClose}>
      <div className="viewer" onClick={(e) => e.stopPropagation()}>
        <header className="viewer-head">
          <strong>Gravação</strong>
          <span className="mono">{sessionId.slice(0, 8)}</span>
          {status && <span className="section-count">{status}</span>}
          {/* Persistent state badge — always shows whether, at the current
              playback moment, the visitor was active, backgrounded or gone. */}
          {away.active ? (
            <span className={`presence-badge ${away.state === "left" ? "bad" : "warn"}`}>
              {away.state === "left" ? <LogOut size={13} /> : <EyeOff size={13} />}
              {away.state === "left" ? "Havia saído" : "Segundo plano"}
            </span>
          ) : (
            <span className="presence-badge active"><i className="dot" /> Ativo</span>
          )}
          <button className="btn btn-ghost btn-sm spacer" onClick={onClose}>Fechar</button>
        </header>
        <div className="stage-wrap">
          <div className="stage" ref={stageRef}><div ref={hostRef} /></div>
          {away.active && dismissedEpisode !== away.since && (
            <div className="presence-overlay">
              <div className={`presence-card ${away.state === "left" ? "bad" : "warn"}`}>
                <button className="presence-close" title="Fechar" onClick={() => setDismissedEpisode(away.since)}>
                  <X size={15} />
                </button>
                <span className="presence-ico">
                  {away.state === "left" ? <LogOut size={14} /> : <EyeOff size={14} />}
                </span>
                <b>{away.state === "left" ? "Visitante saiu do site" : "Aba em segundo plano"}</b>
                <span>
                  Neste ponto da gravação, o visitante{" "}
                  {away.state === "left" ? "deixou o site." : "estava com a aba em segundo plano."}
                </span>
              </div>
            </div>
          )}
        </div>

        <div className="player-bar">
          <button className="play-btn" onClick={togglePlay} title={playing ? "Pausar (espaço)" : "Reproduzir (espaço)"}>
            {playing ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" />}
          </button>
          <span className="time-label">{fmtClock(currentMs)}</span>
          <div className="scrubber-wrap">
            <input
              className="scrubber"
              type="range"
              min={0}
              max={totalMs || 0}
              step={50}
              value={currentMs}
              style={{ ["--pct" as string]: `${totalMs ? (currentMs / totalMs) * 100 : 0}%` }}
              onPointerDown={() => { scrubbingRef.current = true; }}
              onChange={(e) => seekTo(Number(e.target.value))}
              onPointerUp={() => { scrubbingRef.current = false; }}
            />
            {markers.map((m, i) => (
              <button
                key={i}
                className={`tl-marker ${m.state === "left" ? "left" : "hidden"}`}
                style={{ left: `${m.pct}%` }}
                title={`${m.state === "left" ? "Saiu do site" : "Foi para segundo plano"} em ${fmtClock(m.offsetMs)} — clique para ver`}
                onClick={() => seekPausedTo(m.offsetMs)}
              />
            ))}
          </div>
          <span className="time-label">{fmtClock(totalMs)}</span>
          <div className="speed-group">
            {SPEEDS.map((s) => (
              <button key={s} className={`speed-btn${s === speed ? " is-active" : ""}`} onClick={() => changeSpeed(s)}>
                {s}×
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function fmtClock(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
