import { useState } from "react";
import {
  Activity,
  BarChart3,
  Filter,
  Flame,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  PlayCircle,
  Sun,
  Trophy,
  Stethoscope,
  LayoutGrid,
} from "lucide-react";
import type { ViewKey } from "./Sidebar";
import type { SiteSummary } from "../useSites";

/**
 * Top command bar — the product's navigation, deliberately not a left rail.
 * A single row: brand, an inline lens switcher, and live/session status on
 * the right. Frees the full width below for each screen's own spatial layout.
 */
const LENSES: { key: ViewKey; label: string; icon: React.ReactNode }[] = [
  { key: "projects", label: "Projetos", icon: <LayoutGrid /> },
  { key: "live", label: "Ao Vivo", icon: <Activity /> },
  { key: "audience", label: "Público", icon: <Trophy /> },
  { key: "autopsy", label: "Autópsia", icon: <Stethoscope /> },
  { key: "funnel", label: "Jornada", icon: <Filter /> },
  { key: "metrics", label: "Métricas", icon: <BarChart3 /> },
  { key: "heatmaps", label: "Mapas", icon: <Flame /> },
  { key: "replays", label: "Gravações", icon: <PlayCircle /> },
  { key: "overview", label: "Visão geral", icon: <LayoutDashboard /> },
];

export function CommandBar({
  active,
  onNavigate,
  onlineCount,
  connected,
  theme,
  onToggleTheme,
  onLogout,
  sites,
  siteId,
  onSiteChange,
}: {
  active: ViewKey;
  onNavigate: (v: ViewKey) => void;
  onlineCount: number;
  connected: boolean;
  theme: "dark" | "light";
  onToggleTheme: () => void;
  onLogout: () => void;
  sites: SiteSummary[];
  siteId: string;
  onSiteChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <header className="cmdbar">
      <div className="cmd-brand">
        <span className="cmd-mark">R</span>
        RTA
      </div>

      {/* Site switcher. Rendered only once more than one project reports data,
          so a single-site setup keeps a clean bar. */}
      {sites.length > 1 ? (
        <select
          className="cmd-site"
          value={siteId}
          onChange={(e) => onSiteChange(e.target.value)}
          aria-label="Trocar de site"
        >
          {sites.map((s) => (
            <option key={s.siteId} value={s.siteId}>
              {s.host ?? s.siteId}
            </option>
          ))}
        </select>
      ) : (
        <span className="cmd-site is-static">{sites[0]?.host ?? siteId}</span>
      )}

      <button
        className="cmd-icon cmd-menu-btn"
        aria-label="Abrir navegação"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Menu size={16} />
      </button>

      <nav className={`lens-switch${open ? " open" : ""}`}>
        {LENSES.map((l) => (
          <button
            key={l.key}
            className={l.key === active ? "on" : ""}
            onClick={() => {
              onNavigate(l.key);
              setOpen(false);
            }}
          >
            {l.icon}
            {l.label}
            {l.key === "live" && onlineCount > 0 && <span className="lens-badge">{onlineCount}</span>}
          </button>
        ))}
      </nav>

      <div className="cmd-spacer" />

      <span className={`cmd-live${connected ? "" : " off"}`}>
        {connected && <span className="live-dot" />}
        {connected ? `${onlineCount} agora` : "reconectando…"}
      </span>

      <button className="cmd-icon" onClick={onToggleTheme} aria-label="Alternar tema">
        {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
      </button>
      <button className="cmd-icon" onClick={onLogout} aria-label="Sair">
        <LogOut size={16} />
      </button>
    </header>
  );
}
