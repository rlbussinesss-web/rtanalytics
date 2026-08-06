import { build } from "esbuild";
import { gzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outfile = path.join(__dirname, "dist", "tracker.js");
const GZIP_BUDGET_BYTES = 20 * 1024; // < 20 KB gzip target from the plan

await build({
  entryPoints: [path.join(__dirname, "src", "index.ts")],
  outfile,
  bundle: true,
  minify: true,
  sourcemap: true,
  target: ["es2020"],
  format: "iife",
  platform: "browser",
});

// The rrweb recorder is bundled separately and loaded only when a viewer asks
// to watch a session, so its size never counts against the tracker budget that
// every visitor pays.
const recorderOutfile = path.join(__dirname, "dist", "recorder.js");
await build({
  entryPoints: [path.join(__dirname, "src", "recorder-entry.ts")],
  outfile: recorderOutfile,
  bundle: true,
  minify: true,
  sourcemap: true,
  target: ["es2020"],
  format: "iife",
  platform: "browser",
});

const bundle = readFileSync(outfile);
const gzipped = gzipSync(bundle);
const gzipKb = (gzipped.length / 1024).toFixed(2);
const rawKb = (bundle.length / 1024).toFixed(2);

const recorderGzipKb = (gzipSync(readFileSync(recorderOutfile)).length / 1024).toFixed(2);
console.log(`recorder.js: ${recorderGzipKb} KB gzip (lazy-loaded, off the critical path)`);

console.log(`tracker.js: ${rawKb} KB raw, ${gzipKb} KB gzip (budget: ${(GZIP_BUDGET_BYTES / 1024).toFixed(0)} KB)`);

if (gzipped.length > GZIP_BUDGET_BYTES) {
  console.error(`✗ Bundle exceeds ${GZIP_BUDGET_BYTES / 1024} KB gzip budget.`);
  process.exitCode = 1;
} else {
  console.log("✓ Bundle within gzip budget.");
}
