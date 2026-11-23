/* RR-AGENT PR 2: tools contract (AG-10, 11, 15, 16, 17, 18; track and drafts-only checks). Spec: docs/product/SPEC-AGENT.md.
 * Demo and made-up data only (demo/seed.json, demo/agent/facts.json, criteria.yaml). No network.
 *
 * Module agent/tools.ts exports (contract these tests pin; the engineer builds to it):
 *   createTools({ llm, harness, tracker, criteria, jobsPath, factsPath }) -> ToolDef[]
 *     ToolDef = { name, description?, schema (JSON schema, type "object"), run(input) => Promise<result> }
 *     Exactly five tools, named: scan, score, tailor, outreach, track. No send/submit/email tool.
 *     run() THROWS an Error to reject bad input or output (the loop turns that into an is_error result).
 *   scan({})            -> { jobs: [{ id, company, title, ... }] } from the jobs file's `jobs` map (key = id). No network.
 *   score({ roleId })   -> { roleId, score, explanation, match } where score = scoreJob(job, criteria).score,
 *                          explanation = explain(scoreJob(...)), match = matchJob(job, criteria). Unknown roleId throws.
 *   tailor({ roleId })  -> one llm.call (model SONNET_MODEL, system prompt lists the fact ids and texts, forbids claims
 *                          outside them and says to list missing skills under "gaps"). The llm text is JSON:
 *                          { resume: [{text, facts:[id]}], cover: [{text, facts:[id]}], gaps: [string] }.
 *                          Returns { roleId, resume, cover, gaps }. Throws if any claim has no fact ids, or cites an id
 *                          not in factsPath. A rejected draft writes nothing to the tracker (never "ready").
 *   outreach({ roleId }) -> one llm.call; llm text is the message. Returns { roleId, text }. Throws if empty, over
 *                          3 sentences, or it contains a URL or email address that is not in the facts file text.
 *   track({ roleId, status, drafts? }) -> upserts the role (id, title, company, score from the jobs file) then
 *                          tracker.setStatus(roleId, status) (no approval flag is ever passed) and tracker.addDraft
 *                          for each {kind, ref}. Throws on a bad status or on "sent".
 * Facts file shape: { facts: [{ id, text, tags }] }. Tool llm usage is recorded through the harness.
 */
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

import { createTools } from "../agent/tools.ts";
import { fakeLlm } from "../agent/llm.ts";
import { createHarness } from "../agent/harness.ts";
import { createTracker } from "../agent/tracker.ts";
import { PRICES, SONNET_MODEL } from "../agent/config.ts";
import { scoreJob, matchJob, explain } from "../src/scoring.ts";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const JOBS = join(REPO, "demo/seed.json");
const FACTS = join(REPO, "demo/agent/facts.json");
const criteria: any = yaml.load(readFileSync(join(REPO, "criteria.yaml"), "utf8"));
const seed = JSON.parse(readFileSync(JOBS, "utf8"));
const ID = "greenhouse-1001";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "rr-agent-t-")); delete process.env.ROLE_RADAR_AGENT_KILL; });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); delete process.env.ROLE_RADAR_AGENT_KILL; });

const lines = (p: string) => (existsSync(p) ? readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);

function setup(script: any[] = [], factsPath = FACTS) {
  const llm = fakeLlm(script);
  const harness = createHarness({ logPath: join(dir, "run.jsonl"), capUsd: 1, prices: PRICES });
  const tracker = createTracker(join(dir, "tracker.jsonl"), { harness });
  const tools = createTools({ llm, harness, tracker, criteria, jobsPath: JOBS, factsPath } as any);
  const tool = (n: string) => {
    const t = (tools as any[]).find((x) => x.name === n);
    assert.ok(t, `tool ${n} exists`);
    return t;
  };
  return { llm, harness, tracker, tools: tools as any[], tool, log: join(dir, "run.jsonl") };
}

const draftJson = (over: Record<string, unknown> = {}) => JSON.stringify({
  resume: [{ text: "Led a payments platform team of 8.", facts: ["demo-f1"] }],
  cover: [{ text: "I cut setup time with a self-serve flow.", facts: ["demo-f2"] }],
  gaps: [],
  ...over,
});

test("AG-10 exactly five tools with object schemas, and no send path in the names (drafts only)", () => {
  const { tools } = setup();
  assert.deepEqual(tools.map((t) => t.name).sort(), ["outreach", "scan", "score", "tailor", "track"]);
  for (const t of tools) {
    assert.equal(t.schema?.type, "object", `${t.name} schema`);
    assert.equal(typeof t.run, "function");
    assert.doesNotMatch(t.name, /send|submit|email|apply|post/i);
  }
});

test("AG-10 scan returns the seed jobs (ids and titles) and does not touch the network", async () => {
  const realFetch = globalThis.fetch;
  let fetched = 0;
  globalThis.fetch = (async () => { fetched++; throw new Error("network is off"); }) as any;
  try {
    const { tool, llm } = setup();
    const out = await tool("scan").run({});
    const ids = Object.keys(seed.jobs);
    assert.deepEqual(out.jobs.map((j: any) => j.id).sort(), [...ids].sort());
    const one = out.jobs.find((j: any) => j.id === ID);
    assert.equal(one.company, seed.jobs[ID].company);
    assert.equal(one.title, seed.jobs[ID].title);
    assert.equal(fetched, 0, "no fetch");
    assert.equal(llm.calls.length, 0, "scan makes no Llm call");
  } finally { globalThis.fetch = realFetch; }
});

test("AG-11 score equals scoreJob plus explain plus matchJob for the same job and criteria", async () => {
  const { tool } = setup();
  const job = seed.jobs[ID];
  const want = scoreJob(job, criteria);
  const out = await tool("score").run({ roleId: ID });
  assert.equal(out.roleId, ID);
  assert.equal(out.score, want.score);
  assert.equal(out.explanation, explain(want));
  assert.deepEqual(out.match, matchJob(job, criteria));
});

test("AG-11 score of every seed job matches scoreJob (pinned, not hardcoded)", async () => {
  const { tool } = setup();
  for (const [id, job] of Object.entries<any>(seed.jobs)) {
    const out = await tool("score").run({ roleId: id });
    assert.equal(out.score, scoreJob(job, criteria).score, id);
  }
});

test("AG-11 score of an unknown role or missing roleId throws", async () => {
  const { tool } = setup();
  await assert.rejects(() => tool("score").run({ roleId: "nope-0" }), /nope-0|unknown/i);
  await assert.rejects(() => tool("score").run({}), /roleId/i);
});

test("AG-15 tailor accepts a draft whose claims all cite real fact ids and returns it with gaps", async () => {
  const { tool, llm } = setup([{ text: draftJson({ gaps: ["hardware"] }) }]);
  const out = await tool("tailor").run({ roleId: ID });
  assert.equal(llm.calls.length, 1);
  assert.equal(llm.calls[0].model, SONNET_MODEL);
  assert.equal(out.roleId, ID);
  assert.deepEqual(out.resume[0].facts, ["demo-f1"]);
  assert.deepEqual(out.gaps, ["hardware"]);
});

test("AG-15 tailor rejects a claim citing a fact id not in the facts file, and nothing is saved as ready", async () => {
  const bad = draftJson({ resume: [{ text: "Ran a 500-person org.", facts: ["demo-f99"] }] });
  const { tool, tracker } = setup([{ text: bad }]);
  await assert.rejects(() => tool("tailor").run({ roleId: ID }), /demo-f99/);
  assert.ok(!tracker.list().some((r) => r.status === "ready"), "no ready role");
  assert.ok(tracker.list().every((r) => r.drafts.length === 0), "no draft saved");
});

test("AG-15 tailor rejects a claim with no fact ids at all, and malformed JSON", async () => {
  const none = draftJson({ cover: [{ text: "Invented a database.", facts: [] }] });
  await assert.rejects(() => setup([{ text: none }]).tool("tailor").run({ roleId: ID }), /fact/i);
  await assert.rejects(() => setup([{ text: "not json at all" }]).tool("tailor").run({ roleId: ID }));
});

test("AG-16 facts lacking the skill: the tailor prompt carries only the real facts, forbids claiming more, and asks for gaps", async () => {
  const only = join(dir, "facts-small.json");
  writeFileSync(only, JSON.stringify({ facts: [{ id: "demo-f1", text: "Led a made-up payments platform team of 8 at Example Co (demo).", tags: ["leadership"] }] }));
  const { tool, llm } = setup([{ text: draftJson({ cover: [{ text: "Led a team.", facts: ["demo-f1"] }], gaps: ["hardware"] }) }], only);
  const out = await tool("tailor").run({ roleId: ID });
  const sys = String(llm.calls[0].system);
  assert.match(sys, /demo-f1/);
  assert.doesNotMatch(sys, /demo-f2|demo-f3/, "facts not in the file are not in the prompt");
  assert.match(sys, /gaps/i);
  assert.match(sys, /(never|must not|do not|only)/i);
  assert.deepEqual(out.gaps, ["hardware"]);
});

test("AG-16 a fake Llm that invents a hardware claim is caught by the fact-id check", async () => {
  const invented = draftJson({ resume: [{ text: "Designed solar inverter hardware.", facts: ["demo-hw1"] }] });
  const { tool } = setup([{ text: invented }]);
  await assert.rejects(() => tool("tailor").run({ roleId: ID }), /demo-hw1/);
});

test("AG-17 outreach accepts 1 to 3 natural sentences", async () => {
  for (const text of ["Hi, I liked the utility data work.", "Hi there. I led a payments team. Happy to chat.", "One sentence only!"]) {
    const { tool, llm } = setup([{ text }]);
    const out = await tool("outreach").run({ roleId: ID });
    assert.equal(out.text, text);
    assert.equal(llm.calls[0].model, SONNET_MODEL);
  }
});

test("AG-17 outreach rejects empty output and more than 3 sentences", async () => {
  await assert.rejects(() => setup([{ text: "   " }]).tool("outreach").run({ roleId: ID }), /empty|sentence/i);
  await assert.rejects(() => setup([{ text: "One. Two. Three. Four." }]).tool("outreach").run({ roleId: ID }), /sentence|long|3/i);
});

test("AG-17 outreach rejects a link or email address that is not in the facts file", async () => {
  await assert.rejects(() => setup([{ text: "See https://evil.example/me for my work." }]).tool("outreach").run({ roleId: ID }), /link|url|evil\.example/i);
  await assert.rejects(() => setup([{ text: "Reach me at someone@example.com today." }]).tool("outreach").run({ roleId: ID }), /email|someone@/i);
  await assert.rejects(() => setup([{ text: "Visit www.sketchy.example now." }]).tool("outreach").run({ roleId: ID }), /link|url|sketchy/i);
});

test("AG-17 outreach allows a link that IS in the facts file", async () => {
  const withLink = join(dir, "facts-link.json");
  writeFileSync(withLink, JSON.stringify({ facts: [{ id: "demo-l1", text: "Portfolio at https://portfolio.example/demo (demo).", tags: [] }] }));
  const { tool } = setup([{ text: "My work is at https://portfolio.example/demo if useful." }], withLink);
  const out = await tool("outreach").run({ roleId: ID });
  assert.match(out.text, /portfolio\.example/);
});

test("track writes status and draft refs to the tracker with the role's title and company", async () => {
  const { tool, tracker } = setup();
  await tool("track").run({ roleId: ID, status: "drafted", drafts: [{ kind: "resume", ref: "run-1/resume" }] });
  const r = tracker.get(ID);
  assert.equal(r.status, "drafted");
  assert.equal(r.company, seed.jobs[ID].company);
  assert.equal(r.title, seed.jobs[ID].title);
  assert.deepEqual(r.drafts, [{ kind: "resume", ref: "run-1/resume" }]);
});

test("AG-8/AG-9 via track: sent is refused even if the input claims approval, and a bad status is rejected", async () => {
  const { tool, tracker, log } = setup();
  await tool("track").run({ roleId: ID, status: "ready" });
  await assert.rejects(() => tool("track").run({ roleId: ID, status: "sent", approved: true }), /approv|sent/i);
  await assert.rejects(() => tool("track").run({ roleId: ID, status: "emailed" }), /invalid|status/i);
  assert.equal(tracker.get(ID).status, "ready", "unchanged");
  assert.ok(lines(log).some((r) => r.event === "refused_sent"));
  assert.equal((tool("track").schema.properties ?? {}).approved, undefined, "the model cannot even see an approval field");
});

test("AG-18 source scan: no tool or loop module imports a network or mail module or calls fetch", () => {
  const files = [join(REPO, "agent/tools.ts"), join(REPO, "agent/loop.ts")];
  const dirTools = join(REPO, "agent/tools");
  if (existsSync(dirTools)) for (const f of readdirSync(dirTools)) if (f.endsWith(".ts")) files.push(join(dirTools, f));
  for (const f of files.slice(0, 2)) assert.ok(existsSync(f), `${f} exists`);
  const banned = /node:(net|http|https|http2|tls|dgram|dns)\b|from\s+["'](net|http|https|tls|dgram)["']|nodemailer|smtp|child_process|\bfetch\s*\(|\bXMLHttpRequest\b|\bWebSocket\b|globalThis\.fetch/i;
  for (const f of files) {
    const src = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.doesNotMatch(src, banned, `${f} has no network or mail path`);
  }
});
