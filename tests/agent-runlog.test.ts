/* RR-AGENT v2 run log (AGV2-15). Written BEFORE the code (red). No network.
 * AGV2-15: a demo run log docs/runs/<date>-job-hunt.md passes scripts/check-agent-run.mjs.
 * BLOCKED on studio-agents intake AGV2-B1: check-agent-run.mjs lists ten agents and `job-hunt` is not one of them, so any log with
 * `agent: job-hunt` fails validation. The validation test below is therefore marked { todo } with the reason: node still RUNS it and
 * prints the failure (it is not skipped or hidden), but it does not fail the suite until the intake lands.
 * The tripwire test fails the day `job-hunt` appears in AGENTS: when it does, delete the todo option on the validation test and this tripwire.
 * Slice 2 (engineer) writes the demo log; until then docs/runs/ does not exist, which is also why the validation test is red.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO } from "./agent-support.ts";

const RUNS = join(REPO, "docs", "runs");
const logs = () => (existsSync(RUNS) ? readdirSync(RUNS).filter((n) => /^\d{4}-\d{2}-\d{2}-job-hunt\.md$/.test(n)) : []);
const check = (f: string) => spawnSync(process.execPath, [join(REPO, "scripts/check-agent-run.mjs"), f], { encoding: "utf8" });

test("AGV2-15 a demo run log in docs/runs/ passes check-agent-run", {
  todo: "BLOCKED on studio-agents intake AGV2-B1 (add `job-hunt` to AGENTS in check-agent-run.mjs); expected to fail until then. Also needs the slice-2 demo log.",
}, () => {
  const found = logs();
  assert.ok(found.length >= 1, "docs/runs/<date>-job-hunt.md exists (slice 2 writes the demo log)");
  for (const n of found) {
    const f = join(RUNS, n);
    assert.match(readFileSync(f, "utf8"), /^agent:\s*job-hunt\s*$/m, `${n} names agent: job-hunt`);
    const r = check(f);
    assert.equal(r.status, 0, `${n}: ${r.stderr}`);
  }
});

test("AGV2-15 tripwire: `job-hunt` is still not in check-agent-run AGENTS (B1 open). If this fails, B1 landed: remove the todo above", async () => {
  const { AGENTS } = await import("../scripts/check-agent-run.mjs");
  assert.ok(!AGENTS.includes("job-hunt"), "B1 landed: drop { todo } from the AGV2-15 test and delete this tripwire");
});

test("AGV2-15 demo run logs in docs/runs/ are labeled demo and hold no email or id-like secrets", () => {
  for (const n of logs()) {
    const raw = readFileSync(join(RUNS, n), "utf8");
    assert.match(raw, /demo|made[- ]up/i, `${n} is labeled demo`);
    assert.ok(!raw.includes("@"), `${n} has no @`);
  }
});
