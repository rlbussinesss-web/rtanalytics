import { query } from "./db.js";
import {
  fitWeights,
  featureKeys,
  CHECKOUT_PATH_PATTERN,
  type PropensityModel,
  type SessionFeatures,
} from "@rtanalytics/shared-types";

/**
 * Trains the conversion-propensity model from the site's own history.
 *
 * Everything is learned from this site's sessions — there is no shared or
 * pretrained model, because what predicts a sale on one offer says nothing
 * about another. One SQL pass reduces the event log to one row per session
 * with the same features the dashboard can observe live; the arithmetic then
 * happens in `fitWeights`, which is pure and unit-tested.
 *
 * Sessions still in progress are excluded: a visitor who arrived thirty
 * seconds ago has not converted *yet*, and counting them as failures would
 * teach the model that everyone loses.
 */

/** How much history to learn from. Long enough to cover weekly rhythm. */
const TRAINING_DAYS = 30;
/** Sessions younger than this may still convert, so they are not evidence. */
const SETTLE_MINUTES = 30;
/** Recomputed at most this often; the shape of a funnel does not move by the second. */
const CACHE_TTL_MS = 5 * 60 * 1000;

interface TrainingRow {
  converted: boolean;
  source: string | null;
  device: string | null;
  country: string | null;
  reached_checkout: boolean;
  pageviews: string;
  clicks: string;
  max_scroll: string | null;
}

const cache = new Map<string, { at: number; model: PropensityModel }>();

export async function getPropensityModel(siteId: string): Promise<PropensityModel> {
  const hit = cache.get(siteId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.model;

  const model = await trainModel(siteId);
  cache.set(siteId, { at: Date.now(), model });
  return model;
}

async function trainModel(siteId: string): Promise<PropensityModel> {
  const rows = await query<TrainingRow>(
    `SELECT
        bool_or(event_type = 'conversion') AS converted,
        max(payload->>'utm_source') AS source,
        max(device) AS device,
        max(country) AS country,
        bool_or(path ~* $2) AS reached_checkout,
        count(*) FILTER (WHERE event_type = 'pageview')::int AS pageviews,
        count(*) FILTER (WHERE event_type = 'click')::int AS clicks,
        max((payload->>'depthPct')::float) FILTER (WHERE event_type = 'scroll') AS max_scroll
      FROM events
      WHERE site_id = $1
        AND is_bot IS NOT TRUE
        AND time >= now() - interval '${TRAINING_DAYS} days'
      GROUP BY session_id
      -- Exclude sessions that may not have finished deciding yet.
      HAVING max(time) < now() - interval '${SETTLE_MINUTES} minutes'`,
    [siteId, CHECKOUT_PATH_PATTERN]
  );

  const totals = { sessions: rows.length, conversions: 0 };
  const perKey = new Map<string, { sessions: number; conversions: number }>();

  for (const row of rows) {
    const converted = row.converted === true;
    if (converted) totals.conversions += 1;

    const features: SessionFeatures = {
      source: row.source ?? undefined,
      device: row.device ?? undefined,
      country: row.country ?? undefined,
      reachedCheckout: row.reached_checkout === true,
      pageviews: Number(row.pageviews ?? 0),
      clicks: Number(row.clicks ?? 0),
      maxScroll: Number(row.max_scroll ?? 0),
    };

    for (const key of featureKeys(features)) {
      const acc = perKey.get(key) ?? { sessions: 0, conversions: 0 };
      acc.sessions += 1;
      if (converted) acc.conversions += 1;
      perKey.set(key, acc);
    }
  }

  return fitWeights(totals, perKey);
}
