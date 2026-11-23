// RR-AGENT CLI: node agent/run.ts <scan | score | tailor-submit | outreach-submit | track | metrics> (model) and <begin | status | approve> (human, terminal only).
// The model is a Claude Code subagent that runs these commands. Nothing here calls a model or the network.
// The approval marker for "sent" is set in `approve`, and nowhere else. The model never gets a path to it.
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import yaml from "js-yaml";
import { REPO_ROOT, assertOutsideRepo } from "./config.ts";
import { createTracker } from "./tracker.ts";
import { createTools } from "./tools.ts";
import { computeMetrics } from "./metrics.ts";

const USAGE = `Usage: node agent/run.ts <command> [--demo]

  scan                      list roles from the jobs file (stops at the max roles per run)
  score <id>                score one role against criteria.yaml, with the explanation
  tailor-submit <id>        save a resume draft (JSON on stdin: {claims:[{text,fact_ids}], gaps, text})
  outreach-submit <id>      save a 1 to 3 sentence outreach draft (same JSON on stdin)
  track <id> <found|drafted|dropped>   record a status
  metrics                   counts from the tracker; tokens and cost from stamped run logs

Human only, from a terminal: starting a run, approving a draft and setting later statuses are not model commands and refuse without a terminal.
--demo (scan and score only) reads demo/seed.json instead of ROLE_RADAR_JOBS.
Env: ROLE_RADAR_FACTS, ROLE_RADAR_TRACKER, ROLE_RADAR_JOBS, ROLE_RADAR_RUNS, ROLE_RADAR_MAX_ROLES (5), ROLE_RADAR_MAX_STEPS (30).`;

class UserError extends Error {}
const env = (name: string): string => {
  const v = process.env[name];
  if (!v) throw new UserError(`${name} is not set: see node agent/run.ts --help`);
  return v;
};
const limitFrom = (name: string, fallback: number): number => {
  const raw = process.env[name];
  const n = raw === undefined || raw === "" ? fallback : Number(raw);
  if (!Number.isInteger(n) || n < 1) throw new UserError(`${name} must be a whole number of 1 or more`);
  return n;
};

type State = { steps: number; roles: string[] };
const stateFile = (trackerPath: string) => join(dirname(trackerPath), "run-state.json");
/** Fails closed: a missing or unreadable state file means no run was started by a human, so the model gets nothing. */
const readState = (file: string): State => {
  if (!existsSync(file)) throw new UserError("run-state.json is missing: a human must start the run with `begin` from a terminal");
  let s: any;
  try { s = JSON.parse(readFileSync(file, "utf8")); } catch { s = undefined; }
  if (s === null || typeof s !== "object" || Array.isArray(s) || !Number.isInteger(s.steps) || s.steps < 0
    || !Array.isArray(s.roles) || s.roles.some((r: unknown) => typeof r !== "string")) {
    throw new UserError("run-state.json is corrupt or unreadable: a human must restart the run with `begin` from a terminal");
  }
  return { steps: s.steps, roles: s.roles };
};
const writeState = (file: string, s: State) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, JSON.stringify(s) + "\n"); };

/** Kill switch through the studio guard. While `job-hunt` is not in the guard's agent list (it exits 2 "unknown agent"), check the same two files here. */
function checkKill() {
  const g = spawnSync(process.execPath, [join(REPO_ROOT, "scripts/agent-guard.mjs"), "kill", "job-hunt", "--root", REPO_ROOT], { encoding: "utf8" });
  if (g.status === 0) return;
  if (g.status === 1) throw new UserError(`killed: ${(g.stderr || "kill switch is on").trim().split("\n")[0]}`);
  if (/unknown agent/.test(g.stderr ?? "")) {
    for (const f of ["agents.off", "job-hunt.off"]) {
      if (existsSync(join(REPO_ROOT, ".claude", f))) throw new UserError(`killed: kill switch .claude/${f} is on (delete the file to resume)`);
    }
    return;
  }
  throw new UserError(`the kill-switch check failed: ${(g.stderr || "no output").trim().split("\n")[0]}`);
}

const MODEL_STATUS_WORDS = "found, drafted or dropped";

const needTerminal = (cmd: string, io: { isTTY: boolean }) => {
  if (io.isTTY !== true) throw new UserError(`${cmd} is human-only and needs a terminal: run it yourself, not through the agent`);
};

export async function main(argv: string[], io: { isTTY: boolean }): Promise<number> {
  const demo = argv.includes("--demo");
  const args = argv.filter((a) => a !== "--demo");
  const [cmd, arg, arg2] = args;
  if (cmd === "--help" || cmd === "-h" || cmd === "help") { console.log(USAGE); return 0; }

  const print = (v: unknown) => console.log(JSON.stringify(v, null, 2));
  const trackerPath = () => assertOutsideRepo(env("ROLE_RADAR_TRACKER"), "ROLE_RADAR_TRACKER");

  if (cmd === "metrics") {
    checkKill();
    const m = computeMetrics({ trackerPath: trackerPath(), runsDir: process.env.ROLE_RADAR_RUNS || join(REPO_ROOT, "docs/runs") });
    if (m.note) console.log(m.note);
    console.log(`roles found: ${m.rolesFound}\ndrafts: ${m.drafts}\nsent: ${m.sent}\nresponses: ${m.responses}\ninterviews: ${m.interviews}`);
    const tokensShown = m.tokens ?? "not measured";
    const figure = m.cost ?? "not measured";
    console.log(`tokens: ${tokensShown}\ncost: ${figure}`);
    return 0;
  }

  if (cmd === "approve") {
    needTerminal(cmd, io);
    if (!arg) throw new UserError("approve needs a role id: node agent/run.ts approve <roleId>");
    const tracker = createTracker(trackerPath());
    const role = tracker.get(arg); // throws "unknown role" before anything is written
    if (role.drafts.length === 0) throw new UserError(`${arg} has no saved draft: nothing to approve`);
    tracker.setStatus(arg, "sent", { approvedBy: "cli" });
    console.log(`${arg} is now marked sent. Nothing was sent for you: send it yourself.`);
    return 0;
  }

  if (cmd === "status") {
    needTerminal(cmd, io);
    const allowed = ["ready", "response", "interview", "rejected"];
    if (!arg || !arg2 || !allowed.includes(arg2)) throw new UserError(`status needs a role id and one of ${allowed.join(", ")}: node agent/run.ts status <roleId> <status> (use approve for sent)`);
    const tracker = createTracker(trackerPath());
    tracker.get(arg); // throws "unknown role" before anything is written
    tracker.setStatus(arg, arg2);
    console.log(`${arg} is now ${arg2}.`);
    return 0;
  }

  if (cmd === "begin") {
    needTerminal(cmd, io);
    const tp = trackerPath();
    checkKill();
    writeState(stateFile(tp), { steps: 0, roles: [] });
    print({ ok: true, maxRoles: limitFrom("ROLE_RADAR_MAX_ROLES", 5), maxSteps: limitFrom("ROLE_RADAR_MAX_STEPS", 30) });
    return 0;
  }

  const MODEL = ["scan", "score", "tailor-submit", "outreach-submit", "track"];
  if (!cmd || !MODEL.includes(cmd)) throw new UserError(`unknown command: ${cmd ?? "(none)"} (try --help)`);

  checkKill(); // every model command, not only begin
  // Check every variable before anything is written.
  const tp = trackerPath();
  const useDemo = demo && (cmd === "scan" || cmd === "score");
  const jobsPath = useDemo ? join(REPO_ROOT, "demo/seed.json") : env("ROLE_RADAR_JOBS");
  const needsFacts = cmd === "tailor-submit" || cmd === "outreach-submit";
  const factsPath = needsFacts ? env("ROLE_RADAR_FACTS") : join(REPO_ROOT, "demo/agent/facts.json");
  const maxRoles = limitFrom("ROLE_RADAR_MAX_ROLES", 5);
  const maxSteps = limitFrom("ROLE_RADAR_MAX_STEPS", 30);
  const criteria: any = yaml.load(readFileSync(join(REPO_ROOT, "criteria.yaml"), "utf8"));
  const tools = createTools({ tracker: createTracker(tp), trackerPath: tp, criteria, jobsPath, factsPath, maxRoles });

  const sf = stateFile(tp);
  const state = readState(sf); // fails closed when missing or corrupt
  if (state.steps >= maxSteps) throw new UserError(`limit: ${maxSteps} steps reached for this run (node agent/run.ts begin starts a new run)`);
  state.steps += 1;
  writeState(sf, state);

  const onRole = (id: string | undefined) => {
    tools.requireRole(id);
    if (!state.roles.includes(id as string)) {
      if (state.roles.length >= maxRoles) throw new UserError(`limit: ${maxRoles} roles reached for this run (node agent/run.ts begin starts a new run)`);
      state.roles.push(id as string);
      writeState(sf, state);
    }
  };
  const stdin = () => { try { return readFileSync(0, "utf8"); } catch { return ""; } };

  if (cmd === "scan") { print(tools.scan()); return 0; }
  if (!arg) throw new UserError(`${cmd} needs a role id: node agent/run.ts ${cmd} <roleId>`);
  if (cmd === "track") {
    if (!arg2) throw new UserError(`track needs a status (${MODEL_STATUS_WORDS}): node agent/run.ts track <roleId> <status>`);
    tools.checkStatus(arg, arg2); // refuses bad and human-only statuses first
    onRole(arg); // then the role limit, before anything is written
    print(tools.track(arg, arg2));
    return 0;
  }
  onRole(arg);
  if (cmd === "score") print(tools.score(arg));
  else if (cmd === "tailor-submit") print(tools.tailorSubmit(arg, stdin()));
  else print(tools.outreachSubmit(arg, stdin()));
  return 0;
}

const isEntry = process.argv[1] !== undefined && (() => { try { return pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url; } catch { return false; } })();
if (isEntry) {
  main(process.argv.slice(2), { isTTY: Boolean(process.stdin.isTTY && process.stdout.isTTY) }).then(
    (code) => { process.exitCode = code; },
    (e) => {
      console.error(e instanceof Error ? e.message.split("\n")[0] : String(e));
      process.exitCode = 1;
    },
  );
}
