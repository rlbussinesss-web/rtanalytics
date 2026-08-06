import { useMemo, useState } from "react";
import { useLiveEvents, type LiveEvent } from "./useLiveEvents";
import { useOnlineCount } from "./useOnlineCount";
import { useSessions } from "./useSessions";
import { LiveScreen } from "./LiveScreen";
import { clearToken, getToken, setToken, verifyToken } from "./token";
import "./styles.css";

const DEFAULT_SITE_ID = import.meta.env.VITE_SITE_ID ?? "demo-site";

export function App() {
  const [authed, setAuthed] = useState(() => getToken() !== null);

  if (!authed) return <LoginScreen onSuccess={() => setAuthed(true)} />;
  return (
    <Dashboard
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
        <h1 className="login-title">RTAnalytics</h1>
        <p className="login-sub">Monitoramento em tempo real</p>
        <input
          className="input"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Senha do painel"
          autoFocus
        />
        <button type="submit" className="btn btn-primary" disabled={checking || !password}>
          {checking ? "Verificando…" : "Entrar"}
        </button>
        {error && <p className="error">{error}</p>}
      </form>
    </div>
  );
}

function Dashboard({ onLogout }: { onLogout: () => void }) {
  const siteId = DEFAULT_SITE_ID;
  const { events, connected } = useLiveEvents(siteId);
  const onlineCount = useOnlineCount(siteId, events);
  const sessions = useSessions(siteId, events);
  const [watching, setWatching] = useState<string | null>(null);

  // Most recent path + enrichment per session, for the visitor list.
  const infoBySession = useMemo(() => {
    const map = new Map<string, LiveEvent>();
    for (const event of events) {
      if (!map.has(event.sessionId)) map.set(event.sessionId, event);
    }
    return map;
  }, [events]);

  const eventsPerMinute = useMemo(() => {
    const cutoff = Date.now() - 60_000;
    return events.filter((e) => e.timestamp >= cutoff).length;
  }, [events]);

  return (
    <div className="page">
      <header className="topbar">
        <h1 className="brand">
          RTAnalytics <span>/ {siteId}</span>
        </h1>
        <span className={`pill${connected ? "" : " is-offline"}`}>
          <i className="dot" />
          {connected ? "ao vivo" : "reconectando"}
        </span>
        <button className="btn btn-ghost btn-sm spacer" onClick={onLogout}>
          Sair
        </button>
      </header>

      <div className="grid">
        <Stat value={onlineCount} label="visitantes online" />
        <Stat value={sessions.length} label="sessões ativas" />
        <Stat value={eventsPerMinute} label="eventos no último minuto" />
      </div>

      <section className="section">
        <div className="section-head">
          <h2 className="section-title">Visitantes agora</h2>
          <span className="section-count">{sessions.length}</span>
        </div>
        <ul className="list">
          {sessions.length === 0 && <li className="empty">Nenhum visitante online.</li>}
          {sessions.map((sessionId) => {
            const info = infoBySession.get(sessionId);
            return (
              <li key={sessionId} className="row session-row">
                <span className="mono">{sessionId.slice(0, 8)}</span>
                <div className="session-meta">
                  <span className="path">{info?.path ?? "—"}</span>
                  <span className="meta-line">{describeVisitor(info)}</span>
                </div>
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => setWatching(sessionId)}
                >
                  Assistir ao vivo
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="section">
        <div className="section-head">
          <h2 className="section-title">Eventos ao vivo</h2>
          <span className="section-count">{events.length}</span>
        </div>
        <ul className="list is-scrollable">
          {events.length === 0 && <li className="empty">Aguardando eventos…</li>}
          {events.map((event) => (
            <li key={event.eventId} className="row event-row">
              <span className={`tag${event.eventType === "pageview" ? " is-pageview" : ""}`}>
                {event.eventType}
              </span>
              <span className="path">{event.path}</span>
              <span className="mono">{event.sessionId.slice(0, 8)}</span>
              <span className="time">{new Date(event.timestamp).toLocaleTimeString()}</span>
            </li>
          ))}
        </ul>
      </section>

      {watching && (
        <LiveScreen
          siteId={siteId}
          sessionId={watching}
          onClose={() => setWatching(null)}
        />
      )}
    </div>
  );
}

/** Turns a two-letter country code into its flag emoji (BR → 🇧🇷). */
function flag(country?: string): string {
  if (!country || country.length !== 2) return "";
  const A = 0x1f1e6;
  return String.fromCodePoint(
    A + country.charCodeAt(0) - 65,
    A + country.charCodeAt(1) - 65
  );
}

/** One-line "🇧🇷 São Paulo · Chrome · Windows · celular" summary. */
function describeVisitor(info?: LiveEvent): string {
  if (!info) return "—";
  const deviceLabels: Record<string, string> = {
    mobile: "celular",
    tablet: "tablet",
    desktop: "desktop",
  };
  const parts = [
    [flag(info.country), info.city].filter(Boolean).join(" "),
    info.browser,
    info.os,
    info.device ? deviceLabels[info.device] ?? info.device : undefined,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "localizando…";
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="card stat">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}
