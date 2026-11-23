/* RR-AGENT PR 1: harness contract (AG-1..AG-4). Spec: docs/product/SPEC-AGENT.md. Demo and made-up data only. No network.
 *
 * Module agent/harness.ts exports:
 *   createHarness({ logPath, killPath?, capUsd, prices }) -> harness
 *     - logPath missing/empty: throws an Error whose message names ROLE_RADAR_AGENT_LOG; writes nothing.
 *     - logPath inside the repo tree: throws (real logs live outside the repo).
 *     - killPath defaults to <dirname(logPath)>/KILL.
 *     - prices: { [modelId]: { inputPerMTok: usd, outputPerMTok: usd } }
 *   harness.runId: string, harness.spentUsd: number (sum of recorded usd)
 *   harness.log(fields): appends ONE JSON line { runId, ts (ISO), ...fields } to logPath (creates the directory).
 *   harness.record({input, output}, model): usd = input*inputPerMTok/1e6 + output*outputPerMTok/1e6, appends one line
 *       { event: "llm_call", model, input_tokens, output_tokens, usd, ok: true }, returns usd.
 *       Unknown model: throws naming the model (never guess a price). When spent would exceed capUsd: logs
 *       { event: "cap_hit" } and throws CapExceeded; every later record() also throws CapExceeded.
 *   harness.checkKill(): if killPath exists or env ROLE_RADAR_AGENT_KILL === "1": logs { event: "killed" }, throws KilledError.
 *   CapExceeded and KilledError are exported classes (extend Error) with a numeric non-zero `exitCode` (the CLI exits with it).
 */
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { createHarness, CapExceeded, KilledError } from "../agent/harness.ts";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const PRICES = { "m-test": { inputPerMTok: 3, outputPerMTok: 15 } };
let dir: string;

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "rr-agent-h-")); delete process.env.ROLE_RADAR_AGENT_KILL; });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); delete process.env.ROLE_RADAR_AGENT_KILL; });

const lines = (p: string) => readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const mk = (over: Record<string, unknown> = {}) =>
  createHarness({ logPath: join(dir, "run.jsonl"), capUsd: 1, prices: PRICES, ...over } as any);

test("AG-1 record writes one JSONL line with the exact token counts and usd from the price table", () => {
  const h = mk();
  const usd = h.record({ input: 120, output: 30 }, "m-test");
  const rows = lines(join(dir, "run.jsonl"));
  assert.equal(rows.length, 1);
  const r = rows[0];
  assert.equal(r.input_tokens, 120);
  assert.equal(r.output_tokens, 30);
  assert.equal(r.model, "m-test");
  assert.equal(r.event, "llm_call");
  assert.equal(r.runId, h.runId);
  assert.ok(!Number.isNaN(Date.parse(r.ts)), "ts is an ISO time");
  const want = (120 * 3 + 30 * 15) / 1e6; // 0.00081
  assert.ok(Math.abs(r.usd - want) < 1e-12, `usd ${r.usd} vs ${want}`);
  assert.ok(Math.abs(usd - want) < 1e-12);
  assert.ok(Math.abs(h.spentUsd - want) < 1e-12);
});

test("AG-1 record of an unpriced model throws and names the model (no guessed price)", () => {
  const h = mk();
  assert.throws(() => h.record({ input: 1, output: 1 }, "m-unknown"), /m-unknown/);
});

test("AG-1 log() appends one line per event, keeps earlier lines and adds runId and ts", () => {
  const h = mk({ logPath: join(dir, "nested", "deeper", "run.jsonl") });
  h.log({ event: "tool_call", tool: "scan", ok: true });
  h.log({ event: "tool_call", tool: "score", ok: false });
  const rows = lines(join(dir, "nested", "deeper", "run.jsonl"));
  assert.deepEqual(rows.map((r) => r.tool), ["scan", "score"]);
  assert.ok(rows.every((r) => r.runId === h.runId && !Number.isNaN(Date.parse(r.ts))));
});

test("AG-2 no log path: fails naming ROLE_RADAR_AGENT_LOG and writes nothing inside the repo", () => {
  const before = { root: readdirSync(REPO).sort(), agent: existsSync(join(REPO, "agent")) ? readdirSync(join(REPO, "agent")).sort() : [] };
  for (const bad of [undefined, "", null]) {
    assert.throws(() => createHarness({ logPath: bad, capUsd: 1, prices: PRICES } as any), /ROLE_RADAR_AGENT_LOG/);
  }
  const after = { root: readdirSync(REPO).sort(), agent: existsSync(join(REPO, "agent")) ? readdirSync(join(REPO, "agent")).sort() : [] };
  assert.deepEqual(after, before, "repo tree unchanged");
});

test("AG-2 a log path inside the repo tree is refused", () => {
  assert.throws(() => createHarness({ logPath: join(REPO, "agent-run.jsonl"), capUsd: 1, prices: PRICES } as any), /repo|ROLE_RADAR_AGENT_LOG/i);
  assert.equal(existsSync(join(REPO, "agent-run.jsonl")), false);
});

test("AG-3 KILL file next to the log: checkKill throws KilledError and logs killed", () => {
  const h = mk();
  h.checkKill(); // no kill: no throw, no line
  assert.equal(existsSync(join(dir, "run.jsonl")), false);
  writeFileSync(join(dir, "KILL"), "");
  assert.throws(() => h.checkKill(), KilledError);
  assert.throws(() => h.checkKill(), KilledError, "stays killed");
  const rows = lines(join(dir, "run.jsonl"));
  assert.ok(rows.length >= 1 && rows.every((r) => r.event === "killed"));
  const err = (() => { try { h.checkKill(); } catch (e) { return e as any; } })();
  assert.ok(err instanceof Error && typeof err.exitCode === "number" && err.exitCode !== 0);
});

test("AG-3 explicit killPath is honoured", () => {
  const kp = join(dir, "elsewhere-KILL");
  const h = mk({ killPath: kp });
  writeFileSync(join(dir, "KILL"), ""); // default location must be ignored when killPath is set
  h.checkKill();
  writeFileSync(kp, "");
  assert.throws(() => h.checkKill(), KilledError);
});

test("AG-3 env ROLE_RADAR_AGENT_KILL=1 kills; other values do not", () => {
  const h = mk();
  process.env.ROLE_RADAR_AGENT_KILL = "0";
  h.checkKill();
  process.env.ROLE_RADAR_AGENT_KILL = "1";
  assert.throws(() => h.checkKill(), KilledError);
  assert.equal(lines(join(dir, "run.jsonl")).at(-1).event, "killed");
});

test("AG-4 crossing the cap: record throws CapExceeded, logs cap_hit, and every later record is refused", () => {
  // 1M input tokens at $3 = $3.00 per call; cap $5 -> second call crosses.
  const h = mk({ capUsd: 5 });
  h.record({ input: 1_000_000, output: 0 }, "m-test");
  assert.throws(() => h.record({ input: 1_000_000, output: 0 }, "m-test"), CapExceeded);
  assert.throws(() => h.record({ input: 1, output: 1 }, "m-test"), CapExceeded, "next call refused");
  const rows = lines(join(dir, "run.jsonl"));
  assert.ok(rows.some((r) => r.event === "cap_hit"));
  const err = (() => { try { h.record({ input: 1, output: 1 }, "m-test"); } catch (e) { return e as any; } })();
  assert.ok(typeof err.exitCode === "number" && err.exitCode !== 0, "non-zero exit code");
});

test("AG-4 under the cap never throws; spend is the sum of logged usd", () => {
  const h = mk({ capUsd: 1 });
  h.record({ input: 100, output: 10 }, "m-test");
  h.record({ input: 100, output: 10 }, "m-test");
  const sum = lines(join(dir, "run.jsonl")).reduce((a, r) => a + r.usd, 0);
  assert.ok(Math.abs(h.spentUsd - sum) < 1e-12);
});
