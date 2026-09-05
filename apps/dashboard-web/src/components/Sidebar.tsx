import {
  Activity,
  BarChart3,
  ChevronsUpDown,
  Filter,
  Flame,
  LayoutDashboard,
  LogOut,
  Moon,
  PlayCircle,
  Sun,
  Trophy,
} from "lucide-react";
import { avatarFor } from "../lib/ui";

export type ViewKey = "projects" | "overview" | "live" | "metrics" | "audience" | "autopsy" | "funnel" | "heatmaps" | "replays";

const NAV: { group: string; items: { key: ViewKey; label: string; icon: React.ReactNode }[] }[] = [
  {
    group: "Análise",
    items: [
      { key: "overview", label: "Visão geral", icon: <LayoutDashboard /> },
      { key: "metrics", label: "Métricas", icon: <BarChart3 /> },
      { key: "audience", label: "Público", icon: <Trophy /> },
      { key: "heatmaps", label: "Mapas de calor", icon: <Flame /> },
      { key: "funnel", label: "Funil", icon: <Filter /> },
    ],
  },
  {
    group: "Sessões",
    items: [
      { key: "live", label: "Ao vivo", icon: <Activity /> },
      { key: "replays", label: "Gravações", icon: <PlayCircle /> },
    ],
  },
];

export function Sidebar({
  siteId,
  active,
  onNavigate,
  onlineCount,
  theme,
  onToggleTheme,
  onLogout,
  open = false,
}: {
  siteId: string;
  active: ViewKey;
  onNavigate: (v: ViewKey) => void;
  onlineCount: number;
  theme: "dark" | "light";
  onToggleTheme: () => void;
  onLogout: () => void;
  open?: boolean;
}) {
  const av = avatarFor(siteId);
  return (
    <aside className={`sidebar${open ? " is-open" : ""}`}>
      <div className="brand-row">
        <span className="brand-mark">
          <Activity size={16} />
        </span>
        <span className="brand-name">
          RTAnalytics<small>real-time</small>
        </span>
      </div>

      <button className="ws-switch">
        <span className="ws-dot" />
        <span className="ws-name">{siteId}</span>
        <ChevronsUpDown size={14} color="var(--text-faint)" />
      </button>

      {NAV.map((section) => (
        <div key={section.group}>
          <div className="nav-group-label">{section.group}</div>
          {section.items.map((item) => (
            <button
              key={item.key}
              className={`nav-item${active === item.key ? " is-active" : ""}`}
              onClick={() => onNavigate(item.key)}
            >
              {item.icon}
              {item.label}
              {item.key === "live" && onlineCount > 0 && (
                <span className="nav-badge">{onlineCount}</span>
              )}
            </button>
          ))}
        </div>
      ))}

      <div className="sidebar-foot">
        <button className="nav-item" onClick={onToggleTheme}>
          {theme === "dark" ? <Sun /> : <Moon />}
          {theme === "dark" ? "Tema claro" : "Tema escuro"}
        </button>
        <button className="nav-item" onClick={onLogout}>
          <LogOut />
          Sair
        </button>
        <div className="profile">
          <span className="avatar" style={{ background: av.color }}>
            {av.initials}
          </span>
          <div className="profile-info">
            <b>Equipe</b>
            <span>{siteId}</span>
          </div>
        </div>
      </div>
    </aside>
  );
}
