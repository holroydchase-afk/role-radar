// Bundles each src/<name>.ts into a classic script that sets the same window global the page reads
// (window.RoleRadarScoring, ...), so app/role-radar.html loads them exactly as before.
// Usage: npm run build   → build/<name>.js, the supporting files the live page is published with.
// scripts/build-demo.mjs calls bundles() to inline the same output without touching disk.
import { buildSync } from "esbuild";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Each entry in src/ and the global its bundle sets. The page's <script src="<name>.js"> tags match these. */
export const ENTRIES = {
  scoring: "RoleRadarScoring",
  "gmail-import": "RoleRadarGmail",
  posting: "RoleRadarPosting",
  alerts: "RoleRadarAlerts",
  progress: "RoleRadarProgress",
  "recruiter-store": "RoleRadarRecruiters",
  "skip-feedback": "RoleRadarSkipFeedback",
};

/** One entry as a classic script: an IIFE assigned to its global. */
export function bundle(name) {
  const globalName = ENTRIES[name];
  if (!globalName) throw new Error(`Unknown entry: ${name}`);
  const result = buildSync({
    entryPoints: [join(root, "src", name + ".ts")],
    bundle: true,
    format: "iife",
    globalName,
    platform: "browser",
    target: "es2020",
    write: false,
    logLevel: "silent",
    banner: { js: `/* Role Radar: built from src/${name}.ts by scripts/build.mjs. Edit the source, not this file. */` },
    // A top-level var is already a window property; this keeps it one if the script is ever wrapped in a function.
    footer: { js: `globalThis.${globalName} = ${globalName};` },
  });
  return result.outputFiles[0].text;
}

/** Every bundle, as {"<name>.js": code}. */
export function bundles() {
  return Object.fromEntries(Object.keys(ENTRIES).map((name) => [name + ".js", bundle(name)]));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = process.argv[2] || join(root, "build");
  mkdirSync(out, { recursive: true });
  for (const [file, code] of Object.entries(bundles())) writeFileSync(join(out, file), code);
  console.log(`Wrote ${Object.keys(ENTRIES).length} bundles to ${out}`);
}
