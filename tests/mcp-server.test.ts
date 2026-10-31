/* MCP server contract (GitHub issue #59): a local stdio MCP server so Claude can score any job against criteria.yaml.
 *
 * Entry:   mcp/server.ts, started with `node mcp/server.ts` (Node 22.18+ strips types; no build step).
 *          Stdio only: no network calls, no port, no fetch.
 * Deps:    @modelcontextprotocol/sdk (exact pin) and js-yaml, both under "dependencies" in package.json.
 * Criteria: the repo's criteria.yaml by default, resolved next to the server file (not the caller's cwd),
 *          or the path in env ROLE_RADAR_CRITERIA. Read on each call is fine; the env path wins when set.
 * Scoring: the server imports matchJob / scoreJob / explain from src/scoring.ts. One source of truth, no copy.
 *
 * Tool input (score_job, match_job, explain_score all take the same object):
 *   title        string, required   -> Job.title
 *   company      string, required   -> Job.company
 *   location     string, optional   -> Job.location      (matchJob: hybrid / on-site outside hybrid_ok_near fails)
 *   comp         string, optional   -> Job.comp          (parseComp reads "$170K–$205K", "160,000 - 180,000", ...)
 *   description  string, optional   -> Job.postingText   (sector keywords, culture signals, hard red flags)
 *   companyStage string, optional   -> Job.companyStage  ("startup" applies company_stage.startup_penalty)
 *   fit          string, optional   -> Job.fit           (strong | maybe | stretch; experience points, 0 if omitted)
 *   sector       string, optional   -> Job.sector        (a sector label or id; inferred from company/text if omitted)
 * Only fields that are present are copied; nothing else is added to the Job.
 *
 * Tool output: one content item of type "text" holding JSON (structuredContent may carry the same object).
 *   score_job      -> { score: 0-100, parts: {sector, fit, culture, comp, values, dream, stage}, reasons: string[], match: {ok, reasons} }
 *                     reasons = human-readable lines on what moved the score (e.g. the explain() parts, sector label, gate failures).
 *   match_job      -> { ok: boolean, reasons: string[] }   (matchJob: the hard gates and why one failed)
 *   explain_score  -> { score, explanation }               (explanation === explain(scoreJob(job, criteria)))
 *   get_criteria   -> the parsed criteria object           (no input)
 *
 * Demo data only: every job here is from demo/seed.json (fictional) or made up for the test.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";

import * as S from "../src/scoring.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const serverPath = join(root, "mcp", "server.ts");
const spec = yaml.load(readFileSync(join(root, "criteria.yaml"), "utf8"));
const seed = JSON.parse(readFileSync(join(root, "demo", "seed.json"), "utf8"));

type Input = { title: string; company: string; location?: string; comp?: string; description?: string; companyStage?: string; fit?: string; sector?: string };

/** The mapping the server must apply: description -> postingText, every other field by the same name. */
function toJob(i: Input): S.Job {
  const job: S.Job = { title: i.title, company: i.company };
  if (i.location !== undefined) job.location = i.location;
  if (i.comp !== undefined) job.comp = i.comp;
  if (i.description !== undefined) job.postingText = i.description;
  if (i.companyStage !== undefined) job.companyStage = i.companyStage;
  if (i.fit !== undefined) job.fit = i.fit;
  if (i.sector !== undefined) job.sector = i.sector;
  return job;
}

// A passing demo role, straight from demo/seed.json (fictional company).
const sunfield = seed.jobs["greenhouse-1001"];
const passing: Input = {
  title: sunfield.title,
  company: sunfield.company,
  location: sunfield.location,
  comp: sunfield.comp,
  fit: sunfield.fit,
  sector: sunfield.sector,
  description: "Own utility rate and interconnection data products. We keep a sustainable pace and offer 16 weeks of parental leave.",
};

// A demo role whose posting hits a culture.hard_red_flags phrase (red_flag_effect: skip_hard).
const carbonmark = seed.jobs["ziprecruiter-1003"];
const hardFlag = "fast-paced";
const redFlagged: Input = {
  title: carbonmark.title,
  company: carbonmark.company,
  location: carbonmark.location,
  comp: carbonmark.comp,
  fit: carbonmark.fit,
  description: `Join a ${hardFlag} team shipping emissions reporting for enterprise customers.`,
};

let tmp = "";
const clients: Client[] = [];

async function connect(env?: Record<string, string>): Promise<Client> {
  assert.ok(existsSync(serverPath), "mcp/server.ts does not exist yet (issue #59)");
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    cwd: tmp, // not the repo: the default criteria.yaml must resolve next to the server, not the cwd
    env: { ...getDefaultEnvironment(), ...(env || {}) },
    stderr: "inherit",
  });
  const client = new Client({ name: "role-radar-test", version: "0.0.0" });
  clients.push(client);
  await client.connect(transport);
  return client;
}

/** Calls a tool and returns the JSON parsed from its single text content item. */
async function call(client: Client, name: string, args: Record<string, unknown> = {}): Promise<any> {
  const res: any = await client.callTool({ name, arguments: args });
  assert.ok(!res.isError, `${name} returned isError: ${JSON.stringify(res.content)}`);
  assert.ok(Array.isArray(res.content) && res.content.length === 1, `${name} returns exactly one content item`);
  assert.equal(res.content[0].type, "text");
  return JSON.parse(res.content[0].text);
}

let client: Client;

before(async () => {
  tmp = mkdtempSync(join(tmpdir(), "role-radar-mcp-"));
  client = await connect();
});

after(async () => {
  for (const c of clients) await c.close().catch(() => {});
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

test("MCP-1 tools/list returns exactly score_job, match_job, explain_score and get_criteria", async () => {
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), ["explain_score", "get_criteria", "match_job", "score_job"]);
  for (const name of ["score_job", "match_job", "explain_score"]) {
    const t = tools.find((x) => x.name === name)!;
    const props = Object.keys((t.inputSchema as any).properties || {});
    for (const f of ["title", "company", "location", "comp", "description", "companyStage"]) assert.ok(props.includes(f), `${name} input has ${f}`);
    assert.deepEqual([...((t.inputSchema as any).required || [])].sort(), ["company", "title"], `${name} requires title and company only`);
  }
});

test("MCP-2 score_job on a passing demo role matches scoreJob from src/scoring.ts", async () => {
  const expected = S.scoreJob(toJob(passing), spec);
  assert.ok(S.matchJob(toJob(passing), spec).ok, "fixture sanity: the demo role passes the hard gates");
  const out = await call(client, "score_job", passing);
  assert.equal(typeof out.score, "number");
  assert.ok(out.score >= 0 && out.score <= 100);
  assert.equal(out.score, expected.score);
  assert.deepEqual(out.parts, expected.parts);
  assert.deepEqual(Object.keys(out.parts).sort(), ["comp", "culture", "dream", "fit", "sector", "stage", "values"]);
  assert.ok(Array.isArray(out.reasons) && out.reasons.length > 0, "reasons is a non-empty array");
  assert.ok(out.reasons.every((r: unknown) => typeof r === "string" && r.length > 0), "every reason is a non-empty string");
  assert.deepEqual(out.match, { ok: true, reasons: [] });
});

test("MCP-2b score_job applies the startup penalty from companyStage", async () => {
  const startup = { ...passing, companyStage: "startup" };
  const out = await call(client, "score_job", startup);
  assert.equal(out.parts.stage, spec.company_stage.startup_penalty);
  assert.equal(out.score, S.scoreJob(toJob(startup), spec).score);
});

test("MCP-3 match_job fails a demo role whose posting hits a hard red flag, and names it", async () => {
  const expected = S.matchJob(toJob(redFlagged), spec);
  assert.ok(spec.culture.hard_red_flags.includes(hardFlag), "fixture sanity: criteria.yaml lists the phrase as a hard red flag");
  const out = await call(client, "match_job", redFlagged);
  assert.equal(out.ok, false);
  assert.ok(out.reasons.some((r: string) => r.includes("hard red flag") && r.includes(hardFlag)), `a reason names ${hardFlag}: ${JSON.stringify(out.reasons)}`);
  assert.deepEqual(out, { ok: expected.ok, reasons: expected.reasons });
});

test("MCP-3b match_job passes the clean demo role", async () => {
  assert.deepEqual(await call(client, "match_job", passing), { ok: true, reasons: [] });
});

test("MCP-4 explain_score returns explain(scoreJob(...)) for the demo role", async () => {
  const result = S.scoreJob(toJob(passing), spec);
  const out = await call(client, "explain_score", passing);
  assert.equal(out.score, result.score);
  assert.equal(typeof out.explanation, "string");
  assert.ok(out.explanation.length > 0 && out.explanation !== "0", "explanation is not empty");
  assert.equal(out.explanation, S.explain(result));
});

test("MCP-5 get_criteria returns the repo's criteria.yaml by default", async () => {
  const out = await call(client, "get_criteria");
  assert.deepEqual(Object.keys(out).sort(), Object.keys(spec).sort());
  assert.equal(out.scoring.min_score_to_add, spec.scoring.min_score_to_add);
  assert.deepEqual(out.culture.hard_red_flags, spec.culture.hard_red_flags);
});

test("MCP-5b ROLE_RADAR_CRITERIA points the server at another criteria file", async () => {
  const path = join(tmp, "criteria.test.yaml");
  writeFileSync(path, [
    "# test-only criteria",
    "demo: true",
    "owner: Test Fixture",
    "role:",
    "  title_include: [Product Manager]",
    "comp:",
    "  stretch_target_usd: 100000",
    "scoring:",
    "  min_score_to_add: 7",
    "",
  ].join("\n"));
  const alt = await connect({ ROLE_RADAR_CRITERIA: path });
  const out = await call(alt, "get_criteria");
  assert.deepEqual(out, yaml.load(readFileSync(path, "utf8")));
  assert.equal(out.scoring.min_score_to_add, 7);
  // And scoring uses that file too: no sectors there, so the default weight (1) applies, not the repo's weight 3.
  const scored = await call(alt, "score_job", passing);
  assert.equal(scored.score, S.scoreJob(toJob(passing), yaml.load(readFileSync(path, "utf8"))).score);
  assert.notEqual(scored.score, S.scoreJob(toJob(passing), spec).score);
});

test("MCP-6 mcp/server.ts makes no network calls and package.json ships its runtime deps", () => {
  assert.ok(existsSync(serverPath), "mcp/server.ts exists");
  const src = readFileSync(serverPath, "utf8");
  assert.doesNotMatch(src, /\bfetch\s*\(/, "no fetch(");
  const netMod = /(?:from\s*|import\s*\(\s*|require\s*\(\s*)["'](?:node:)?(?:http|https|http2|net|tls|dgram)["']/;
  assert.doesNotMatch(src, netMod, "no http/https/http2/net/tls/dgram imports");
  assert.doesNotMatch(src, /\.listen\s*\(/, "no listening port");
  assert.match(src, /["'](?:\.\.\/)?src\/scoring(?:\.ts)?["']|["']\.\.\/src\/scoring\.ts["']/, "scores with src/scoring.ts, not a copy");
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  for (const dep of ["@modelcontextprotocol/sdk", "js-yaml"]) {
    assert.ok(pkg.dependencies && pkg.dependencies[dep], `${dep} is under dependencies`);
    assert.ok(!(pkg.devDependencies && pkg.devDependencies[dep]), `${dep} is not also a devDependency`);
    assert.match(pkg.dependencies[dep], /^\d+\.\d+\.\d+$/, `${dep} is pinned to an exact version`);
  }
});

test("MCP-7 an unreadable ROLE_RADAR_CRITERIA path returns isError, and the server keeps serving", async () => {
  const missing = join(tmp, "no-such-dir", "criteria.yaml");
  const bad = await connect({ ROLE_RADAR_CRITERIA: missing });
  for (const [name, args] of [["get_criteria", {}], ["score_job", passing], ["match_job", passing], ["explain_score", passing]] as const) {
    const res: any = await bad.callTool({ name, arguments: args as Record<string, unknown> });
    assert.equal(res.isError, true, `${name} with a missing criteria file returns isError`);
    assert.equal(res.content[0].type, "text");
    assert.ok(res.content[0].text.length > 0, `${name} says what went wrong`);
  }
  // A directory is unreadable as a file too.
  const dir = await connect({ ROLE_RADAR_CRITERIA: tmp });
  assert.equal(((await dir.callTool({ name: "get_criteria", arguments: {} })) as any).isError, true);
  // The process did not crash: it still answers.
  const { tools } = await bad.listTools();
  assert.equal(tools.length, 4);
});

// QA-R1 (P1, fixed): the low-level Server does not validate input against the schema, so mcp/server.ts checks
// that title and company are present and non-empty itself.
test("MCP-8 score_job, match_job and explain_score return isError when title or company is missing", async () => {
  for (const name of ["score_job", "match_job", "explain_score"]) {
    for (const args of [{ company: passing.company }, { title: passing.title }, {}, { title: "", company: passing.company }]) {
      const res: any = await client.callTool({ name, arguments: args });
      assert.equal(res.isError, true, `${name} ${JSON.stringify(args)} returns isError`);
      assert.match(res.content[0].text, /title|company/i, `${name} names the missing field`);
    }
  }
});

// PS-R1 (P2): a criteria file that can't be read or parsed is named by basename and line only; no file contents,
// no full path, no YAML snippet in what goes back to Claude.
test("MCP-9 criteria read and parse errors name the file and line, never its contents or full path", async () => {
  const marker = "PRIVATE-MARKER-7f3a";
  const path = join(tmp, "broken.yaml");
  writeFileSync(path, [`note: ${marker}`, "role: [unclosed", "  : : bad", ""].join("\n"));
  const broken = await connect({ ROLE_RADAR_CRITERIA: path });
  for (const [name, args] of [["get_criteria", {}], ["score_job", passing]] as const) {
    const res: any = await broken.callTool({ name, arguments: args as Record<string, unknown> });
    assert.equal(res.isError, true, `${name} with a malformed file returns isError`);
    const text = res.content[0].text;
    assert.match(text, /criteria file could not be parsed \(line \d+\)/, text);
    assert.ok(!text.includes(marker), `no file contents in: ${text}`);
    assert.ok(!text.includes(tmp), `no full path in: ${text}`);
  }
  const missing = join(tmp, "no-such-dir", "criteria.yaml");
  const gone = await connect({ ROLE_RADAR_CRITERIA: missing });
  const res: any = await gone.callTool({ name: "get_criteria", arguments: {} });
  assert.equal(res.isError, true);
  assert.equal(res.content[0].text, "criteria file not found: criteria.yaml");
  const dir = await connect({ ROLE_RADAR_CRITERIA: tmp });
  const dirRes: any = await dir.callTool({ name: "get_criteria", arguments: {} });
  assert.equal(dirRes.isError, true);
  assert.match(dirRes.content[0].text, /^criteria file is not a file: /);
  assert.ok(!dirRes.content[0].text.includes(tmp), "no full path for a directory either");
});

// PS-R2 (P2): criteria must be a YAML mapping; a plain sentence (or list) is refused and not echoed back.
test("MCP-10 a criteria file that is not a YAML mapping returns isError without its contents", async () => {
  const sentence = "This file is only a plain sentence about nothing in particular";
  const path = join(tmp, "sentence.yaml");
  writeFileSync(path, sentence + "\n");
  const plain = await connect({ ROLE_RADAR_CRITERIA: path });
  for (const [name, args] of [["get_criteria", {}], ["score_job", passing]] as const) {
    const res: any = await plain.callTool({ name, arguments: args as Record<string, unknown> });
    assert.equal(res.isError, true, `${name} with a non-mapping file returns isError`);
    assert.equal(res.content[0].text, "criteria file is not a YAML mapping");
  }
});
