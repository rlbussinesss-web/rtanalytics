import { Globe, Monitor, Smartphone, Tablet, Radio } from "lucide-react";
import type { LiveEvent } from "../useLiveEvents";
import { avatarFor, deviceLabel, flag, sinceLabel } from "../lib/ui";

/**
 * Rich visitor card for the live view: generated avatar, location with flag,
 * device/browser/OS chips, current page and time online, with a watch action
 * revealed on the card. Replaces the old flat list row.
 */
export type SessionViewState = "active" | "hidden" | "idle" | "disconnected";

export function VisitorCard({
  sessionId,
  info,
  firstSeen,
  onWatch,
  state = "active",
}: {
  sessionId: string;
  info?: LiveEvent;
  firstSeen: number;
  onWatch: () => void;
  state?: SessionViewState;
}) {
  const av = avatarFor(sessionId);
  const loc = [flag(info?.country), info?.city].filter(Boolean).join(" ") || "Localizando…";
  const DeviceIcon =
    info?.device === "mobile" ? Smartphone : info?.device === "tablet" ? Tablet : Monitor;

  const stateLabel =
    state === "active" ? "ao vivo" :
    state === "hidden" ? "segundo plano" :
    state === "idle" ? "inativo" :
    "desconectado";
  const stateClass =
    state === "active" ? "" :
    state === "hidden" ? " is-away" :
    state === "idle" ? " is-idle" :
    " is-disconnected";

  return (
    <div className={`card visitor-card${stateClass}`}>
      <div className="vc-top">
        <span className="avatar" style={{ background: av.color }}>{av.initials}</span>
        <div style={{ minWidth: 0 }}>
          <div className="vc-id">Visitante {sessionId.slice(0, 6)}</div>
          <div className="vc-loc">{loc}</div>
        </div>
        {state === "active" ? (
          <span className="pill vc-live"><i className="dot" />{stateLabel}</span>
        ) : (
          <span className={`pill vc-live${stateClass}`}>{stateLabel}</span>
        )}
      </div>

      <div className="vc-meta">
        <span className="chip"><DeviceIcon />{deviceLabel(info?.device)}</span>
        {info?.browser && <span className="chip"><Globe />{info.browser}</span>}
        {info?.os && <span className="chip">{info.os}</span>}
        <span className="chip"><Radio />{sinceLabel(firstSeen)} online</span>
      </div>

      <div className="vc-path">
        <span style={{ color: "var(--text-faint)" }}>página</span>
        <span className="mono">{info?.path ?? "—"}</span>
      </div>

      <div className="vc-actions">
        <button className="btn btn-primary btn-sm" onClick={onWatch}>
          <Radio size={14} /> Assistir ao vivo
        </button>
      </div>
    </div>
  );
}
