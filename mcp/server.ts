/* Role Radar MCP server: score any job against criteria.yaml from Claude (GitHub issue #59).
 * A local stdio server: no network, no port. Claude Code starts it with `node mcp/server.ts` (Node 22.18+ strips types).
 * Scoring is src/scoring.ts as is; this file only maps tool input to a Job and the results to JSON text.
 *
 *   score_job      → { score, parts, reasons, match }  the 0–100 score, its parts and why
 *   match_job      → { ok, reasons }                   the hard gates (title, location, excludes, hard red flags)
 *   explain_score  → { score, explanation }            the one-line breakdown the page shows
 *   get_criteria   → criteria.yaml, as loaded
 *
 * Criteria come from env ROLE_RADAR_CRITERIA when set, else the repo's criteria.yaml (next to this file, not the cwd).
 * The file is read on every call, so edits apply without a restart. tests/mcp-server.test.ts pins the contract down. */
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { matchJob, scoreJob, explain } from "../src/scoring.ts";
import type { Criteria, Job } from "../src/scoring.ts";

const DEFAULT_CRITERIA = fileURLToPath(new URL("../criteria.yaml", import.meta.url));

/** The criteria file in use: ROLE_RADAR_CRITERIA wins, else the repo's criteria.yaml. */
const criteriaPath = (): string => process.env.ROLE_RADAR_CRITERIA || DEFAULT_CRITERIA;

/** criteria.yaml, parsed. Errors name the file and line only: nothing from inside the file goes back to Claude. */
function loadCriteria(): Criteria {
  const path = criteriaPath();
  let source: string;
  try { source = readFileSync(path, "utf8"); } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    throw new Error(code === "EISDIR" ? `criteria file is not a file: ${basename(path)}` : `criteria file not found: ${basename(path)}`);
  }
  let spec: unknown;
  try { spec = yaml.load(source); } catch (err) {
    const line = (err as { mark?: { line?: number } }).mark?.line;
    throw new Error(typeof line === "number" ? `criteria file could not be parsed (line ${line + 1})` : "criteria file could not be parsed");
  }
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) throw new Error("criteria file is not a YAML mapping");
  return spec as Criteria;
}

/** What score_job, match_job and explain_score take. */
interface JobInput {
  title: string; company: string; location?: string; comp?: string;
  description?: string; companyStage?: string; fit?: string; sector?: string;
}

const text = (description: string) => ({ type: "string", description });
const JOB_SCHEMA = {
  type: "object",
  properties: {
    title: text("Job title, e.g. Senior Product Manager"),
    company: text("Company name"),
    location: text("Where the job is, e.g. Remote (US) or Hybrid, Seattle"),
    comp: text("Pay range as posted, e.g. $170K–$205K"),
    description: text("The posting text, or the parts that matter"),
    companyStage: text("startup, growth or public; startup takes the startup penalty"),
    fit: text("How well your experience fits: strong, maybe or stretch"),
    sector: text("Sector label or id; guessed from the company and text if left out"),
  },
  required: ["title", "company"],
};

const TOOLS = [
  { name: "score_job", description: "Score a job 0-100 against your criteria and say what moved the score.", inputSchema: JOB_SCHEMA },
  { name: "match_job", description: "Check a job against your hard rules (title, location, excluded companies, red flags) and say which one it fails.", inputSchema: JOB_SCHEMA },
  { name: "explain_score", description: "Give a job's score with a one-line breakdown of its parts.", inputSchema: JOB_SCHEMA },
  { name: "get_criteria", description: "Show the criteria jobs are scored against.", inputSchema: { type: "object", properties: {} } },
];

/** Tool input → Job: description becomes postingText, the rest keep their names. Absent fields stay absent. */
function toJob(input: Partial<JobInput>): Job {
  const job: Job = { title: input.title, company: input.company };
  for (const k of ["location", "comp", "companyStage", "fit", "sector"] as const) if (input[k] !== undefined) job[k] = input[k];
  if (input.description !== undefined) job.postingText = input.description;
  return job;
}

/** score_job: the score, its parts, and plain lines on what moved it (including any hard gate it fails). */
function scoreReport(job: Job, spec: Criteria) {
  const result = scoreJob(job, spec), match = matchJob(job, spec);
  const reasons = [`Score ${result.score}: ${explain(result)}`];
  reasons.push(`Sector: ${result.sector.label || result.sector.id}`);
  if (result.culture.good.length) reasons.push(`Good culture signals: ${result.culture.good.join(", ")}`);
  if (result.culture.red.length) reasons.push(`Culture red flags: ${result.culture.red.join(", ")}`);
  if (result.valuesHit) reasons.push(`Values penalty: ${result.valuesHit}`);
  if (result.dream) reasons.push(`Dream role: ${result.dream.why}`);
  for (const r of match.reasons) reasons.push(`Fails a hard rule: ${r}`);
  return { score: result.score, parts: result.parts, reasons, match };
}

function runTool(name: string, args: Partial<JobInput>): unknown {
  if (!TOOLS.some((t) => t.name === name)) throw new Error(`Unknown tool: ${name}`);
  // The SDK's low-level Server does not check input against the schema, so the two required fields are checked here.
  if (name !== "get_criteria") for (const k of ["title", "company"] as const) {
    if (typeof args[k] !== "string" || !args[k].trim()) throw new Error(`${k} is required`);
  }
  const spec = loadCriteria();
  if (name === "get_criteria") return spec;
  const job = toJob(args);
  if (name === "score_job") return scoreReport(job, spec);
  if (name === "match_job") return matchJob(job, spec);
  if (name === "explain_score") { const result = scoreJob(job, spec); return { score: result.score, explanation: explain(result) }; }
  throw new Error(`Unknown tool: ${name}`);
}

const server = new Server({ name: "role-radar", version: "0.1.0" }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
server.setRequestHandler(CallToolRequestSchema, async (req) => {
  try {
    const out = runTool(req.params.name, (req.params.arguments || {}) as Partial<JobInput>);
    return { content: [{ type: "text", text: JSON.stringify(out) }] };
  } catch (err) {
    return { isError: true, content: [{ type: "text", text: (err as Error).message }] };
  }
});
await server.connect(new StdioServerTransport());
