// RR-AGENT CLI: node agent/run.ts <scan-and-draft | eval | metrics | approve <roleId>>
// The approval flag for "sent" is set here, in `approve`, and nowhere else. The model never gets a path to it.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";
import { PRICES, REPO_ROOT } from "./config.ts";
import { createHarness } from "./harness.ts";
import { anthropicLlm } from "./llm.ts";
import { createTracker } from "./tracker.ts";
import { createTools } from "./tools.ts";
import { runAgent } from "./loop.ts";
import { runEval, EVAL_DEFAULT_CAP_USD } from "./evals.ts";
import { computeMetrics } from "./metrics.ts";

const USAGE = `Usage: node agent/run.ts <command>

  scan-and-draft    scan the jobs file, score, draft, track (drafts only; needs ANTHROPIC_API_KEY)
  eval              agent vs plain Claude on demo/agent/cases.json, graded blind (needs ANTHROPIC_API_KEY)
  metrics           counts and spend from the tracker and the run log (no key)
  approve <roleId>  mark one role as sent after you reviewed the draft (no key)

Env: ROLE_RADAR_FACTS, ROLE_RADAR_TRACKER, ROLE_RADAR_AGENT_LOG, ROLE_RADAR_JOBS, ROLE_RADAR_AGENT_MAX_USD (optional).`;

class UserError extends Error {}
const env = (name: string): string => {
  const v = process.env[name];
  if (!v) throw new UserError(`${name} is not set: see node agent/run.ts --help`);
  return v;
};
const needKey = () => {
  if (!process.env.ANTHROPIC_API_KEY) throw new UserError("ANTHROPIC_API_KEY is not set: this command calls the model and needs it.");
};
const capUsd = (fallback: number) => {
  const raw = process.env.ROLE_RADAR_AGENT_MAX_USD;
  const n = raw === undefined ? fallback : Number(raw);
  if (!Number.isFinite(n) || n <= 0) throw new UserError("ROLE_RADAR_AGENT_MAX_USD must be a positive number");
  return n;
};

async function main(argv: string[]): Promise<number> {
  const [cmd, arg] = argv;
  if (cmd === "--help" || cmd === "-h" || cmd === "help") { console.log(USAGE); return 0; }

  if (cmd === "metrics") {
    const m = computeMetrics({ trackerPath: env("ROLE_RADAR_TRACKER"), logPath: env("ROLE_RADAR_AGENT_LOG") });
    if (m.note) console.log(m.note);
    console.log(`roles found: ${m.rolesFound}\ndrafts ready: ${m.draftsReady}\napplications sent: ${m.applicationsSent}\nresponses: ${m.responses}\ninterviews: ${m.interviews}`);
    console.log(`tokens: ${m.tokens.input} in, ${m.tokens.output} out\nspend: $${m.usd.toFixed(4)} (estimate from the price table)`);
    return 0;
  }

  if (cmd === "approve") {
    if (!arg) throw new UserError("approve needs a role id: node agent/run.ts approve <roleId>");
    const tracker = createTracker(env("ROLE_RADAR_TRACKER"));
    tracker.get(arg); // throws "unknown role" before anything is written
    tracker.setStatus(arg, "sent", { approved: true });
    console.log(`${arg} is now marked sent. Nothing was sent for you: send it yourself.`);
    return 0;
  }

  if (cmd === "scan-and-draft") {
    needKey();
    const harness = createHarness({ logPath: process.env.ROLE_RADAR_AGENT_LOG, capUsd: capUsd(1), prices: PRICES });
    const llm = anthropicLlm();
    const tracker = createTracker(env("ROLE_RADAR_TRACKER"));
    const criteria: any = yaml.load(readFileSync(join(REPO_ROOT, "criteria.yaml"), "utf8"));
    const tools = createTools({ llm, harness, tracker, criteria, jobsPath: env("ROLE_RADAR_JOBS"), factsPath: env("ROLE_RADAR_FACTS") });
    const goal = "Scan the roles, score each, and for the best few draft a tailored resume, cover letter and short outreach. Track each as drafted. Finish with a short summary.";
    const r = await runAgent({ llm, harness, tools, goal });
    console.log(r.finalText || `stopped: ${r.stopReason}`);
    return r.exitCode;
  }

  if (cmd === "eval") {
    needKey();
    const harness = createHarness({ logPath: process.env.ROLE_RADAR_AGENT_LOG, capUsd: capUsd(EVAL_DEFAULT_CAP_USD), prices: PRICES });
    const llm = anthropicLlm();
    const cases = JSON.parse(readFileSync(join(REPO_ROOT, "demo/agent/cases.json"), "utf8")).cases;
    const res = await runEval({ cases, agentLlm: llm, plainLlm: llm, graderLlm: llm, harness, repeats: 1, seed: Date.now() });
    console.log(JSON.stringify({ stopped: res.stopped, models: res.models, report: res.report }, null, 2));
    return res.stopped ? 3 : 0;
  }

  console.error(`unknown command: ${cmd ?? "(none)"}\n${USAGE}`);
  return 2;
}

main(process.argv.slice(2)).then(
  (code) => { process.exitCode = code; },
  (e) => {
    console.error(e instanceof Error ? e.message.split("\n")[0] : String(e));
    process.exitCode = e?.exitCode && e.exitCode > 0 ? e.exitCode : 1;
  },
);
