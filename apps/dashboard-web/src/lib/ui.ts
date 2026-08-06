/** Small presentation helpers shared across the dashboard UI. */

/** Two-letter country code → flag emoji (BR → 🇧🇷). */
export function flag(country?: string): string {
  if (!country || country.length !== 2) return "";
  const A = 0x1f1e6;
  return String.fromCodePoint(
    A + country.charCodeAt(0) - 65,
    A + country.charCodeAt(1) - 65
  );
}

const AVATAR_COLORS = [
  "#6366f1", "#8b5cf6", "#ec4899", "#f43f5e", "#f59e0b",
  "#10b981", "#06b6d4", "#3b82f6", "#a855f7", "#14b8a6",
];

/** Deterministic avatar colour + initials from an id — no images to load. */
export function avatarFor(id: string): { color: string; initials: string } {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  const color = AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]!;
  return { color, initials: id.slice(0, 2).toUpperCase() };
}

export function deviceLabel(d?: string): string {
  return { mobile: "Celular", tablet: "Tablet", desktop: "Desktop" }[d ?? ""] ?? d ?? "—";
}

export function fmtDuration(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s ? `${m}m ${s}s` : `${m}m`;
}

/** Compact "2 min", "3 s" relative time since a timestamp. */
export function sinceLabel(ts: number): string {
  const sec = Math.max(0, Math.round((Date.now() - ts) / 1000));
  return fmtDuration(sec);
}
