/* RR-AGENT PR 3: evals (AG-20, 21, 22, 23, 24). Demo data, fakeLlm only, no network. Written BEFORE the code (red).
 *
 * demo/agent/cases.json: { _label: "DEMO DATA: ...", cases: [{ id, company, title, location, description,
 *   label: "good" | "bad", reason, factIds: [demo fact ids] }] }. >= 8 cases, 4 good + 4 bad, all made up.
 *
 * agent/evals.ts exports:
 *   EVAL_DEFAULT_CAP_USD = 5
 *   runEval({ cases, agentLlm, plainLlm, graderLlm, harness, repeats, seed }) -> Promise<{
 *     stopped?: "cap_hit" | "killed",          // set when the cap or kill ends the eval early; never throws for these
 *     models: { agent, plain, grader },        // SONNET_MODEL, SONNET_MODEL, OPUS_MODEL
 *     rows: [{ caseId, repeat, key: { A: "agent"|"plain", B: "agent"|"plain" },
 *              grades: { agent: G, plain: G } | null, outcome: "win"|"tie"|"loss"|"failed_grade" }],
 *     report: { wins, ties, losses, failedGrades, winRate,           // winRate = wins / graded rows
 *               mean: { agent: G, plain: G },                         // G = { fit, groundedness, usefulness } 0-5
 *               labelAccuracy: { agent, plain },                      // share of graded rows with fit >= 3
 *               arms: { agent: {tokens, usd}, plain: {...}, grader: {...} } }  // summed from the run LOG rows by `arm`
 *   }>
 *  - Per case and repeat: the agent arm is runAgent on agentLlm (Sonnet; its finalText is the output); the plain arm is
 *    ONE plainLlm.call (Sonnet) whose prompt holds the demo facts and the criteria. Both go through the harness, and the
 *    llm_call log rows carry arm: "agent" | "plain" | "grader" and the model.
 *  - The grader (Opus) gets ONE call: both outputs as "A" then "B" (A first in the prompt), randomized by a seeded shuffle.
 *    The grader prompt never says which is the agent. It replies JSON { A: G, B: G }. Total = fit + groundedness + usefulness.
 *    The key lives only in the result, never in the log. Malformed JSON: retried once; still bad -> event
 *    failed_grade logged, row outcome "failed_grade", counted in report.failedGrades, not dropped.
 */
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { runEval, EVAL_DEFAULT_CAP_USD } from "../agent/evals.ts";
import { createHarness } from "../agent/harness.ts";
import { PRICES, SONNET_MODEL, OPUS_MODEL } from "../agent/config.ts";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const cases: any = JSON.parse(readFileSync(join(REPO, "demo/agent/cases.json"), "utf8"));
const facts: any = JSON.parse(readFileSync(join(REPO, "demo/agent/facts.json"), "utf8"));

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "rr-agent-e-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });
const logPath = () => join(dir, "run.jsonl");
const lines = () => (existsSync(logPath()) ? readFileSync(logPath(), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);

// ---------- AG-20 cases ----------
const REAL_COMPANIES = ["google", "amazon", "microsoft", "apple", "meta", "netflix", "stripe", "tesla", "salesforce", "uber", "airbnb", "openai", "anthropic", "oracle", "linkedin", "sunrun", "enphase", "nextera", "plaid", "square", "shopify"];

test("AG-20 cases.json: >= 8 made-up roles, 4 good and 4 bad, each labeled with a reason, built on demo facts", () => {
  assert.match(cases._label ?? "", /^DEMO DATA/);
  assert.ok(Array.isArray(cases.cases));
  assert.ok(cases.cases.length >= 8);
  const ids = new Set(cases.cases.map((c: any) => c.id));
  assert.equal(ids.size, cases.cases.length, "unique ids");
  assert.equal(cases.cases.filter((c: any) => c.label === "good").length, 4);
  assert.equal(cases.cases.filter((c: any) => c.label === "bad").length, 4);
  const factIds = new Set(facts.facts.map((f: any) => f.id));
  for (const c of cases.cases) {
    for (const k of ["id", "company", "title", "description", "reason"]) assert.ok(typeof c[k] === "string" && c[k].length > 3, `${c.id} ${k}`);
    assert.ok(["good", "bad"].includes(c.label), c.id);
    assert.ok(Array.isArray(c.factIds), `${c.id} factIds`);
    for (const f of c.factIds) assert.ok(factIds.has(f), `${c.id} cites unknown fact ${f}`);
    if (c.label === "good") assert.ok(c.factIds.length >= 1, `${c.id} good fit should rest on a fact`);
  }
});

test("AG-20 cases.json: no real company names and no email addresses or phone numbers", () => {
  const raw = readFileSync(join(REPO, "demo/agent/cases.json"), "utf8");
  assert.ok(!/@/.test(raw), "no @ addresses");
  assert.ok(!/\d{3}[ .-]\d{3}[ .-]\d{4}/.test(raw), "no phone numbers");
  for (const c of cases.cases) for (const name of REAL_COMPANIES) {
    assert.ok(!new RegExp(`\\b${name}\\b`, "i").test(c.company + " " + c.title), `${c.id} names a real company: ${name}`);
  }
});

// ---------- fakes ----------
const usage = { input: 100, output: 20 };
// Arms: the agent arm ends at once with AGENT-OUT, the plain arm answers PLAIN-OUT.
function arms() {
  const agentLlm: any = { calls: [] as any[], async call(req: any) { this.calls.push(req); return { text: "AGENT-OUT for the role", toolCalls: [], usage, model: req.model }; } };
  const plainLlm: any = { calls: [] as any[], async call(req: any) { this.calls.push(req); return { text: "PLAIN-OUT for the role", toolCalls: [], usage, model: req.model }; } };
  return { agentLlm, plainLlm };
}
const G = (n: number) => ({ fit: n, groundedness: n, usefulness: n });
// Grader that favors one arm by finding which output comes first (A) in the prompt.
function grader(prefer: "agent" | "plain" | "tie" | string[]) {
  const g: any = { calls: [] as any[], async call(req: any) {
    this.calls.push(req);
    if (Array.isArray(prefer)) return { text: prefer.shift() ?? "{}", toolCalls: [], usage: { input: 500, output: 50 }, model: req.model };
    const p = JSON.stringify([req.system, req.messages]);
    const agentIsA = p.indexOf("AGENT-OUT") < p.indexOf("PLAIN-OUT");
    const [a, b] = prefer === "tie" ? [3, 3] : prefer === "agent" ? (agentIsA ? [5, 1] : [1, 5]) : (agentIsA ? [1, 5] : [5, 1]);
    return { text: JSON.stringify({ A: G(a), B: G(b) }), toolCalls: [], usage: { input: 500, output: 50 }, model: req.model };
  } };
  return g;
}
const harness = (capUsd = 5) => createHarness({ logPath: logPath(), capUsd, prices: PRICES });
const three = cases.cases.slice(0, 3);

async function run(prefer: any, o: any = {}) {
  const a = arms();
  const g = grader(prefer);
  const res: any = await runEval({ cases: o.cases ?? three, agentLlm: a.agentLlm, plainLlm: a.plainLlm, graderLlm: g, harness: o.harness ?? harness(), repeats: o.repeats ?? 2, seed: o.seed ?? 7 });
  return { res, ...a, g };
}

// ---------- AG-21 ----------
test("AG-21 every case and repeat runs the agent arm and ONE plain prompt with the same facts and criteria; one grader call each", async () => {
  const { res, agentLlm, plainLlm, g } = await run("agent");
  assert.equal(res.rows.length, 6);
  assert.equal(plainLlm.calls.length, 6, "one plain call per case-repeat");
  assert.ok(agentLlm.calls.length >= 6);
  assert.equal(g.calls.length, 6);
  const plainPrompt = JSON.stringify(plainLlm.calls[0]);
  for (const f of facts.facts) assert.ok(plainPrompt.includes(f.text.slice(0, 30)), `plain prompt has ${f.id}`);
  assert.match(plainPrompt, /Senior Product Manager/, "criteria are in the plain prompt");
  assert.match(plainPrompt, new RegExp(three[0].title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("AG-21 the grader prompt shows both outputs as A and B with no hint of which is the agent", async () => {
  const { g } = await run("agent");
  for (const req of g.calls) {
    const p = JSON.stringify([req.system, req.messages]);
    assert.ok(p.includes("AGENT-OUT") && p.includes("PLAIN-OUT"), "both outputs are shown");
    const withoutOutputs = p.replaceAll("AGENT-OUT", "").replaceAll("PLAIN-OUT", "");
    assert.ok(!/\bagent\b|plain|single[- ]prompt|tool loop|tool use|\barm\b/i.test(withoutOutputs), "no label hint: " + withoutOutputs.slice(0, 200));
    assert.match(p, /\bA\b/);
    assert.match(p, /\bB\b/);
  }
});

test("AG-21 A/B assignment is a seeded shuffle: same seed repeats, both orders occur, another seed differs; key only in the result, never the log", async () => {
  const many = cases.cases;
  const r1 = (await run("tie", { cases: many, repeats: 3, seed: 42, harness: harness() })).res;
  const keys = (r: any) => r.rows.map((x: any) => x.key.A);
  assert.equal(r1.rows.length, many.length * 3);
  assert.ok(new Set(keys(r1)).size === 2, "both agent-as-A and plain-as-A happen");
  for (const row of r1.rows) assert.deepEqual([row.key.A, row.key.B].sort(), ["agent", "plain"]);
  const r2 = (await run("tie", { cases: many, repeats: 3, seed: 42, harness: harness() })).res;
  assert.deepEqual(keys(r2), keys(r1), "same seed, same assignment");
  const r3 = (await run("tie", { cases: many, repeats: 3, seed: 43, harness: harness() })).res;
  assert.notDeepEqual(keys(r3), keys(r1), "different seed, different assignment");
  const raw = existsSync(logPath()) ? readFileSync(logPath(), "utf8") : "";
  assert.ok(!/"(A|B|key)"\s*:\s*"?(agent|plain)/.test(raw), "assignment key is not in the log");
});

// ---------- AG-22 ----------
test("AG-22 agents run on Sonnet and the grader on Opus, asserted in the call args and the log", async () => {
  const { res, agentLlm, plainLlm, g } = await run("agent");
  assert.deepEqual(res.models, { agent: SONNET_MODEL, plain: SONNET_MODEL, grader: OPUS_MODEL });
  assert.ok(agentLlm.calls.every((r: any) => r.model === SONNET_MODEL));
  assert.ok(plainLlm.calls.every((r: any) => r.model === SONNET_MODEL));
  assert.ok(g.calls.every((r: any) => r.model === OPUS_MODEL));
  const calls = lines().filter((r) => r.event === "llm_call");
  assert.ok(calls.length > 0);
  for (const r of calls) assert.equal(r.model, r.arm === "grader" ? OPUS_MODEL : SONNET_MODEL, `arm ${r.arm}`);
  assert.deepEqual([...new Set(calls.map((r) => r.arm))].sort(), ["agent", "grader", "plain"]);
});

// ---------- AG-23 ----------
test("AG-23 grader JSON is read as fit, groundedness, usefulness 0-5 per output and mapped back through the key", async () => {
  const { res } = await run("agent");
  for (const row of res.rows) {
    assert.deepEqual(row.grades.agent, G(5));
    assert.deepEqual(row.grades.plain, G(1));
  }
});

test("AG-23 malformed grader JSON is retried once and then graded", async () => {
  const good = JSON.stringify({ A: G(4), B: G(2) });
  const { res, g } = await run(["not json at all", good], { cases: three.slice(0, 1), repeats: 1 });
  assert.equal(g.calls.length, 2, "one retry");
  assert.equal(res.report.failedGrades, 0);
  assert.notEqual(res.rows[0].outcome, "failed_grade");
  assert.equal(res.rows[0].grades.agent.fit + res.rows[0].grades.plain.fit, 6);
});

test("AG-23 two malformed replies become a logged failed grade, kept in the rows, not dropped", async () => {
  const { res, g } = await run(["nope", "{still not json"], { cases: three.slice(0, 1), repeats: 1 });
  assert.equal(g.calls.length, 2, "retried once, no more");
  assert.equal(res.rows.length, 1);
  assert.equal(res.rows[0].outcome, "failed_grade");
  assert.equal(res.rows[0].grades, null);
  assert.equal(res.report.failedGrades, 1);
  assert.ok(lines().some((r) => r.event === "failed_grade"));
});

test("AG-23 scores outside 0-5 or missing fields are treated as malformed", async () => {
  const bad = JSON.stringify({ A: { fit: 9, groundedness: 1, usefulness: 1 }, B: G(1) });
  const { res } = await run([bad, bad], { cases: three.slice(0, 1), repeats: 1 });
  assert.equal(res.rows[0].outcome, "failed_grade");
});

// ---------- AG-24 ----------
test("AG-24 report: win, tie and loss for the agent, win rate and mean scores", async () => {
  let r = (await run("agent")).res.report;
  assert.deepEqual([r.wins, r.ties, r.losses, r.winRate], [6, 0, 0, 1]);
  assert.deepEqual(r.mean.agent, G(5));
  assert.deepEqual(r.mean.plain, G(1));
  r = (await run("plain", { harness: harness() })).res.report;
  assert.deepEqual([r.wins, r.ties, r.losses, r.winRate], [0, 0, 6, 0]);
  r = (await run("tie", { harness: harness() })).res.report;
  assert.deepEqual([r.wins, r.ties, r.losses], [0, 6, 0]);
});

test("AG-24 tokens and usd per arm equal the sums of the log rows, and labelAccuracy counts fit >= 3", async () => {
  const { res } = await run("agent");
  const calls = lines().filter((r) => r.event === "llm_call");
  for (const arm of ["agent", "plain", "grader"]) {
    const mine = calls.filter((r) => r.arm === arm);
    assert.ok(mine.length > 0, arm);
    assert.equal(res.report.arms[arm].tokens, mine.reduce((s, r) => s + r.input_tokens + r.output_tokens, 0), `${arm} tokens`);
    assert.ok(Math.abs(res.report.arms[arm].usd - mine.reduce((s, r) => s + r.usd, 0)) < 1e-12, `${arm} usd`);
  }
  assert.ok(res.report.arms.grader.usd > res.report.arms.plain.usd, "Opus costs more per token");
  assert.deepEqual(res.report.labelAccuracy, { agent: 1, plain: 0 });
});

// ---------- cap and kill ----------
test("eval cost cap defaults to $5 and a tiny cap ends the eval with cap_hit, no further calls", async () => {
  assert.equal(EVAL_DEFAULT_CAP_USD, 5);
  const a = arms();
  a.agentLlm.call = async function (req: any) { this.calls.push(req); return { text: "AGENT-OUT", toolCalls: [], usage: { input: 1_000_000, output: 0 }, model: req.model }; };
  const g = grader("agent");
  const res: any = await runEval({ cases: three, agentLlm: a.agentLlm, plainLlm: a.plainLlm, graderLlm: g, harness: harness(0.01), repeats: 3, seed: 1 });
  assert.equal(res.stopped, "cap_hit");
  assert.equal(a.agentLlm.calls.length, 1);
  assert.equal(g.calls.length, 0);
  assert.ok(lines().some((r) => r.event === "cap_hit"));
});

test("eval honours the KILL switch: no llm call is made", async () => {
  process.env.ROLE_RADAR_AGENT_KILL = "1";
  try {
    const { res, agentLlm, plainLlm, g } = await run("agent");
    assert.equal(res.stopped, "killed");
    assert.equal(agentLlm.calls.length + plainLlm.calls.length + g.calls.length, 0);
  } finally { delete process.env.ROLE_RADAR_AGENT_KILL; }
});
