import { Menu, Search } from "lucide-react";
import type { ReactNode } from "react";

/**
 * Application header: a mobile menu button, contextual title/breadcrumb, a
 * global-search affordance (⌘K — a stub), the live-connection indicator and a
 * slot for quick actions (the alerts bell). Sticky, translucent blurred bg.
 */
export function Topbar({
  title,
  siteId,
  connected,
  actions,
  onMenu,
}: {
  title: string;
  siteId: string;
  connected: boolean;
  actions?: ReactNode;
  onMenu?: () => void;
}) {
  return (
    <header className="topbar">
      <button className="menu-btn" onClick={onMenu} title="Menu">
        <Menu size={18} />
      </button>
      <div className="page-title">
        <span className="crumb">{siteId} / </span>
        {title}
      </div>

      <button className="search spacer" style={{ marginLeft: "auto" }}>
        <Search size={15} />
        Buscar…
        <kbd>⌘K</kbd>
      </button>

      <span className={`pill${connected ? "" : " is-offline"}`}>
        <i className="dot" />
        {connected ? "Tempo real" : "Reconectando"}
      </span>

      {actions}
    </header>
  );
}
