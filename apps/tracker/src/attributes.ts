/**
 * Acquisition + device attributes captured on each pageview.
 *
 * The goal is audience analysis: correlating *where a visitor came from*
 * (campaign / ad / source) and *what device/context they have* with whether
 * they convert — so the winning buying audience can be found. Everything here
 * is read from the browser and the landing URL; none of it is personally
 * identifying on its own (no raw IP, no names).
 */

const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"] as const;
const CLICK_ID_KEYS = ["gclid", "fbclid", "ttclid", "msclkid"] as const;

export function collectAttributes(): Record<string, unknown> {
  const attrs: Record<string, unknown> = {};

  // Screen + viewport — signals device class and layout.
  attrs.screenWidth = window.screen?.width;
  attrs.screenHeight = window.screen?.height;
  attrs.vw = window.innerWidth;
  attrs.vh = window.innerHeight;
  attrs.dpr = Math.round((window.devicePixelRatio || 1) * 100) / 100;

  // Locale + timezone — region/language of the visitor.
  attrs.lang = navigator.language;
  try {
    attrs.tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    /* ignore */
  }

  // Connection + hardware — network quality and device tier.
  const conn = (navigator as unknown as { connection?: { effectiveType?: string } }).connection;
  if (conn?.effectiveType) attrs.conn = conn.effectiveType;
  const mem = (navigator as unknown as { deviceMemory?: number }).deviceMemory;
  if (typeof mem === "number") attrs.mem = mem;
  if (typeof navigator.hardwareConcurrency === "number") attrs.cores = navigator.hardwareConcurrency;

  // Acquisition: UTMs + ad click ids from the landing URL. This is the core
  // of "which campaign/ad brought the buyers".
  const params = new URLSearchParams(location.search);
  for (const k of UTM_KEYS) {
    const v = params.get(k);
    if (v) attrs[k] = v.slice(0, 200);
  }
  for (const k of CLICK_ID_KEYS) {
    const v = params.get(k);
    if (v) attrs[k] = v.slice(0, 200);
  }

  return attrs;
}
