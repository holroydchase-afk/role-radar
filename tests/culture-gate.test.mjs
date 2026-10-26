// Culture gate and startup penalty (criteria.yaml culture.hard_red_flags, company_stage), Oct 26.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import yaml from "js-yaml";

const S = createRequire(import.meta.url)("../src/scoring.js");
const spec = yaml.load(readFileSync(new URL("../criteria.yaml", import.meta.url), "utf8"));
const job = (o) => ({ company: "Acme", title: "Senior Product Manager", location: "Remote, US", fit: "maybe", ...o });

test("RR-CG-1: a hard red flag fails the match when red_flag_effect is skip_hard", () => {
  const m = S.matchJob(job({ cultureSignals: { good: [], red: ["fast-paced"] } }), spec);
  assert.equal(m.ok, false);
  assert.ok(m.reasons.some((r) => /hard red flag: fast-paced/.test(r)), m.reasons.join("; "));
});

test("RR-CG-2: a soft red flag only lowers the score", () => {
  const j = job({ cultureSignals: { good: [], red: ["scrappy"] } });
  assert.ok(S.matchJob(j, spec).ok);
  assert.equal(S.scoreJob(j, spec).parts.culture, -10);
});

test("RR-CG-3: posting text is checked for hard flags when no signals are stored", () => {
  assert.equal(S.matchJob(job({ postingText: "Join a high-intensity team" }), spec).ok, false);
});

test("RR-CG-4: score_only keeps the old behavior", () => {
  const old = { ...spec, culture: { ...spec.culture, red_flag_effect: "score_only" } };
  assert.ok(S.matchJob(job({ cultureSignals: { good: [], red: ["fast-paced"] } }), old).ok);
});

test("RR-CG-5: a startup takes company_stage.startup_penalty", () => {
  const base = S.scoreJob(job({}), spec).score;
  const r = S.scoreJob(job({ companyStage: "startup" }), spec);
  assert.equal(r.parts.stage, -20);
  assert.equal(r.score, base - 20);
  assert.match(S.explain(r), /− 20 startup/);
});

test("RR-CG-6: established or unknown stage adds nothing", () => {
  assert.equal(S.scoreJob(job({ companyStage: "established" }), spec).parts.stage, 0);
  assert.equal(S.scoreJob(job({}), spec).parts.stage, 0);
  assert.equal(S.scoreJob(job({ companyStage: "startup" }), {}).parts.stage, 0);
});

test("RR-CG-7: the scan prompt states the gate and the penalty", () => {
  const prompt = readFileSync(new URL("../scan/scan-prompt.template.md", import.meta.url), "utf8");
  for (const phrase of ["culture.hard_red_flags", "never add the role", "company_stage.startup_penalty", "must_read_posting"])
    assert.ok(prompt.includes(phrase), phrase);
});
