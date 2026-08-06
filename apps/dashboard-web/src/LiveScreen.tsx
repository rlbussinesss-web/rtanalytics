import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Replayer } from "rrweb";
import { EyeOff, LogOut, WifiOff, X } from "lucide-react";
// Without rrweb's stylesheet the replayer's iframe has no dimensions and the
// stage renders blank even though frames are arriving.
import "rrweb/dist/style.css";
import { WS_BASE_URL, getToken } from "./token";
import type { LiveEvent } from "./useLiveEvents";

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
  events,
}: {
  siteId: string;
  sessionId: string;
  onClose: () => void;
  events: LiveEvent[];
}) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const replayerRef = useRef<Replayer | null>(null);
  const pendingRef = useRef<RrwebFrame[]>([]);
  const [status, setStatus] = useState("conectando…");
  const [live, setLive] = useState(false);
  const [frameCount, setFrameCount] = useState(0);

  /**
   * Fit the replay to the panel *width* and let it scroll vertically. Scaling
   * to fit height too would shrink a tall desktop page to a thumbnail; fitting
   * width matches how screen-share tools present it. The host div is sized to
   * the scaled dimensions so it reserves the right space and centers.
   */
  const fitToStage = useCallback(() => {
    const stage = stageRef.current;
    const host = hostRef.current;
    const wrapper = host?.querySelector<HTMLElement>(".replayer-wrapper");
    const iframe = host?.querySelector("iframe");
    if (!stage || !host || !wrapper || !iframe) return;

    const w = iframe.offsetWidth;
    const h = iframe.offsetHeight;
    if (!w || !h) return;

    const scale = Math.min((stage.clientWidth - 24) / w, 1);
    wrapper.style.transformOrigin = "top left";
    wrapper.style.transform = `scale(${scale})`;
    host.style.width = `${w * scale}px`;
    host.style.height = `${h * scale}px`;
    host.style.margin = "0 auto";
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
        // The iframe often has no size for a frame or two after creation, and
        // a live desktop page keeps changing size — so refit repeatedly rather
        // than once, which is what left large (desktop) pages unscaled/cut off.
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

  // Keep the replay fitted: on window resize, and via a short polling interval
  // that catches the iframe getting its real dimensions (which happens a beat
  // after the replayer mounts) plus any live page-size changes.
  useEffect(() => {
    window.addEventListener("resize", fitToStage);
    const iv = setInterval(fitToStage, 400);
    return () => {
      window.removeEventListener("resize", fitToStage);
      clearInterval(iv);
    };
  }, [fitToStage]);

  // Escape closes the viewer, which also stops the visitor's recording.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Presence: derive from the live event feed for this session. A "left" event
  // means the visitor closed/navigated away; "hidden" means the tab is
  // backgrounded. Also fall back to staleness — if no event has arrived from
  // this session for a while, treat them as gone (pagehide isn't guaranteed).
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => setTick((t) => t + 1), 4000);
    return () => clearInterval(iv);
  }, []);

  const presence = useMemo(() => {
    void tick; // re-evaluate staleness on each tick
    const mine = events.filter((e) => e.sessionId === sessionId);
    const lastSeen = mine[0]?.timestamp ?? 0;
    const lastVis = mine.find((e) => e.eventType === "visibility");
    const state = (lastVis?.payload?.state as string) ?? "visible";
    if (state === "left") return { kind: "left" as const };
    if (lastSeen && Date.now() - lastSeen > 40_000) return { kind: "gone" as const };
    if (state === "hidden") return { kind: "hidden" as const };
    return { kind: "active" as const };
  }, [events, sessionId, tick]);

  // The overlay can be dismissed to peek at the (frozen) screen behind it; it
  // re-appears whenever the presence state changes to a new non-active state.
  const [dismissedKind, setDismissedKind] = useState<string | null>(null);
  const overlayVisible = presence.kind !== "active" && dismissedKind !== presence.kind;

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
          <PresenceBadge kind={presence.kind} />
          <span className="section-count spacer">{frameCount} quadros</span>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>
            Fechar
          </button>
        </header>
        <div className="stage" ref={stageRef}>
          <div ref={hostRef} />
          {overlayVisible && (
            <PresenceOverlay kind={presence.kind} onDismiss={() => setDismissedKind(presence.kind)} />
          )}
        </div>
      </div>
    </div>
  );
}

type PresenceKind = "active" | "hidden" | "left" | "gone";

const PRESENCE: Record<Exclude<PresenceKind, "active">, { label: string; icon: React.ReactNode; tone: string }> = {
  hidden: { label: "Aba em segundo plano", icon: <EyeOff size={14} />, tone: "warn" },
  gone: { label: "Sem sinal — provavelmente saiu", icon: <WifiOff size={14} />, tone: "warn" },
  left: { label: "Visitante saiu do site", icon: <LogOut size={14} />, tone: "bad" },
};

function PresenceBadge({ kind }: { kind: PresenceKind }) {
  if (kind === "active") {
    return <span className="presence-badge active"><i className="dot" /> Visitante ativo</span>;
  }
  const p = PRESENCE[kind];
  return <span className={`presence-badge ${p.tone}`}>{p.icon} {p.label}</span>;
}

function PresenceOverlay({ kind, onDismiss }: { kind: PresenceKind; onDismiss: () => void }) {
  if (kind === "active") return null;
  const p = PRESENCE[kind];
  return (
    <div className="presence-overlay">
      <div className={`presence-card ${p.tone}`}>
        <button className="presence-close" title="Fechar aviso" onClick={onDismiss}>
          <X size={15} />
        </button>
        <span className="presence-ico">{p.icon}</span>
        <b>{p.label}</b>
        <span>{kind === "hidden" ? "A tela volta assim que o visitante retornar à aba." : "A transmissão recomeça se o visitante voltar."}</span>
      </div>
    </div>
  );
}
