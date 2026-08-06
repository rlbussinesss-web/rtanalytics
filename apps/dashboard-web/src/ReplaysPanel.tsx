import { useCallback, useEffect, useRef, useState } from "react";
import { Replayer } from "rrweb";
import "rrweb/dist/style.css";
import { API_BASE_URL, getToken } from "./token";

/**
 * Recorded session playback.
 *
 * Recordings exist only for sessions that were watched live at some point, so
 * this lists what's available and plays it back with rrweb's Replayer in
 * normal (non-live) mode, with rrweb's own controls.
 */

interface ReplaySummary {
  sessionId: string;
  chunks: number;
  startedAt: string;
  endedAt: string;
}

export function ReplaysPanel({ siteId }: { siteId: string }) {
  const [replays, setReplays] = useState<ReplaySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [playing, setPlaying] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/sites/${siteId}/replays`, {
          headers: { Authorization: `Bearer ${getToken() ?? ""}` },
        });
        if (res.ok && !cancelled) {
          const data = (await res.json()) as { replays: ReplaySummary[] };
          setReplays(data.replays);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [siteId]);

  return (
    <section className="section">
      <div className="section-head">
        <h2 className="section-title">Sessões gravadas</h2>
        <span className="section-count">{replays.length}</span>
      </div>
      {loading && <p className="empty">Carregando…</p>}
      {!loading && replays.length === 0 && (
        <p className="empty">
          Nenhuma gravação ainda. Assista uma sessão ao vivo — ela fica gravada
          para rever aqui depois.
        </p>
      )}
      <ul className="list">
        {replays.map((r) => (
          <li key={r.sessionId} className="row session-row">
            <span className="mono">{r.sessionId.slice(0, 8)}</span>
            <div className="session-meta">
              <span className="path">
                {new Date(r.startedAt).toLocaleString()} ·{" "}
                {durationLabel(r.startedAt, r.endedAt)}
              </span>
              <span className="meta-line">{r.chunks} trechos gravados</span>
            </div>
            <button className="btn btn-primary btn-sm" onClick={() => setPlaying(r.sessionId)}>
              Reproduzir
            </button>
          </li>
        ))}
      </ul>

      {playing && (
        <RecordedPlayer siteId={siteId} sessionId={playing} onClose={() => setPlaying(null)} />
      )}
    </section>
  );
}

function RecordedPlayer({
  siteId,
  sessionId,
  onClose,
}: {
  siteId: string;
  sessionId: string;
  onClose: () => void;
}) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState("carregando gravação…");

  const fit = useCallback(() => {
    const stage = stageRef.current;
    const wrapper = hostRef.current?.querySelector<HTMLElement>(".replayer-wrapper");
    const iframe = hostRef.current?.querySelector("iframe");
    if (!stage || !wrapper || !iframe) return;
    const w = iframe.offsetWidth;
    const h = iframe.offsetHeight;
    if (!w || !h) return;
    const scale = Math.min((stage.clientWidth - 32) / w, (stage.clientHeight - 32) / h, 1);
    wrapper.style.transform = `scale(${scale})`;
    wrapper.style.width = `${w}px`;
    wrapper.style.height = `${h}px`;
  }, []);

  useEffect(() => {
    let replayer: Replayer | null = null;
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch(
          `${API_BASE_URL}/api/sites/${siteId}/replays/${sessionId}`,
          { headers: { Authorization: `Bearer ${getToken() ?? ""}` } }
        );
        if (!res.ok) {
          setStatus("não foi possível carregar");
          return;
        }
        const data = (await res.json()) as { frames: unknown[] };
        if (cancelled || !hostRef.current) return;
        if (data.frames.length < 2) {
          setStatus("gravação muito curta para reproduzir");
          return;
        }
        replayer = new Replayer(data.frames as never[], {
          root: hostRef.current,
          skipInactive: true,
          mouseTail: { duration: 800 },
        });
        replayer.play();
        setStatus("");
        requestAnimationFrame(fit);
      } catch {
        setStatus("erro ao carregar");
      }
    })();

    return () => {
      cancelled = true;
      replayer?.destroy?.();
    };
  }, [siteId, sessionId, fit]);

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
          <button className="btn btn-ghost btn-sm spacer" onClick={onClose}>
            Fechar
          </button>
        </header>
        <div className="stage" ref={stageRef}>
          <div ref={hostRef} />
        </div>
      </div>
    </div>
  );
}

function durationLabel(start: string, end: string): string {
  const sec = Math.max(0, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 1000));
  if (sec < 60) return `${sec}s`;
  return `${Math.floor(sec / 60)}m ${sec % 60}s`;
}
