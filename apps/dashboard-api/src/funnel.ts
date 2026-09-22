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
): Promise<Map<string, number>> {
  const since = `now() - interval '${interval}'`;
  // Use MIN(time) so we can enforce ordering: a session only counts at step N
  // if it reached step N *after* reaching every previous step. Without this,
  // a visitor who jumped straight to checkout would inflate every earlier step
  // and mask the real drop-off points.
  const rows =
    step.kind === "event"
      ? await query<{ session_id: string; first_at: string }>(
          `SELECT session_id, min(time) AS first_at FROM events
            WHERE site_id = $1 AND is_bot IS NOT TRUE AND time >= ${since}
              AND event_type = 'conversion' AND payload->>'name' = $2
            GROUP BY session_id`,
          [siteId, step.value]
        )
      : await query<{ session_id: string; first_at: string }>(
          `SELECT session_id, min(time) AS first_at FROM events
            WHERE site_id = $1 AND is_bot IS NOT TRUE AND time >= ${since}
              AND event_type = 'pageview' AND path = $2
            GROUP BY session_id`,
          [siteId, step.value]
        );
  const map = new Map<string, number>();
  for (const r of rows) map.set(r.session_id, new Date(r.first_at).getTime());
  return map;
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
  // `reached` tracks sessions that made it through every prior step *in order*,
  // along with the timestamp at which they completed the last step. A session
  // only advances to step N if its first_at for step N is strictly after the
  // timestamp recorded for step N-1 — this prevents a direct-to-checkout visit
  // from inflating earlier steps and masking the real drop-off.
  let reached: Map<string, number> | null = null;
  let firstCount = 0;
  let prevCount = 0;

  steps.forEach((step, i) => {
    const stepMap = stepSets[i]!;

    if (reached === null) {
      reached = stepMap;
    } else {
      const next = new Map<string, number>();
      for (const [sessionId, prevTime] of reached) {
        const stepTime = stepMap.get(sessionId);
        if (stepTime !== undefined && stepTime > prevTime) {
          next.set(sessionId, stepTime);
        }
      }
      reached = next;
    }

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
