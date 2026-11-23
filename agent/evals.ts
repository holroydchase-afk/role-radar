// RR-AGENT evals: the agent vs plain Claude on made-up cases, graded blind by Opus. Offline with fakes until Chase runs it with a key.
import { existsSync, readFileSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REPO_ROOT, SONNET_MODEL, OPUS_MODEL } from "./config.ts";
import { CapExceeded, KilledError } from "./harness.ts";
import type { Harness } from "./harness.ts";
import type { Llm } from "./llm.ts";
import { createTracker } from "./tracker.ts";
import { createTools } from "./tools.ts";
import { runAgent } from "./loop.ts";
import yaml from "js-yaml";

export const EVAL_DEFAULT_CAP_USD = 5;

type Grade = { fit: number; groundedness: number; usefulness: number };
type Arm = "agent" | "plain";
type Row = {
  caseId: string; repeat: number; key: { A: Arm; B: Arm };
  grades: { agent: Grade; plain: Grade } | null; outcome: "win" | "tie" | "loss" | "failed_grade";
};
const DIMS = ["fit", "groundedness", "usefulness"] as const;

// Small seeded PRNG so the A/B assignment repeats for the same seed.
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function parseGrade(text: string): { A: Grade; B: Grade } | null {
  let j: any;
  try { j = JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/g, "")); } catch { return null; }
  const one = (g: any): Grade | null => {
    if (!g || typeof g !== "object") return null;
    for (const d of DIMS) if (typeof g[d] !== "number" || !Number.isFinite(g[d]) || g[d] < 0 || g[d] > 5) return null;
    return { fit: g.fit, groundedness: g.groundedness, usefulness: g.usefulness };
  };
  const A = one(j?.A), B = one(j?.B);
  return A && B ? { A, B } : null;
}

const total = (g: Grade) => g.fit + g.groundedness + g.usefulness;

export async function runEval(o: {
  cases: any[]; agentLlm: Llm; plainLlm: Llm; graderLlm: Llm; harness: Harness; repeats?: number; seed?: number;
}) {
  const { harness } = o;
  const repeats = o.repeats ?? 1;
  const rand = mulberry32(o.seed ?? 1);
  const factsPath = process.env.ROLE_RADAR_FACTS || join(REPO_ROOT, "demo/agent/facts.json");
  const criteriaText = readFileSync(join(REPO_ROOT, "criteria.yaml"), "utf8");
  const criteria: any = yaml.load(criteriaText);
  const facts: { id: string; text: string }[] = JSON.parse(readFileSync(factsPath, "utf8")).facts;
  const factLines = facts.map((f) => `- ${f.id}: ${f.text}`).join("\n");

  // Same harness and log, but each call is tagged with the arm that made it.
  const tagged = (arm: string): Harness => {
    const h = Object.create(harness) as Harness;
    h.record = (tokens, model) => harness.record(tokens, model, arm);
    return h;
  };

  const work = mkdtempSync(join(tmpdir(), "rr-eval-"));
  const rows: Row[] = [];
  let stopped: "cap_hit" | "killed" | undefined;

  const callPlain = async (c: any): Promise<string> => {
    harness.checkKill();
    const system = "You help a job seeker decide on one role and draft materials. Use ONLY the facts below; never invent experience. If a role needs something the facts do not show, say so.\n\nFacts:\n" + factLines + "\n\nSearch criteria (YAML):\n" + criteriaText;
    const res = await o.plainLlm.call({ model: SONNET_MODEL, system, messages: [{ role: "user", content: `Role: ${c.title} at ${c.company} (${c.location ?? ""}).\n${c.description}\n\nSay whether this role fits, then draft a short cover letter and a 1 to 3 sentence outreach note.` }], maxTokens: 2000 });
    tagged("plain").record(res.usage, SONNET_MODEL);
    return res.text;
  };

  const callAgent = async (c: any, n: number): Promise<string | null> => {
    const dir = join(work, `${c.id}-${n}`);
    mkdirSync(dir, { recursive: true });
    const jobsPath = join(dir, "jobs.json");
    writeFileSync(jobsPath, JSON.stringify({ jobs: { [c.id]: { company: c.company, title: c.title, location: c.location, description: c.description } } }));
    const h = tagged("agent");
    const tools = createTools({ llm: o.agentLlm, harness: h, tracker: createTracker(join(dir, "tracker.jsonl")), criteria, jobsPath, factsPath });
    const goal = `Look at role ${c.id} (${c.title} at ${c.company}). Score it, and if it is worth pursuing draft a tailored resume, cover letter and a short outreach, and track it as drafted. Finish with a summary: does it fit, the drafts, and any gaps.`;
    const r = await runAgent({ llm: o.agentLlm, harness: h, tools, goal });
    if (r.stopReason === "killed" || r.stopReason === "cap_hit") { stopped = r.stopReason === "killed" ? "killed" : "cap_hit"; return null; }
    return r.finalText;
  };

  const grade = async (c: any, A: string, B: string): Promise<{ A: Grade; B: Grade } | null> => {
    const system = "You are a careful hiring coach. Two candidate answers (A and B) respond to the same request. Score each 0 to 5 on three things: fit (does its judgement of the role agree with the reference), groundedness (no claim outside the facts), usefulness (could the candidate use it as written). Reply with JSON only: {\"A\":{\"fit\":n,\"groundedness\":n,\"usefulness\":n},\"B\":{...}}.";
    const user = `Facts about the candidate:\n${factLines}\n\nRole: ${c.title} at ${c.company}.\n${c.description}\nReference: this is a ${c.label} fit. ${c.reason}\n\nAnswer A:\n${A}\n\nAnswer B:\n${B}`;
    for (let attempt = 0; attempt < 2; attempt++) {
      harness.checkKill();
      const res = await o.graderLlm.call({ model: OPUS_MODEL, system, messages: [{ role: "user", content: user }], maxTokens: 500 });
      tagged("grader").record(res.usage, OPUS_MODEL);
      const g = parseGrade(res.text);
      if (g) return g;
    }
    return null;
  };

  try {
    outer: for (const c of o.cases) {
      for (let n = 0; n < repeats; n++) {
        try {
          const agentOut = await callAgent(c, n);
          if (agentOut === null) break outer;
          const plainOut = await callPlain(c);
          const agentIsA = rand() < 0.5;
          const key = agentIsA ? { A: "agent" as Arm, B: "plain" as Arm } : { A: "plain" as Arm, B: "agent" as Arm };
          const g = await grade(c, agentIsA ? agentOut : plainOut, agentIsA ? plainOut : agentOut);
          if (!g) {
            harness.log({ event: "failed_grade", caseId: c.id, repeat: n });
            rows.push({ caseId: c.id, repeat: n, key, grades: null, outcome: "failed_grade" });
            continue;
          }
          const grades = { agent: agentIsA ? g.A : g.B, plain: agentIsA ? g.B : g.A };
          const d = total(grades.agent) - total(grades.plain);
          rows.push({ caseId: c.id, repeat: n, key, grades, outcome: d > 0 ? "win" : d < 0 ? "loss" : "tie" });
        } catch (e) {
          if (e instanceof CapExceeded) { stopped = "cap_hit"; break outer; }
          if (e instanceof KilledError) { stopped = "killed"; break outer; }
          throw e;
        }
      }
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }

  const graded = rows.filter((r) => r.grades);
  const count = (k: Row["outcome"]) => rows.filter((r) => r.outcome === k).length;
  const mean = (arm: Arm): Grade => {
    const m = (d: (typeof DIMS)[number]) => (graded.length ? graded.reduce((s, r) => s + r.grades![arm][d], 0) / graded.length : 0);
    return { fit: m("fit"), groundedness: m("groundedness"), usefulness: m("usefulness") };
  };
  // labelAccuracy is the share of graded rows where the arm's fit score is >= 3 (qa-tdd's definition).
  const acc = (arm: Arm) => (graded.length ? graded.filter((r) => r.grades![arm].fit >= 3).length / graded.length : 0);

  // Tokens and usd per arm are summed from this run's llm_call log rows, not from memory.
  const arms: Record<string, { tokens: number; usd: number }> = { agent: { tokens: 0, usd: 0 }, plain: { tokens: 0, usd: 0 }, grader: { tokens: 0, usd: 0 } };
  for (const line of existsSync(harness.logPath) ? readFileSync(harness.logPath, "utf8").split("\n") : []) {
    if (!line) continue;
    let r: any;
    try { r = JSON.parse(line); } catch { continue; }
    if (r.runId !== harness.runId || r.event !== "llm_call" || !arms[r.arm]) continue;
    arms[r.arm].tokens += (r.input_tokens ?? 0) + (r.output_tokens ?? 0);
    arms[r.arm].usd += r.usd ?? 0;
  }

  return {
    ...(stopped ? { stopped } : {}),
    models: { agent: SONNET_MODEL, plain: SONNET_MODEL, grader: OPUS_MODEL },
    rows,
    report: {
      wins: count("win"), ties: count("tie"), losses: count("loss"), failedGrades: count("failed_grade"),
      winRate: graded.length ? count("win") / graded.length : 0,
      mean: { agent: mean("agent"), plain: mean("plain") },
      labelAccuracy: { agent: acc("agent"), plain: acc("plain") },
      arms,
    },
  };
}
