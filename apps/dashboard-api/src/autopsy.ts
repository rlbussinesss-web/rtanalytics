import { query } from "./db.js";
import type { RangeKey } from "./metrics.js";

/**
 * Abandonment autopsy: what was on screen when each visitor gave up.
 *
 * Every other analysis in this product ends at "they left on /recarga". That
 * names a page, not a reason, and a page cannot be fixed. This finds the last
 * position each lost session held, translates it into the content that sat
 * there, and groups thousands of those moments — so the output is not a page
 * but an objection: "1.243 pessoas pararam olhando o campo de CPF".
 *
 * Two deliberate limits keep it from inventing certainty:
 *  - only sessions with a viewport trail can be examined; a session that never
 *    reported a position is excluded rather than guessed at, and the response
 *    says how many were skipped;
 *  - a page with no content map yields nothing, because without knowing what
 *    lives at each height the position means nothing.
 */

const RANGE_INTERVAL: Record<RangeKey, string> = {
  "24h": "24 hours",
  "7d": "7 days",
  "30d": "30 days",
};

/** Below this, a cluster is an anecdote rather than a pattern. */
const MIN_CLUSTER = 3;

interface PageBlock {
  y: number;
  h: number;
  tag: string;
  id?: string;
  text?: string;
  input?: boolean;
}

export interface Objection {
  id: string;
  /** Human-readable description of what they were looking at. */
  label: string;
  /** The element kind, so the UI can show the right affordance. */
  kind: "campo" | "botão" | "texto" | "imagem" | "preço";
  path: string;
  /** Sessions that died looking at this. */
  sessions: number;
  /** Share of all examined abandonments. */
  share: number;
  /** Conversions this likely cost, at the site's own conversion rate. */
  estimatedLostConversions: number;
  /** Only present when conversions carry a value. */
  estimatedLostRevenue: number | null;
  /** Vertical position of the block, for the UI to point at it. */
  y: number;
  h: number;
  /** A few sessions to watch, as evidence. */
  sampleSessions: string[];
}

export interface AutopsyReport {
  range: RangeKey;
  /** Abandoned sessions that could be examined. */
  examined: number;
  /** Abandoned sessions with no position trail — excluded, not guessed. */
  skippedNoTrail: number;
  /** True once there is enough material for the grouping to mean anything. */
  enoughData: boolean;
  objections: Objection[];
  /** Paths that have deaths but no content map yet. */
  missingMaps: string[];
}

interface DeathRow {
  session_id: string;
  path: string;
  y: string | null;
  h: string | null;
}

interface MapRow {
  path: string;
  blocks: PageBlock[];
}

/** Classifies a block into something a person would recognise. */
function kindOf(b: PageBlock): Objection["kind"] {
  if (b.input) return "campo";
  if (b.tag === "button" || b.tag === "a") return "botão";
  if (b.tag === "img") return "imagem";
  if (b.text && /R\$|\d+,\d{2}|preço|valor|frete/i.test(b.text)) return "preço";
  return "texto";
}

/**
 * The block a visitor was most likely looking at.
 *
 * Not simply "the topmost visible block": people read toward the middle of the
 * screen, and the block they stopped on is the one occupying that attention.
 * Interactive elements win ties because stopping on a field you must fill is a
 * stronger signal than stopping on the paragraph beside it.
 */
function anchorBlock(blocks: PageBlock[], y: number, h: number): PageBlock | null {
  const top = y;
  const bottom = y + h;
  const centre = y + h / 2;

  const visible = blocks.filter((b) => b.y + b.h > top && b.y < bottom && (b.text || b.input));
  if (visible.length === 0) return null;

  let best: PageBlock | null = null;
  let bestScore = -Infinity;
  for (const b of visible) {
    const blockCentre = b.y + b.h / 2;
    const distance = Math.abs(blockCentre - centre);
    // Closer to the centre of attention is better; interactive elements and
    // headings carry more meaning than body copy at the same distance.
    const weight = b.input ? 220 : b.tag === "button" ? 180 : /^h[1-3]$/.test(b.tag) ? 90 : 0;
    const score = weight - distance;
    if (score > bestScore) {
      bestScore = score;
      best = b;
    }
  }
  return best;
}

export async function computeAutopsy(siteId: string, range: RangeKey): Promise<AutopsyReport> {
  const interval = RANGE_INTERVAL[range];

  const [deaths, maps, rateRow] = await Promise.all([
    // The last position each abandoning session held. DISTINCT ON gives the
    // most recent viewport event per session; the last sample inside it is the
    // final place the visitor was before leaving.
    query<DeathRow>(
      `SELECT DISTINCT ON (v.session_id)
              v.session_id,
              v.path,
              (v.payload->'samples'->-1->>'y') AS y,
              (v.payload->'samples'->-1->>'h') AS h
         FROM events v
        WHERE v.site_id = $1
          AND v.is_bot IS NOT TRUE
          AND v.event_type = 'viewport'
          AND v.time >= now() - interval '${interval}'
          AND NOT EXISTS (
            SELECT 1 FROM events c
             WHERE c.site_id = v.site_id
               AND c.session_id = v.session_id
               AND c.event_type = 'conversion'
          )
        ORDER BY v.session_id, v.time DESC`,
      [siteId]
    ),
    // The most recently seen map for each path.
    query<MapRow>(
      `SELECT DISTINCT ON (path) path, blocks
         FROM page_maps
        WHERE site_id = $1
        ORDER BY path, last_seen DESC`,
      [siteId]
    ),
    query<{ sessions: string; conversions: string; revenue: string | null }>(
      `SELECT count(DISTINCT session_id)::int AS sessions,
              count(DISTINCT session_id) FILTER (WHERE event_type = 'conversion')::int AS conversions,
              sum((payload->>'value')::float) FILTER (WHERE event_type = 'conversion') AS revenue
         FROM events
        WHERE site_id = $1 AND is_bot IS NOT TRUE
          AND time >= now() - interval '${interval}'`,
      [siteId]
    ),
  ]);

  const mapByPath = new Map(maps.map((m) => [m.path, m.blocks]));
  const totals = rateRow[0];
  const sessions = Number(totals?.sessions ?? 0);
  const conversions = Number(totals?.conversions ?? 0);
  const revenue = totals?.revenue == null ? null : Number(totals.revenue);
  const conversionRate = sessions > 0 ? conversions / sessions : 0;
  const valuePerConversion = revenue != null && conversions > 0 ? revenue / conversions : null;

  const clusters = new Map<
    string,
    { block: PageBlock; path: string; sessions: string[] }
  >();
  let examined = 0;
  let skippedNoTrail = 0;
  const missing = new Set<string>();

  for (const d of deaths) {
    if (d.y == null || d.h == null) {
      skippedNoTrail += 1;
      continue;
    }
    const blocks = mapByPath.get(d.path);
    if (!blocks) {
      missing.add(d.path);
      continue;
    }
    const block = anchorBlock(blocks, Number(d.y), Number(d.h));
    if (!block) continue;

    examined += 1;
    // Identity is content-based, so the same block keeps its cluster even if the
    // page shifts it a few pixels between versions.
    const key = `${d.path}|${block.tag}|${block.id ?? ""}|${(block.text ?? "").slice(0, 60)}`;
    const entry = clusters.get(key) ?? { block, path: d.path, sessions: [] };
    entry.sessions.push(d.session_id);
    clusters.set(key, entry);
  }

  const objections: Objection[] = [...clusters.entries()]
    .filter(([, c]) => c.sessions.length >= MIN_CLUSTER)
    .map(([key, c]) => {
      const n = c.sessions.length;
      const lostConversions = n * conversionRate;
      return {
        id: key,
        label: c.block.text?.trim() || `${c.block.tag}${c.block.id ? `#${c.block.id}` : ""}`,
        kind: kindOf(c.block),
        path: c.path,
        sessions: n,
        share: examined > 0 ? n / examined : 0,
        estimatedLostConversions: Math.round(lostConversions * 10) / 10,
        estimatedLostRevenue:
          valuePerConversion != null ? Math.round(lostConversions * valuePerConversion) : null,
        y: c.block.y,
        h: c.block.h,
        sampleSessions: c.sessions.slice(0, 5),
      };
    })
    .sort((a, b) => b.sessions - a.sessions);

  return {
    range,
    examined,
    skippedNoTrail,
    enoughData: objections.length > 0,
    objections,
    missingMaps: [...missing],
  };
}
