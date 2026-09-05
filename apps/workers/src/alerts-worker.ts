import type { Redis } from "ioredis";
import { getPool } from "./db.js";
import { buildBaseline, detectSpike, type Baseline } from "@rtanalytics/shared-types";

/**
 * Traffic spike alerts.
 *
 * A dashboard only helps while someone is looking at it, and a media buyer is
 * usually looking at their phone instead. Visitors arriving in a burst is the
 * first observable sign that a campaign started delivering — and therefore
 * spending — so that is the moment worth pushing out of the browser.
 *
 * The comparison is seasonal (same slot on previous weeks) rather than against
 * the last few minutes, because traffic has a daily and weekly shape. On a site
 * without that history yet, the absolute floor alone decides: a new site should
 * still be able to say "people are arriving" instead of staying silent until it
 * has a month of data.
 */

/** How often the check runs. */
const TICK_MS = 60_000;
/** Window of arrivals each tick measures. */
const WINDOW_MINUTES = 15;
/** Weekly slots used to learn what this time of week normally looks like. */
const HISTORY_WEEKS = 4;

/** Never alert below this many visitors, however dramatic the ratio. */
const MIN_VISITORS = Number(process.env.SPIKE_MIN_VISITORS ?? 5);
/** How far above normal counts as a spike, once normal is known. */
const MULTIPLIER = Number(process.env.SPIKE_MULTIPLIER ?? 2);
/** Silence per site after an alert, so one campaign burst sends one message. */
const COOLDOWN_MINUTES = Number(process.env.SPIKE_COOLDOWN_MINUTES ?? 30);

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? "";
const CHAT_ID = process.env.TELEGRAM_CHAT_ID ?? "";
/** Optional link back to the dashboard, included in the message. */
const DASHBOARD_URL = process.env.DASHBOARD_URL ?? "";

interface SiteReading {
  siteId: string;
  visitors: number;
  topSource: string | null;
}

/** Arrivals per site in the current window. */
async function currentReadings(): Promise<SiteReading[]> {
  const { rows } = await getPool().query<{
    site_id: string;
    visitors: string;
    top_source: string | null;
  }>(
    `SELECT site_id,
            count(DISTINCT session_id)::int AS visitors,
            mode() WITHIN GROUP (ORDER BY payload->>'utm_source') AS top_source
       FROM events
      WHERE is_bot IS NOT TRUE
        AND time >= now() - interval '${WINDOW_MINUTES} minutes'
      GROUP BY site_id`
  );
  return rows.map((r) => ({
    siteId: r.site_id,
    visitors: Number(r.visitors),
    topSource: r.top_source,
  }));
}

/**
 * What this slot normally looks like, from the same window on previous weeks.
 * Returned per site so a quiet project cannot drag a busy one's baseline.
 */
async function baselines(): Promise<Map<string, Baseline>> {
  const { rows } = await getPool().query<{
    site_id: string;
    k: string;
    visitors: string;
  }>(
    `SELECT e.site_id, k::int AS k, count(DISTINCT e.session_id)::int AS visitors
       FROM generate_series(1, ${HISTORY_WEEKS}) AS k
       JOIN events e
         ON e.is_bot IS NOT TRUE
        AND e.time >= now() - (interval '7 days' * k) - interval '${WINDOW_MINUTES} minutes'
        AND e.time <  now() - (interval '7 days' * k)
      GROUP BY e.site_id, k`
  );

  const perSite = new Map<string, number[]>();
  for (const r of rows) {
    const list = perSite.get(r.site_id) ?? [];
    list.push(Number(r.visitors));
    perSite.set(r.site_id, list);
  }

  const out = new Map<string, Baseline>();
  for (const [siteId, history] of perSite) {
    // Weeks with no traffic at all are still evidence of a quiet slot.
    while (history.length < HISTORY_WEEKS) history.push(0);
    out.set(siteId, buildBaseline(history));
  }
  return out;
}

/**
 * Claims the right to alert for a site, returning false if one was sent
 * recently. Held in Redis rather than memory so a worker restart cannot turn
 * into a burst of repeat messages.
 */
async function claimCooldown(redis: Redis, siteId: string): Promise<boolean> {
  const key = `alert:spike:${siteId}`;
  const res = await redis.set(key, "1", "EX", COOLDOWN_MINUTES * 60, "NX");
  return res === "OK";
}

async function sendTelegram(text: string): Promise<void> {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: CHAT_ID,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
  });
  if (!res.ok) {
    throw new Error(`telegram ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
}

function buildMessage(r: SiteReading, expected: number, ratio: number | null): string {
  const lines = [
    `🔥 <b>Pico de tráfego</b> — ${escapeHtml(r.siteId)}`,
    `<b>${r.visitors}</b> visitantes nos últimos ${WINDOW_MINUTES} min`,
  ];
  if (ratio !== null) {
    lines.push(`Normal para este horário: ~${Math.round(expected)} (${ratio.toFixed(1)}× acima)`);
  }
  if (r.topSource) lines.push(`Origem principal: ${escapeHtml(r.topSource)}`);
  lines.push("", "A campanha está entregando — e gastando.");
  if (DASHBOARD_URL) lines.push(DASHBOARD_URL);
  return lines.join("\n");
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function tick(redis: Redis): Promise<void> {
  const [readings, norms] = await Promise.all([currentReadings(), baselines()]);

  for (const reading of readings) {
    const baseline = norms.get(reading.siteId) ?? buildBaseline([]);
    const verdict = detectSpike(reading.visitors, baseline, {
      minVisitors: MIN_VISITORS,
      multiplier: MULTIPLIER,
    });
    if (!verdict.isSpike) continue;

    // Cooldown is claimed before sending: better to skip an alert than to send
    // the same one twice if delivery is slow.
    if (!(await claimCooldown(redis, reading.siteId))) continue;

    try {
      await sendTelegram(buildMessage(reading, verdict.expected, verdict.ratio));
      console.log(
        `[alerts] spike ${reading.siteId}: ${reading.visitors} visitors (normal ~${Math.round(verdict.expected)})`
      );
    } catch (err) {
      console.error("[alerts] telegram send failed", err);
    }
  }
}

export function runAlertsWorker(redis: Redis): void {
  if (!BOT_TOKEN || !CHAT_ID) {
    console.log(
      "[alerts] disabled — set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID to receive traffic spike alerts"
    );
    return;
  }

  console.log(
    `[alerts] watching for spikes: >=${MIN_VISITORS} visitors per ${WINDOW_MINUTES}min and ` +
      `>=${MULTIPLIER}x the usual, at most one alert per ${COOLDOWN_MINUTES}min per site`
  );

  const run = () => {
    void tick(redis).catch((err) => console.error("[alerts] tick failed", err));
  };
  run();
  setInterval(run, TICK_MS);
}
