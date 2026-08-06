import { Globe, Monitor, Smartphone, Tablet, Radio } from "lucide-react";
import type { LiveEvent } from "../useLiveEvents";
import { avatarFor, deviceLabel, flag, sinceLabel } from "../lib/ui";

/**
 * Rich visitor card for the live view: generated avatar, location with flag,
 * device/browser/OS chips, current page and time online, with a watch action
 * revealed on the card. Replaces the old flat list row.
 */
export function VisitorCard({
  sessionId,
  info,
  firstSeen,
  onWatch,
}: {
  sessionId: string;
  info?: LiveEvent;
  firstSeen: number;
  onWatch: () => void;
}) {
  const av = avatarFor(sessionId);
  const loc = [flag(info?.country), info?.city].filter(Boolean).join(" ") || "Localizando…";
  const DeviceIcon =
    info?.device === "mobile" ? Smartphone : info?.device === "tablet" ? Tablet : Monitor;

  return (
    <div className="card visitor-card">
      <div className="vc-top">
        <span className="avatar" style={{ background: av.color }}>{av.initials}</span>
        <div style={{ minWidth: 0 }}>
          <div className="vc-id">Visitante {sessionId.slice(0, 6)}</div>
          <div className="vc-loc">{loc}</div>
        </div>
        <span className="pill vc-live"><i className="dot" />ativo</span>
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
