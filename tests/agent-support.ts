/* Shared helpers for the RR-AGENT v2 tests (SPEC-AGENT-V2). Not a test file: the glob tests/*.test.ts skips it.
 * Spawns `node agent/run.ts <command>` with demo data, no network (a preloaded stub records any fetch or socket), temp dirs only.
 *
 * Contract these tests pin beyond the spec text (so the engineer builds to it, or tells QA to change it):
 *  - env: ROLE_RADAR_FACTS, ROLE_RADAR_TRACKER, ROLE_RADAR_JOBS (spec); ROLE_RADAR_RUNS = dir of *-job-hunt.md run logs for metrics
 *    (default docs/runs in the repo); ROLE_RADAR_MAX_ROLES (default 5) and ROLE_RADAR_MAX_STEPS (default 30) override the limits.
 *  - `--demo` anywhere in argv = use demo/seed.json (scan, score only).
 *  - model commands print JSON on stdout; errors are ONE line on stderr, exit non-zero, no stack.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
export const DEMO_FACTS = join(REPO, "demo/agent/facts.json");
export const DEMO_JOBS = join(REPO, "demo/seed.json");
export const ROLE_IDS: string[] = Object.keys(JSON.parse(readFileSync(DEMO_JOBS, "utf8")).jobs);
export const ID = "greenhouse-1001";

export type Sandbox = { dir: string; tracker: string; runs: string; net: string; drafts: string };
export function sandbox(): Sandbox {
  const dir = mkdtempSync(join(tmpdir(), "rr-agv2-"));
  mkdirSync(join(dir, "state"), { recursive: true });
  mkdirSync(join(dir, "runs"), { recursive: true });
  writeFileSync(join(dir, "nonet.mjs"), `import { appendFileSync } from "node:fs"; import net from "node:net";
const note = (w) => appendFileSync(${JSON.stringify(join(dir, "net.log"))}, w + "\\n");
globalThis.fetch = async () => { note("fetch"); throw new Error("network blocked by test"); };
const c = net.Socket.prototype.connect; net.Socket.prototype.connect = function (...a) { note("socket"); return c.apply(this, a); };
`);
  return { dir, tracker: join(dir, "state", "tracker.jsonl"), runs: join(dir, "runs"), net: join(dir, "net.log"), drafts: join(dir, "state", "drafts") };
}

export function run(sb: Sandbox, args: string[], o: { env?: Record<string, string | undefined>; input?: string } = {}) {
  const env: Record<string, string | undefined> = {
    PATH: process.env.PATH ?? "", HOME: sb.dir,
    ROLE_RADAR_FACTS: DEMO_FACTS, ROLE_RADAR_TRACKER: sb.tracker, ROLE_RADAR_JOBS: DEMO_JOBS, ROLE_RADAR_RUNS: sb.runs, ...o.env,
  };
  for (const k of Object.keys(env)) if (env[k] === undefined) delete env[k];
  const r = spawnSync(process.execPath, ["--import", join(sb.dir, "nonet.mjs"), join(REPO, "agent/run.ts"), ...args], {
    env: env as Record<string, string>, encoding: "utf8", cwd: REPO, timeout: 30000, input: o.input ?? "",
  });
  return { code: r.status, out: r.stdout ?? "", err: r.stderr ?? "", net: existsSync(sb.net) };
}

export const oneLine = (s: string) => s.trim().split("\n").filter(Boolean).length === 1;
export const noStack = (s: string) => !/\n\s+at\s|node:internal|TypeError|ReferenceError|SyntaxError|ERR_MODULE_NOT_FOUND|Cannot find module/.test(s);

export const goodDraft = (over: Record<string, unknown> = {}) => ({
  claims: [
    { text: "Led a payments platform team of 8 (demo).", fact_ids: ["demo-f1"] },
    { text: "Shipped a self-serve onboarding flow (demo).", fact_ids: ["demo-f2"] },
  ],
  gaps: ["Kubernetes"],
  text: "Dear hiring team, I led a payments platform team and shipped a self-serve onboarding flow.",
  ...over,
});
export const goodOutreach = (over: Record<string, unknown> = {}) => ({
  claims: [{ text: "Led a payments platform team (demo).", fact_ids: ["demo-f1"] }],
  gaps: [],
  text: "I led a payments platform team and your role looks close to that. Could we talk this week?",
  ...over,
});

export const rows = (p: string): any[] => (existsSync(p) ? readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
export const read = (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : "");

/** Every file under the repo (path, size, mtime) outside node_modules/.git/.claude: proves a command wrote nothing in the repo. */
export function repoSnapshot(): string {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      if (["node_modules", ".git", ".claude"].includes(n)) continue;
      const p = join(d, n); const s = statSync(p);
      if (s.isDirectory()) walk(p); else out.push(`${p}|${s.size}|${s.mtimeMs}`);
    }
  };
  walk(REPO);
  return out.sort().join("\n");
}

export function agentFiles(): string[] {
  const out: string[] = [];
  const walk = (d: string) => { for (const n of readdirSync(d)) { const p = join(d, n); statSync(p).isDirectory() ? walk(p) : out.push(p); } };
  walk(join(REPO, "agent"));
  return out;
}

/** Human-only commands (begin, approve, status) refuse without a terminal. This calls main() with an injected isTTY = true, as a person at a terminal would. */
export function human(sb: Sandbox, args: string[], o: { env?: Record<string, string | undefined> } = {}) {
  const script = join(sb.dir, "human-main.mjs");
  writeFileSync(script, `const m = await import(${JSON.stringify(join(REPO, "agent/run.ts"))});
try { process.exit(await m.main(${JSON.stringify(args)}, { isTTY: true })); }
catch (e) { console.error(e instanceof Error ? e.message.split("\\n")[0] : String(e)); process.exit(1); }
`);
  const env: Record<string, string | undefined> = {
    PATH: process.env.PATH ?? "", HOME: sb.dir,
    ROLE_RADAR_FACTS: DEMO_FACTS, ROLE_RADAR_TRACKER: sb.tracker, ROLE_RADAR_JOBS: DEMO_JOBS, ROLE_RADAR_RUNS: sb.runs, ...o.env,
  };
  for (const k of Object.keys(env)) if (env[k] === undefined) delete env[k];
  const r = spawnSync(process.execPath, ["--import", join(sb.dir, "nonet.mjs"), script], { env: env as Record<string, string>, encoding: "utf8", cwd: REPO, timeout: 30000, input: "" });
  return { code: r.status, out: r.stdout ?? "", err: r.stderr ?? "", net: existsSync(sb.net) };
}
/** A human starts the run (resets the counters, creates run-state.json). */
export const begin = (sb: Sandbox) => { const r = human(sb, ["begin"]); if (r.code !== 0) throw new Error(`begin failed: ${r.err}`); };
