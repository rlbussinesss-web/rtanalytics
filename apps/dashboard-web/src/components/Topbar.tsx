import { Bell, Search } from "lucide-react";

/**
 * Application header: contextual title/breadcrumb, a global-search affordance
 * (⌘K styling — a stub for now), the live-connection indicator and quick
 * actions. Sticky, with a translucent blurred background so content scrolls
 * under it.
 */
export function Topbar({
  title,
  siteId,
  connected,
}: {
  title: string;
  siteId: string;
  connected: boolean;
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

      <button className="icon-btn" title="Notificações">
        <Bell size={16} />
        <span className="badge-dot" />
      </button>
    </header>
  );
}
