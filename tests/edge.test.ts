// Edge cases: the page on empty, broken or partial data, in headless Chromium.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chromium } from "playwright";
import type { Browser, Page } from "playwright";
import { buildDemo } from "../scripts/build-demo.mjs";
import { openDemo as open } from "../scripts/browser.mjs";

const TABS = ["inbox", "pipeline", "action", "all", "people", "criteria", "watch", "filters"];
const read = (p: string) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const baseSeed = () => JSON.parse(read("demo/seed.json"), (k, v) => (typeof v === "string" && v.startsWith("@file:") ? read(v.slice(6)) : v));
let browser: Browser;
const openSeed = (seed: Record<string, any>, opts: Parameters<typeof open>[1] = {}) =>
  open(browser, { html: buildDemo({ seed }), file: "dist/test-edge.html", ready: "#tab-inbox", ...opts });

async function everyTab(page: Page) {
  const out: Record<string, string> = {};
  for (const id of TABS) {
    await page.click(`#tab-${id}`);
    out[id] = (await page.locator("#view").innerText()).trim();
    assert.ok(out[id].length > 0, `${id} is blank`);
  }
  return out;
}

before(async () => { browser = await chromium.launch(); });
after(async () => { await browser?.close(); });

test("a brand-new tracker with no data renders every tab", async () => {
  const { page, errors } = await openSeed({});
  const text = await everyTab(page);
  assert.match(text.people, /No recruiters yet/);
  assert.deepEqual(errors, []);
  await page.close();
});

test("criteria that are not valid YAML show an error, not a blank tab", async () => {
  const seed = baseSeed();
  seed.meta.criteria = { spec: "sectors: [unclosed\n  weight: : :" };
  const { page, errors } = await openSeed(seed);
  const text = await everyTab(page);
  await page.click("#tab-criteria");
  assert.ok(await page.locator("#view .err").count() > 0, text.criteria);
  assert.deepEqual(errors, []);
  await page.close();
});

test("criteria with odd shapes don't break scoring or the preview", async () => {
  const seed = baseSeed();
  for (const spec of ["just a string", "sectors: 3\nscoring: null", "sectors:\n  - id: x\n    weight: high\ncomp: []"]) {
    seed.meta.criteria = { spec };
    const { page, errors } = await openSeed(seed);
    await everyTab(page);
    assert.deepEqual(errors, [], spec);
    await page.close();
  }
});

test("jobs with missing fields still render", async () => {
  const seed = baseSeed();
  seed.jobs = { bare: {}, odd: { title: 42, company: null, score: "high", status: "unknown-status", comp: { min: "x" }, dateFound: "not a date" } };
  seed.recruiters = { r1: {}, r2: { name: "Casey (demo)", nextStepDue: "nonsense" } };
  const { page, errors } = await openSeed(seed);
  await everyTab(page);
  assert.deepEqual(errors, []);
  await page.close();
});

test("due dates: past ones are flagged, future ones are not", async () => {
  const seed = baseSeed();
  seed.recruiters = {
    late: { name: "Late Lee (demo)", company: "Pastco", nextStep: "Follow up", nextStepDue: "@d-3" },
    soon: { name: "Soon Sato (demo)", company: "Futureco", nextStep: "Follow up", nextStepDue: "@d--3" },
  };
  const { page, errors } = await openSeed(seed);
  await page.click("#tab-people");
  const late = await page.locator(".rec", { hasText: "Pastco" }).locator(".next").innerText();
  const soon = await page.locator(".rec", { hasText: "Futureco" }).locator(".next").innerText();
  assert.match(late, /due /);
  assert.doesNotMatch(soon, /due /);
  assert.equal((await page.locator("#tab-people").innerText()).replace(/\D/g, ""), "1");
  assert.deepEqual(errors, []);
  await page.close();
});

test("board health copes with missing and junk coverage fields", async () => {
  const seed = baseSeed();
  seed.meta.scan.coverage = { mode: null, attempted: "x", failedList: ["Acme", null, { error: "no name" }], moved: [null, {}], sources: "nope" };
  seed.companies["greenhouse-sunfield"] = { name: "Sunfield Energy", failStreak: "lots", lastOk: "not a date", status: "active" };
  const { page, errors } = await openSeed(seed);
  await page.click("#tab-watch");
  const t = await page.locator(".health").innerText();
  assert.match(t, /Boards: 0\/0 read/);
  assert.match(t, /Failed\s*Acme/);
  delete seed.meta.scan.coverage;
  const again = await openSeed(seed);
  await again.page.click("#tab-watch");
  assert.match(await again.page.locator(".health").innerText(), /after the next scan run/);
  assert.deepEqual(errors, []);
  assert.deepEqual(again.errors, []);
  await page.close(); await again.page.close();
});
