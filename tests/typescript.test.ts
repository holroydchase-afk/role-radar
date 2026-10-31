// RR-TS: strict TypeScript conversion of Role Radar's logic and tests.
// Written red-first by qa-tdd (as typescript.test.mjs); renamed to .ts with the conversion.
//
// Design (approved): src/*.ts ES modules with named exports; esbuild bundles each entry to an
// IIFE classic script with the same global and file name into build/ (gitignored);
// scripts/build-demo.mjs bundles in memory and inlines them; tests run on Node 22 type stripping.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync, statSync, mkdtempSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import type { SpawnSyncReturns } from "node:child_process";
import { tmpdir } from "node:os";
import vm from "node:vm";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// The global and the exported names each classic script exposes today (captured from main's
// src/*.js via require on 2026-10-29). The bundles and the .ts modules must keep exactly these.
const MODULES = {
  scoring: { global: "RoleRadarScoring", keys: ["FIT_POINTS", "buildDigest", "cultureFitOf", "explain", "matchJob", "parseComp", "scoreJob", "scoreSplit", "sectorFor", "valuesFitOf"] },
  "gmail-import": { global: "RoleRadarGmail", keys: ["DEFAULT_QUERY", "candidates", "companyFromEmail", "dateOf", "isAutomated", "needsFullThread", "nextStatus", "parseAddress", "recruiterDoc", "signalOf", "slug", "statusPatch", "statusQuery", "statusUpdates", "threadsFrom", "typeFor"] },
  posting: { global: "RoleRadarPosting", keys: ["ATS", "ATS_LABEL", "apiUrl", "decodeEntities", "extractHtml", "fromUrl", "postingSource", "sanitizeHtml"] },
  alerts: { global: "RoleRadarAlerts", keys: ["CHANNELS", "DEFAULT_RULES", "EVENTS", "LEVELS", "clock", "describe", "evaluate", "inQuietHours", "matches", "normalize"] },
  progress: { global: "RoleRadarProgress", keys: ["RESPONSE_AFTER_DAYS", "STAGES", "benchmarks", "businessDaysSince", "coverageLine", "dashboard", "dayKey", "dayStart", "emailWindow", "homeStats", "periodReport", "reached", "scanStale", "skippedBy", "snapshot", "toMs", "topNew", "weekStart"] },
  "recruiter-store": { global: "RoleRadarRecruiters", keys: ["PATH", "RULES", "create"] },
  "skip-feedback": { global: "RoleRadarSkipFeedback", keys: ["WINDOW_DAYS", "analyze", "applyToYaml", "ownerSkips"] },
};
const NAMES = Object.keys(MODULES);

const readJson = (p: string) => JSON.parse(readFileSync(join(root, p), "utf8"));
const filesIn = (dir: string) => {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(join(root, d))) {
      const rel = join(d, name);
      if (statSync(join(root, rel)).isDirectory()) walk(rel);
      else out.push(rel);
    }
  };
  walk(dir);
  return out;
};
const npm = (script: string) => spawnSync("npm", ["run", "--silent", script], { cwd: root, encoding: "utf8", timeout: 180_000 });
const why = (r: SpawnSyncReturns<string>) => `exit ${r.status}${r.error ? " (" + r.error.message + ")" : ""}\n${(r.stdout || "").slice(-2000)}\n${(r.stderr || "").slice(-2000)}`;

test("RR-TS-1 src/ holds only .ts sources: no hand-written .js/.mjs/.cjs and no src/package.json", () => {
  const files = filesIn("src");
  const js = files.filter((f) => /\.(c|m)?js$/.test(f));
  assert.deepEqual(js, [], "hand-written JS left in src/");
  assert.ok(!existsSync(join(root, "src/package.json")), "src/package.json should be gone (it only forced commonjs)");
  for (const n of NAMES) assert.ok(files.includes(join("src", n + ".ts")), `missing src/${n}.ts`);
});

test("RR-TS-2 every test file in tests/ is TypeScript (*.ts)", () => {
  const bad = filesIn("tests").filter((f) => !f.endsWith(".ts"));
  assert.deepEqual(bad, [], "non-.ts files left in tests/ (rename this file to typescript.test.ts too)");
});

test("RR-TS-3 tsconfig.json is strict, noEmit, erasableSyntaxOnly, ES2022+ and types node", () => {
  assert.ok(existsSync(join(root, "tsconfig.json")), "tsconfig.json missing");
  const c = readJson("tsconfig.json").compilerOptions || {};
  assert.equal(c.strict, true, "strict");
  assert.equal(c.noEmit, true, "noEmit");
  assert.equal(c.erasableSyntaxOnly, true, "erasableSyntaxOnly");
  assert.equal(c.allowImportingTsExtensions, true, "allowImportingTsExtensions");
  const es = (v: unknown) => /^es(next|20(2[2-9]|[3-9]\d))$/i.test(String(v || ""));
  assert.ok(es(c.target), `target should be ES2022 or later, got ${c.target}`);
  assert.ok(es(c.module) || /^(node|nodenext|node1[68]|node20|preserve)$/i.test(String(c.module || "")), `module should be ES2022+, got ${c.module}`);
  assert.ok(Array.isArray(c.types) && c.types.includes("node"), "types should include node");
});

test("RR-TS-4 package.json: typecheck and build scripts, TS dev deps, only the MCP server's runtime deps, tests run as .ts", () => {
  const pkg = readJson("package.json");
  assert.match(pkg.scripts?.typecheck || "", /\btsc\b.*-p\s+\./, "scripts.typecheck should be `tsc -p .`");
  assert.ok(pkg.scripts?.build, "scripts.build missing");
  for (const d of ["typescript", "esbuild", "@types/node"]) assert.ok(pkg.devDependencies?.[d], `devDependencies.${d} missing`);
  // Issue #59: the stdio MCP server (mcp/server.ts) is the only runtime; these two deps are all it may pull in.
  assert.deepEqual(Object.keys(pkg.dependencies || {}).sort(), ["@modelcontextprotocol/sdk", "js-yaml"], "runtime deps are only the MCP server's");
  assert.match(pkg.scripts?.test || "", /tests\/\*\.test\.ts/, "npm test should run tests/*.test.ts");
  assert.doesNotMatch(pkg.scripts?.test || "", /\.test\.mjs/, "npm test should no longer glob .mjs tests");
});

test("RR-TS-5 .gitignore ignores build/", () => {
  const lines = readFileSync(join(root, ".gitignore"), "utf8").split(/\r?\n/).map((l) => l.trim());
  assert.ok(lines.includes("build/") || lines.includes("/build/"), ".gitignore should list build/");
});

test("RR-TS-6 each src/<name>.ts is an ES module with the same named exports as today", async () => {
  for (const [n, { keys }] of Object.entries(MODULES)) {
    const p = join(root, "src", n + ".ts");
    assert.ok(existsSync(p), `missing src/${n}.ts`);
    const mod = await import(p);
    assert.deepEqual(Object.keys(mod).filter((k) => k !== "default").sort(), keys, `named exports of src/${n}.ts`);
  }
});

test("RR-TS-7 npm run typecheck passes and covers src and tests", () => {
  const r = npm("typecheck");
  assert.equal(r.status, 0, "typecheck failed: " + why(r));
  const tsc = join(root, "node_modules/.bin/tsc");
  assert.ok(existsSync(tsc), "typescript not installed");
  const list = spawnSync(tsc, ["-p", ".", "--listFilesOnly"], { cwd: root, encoding: "utf8", timeout: 180_000 });
  assert.equal(list.status, 0, why(list));
  const files = list.stdout.split(/\r?\n/).map((f) => f.replace(/\\/g, "/"));
  for (const n of NAMES) assert.ok(files.some((f) => f.endsWith(`/src/${n}.ts`)), `tsconfig does not include src/${n}.ts`);
  assert.ok(files.some((f) => /\/tests\/[^/]+\.test\.ts$/.test(f)), "tsconfig does not include tests/*.test.ts");
});

test("RR-TS-8 npm run build writes build/<name>.js classic scripts exposing the same globals and names", () => {
  const r = npm("build");
  assert.equal(r.status, 0, "build failed: " + why(r));
  for (const [n, { global, keys }] of Object.entries(MODULES)) {
    const file = join(root, "build", n + ".js");
    assert.ok(existsSync(file), `missing build/${n}.js`);
    const code = readFileSync(file, "utf8");
    assert.doesNotMatch(code, /^\s*(import|export)\s/m, `build/${n}.js must be a classic script, not an ES module`);
    const sandbox: Record<string, any> = {};
    sandbox.window = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(code, sandbox, { filename: `build/${n}.js` });
    const api = sandbox[global];
    assert.ok(api && typeof api === "object", `build/${n}.js should set window.${global}`);
    assert.deepEqual(Object.keys(api).sort(), keys, `exports on window.${global}`);
    for (const k of keys) assert.notEqual(api[k], undefined, `window.${global}.${k} is undefined`);
  }
});

test("RR-TS-9 the built demo inlines all 7 bundles: no <script src> for them, globals defined", () => {
  const out = join(mkdtempSync(join(tmpdir(), "rr-ts-")), "demo.html");
  try {
    const r = spawnSync(process.execPath, ["scripts/build-demo.mjs", out], { cwd: root, encoding: "utf8", timeout: 180_000 });
    assert.equal(r.status, 0, "build-demo failed: " + why(r));
    const html = readFileSync(out, "utf8");
    for (const n of NAMES) assert.ok(!html.includes(`<script src="${n}.js">`), `${n}.js is not inlined`);
    for (const { global } of Object.values(MODULES)) {
      assert.match(html, new RegExp(`\\b${global}\\s*=`), `inlined bundle should assign ${global}`);
    }
    assert.doesNotMatch(html, /\bmodule\.exports\b/, "inlined scripts should be esbuild bundles, not the old UMD sources");
  } finally {
    rmSync(dirname(out), { recursive: true, force: true });
  }
});
