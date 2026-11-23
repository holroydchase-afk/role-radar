/* RR-AGENT privacy review fixes (docs/reviews/2026-11-23-agent-privacy.md). Written BEFORE the fixes (red). Demo data only, no network.
 *
 * PS-R1  demo/ is NOT exempt for write targets: ROLE_RADAR_TRACKER and ROLE_RADAR_AGENT_LOG inside the repo (demo/ included) throw
 *        naming the variable. Read-only inputs may use ONLY the exact shipped files demo/agent/facts.json, demo/agent/cases.json,
 *        demo/seed.json (no sibling files, no ".." tricks). .gitignore ignores *.jsonl and agent/*.local.*.
 * PS-R2  ROLE_RADAR_FACTS and ROLE_RADAR_JOBS are guarded by the same rule (inside the repo, not an exact demo file: refused, var named,
 *        before any network call). `eval` prints which facts file it used (before it calls the model).
 * PS-R3  the track tool lets the model set only found, drafted, dropped. ready, response, interview, rejected and sent are refused
 *        (nothing written). OPEN: the CLI command that humans use to set ready/response/interview is not specified yet, so no test pins it.
 */
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

import { createTracker } from "../agent/tracker.ts";
import { createHarness } from "../agent/harness.ts";
import { createTools } from "../agent/tools.ts";
import { fakeLlm } from "../agent/llm.ts";
import { assertOutsideRepo, PRICES } from "../agent/config.ts";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEMO_FACTS = join(REPO, "demo/agent/facts.json");
const DEMO_CASES = join(REPO, "demo/agent/cases.json");
const DEMO_JOBS = join(REPO, "demo/seed.json");
const criteria: any = yaml.load(readFileSync(join(REPO, "criteria.yaml"), "utf8"));
const ID = "greenhouse-1001";

let dir: string;
const strays: string[] = [];
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "rr-agent-p-")); });
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  // If a guard is missing, the code under test may have written into the repo: never leave it behind.
  for (const p of strays.splice(0)) rmSync(p, { force: true });
});
const stray = (rel: string) => { const p = join(REPO, rel); strays.push(p); return p; };

function cli(args: string[], env: Record<string, string> = {}) {
  const net = join(dir, "nonet.mjs");
  writeFileSync(net, `import { appendFileSync } from "node:fs";
globalThis.fetch = async () => { appendFileSync(${JSON.stringify(join(dir, "net.log"))}, "fetch\\n"); throw new Error("network blocked by test"); };
`);
  const e: Record<string, string> = { PATH: process.env.PATH ?? "", HOME: dir, ANTHROPIC_API_KEY: "sk-ant-TEST-not-real",
    ROLE_RADAR_FACTS: DEMO_FACTS, ROLE_RADAR_TRACKER: join(dir, "tracker.jsonl"),
    ROLE_RADAR_AGENT_LOG: join(dir, "run.jsonl"), ROLE_RADAR_JOBS: DEMO_JOBS, ...env };
  const r = spawnSync(process.execPath, ["--import", net, join(REPO, "agent/run.ts"), ...args], { env: e, encoding: "utf8", cwd: REPO, timeout: 30000 });
  return { code: r.status, out: (r.stdout ?? "") + (r.stderr ?? ""), net: existsSync(join(dir, "net.log")) };
}

// ---------- PS-R1 ----------
test("PS-R1 tracker paths inside the repo are refused, demo/ included", () => {
  for (const rel of ["demo/tracker.jsonl", "demo/agent/tracker.jsonl", "agent/tracker.jsonl", "tracker.jsonl"]) {
    const p = stray(rel);
    assert.throws(() => createTracker(p), /ROLE_RADAR_TRACKER/, rel);
  }
});

test("PS-R1 log paths inside the repo are refused, demo/ included", () => {
  for (const rel of ["demo/run.jsonl", "demo/agent/run.jsonl", "agent/run.jsonl"]) {
    const p = stray(rel);
    assert.throws(() => createHarness({ logPath: p, capUsd: 1, prices: PRICES }), /ROLE_RADAR_AGENT_LOG/, rel);
  }
});

test("PS-R1 the CLI refuses a tracker in demo/ and names the variable (approve writes the tracker)", () => {
  const p = stray("demo/tracker.jsonl");
  const r = cli(["approve", ID], { ROLE_RADAR_TRACKER: p });
  assert.notEqual(r.code, 0);
  assert.match(r.out, /ROLE_RADAR_TRACKER/);
  assert.ok(!existsSync(p), "nothing written into demo/");
});

test("PS-R1 read-only inputs: exactly the three shipped demo files pass, nothing else under demo/ does", () => {
  for (const ok of [DEMO_FACTS, DEMO_CASES, DEMO_JOBS]) assert.doesNotThrow(() => assertOutsideRepo(ok, "ROLE_RADAR_FACTS", { readOnly: true } as any), ok);
  for (const bad of [
    join(REPO, "demo/agent/real-facts.json"), join(REPO, "demo/agent/facts.json.bak"), join(REPO, "demo/facts.json"),
    join(REPO, "demo/agent/../../agent/facts.json"), join(REPO, "demo/agent"), join(REPO, "demo/profile.json"),
  ]) assert.throws(() => assertOutsideRepo(bad, "ROLE_RADAR_FACTS", { readOnly: true } as any), /ROLE_RADAR_FACTS/, bad);
});

test("PS-R1 a path outside the repo is still fine for facts, jobs, tracker and log", () => {
  assert.doesNotThrow(() => createTracker(join(dir, "t.jsonl")));
  assert.doesNotThrow(() => createHarness({ logPath: join(dir, "l.jsonl"), capUsd: 1, prices: PRICES }));
  assert.doesNotThrow(() => assertOutsideRepo(join(dir, "facts.json"), "ROLE_RADAR_FACTS", { readOnly: true } as any));
});

test("PS-R1 .gitignore ignores *.jsonl and agent/*.local.*", () => {
  const lines = readFileSync(join(REPO, ".gitignore"), "utf8").split("\n").map((l) => l.trim());
  assert.ok(lines.includes("*.jsonl"), "*.jsonl missing from .gitignore");
  assert.ok(lines.includes("agent/*.local.*"), "agent/*.local.* missing from .gitignore");
});

// ---------- PS-R2 ----------
test("PS-R2 ROLE_RADAR_FACTS inside the repo is refused before any model call, var named", () => {
  for (const rel of ["agent/facts.json", "facts.json", "demo/agent/my-real-facts.json"]) {
    const r = cli(["scan-and-draft"], { ROLE_RADAR_FACTS: join(REPO, rel) });
    assert.notEqual(r.code, 0, rel);
    assert.match(r.out, /ROLE_RADAR_FACTS/, rel);
    assert.ok(!r.net, `${rel}: no network call before the guard`);
  }
});

test("PS-R2 ROLE_RADAR_JOBS inside the repo is refused before any model call, var named", () => {
  for (const rel of ["agent/jobs.json", "jobs.json", "demo/agent/my-real-jobs.json"]) {
    const r = cli(["scan-and-draft"], { ROLE_RADAR_JOBS: join(REPO, rel) });
    assert.notEqual(r.code, 0, rel);
    assert.match(r.out, /ROLE_RADAR_JOBS/, rel);
    assert.ok(!r.net, `${rel}: no network call before the guard`);
  }
});

test("PS-R2 the exact demo facts and jobs files are accepted (the guard does not name them)", () => {
  const r = cli(["scan-and-draft"]);
  assert.doesNotMatch(r.out, /must point outside the repo|ROLE_RADAR_(FACTS|JOBS) must/);
});

test("PS-R2 createTools guards factsPath and jobsPath too (library level)", () => {
  const harness = createHarness({ logPath: join(dir, "run.jsonl"), capUsd: 1, prices: PRICES });
  const tracker = createTracker(join(dir, "t.jsonl"), { harness });
  const mk = (over: object) => () => createTools({ llm: fakeLlm([]), harness, tracker, criteria, jobsPath: DEMO_JOBS, factsPath: DEMO_FACTS, ...over } as any);
  assert.throws(mk({ factsPath: join(REPO, "agent/facts.json") }), /ROLE_RADAR_FACTS/);
  assert.throws(mk({ jobsPath: join(REPO, "agent/jobs.json") }), /ROLE_RADAR_JOBS/);
  assert.doesNotThrow(mk({}));
});

test("PS-R2 eval prints which facts file it used, before calling the model (env set)", () => {
  const facts = join(dir, "my-facts.json");
  writeFileSync(facts, JSON.stringify({ facts: [] }));
  const r = cli(["eval"], { ROLE_RADAR_FACTS: facts });
  assert.ok(r.out.includes(facts), `eval output should name ${facts}:\n${r.out}`);
});

test("PS-R2 eval says so when it falls back to the demo facts (env unset)", () => {
  const r = cli(["eval"], { ROLE_RADAR_FACTS: "" });
  assert.match(r.out, /demo\/agent\/facts\.json/);
  assert.match(r.out, /demo/i);
});

// ---------- PS-R3 ----------
function trackSetup() {
  const harness = createHarness({ logPath: join(dir, "run.jsonl"), capUsd: 1, prices: PRICES });
  const tracker = createTracker(join(dir, "tracker.jsonl"), { harness });
  const tools: any[] = createTools({ llm: fakeLlm([]), harness, tracker, criteria, jobsPath: DEMO_JOBS, factsPath: DEMO_FACTS } as any) as any;
  return { tracker, track: tools.find((t) => t.name === "track") };
}

test("PS-R3 the track tool's schema offers the model only found, drafted, dropped", () => {
  const { track } = trackSetup();
  assert.deepEqual([...track.schema.properties.status.enum].sort(), ["dropped", "drafted", "found"].sort());
});

test("PS-R3 the model may set found, drafted and dropped", async () => {
  for (const status of ["found", "drafted", "dropped"]) {
    const { tracker, track } = trackSetup();
    await track.run({ roleId: ID, status });
    assert.equal(tracker.get(ID).status, status);
    rmSync(join(dir, "tracker.jsonl"), { force: true });
  }
});

test("PS-R3 ready, response, interview, rejected and sent are refused and write nothing", async () => {
  for (const status of ["ready", "response", "interview", "rejected", "sent"]) {
    const { tracker, track } = trackSetup();
    await assert.rejects(() => track.run({ roleId: ID, status, approved: true }), Error, status);
    assert.equal(tracker.list().length, 0, `${status}: tracker must stay empty`);
    assert.ok(!existsSync(join(dir, "tracker.jsonl")) || readFileSync(join(dir, "tracker.jsonl"), "utf8") === "", `${status}: no row written`);
  }
});

test("PS-R3 a refused status does not change a role already drafted", async () => {
  const { tracker, track } = trackSetup();
  await track.run({ roleId: ID, status: "drafted" });
  await assert.rejects(() => track.run({ roleId: ID, status: "interview" }));
  assert.equal(tracker.get(ID).status, "drafted");
});
