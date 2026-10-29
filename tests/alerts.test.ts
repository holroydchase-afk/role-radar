import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import yaml from "js-yaml";

import * as A from "../src/alerts.ts";
const spec = yaml.load(readFileSync(new URL("../criteria.yaml", import.meta.url), "utf8"));
// Noon and 11pm in Denver (UTC-6 in October).
const NOON = new Date("2026-10-22T18:00:00Z"), LATE = new Date("2026-10-23T05:00:00Z");

test("the demo criteria have an alerts block the code reads", () => {
  const cfg = A.normalize(spec);
  assert.deepEqual(cfg.channels, ["push", "thread"]);
  assert.equal(cfg.rules.length, 6);
  assert.deepEqual(cfg.quiet_hours, { start: 22 * 60, end: 7 * 60, tz: "America/Denver", loud_breaks_through: false });
  assert.deepEqual(cfg.rules[0].remind_after_hours, [4, 18]);
});

test("no alerts block falls back to loud recruiters and interviews", () => {
  const cfg = A.normalize({});
  assert.deepEqual(cfg.channels, ["push", "thread"]);
  assert.equal(cfg.quiet_hours, null);
  const out = A.evaluate([{ type: "recruiter_email" }, { type: "status_change", to: "rejected" }], {}, NOON);
  assert.deepEqual(out.map((x) => x.level), ["loud", "quiet"]);
});

test("recruiter email and interviews are loud on every channel", () => {
  const out = A.evaluate([{ type: "recruiter_email" }, { type: "status_change", to: "interviewing" }], spec, NOON);
  assert.deepEqual(out.map((x) => [x.rule.id, x.level, x.channels.join("+"), x.held]), [
    ["recruiter", "loud", "push+thread", false],
    ["interview", "loud", "push+thread", false],
  ]);
});

test("new roles: the first matching rule wins, so 90 is loud and 70 is quiet", () => {
  const out = A.evaluate([{ type: "new_role", score: 90 }, { type: "new_role", score: 70 }, { type: "new_role", score: 40 }], spec, NOON);
  assert.deepEqual(out.map((x) => [x.rule.id, x.level]), [["dream_match", "loud"], ["good_match", "quiet"]]);
  assert.deepEqual(out[1].channels, ["summary"]);
});

test("off rules and unmatched events send nothing", () => {
  const s = { alerts: { rules: [{ when: "follow_up_due", level: "off" }] } };
  assert.deepEqual(A.evaluate([{ type: "follow_up_due" }, { type: "recruiter_email" }], s, NOON), []);
});

test("quiet hours hold alerts, wrapping past midnight, unless loud breaks through", () => {
  assert.equal(A.inQuietHours(LATE, A.normalize(spec).quiet_hours), true);
  assert.equal(A.inQuietHours(NOON, A.normalize(spec).quiet_hours), false);
  assert.equal(A.evaluate([{ type: "recruiter_email" }], spec, LATE)[0].held, true);
  const through = { alerts: { ...spec.alerts, quiet_hours: { ...spec.alerts.quiet_hours, loud_breaks_through: true } } };
  const out = A.evaluate([{ type: "recruiter_email" }, { type: "status_change", to: "rejected" }], through, LATE);
  assert.deepEqual(out.map((x) => x.held), [false, true]);
});

test("junk in the alerts block is ignored, not fatal", () => {
  const cfg = A.normalize({ alerts: { channels: ["push", "pager", 7], quiet_hours: { start: "25:00", end: "x" },
    rules: [null, "loud", { when: "telepathy" }, { when: "new_role", level: "LOUD", min_score: "abc" }, { when: "status_change", to: "Offer" }] } });
  assert.deepEqual(cfg.channels, ["push"]);
  assert.equal(cfg.quiet_hours, null);
  assert.deepEqual(cfg.rules, [{ id: "new_role-4", when: "new_role", level: "loud" }, { id: "status_change-5", when: "status_change", level: "loud", to: ["offer"] }]);
  assert.doesNotThrow(() => A.evaluate(null, null, "not a date"));
});

test("describe reads as a plain sentence", () => {
  const [recruiter, interview, , dream] = A.normalize(spec).rules;
  assert.equal(A.describe(recruiter), "A recruiter or hiring manager emails or replies: alert right away, remind after 4 and 18h without a reply.");
  assert.equal(A.describe(interview), "A role moves to a screen or interviews or an offer: alert right away.");
  assert.equal(A.describe(dream), "The scan finds a role scoring 85+: alert right away.");
  assert.equal(A.clock(7 * 60 + 5), "07:05");
});
