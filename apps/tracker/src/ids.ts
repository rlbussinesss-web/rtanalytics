/** UUID v4 generator that works without crypto.randomUUID polyfills issues. */
export function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  // Fallback for older browsers without crypto.randomUUID.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

const VISITOR_KEY = "__rta_visitor_id";
const SESSION_KEY = "__rta_session_id";
const SESSION_LAST_SEEN_KEY = "__rta_session_last_seen";
const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 min inactivity -> new session

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore (private mode / storage full / disabled) */
  }
}

export function getVisitorId(): string {
  let id = safeGet(VISITOR_KEY);
  if (!id) {
    id = uuid();
    safeSet(VISITOR_KEY, id);
  }
  return id;
}

/**
 * Marks the session as still active.
 *
 * The session id rotates after SESSION_TIMEOUT_MS of inactivity, and that
 * timer is only refreshed when the id is read — which happens once per page
 * load. A visitor reading one long page for 40 minutes would come back as a
 * brand new session on their next click. The heartbeat calls this so "active"
 * means active, not "loaded a page recently".
 */
export function touchSession(): void {
  safeSet(SESSION_LAST_SEEN_KEY, String(Date.now()));
}

export function getSessionId(): string {
  const now = Date.now();
  const lastSeen = Number(safeGet(SESSION_LAST_SEEN_KEY) ?? 0);
  let id = safeGet(SESSION_KEY);

  if (!id || now - lastSeen > SESSION_TIMEOUT_MS) {
    id = uuid();
    safeSet(SESSION_KEY, id);
  }

  safeSet(SESSION_LAST_SEEN_KEY, String(now));
  return id;
}
