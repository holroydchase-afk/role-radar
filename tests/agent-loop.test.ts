/* RR-AGENT PR 2: tool loop contract (AG-12, 13, 14, plus AG-3/AG-4 inside the loop and drafts-only). Demo data, no network.
 *
 * Module agent/loop.ts exports runAgent({ llm, harness, tools, goal, maxSteps? }) -> Promise<result>
 *   - One step = one llm.call (model SONNET_MODEL, tools passed as {name, description, input_schema}); default maxSteps 12.
 *   - Before EVERY llm call and every tool run: harness.checkKill(). After every llm call: harness.record(usage, model).
 *   - Tool calls from a response run in order; results go back as one user message of
 *       { type: "tool_result", tool_use_id, content: <string, JSON of the result or the error message>, is_error? }.
 *   - A tool that throws, an unknown tool name or bad input become an is_error result; the loop continues. Never throws on these.
 *   - Each tool run logs { event: "tool_call", tool, ok }.
 *   - A response with no tool calls ends the run. Result: { stopReason, exitCode, finalText, steps }:
 *       "final" (exitCode 0, finalText = response text), "max_turns" (logged event max_turns),
 *       "killed" (KilledError; logged killed by the harness), "cap_hit" (CapExceeded; logged cap_hit). The last two
 *       return a non-zero exitCode and make no further llm or tool call.
 * Tool llm calls share the same fake Llm, so the script interleaves loop calls and tool calls (see AG-12).
 */
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

import { runAgent } from "../agent/loop.ts";
import { createTools } from "../agent/tools.ts";
import { fakeLlm } from "../agent/llm.ts";
import { createHarness } from "../agent/harness.ts";
import { createTracker } from "../agent/tracker.ts";
import { PRICES, SONNET_MODEL } from "../agent/config.ts";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const JOBS = join(REPO, "demo/seed.json");
const FACTS = join(REPO, "demo/agent/facts.json");
const criteria: any = yaml.load(readFileSync(join(REPO, "criteria.yaml"), "utf8"));
const ID = "greenhouse-1001";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "rr-agent-l-")); delete process.env.ROLE_RADAR_AGENT_KILL; });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); delete process.env.ROLE_RADAR_AGENT_KILL; });

const logPath = () => join(dir, "run.jsonl");
const lines = () => (existsSync(logPath()) ? readFileSync(logPath(), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);

function setup(script: any[], o: { capUsd?: number; wrap?: (tools: any[]) => any[] } = {}) {
  const llm = fakeLlm(script);
  const harness = createHarness({ logPath: logPath(), capUsd: o.capUsd ?? 1, prices: PRICES });
  const tracker = createTracker(join(dir, "tracker.jsonl"), { harness });
  let tools: any[] = createTools({ llm, harness, tracker, criteria, jobsPath: JOBS, factsPath: FACTS } as any) as any[];
  if (o.wrap) tools = o.wrap(tools);
  return { llm, harness, tracker, tools };
}
const use = (name: string, input: unknown, id = name + "-1") => ({ toolCalls: [{ id, name, input }] });
const draft = JSON.stringify({
  resume: [{ text: "Led a payments platform team of 8.", facts: ["demo-f1"] }],
  cover: [{ text: "I cut setup time with a self-serve flow.", facts: ["demo-f2"] }],
  gaps: [],
});
const resultsOf = (req: any) => (req.messages.at(-1).content as any[]).filter((b) => b.type === "tool_result");

test("AG-12 scan, score, tailor, outreach, track run in order, results feed back, and the run ends on a final message", async () => {
  const order: string[] = [];
  const { llm, harness, tools, tracker } = setup([
    use("scan", {}),
    use("score", { roleId: ID }),
    use("tailor", { roleId: ID }),
    { text: draft }, // the tailor tool's own llm call
    use("outreach", { roleId: ID }),
    { text: "Hi, your utility data work caught my eye. I led a payments team." }, // outreach tool's llm call
    use("track", { roleId: ID, status: "drafted", drafts: [{ kind: "resume", ref: "r1" }] }),
    { text: "Done: one role drafted." },
  ], { wrap: (ts) => ts.map((t) => ({ ...t, run: async (i: unknown) => { order.push(t.name); return t.run(i); } })) });

  const res = await runAgent({ llm, harness, tools, goal: "Find and draft for the best role", maxSteps: 12 });
  assert.deepEqual(order, ["scan", "score", "tailor", "outreach", "track"]);
  assert.equal(res.stopReason, "final");
  assert.equal(res.exitCode, 0);
  assert.equal(res.finalText, "Done: one role drafted.");
  assert.equal(tracker.get(ID).status, "drafted");
  // the goal reaches the model, and the scan result is fed back to the next call
  assert.match(JSON.stringify(llm.calls[0].messages), /Find and draft for the best role/);
  assert.equal(llm.calls[0].model, SONNET_MODEL);
  assert.deepEqual((llm.calls[0].tools ?? []).map((t: any) => t.name).sort(), ["outreach", "scan", "score", "tailor", "track"]);
  const back = resultsOf(llm.calls[1]);
  assert.equal(back.length, 1);
  assert.equal(back[0].tool_use_id, "scan-1");
  assert.equal(typeof back[0].content, "string");
  assert.match(back[0].content, new RegExp(ID));
  assert.ok(!back[0].is_error);
});

test("AG-13 an unknown tool and bad input come back as is_error results and the loop continues to a final message", async () => {
  const { llm, harness, tools } = setup([
    use("teleport", { to: "mars" }, "t1"),
    use("score", {}, "t2"), // missing roleId
    use("score", { roleId: "nope-0" }, "t3"),
    { text: "Recovered." },
  ]);
  const res = await runAgent({ llm, harness, tools, goal: "g", maxSteps: 12 });
  assert.equal(res.stopReason, "final");
  assert.equal(res.finalText, "Recovered.");
  for (const [call, id] of [[1, "t1"], [2, "t2"], [3, "t3"]] as const) {
    const r = resultsOf(llm.calls[call]);
    assert.equal(r[0].tool_use_id, id);
    assert.equal(r[0].is_error, true, id);
    assert.equal(typeof r[0].content, "string");
  }
  assert.match(resultsOf(llm.calls[1])[0].content, /teleport/);
  const toolRows = lines().filter((r) => r.event === "tool_call");
  assert.deepEqual(toolRows.map((r) => r.ok), [false, false, false]);
});

test("AG-13 a tool that throws a non-Error value does not crash the loop", async () => {
  const { llm, harness, tools } = setup([use("scan", {}), { text: "ok" }], {
    wrap: (ts) => ts.map((t) => (t.name === "scan" ? { ...t, run: async () => { throw "boom"; } } : t)),
  });
  const res = await runAgent({ llm, harness, tools, goal: "g", maxSteps: 12 });
  assert.equal(res.stopReason, "final");
  assert.equal(resultsOf(llm.calls[1])[0].is_error, true);
});

test("AG-14 the loop stops at maxSteps with no extra llm call and logs max_turns", async () => {
  const { llm, harness, tools } = setup(Array.from({ length: 10 }, (_, i) => use("scan", {}, "s" + i)));
  const res = await runAgent({ llm, harness, tools, goal: "g", maxSteps: 3 });
  assert.equal(llm.calls.length, 3);
  assert.equal(res.stopReason, "max_turns");
  assert.ok(lines().some((r) => r.event === "max_turns"));
});

test("AG-14 default max is 12 steps", async () => {
  const { llm, harness, tools } = setup(Array.from({ length: 30 }, (_, i) => use("scan", {}, "s" + i)));
  const res = await runAgent({ llm, harness, tools, goal: "g" });
  assert.equal(llm.calls.length, 12);
  assert.equal(res.stopReason, "max_turns");
});

test("AG-3 KILL already on: no llm call and no tool run, killed is logged, exit is non-zero", async () => {
  writeFileSync(join(dir, "KILL"), "");
  let ran = 0;
  const { llm, harness, tools } = setup([use("scan", {})], { wrap: (ts) => ts.map((t) => ({ ...t, run: async (i: unknown) => { ran++; return t.run(i); } })) });
  const res = await runAgent({ llm, harness, tools, goal: "g", maxSteps: 12 });
  assert.equal(llm.calls.length, 0);
  assert.equal(ran, 0);
  assert.equal(res.stopReason, "killed");
  assert.notEqual(res.exitCode, 0);
  assert.ok(lines().some((r) => r.event === "killed"));
});

test("AG-3 KILL appears mid-run (during a tool): the next tool and the next llm call never happen", async () => {
  let ran: string[] = [];
  const { llm, harness, tools } = setup(
    [{ toolCalls: [{ id: "a", name: "scan", input: {} }, { id: "b", name: "score", input: { roleId: ID } }] }, { text: "should never be asked" }],
    { wrap: (ts) => ts.map((t) => ({ ...t, run: async (i: unknown) => { ran.push(t.name); const r = await t.run(i); if (t.name === "scan") writeFileSync(join(dir, "KILL"), ""); return r; } })) },
  );
  const res = await runAgent({ llm, harness, tools, goal: "g", maxSteps: 12 });
  assert.deepEqual(ran, ["scan"], "score was not run after KILL");
  assert.equal(llm.calls.length, 1, "no second llm call");
  assert.equal(res.stopReason, "killed");
  assert.notEqual(res.exitCode, 0);
  assert.ok(lines().some((r) => r.event === "killed"));
});

test("AG-3 env ROLE_RADAR_AGENT_KILL=1 stops the loop before the first call", async () => {
  process.env.ROLE_RADAR_AGENT_KILL = "1";
  const { llm, harness, tools } = setup([{ text: "x" }]);
  const res = await runAgent({ llm, harness, tools, goal: "g", maxSteps: 12 });
  assert.equal(llm.calls.length, 0);
  assert.equal(res.stopReason, "killed");
});

test("AG-4 crossing the cap stops the loop: cap_hit logged, non-zero exit, no further llm call", async () => {
  // 1M input tokens on Sonnet costs far more than a $0.01 cap.
  const { llm, harness, tools } = setup(
    [{ ...use("scan", {}), usage: { input: 1_000_000, output: 0 } }, { text: "should never be asked" }],
    { capUsd: 0.01 },
  );
  const res = await runAgent({ llm, harness, tools, goal: "g", maxSteps: 12 });
  assert.equal(llm.calls.length, 1);
  assert.equal(res.stopReason, "cap_hit");
  assert.notEqual(res.exitCode, 0);
  const rows = lines();
  assert.ok(rows.some((r) => r.event === "cap_hit"));
  const call = rows.find((r) => r.event === "llm_call");
  assert.equal(call.input_tokens, 1_000_000, "usage logged from the response, not estimated");
});

test("every loop llm call is logged with the response usage", async () => {
  const { llm, harness, tools } = setup([{ text: "hi", usage: { input: 120, output: 30 } }]);
  await runAgent({ llm, harness, tools, goal: "g", maxSteps: 12 });
  const calls = lines().filter((r) => r.event === "llm_call");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].input_tokens, 120);
  assert.equal(calls[0].output_tokens, 30);
  assert.equal(calls[0].model, SONNET_MODEL);
});

test("drafts only: a model that asks for sent (even claiming approval) is refused, the tracker is unchanged, and refused_sent is logged", async () => {
  const { llm, harness, tools, tracker } = setup([
    use("track", { roleId: ID, status: "ready" }, "k1"),
    use("track", { roleId: ID, status: "sent", approved: true }, "k2"),
    use("track", { roleId: ID, status: "sent", approve_sent: ID }, "k3"),
    { text: "stopped" },
  ]);
  const res = await runAgent({ llm, harness, tools, goal: "g", maxSteps: 12 });
  assert.equal(res.stopReason, "final");
  assert.equal(tracker.get(ID).status, "ready");
  assert.equal(resultsOf(llm.calls[2])[0].is_error, true);
  assert.equal(resultsOf(llm.calls[3])[0].is_error, true);
  assert.equal(lines().filter((r) => r.event === "refused_sent").length, 2);
});

test("drafts only: a model asking for a send tool by name gets an unknown-tool error", async () => {
  const { llm, harness, tools } = setup([use("send_email", { to: "x" }, "e1"), { text: "ok" }]);
  await runAgent({ llm, harness, tools, goal: "g", maxSteps: 12 });
  const r = resultsOf(llm.calls[1])[0];
  assert.equal(r.is_error, true);
  assert.match(r.content, /send_email|unknown/i);
});

test("grounding in the loop: a tailor draft citing an invented fact id is an is_error result and no draft is saved", async () => {
  const bad = JSON.stringify({ resume: [{ text: "Ran a 500-person org.", facts: ["demo-f99"] }], cover: [], gaps: [] });
  const { llm, harness, tools, tracker } = setup([use("tailor", { roleId: ID }, "t1"), { text: bad }, { text: "gave up" }]);
  const res = await runAgent({ llm, harness, tools, goal: "g", maxSteps: 12 });
  assert.equal(res.stopReason, "final");
  const r = resultsOf(llm.calls[2])[0];
  assert.equal(r.is_error, true);
  assert.match(r.content, /demo-f99/);
  assert.ok(!tracker.list().some((x) => x.status === "ready"));
});
