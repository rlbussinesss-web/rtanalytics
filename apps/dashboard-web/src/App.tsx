import { useState } from "react";
import { useLiveEvents } from "./useLiveEvents";
import { useOnlineCount } from "./useOnlineCount";
import { clearToken, getToken, setToken, verifyToken } from "./token";

const DEFAULT_SITE_ID = import.meta.env.VITE_SITE_ID ?? "demo-site";

export function App() {
  const [authed, setAuthed] = useState(() => getToken() !== null);

  if (!authed) {
    return <LoginScreen onSuccess={() => setAuthed(true)} />;
  }
  return <Dashboard onLogout={() => { clearToken(); setAuthed(false); }} />;
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
    <div style={styles.loginPage}>
      <form onSubmit={submit} style={styles.loginCard}>
        <h1 style={styles.title}>RTAnalytics</h1>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Senha do painel"
          autoFocus
          style={styles.input}
        />
        <button type="submit" disabled={checking || !password} style={styles.button}>
          {checking ? "Verificando…" : "Entrar"}
        </button>
        {error && <p style={styles.error}>{error}</p>}
      </form>
    </div>
  );
}

function Dashboard({ onLogout }: { onLogout: () => void }) {
  const [siteId] = useState(DEFAULT_SITE_ID);
  const { events, connected } = useLiveEvents(siteId);
  const onlineCount = useOnlineCount(siteId, events);

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <h1 style={styles.title}>RTAnalytics — {siteId}</h1>
        <span style={{ ...styles.badge, background: connected ? "#16a34a" : "#dc2626" }}>
          {connected ? "live" : "reconnecting…"}
        </span>
        <button onClick={onLogout} style={styles.logout}>
          sair
        </button>
      </header>

      <section style={styles.counterCard}>
        <div style={styles.counterValue}>{onlineCount}</div>
        <div style={styles.counterLabel}>visitantes online agora</div>
      </section>

      <section>
        <h2 style={styles.sectionTitle}>Eventos ao vivo</h2>
        <ul style={styles.eventList}>
          {events.length === 0 && <li style={styles.emptyState}>Aguardando eventos…</li>}
          {events.map((event) => (
            <li key={event.eventId} style={styles.eventRow}>
              <span style={styles.eventType}>{event.eventType}</span>
              <span style={styles.eventPath}>{event.path}</span>
              <span style={styles.eventSession}>{event.sessionId.slice(0, 8)}</span>
              <span style={styles.eventTime}>
                {new Date(event.timestamp).toLocaleTimeString()}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    fontFamily: "system-ui, sans-serif",
    maxWidth: 720,
    margin: "0 auto",
    padding: "24px 16px",
    color: "#1a1a1a",
  },
  header: { display: "flex", alignItems: "center", gap: 12, marginBottom: 24 },
  loginPage: {
    fontFamily: "system-ui, sans-serif",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: "100vh",
  },
  loginCard: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
    width: 280,
    padding: 24,
    border: "1px solid #e5e5e5",
    borderRadius: 12,
  },
  input: { padding: "10px 12px", border: "1px solid #ddd", borderRadius: 8, fontSize: 14 },
  button: {
    padding: "10px 12px",
    border: "none",
    borderRadius: 8,
    background: "#1a1a1a",
    color: "white",
    fontSize: 14,
    cursor: "pointer",
  },
  error: { color: "#dc2626", fontSize: 13, margin: 0 },
  logout: {
    marginLeft: "auto",
    border: "1px solid #ddd",
    background: "transparent",
    borderRadius: 8,
    padding: "4px 10px",
    fontSize: 12,
    cursor: "pointer",
  },
  title: { fontSize: 20, margin: 0 },
  badge: { color: "white", padding: "2px 10px", borderRadius: 999, fontSize: 12 },
  counterCard: {
    border: "1px solid #e5e5e5",
    borderRadius: 12,
    padding: 24,
    textAlign: "center",
    marginBottom: 24,
  },
  counterValue: { fontSize: 48, fontWeight: 700 },
  counterLabel: { color: "#666" },
  sectionTitle: { fontSize: 16, marginBottom: 8 },
  eventList: { listStyle: "none", margin: 0, padding: 0, maxHeight: 480, overflowY: "auto" },
  eventRow: {
    display: "grid",
    gridTemplateColumns: "100px 1fr 90px 90px",
    gap: 8,
    padding: "8px 4px",
    borderBottom: "1px solid #f0f0f0",
    fontSize: 13,
  },
  eventType: { fontWeight: 600 },
  eventPath: { color: "#333", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  eventSession: { color: "#888", fontFamily: "monospace" },
  eventTime: { color: "#888", textAlign: "right" },
  emptyState: { color: "#888", padding: "12px 4px" },
};
