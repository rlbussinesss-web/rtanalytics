import { useEffect, useRef, useState } from "react";
import { Replayer } from "rrweb";
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
  const hostRef = useRef<HTMLDivElement | null>(null);
  const replayerRef = useRef<Replayer | null>(null);
  const pendingRef = useRef<RrwebFrame[]>([]);
  const [status, setStatus] = useState("conectando…");
  const [frameCount, setFrameCount] = useState(0);

  useEffect(() => {
    const token = encodeURIComponent(getToken() ?? "");
    const ws = new WebSocket(
      `${WS_BASE_URL}/watch/${siteId}/${sessionId}?token=${token}`
    );

    ws.onopen = () => setStatus("aguardando o visitante começar a transmitir…");

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

        // Anything before the first full snapshot cannot be rendered.
        const usable = pendingRef.current.slice(snapshotAt);
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
        return;
      }

      for (const frame of frames) {
        replayerRef.current.addEvent(frame as never);
      }
    };

    ws.onclose = () => setStatus("transmissão encerrada");
    ws.onerror = () => setStatus("erro na conexão");

    return () => {
      ws.close();
      replayerRef.current?.destroy?.();
      replayerRef.current = null;
      pendingRef.current = [];
    };
  }, [siteId, sessionId]);

  return (
    <div style={styles.backdrop} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <header style={styles.header}>
          <strong>Sessão {sessionId.slice(0, 8)}</strong>
          <span style={styles.status}>{status}</span>
          <span style={styles.counter}>{frameCount} quadros</span>
          <button onClick={onClose} style={styles.close}>
            fechar
          </button>
        </header>
        <div ref={hostRef} style={styles.stage} />
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  backdrop: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.6)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 100,
  },
  modal: {
    background: "white",
    borderRadius: 12,
    width: "min(1200px, 95vw)",
    height: "min(800px, 90vh)",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "10px 16px",
    borderBottom: "1px solid #eee",
    fontSize: 13,
  },
  status: { color: "#16a34a" },
  counter: { color: "#888", marginLeft: "auto" },
  close: {
    border: "1px solid #ddd",
    background: "transparent",
    borderRadius: 8,
    padding: "4px 10px",
    cursor: "pointer",
  },
  // The replayed page is rendered at its own viewport size inside an iframe,
  // so it needs to scroll rather than stretch the modal.
  stage: { flex: 1, overflow: "auto", background: "#fafafa" },
};
