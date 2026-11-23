/* RR-AGENT privacy review v2 (docs/reviews/2026-11-23-agent-privacy.md): PS-R8, PS-R9, PS-R10, PS-R11. Written BEFORE the fixes (red).
 *
 * Contract these tests pin (engineer builds to it, or tells QA to change it):
 *  - agent/run.ts exports `main(argv: string[], io: { isTTY: boolean }): Promise<number>` (isTTY = stdin AND stdout are TTYs;
 *    the CLI entry computes it from process.stdin.isTTY && process.stdout.isTTY). Importing the module must NOT auto-run main
 *    (only when it is the entry file). Errors are thrown from main; the CLI wrapper prints one line.
 *  - NO env var or flag may make a non-TTY pass. Under the real CLI (spawned, so never a TTY) approve, status, begin always refuse.
 *  - Ids must match ^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$ (checked in requireRole, so scan output and every id command are covered).
 *  - A missing or unreadable run-state.json fails model commands closed ("run-state" in the one-line error); only a human `begin` creates it.
 *    NOTE: existing tests that call scan/score/... without `begin` will need updating by the engineer (they rely on fail-open).
 *  - The kill switch is checked by every model command including metrics.
 */
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { REPO, ID, DEMO_FACTS, DEMO_JOBS, sandbox, run, goodDraft, goodOutreach, oneLine, noStack, rows, read, type Sandbox } from "../agent-support.ts";

let sb: Sandbox;
beforeEach(() => { sb = sandbox(); });
afterEach(() => rmSync(sb.dir, { recursive: true, force: true }));

/** Call the exported main() in a child with an injected isTTY (no real TTY needed, no env hook). */
function callMain(argv: string[], isTTY: boolean, o: { env?: Record<string, string>; input?: string } = {}) {
  const script = join(sb.dir, "call-main.mjs");
  writeFileSync(script, `const m = await import(${JSON.stringify(join(REPO, "agent/run.ts"))});
if (typeof m.main !== "function") { console.error("agent/run.ts does not export main(argv, { isTTY })"); process.exit(3); }
try { process.exit(await m.main(${JSON.stringify(argv)}, { isTTY: ${isTTY} })); }
catch (e) { console.error(e instanceof Error ? e.message.split("\\n")[0] : String(e)); process.exit(1); }
`);
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "", HOME: sb.dir,
    ROLE_RADAR_FACTS: DEMO_FACTS, ROLE_RADAR_TRACKER: sb.tracker, ROLE_RADAR_JOBS: DEMO_JOBS, ROLE_RADAR_RUNS: sb.runs, ...o.env,
  };
  const r = spawnSync(process.execPath, ["--import", join(sb.dir, "nonet.mjs"), script], { env, encoding: "utf8", cwd: REPO, timeout: 30000, input: o.input ?? "" });
  return { code: r.status, out: r.stdout ?? "", err: r.stderr ?? "" };
}

/** A human-started run: begin through main with isTTY true. */
const humanBegin = () => { const r = callMain(["begin"], true); assert.equal(r.code, 0, `human begin must work: ${r.err}`); };
/** Seed a drafted role with a draft, as the model would have left it. */
function seedDrafted() {
  humanBegin();
  assert.equal(run(sb, ["tailor-submit", ID], { input: JSON.stringify(goodDraft()) }).code, 0);
}

// ---- PS-R8 ----
test("PS-R8 approve, status and begin refuse through main() when not a TTY, and write nothing", () => {
  seedDrafted();
  const before = read(sb.tracker); const stateBefore = read(join(dirname(sb.tracker), "run-state.json"));
  for (const argv of [["approve", ID], ["status", ID, "response"], ["begin"]]) {
    const r = callMain(argv, false);
    assert.notEqual(r.code, 0, `${argv[0]} must refuse without a TTY (out: ${r.out})`);
    assert.ok(oneLine(r.err), `one line: ${JSON.stringify(r.err)}`);
    assert.match(r.err, /terminal|tty/i, "says why");
  }
  assert.equal(read(sb.tracker), before, "tracker unchanged");
  assert.equal(read(join(dirname(sb.tracker), "run-state.json")), stateBefore, "begin did not reset the counters");
  assert.ok(!rows(sb.tracker).some((r) => r.status === "sent"));
});

test("PS-R8 with a TTY, approve and status still work for the human (the allowed direction)", () => {
  seedDrafted();
  const a = callMain(["approve", ID], true);
  assert.equal(a.code, 0, a.err);
  assert.ok(rows(sb.tracker).some((r) => r.status === "sent" && r.approvedBy === "cli"));
  const s = callMain(["status", ID, "response"], true);
  assert.equal(s.code, 0, s.err);
});

test("PS-R8 the real CLI (never a TTY under test) refuses approve, status and begin, whatever the env says", () => {
  seedDrafted();
  const before = read(sb.tracker);
  const hooks: Record<string, string>[] = [{}, { ROLE_RADAR_TTY: "1" }, { ROLE_RADAR_FORCE_TTY: "1" }, { ROLE_RADAR_HUMAN: "1" }, { FORCE_TTY: "1" }, { CI: "" }, { ROLE_RADAR_ALLOW_NON_TTY: "1" }];
  for (const env of hooks) for (const argv of [["approve", ID], ["status", ID, "response"], ["begin"]]) {
    const r = run(sb, argv, { env });
    assert.notEqual(r.code, 0, `${argv[0]} with ${JSON.stringify(env)} must refuse`);
    assert.ok(oneLine(r.err) && noStack(r.err), r.err);
  }
  assert.equal(read(sb.tracker), before);
});

test("PS-R8 no test-hook env var exists in agent/ that lets a non-TTY pass", () => {
  const src = readdirSync(join(REPO, "agent")).map((f) => read(join(REPO, "agent", f))).join("\n");
  // env() and limitFrom() look names up dynamically, so collect every ROLE_RADAR_* / TTY-ish name written anywhere in the source.
  const names = new Set([...src.matchAll(/\b(ROLE_RADAR_[A-Z0-9_]+|[A-Z0-9_]*TTY[A-Z0-9_]*|[A-Z0-9_]*HUMAN[A-Z0-9_]*)\b/g)].map((m) => m[1]));
  const allowed = new Set(["ROLE_RADAR_FACTS", "ROLE_RADAR_TRACKER", "ROLE_RADAR_JOBS", "ROLE_RADAR_RUNS", "ROLE_RADAR_MAX_ROLES", "ROLE_RADAR_MAX_STEPS"]);
  for (const n of names) assert.ok(allowed.has(n), `unexpected env-style name in agent/: ${n}`);
  assert.match(src, /isTTY/, "the TTY check exists");
  assert.doesNotMatch(src, /isTTY\s*(\|\||\?\?)\s*(process\.env|true)/, "isTTY is not defaulted open");
});

test("PS-R8 the model-facing --help never presents approve, status or begin as commands the model can use", () => {
  const r = run(sb, ["--help"]);
  assert.equal(r.code, 0, r.err);
  for (const c of ["approve", "status", "begin"]) {
    assert.doesNotMatch(r.out, new RegExp(`^\\s+${c}\\b`, "m"), `--help must not list ${c} as a command line`);
  }
});

test("PS-R8 the runbook marks approve, status and begin as human-only from a terminal and says a prompt is not the guard", () => {
  const doc = read(join(REPO, "docs/product/JOB-HUNT-RUN.md"));
  assert.doesNotMatch(doc, /keep them out of its prompt/i, "a prompt is not a control");
  assert.match(doc, /terminal|tty/i, "the human commands need a terminal");
  assert.match(doc, /prompt is not (a|the) (guard|control)|not a guard|not a control/i, "says plainly the prompt is not the guard");
  assert.match(doc, /allowlist/i, "the subagent runs with a tool allowlist");
});

// ---- PS-R9 ----
const EVIL = "../../evil";
function evilJobs(id: string) {
  const seed = JSON.parse(readFileSync(DEMO_JOBS, "utf8"));
  const job = seed.jobs[ID];
  const p = join(sb.dir, "evil-jobs.json");
  writeFileSync(p, JSON.stringify({ ...seed, jobs: { [id]: job } }));
  return p;
}
const allFiles = (d: string): string[] => existsSync(d) ? readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? allFiles(p) : [p]; }) : [];

test("PS-R9 a role id like ../../evil is refused by scan, score, track, tailor-submit and outreach-submit; nothing is written outside drafts/", () => {
  humanBegin();
  const jobs = evilJobs(EVIL);
  const env = { ROLE_RADAR_JOBS: jobs };
  const before = new Set(allFiles(sb.dir));
  const cases: [string[], string?][] = [
    [["scan"]], [["score", EVIL]], [["track", EVIL, "found"]],
    [["tailor-submit", EVIL], JSON.stringify(goodDraft())], [["outreach-submit", EVIL], JSON.stringify(goodOutreach())],
  ];
  for (const [args, input] of cases) {
    const r = run(sb, args, { env, input });
    assert.notEqual(r.code, 0, `${args[0]} must refuse the unsafe id (out: ${r.out.slice(0, 80)})`);
    assert.ok(oneLine(r.err) && noStack(r.err), r.err);
  }
  const added = allFiles(sb.dir).filter((f) => !before.has(f) && !f.endsWith("run-state.json"));
  assert.deepEqual(added, [], "no file written anywhere (certainly none outside drafts/)");
  assert.ok(!existsSync(join(dirname(sb.dir), "evil-resume-1.json")) && !existsSync(join(sb.dir, "evil-resume-1.json")));
});

test("PS-R9 strict pattern: slashes, backslashes, dots, spaces, empty, over 64 chars and a leading dash or underscore are refused; the demo ids and a 64-char id pass", () => {
  humanBegin();
  const bad = ["..", ".", "a/b", "a\\b", "a.b", "a b", "-lead", "_lead", "x".repeat(65), "%2e%2e"];
  for (const id of bad) {
    const r = run(sb, ["score", id], { env: { ROLE_RADAR_JOBS: evilJobs(id) } });
    assert.notEqual(r.code, 0, `refuse ${JSON.stringify(id)}`);
    assert.ok(oneLine(r.err), r.err);
  }
  for (const id of [ID, "A1", "a_b-c", "x".repeat(64)]) {
    const r = run(sb, ["score", id], { env: { ROLE_RADAR_JOBS: evilJobs(id) } });
    assert.equal(r.code, 0, `accept ${id}: ${r.err}`);
  }
});

test("PS-R9 draft file names come from a counter or a safe slug and stay inside drafts/", () => {
  seedDrafted();
  assert.equal(run(sb, ["outreach-submit", ID], { input: JSON.stringify(goodOutreach()) }).code, 0);
  const files = readdirSync(sb.drafts);
  assert.equal(files.length, 2);
  for (const f of files) {
    assert.match(f, /^[A-Za-z0-9][A-Za-z0-9_-]*\.json$/, f);
    assert.equal(f.includes(ID), false, "the file name does not embed the role id");
  }
  assert.deepEqual(rows(sb.tracker).filter((r) => r.type === "draft").every((r) => /^drafts\/[A-Za-z0-9_-]+\.json$/.test(r.draft.ref)), true);
});

// ---- PS-R10 ----
const metric = (out: string, k: string) => Number(new RegExp(`^${k}: (\\d+)`, "m").exec(out)?.[1]);
test("PS-R10 metrics counts sent only for rows with approvedBy cli; forged rows are not counted", () => {
  const ts = "2026-11-23T10:00:00.000Z";
  const role = (id: string) => ({ type: "role", roleId: id, title: "PM", company: "Demo Co", ts });
  const st = (id: string, status: string, extra: Record<string, unknown> = {}) => ({ type: "status", roleId: id, status, ts, ...extra });
  const lines = [role("r-forged"), st("r-forged", "sent"), role("r-model"), st("r-model", "sent", { approvedBy: "model" }), role("r-bool"), st("r-bool", "sent", { approvedBy: true }),
    role("r-real"), st("r-real", "drafted"), st("r-real", "sent", { approvedBy: "cli" })];
  mkdirSync(dirname(sb.tracker), { recursive: true });
  writeFileSync(sb.tracker, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  const r = run(sb, ["metrics"], { env: {} });
  assert.equal(r.code, 0, r.err);
  assert.equal(metric(r.out, "sent"), 1, `only the approved row counts:\n${r.out}`);
  assert.equal(metric(r.out, "roles found"), 4);
});

test("PS-R10 a real approve is still counted (the allowed direction)", () => {
  seedDrafted();
  assert.equal(callMain(["approve", ID], true).code, 0);
  assert.equal(metric(run(sb, ["metrics"]).out, "sent"), 1);
});

// ---- PS-R11 ----
const stateFile = () => join(dirname(sb.tracker), "run-state.json");
const MODEL_CALLS: [string[], string?][] = [
  [["scan"]], [["score", ID]], [["track", ID, "found"]],
  [["tailor-submit", ID], JSON.stringify(goodDraft())], [["outreach-submit", ID], JSON.stringify(goodOutreach())],
];

test("PS-R11 a corrupt run-state.json fails every model command closed with one stderr line and is not reset", () => {
  humanBegin();
  for (const bad of ["{not json", "", "null", "[]", '{"steps":"x","roles":5}']) {
    writeFileSync(stateFile(), bad);
    for (const [args, input] of MODEL_CALLS) {
      const r = run(sb, args, { input });
      assert.notEqual(r.code, 0, `${args[0]} with state ${JSON.stringify(bad)} must fail closed (out: ${r.out.slice(0, 60)})`);
      assert.ok(oneLine(r.err) && noStack(r.err), r.err);
      assert.match(r.err, /run-state/, "names the file");
    }
    assert.equal(read(stateFile()), bad, "the corrupt file is left as is, not reset");
  }
  assert.deepEqual(rows(sb.tracker), [], "nothing written to the tracker");
});

test("PS-R11 a missing run-state.json fails model commands closed (only a human begin creates it) and no state file is created", () => {
  for (const [args, input] of MODEL_CALLS) {
    const r = run(sb, args, { input });
    assert.notEqual(r.code, 0, `${args[0]} with no state file must fail closed`);
    assert.ok(oneLine(r.err) && noStack(r.err), r.err);
    assert.match(r.err, /run-state|begin/);
  }
  assert.equal(existsSync(stateFile()), false, "not silently created");
  humanBegin();
  assert.equal(run(sb, ["scan"]).code, 0, "after a human begin the model can scan");
});

test("PS-R11 the kill switch is checked on every model command, mid-run, not only in begin", () => {
  const off = join(REPO, ".claude", "job-hunt.off");
  assert.equal(existsSync(off), false, "precondition: kill switch file absent");
  seedDrafted();
  const failures: string[] = [];
  try {
    mkdirSync(dirname(off), { recursive: true });
    writeFileSync(off, "");
    for (const [args, input] of [...MODEL_CALLS, [["metrics"]] as [string[]]]) {
      const r = run(sb, args, { input });
      if (r.code === 0) failures.push(`${args[0]} still ran with the kill switch on`);
      else if (!/killed/.test(r.err) || !oneLine(r.err)) failures.push(`${args[0]}: error is not one 'killed' line: ${JSON.stringify(r.err)}`);
    }
  } finally { rmSync(off, { force: true }); }
  assert.deepEqual(failures, []);
  assert.equal(run(sb, ["scan"]).code, 0, "after the switch is removed the model can run again");
});

test("PS-R11 the runbook no longer claims the limits can only get tighter", () => {
  assert.doesNotMatch(read(join(REPO, "docs/product/JOB-HUNT-RUN.md")), /only get tighter|never looser/i);
});
