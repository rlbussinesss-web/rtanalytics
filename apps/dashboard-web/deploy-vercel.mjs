/**
 * Publishes the dashboard to Vercel.
 *
 * The dashboard is a static SPA, so Vercel hosts it for free with a global
 * CDN — which also keeps the Railway project under its service limit, since
 * only the always-connected services (ingest, dashboard-api, workers) need
 * to live there.
 *
 * We deploy the built `dist/` directory rather than letting Vercel build,
 * because Vite inlines the API URLs at build time and the build needs the
 * whole pnpm workspace. `vercel.json` and the tracker bundle are copied in
 * so the published site serves both the SPA and /tracker.js.
 *
 * Usage: pnpm --filter @rtanalytics/dashboard-web deploy
 */
import { execSync } from "node:child_process";
import { copyFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, "dist");
const trackerBundle = join(here, "..", "tracker", "dist", "tracker.js");

const required = [
  "VITE_DASHBOARD_API_URL",
  "VITE_DASHBOARD_API_WS_URL",
  "VITE_SITE_ID",
];
const missing = required.filter((name) => !process.env[name]);
if (missing.length > 0) {
  console.error(
    `Missing build-time env vars: ${missing.join(", ")}\n` +
      "These are inlined into the bundle by Vite, so they must be set before building.\n" +
      "Note VITE_DASHBOARD_API_WS_URL must use wss:// — browsers refuse plain ws:// from an https:// page."
  );
  process.exit(1);
}

const run = (cmd, cwd = here) => {
  console.log(`$ ${cmd}`);
  execSync(cmd, { cwd, stdio: "inherit" });
};

run("pnpm --filter @rtanalytics/tracker build", join(here, "..", ".."));
run("pnpm --filter @rtanalytics/dashboard-web build", join(here, "..", ".."));

if (!existsSync(trackerBundle)) {
  console.error(`Tracker bundle not found at ${trackerBundle}`);
  process.exit(1);
}
copyFileSync(trackerBundle, join(dist, "tracker.js"));
copyFileSync(join(here, "vercel.json"), join(dist, "vercel.json"));
console.log("Copied tracker.js and vercel.json into dist/");

run("vercel deploy --prod --yes", dist);
