/* RR-AGENT PR 3: metrics (AG-25). Demo data only, no network. Written BEFORE the code (red).
 *
 * agent/metrics.ts exports computeMetrics({ trackerPath, logPath }) -> {
 *   rolesFound, draftsReady, applicationsSent, responses, interviews,   // roles that EVER reached found / ready / sent / response / interview
 *   tokens: { input, output }, usd,                                      // sums of llm_call rows in the log
 *   note: string                                                         // "no data" (any case) when the tracker is missing or empty
 * }
 * Counts come only from the tracker file and the log file. It never writes, never calls the network, never guesses.
 */
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { computeMetrics } from "../agent/metrics.ts";
import { createTracker } from "../agent/tracker.ts";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "rr-agent-m-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });
const T = () => join(dir, "tracker.jsonl");
const L = () => join(dir, "run.jsonl");

function seedTracker() {
  const t = createTracker(T());
  const mk = (id: string, ...steps: string[]) => {
    t.upsertRole({ id, title: "Demo PM " + id, company: "Demo Co" });
    for (const s of steps) t.setStatus(id, s, { approved: s === "sent" });
  };
  mk("r1");
  mk("r2", "drafted", "ready");
  mk("r3", "ready", "sent");
  mk("r4", "ready", "sent", "response");
  mk("r5", "ready", "sent", "response", "interview");
  mk("r6", "dropped");
}
function seedLog() {
  const rows = [
    { event: "llm_call", model: "m", input_tokens: 120, output_tokens: 30, usd: 0.25, ok: true },
    { event: "llm_call", model: "m", input_tokens: 80, output_tokens: 20, usd: 0.5, ok: true },
    { event: "tool_call", tool: "scan", ok: true },
    { event: "cap_hit", usd: 9 },
  ];
  writeFileSync(L(), rows.map((r) => JSON.stringify({ runId: "x", ts: "2026-11-23T00:00:00Z", ...r })).join("\n") + "\n");
}

test("AG-25 counts roles found, drafts ready, sent, responses and interviews from the tracker only", () => {
  seedTracker(); seedLog();
  const m: any = computeMetrics({ trackerPath: T(), logPath: L() });
  assert.equal(m.rolesFound, 6);
  assert.equal(m.draftsReady, 4);
  assert.equal(m.applicationsSent, 3);
  assert.equal(m.responses, 2);
  assert.equal(m.interviews, 1);
  assert.ok(!/no data/i.test(m.note ?? ""));
});

test("AG-25 tokens and usd are summed from llm_call rows in the log, other events ignored", () => {
  seedTracker(); seedLog();
  const m: any = computeMetrics({ trackerPath: T(), logPath: L() });
  assert.deepEqual(m.tokens, { input: 200, output: 50 });
  assert.ok(Math.abs(m.usd - 0.75) < 1e-12);
});

test("AG-25 nothing in the tracker or log: zeros and a 'no data' note, never a guess", () => {
  const m: any = computeMetrics({ trackerPath: T(), logPath: L() });
  assert.deepEqual([m.rolesFound, m.draftsReady, m.applicationsSent, m.responses, m.interviews, m.usd], [0, 0, 0, 0, 0, 0]);
  assert.deepEqual(m.tokens, { input: 0, output: 0 });
  assert.match(m.note, /no data/i);
});

test("AG-25 an empty tracker file is also 'no data'; a missing log gives zero tokens, not a crash", () => {
  writeFileSync(T(), "");
  const m: any = computeMetrics({ trackerPath: T(), logPath: L() });
  assert.equal(m.rolesFound, 0);
  assert.match(m.note, /no data/i);
  assert.deepEqual(m.tokens, { input: 0, output: 0 });
});

test("AG-25 metrics only reads: no file is created or changed", () => {
  computeMetrics({ trackerPath: T(), logPath: L() });
  assert.deepEqual(readdirSync(dir), []);
  seedTracker(); seedLog();
  const before = [readFileSync(T(), "utf8"), readFileSync(L(), "utf8")];
  computeMetrics({ trackerPath: T(), logPath: L() });
  assert.deepEqual([readFileSync(T(), "utf8"), readFileSync(L(), "utf8")], before);
});

test("AG-25 metrics source has no network, no llm and no invented numbers path", () => {
  const src = readFileSync(join(REPO, "agent/metrics.ts"), "utf8");
  assert.ok(!/\bfetch\s*\(|node:https?|node:net|anthropicLlm|ANTHROPIC_API_KEY|Math\.random/.test(src));
});
