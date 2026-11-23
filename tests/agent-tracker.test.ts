/* RR-AGENT PR 1: tracker contract (AG-7, AG-8, AG-9). Demo data only. No network.
 *
 * agent/tracker.ts exports createTracker(path, { harness? }) -> tracker
 *   path missing/empty: throws naming ROLE_RADAR_TRACKER. Path inside the repo tree (outside demo/): throws.
 *   File is append-only JSONL, one line per write, each with roleId and ts (ISO):
 *     upsertRole({id, title, company, score?, url?})  -> { type: "role", roleId, ... }   (new role starts at status "found")
 *     addDraft(roleId, {kind, ref})                    -> { type: "draft", roleId, draft: {kind, ref} }   unknown role throws
 *     setStatus(roleId, status, { approved? })         -> { type: "status", roleId, status }
 *   Reads fold the lines: tracker.get(id) -> { id, title, company, status, drafts: [{kind, ref}], updatedAt }, tracker.list() -> all roles.
 *   Upserting the same id twice gives one role (latest fields win) but still appends a line.
 *   STATUSES = found, drafted, ready, sent, response, interview, rejected, dropped; anything else throws naming "status", file unchanged.
 *   "sent" needs { approved: true } (strict boolean true, set by the CLI, never the model). Otherwise throws /approv/i, appends nothing,
 *   and calls harness.log({event: "refused_sent", roleId}). With approved true it records sent.
 */
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, mkdtempSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { createTracker } from "../agent/tracker.ts";
import { createHarness } from "../agent/harness.ts";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
let dir: string;
let file: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "rr-agent-t-")); file = join(dir, "tracker.jsonl"); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const lines = (p: string) => readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const role = { id: "r1", title: "Staff PM, Demo Platform", company: "Example Co (demo)", score: 82 };

test("AG-7 writes append as JSONL with role id, status, draft refs and timestamp at the given path", () => {
  const t = createTracker(file);
  t.upsertRole(role);
  t.addDraft("r1", { kind: "resume", ref: "drafts/r1-resume.md" });
  t.setStatus("r1", "drafted", {});
  const rows = lines(file);
  assert.equal(rows.length, 3);
  assert.ok(rows.every((r) => r.roleId === "r1" && !Number.isNaN(Date.parse(r.ts))));
  assert.deepEqual(rows[1].draft, { kind: "resume", ref: "drafts/r1-resume.md" });
  assert.equal(rows[2].status, "drafted");
  const got = t.get("r1");
  assert.equal(got.status, "drafted");
  assert.deepEqual(got.drafts, [{ kind: "resume", ref: "drafts/r1-resume.md" }]);
  assert.equal(got.company, "Example Co (demo)");
});

test("AG-7 a new role starts at found; a second tracker on the same file sees earlier entries and appends after them", () => {
  createTracker(file).upsertRole(role);
  const t2 = createTracker(file);
  assert.equal(t2.get("r1").status, "found");
  t2.upsertRole({ id: "r2", title: "Senior PM, Demo", company: "Sample Inc (demo)" });
  const rows = lines(file);
  assert.deepEqual(rows.map((r) => r.roleId), ["r1", "r2"]);
  assert.equal(t2.list().length, 2);
});

test("AG-7 upsert of the same role is one role, latest fields win, and still appends", () => {
  const t = createTracker(file);
  t.upsertRole(role);
  t.upsertRole({ ...role, score: 90 });
  assert.equal(t.list().length, 1);
  assert.equal(t.get("r1").score, 90);
  assert.equal(lines(file).length, 2);
});

test("AG-7 addDraft and setStatus for an unknown role throw and write nothing", () => {
  const t = createTracker(file);
  assert.throws(() => t.addDraft("nope", { kind: "cover", ref: "x" }), /nope/);
  assert.throws(() => t.setStatus("nope", "drafted", {}), /nope/);
  assert.equal(existsSync(file) ? readFileSync(file, "utf8") : "", "");
});

test("AG-7 no tracker path: throws naming ROLE_RADAR_TRACKER; a path inside the repo is refused", () => {
  assert.throws(() => createTracker(undefined as any), /ROLE_RADAR_TRACKER/);
  assert.throws(() => createTracker(""), /ROLE_RADAR_TRACKER/);
  const inRepo = join(REPO, "tracker-test.jsonl");
  assert.throws(() => createTracker(inRepo), /ROLE_RADAR_TRACKER|repo/i);
  assert.equal(existsSync(inRepo), false);
  assert.ok(!readdirSync(REPO).includes("tracker-test.jsonl"));
});

test("AG-8 sent without approval is refused, logs refused_sent, tracker unchanged", () => {
  const logPath = join(dir, "run.jsonl");
  const harness = createHarness({ logPath, capUsd: 1, prices: {} });
  const t = createTracker(file, { harness });
  t.upsertRole(role);
  t.setStatus("r1", "ready", {});
  const before = readFileSync(file, "utf8");
  for (const opts of [undefined, {}, { approved: false }, { approved: "true" }, { approved: 1 }] as any[]) {
    assert.throws(() => t.setStatus("r1", "sent", opts), /approv/i);
  }
  assert.equal(readFileSync(file, "utf8"), before, "file unchanged");
  assert.equal(t.get("r1").status, "ready");
  const refused = lines(logPath).filter((r) => r.event === "refused_sent");
  assert.equal(refused.length, 5);
  assert.ok(refused.every((r) => r.roleId === "r1"));
});

test("AG-8 sent without approval is refused even with no harness attached", () => {
  const t = createTracker(file);
  t.upsertRole(role);
  assert.throws(() => t.setStatus("r1", "sent", {}), /approv/i);
  assert.equal(t.get("r1").status, "found");
});

test("AG-8 with approved: true the tracker records sent", () => {
  const t = createTracker(file);
  t.upsertRole(role);
  t.setStatus("r1", "ready", {});
  t.setStatus("r1", "sent", { approved: true });
  assert.equal(t.get("r1").status, "sent");
  assert.equal(lines(file).at(-1).status, "sent");
});

test("AG-9 every listed status is accepted (sent only with approval)", () => {
  const t = createTracker(file);
  t.upsertRole(role);
  for (const s of ["found", "drafted", "ready", "response", "interview", "rejected", "dropped"]) {
    t.setStatus("r1", s, {});
    assert.equal(t.get("r1").status, s);
  }
  t.setStatus("r1", "sent", { approved: true });
  assert.equal(t.get("r1").status, "sent");
});

test("AG-9 a status outside the list is rejected, even with approved: true, and the file is unchanged", () => {
  const t = createTracker(file);
  t.upsertRole(role);
  const before = readFileSync(file, "utf8");
  for (const bad of ["emailed", "applied", "SENT", "Ready", "", " sent", undefined, 3]) {
    assert.throws(() => t.setStatus("r1", bad as any, { approved: true }), /status/i, `status ${String(bad)}`);
  }
  assert.equal(readFileSync(file, "utf8"), before);
});
