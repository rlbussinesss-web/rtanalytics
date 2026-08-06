import { useCallback, useEffect, useRef, useState } from "react";
import { Replayer } from "rrweb";
// Without rrweb's stylesheet the replayer's iframe has no dimensions and the
// stage renders blank even though frames are arriving.
import "rrweb/dist/style.css";
import { WS_BASE_URL, getToken } from "./token";

/**
 * Live screen viewer — reconstructs the visitor's page from rrweb frames as
 * they arrive, like watching a screen share.
 *
 * Opening this component's WebSocket is what asks the visitor's browser to
 * start recording; unmounting stops it. Nothing is recorded while nobody is
 * watching.
 *
 * rrweb's Replayer needs a full DOM snapshot before it can render anything, so
 * frames are buffered until one arrives. A visitor who was already mid-session
 * sends a fresh snapshot as soon as recording starts, so the wait is short.
 */

interface ReplayChunk {
  eventType: string;
  payload: { frames: unknown[]; seq: number };
}

type RrwebFrame = { type: number; timestamp: number };

const META = 4;
const FULL_SNAPSHOT = 2;

export function LiveScreen({
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
  const replayerRef = useRef<Replayer | null>(null);
  const pendingRef = useRef<RrwebFrame[]>([]);
  const [status, setStatus] = useState("conectando…");
  const [live, setLive] = useState(false);
  const [frameCount, setFrameCount] = useState(0);

  /**
   * The visitor's viewport is usually wider than this panel, so the replay is
   * scaled down to fit rather than shown behind scrollbars — the point is to
   * see their whole screen at a glance.
   */
  const fitToStage = useCallback(() => {
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
    const token = encodeURIComponent(getToken() ?? "");
    const ws = new WebSocket(
      `${WS_BASE_URL}/watch/${siteId}/${sessionId}?token=${token}`
    );

    ws.onopen = () => setStatus("aguardando a transmissão…");

    ws.onmessage = (msg) => {
      let chunk: ReplayChunk;
      try {
        chunk = JSON.parse(msg.data) as ReplayChunk;
      } catch {
        return;
      }
      if (chunk.eventType !== "replay-chunk") return;

      const frames = (chunk.payload?.frames ?? []) as RrwebFrame[];
      if (frames.length === 0) return;

      setFrameCount((n) => n + frames.length);

      if (!replayerRef.current) {
        pendingRef.current.push(...frames);
        const snapshotAt = pendingRef.current.findIndex((f) => f.type === FULL_SNAPSHOT);
        if (snapshotAt === -1 || !hostRef.current) return;

        // Start from the Meta frame that precedes the snapshot, not from the
        // snapshot itself: Meta carries the recorded viewport size, and
        // without it the replayer's iframe is created with no dimensions and
        // renders blank.
        let start = snapshotAt;
        for (let i = snapshotAt - 1; i >= 0; i -= 1) {
          if (pendingRef.current[i]!.type === META) {
            start = i;
            break;
          }
        }
        const usable = pendingRef.current.slice(start);
        pendingRef.current = [];

        const replayer = new Replayer(usable as never[], {
          root: hostRef.current,
          liveMode: true,
          mouseTail: { duration: 800 },
          skipInactive: false,
        });
        replayer.startLive(usable[0]!.timestamp);
        replayerRef.current = replayer;
        setStatus("ao vivo");
        setLive(true);
        // Let the replayer lay out its iframe before measuring it.
        requestAnimationFrame(fitToStage);
        return;
      }

      for (const frame of frames) {
        replayerRef.current.addEvent(frame as never);
      }
    };

    ws.onclose = () => {
      setStatus("transmissão encerrada");
      setLive(false);
    };
    ws.onerror = () => {
      setStatus("erro na conexão");
      setLive(false);
    };

    return () => {
      ws.close();
      replayerRef.current?.destroy?.();
      replayerRef.current = null;
      pendingRef.current = [];
    };
  }, [siteId, sessionId, fitToStage]);

  // Keep the replay fitted when the window (and therefore the stage) resizes.
  useEffect(() => {
    window.addEventListener("resize", fitToStage);
    return () => window.removeEventListener("resize", fitToStage);
  }, [fitToStage]);

  // Escape closes the viewer, which also stops the visitor's recording.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="backdrop" onClick={onClose}>
      <div className="viewer" onClick={(e) => e.stopPropagation()}>
        <header className="viewer-head">
          <strong>Sessão</strong>
          <span className="mono">{sessionId.slice(0, 8)}</span>
          <span className={`pill${live ? "" : " is-offline"}`}>
            <i className="dot" />
            {status}
          </span>
          <span className="section-count spacer">{frameCount} quadros</span>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>
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
