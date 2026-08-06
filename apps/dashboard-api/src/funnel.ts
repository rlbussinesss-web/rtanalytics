import { query } from "./db.js";
import type { RangeKey } from "./metrics.js";

/**
 * Conversion funnel.
 *
 * A funnel is an ordered list of steps; each step is either a page visit
 * (kind "path") or a conversion goal (kind "event"). For each step we report
 * how many sessions reached that step *and every step before it* — the
 * cumulative definition, which is what makes drop-off between steps meaningful.
 *
 * The per-step session sets are intersected in JS rather than in one big SQL
 * join: at this scale the sets are small, and it keeps the query per step
 * trivial and index-friendly (site_id, time). Order within a session is not
 * enforced yet (a session that hit step 2 before step 1 still counts) — a
 * deliberate simplification; strict ordering can come later if needed.
 */

const RANGE_INTERVAL: Record<RangeKey, string> = {
  "24h": "24 hours",
  "7d": "7 days",
  "30d": "30 days",
};

export interface FunnelStepInput {
  kind: "path" | "event";
  value: string;
  label?: string;
}

export interface FunnelStepResult {
  label: string;
  sessions: number;
  /** Fraction of the first step's sessions still present here (0..1). */
  rate: number;
  /** Fraction lost since the previous step (0..1). */
  dropoff: number;
}

async function sessionsForStep(
  siteId: string,
  interval: string,
  step: FunnelStepInput
): Promise<Set<string>> {
  const since = `now() - interval '${interval}'`;
  const rows =
    step.kind === "event"
      ? await query<{ session_id: string }>(
          `SELECT DISTINCT session_id FROM events
            WHERE site_id = $1 AND time >= ${since}
              AND event_type = 'conversion' AND payload->>'name' = $2`,
          [siteId, step.value]
        )
      : await query<{ session_id: string }>(
          `SELECT DISTINCT session_id FROM events
            WHERE site_id = $1 AND time >= ${since}
              AND event_type = 'pageview' AND path = $2`,
          [siteId, step.value]
        );
  return new Set(rows.map((r) => r.session_id));
}

export async function computeFunnel(
  siteId: string,
  range: RangeKey,
  steps: FunnelStepInput[]
): Promise<FunnelStepResult[]> {
  const interval = RANGE_INTERVAL[range];
  const stepSets = await Promise.all(
    steps.map((s) => sessionsForStep(siteId, interval, s))
  );

  const results: FunnelStepResult[] = [];
  let reached: Set<string> | null = null;
  let firstCount = 0;
  let prevCount = 0;

  steps.forEach((step, i) => {
    const set = stepSets[i]!;
    // Cumulative: sessions present at this step AND all previous ones.
    reached =
      reached === null
        ? set
        : new Set([...reached].filter((id) => set.has(id)));

    const count = reached.size;
    if (i === 0) firstCount = count;

    results.push({
      label: step.label || step.value,
      sessions: count,
      rate: firstCount > 0 ? count / firstCount : 0,
      dropoff: i === 0 || prevCount === 0 ? 0 : (prevCount - count) / prevCount,
    });
    prevCount = count;
  });

  return results;
}
