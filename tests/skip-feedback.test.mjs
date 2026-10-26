// Skip feedback: the owner's skips (reason chip + comment) become suggested criteria changes. Demo-style data only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import yaml from "js-yaml";

const require = createRequire(import.meta.url);
const SF = require("../src/skip-feedback.js");
const text = readFileSync(new URL("../criteria.yaml", import.meta.url), "utf8");
const spec = yaml.load(text);
const NOW = Date.parse("2026-10-26T18:00:00Z");
const ago = (d) => new Date(NOW - d * 864e5).toISOString();
let n = 0;
const skip = (o) => ({ _id: "j" + ++n, status: "skipped", skippedBy: "owner", skippedAt: ago(1), title: "Senior Product Manager", company: "Acme " + n, ...o });
const run = (jobs, opts = {}) => SF.analyze(jobs, spec, { now: NOW, ...opts });
const kinds = (r) => r.suggestions.map((s) => s.id);

test("only the owner's skips from the last 30 days count", () => {
  const r = run([skip({}), skip({ skippedBy: "rule" }), skip({ skippedAt: ago(45) }), skip({ skippedBy: undefined }), { _id: "x", status: "saved" }]);
  assert.equal(r.skips, 2);
});

test("two skips at one company suggest never showing it, unless a role there was pursued", () => {
  const two = [skip({ company: "Brightline Labs", skipReason: "Culture" }), skip({ company: "brightline labs ", skipReason: "Wrong level" })];
  const s = run(two).suggestions.find((x) => x.kind === "company");
  assert.equal(s.text, "Never show Brightline Labs");
  assert.deepEqual(s.change, { op: "add", path: ["hard_exclude", "companies"], value: "Brightline Labs" });
  assert.equal(s.evidence.length, 2);
  assert.ok(!kinds(run([...two, { _id: "p", status: "applied", company: "Brightline Labs" }])).some((k) => k.startsWith("company:")));
});

test("a title word shared by wrong-level or wrong-domain skips becomes a title exclude", () => {
  const jobs = [skip({ title: "Senior Product Manager, Growth Marketing", skipReason: "Wrong domain" }), skip({ title: "Staff PM, Growth", skipReason: "Wrong level" }), skip({ title: "Senior PM, Growth", skipReason: "Culture" })];
  const s = run(jobs).suggestions.find((x) => x.kind === "title");
  assert.equal(s.change.value, "Growth");
  assert.deepEqual(s.change.path, ["role", "title_exclude"]);
  // "Marketing" is already excluded and "Senior Product Manager" words never count.
  assert.ok(!kinds(run(jobs)).some((k) => /title:(marketing|senior|product|manager)/.test(k)));
  // A pursued role with the word blocks it.
  assert.ok(!kinds(run([...jobs, { _id: "p", status: "applying", title: "Senior PM, Growth Lending" }])).includes("title:growth"));
});

test("a phrase repeated in Culture comments becomes a red flag; known flags and filler words don't", () => {
  const jobs = [skip({ skipReason: "Culture", skipNote: "Always-on Slack culture, fast-paced" }), skip({ skipReason: "Culture", skipNote: "Reviews say always-on and weekend deploys" }), skip({ skipReason: "Comp too low", skipNote: "always-on" })];
  const s = run(jobs).suggestions.filter((x) => x.kind === "culture");
  assert.deepEqual(s.map((x) => x.change.value), ["always-on"]);
  assert.deepEqual(s[0].change.path, ["culture", "red_flags"]);
});

test("three wrong-domain skips in a weight-2+ sector lower its weight; weight-1 sectors are left alone", () => {
  const geo = (o) => skip({ skipReason: "Wrong domain", sector: "Space & geospatial", ...o });
  const s = run([geo({}), geo({}), geo({})]).suggestions.find((x) => x.kind === "sector");
  assert.deepEqual(s.change, { op: "set", path: ["sectors", { id: "space_geo" }, "weight"], value: 1, from: 2 });
  const fin = (o) => skip({ skipReason: "Wrong domain", sector: "General fintech & payments", ...o });
  assert.ok(!run([fin({}), fin({}), fin({})]).suggestions.some((x) => x.kind === "sector"));
});

test("comp-too-low skips raise the floor just past their tops, within 30% and below any pursued role", () => {
  const low = [skip({ skipReason: "Comp too low", comp: "$140K–$152K" }), skip({ skipReason: "Comp too low", comp: "$150,000 - $154,000" })];
  const s = run(low).suggestions.find((x) => x.kind === "comp");
  assert.deepEqual(s.change, { op: "set", path: ["comp", "base_floor_usd"], value: 155000, from: 150000 });
  assert.equal(s.text, "Raise the base floor from $150K to $155K");
  assert.ok(!run([...low, { _id: "p", status: "applied", comp: "$130K–$154K" }]).suggestions.some((x) => x.kind === "comp"));
  assert.ok(!run([skip({ skipReason: "Comp too low", comp: "$250K" }), skip({ skipReason: "Comp too low", comp: "$240K" })]).suggestions.some((x) => x.kind === "comp"), "more than 30% up");
});

test("location and closed-posting skips become notes for the scan, not criteria changes", () => {
  const r = run([skip({ skipReason: "Location" }), skip({ skipReason: "Not remote" }), skip({ skipReason: "Posting closed" })]);
  assert.deepEqual(r.scanNotes.map((x) => x.id), ["scan:location"]);
  assert.ok(r.suggestions.every((x) => x.kind !== "scan"));
});

test("dismissed suggestions stay hidden", () => {
  const two = [skip({ company: "Quarry", skipReason: "Culture" }), skip({ company: "Quarry", skipReason: "Culture" })];
  assert.ok(kinds(run(two)).includes("company:quarry"));
  assert.ok(!kinds(run(two, { dismissed: ["company:quarry"] })).includes("company:quarry"));
});

test("applyToYaml adds to flow and block lists and sets values, keeping every comment", () => {
  const add = (path, value) => SF.applyToYaml(text, { op: "add", path, value }, yaml.load);
  const a = add(["hard_exclude", "companies"], "Brightline Labs");
  assert.deepEqual(yaml.load(a).hard_exclude.companies, ["Brightline Labs"]);
  assert.match(a, /companies: \[Brightline Labs\]\s+# add company names/);
  const b = add(["role", "title_exclude"], "Growth");
  assert.equal(yaml.load(b).role.title_exclude.at(-1), "Growth");
  assert.equal(yaml.load(b).role.title_include.length, spec.role.title_include.length);
  const c = add(["culture", "red_flags"], "always-on");
  assert.ok(yaml.load(c).culture.red_flags.includes("always-on"));
  assert.deepEqual(yaml.load(c).culture.hard_red_flags, spec.culture.hard_red_flags);
  const d = SF.applyToYaml(text, { op: "set", path: ["sectors", { id: "space_geo" }, "weight"], value: 1 }, yaml.load);
  assert.equal(yaml.load(d).sectors.find((s) => s.id === "space_geo").weight, 1);
  assert.equal(yaml.load(d).sectors.find((s) => s.id === "outdoor_brands").weight, 2);
  const e = SF.applyToYaml(text, { op: "set", path: ["comp", "base_floor_usd"], value: 155000 }, yaml.load);
  assert.match(e, /base_floor_usd: 155000\s+# skip if/);
  // Only the one line changed (or one line added).
  for (const out of [a, c, d, e]) assert.equal(out.split("\n").filter((l, i) => l !== text.split("\n")[i]).length, 1);
  assert.equal(b.split("\n").length, text.split("\n").length + 1);
});

test("applyToYaml refuses what it can't place, and quotes values YAML would misread", () => {
  assert.equal(SF.applyToYaml(text, { op: "add", path: ["nope", "x"], value: "y" }, yaml.load), null);
  assert.equal(SF.applyToYaml(text, { op: "set", path: ["sectors", { id: "missing" }, "weight"], value: 1 }, yaml.load), null);
  const out = SF.applyToYaml(text, { op: "add", path: ["culture", "red_flags"], value: "on-call: weekends" }, yaml.load);
  assert.ok(yaml.load(out).culture.red_flags.includes("on-call: weekends"));
  const yes = SF.applyToYaml(text, { op: "add", path: ["hard_exclude", "companies"], value: "Yes" }, yaml.load);
  assert.deepEqual(yaml.load(yes).hard_exclude.companies, ["Yes"]);
});
