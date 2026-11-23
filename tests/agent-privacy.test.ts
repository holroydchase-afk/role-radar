/* RR-AGENT v2 privacy and no-API (AGV2-1, 2, 14; PS-R1 path rules kept). Written BEFORE the code (red). Demo data, no network.
 * Deleted from v1 (why): PS-R1 createHarness log-path case and the PS-R2 `scan-and-draft` CLI cases (harness and that command are gone; the
 * facts/jobs/tracker guards are re-pinned through the new commands in agent-cli AGV2-3), PS-R3 against the createTools `track` tool
 * (re-pinned through `track` in agent-tracker AGV2-9).
 * AGV2-14 note: the spec asks for a grep of source for `usd`, but metrics reads the stamp field `cost_usd` (AGV2-13). The one allowed
 * occurrence is the exact token `cost_usd`; anything else (price tables, usd arithmetic, a `$` in output) fails. See QA-R1.
 */
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createTracker } from "../agent/tracker.ts";
import { assertOutsideRepo } from "../agent/config.ts";
import { REPO, ID, DEMO_FACTS, DEMO_JOBS, sandbox, run, human, begin, goodDraft, goodOutreach, agentFiles, type Sandbox } from "./agent-support.ts";

const DEMO_CASES = join(REPO, "demo/agent/cases.json");
let sb: Sandbox;
beforeEach(() => { sb = sandbox(); begin(sb); });
afterEach(() => rmSync(sb.dir, { recursive: true, force: true }));

function seedMetricsData() {
  const t = createTracker(sb.tracker);
  t.upsertRole({ id: "r1", title: "Demo PM", company: "Demo Co" });
  t.setStatus("r1", "drafted");
}
const sources = () => agentFiles().filter((f) => f.endsWith(".ts")).map((f) => ({ name: f.slice(REPO.length + 1), src: readFileSync(f, "utf8") }));

// ---- AGV2-1 ----
test("AGV2-1 agent/ has no fetch, node:net, node:http(s), nodemailer, ANTHROPIC_API_KEY or x-api-key", () => {
  const banned = /\bfetch\b|node:net\b|node:https?\b|["']https?["']|nodemailer|ANTHROPIC_API_KEY|x-api-key|\bXMLHttpRequest\b|node:dgram|node:tls|undici|WebSocket/i;
  for (const { name, src } of sources()) assert.ok(!banned.test(src), `${name} matches ${banned.exec(src)?.[0]}`);
});

test("AGV2-1 no command touches the network at run time (a preloaded stub records any fetch or socket)", () => {
  for (const args of [["--help"], ["scan", "--demo"], ["score", ID, "--demo"], ["metrics"], ["track", ID, "found"]]) {
    const r = run(sb, args);
    assert.equal(r.net, false, args.join(" "));
  }
});

// ---- AGV2-2 ----
test("AGV2-2 no price table, usd arithmetic, model ids or Llm import in agent/", () => {
  for (const { name, src } of sources()) {
    assert.ok(!/\bPRICES\b|PRICES_AS_OF|inputPerMTok|outputPerMTok|PerMTok|capUsd|MAX_USD|SONNET_MODEL|OPUS_MODEL|claude-(sonnet|opus|haiku)-\d/.test(src), `${name}: price table or model pin`);
    assert.ok(!/from\s+["']\.\/(llm|harness|loop|evals)(\.ts)?["']|import\s+type[^;]*\bLlm\b|\bLlm\b|fakeLlm|anthropicLlm|createHarness/.test(src), `${name}: Llm/harness import`);
  }
});

test("AGV2-2 no file named harness, llm, loop or evals under agent/", () => {
  for (const f of agentFiles()) assert.ok(!/(^|\/)(harness|llm|loop|evals)(\.[^/]*)?$/.test(f.slice(REPO.length + 1)), f);
});

test("AGV2-2 package.json gains no dependency (same two runtime dependencies, no SDK, no HTTP client)", () => {
  const pkg = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8"));
  assert.deepEqual(Object.keys(pkg.dependencies).sort(), ["@modelcontextprotocol/sdk", "js-yaml"]);
  assert.deepEqual(Object.keys(pkg.devDependencies).sort(),
    ["@fontsource/atkinson-hyperlegible-next", "@types/node", "esbuild", "playwright", "typescript"]);
});

test("AGV2-2 config keeps REPO_ROOT and assertOutsideRepo and drops the model ids and price table", async () => {
  const cfg: any = await import("../agent/config.ts");
  assert.equal(typeof cfg.assertOutsideRepo, "function");
  assert.equal(typeof cfg.REPO_ROOT, "string");
  for (const k of ["PRICES", "PRICES_AS_OF", "SONNET_MODEL", "OPUS_MODEL"]) assert.equal(k in cfg, false, `${k} must be removed`);
});

// ---- AGV2-14 ----
test("AGV2-14 no repo code computes or prints dollars: no usd (bar the stamp field cost_usd), no $ amounts, no currency formatting", () => {
  for (const { name, src } of sources()) {
    const cleaned = src.replace(/cost_usd/g, "");
    assert.ok(!/usd|dollar|currency|Intl\.NumberFormat/i.test(cleaned), `${name}: usd/dollar`);
    assert.ok(!/\$\s?\d|\$\s?\{[^}]*(cost|price)|(["'])\$\1|\\\$|toFixed\(\s*[2-6]\s*\)/i.test(cleaned), `${name}: dollar amount or formatting`);
  }
});

test("AGV2-14 help, metrics and error output contain no $, usd, dollar, spend or price", () => {
  seedMetricsData();
  const outs = [run(sb, ["--help"]), run(sb, ["metrics"]), run(sb, ["score"]), run(sb, ["frobnicate"]), run(sb, ["track", ID, "sent"]),
    run(sb, ["tailor-submit", ID], { input: "{" })];
  for (const r of outs) assert.doesNotMatch(r.out + r.err, /\$|usd|dollar|spend|price/i, r.out + r.err);
  assert.match(outs[1].out, /roles found/i, "metrics really ran");
  // scan and score print the job's own pay text from the data (not computed here), so they are not checked for $.
});

// ---- path rules kept (PS-R1) ----
test("PS-R1 tracker paths inside the repo are refused, demo/ included", () => {
  for (const rel of ["demo/tracker.jsonl", "demo/agent/tracker.jsonl", "agent/tracker.jsonl", "tracker.jsonl"]) {
    assert.throws(() => createTracker(join(REPO, rel)), /ROLE_RADAR_TRACKER/, rel);
    assert.equal(existsSync(join(REPO, rel)), false, rel);
  }
});

test("PS-R1 read-only inputs: exactly the three shipped demo files pass, nothing else under demo/ does", () => {
  for (const ok of [DEMO_FACTS, DEMO_CASES, DEMO_JOBS]) assert.doesNotThrow(() => assertOutsideRepo(ok, "ROLE_RADAR_FACTS", { readOnly: true }), ok);
  for (const bad of [join(REPO, "demo/agent/real-facts.json"), join(REPO, "demo/agent/facts.json.bak"), join(REPO, "demo/facts.json"),
    join(REPO, "demo/agent/../../agent/facts.json"), join(REPO, "demo/agent"), join(REPO, "demo/profile.json")])
    assert.throws(() => assertOutsideRepo(bad, "ROLE_RADAR_FACTS", { readOnly: true }), /ROLE_RADAR_FACTS/, bad);
});

test("PS-R1 .gitignore ignores *.jsonl and agent/*.local.*", () => {
  const lines = readFileSync(join(REPO, ".gitignore"), "utf8").split("\n").map((l) => l.trim());
  assert.ok(lines.includes("*.jsonl") && lines.includes("agent/*.local.*"));
});

test("AGV2 demo data stays made up: facts and cases hold no emails, links or phone numbers", () => {
  for (const p of [DEMO_FACTS, DEMO_CASES]) {
    const raw = readFileSync(p, "utf8");
    assert.match(raw, /made[- ]up|fictional|demo/i);
    assert.ok(!raw.includes("@") && !/https?:\/\/|www\./i.test(raw) && !/\(?\b\d{3}\)?[-. ]\d{3}[-. ]\d{4}\b/.test(raw), p);
  }
});

test("AGV2-3 drafts are saved beside the tracker, never in the repo (a draft run leaves the repo's drafts path absent)", () => {
  const r = run(sb, ["outreach-submit", ID], { input: JSON.stringify(goodOutreach()) });
  assert.equal(r.code, 0, r.err);
  assert.equal(existsSync(join(REPO, "drafts")), false);
  assert.equal(existsSync(sb.drafts), true);
});
