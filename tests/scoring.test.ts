import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import yaml from "js-yaml";

import * as S from "../src/scoring.ts";
const spec = yaml.load(readFileSync(new URL("../criteria.yaml", import.meta.url), "utf8"));
const seed = JSON.parse(readFileSync(new URL("../demo/seed.json", import.meta.url), "utf8"));
const job = (o?: Record<string, unknown>) => ({ company: "Acme", title: "Senior Product Manager", location: "Remote, US", fit: "maybe", ...o });

test("parseComp reads common salary formats", () => {
  assert.deepEqual(S.parseComp("$170K–$205K"), { min: 170000, max: 205000 });
  assert.deepEqual(S.parseComp("$160,000 - $175,000 + equity"), { min: 160000, max: 175000 });
  assert.deepEqual(S.parseComp("170-205"), { min: 170000, max: 205000 });
  assert.deepEqual(S.parseComp({ min: 150000, max: 175000 }), { min: 150000, max: 175000 });
  assert.equal(S.parseComp(""), null);
  assert.equal(S.parseComp("Competitive"), null);
});

test("sector weight is worth 15 points per step", () => {
  const solar = S.scoreJob(job({ sector: "Solar, storage & distributed energy" }), spec);
  const space = S.scoreJob(job({ sector: "Space & geospatial" }), spec);
  const fintech = S.scoreJob(job({ sector: "General fintech & payments" }), spec);
  assert.equal(solar.parts.sector, 45);
  assert.equal(space.parts.sector, 30);
  assert.equal(fintech.parts.sector, 15);
});

test("sector is inferred from examples, then keywords, then the default weight", () => {
  assert.equal(S.sectorFor(job({ company: "Sunrun" }), spec).id, "solar_energy");
  assert.equal(S.sectorFor(job({ company: "Acme", title: "Senior PM, Community Solar" }), spec).id, "solar_energy");
  const other = S.sectorFor(job({ company: "Acme", title: "Senior Product Manager" }), spec);
  assert.equal(other.id, "default");
  assert.equal(other.weight, spec.default_sector_weight);
});

test("keyword matching is whole-word, so PV does not match 'provider'", () => {
  assert.equal(S.sectorFor(job({ title: "Senior PM, Provider Network" }), spec).id, "default");
});

test("fit points: strong 35, maybe 20, stretch 5, unknown 0", () => {
  for (const [fit, pts] of [["strong", 35], ["maybe", 20], ["stretch", 5], ["", 0], ["STRONG", 35]])
    assert.equal(S.scoreJob(job({ fit }), spec).parts.fit, pts);
});

test("culture: +10 for any good signal, -10 per red flag, never below -20", () => {
  assert.equal(S.scoreJob(job({ postingText: "We are a B Corp with a sustainable pace." }), spec).parts.culture, 10);
  assert.equal(S.scoreJob(job({ postingText: "A fast-paced team." }), spec).parts.culture, -10);
  assert.equal(S.scoreJob(job({ postingText: "fast-paced, hustle, scrappy, on-call" }), spec).parts.culture, -20);
  assert.equal(S.scoreJob(job({ cultureSignals: { good: ["4-day week"], red: ["hustle"] } }), spec).parts.culture, 0);
});

test("comp: +10 only when the range reaches the stretch target", () => {
  const target = spec.comp.stretch_target_usd;
  assert.equal(S.scoreJob(job({ comp: { min: 100000, max: target } }), spec).parts.comp, 10);
  assert.equal(S.scoreJob(job({ comp: { min: 100000, max: target - 1 } }), spec).parts.comp, 0);
  assert.equal(S.scoreJob(job({ comp: "" }), spec).parts.comp, 0);
});

test("values penalty takes 15 points", () => {
  const r = S.scoreJob(job({ businessModel: "gambling or sports betting" }), spec);
  assert.equal(r.parts.values, -15);
  assert.equal(r.valuesHit, "gambling or sports betting");
});

test("score is clamped to 0-100", () => {
  const top = S.scoreJob(job({ sector: "solar_energy", fit: "strong", comp: "$300K", postingText: "B Corp" }), spec);
  assert.equal(top.raw, 100);
  const low = S.scoreJob(job({ fit: "stretch", postingText: "fast-paced hustle", businessModel: "crypto trading or speculation" }), spec);
  assert.ok(low.raw < 0);
  assert.equal(low.score, 0);
});

test("matching gates: titles, hard excludes, location and comp floor", () => {
  assert.ok(S.matchJob(job({}), spec).ok);
  assert.match(S.matchJob(job({ title: "Director of Product" }), spec).reasons.join(), /title/);
  assert.match(S.matchJob(job({ title: "Senior Product Marketing Manager" }), spec).reasons.join(), /excluded: Marketing/);
  assert.match(S.matchJob(job({ businessModel: "payday or cash-advance apps" }), spec).reasons.join(), /business model/);
  assert.match(S.matchJob(job({ location: "Hybrid, Boston" }), spec).reasons.join(), /not remote/);
  assert.ok(S.matchJob(job({ location: "Hybrid, Denver" }), spec).ok, "hybrid is fine near hybrid_ok_near");
  const floor = spec.comp.base_floor_usd, prio = spec.comp.priority_sector_floor_usd;
  assert.ok(!S.matchJob(job({ comp: { min: 100000, max: floor - 1000 } }), spec).ok);
  assert.ok(S.matchJob(job({ sector: "solar_energy", comp: { min: 100000, max: prio } }), spec).ok, "weight-3 sectors may dip to the priority floor");
  assert.ok(S.matchJob(job({ comp: "" }), spec).ok, "missing comp is kept");
});

test("hard_exclude companies never match, whatever the score", () => {
  const s2 = { ...spec, hard_exclude: { companies: ["Acme"] } };
  assert.ok(!S.matchJob(job({ sector: "solar_energy", fit: "strong" }), s2).ok);
  assert.equal(S.buildDigest([job({ sector: "solar_energy", fit: "strong" })], s2).items.length, 0);
});

test("digest: sorted by score, min score enforced, per-sector caps counted as extras", () => {
  const fin = (n: number, fit: string) => job({ company: "Fin" + n, sector: "fintech", fit, comp: "$200K" });
  const jobs = [fin(1, "strong"), fin(2, "strong"), fin(3, "strong"), job({ company: "Sun", sector: "solar_energy", fit: "maybe" }), job({ company: "Low", fit: "stretch" })];
  const d = S.buildDigest(jobs, spec);
  assert.deepEqual(d.items.map((x) => x.job.company), ["Sun", "Fin1", "Fin2"]);
  assert.equal(d.extras.fintech, 1);
  assert.equal(d.passed, 4, "the stretch job scores below min_score_to_add");
});

test("digest respects digest_max_items", () => {
  const many = Array.from({ length: 12 }, (_, i) => job({ company: "Sun" + i, sector: "solar_energy", fit: "strong" }));
  const d = S.buildDigest(many, spec);
  assert.equal(d.items.length, spec.scoring.digest_max_items);
  assert.equal(d.extras._overflow, 12 - spec.scoring.digest_max_items);
});

test("explain lists the parts that moved the score", () => {
  assert.equal(S.explain(S.scoreJob(job({ sector: "solar_energy", fit: "strong", comp: "$200K" }), spec)), "45 sector + 35 experience + 10 comp");
  assert.equal(S.explain(S.scoreJob(job({ fit: "maybe", postingText: "fast-paced" }), spec)), "15 sector + 20 experience − 10 culture signals");
});

test("dream_roles: anchor companies and anchor-like titles in listed sectors get the bonus", () => {
  const d = { ...spec, dream_roles: { bonus: 15, like: [{ company: "Acme Solar", title: "Sr PM", check: "only if it ships" }], role_keywords: ["processing"], in_sectors: ["solar_energy"] } };
  const anchor = S.scoreJob(job({ company: "Acme Solar", sector: "solar_energy", fit: "strong" }), d);
  assert.equal(anchor.parts.dream, 15);
  assert.equal(anchor.dream?.check, "only if it ships");
  assert.equal(S.scoreJob(job({ company: "Other Co", title: "Senior Product Manager, Processing", sector: "solar_energy" }), d).parts.dream, 15);
  // Same title outside in_sectors, or a matching word only in the posting text, gets nothing.
  assert.equal(S.scoreJob(job({ company: "Other Co", title: "Senior Product Manager, Processing", sector: "fintech" }), d).parts.dream, 0);
  assert.equal(S.scoreJob(job({ company: "Other Co", sector: "solar_energy", postingText: "payment processing" }), d).parts.dream, 0);
  assert.match(S.explain(anchor), /\+ 15 dream role$/);
  // No dream_roles section, or junk in it, changes nothing.
  assert.equal(S.scoreJob(job({ company: "Acme Solar" }), { ...spec, dream_roles: { like: [null, {}, "x"], in_sectors: "solar_energy" } }).parts.dream, 0);
});

test("every demo job's stored score matches the scoring rules", () => {
  for (const [id, j] of Object.entries<S.Job & { score: number }>(seed.jobs)) assert.equal(j.score, S.scoreJob(j, spec).score, id);
});

test("works with an empty or partial spec", () => {
  assert.equal(S.scoreJob(job({ fit: "strong" }), {}).score, 50);
  assert.ok(S.matchJob(job({}), {}).ok);
  assert.equal(S.buildDigest([job({})], null).items.length, 1);
});

test("the scan prompt states the same scoring numbers as the module", () => {
  const prompt = readFileSync(new URL("../scan/scan-prompt.template.md", import.meta.url), "utf8");
  for (const phrase of ["weight × 15", "strong 35", "maybe 20", "stretch 5", "+10 if the posting shows any culture.good_signals", "−10 per culture.red_flags phrase found (max −20)", "+10 if the stated range reaches comp.stretch_target_usd", "−15 if the company's main business is in values_penalty", "clamped 0-100"])
    assert.ok(prompt.includes(phrase), phrase);
});

// ── Fit badges (values_fit, culture_fit) ─────────────────────
test("values badge follows sector weight", () => {
  assert.equal(S.valuesFitOf(job({ sector: "solar_energy" }), spec).rating, "great");
  assert.equal(S.valuesFitOf(job({ sector: "space_geo" }), spec).rating, "good");
  assert.equal(S.valuesFitOf(job({ sector: "fintech" }), spec).rating, "neutral");
});

test("values badge is no for values_penalty and hard excludes", () => {
  assert.equal(S.valuesFitOf(job({ businessModel: "sports betting app", industry: "gambling or sports betting" }), spec).rating, "no");
  const v = S.valuesFitOf(job({ businessModel: "payday or cash-advance apps" }), spec);
  assert.equal(v.rating, "no");
  assert.match(v.reason, /business model/);
});

test("a stored values rating wins", () => {
  const v = S.valuesFitOf(job({ sector: "fintech", valuesFit: { rating: "Good", reason: "mission lending" } }), spec);
  assert.deepEqual([v.rating, v.reason, v.source], ["good", "mission lending", "stored"]);
});

test("culture badge is unrated until something is checked", () => {
  const c = S.cultureFitOf(job({}), spec);
  assert.equal(c.rating, "unrated");
  assert.equal(c.reason, "Not checked yet.");
});

test("culture calibration: calm fintech with launch-crunch risk is good", () => {
  // Fictional stand-in for a calm, well-reviewed company with a brand-new team.
  const c = S.cultureFitOf(job({ cultureChecks: ["calm_pace", "remote_us", "pay_same_everywhere", "family_benefits", "good_reviews", "crunch_risk"] }), spec);
  assert.equal(c.points, 5);
  assert.equal(c.rating, "good");
  assert.match(c.reason, /^Calm pace, .*but launch crunch risk\.$/);
});

test("culture calibration: fast-paced, layoffs and a pay-tier gap is maybe at best", () => {
  const c = S.cultureFitOf(job({ cultureChecks: { fast_paced: "posting", remote_us: "", pay_tier_gap: "", family_benefits: "", recent_layoffs: "two rounds" } }), spec);
  assert.equal(c.points, -3);
  assert.equal(c.rating, "maybe");
  assert.equal(S.cultureFitOf(job({ cultureChecks: ["fast_paced", "recent_layoffs"] }), spec).rating, "no");
});

test("culture falls back to posting signals and ignores unknown checks", () => {
  assert.equal(S.cultureFitOf(job({ postingText: "A fast-paced team" }), spec).hits[0].id, "fast_paced");
  assert.equal(S.cultureFitOf(job({ cultureChecks: ["not_a_check"] }), spec).rating, "unrated");
});

test("fit badges never change the score", () => {
  const base = job({ sector: "solar_energy", fit: "strong" });
  assert.equal(S.scoreJob({ ...base, cultureChecks: ["recent_layoffs"], valuesFit: { rating: "no" } }, spec).score, S.scoreJob(base, spec).score);
});
