import { Activity, BarChart3, Film, FolderOpen, MoreHorizontal } from "lucide-react";
import type { ViewKey } from "./Sidebar";

/**
 * Bottom navigation bar for mobile — replaces the top lens strip on small
 * screens. Five primary destinations sized for thumb reach; the "Mais" tab
 * opens a menu with secondary views (audience, autopsy, funnel, heatmaps,
 * install, settings).
 *
 * Hidden entirely above 820px via CSS (.mobile-nav { display: none }).
 */

interface Props {
	active: ViewKey;
	onNavigate: (v: ViewKey) => void;
	onMore: () => void;
}

const TABS: { key: ViewKey; label: string; icon: React.ReactNode }[] = [
	{ key: "live", label: "Ao Vivo", icon: <Activity size={20} /> },
	{ key: "metrics", label: "Métricas", icon: <BarChart3 size={20} /> },
	{ key: "replays", label: "Gravações", icon: <Film size={20} /> },
	{ key: "projects", label: "Projetos", icon: <FolderOpen size={20} /> },
];

export function MobileNav({ active, onNavigate, onMore }: Props) {
	return (
		<nav className="mobile-nav" role="navigation" aria-label="Navegação principal">
			{TABS.map((t) => (
				<button
					key={t.key}
					className={`mn-tab${active === t.key ? " is-active" : ""}`}
					onClick={() => onNavigate(t.key)}
					aria-current={active === t.key ? "page" : undefined}
				>
					<span className="mn-icon">{t.icon}</span>
					<span className="mn-label">{t.label}</span>
				</button>
			))}
			<button className="mn-tab" onClick={onMore} aria-label="Mais opções">
				<span className="mn-icon"><MoreHorizontal size={20} /></span>
				<span className="mn-label">Mais</span>
			</button>
		</nav>
	);
}