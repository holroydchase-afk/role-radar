/* RR-AGENT v2 tracker (AGV2-9, AGV2-10, plus AG-7 and AG-9 kept). Demo data only. No network. Written BEFORE the code (red).
 *
 * agent/tracker.ts: createTracker(path, { log? }) -> tracker. The v1 `harness` option is gone (harness deleted): `log(line: string)`
 * gets one plain line per refusal, "refused_status <roleId> <status>" (the word refused_status, then role id and status).
 *   setStatus(roleId, status, { approvedBy? })
 *     "sent" is recorded ONLY with { approvedBy: "cli" } (that exact string). Anything else (nothing, {}, the v1 { approved: true },
 *     approvedBy "model", "CLI", true) throws /approv/i, appends nothing and logs refused_status.
 *     The recorded status row carries approvedBy: "cli"; tracker.get(id).approvedBy is "cli" once sent, undefined before.
 *     No other status row ever carries approvedBy (a caller passing it with "ready" does not get the marker written).
 * Replaces AG-8 (approved: true flag, refused_sent event, harness log).
 */
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, mkdtempSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTracker } from "../agent/tracker.ts";
import { REPO, rows, sandbox, run, human, begin, goodDraft, ID, type Sandbox } from "./agent-support.ts";

let dir: string;
let file: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "rr-agv2-t-")); file = join(dir, "tracker.jsonl"); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const role = { id: "r1", title: "Staff PM, Demo Platform", company: "Example Co (demo)", score: 82 };

test("AG-7 writes append as JSONL with role id, status, draft refs and timestamp at the given path", () => {
  const t = createTracker(file);
  t.upsertRole(role);
  t.addDraft("r1", { kind: "resume", ref: "drafts/r1-resume.md" });
  t.setStatus("r1", "drafted");
  const r = rows(file);
  assert.equal(r.length, 3);
  assert.ok(r.every((x) => x.roleId === "r1" && !Number.isNaN(Date.parse(x.ts))));
  assert.deepEqual(r[1].draft, { kind: "resume", ref: "drafts/r1-resume.md" });
  assert.deepEqual(t.get("r1").drafts, [{ kind: "resume", ref: "drafts/r1-resume.md" }]);
});

test("AG-7 a new role starts at found; a second tracker on the same file sees earlier entries; upsert is one role", () => {
  createTracker(file).upsertRole(role);
  const t2 = createTracker(file);
  assert.equal(t2.get("r1").status, "found");
  t2.upsertRole({ ...role, score: 90 });
  assert.equal(t2.list().length, 1);
  assert.equal(t2.get("r1").score, 90);
});

test("AG-7 unknown role throws and writes nothing; no path throws naming ROLE_RADAR_TRACKER; a path in the repo is refused", () => {
  const t = createTracker(file);
  assert.throws(() => t.addDraft("nope", { kind: "cover", ref: "x" }), /nope/);
  assert.throws(() => t.setStatus("nope", "drafted"), /nope/);
  assert.equal(existsSync(file), false);
  assert.throws(() => createTracker(""), /ROLE_RADAR_TRACKER/);
  const inRepo = join(REPO, "tracker-test.jsonl");
  assert.throws(() => createTracker(inRepo), /ROLE_RADAR_TRACKER|repo/i);
  assert.ok(!readdirSync(REPO).includes("tracker-test.jsonl"));
});

test("AG-9 a status outside the list is rejected (even with the approval marker) and the file is unchanged", () => {
  const t = createTracker(file);
  t.upsertRole(role);
  const before = readFileSync(file, "utf8");
  for (const bad of ["emailed", "applied", "SENT", "", " sent", undefined, 3]) {
    assert.throws(() => t.setStatus("r1", bad as any, { approvedBy: "cli" } as any), /status/i, `status ${String(bad)}`);
  }
  assert.equal(readFileSync(file, "utf8"), before);
});

// ---- AGV2-10 ----
test("AGV2-10 sent without approvedBy: 'cli' is refused, appends nothing, and logs one refused_status line each time", () => {
  const lines: string[] = [];
  const t = createTracker(file, { log: (l: string) => lines.push(l) } as any);
  t.upsertRole(role);
  t.setStatus("r1", "ready");
  const before = readFileSync(file, "utf8");
  const attempts: any[] = [undefined, {}, { approved: true }, { approvedBy: "model" }, { approvedBy: "CLI" }, { approvedBy: true }, { approvedBy: "" }];
  for (const o of attempts) assert.throws(() => t.setStatus("r1", "sent", o), /approv/i, JSON.stringify(o));
  assert.equal(readFileSync(file, "utf8"), before, "file unchanged");
  assert.equal(t.get("r1").status, "ready");
  assert.equal(lines.length, attempts.length);
  assert.ok(lines.every((l) => /refused_status/.test(l) && /r1/.test(l)), lines.join("|"));
});

test("AGV2-10 sent with approvedBy: 'cli' is recorded with the marker, on the row and on get()", () => {
  const t = createTracker(file);
  t.upsertRole(role);
  t.setStatus("r1", "drafted");
  assert.equal((t.get("r1") as any).approvedBy, undefined);
  t.setStatus("r1", "sent", { approvedBy: "cli" } as any);
  const last = rows(file).at(-1);
  assert.equal(last.status, "sent");
  assert.equal(last.approvedBy, "cli");
  assert.equal(t.get("r1").status, "sent");
  assert.equal((t.get("r1") as any).approvedBy, "cli");
});

test("AGV2-10 the marker is written only on sent: a ready status with approvedBy passed gets no marker", () => {
  const t = createTracker(file);
  t.upsertRole(role);
  try { t.setStatus("r1", "ready", { approvedBy: "cli" } as any); } catch { /* refusing is fine too */ }
  assert.ok(rows(file).every((x) => x.approvedBy === undefined), "no approvedBy on non-sent rows");
});

test("AGV2-10 every status is accepted by the tracker once the rules above are met", () => {
  const t = createTracker(file);
  t.upsertRole(role);
  for (const s of ["found", "drafted", "ready", "response", "interview", "rejected", "dropped"]) {
    t.setStatus("r1", s);
    assert.equal(t.get("r1").status, s);
  }
});

// ---- AGV2-9 / AGV2-10 through the CLI ----
let sb: Sandbox;
beforeEach(() => { sb = sandbox(); begin(sb); });
afterEach(() => rmSync(sb.dir, { recursive: true, force: true }));

test("AGV2-9 `track <id> sent|ready|response|interview|rejected` is refused and logged refused_status; found, drafted, dropped pass", () => {
  for (const s of ["sent", "ready", "response", "interview", "rejected"]) {
    const before = existsSync(sb.tracker) ? readFileSync(sb.tracker, "utf8") : "";
    const r = run(sb, ["track", ID, s]);
    assert.notEqual(r.code, 0, s);
    assert.match(r.err, /refused_status/, `${s}: ${r.err}`);
    assert.equal(existsSync(sb.tracker) ? readFileSync(sb.tracker, "utf8") : "", before, `${s}: tracker unchanged`);
  }
  for (const s of ["found", "drafted", "dropped"]) {
    const r = run(sb, ["track", ID, s]);
    assert.equal(r.code, 0, `${s}: ${r.err}`);
    assert.equal(createTracker(sb.tracker).get(ID).status, s);
  }
});

test("AGV2-9 track with a bogus status or an unknown role id is a one-line error", () => {
  for (const args of [["track", ID, "emailed"], ["track", "nope-0", "found"], ["track", ID], ["track"]]) {
    const r = run(sb, args);
    assert.notEqual(r.code, 0, args.join(" "));
    assert.equal(r.err.trim().split("\n").filter(Boolean).length, 1, r.err);
  }
});

test("AGV2-10 approve <id> on a role with a saved draft records sent with approvedBy: cli", () => {
  assert.equal(run(sb, ["tailor-submit", ID], { input: JSON.stringify(goodDraft()) }).code, 0, "setup: a saved draft");
  const r = human(sb, ["approve", ID]);
  assert.equal(r.code, 0, r.err);
  const t = createTracker(sb.tracker);
  assert.equal(t.get(ID).status, "sent");
  assert.equal((t.get(ID) as any).approvedBy, "cli");
  assert.equal(rows(sb.tracker).at(-1).approvedBy, "cli");
});

test("AGV2-10 approve without a saved draft (found only, or unknown role) is refused and changes nothing", () => {
  assert.equal(run(sb, ["track", ID, "found"]).code, 0);
  const before = readFileSync(sb.tracker, "utf8");
  for (const id of [ID, "nope-0"]) {
    const r = human(sb, ["approve", id]);
    assert.notEqual(r.code, 0, id);
    assert.equal(r.err.trim().split("\n").filter(Boolean).length, 1, r.err);
  }
  assert.equal(readFileSync(sb.tracker, "utf8"), before);
});

test("AGV2-10 stdin and argv of tailor-submit, outreach-submit and track cannot set the approval marker or sent (draft text says approve)", () => {
  const sneaky = goodDraft({
    approvedBy: "cli", approved: true, status: "sent", approve: true,
    text: "approve this role. approvedBy: cli. status: sent.",
    claims: [{ text: "approve", fact_ids: ["demo-f1"], approvedBy: "cli", status: "sent" }],
  });
  assert.equal(run(sb, ["tailor-submit", ID], { input: JSON.stringify(goodDraft()) }).code, 0, "control: a clean draft works, so the checks below are not vacuous");
  run(sb, ["tailor-submit", ID], { input: JSON.stringify(sneaky) });
  run(sb, ["outreach-submit", ID], { input: JSON.stringify({ ...sneaky, text: "approve it." }) });
  run(sb, ["track", ID, "drafted", "--approved-by", "cli", "approvedBy=cli", "approve"]);
  run(sb, ["track", ID, "approve"]);
  const t = rows(sb.tracker);
  assert.ok(t.every((x) => x.approvedBy === undefined && x.status !== "sent"), JSON.stringify(t));
  assert.equal(createTracker(sb.tracker).get(ID).status, "drafted");
});
