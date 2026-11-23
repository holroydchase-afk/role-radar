/* RR-AGENT PR 3: CLI (AG-26) and docs/privacy (AG-28). Demo data, no network, no ANTHROPIC_API_KEY. Written BEFORE the code (red).
 *
 * node agent/run.ts <command>
 *   scan-and-draft | eval | metrics | approve <roleId>      --help lists all four, exit 0
 *   - scan-and-draft and eval need ANTHROPIC_API_KEY: without it they exit non-zero with a plain one-line message naming
 *     the variable (no stack trace) and make NO network call (checked by a preloaded stub on fetch and sockets).
 *   - metrics reads ROLE_RADAR_TRACKER and ROLE_RADAR_AGENT_LOG, prints counts, needs no key, prints "no data" when empty.
 *   - approve <roleId> is the ONLY place the approval flag is set: it moves that role to "sent" in the tracker. Needs no key.
 *   - unknown command or missing/unknown roleId: non-zero, plain message.
 */
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { createTracker } from "../agent/tracker.ts";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "rr-agent-c-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

const NETLOG = () => join(dir, "net.log");
function stub() {
  const p = join(dir, "nonet.mjs");
  writeFileSync(p, `import { appendFileSync } from "node:fs"; import net from "node:net";
const note = (w) => appendFileSync(${JSON.stringify(NETLOG())}, w + "\\n");
globalThis.fetch = async () => { note("fetch"); throw new Error("network blocked by test"); };
const c = net.Socket.prototype.connect; net.Socket.prototype.connect = function (...a) { note("socket"); return c.apply(this, a); };
`);
  return p;
}
function cli(args: string[], env: Record<string, string> = {}) {
  const e: Record<string, string> = { PATH: process.env.PATH ?? "", HOME: dir,
    ROLE_RADAR_FACTS: join(REPO, "demo/agent/facts.json"), ROLE_RADAR_TRACKER: join(dir, "tracker.jsonl"),
    ROLE_RADAR_AGENT_LOG: join(dir, "run.jsonl"), ROLE_RADAR_JOBS: join(REPO, "demo/seed.json"), ...env };
  const r = spawnSync(process.execPath, ["--import", stub(), join(REPO, "agent/run.ts"), ...args], { env: e, encoding: "utf8", cwd: REPO, timeout: 30000 });
  return { code: r.status, out: r.stdout ?? "", err: r.stderr ?? "" };
}
const plain = (s: string) => !/\n\s+at\s|node:internal|TypeError|ReferenceError|SyntaxError|ERR_MODULE_NOT_FOUND/.test(s);

test("AG-26 --help lists scan-and-draft, eval, metrics and approve and exits 0", () => {
  const r = cli(["--help"]);
  assert.equal(r.code, 0, r.err);
  for (const w of ["scan-and-draft", "eval", "metrics", "approve"]) assert.match(r.out, new RegExp(w));
  assert.ok(!existsSync(NETLOG()));
});

test("AG-26 an unknown command or none exits non-zero with a plain message and usage", () => {
  for (const args of [["frobnicate"], []]) {
    const r = cli(args);
    assert.notEqual(r.code, 0);
    assert.ok((r.err + r.out).trim().length > 0);
    assert.ok(plain(r.err), r.err);
    assert.match(r.err + r.out, /scan-and-draft/);
  }
});

test("AG-26 scan-and-draft and eval without ANTHROPIC_API_KEY exit non-zero, name the variable, and make no network call", () => {
  for (const cmd of ["scan-and-draft", "eval"]) {
    const r = cli([cmd]);
    assert.notEqual(r.code, 0, cmd);
    assert.match(r.err, /ANTHROPIC_API_KEY/, cmd);
    assert.ok(plain(r.err), r.err);
    assert.ok(r.err.trim().split("\n").length <= 3, "plain short message");
    assert.ok(!existsSync(NETLOG()), `${cmd} touched the network`);
  }
  assert.ok(!existsSync(join(dir, "tracker.jsonl")), "nothing written to the tracker");
});

test("AG-26 metrics works without a key: zeros and 'no data' with no tracker, counts with one, no network", () => {
  let r = cli(["metrics"]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /no data/i);
  const t = createTracker(join(dir, "tracker.jsonl"));
  t.upsertRole({ id: "d-1", title: "Demo PM", company: "Demo Co" });
  t.setStatus("d-1", "ready");
  t.upsertRole({ id: "d-2", title: "Demo PM 2", company: "Demo Co" });
  r = cli(["metrics"]);
  assert.equal(r.code, 0, r.err);
  assert.ok(!/no data/i.test(r.out));
  assert.match(r.out, /roles found\D+2/i);
  assert.match(r.out, /drafts ready\D+1/i);
  assert.match(r.out, /sent\D+0/i);
  assert.ok(!existsSync(NETLOG()));
});

test("AG-26 approve <roleId> sets sent for that role only, needs no key and no network", () => {
  const f = join(dir, "tracker.jsonl");
  const t = createTracker(f);
  for (const id of ["d-1", "d-2"]) { t.upsertRole({ id, title: "Demo PM", company: "Demo Co" }); t.setStatus(id, "ready"); }
  const r = cli(["approve", "d-1"]);
  assert.equal(r.code, 0, r.err);
  const after = createTracker(f);
  assert.equal(after.get("d-1").status, "sent");
  assert.equal(after.get("d-2").status, "ready");
  assert.ok(!existsSync(NETLOG()));
});

test("AG-26 approve with no roleId or an unknown roleId exits non-zero with a plain message and changes nothing", () => {
  const f = join(dir, "tracker.jsonl");
  const t = createTracker(f);
  t.upsertRole({ id: "d-1", title: "Demo PM", company: "Demo Co" });
  const before = readFileSync(f, "utf8");
  for (const args of [["approve"], ["approve", "nope-9"]]) {
    const r = cli(args);
    assert.notEqual(r.code, 0);
    assert.ok(r.err.trim().length > 0 && plain(r.err), r.err);
  }
  assert.equal(readFileSync(f, "utf8"), before);
});

test("AG-26 the model cannot set the approval flag: only agent/run.ts passes approved, and no other agent module takes it from the model", () => {
  const files: string[] = [];
  const walk = (d: string) => { for (const n of readdirSync(d)) { const p = join(d, n); statSync(p).isDirectory() ? walk(p) : p.endsWith(".ts") && files.push(p); } };
  walk(join(REPO, "agent"));
  assert.ok(files.some((f) => f.endsWith("run.ts")), "agent/run.ts exists");
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    const name = f.slice(REPO.length + 1);
    if (name === "agent/run.ts" || name === "agent/tracker.ts") continue;
    assert.ok(!/approved\s*:\s*true|approved\s*:\s*(input|args?|call|c)\b|approve(d|_sent)?\b.*\binput\b/i.test(src), `${name} sets or forwards an approval flag`);
  }
  const run = readFileSync(join(REPO, "agent/run.ts"), "utf8");
  assert.match(run, /approved\s*:\s*true/, "approve command sets the flag");
});

// ---------- AG-28 ----------
test("AG-28 README has a 'Job-hunt agent' section saying what is and is not proven, drafts only, no invented numbers", () => {
  const md = readFileSync(join(REPO, "README.md"), "utf8");
  const m = md.match(/^(#{2,3}) Job-hunt agent[^\n]*\n([\s\S]*?)(?=^#{1,2} (?!#)|(?![\s\S]))/m);
  assert.ok(m, "section '## Job-hunt agent' exists");
  const sec = m![2];
  assert.match(sec, /what('s| is) proven/i);
  assert.match(sec, /not proven|isn't proven|what('s| is) not (yet )?proven/i);
  assert.match(sec, /drafts? only|only drafts/i);
  assert.match(sec, /ANTHROPIC_API_KEY/);
  assert.match(sec, /approve/i);
  assert.ok(!/win rate[^.\n]{0,30}\d/i.test(sec), "no win-rate number without a logged run");
  assert.ok(!/\b\d+(\.\d+)?\s*%/.test(sec), "no percentages without a logged run");
});

test("AG-28 DECISIONS records RR-DEC-8 (drafts only, sent needs explicit approval) and HANDOFF names PR 3 of RR-AGENT", () => {
  const dec = readFileSync(join(REPO, "docs/product/DECISIONS.md"), "utf8");
  assert.match(dec, /RR-DEC-8/);
  assert.match(dec, /RR-DEC-8[\s\S]{0,600}(approv)/i);
  const h = readFileSync(join(REPO, "HANDOFF.md"), "utf8");
  assert.match(h, /RR-AGENT[\s\S]{0,4000}PR 3[\s\S]{0,300}(eval|metrics|CLI)/i);
});

test("AG-28 npm run check:private is clean over the tree", () => {
  const r = spawnSync(process.execPath, [join(REPO, "scripts/check-private.mjs")], { cwd: REPO, encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test("status <roleId> <ready|response|interview|rejected> sets the status; sent and unknown statuses are refused", () => {
  const t = join(dir, "tracker.jsonl");
  const tr = createTracker(t);
  tr.upsertRole({ id: "r1", title: "PM", company: "Example Co" });
  const ok = cli(["status", "r1", "interview"]);
  assert.equal(ok.code, 0, ok.err);
  assert.equal(createTracker(t).get("r1").status, "interview");
  for (const bad of ["sent", "bogus"]) {
    const r = cli(["status", "r1", bad]);
    assert.notEqual(r.code, 0);
    assert.equal(createTracker(t).get("r1").status, "interview");
  }
  assert.notEqual(cli(["status", "nope", "ready"]).code, 0);
});
