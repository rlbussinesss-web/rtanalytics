const STORAGE_KEY = "rtanalytics_dashboard_token";

/**
 * The dashboard is guarded by one shared password rather than user accounts —
 * it's used by a two-person team. The token is kept in localStorage so the
 * password is typed once per browser, and appended to API calls and the
 * WebSocket URL (browsers can't set headers on a WS upgrade).
 */
export function getToken(): string | null {
  return localStorage.getItem(STORAGE_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(STORAGE_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export const API_BASE_URL =
  (import.meta.env.VITE_DASHBOARD_API_URL as string | undefined) ?? "http://localhost:8082";

export const WS_BASE_URL =
  (import.meta.env.VITE_DASHBOARD_API_WS_URL as string | undefined) ?? "ws://localhost:8082";

/** Verifies a password against the API before we store it. */
export async function verifyToken(token: string): Promise<boolean> {
  const response = await fetch(`${API_BASE_URL}/api/login`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  return response.ok;
}
