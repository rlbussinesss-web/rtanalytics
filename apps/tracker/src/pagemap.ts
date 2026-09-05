/**
 * Page content map: what exists at each height of the page.
 *
 * This is the piece that turns a scroll position into meaning. Knowing someone
 * stopped at 62% of the page says nothing; knowing that "Frete calculado no
 * checkout" lives at 62% says everything. Without this map, every analysis is
 * stuck describing pixels.
 *
 * It is captured per *page version*, not per session. The content of a page is
 * the same for everyone who sees that version, so sending it once and reusing
 * it for thousands of sessions costs almost nothing — whereas recording the DOM
 * of every visитor would be prohibitive in bandwidth, storage and privacy.
 *
 * Privacy: only the site's own static content is read — headings, labels,
 * buttons, prices. Values typed by the visitor are never captured; for inputs
 * the placeholder or associated label is used instead, which describes what is
 * being asked rather than what was answered.
 */

/** Upper bound on blocks per map, so an enormous page can't send an enormous payload. */
const MAX_BLOCKS = 160;
/** Blocks shorter than this are decoration, not content. */
const MIN_BLOCK_HEIGHT = 8;
/** Text is a label for the block, not its full contents. */
const MAX_TEXT = 140;
/** Re-send a given page version at most once a day per visitor. */
const RESEND_AFTER_MS = 24 * 60 * 60 * 1000;

export interface PageBlock {
  /** Absolute vertical position in the document, in CSS pixels. */
  y: number;
  h: number;
  tag: string;
  id?: string;
  /** Short human-readable label for the block. */
  text?: string;
  /** True when this block asks the visitor for something (a form field). */
  input?: boolean;
}

export interface PageMap {
  /** Identifies this version of the page, so changes are detectable. */
  structureHash: string;
  /** Full document height the blocks were measured against. */
  height: number;
  width: number;
  blocks: PageBlock[];
}

/** Tags that carry meaning worth mapping. */
const MEANINGFUL = new Set([
  "H1", "H2", "H3", "H4", "P", "LI", "BUTTON", "A", "LABEL", "IMG",
  "INPUT", "SELECT", "TEXTAREA", "TABLE", "FORM", "SUMMARY", "BLOCKQUOTE",
]);

/** Never read content from inside these. */
function isSensitive(el: Element): boolean {
  if (el.closest("[data-rta-mask]")) return true;
  const type = (el as HTMLInputElement).type;
  return type === "password";
}

/**
 * A label for a form field that describes the *question*, never the answer.
 * The typed value is deliberately ignored.
 */
function inputLabel(el: Element): string {
  const input = el as HTMLInputElement;
  const byId = input.id ? document.querySelector(`label[for="${CSS.escape(input.id)}"]`) : null;
  return (
    byId?.textContent?.trim() ||
    input.placeholder ||
    input.getAttribute("aria-label") ||
    input.name ||
    input.type ||
    ""
  );
}

function textOf(el: Element): string {
  if (el.tagName === "INPUT" || el.tagName === "SELECT" || el.tagName === "TEXTAREA") {
    return inputLabel(el).slice(0, MAX_TEXT);
  }
  if (el.tagName === "IMG") {
    return ((el as HTMLImageElement).alt || "").slice(0, MAX_TEXT);
  }
  // Direct text only: taking a container's full textContent would repeat the
  // whole page on every ancestor and drown the map in duplicates.
  let direct = "";
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === 3) direct += node.nodeValue ?? "";
  }
  direct = direct.replace(/\s+/g, " ").trim();
  if (direct) return direct.slice(0, MAX_TEXT);
  // Leaf-ish elements (a button wrapping a span) still deserve their label.
  if (el.children.length <= 2) {
    return (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_TEXT);
  }
  return "";
}

/** Stable, cheap hash of the page's structure, used to detect version changes. */
function hashStructure(blocks: PageBlock[]): string {
  const seed = blocks.map((b) => `${b.tag}${b.id ?? ""}${Math.round(b.y / 50)}`).join("|");
  let h = 5381;
  for (let i = 0; i < seed.length; i++) h = ((h << 5) + h + seed.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** Measures the current page into a content map. */
export function buildPageMap(): PageMap | null {
  const scrollTop = window.scrollY;
  const blocks: PageBlock[] = [];

  const candidates = document.body?.querySelectorAll<HTMLElement>("*");
  if (!candidates) return null;

  for (const el of Array.from(candidates)) {
    if (!MEANINGFUL.has(el.tagName)) continue;
    if (isSensitive(el)) continue;

    const rect = el.getBoundingClientRect();
    if (rect.height < MIN_BLOCK_HEIGHT || rect.width < 2) continue;
    // Elements never rendered carry no meaning for where someone stopped.
    if (rect.bottom < 0 && rect.top < 0 && rect.height === 0) continue;

    const isInput = el.tagName === "INPUT" || el.tagName === "SELECT" || el.tagName === "TEXTAREA";
    const text = textOf(el);
    if (!text && !isInput && el.tagName !== "IMG") continue;

    blocks.push({
      y: Math.round(rect.top + scrollTop),
      h: Math.round(rect.height),
      tag: el.tagName.toLowerCase(),
      id: el.id || undefined,
      text: text || undefined,
      input: isInput || undefined,
    });
  }

  if (blocks.length === 0) return null;
  blocks.sort((a, b) => a.y - b.y);
  const kept = capBlocks(blocks);

  return {
    structureHash: hashStructure(blocks),
    height: Math.round(document.documentElement.scrollHeight),
    width: Math.round(window.innerWidth),
    blocks: kept,
  };
}

/**
 * Trims an oversized map without blinding the bottom of the page.
 *
 * Truncating in document order would map only the top of a long page, so every
 * abandonment further down would land on unmapped ground and vanish from the
 * analysis — silently, and precisely where long sales pages lose people.
 * Interactive elements and headings are always kept because they are what a
 * visitor stops on; the remaining budget is spread evenly over the height.
 */
function capBlocks(blocks: PageBlock[]): PageBlock[] {
  if (blocks.length <= MAX_BLOCKS) return blocks;

  const anchors: PageBlock[] = [];
  const rest: PageBlock[] = [];
  for (const b of blocks) {
    if (b.input || b.tag === "button" || /^h[1-3]$/.test(b.tag)) anchors.push(b);
    else rest.push(b);
  }

  const budget = Math.max(0, MAX_BLOCKS - anchors.length);
  const step = budget > 0 ? rest.length / budget : Infinity;
  const sampled: PageBlock[] = [];
  for (let i = 0; i < rest.length && sampled.length < budget; i += step) {
    sampled.push(rest[Math.floor(i)]!);
  }

  return [...anchors, ...sampled].sort((a, b) => a.y - b.y).slice(0, MAX_BLOCKS);
}

/**
 * Whether this visitor should send the map for this page version now.
 *
 * The map is identical for everyone on a version, so one visitor in a while is
 * enough. Keyed by version so a page change is picked up immediately instead of
 * waiting out the interval.
 */
export function shouldSendMap(path: string, structureHash: string): boolean {
  const key = `__rta_map_${path}_${structureHash}`;
  try {
    const last = Number(localStorage.getItem(key) ?? 0);
    if (Date.now() - last < RESEND_AFTER_MS) return false;
    localStorage.setItem(key, String(Date.now()));
    return true;
  } catch {
    // Storage unavailable: send it, the server deduplicates by version anyway.
    return true;
  }
}
