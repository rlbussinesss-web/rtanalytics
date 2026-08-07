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
} from "lucide-react";
import type { ViewKey } from "./Sidebar";

/**
 * Top command bar — the product's navigation, deliberately not a left rail.
 * A single row: brand, an inline lens switcher, and live/session status on
 * the right. Frees the full width below for each screen's own spatial layout.
 */
const LENSES: { key: ViewKey; label: string; icon: React.ReactNode }[] = [
  { key: "live", label: "Ao Vivo", icon: <Activity /> },
  { key: "audience", label: "Público", icon: <Trophy /> },
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
}: {
  active: ViewKey;
  onNavigate: (v: ViewKey) => void;
  onlineCount: number;
  connected: boolean;
  theme: "dark" | "light";
  onToggleTheme: () => void;
  onLogout: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <header className="cmdbar">
      <div className="cmd-brand">
        <span className="cmd-mark">R</span>
        RTA <small>revenue radar</small>
      </div>

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
