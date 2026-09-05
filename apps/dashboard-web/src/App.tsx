import { useEffect, useMemo, useRef, useState } from "react";
import { Activity, Clock, Users, Zap } from "lucide-react";
import { useLiveEvents, type LiveEvent } from "./useLiveEvents";
import { useOnlineCount } from "./useOnlineCount";
import { useSessions } from "./useSessions";
import { useTheme } from "./useTheme";
import { useSites } from "./useSites";
import { LiveScreen } from "./LiveScreen";
import { MetricsPanel } from "./MetricsPanel";
import { AudiencePanel } from "./AudiencePanel";
import { AutopsyPanel } from "./AutopsyPanel";
import { FunnelPanel } from "./FunnelPanel";
import { HeatmapView } from "./HeatmapView";
import { ReplaysPanel } from "./ReplaysPanel";
import type { RangeKey } from "./useMetrics";
import type { ViewKey } from "./components/Sidebar";
import { CommandBar } from "./components/CommandBar";
import { AoVivo } from "./AoVivo";
import { StatCard } from "./components/StatCard";
import { VisitorCard } from "./components/VisitorCard";
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
          <span className="brand-mark"><Activity size={16} /></span>
          <h1 className="login-title">RTAnalytics</h1>
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
  const alerts = useAlerts(events, onlineCount);

  const infoBySession = useMemo(() => {
    const map = new Map<string, LiveEvent>();
    for (const event of events) {
      if (!map.has(event.sessionId)) map.set(event.sessionId, event);
    }
    return map;
  }, [events]);

  // Latest visibility state per session, so the visitor list can separate
  // people interacting now from those who backgrounded the tab.
  const visibilityBySession = useMemo(() => {
    const map = new Map<string, "visible" | "hidden" | "left">();
    for (const event of events) {
      if (event.eventType === "visibility" && !map.has(event.sessionId)) {
        map.set(event.sessionId, (event.payload?.state as "visible" | "hidden" | "left") ?? "visible");
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
            {view === "overview" && (
              <OverviewView
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
            {view === "heatmaps" && (
              <>
                <RangeSegment range={range} onChange={setRange} />
                <HeatmapView siteId={siteId} range={range} />
              </>
            )}
            {view === "funnel" && (
              <>
                <RangeSegment range={range} onChange={setRange} />
                <FunnelPanel siteId={siteId} range={range} />
              </>
            )}
            {view === "replays" && <ReplaysPanel siteId={siteId} />}
          </div>
        </div>
      </div>

      {watching && (
        <LiveScreen siteId={siteId} sessionId={watching} onClose={() => setWatching(null)} events={events} />
      )}

      <AlertToasts fired={alerts.fired} onDismiss={alerts.dismiss} />
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

interface LiveProps {
  onlineCount: number;
  sessions: string[];
  events: LiveEvent[];
  infoBySession: Map<string, LiveEvent>;
  visibilityBySession: Map<string, "visible" | "hidden" | "left">;
  firstSeen: Map<string, number>;
  onWatch: (id: string) => void;
}

function OverviewView({ siteId, ...p }: LiveProps & { siteId: string }) {
  const eventsPerMin = useMemo(() => {
    const cutoff = Date.now() - 60_000;
    return p.events.filter((e) => e.timestamp >= cutoff).length;
  }, [p.events]);

  // Live sparkline of events over the last ~2 minutes, in 10s buckets.
  const spark = useMemo(() => bucketize(p.events, 12, 10_000), [p.events]);

  return (
    <>
      <div className="grid">
        <StatCard icon={<Users size={16} />} name="Visitantes online" value={p.onlineCount} spark={spark} />
        <StatCard icon={<Activity size={16} />} name="Sessões ativas" value={p.sessions.length} accent="#8b5cf6" />
        <StatCard icon={<Zap size={16} />} name="Eventos / min" value={eventsPerMin} spark={spark} accent="#06b6d4" />
        <StatCard icon={<Clock size={16} />} name="Site" value={siteId} accent="#10b981" />
      </div>

      <VisitorsSection {...p} />
      <EventsSection events={p.events} />
    </>
  );
}

function VisitorsSection(p: LiveProps) {
  // A visitor is "ao vivo" while their tab is focused (visible or no signal
  // yet), and "em segundo plano" once they background it. When they return,
  // the visibility flips back to visible and they move up automatically.
  const live: string[] = [];
  const away: string[] = [];
  for (const s of p.sessions) {
    const vis = p.visibilityBySession.get(s);
    if (vis === "hidden" || vis === "left") away.push(s);
    else live.push(s);
  }

  const renderCards = (ids: string[], state: "active" | "hidden") => (
    <div className="visitor-grid">
      {ids.map((sessionId) => (
        <VisitorCard
          key={sessionId}
          sessionId={sessionId}
          info={p.infoBySession.get(sessionId)}
          firstSeen={p.firstSeen.get(sessionId) ?? Date.now()}
          onWatch={() => p.onWatch(sessionId)}
          state={state}
        />
      ))}
    </div>
  );

  return (
    <>
      <section className="section">
        <div className="section-head">
          <h2 className="section-title">Ao vivo · mexendo agora</h2>
          <span className="section-count">{live.length}</span>
        </div>
        {live.length === 0 ? (
          <div className="card empty-rich">
            <span className="ico"><Users size={20} /></span>
            <b>Ninguém interagindo agora</b>
            <p>Visitantes ativos na página aparecem aqui em tempo real.</p>
          </div>
        ) : (
          renderCards(live, "active")
        )}
      </section>

      {away.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2 className="section-title">Em segundo plano · podem voltar</h2>
            <span className="section-count">{away.length}</span>
          </div>
          {renderCards(away, "hidden")}
        </section>
      )}
    </>
  );
}

function EventsSection({ events }: { events: LiveEvent[] }) {
  return (
    <section className="section">
      <div className="section-head">
        <h2 className="section-title">Eventos ao vivo</h2>
        <span className="section-count">{events.length}</span>
      </div>
      <ul className="list is-scrollable">
        {events.length === 0 && <li className="empty">Aguardando eventos…</li>}
        {events.filter((e) => e.eventType !== "visibility").map((event) => (
          <li key={event.eventId} className="row event-row">
            <span className={`tag${event.eventType === "pageview" ? " is-pageview" : event.eventType === "conversion" ? " is-conversion" : ""}`}>
              {event.eventType}
            </span>
            <span className="path">{event.path}</span>
            <span className="mono">{event.sessionId.slice(0, 8)}</span>
            <span className="time">{new Date(event.timestamp).toLocaleTimeString()}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Counts events into N trailing time buckets, for a live sparkline. */
function bucketize(events: LiveEvent[], buckets: number, sizeMs: number): number[] {
  const now = Date.now();
  const out = new Array(buckets).fill(0);
  for (const e of events) {
    const idx = buckets - 1 - Math.floor((now - e.timestamp) / sizeMs);
    if (idx >= 0 && idx < buckets) out[idx]++;
  }
  return out;
}
