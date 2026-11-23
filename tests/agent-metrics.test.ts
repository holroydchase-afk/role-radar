/* RR-AGENT v2 metrics (AGV2-13). Demo data only, no network. Written BEFORE the code (red).
 *
 * node agent/run.ts metrics   (ROLE_RADAR_TRACKER required; ROLE_RADAR_RUNS = dir of run logs, default docs/runs in the repo)
 *   prints "roles found: N", "drafts: N", "sent: N", "responses: N", "interviews: N" counted from the tracker only
 *   (each = roles that EVER reached found / drafted / sent / response / interview), then "tokens: N" and "cost: ..." read ONLY from
 *   *-job-hunt.md run logs that carry `stamped: yes` (written by stamp-run), else "tokens: not measured" / "cost: not measured".
 *   cost is shown only when a stamped log has stamp_prices, as the stamped number with no currency sign; stamp_cost: not measured stays "not measured".
 *   No tracker file: all zeros and the words "no data". Read-only: writes nothing.
 * Deleted from v1 (why): token and usd sums from a harness llm_call log (the harness and its log are gone), the log-path argument,
 * and the hand-computed spend line (no dollar figure is ever computed here, AGV2-14).
 */
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createTracker } from "../agent/tracker.ts";
import { sandbox, run, type Sandbox } from "./agent-support.ts";

let sb: Sandbox;
beforeEach(() => { sb = sandbox(); });
afterEach(() => rmSync(sb.dir, { recursive: true, force: true }));

function seedTracker() {
  const t = createTracker(sb.tracker);
  const mk = (id: string, ...steps: string[]) => {
    t.upsertRole({ id, title: "Demo PM " + id, company: "Demo Co" });
    for (const s of steps) t.setStatus(id, s, s === "sent" ? ({ approvedBy: "cli" } as any) : undefined);
  };
  mk("r1");
  mk("r2", "drafted");
  mk("r3", "drafted", "sent");
  mk("r4", "drafted", "sent", "response");
  mk("r5", "drafted", "sent", "response", "interview");
  mk("r6", "dropped");
}

const log = (stamp: string[], over: Record<string, string> = {}) => {
  const base: Record<string, string> = { date: "2026-11-20", agent: "engineer", product: "role-radar", tier: "supervised", model: "claude-sonnet-5-5",
    tokens: "1000", cost_usd: "0", input: "demo job-hunt run", verdict: "ok", findings: "0", p0: "0", escalated: "no", ...over };
  return "# Demo job-hunt run (made up)\n\n```agentrun\n" + [...Object.entries(base).map(([k, v]) => `${k}: ${v}`), ...stamp].join("\n") + "\n```\n";
};
const STAMPED = (i: number, o: number, extra: string[] = ["stamp_cost: not measured"]) =>
  ["stamped: yes", `stamp_input: ${i}`, `stamp_output: ${o}`, "stamp_cache_creation: 0", "stamp_cache_read: 0", "stamp_sha: " + "a".repeat(40), ...extra];

test("AGV2-13 counts roles found, drafts, sent, responses and interviews from the tracker only", () => {
  seedTracker();
  const r = run(sb, ["metrics"]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /roles found\D+6\b/i);
  assert.match(r.out, /drafts\D+4\b/i);
  assert.match(r.out, /sent\D+3\b/i);
  assert.match(r.out, /responses\D+2\b/i);
  assert.match(r.out, /interviews\D+1\b/i);
  assert.doesNotMatch(r.out, /no data/i);
  assert.equal(r.net, false);
});

test("AGV2-13 no stamped run log: tokens and cost read 'not measured', never a number", () => {
  seedTracker();
  const r = run(sb, ["metrics"]);
  assert.match(r.out, /tokens\W+not measured/i);
  assert.match(r.out, /cost\W+not measured/i);
});

test("AGV2-13 tokens are summed from stamped *-job-hunt.md logs only; unstamped logs and other files are ignored", () => {
  seedTracker();
  writeFileSync(join(sb.runs, "2026-11-20-job-hunt.md"), log(STAMPED(700, 300)));
  writeFileSync(join(sb.runs, "2026-11-21-job-hunt.md"), log(STAMPED(2000, 500), { date: "2026-11-21", tokens: "2500" }));
  writeFileSync(join(sb.runs, "2026-11-22-job-hunt.md"), log([], { date: "2026-11-22", tokens: "999999" })); // self-reported, not stamped
  writeFileSync(join(sb.runs, "2026-11-22-qa-tdd.md"), log(STAMPED(50000, 50000), { date: "2026-11-22", agent: "qa-tdd", verdict: "green" }));
  const r = run(sb, ["metrics"]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /tokens\W+3,?500\b/i, r.out);
  assert.doesNotMatch(r.out, /999999|100000|100,000/);
  assert.match(r.out, /cost\W+not measured/i, "stamp_cost: not measured stays not measured");
});

test("AGV2-13 a priced stamp shows its cost as the stamped number, with no currency sign and no 'usd'", () => {
  seedTracker();
  writeFileSync(join(sb.runs, "2026-11-20-job-hunt.md"), log(STAMPED(1000, 0, ["stamp_prices: vendor-table 2026-11-20"]), { cost_usd: "0.0123" }));
  const r = run(sb, ["metrics"]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /cost\W+0\.0123/i, r.out);
  assert.doesNotMatch(r.out, /\$|usd|dollar/i);
});

test("AGV2-13 no tracker: zeros and 'no data', exit 0, tokens and cost 'not measured'", () => {
  const r = run(sb, ["metrics"]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /no data/i);
  for (const w of ["roles found", "drafts", "sent", "responses", "interviews"]) assert.match(r.out, new RegExp(`${w}\\D+0\\b`, "i"), w);
  assert.match(r.out, /tokens\W+not measured/i);
});

test("AGV2-13 an empty tracker file is also 'no data'", () => {
  writeFileSync(sb.tracker, "");
  assert.match(run(sb, ["metrics"]).out, /no data/i);
});

test("AGV2-13 metrics only reads: no file is created or changed next to the tracker or the run logs", () => {
  seedTracker();
  writeFileSync(join(sb.runs, "2026-11-20-job-hunt.md"), log(STAMPED(1, 1)));
  const snap = () => [...readdirSync(join(sb.dir, "state")), ...readdirSync(sb.runs)].sort().join(",") + readFileSync(sb.tracker, "utf8");
  const before = snap();
  run(sb, ["metrics"]);
  assert.equal(snap(), before);
});

test("AGV2-13 metrics source has no network, no model call, no random numbers and no harness log", () => {
  const src = readFileSync(join(import.meta.dirname, "../agent/metrics.ts"), "utf8");
  assert.ok(!/\bfetch\s*\(|node:https?|node:net|anthropicLlm|ANTHROPIC_API_KEY|Math\.random|llm_call|harness|logPath/.test(src));
});
