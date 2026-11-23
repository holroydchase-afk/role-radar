/* RR-AGENT v2 tools (SPEC-AGENT-V2 AGV2-4, 5, 6, 7, 8, 11). Demo data, no network. Written BEFORE the code (red).
 * Driven through `node agent/run.ts <command>` (the only surface the model gets). Contract pins: see tests/agent-support.ts.
 *   scan [--demo]                  JSON { jobs: [{ id, company, title, ... }] } from ROLE_RADAR_JOBS (--demo: demo/seed.json), at most max roles
 *   score <id> [--demo]            JSON { roleId, score, explanation, match } equal to scoreJob/explain/matchJob for the same job + criteria.yaml
 *   tailor-submit <id>             draft JSON on stdin { claims:[{text, fact_ids}], gaps, text }
 *   outreach-submit <id>           same shape; text is the message
 * Replaces v1 tests that drove an Llm (tailor/outreach with fakeLlm): deleted with the Llm.
 */
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join, isAbsolute, dirname } from "node:path";
import yaml from "js-yaml";
import { scoreJob, matchJob, explain } from "../src/scoring.ts";
import { REPO, ID, ROLE_IDS, DEMO_JOBS, sandbox, run, human, begin, goodDraft, goodOutreach, rows, read, oneLine, noStack, type Sandbox } from "./agent-support.ts";

const criteria: any = yaml.load(readFileSync(join(REPO, "criteria.yaml"), "utf8"));
const seed = JSON.parse(readFileSync(DEMO_JOBS, "utf8"));

let sb: Sandbox;
beforeEach(() => { sb = sandbox(); begin(sb); });
afterEach(() => rmSync(sb.dir, { recursive: true, force: true }));

const submit = (cmd: "tailor-submit" | "outreach-submit", draft: unknown, id = ID, env: Record<string, string> = {}) =>
  run(sb, [cmd, id], { input: typeof draft === "string" ? draft : JSON.stringify(draft), env });
const draftFiles = () => (existsSync(sb.drafts) ? readdirSync(sb.drafts) : []);

// ---- AGV2-4 ----
test("AGV2-4 scan --demo prints the demo roles as JSON, makes no network call, and stops at max roles per run", () => {
  const r = run(sb, ["scan", "--demo"], { env: { ROLE_RADAR_JOBS: undefined, ROLE_RADAR_MAX_ROLES: "3" } });
  assert.equal(r.code, 0, r.err);
  const out = JSON.parse(r.out);
  assert.equal(out.jobs.length, 3, "15 demo roles, limit 3");
  assert.ok(out.jobs.every((j: any) => Object.hasOwn(seed.jobs, j.id) && typeof j.title === "string" && typeof j.company === "string"));
  assert.equal(r.net, false);
});

test("AGV2-4 scan reads the jobs export in ROLE_RADAR_JOBS and the default limit is 5 roles", () => {
  const r = run(sb, ["scan"]);
  assert.equal(r.code, 0, r.err);
  assert.equal(JSON.parse(r.out).jobs.length, 5);
});

// ---- AGV2-5 ----
test("AGV2-5 score output equals scoreJob plus explain (and matchJob) for the same job and criteria", () => {
  for (const id of [ID, ROLE_IDS[1]]) {
    const r = run(sb, ["score", id]);
    assert.equal(r.code, 0, r.err);
    const out = JSON.parse(r.out);
    const res = scoreJob(seed.jobs[id], criteria);
    assert.equal(out.roleId, id);
    assert.equal(out.score, res.score);
    assert.deepEqual(out.explanation, JSON.parse(JSON.stringify(explain(res))));
    assert.deepEqual(out.match, JSON.parse(JSON.stringify(matchJob(seed.jobs[id], criteria))));
  }
});

test("AGV2-5 score with an unknown id is a one-line error, non-zero", () => {
  const r = run(sb, ["score", "nope-0"]);
  assert.notEqual(r.code, 0);
  assert.ok(oneLine(r.err) && noStack(r.err), r.err);
});

// ---- AGV2-6 ----
test("AGV2-6 tailor-submit with a claim citing an unknown fact id: non-zero, the reason names the claim index, nothing saved, tracker unchanged", () => {
  assert.equal(run(sb, ["track", ID, "found"]).code, 0, "setup: a tracked role");
  const before = read(sb.tracker);
  const bad = goodDraft({ claims: [goodDraft().claims[0], { text: "Won an invented award.", fact_ids: ["demo-f1", "no-such-fact"] }] });
  const r = submit("tailor-submit", bad);
  assert.notEqual(r.code, 0, "an ungrounded claim must be rejected");
  assert.match(r.err, /claim\D{0,3}1\b|\[1\]|index 1|#1/i, "names claim index 1: " + r.err);
  assert.ok(oneLine(r.err) && noStack(r.err), r.err);
  assert.deepEqual(draftFiles(), []);
  assert.equal(read(sb.tracker), before);
});

test("AGV2-6 a claim with no fact ids, or with a non-string id, is rejected the same way", () => {
  for (const claims of [[{ text: "No source.", fact_ids: [] }], [{ text: "No key." }], [{ text: "Bad id.", fact_ids: [7] }]]) {
    const r = submit("tailor-submit", goodDraft({ claims }));
    assert.notEqual(r.code, 0, JSON.stringify(claims));
    assert.match(r.err, /claim\D{0,3}0\b|\[0\]|index 0|#0/i, r.err);
  }
  assert.deepEqual(draftFiles(), []);
  assert.equal(read(sb.tracker), "");
});

// ---- AGV2-7 ----
test("AGV2-7 a valid tailor draft is saved under dirname(tracker)/drafts/ and the tracker records drafted with the draft ref", () => {
  const d = goodDraft();
  const r = submit("tailor-submit", d);
  assert.equal(r.code, 0, r.err);
  const files = draftFiles();
  assert.equal(files.length, 1, "one draft file in " + sb.drafts);
  assert.match(read(join(sb.drafts, files[0])), /payments platform team/);
  const t = rows(sb.tracker);
  const status = t.filter((x) => x.type === "status").at(-1);
  assert.equal(status?.status, "drafted");
  const draftRow = t.find((x) => x.type === "draft");
  assert.ok(draftRow, "a draft row with the ref");
  const ref: string = draftRow.draft.ref;
  assert.ok(existsSync(isAbsolute(ref) ? ref : join(dirname(sb.tracker), ref)), `ref ${ref} points at the saved file`);
  assert.ok(t.every((x) => x.approvedBy === undefined), "no approval marker from a submit");
  assert.equal(run(sb, ["metrics"]).net, false);
});

test("AGV2-7 the gaps list is kept in the saved draft", () => {
  assert.equal(submit("tailor-submit", goodDraft({ gaps: ["Kubernetes", "Rust"] })).code, 0);
  assert.match(read(join(sb.drafts, draftFiles()[0])), /Kubernetes[\s\S]*Rust|Rust[\s\S]*Kubernetes/);
});

test("AGV2-7 tailor-submit refuses an unknown role id, missing stdin and bad JSON in one line each, saving nothing", () => {
  for (const [id, input] of [["nope-0", JSON.stringify(goodDraft())], [ID, ""], [ID, "{not json"], [ID, "[]"], [ID, JSON.stringify({ text: "x" })]] as const) {
    const r = submit("tailor-submit", input, id);
    assert.notEqual(r.code, 0, `${id} ${input}`);
    assert.ok(oneLine(r.err) && noStack(r.err), r.err);
  }
  assert.deepEqual(draftFiles(), []);
  assert.equal(read(sb.tracker), "");
});

// ---- AGV2-8 ----
test("AGV2-8 a valid outreach (1 to 3 sentences, grounded, no foreign link or email) is accepted and saved", () => {
  const r = submit("outreach-submit", goodOutreach());
  assert.equal(r.code, 0, r.err);
  assert.equal(draftFiles().length, 1);
});

test("AGV2-8 outreach that is empty, over 3 sentences, ungrounded, or has a link or email not in facts is rejected and saves nothing", () => {
  const cases: [string, unknown][] = [
    ["empty", goodOutreach({ text: "   " })],
    ["four sentences", goodOutreach({ text: "One. Two. Three. Four." })],
    ["ungrounded claim", goodOutreach({ claims: [{ text: "Invented.", fact_ids: ["ghost"] }] })],
    ["no claims", goodOutreach({ claims: [] })],
    ["foreign link", goodOutreach({ text: "See https://demo.example/me for my work." })],
    ["foreign www link", goodOutreach({ text: "See www.demo.example/me for my work." })],
    ["foreign email", goodOutreach({ text: "Write to someone@demo.example today." })],
  ];
  for (const [name, draft] of cases) {
    const r = submit("outreach-submit", draft);
    assert.notEqual(r.code, 0, name);
    assert.ok(oneLine(r.err) && noStack(r.err), `${name}: ${r.err}`);
  }
  assert.deepEqual(draftFiles(), []);
  assert.equal(read(sb.tracker), "");
});

test("AGV2-8 exactly three sentences is allowed", () => {
  assert.equal(submit("outreach-submit", goodOutreach({ text: "One short note. It cites my work. Can we talk?" })).code, 0);
});

// ---- AGV2-11 (the tools part; the same counters are pinned in agent-cli) ----
test("AGV2-11 more commands than max steps: the next command is refused with 'limit', non-zero, and writes nothing", () => {
  const env = { ROLE_RADAR_MAX_STEPS: "3" };
  for (let i = 0; i < 3; i++) assert.equal(run(sb, ["score", ID], { env }).code, 0, `step ${i + 1}`);
  const r = run(sb, ["score", ID], { env });
  assert.notEqual(r.code, 0);
  assert.match(r.err, /limit/i);
  assert.ok(oneLine(r.err) && noStack(r.err), r.err);
});

test("AGV2-11 a fourth distinct role past max roles (3) is refused with 'limit'; a repeat of a counted role still works", () => {
  const env = { ROLE_RADAR_MAX_ROLES: "3" };
  for (const id of ROLE_IDS.slice(0, 3)) assert.equal(run(sb, ["score", id], { env }).code, 0, id);
  assert.equal(run(sb, ["score", ROLE_IDS[0]], { env }).code, 0, "same role again is not a new role");
  const r = run(sb, ["score", ROLE_IDS[3]], { env });
  assert.notEqual(r.code, 0);
  assert.match(r.err, /limit/i);
  const t = run(sb, ["track", ROLE_IDS[3], "found"], { env });
  assert.notEqual(t.code, 0, "no other command can add the fourth role");
  assert.ok(!rows(sb.tracker).some((x) => x.roleId === ROLE_IDS[3]));
});

test("AGV2-11 default limits are 5 roles and 30 steps, counted by run.ts", () => {
  for (const id of ROLE_IDS.slice(0, 5)) assert.equal(run(sb, ["score", id]).code, 0, id);
  const sixth = run(sb, ["score", ROLE_IDS[5]]);
  assert.notEqual(sixth.code, 0, "sixth distinct role");
  assert.match(sixth.err, /limit/i);
  // fresh sandbox: 30 steps on one role pass, the 31st is refused
  rmSync(sb.dir, { recursive: true, force: true });
  sb = sandbox(); begin(sb);
  for (let i = 0; i < 30; i++) assert.equal(run(sb, ["score", ID]).code, 0, `step ${i + 1}`);
  const over = run(sb, ["score", ID]);
  assert.notEqual(over.code, 0);
  assert.match(over.err, /limit/i);
});

test("AGV2-11 the counters live in a state file beside the tracker, never in the repo", () => {
  run(sb, ["score", ID]);
  const beside = readdirSync(dirname(sb.tracker)).filter((n) => n !== "tracker.jsonl" && n !== "drafts");
  assert.ok(beside.length >= 1, "a state file next to the tracker, found: " + readdirSync(dirname(sb.tracker)).join(","));
});
