import { query } from "./db.js";
import { allowSite, disallowSite } from "./redis.js";

/**
 * Projects: one per offer being tracked.
 *
 * Sites used to be discovered from the event log, which meant a new landing
 * page did not exist in the product until it already had visitors — backwards
 * for the moment you actually need it, which is while you are installing the
 * script. A project is created first, hands you a tracking key and a snippet,
 * and starts collecting when you paste it.
 *
 * Discovered sites are still merged in, so anything already sending data keeps
 * working and can be adopted by naming it.
 */

/** A hostname detected from real events, with recency metadata. */
export interface DetectedDomain {
  host: string;
  lastSeen: string;
  sessions7d: number;
}

export interface Project {
  siteId: string;
  name: string;
  /** @deprecated kept for backward compat; use detectedDomains instead. */
  domain: string | null;
  createdAt: string | null;
  /** URL that marks a conversion, e.g. "/pagamento". */
  conversionPath: string | null;
  /** True when this came from the event log without ever being created here. */
  discovered: boolean;
  sessions7d: number;
  conversions7d: number;
  lastSeen: string | null;
  /** Hostnames extracted from real events — the source of truth for where the tracker is installed. */
  detectedDomains: DetectedDomain[];
}

/** Characters that are safe in an HTML attribute and readable in a URL. */
const SLUG_SAFE = /[^a-z0-9]+/g;

/**
 * Builds a tracking key from the project name.
 *
 * Readable rather than random because it appears in the snippet the user
 * pastes, in their own HTML, and in every debugging session afterwards — but
 * suffixed, because two offers called "recarga" must never collide and silently
 * pool their traffic into one set of numbers.
 */
function makeSiteId(name: string): string {
  const slug =
    name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(SLUG_SAFE, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 32) || "site";
  const suffix = Math.random().toString(36).slice(2, 6);
  return `${slug}-${suffix}`;
}

export async function listProjects(): Promise<Project[]> {
  const [rows, stats, hostStats] = await Promise.all([
    query<{
      site_id: string;
      name: string;
      domain: string | null;
      created_at: Date;
      conversion_path: string | null;
    }>(
      `SELECT site_id, name, domain, created_at, conversion_path FROM projects
        WHERE archived_at IS NULL
        ORDER BY created_at DESC`
    ),
    // Activity for every site that has data, whether or not it was created here.
    query<{
      site_id: string;
      sessions: string;
      conversions: string;
      last_seen: Date;
    }>(
      `SELECT site_id,
              count(DISTINCT session_id) FILTER (WHERE time >= now() - interval '7 days')::int AS sessions,
              count(DISTINCT session_id) FILTER (
                WHERE event_type = 'conversion' AND time >= now() - interval '7 days'
              )::int AS conversions,
              max(time) AS last_seen
         FROM events
        WHERE is_bot IS NOT TRUE AND time >= now() - interval '30 days'
        GROUP BY site_id`
    ),
    // Detected domains: real hostnames from events, aggregated per site.
    query<{
      site_id: string;
      host: string;
      sessions: string;
      last_seen: Date;
    }>(
      `SELECT site_id, host,
              count(DISTINCT session_id)::int AS sessions,
              max(time) AS last_seen
         FROM events
        WHERE host IS NOT NULL
          AND is_bot IS NOT TRUE
          AND time >= now() - interval '30 days'
        GROUP BY site_id, host
        ORDER BY site_id, last_seen DESC`
    ),
  ]);

  const statBySite = new Map(stats.map((s) => [s.site_id, s]));
  const domainsBySite = new Map<string, DetectedDomain[]>();
  for (const d of hostStats) {
    const list = domainsBySite.get(d.site_id) ?? [];
    list.push({
      host: d.host,
      sessions7d: Number(d.sessions),
      lastSeen: d.last_seen.toISOString(),
    });
    domainsBySite.set(d.site_id, list);
  }

  const projects: Project[] = rows.map((r) => {
    const s = statBySite.get(r.site_id);
    return {
      siteId: r.site_id,
      name: r.name,
      domain: r.domain,
      createdAt: r.created_at.toISOString(),
      conversionPath: r.conversion_path,
      discovered: false,
      sessions7d: Number(s?.sessions ?? 0),
      conversions7d: Number(s?.conversions ?? 0),
      lastSeen: s?.last_seen ? s.last_seen.toISOString() : null,
      detectedDomains: domainsBySite.get(r.site_id) ?? [],
    };
  });

  // Anything sending data that was never registered here still deserves to be
  // visible — otherwise an existing install would vanish from the product.
  // Archived keys are excluded: the user already said they did not want it.
  const archived = await query<{ site_id: string }>(
    `SELECT site_id FROM projects WHERE archived_at IS NOT NULL`
  );
  const known = new Set([
    ...rows.map((r) => r.site_id),
    ...archived.map((r) => r.site_id),
  ]);
  for (const s of stats) {
    if (known.has(s.site_id)) continue;
    projects.push({
      siteId: s.site_id,
      name: s.site_id,
      domain: null,
      createdAt: null,
      conversionPath: null,
      discovered: true,
      sessions7d: Number(s.sessions),
      conversions7d: Number(s.conversions),
      lastSeen: s.last_seen ? s.last_seen.toISOString() : null,
      detectedDomains: domainsBySite.get(s.site_id) ?? [],
    });
  }

  return projects.sort((a, b) => b.sessions7d - a.sessions7d);
}

/**
 * Creates a project, or adopts a key that is already sending data.
 *
 * `existingSiteId` matters for sites discovered from the event log: naming one
 * must keep its key, because that key is already pasted into a live page.
 * Minting a new one would rename the project and orphan the install at once.
 */
export async function createProject(
  name: string,
  domain?: string,
  existingSiteId?: string
): Promise<Project> {
  const clean = name.trim().slice(0, 80) || "Novo projeto";
  const siteId = existingSiteId?.trim() || makeSiteId(clean);

  await query(
    `INSERT INTO projects (site_id, name, domain) VALUES ($1, $2, $3)
     ON CONFLICT (site_id) DO UPDATE SET name = EXCLUDED.name,
                                        domain = COALESCE(EXCLUDED.domain, projects.domain),
                                        archived_at = NULL`,
    [siteId, clean, domain?.trim().slice(0, 200) || null]
  );

  // The ingest rejects unknown site ids, so a project is only real once its key
  // is allowed to send. Doing this here means creating a project is the single
  // step — no environment variable to edit per offer.
  await allowSite(siteId);

  return {
    siteId,
    name: clean,
    domain: domain?.trim() || null,
    createdAt: new Date().toISOString(),
    conversionPath: null,
    discovered: false,
    sessions7d: 0,
    conversions7d: 0,
    lastSeen: null,
    detectedDomains: [],
  };
}

/**
 * Updates a project, creating the row when the site was only ever discovered.
 *
 * A plain UPDATE silently matched zero rows for a discovered site — the request
 * still answered "ok" while nothing was stored, so configuring one appeared to
 * work and never did. Writing the row here means configuring a discovered site
 * adopts it, which is what the user is asking for by editing it.
 */
export async function updateProject(
  siteId: string,
  fields: { name?: string; domain?: string; conversionPath?: string }
): Promise<void> {
  // COALESCE on every column so a partial update never blanks the rest.
  await query(
    `INSERT INTO projects (site_id, name, domain, conversion_path)
     VALUES ($1, COALESCE($2, $1), $3, $4)
     ON CONFLICT (site_id) DO UPDATE
        SET name = COALESCE($2, projects.name),
            domain = COALESCE($3, projects.domain),
            conversion_path = COALESCE($4, projects.conversion_path)`,
    [
      siteId,
      fields.name?.trim().slice(0, 80) || null,
      fields.domain?.trim().slice(0, 200) || null,
      fields.conversionPath?.trim().slice(0, 200) || null,
    ]
  );
  // Now that it has a row, it is a project and must be allowed to collect.
  await allowSite(siteId);
}

/**
 * Removes a project and stops accepting its traffic.
 *
 * Collected events are deliberately left untouched: deleting a project is a
 * decision about the list you look at, not permission to destroy history that
 * other reports may still reference.
 */
export async function deleteProject(siteId: string): Promise<void> {
  await query(
    `INSERT INTO projects (site_id, name, archived_at) VALUES ($1, $1, now())
     ON CONFLICT (site_id) DO UPDATE SET archived_at = now()`,
    [siteId]
  );
  await disallowSite(siteId);
}

/**
 * Re-publishes every project's key to the allow list.
 *
 * Redis is a cache, not the record: if it is flushed or replaced, the allow set
 * would come back empty and every project would silently stop collecting. This
 * runs at startup so Postgres remains the source of truth.
 */
export async function syncAllowedSites(): Promise<number> {
  const rows = await query<{ site_id: string }>(
    `SELECT site_id FROM projects WHERE archived_at IS NULL`
  );
  for (const r of rows) await allowSite(r.site_id);
  return rows.length;
}
