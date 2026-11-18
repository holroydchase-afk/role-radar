// RR-DREAM: a "Dream" bucket (Chase, 2026-11-18). A criteria `dream:` block marks roles at anchor companies or
// matching mission/health/ai_lab/applied_ai rules. It never changes the 0-100 score. Demo data only; red first.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { chromium } from "playwright";
import type { Browser } from "playwright";
import yamlLib from "js-yaml";
import * as S from "../src/scoring.ts";
import { openDemo as open } from "../scripts/browser.mjs";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const seed = JSON.parse(read("../demo/seed.json"));
const base: Record<string, unknown> = { sectors: [], default_sector_weight: 1 };
const dreamSpec = {
  ...base,
  dream: {
    companies: ["Arcadia", "Overstory"],
    established_companies: ["Bigco Labs"],
    rules: [
      { id: "mission", kind: "mission", keywords: ["climate", "decarbonization"] },
      { id: "health", kind: "health", keywords: ["patient care", "clinical"] },
      { id: "lab", kind: "ai_lab", keywords: ["frontier model", "foundation model"] },
      { id: "applied", kind: "applied_ai", keywords: ["agents", "LLM"] },
    ],
  },
};
const job = (o?: Record<string, unknown>) => ({ company: "Acme", title: "Senior Product Manager", location: "Remote, US", fit: "maybe", ...o });
const dream = (S as any).dreamBucketOf as (j: unknown, s: unknown) => { kind: string; why: string } | null;
const call = (j: unknown, s: unknown = dreamSpec) => {
  assert.equal(typeof dream, "function", "src/scoring.ts exports dreamBucketOf");
  return dream(j, s);
};

test("RR-DREAM-1 a company in dream.companies matches, case-insensitively, and says why", () => {
  const r = call(job({ company: "arcadia" }));
  assert.ok(r, "Arcadia is a dream company");
  assert.ok(r!.why.length > 0 && /arcadia/i.test(r!.why), `why names the company: ${r!.why}`);
  assert.ok(call(job({ company: "OVERSTORY" })));
  assert.equal(call(job({ company: "Acme" })), null);
});

test("RR-DREAM-2 mission and health rules match keywords in title, company or description", () => {
  assert.equal(call(job({ title: "Senior PM, Climate Data" }))!.kind, "mission");
  assert.equal(call(job({ postingText: "Help us speed decarbonization of the grid." }))!.kind, "mission");
  assert.equal(call(job({ description: "Improve patient care workflows." }))!.kind, "health");
  assert.equal(call(job({ company: "Clinical Labs Co", title: "Senior PM" }))!.kind, "health");
  assert.equal(call(job({ title: "Senior PM, Billing" })), null);
});

test("RR-DREAM-3 ai_lab keywords match anywhere in the text", () => {
  assert.equal(call(job({ postingText: "You will ship the frontier model API." }))!.kind, "ai_lab");
});

test("RR-DREAM-4 applied_ai counts only at an established company or when the keyword is in the title", () => {
  assert.equal(call(job({ company: "Bigco Labs", postingText: "Build LLM features." }))!.kind, "applied_ai", "established company");
  assert.equal(call(job({ company: "BIGCO LABS", postingText: "Build LLM features." }))!.kind, "applied_ai", "case-insensitive established");
  assert.equal(call(job({ company: "Startupco", title: "Senior PM, Agents" }))!.kind, "applied_ai", "keyword in title");
  assert.equal(call(job({ company: "Startupco", postingText: "Build LLM features and agents." })), null, "description only, not established");
});

test("RR-DREAM-5 matching is whole-word, like sector keywords", () => {
  assert.equal(call(job({ title: "Senior PM, Reagents Supply" })), null, "agents is not inside reagents");
});

test("RR-DREAM-6 no dream block (or junk) returns null and the score is unchanged either way", () => {
  assert.equal(call(job({ company: "Arcadia" }), base), null);
  assert.equal(call(job({ company: "Arcadia" }), null), null);
  assert.equal(call(job({ company: "Arcadia" }), { ...base, dream: "yes" }), null);
  assert.equal(call(job({ company: "Arcadia" }), { ...base, dream: { companies: null, rules: [{ id: 1 }, null] } }), null);
  const spec = yamlSpec();
  const j = job({ company: "Arcadia", sector: "Solar, storage & distributed energy", fit: "strong", comp: "$200K" });
  assert.deepEqual(S.scoreJob(j, spec), S.scoreJob(j, { ...spec, dream: dreamSpec.dream } as any), "dream block adds no points");
});

test("RR-DREAM-7 a job.dream preset wins over computation, and is returned even with no dream block", () => {
  const preset = { kind: "health", why: "set by the scan" };
  assert.deepEqual(call(job({ company: "Arcadia", dream: preset })), preset);
  assert.deepEqual(call(job({ dream: preset }), base), preset);
  assert.equal(call(job({ company: "Arcadia", dream: { kind: "bogus", why: "" } }))!.kind !== "bogus", true, "an invalid preset is ignored");
});

test("RR-DREAM-8 the existing dream_roles +15 bonus is separate and unchanged", () => {
  const spec = yamlSpec();
  const anchor = (spec as any).dream_roles.like?.[0]?.company;
  const j = job({ company: anchor || "Sunrun" });
  const before = S.scoreJob(j, spec);
  const after = S.scoreJob(j, { ...spec, dream: dreamSpec.dream } as any);
  assert.equal(after.parts.dream, before.parts.dream);
  assert.equal(after.score, before.score);
});

test("RR-DREAM-9 the scoring bundle exposes dreamBucketOf and agrees with src (what the page calls)", async () => {
  const { bundle } = await import("../scripts/build.mjs" as string);
  const sandbox: Record<string, any> = {};
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(bundle("scoring"), sandbox);
  const B = sandbox.RoleRadarScoring;
  assert.equal(typeof B.dreamBucketOf, "function", "window.RoleRadarScoring.dreamBucketOf");
  const j = job({ company: "Arcadia" });
  assert.deepEqual(JSON.parse(JSON.stringify(B.dreamBucketOf(j, dreamSpec))), JSON.parse(JSON.stringify(call(j))));
});

test("RR-DREAM-10 the scan template tells the scan to set job.dream by the same rules and never to change scores for it", () => {
  const t = read("../scan/scan-prompt.template.md");
  assert.match(t, /\bdream\b\s*:\s*\{\s*kind/i, "job fields list dream {kind, why}");
  for (const w of ["dream.companies", "dream.rules", "established_companies", "applied_ai"]) assert.ok(t.includes(w), `mentions ${w}`);
  assert.match(t, /dream[^.\n]*never[^.\n]*(change|affect)[^.\n]*score|never[^.\n]*(change|affect)[^.\n]*score[^.\n]*dream/i, "dream never changes a score");
});

test("RR-DREAM-11 the demo seed has at least 2 made-up dream roles, with a valid kind and a why, at fictional companies", () => {
  const dreams = Object.values<any>(seed.jobs).filter((j) => j.dream);
  assert.ok(dreams.length >= 2, `seed dream roles: ${dreams.length}`);
  for (const j of dreams) {
    assert.ok(["mission", "health", "ai_lab", "applied_ai"].includes(j.dream.kind), `kind ${j.dream.kind}`);
    assert.ok(typeof j.dream.why === "string" && j.dream.why.length > 0);
    assert.ok(!/arcadia|overstory/i.test(j.company), "no real anchor companies in the demo");
  }
});

test("RR-DREAM-15 dream.exclude (fertility, IVF, in vitro, Carrot) beats every match and a job.dream preset; AI for human health still counts", () => {
  const flat = { ...base, dream: { ...dreamSpec.dream, companies: [...dreamSpec.dream.companies, "PathAI"], exclude: ["fertility", "IVF", "in vitro", "Carrot"] } };
  const obj = { ...base, dream: { ...flat.dream, exclude: { keywords: ["fertility", "IVF", "in vitro"], companies: ["Carrot"] } } };
  for (const spec of [flat, obj]) {
    assert.equal(call(job({ company: "Carrot Fertility", title: "Senior PM, Clinical Care" }), spec), null, "company + keyword excluded");
    assert.equal(call(job({ company: "Arcadia", description: "Support IVF patients." }), spec), null, "keyword in the description beats a dream company");
    assert.equal(call(job({ company: "Startupco", title: "Senior PM, In Vitro Diagnostics" }), spec), null, "multi-word keyword, case-insensitive");
    assert.equal(call(job({ company: "Carrot", dream: { kind: "health", why: "set by the scan" } }), spec), null, "a preset is ignored for an excluded role");
    assert.equal(call(job({ company: "PathAI", title: "Senior PM, Pathology AI" }), spec)!.kind, "mission", "PathAI is a dream company");
    assert.equal(call(job({ company: "Medvision", title: "Senior PM, Clinical AI" }), spec)!.kind, "health", "health AI still counts");
    assert.equal(call(job({ company: "Arcadia", title: "Senior PM, Carrots Supply" }), spec)!.kind, "mission", "whole-word: Carrots is not Carrot");
  }
});

let browser: Browser;
before(async () => { browser = await chromium.launch(); });
after(async () => { await browser?.close(); });
const openDemo = (opts: Record<string, unknown> = {}) => open(browser, { ...opts, file: "dist/test-dream.html" });
const LAPTOP = { width: 1280, height: 800 };

test("RR-DREAM-12 a Dream quick chip sits with the others, shows a count, toggles and narrows to the dream roles", async () => {
  const { page, errors } = await openDemo(LAPTOP);
  await page.click("#tab-all");
  const want = Object.values<any>(seed.jobs).filter((j) => j.dream && !["skipped"].includes(j.status)).map((j) => j.company).sort();
  const chip = page.locator('#fbar [data-chip="dream"]');
  assert.equal(await chip.count(), 1, "Dream chip present");
  assert.match(await chip.innerText(), /Dream\D*\d+/, "label carries a count");
  assert.equal(await chip.getAttribute("aria-pressed"), "false");
  await chip.click();
  await page.waitForTimeout(120);
  assert.equal(await page.locator('#fbar [data-chip="dream"]').getAttribute("aria-pressed"), "true");
  const cos = (await page.locator("#view article.job .co").allInnerTexts()).sort();
  assert.ok(cos.length >= 2);
  for (const c of cos) assert.ok(want.includes(c), `${c} is a dream role`);
  await page.click('#fbar [data-chip="dream"]');
  await page.waitForTimeout(120);
  assert.ok((await page.locator("#view article.job").count()) > cos.length, "toggling off restores the list");
  assert.deepEqual(errors, []);
  await page.close();
});

test("RR-DREAM-13 a dream role's card shows a 'Dream: <why>' pill and others do not (both directions)", async () => {
  const { page } = await openDemo(LAPTOP);
  await page.click("#tab-all");
  const [dj] = Object.values<any>(seed.jobs).filter((j) => j.dream);
  const withPill = page.locator("#view article.job", { hasText: dj.company });
  assert.ok(await withPill.first().getByText(`Dream: ${dj.dream.why}`).count(), "pill with the why");
  const plain = page.locator("#view article.job").filter({ hasNotText: "Dream:" });
  assert.ok(await plain.count() > 0, "non-dream cards carry no Dream pill");
  await page.close();
});

test("RR-DREAM-14 a view saved before the Dream chip loads cleanly, and a junk saved dream value is dropped", async () => {
  const { page } = await openDemo(LAPTOP);
  const reload = async (view: unknown) => {
    await page.evaluate((v) => localStorage.setItem("rr-view", JSON.stringify(v)), view);
    await page.reload();
    await page.waitForSelector(".job");
    await page.click("#tab-all"); // the filter bar is on New, Pipeline and All, not Home
  };
  await reload({ q: "", fit: "strong" });
  assert.equal(await page.locator('#fbar [data-chip="dream"]').getAttribute("aria-pressed"), "false");
  await reload({ dream: { evil: 1 } });
  assert.equal(await page.locator('#fbar [data-chip="dream"]').getAttribute("aria-pressed"), "false");
  await reload({ dream: "1" });
  assert.equal(await page.locator('#fbar [data-chip="dream"]').getAttribute("aria-pressed"), "true", "a saved Dream filter persists");
  await page.close();
});

function yamlSpec() {
  const yaml = (s: string) => yamlLib.load(s);
  return yaml(read("../criteria.yaml"));
}
