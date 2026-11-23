/* RR-AGENT v2 CLI (AGV2-3, AGV2-12; AG-28 check:private kept). Demo data, no network. Written BEFORE the code (red).
 *   node agent/run.ts <scan | score | tailor-submit | outreach-submit | track | status | approve | metrics> [--demo] [--help]
 * Deleted from v1 (why): scan-and-draft and eval (the Llm loop and the eval runner are gone), the ANTHROPIC_API_KEY cases (no key exists),
 * the "approval flag" source scan keyed on `approved: true` (the marker is now approvedBy: "cli", pinned in agent-tracker and below),
 * and the README/DECISIONS/HANDOFF text checks tied to the key and PR 3 (docs, AGV2-20, slice 2).
 */
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { REPO, ID, DEMO_FACTS, sandbox, run, human, begin, goodDraft, goodOutreach, oneLine, noStack, repoSnapshot, agentFiles, type Sandbox } from "./agent-support.ts";

let sb: Sandbox;
beforeEach(() => { sb = sandbox(); begin(sb); });
afterEach(() => rmSync(sb.dir, { recursive: true, force: true }));

const MODEL_COMMANDS = ["scan", "score", "tailor-submit", "outreach-submit", "track", "metrics"];

// ---- AGV2-12 ----
test("AGV2-12 --help exits 0 and lists every command the model may use, with no network", () => {
  const r = run(sb, ["--help"]);
  assert.equal(r.code, 0, r.err);
  for (const c of MODEL_COMMANDS) assert.match(r.out, new RegExp(`\\b${c}\\b`), `help lists ${c}`);
  assert.doesNotMatch(r.out, /scan-and-draft|\beval\b|ANTHROPIC_API_KEY/);
  assert.equal(r.net, false);
});

test("AGV2-12 an unknown command or none is a one-line error, non-zero, no stack", () => {
  for (const args of [["frobnicate"], [], ["scan-and-draft"], ["eval"]]) {
    const r = run(sb, args);
    assert.notEqual(r.code, 0, args.join(" ") || "(none)");
    assert.ok(oneLine(r.err), `one line: ${JSON.stringify(r.err)}`);
    assert.ok(noStack(r.err), r.err);
  }
});

test("AGV2-12 bad input on every command is a one-line error, non-zero, never a stack trace", () => {
  const bad: [string[], string?][] = [
    [["score"]], [["score", "nope-0"]], [["tailor-submit"], "{}"], [["tailor-submit", ID], "not json"], [["tailor-submit", ID], ""],
    [["outreach-submit", ID], "[1,2"], [["outreach-submit", "nope-0"], JSON.stringify(goodOutreach())], [["track"]], [["track", ID, "bogus"]],
    [["status"]], [["status", ID]], [["status", ID, "bogus"]], [["approve"]], [["approve", "nope-0"]],
  ];
  for (const [args, input] of bad) {
    const r = run(sb, args, { input });
    assert.notEqual(r.code, 0, args.join(" "));
    assert.ok(oneLine(r.err) && noStack(r.err), `${args.join(" ")}: ${JSON.stringify(r.err)}`);
  }
});

test("AGV2-12 status <id> <ready|response|interview|rejected> works; sent and unknown statuses are refused (CLI-only path)", () => {
  assert.equal(run(sb, ["track", ID, "found"]).code, 0, "setup");
  assert.equal(human(sb, ["status", ID, "interview"]).code, 0);
  assert.match(readFileSync(sb.tracker, "utf8"), /"status":"interview"/);
  for (const s of ["sent", "bogus"]) {
    const r = human(sb, ["status", ID, s]);
    assert.notEqual(r.code, 0, s);
    assert.ok(oneLine(r.err) && noStack(r.err), r.err);
  }
  assert.doesNotMatch(readFileSync(sb.tracker, "utf8"), /"status":"sent"/);
});

test("AGV2-12 only run.ts passes approvedBy: 'cli'; no other agent module sets or forwards it from input", () => {
  for (const f of agentFiles().filter((p) => p.endsWith(".ts"))) {
    const name = f.slice(REPO.length + 1);
    if (name === "agent/run.ts" || name === "agent/tracker.ts") continue;
    assert.ok(!/approvedBy/.test(readFileSync(f, "utf8")), `${name} mentions approvedBy`);
  }
  assert.match(readFileSync(join(REPO, "agent/run.ts"), "utf8"), /approvedBy\s*:\s*["']cli["']/, "approve sets the marker in run.ts");
});

test("AG-28 npm run check:private is clean over the tree", () => {
  const r = spawnSync(process.execPath, [join(REPO, "scripts/check-private.mjs")], { cwd: REPO, encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

// ---- AGV2-3 ----
const NEEDS: Record<string, { args: () => string[]; input?: string; vars: string[] }> = {
  scan: { args: () => ["scan"], vars: ["ROLE_RADAR_JOBS"] },
  score: { args: () => ["score", ID], vars: ["ROLE_RADAR_JOBS"] },
  "tailor-submit": { args: () => ["tailor-submit", ID], input: JSON.stringify(goodDraft()), vars: ["ROLE_RADAR_FACTS", "ROLE_RADAR_TRACKER", "ROLE_RADAR_JOBS"] },
  "outreach-submit": { args: () => ["outreach-submit", ID], input: JSON.stringify(goodOutreach()), vars: ["ROLE_RADAR_FACTS", "ROLE_RADAR_TRACKER", "ROLE_RADAR_JOBS"] },
  track: { args: () => ["track", ID, "found"], vars: ["ROLE_RADAR_TRACKER", "ROLE_RADAR_JOBS"] },
  status: { args: () => ["status", ID, "ready"], vars: ["ROLE_RADAR_TRACKER"] },
  approve: { args: () => ["approve", ID], vars: ["ROLE_RADAR_TRACKER"] },
  metrics: { args: () => ["metrics"], vars: ["ROLE_RADAR_TRACKER"] },
};

test("AGV2-3 a needed variable unset: non-zero, the variable is named, nothing is written in the repo or the sandbox", () => {
  const snap = repoSnapshot();
  for (const [cmd, n] of Object.entries(NEEDS)) {
    for (const v of n.vars) {
      const r = (cmd === "status" || cmd === "approve" ? human : run)(sb, n.args(), { input: n.input, env: { [v]: undefined } });
      assert.notEqual(r.code, 0, `${cmd} without ${v}`);
      assert.match(r.err, new RegExp(v), `${cmd} without ${v} must name it: ${r.err}`);
      assert.ok(oneLine(r.err) && noStack(r.err), r.err);
    }
  }
  assert.equal(repoSnapshot(), snap, "nothing written in the repo");
  assert.equal(existsSync(sb.tracker), false);
});

test("AGV2-3 a variable pointing inside the repo is refused naming it, and nothing is written in the repo", () => {
  const snap = repoSnapshot();
  const inside: Record<string, string> = {
    ROLE_RADAR_TRACKER: join(REPO, "demo", "tracker.jsonl"), ROLE_RADAR_FACTS: join(REPO, "README.md"), ROLE_RADAR_JOBS: join(REPO, "package.json"),
  };
  for (const [cmd, n] of Object.entries(NEEDS)) {
    for (const v of n.vars) {
      const r = (cmd === "status" || cmd === "approve" ? human : run)(sb, n.args(), { input: n.input, env: { [v]: inside[v] } });
      assert.notEqual(r.code, 0, `${cmd} with ${v} in the repo`);
      assert.match(r.err, new RegExp(v), `${cmd}: ${r.err}`);
    }
  }
  assert.equal(repoSnapshot(), snap);
});

test("AGV2-3 a symlink that leads into the repo is refused for the tracker, facts and jobs, naming the variable", () => {
  const snap = repoSnapshot();
  symlinkSync(join(REPO, "demo"), join(sb.dir, "linkdir"));
  writeFileSync(join(sb.dir, "x"), "");
  symlinkSync(join(REPO, "package.json"), join(sb.dir, "linkfile.json"));
  const cases: [string, string[], string | undefined, Record<string, string>][] = [
    ["ROLE_RADAR_TRACKER", ["track", ID, "found"], undefined, { ROLE_RADAR_TRACKER: join(sb.dir, "linkdir", "t.jsonl") }],
    ["ROLE_RADAR_FACTS", ["tailor-submit", ID], JSON.stringify(goodDraft()), { ROLE_RADAR_FACTS: join(sb.dir, "linkfile.json") }],
    ["ROLE_RADAR_JOBS", ["score", ID], undefined, { ROLE_RADAR_JOBS: join(sb.dir, "linkfile.json") }],
  ];
  for (const [v, args, input, env] of cases) {
    const r = run(sb, args, { input, env });
    assert.notEqual(r.code, 0, v);
    assert.match(r.err, new RegExp(v), r.err);
    assert.ok(oneLine(r.err) && noStack(r.err), `one-line reason, not the usage text: ${r.err}`);
  }
  assert.equal(repoSnapshot(), snap);
});

test("AGV2-3 scan and score fall back to demo data only with --demo", () => {
  for (const cmd of [["scan"], ["score", ID]]) {
    const r = run(sb, cmd, { env: { ROLE_RADAR_JOBS: undefined } });
    assert.notEqual(r.code, 0, cmd.join(" "));
    assert.match(r.err, /ROLE_RADAR_JOBS/);
    const d = run(sb, [...cmd, "--demo"], { env: { ROLE_RADAR_JOBS: undefined } });
    assert.equal(d.code, 0, `${cmd.join(" ")} --demo: ${d.err}`);
    assert.ok(JSON.parse(d.out));
  }
});

test("AGV2-3 --demo does not rescue the commands that write (tailor-submit still needs the facts variable)", () => {
  const r = run(sb, ["tailor-submit", ID, "--demo"], { input: JSON.stringify(goodDraft()), env: { ROLE_RADAR_FACTS: undefined } });
  assert.notEqual(r.code, 0);
  assert.match(r.err, /ROLE_RADAR_FACTS/);
  assert.ok(oneLine(r.err), r.err);
});

test("AGV2-3 the shipped demo facts and jobs files are accepted as read-only inputs", () => {
  assert.ok(existsSync(DEMO_FACTS));
  const r = run(sb, ["tailor-submit", ID], { input: JSON.stringify(goodDraft()) });
  assert.equal(r.code, 0, r.err);
});
