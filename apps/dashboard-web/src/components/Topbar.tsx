import { Search } from "lucide-react";
import type { ReactNode } from "react";

/**
 * Application header: contextual title/breadcrumb, a global-search affordance
 * (⌘K styling — a stub for now), the live-connection indicator and a slot for
 * quick actions (the alerts bell). Sticky, translucent blurred background.
 */
export function Topbar({
  title,
  siteId,
  connected,
  actions,
}: {
  title: string;
  siteId: string;
  connected: boolean;
  actions?: ReactNode;
}) {
  return (
    <header className="topbar">
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
