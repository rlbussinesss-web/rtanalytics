import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveEvents, type LiveEvent } from "./useLiveEvents";
import { useOnlineCount } from "./useOnlineCount";
import { useSessions } from "./useSessions";
import { useTheme } from "./useTheme";
import { useSites } from "./useSites";
import { LiveScreen } from "./LiveScreen";
import { MetricsPanel } from "./MetricsPanel";
import { AudiencePanel } from "./AudiencePanel";
import { AutopsyPanel } from "./AutopsyPanel";
import { ProjectsPanel } from "./ProjectsPanel";
import { InstallPanel } from "./InstallPanel";
import { ReplaysPanel } from "./ReplaysPanel";
import { KeywordsPanel } from "./KeywordsPanel";
import type { RangeKey } from "./useMetrics";
import type { ViewKey } from "./components/Sidebar";
import { CommandBar } from "./components/CommandBar";
import { MobileNav } from "./components/MobileNav";
import { AoVivo } from "./AoVivo";
import { AlertToasts } from "./components/AlertsCenter";
import { useAlerts } from "./useAlerts";
import { clearToken, getToken, setToken, verifyToken } from "./token";
import "./styles.css";

export function App() {
  const [authed, setAuthed] = useState(() => getToken() !== null);
  // Single source of truth for the theme, applied app-wide (login included).
  const [theme, toggleTheme] = useTheme();

  if (!authed) return <LoginScreen onSuccess={() => setAuthed(true)} />;
  return (
    <Dashboard
      theme={theme}
      onToggleTheme={toggleTheme}
      onLogout={() => {
        clearToken();
        setAuthed(false);
      }}
    />
  );
}

function LoginScreen({ onSuccess }: { onSuccess: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setChecking(true);
    setError(null);
    try {
      if (await verifyToken(password)) {
        setToken(password);
        onSuccess();
      } else {
        setError("Senha incorreta.");
      }
    } catch {
      setError("Não foi possível falar com o servidor.");
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="login-page">
      <form onSubmit={submit} className="card login-card">
        <div className="login-brand">
          <img src="/logo.png" alt="Pathora" className="login-logo" />
          <h1 className="login-title">Pathora</h1>
        </div>
        <p className="login-sub">Monitoramento de visitantes em tempo real</p>
        <input
          className="input"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Senha do painel"
          autoFocus
        />
        <button type="submit" className="btn btn-primary" disabled={checking || !password} style={{ justifyContent: "center" }}>
          {checking ? "Verificando…" : "Entrar"}
        </button>
        {error && <p className="error">{error}</p>}
      </form>
    </div>
  );
}

function Dashboard({
  theme,
  onToggleTheme,
  onLogout,
}: {
  theme: "dark" | "light";
  onToggleTheme: () => void;
  onLogout: () => void;
}) {
  const { sites, siteId, setSiteId } = useSites();
  const { events, connected } = useLiveEvents(siteId);
  const onlineCount = useOnlineCount(siteId, events);
  const sessions = useSessions(siteId, events);
  const [watching, setWatching] = useState<string | null>(null);
  const [view, setView] = useState<ViewKey>("live");
  const [range, setRange] = useState<RangeKey>("24h");
  const [moreOpen, setMoreOpen] = useState(false);
  const alerts = useAlerts(events, onlineCount);

  const infoBySession = useMemo(() => {
    const map = new Map<string, LiveEvent>();
    for (const event of events) {
      if (!map.has(event.sessionId)) map.set(event.sessionId, event);
    }
    return map;
  }, [events]);

  // Latest visibility state per session using monotonic sequence numbers to
  // discard stale out-of-order events. The tracker sends seq on every
  // visibility emission; higher seq always wins regardless of arrival order.
  // Falls back to timestamp comparison when seq is absent (old tracker).
  const visibilityBySession = useMemo(() => {
    const map = new Map<string, { state: "visible" | "hidden" | "idle" | "left"; seq?: number; ts?: number }>();
    for (const event of events) {
      if (event.eventType !== "visibility") continue;
      const payload = event.payload as { state?: string; seq?: number; ts?: number } | undefined;
      const state = (payload?.state as "visible" | "hidden" | "idle" | "left") ?? "visible";
      const existing = map.get(event.sessionId);
      if (!existing) {
        map.set(event.sessionId, { state, seq: payload?.seq, ts: payload?.ts });
        continue;
      }
      // Monotonic sequence: higher seq wins. Equal seq → higher ts wins.
      // No seq on either → fall back to event timestamp ordering.
      const newSeq = payload?.seq;
      const oldSeq = existing.seq;
      if (newSeq !== undefined && oldSeq !== undefined) {
        if (newSeq > oldSeq) {
          map.set(event.sessionId, { state, seq: newSeq, ts: payload?.ts });
        }
      } else if (newSeq !== undefined) {
        // New has seq, old doesn't → new is from updated tracker, trust it.
        map.set(event.sessionId, { state, seq: newSeq, ts: payload?.ts });
      } else if (oldSeq !== undefined) {
        // Old has seq, new doesn't → old is newer tracker, keep it.
      } else {
        // Neither has seq → compare timestamps (client ts preferred, then event ts).
        const newTs = payload?.ts ?? event.timestamp;
        const oldTs = existing.ts ?? 0;
        if (newTs >= oldTs) {
          map.set(event.sessionId, { state, ts: payload?.ts });
        }
      }
    }
    return map;
  }, [events]);

  // Track when each session was first seen this session, for "time online".
  const firstSeenRef = useRef<Map<string, number>>(new Map());
  useEffect(() => {
    const now = Date.now();
    for (const s of sessions) if (!firstSeenRef.current.has(s)) firstSeenRef.current.set(s, now);
  }, [sessions]);

  return (
    <div className="shell">
      <CommandBar
        sites={sites}
        siteId={siteId}
        onSiteChange={setSiteId}
        active={view}
        onNavigate={setView}
        onlineCount={onlineCount}
        connected={connected}
        theme={theme}
        onToggleTheme={onToggleTheme}
        onLogout={onLogout}
      />
      <div className="main">
        <div className={`content${view === "live" ? " is-bento" : ""}`}>
          <div className="content-inner">
            {view === "projects" && (
              <ProjectsPanel
                currentSiteId={siteId}
                onOpen={(id) => {
                  setSiteId(id);
                  setView("live");
                }}
                onInstall={(id) => {
                  setSiteId(id);
                  setView("install");
                }}
              />
            )}
            {view === "install" && <InstallPanel siteId={siteId} />}
            {view === "live" && (
              <AoVivo
                siteId={siteId}
                onlineCount={onlineCount}
                sessions={sessions}
                events={events}
                infoBySession={infoBySession}
                visibilityBySession={visibilityBySession}
                firstSeen={firstSeenRef.current}
                onWatch={setWatching}
              />
            )}
            {view === "metrics" && (
              <MetricsPanel siteId={siteId} range={range} onRangeChange={setRange} />
            )}
            {view === "audience" && (
              <AudiencePanel siteId={siteId} range={range} onRangeChange={setRange} />
            )}
            {view === "autopsy" && (
              <AutopsyPanel siteId={siteId} range={range} onRangeChange={setRange} />
            )}
            {view === "keywords" && (
              <KeywordsPanel siteId={siteId} range={range} onRangeChange={setRange} />
            )}
            {view === "replays" && <ReplaysPanel siteId={siteId} />}
          </div>
        </div>
      </div>

      {watching && (
        <LiveScreen siteId={siteId} sessionId={watching} onClose={() => setWatching(null)} events={events} />
      )}

      <AlertToasts fired={alerts.fired} onDismiss={alerts.dismiss} />

      <MobileNav
        active={view}
        onNavigate={(v) => { setView(v); setMoreOpen(false); }}
        onMore={() => setMoreOpen((o) => !o)}
      />

      {moreOpen && (
        <div className="mn-more-backdrop" onClick={() => setMoreOpen(false)}>
          <div className="mn-more-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="mn-more-title">Mais</div>
            {([
              ["audience", "Público"],
              ["keywords", "Palavras-chave"],
              ["autopsy", "Autópsia"],
              ["funnel", "Funis"],
              ["heatmaps", "Heatmaps"],
              ["install", "Instalação"],
            ] as [ViewKey, string][]).map(([k, label]) => (
              <button
                key={k}
                className={`mn-more-item${view === k ? " is-active" : ""}`}
                onClick={() => { setView(k); setMoreOpen(false); }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function RangeSegment({ range, onChange }: { range: RangeKey; onChange: (r: RangeKey) => void }) {
  const opts: [RangeKey, string][] = [["24h", "24 horas"], ["7d", "7 dias"], ["30d", "30 dias"]];
  return (
    <div className="segment" style={{ marginBottom: 18 }}>
      {opts.map(([k, label]) => (
        <button key={k} className={k === range ? "is-active" : ""} onClick={() => onChange(k)}>
          {label}
        </button>
      ))}
    </div>
  );
}

