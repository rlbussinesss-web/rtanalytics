import { timingSafeEqual } from "node:crypto";

/**
 * Single shared secret guarding the dashboard.
 *
 * The dashboard is used by a two-person team, so a shared password is the
 * right amount of auth: no account system to build or maintain, but the
 * dashboard is not readable by anyone who guesses the URL. When the product
 * gains real customers this is replaced by per-user accounts + JWT/RBAC
 * (see plan section 5) — every route already funnels through requireAuth,
 * so that swap is contained to this file.
 */
export const DASHBOARD_TOKEN = process.env.DASHBOARD_TOKEN ?? "";

if (!DASHBOARD_TOKEN) {
  console.error(
    "[dashboard-api] DASHBOARD_TOKEN is not set. Refusing to start with an " +
      "unprotected dashboard — set it to a long random string."
  );
  process.exit(1);
}

/** Constant-time comparison so the token can't be recovered by timing the response. */
export function isValidToken(candidate: string | undefined): boolean {
  if (!candidate) return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(DASHBOARD_TOKEN);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Reads the token from the Authorization header, `token` query param, or cookie. */
export function extractToken(headers: Record<string, unknown>, query: unknown): string | undefined {
  const auth = headers.authorization;
  if (typeof auth === "string" && auth.startsWith("Bearer ")) {
    return auth.slice("Bearer ".length);
  }
  const cookie = headers.cookie;
  if (typeof cookie === "string") {
    const match = /(?:^|;\s*)dashboard_token=([^;]+)/.exec(cookie);
    if (match) return decodeURIComponent(match[1]!);
  }
  // WebSocket clients cannot set headers, so the token also travels as a query param.
  if (query && typeof query === "object" && "token" in query) {
    const value = (query as { token?: unknown }).token;
    if (typeof value === "string") return value;
  }
  return undefined;
}
