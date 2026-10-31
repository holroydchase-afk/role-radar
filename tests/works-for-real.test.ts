// RR-M3.2 "works for real": day-one gaps a real user of the live page hits.
// Written test-first (these fail until the fixes land). Demo data only: every name here is made up.
//
// Mock hooks the engineer must add to demo/mock-claude.js (read from the page URL's query string):
//   ?fail=<collection>  collection(name).onSnapshot(cb, onError) never calls cb; it calls onError
//                       (on a microtask) with an Error, like a denied or broken read on claude.ai.
//   ?hold=<collection>  collection(name).onSnapshot(cb) does not deliver its first snapshot until the
//                       test calls window.__RR_RELEASE__("<collection>"), so the pre-load state can be seen.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { chromium } from "playwright";
import type { Browser, Page } from "playwright";
import yaml from "js-yaml";
import { buildDemo } from "../scripts/build-demo.mjs";
import { openDemo as open, openTab } from "../scripts/browser.mjs";

const read = (p: string) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const baseSeed = () => JSON.parse(read("demo/seed.json"), (k, v) => (typeof v === "string" && v.startsWith("@file:") ? read(v.slice(6)) : v));
const FILE = "dist/test-works-for-real.html";
let browser: Browser;
const openSeed = (seed?: Record<string, any> | null, opts: Parameters<typeof open>[1] = {}) => open(browser, { html: buildDemo(seed ? { seed } : {}), file: FILE, ready: "#tab-inbox", ...opts });
const toastMatches = (page: Page, re: RegExp, timeout = 3000) =>
  page.waitForFunction((src) => new RegExp(src, "i").test(document.querySelector("#toast")?.textContent || ""), re.source, { timeout });

// Opens the demo with the page's clock fixed at `now` (America/New_York), for the stale-scan checks.
async function openAt(seed: Record<string, any>, now: string | number) {
  const out = new URL("../" + FILE, import.meta.url).pathname;
  mkdirSync(new URL("../dist/", import.meta.url).pathname, { recursive: true });
  writeFileSync(out, buildDemo({ seed }));
  const page = await browser.newPage({ viewport: { width: 900, height: 1200 }, timezoneId: "America/New_York" });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.clock.setFixedTime(new Date(now));
  await page.route("https://cdnjs.cloudflare.com/**", (r) => r.fulfill({ contentType: "text/javascript", body: read("node_modules/js-yaml/dist/js-yaml.min.js") }));
  await page.route("https://fonts.googleapis.com/**", (r) => r.fulfill({ contentType: "text/css", body: "" }));
  await page.goto("file://" + out);
  await page.waitForFunction(() => /^Scan\b/.test(document.querySelector("#scanLine")?.textContent || ""));
  return { page, errors };
}
const staleWarning = (page: Page) => page.locator("[role=status], [role=alert]").filter({ hasText: /scan hasn.t run since/i });
const seedWithScan = (lastRun: string) => { const s = baseSeed(); s.meta.scan = { ...s.meta.scan, lastRun }; return s; };

before(async () => { browser = await chromium.launch(); });
after(async () => { await browser?.close(); });

// ── 1. P0: a new user with no criteria can write or start from the example ──────────────────

test("RR-M3.2-1 with no criteria saved, the Criteria tab shows an empty editor and a 'Start from the example' button", async () => {
  const { page, errors } = await openSeed({});
  await openTab(page, "criteria");
  await page.locator("#critText").waitFor({ state: "visible", timeout: 3000 });
  assert.equal(await page.locator("#critText").inputValue(), "");
  assert.equal(await page.getByRole("button", { name: /start from the example/i }).count(), 1);
  assert.equal(await page.getByRole("button", { name: /save criteria/i }).count(), 1);
  assert.deepEqual(errors, []);
  await page.close();
});

test("RR-M3.2-2 'Start from the example' fills the editor with the repo's example criteria without saving", async () => {
  const { page } = await openSeed({});
  await openTab(page, "criteria");
  await page.getByRole("button", { name: /start from the example/i }).click({ timeout: 3000 });
  const filled = await page.locator("#critText").inputValue();
  assert.deepEqual(yaml.load(filled), yaml.load(read("criteria.yaml")), "editor holds criteria.yaml");
  // Not saved yet: discarding goes back to an empty editor.
  await page.click("#critReset");
  await page.locator("#critText").waitFor({ state: "visible" });
  assert.equal(await page.locator("#critText").inputValue(), "");
  await page.close();
});

test("RR-M3.2-3 a new user's first Save works and the criteria persist across tabs", async () => {
  const { page, errors } = await openSeed({});
  await openTab(page, "criteria");
  await page.getByRole("button", { name: /start from the example/i }).click({ timeout: 3000 });
  await page.getByRole("button", { name: /save criteria/i }).click();
  await toastMatches(page, /criteria saved/);
  await page.click("#tab-inbox");
  await openTab(page, "criteria");
  await page.getByRole("heading", { name: /sector weights/i }).waitFor({ timeout: 3000 });
  assert.deepEqual(yaml.load(await page.locator("#critText").inputValue()), yaml.load(read("criteria.yaml")));
  assert.deepEqual(errors, []);
  await page.close();
});

// ── 2. P1: a stale scan is called out (weekend-aware) ─────────────────────────────────────────

test("RR-M3.2-4 a scan from 2 business days ago shows 'Scan hasn't run since <date>'", async () => {
  // Now: Wed 2026-10-28 09:00 ET. Last scan: Mon 2026-10-26 07:50 ET.
  const { page } = await openAt(seedWithScan("2026-10-26T11:50:00Z"), "2026-10-28T13:00:00Z");
  const w = staleWarning(page);
  await w.first().waitFor({ state: "visible", timeout: 3000 });
  assert.match(await w.first().innerText(), /Oct(ober)?\s*26|10\/26/);
  await page.close();
});

test("RR-M3.2-5 Friday's scan on Tuesday morning is stale (weekend skipped, still 2 business days)", async () => {
  // Now: Tue 2026-10-27 09:00 ET. Last scan: Fri 2026-10-23 07:50 ET.
  const { page } = await openAt(seedWithScan("2026-10-23T11:50:00Z"), "2026-10-27T13:00:00Z");
  await staleWarning(page).first().waitFor({ state: "visible", timeout: 3000 });
  await page.close();
});

test("RR-M3.2-6 fresh scans show no warning: this morning's, and Friday's on Monday morning", async () => {
  for (const [lastRun, now] of [
    ["2026-10-28T11:50:00Z", "2026-10-28T13:00:00Z"], // Wed scan, Wed 09:00
    ["2026-10-23T11:50:00Z", "2026-10-26T13:00:00Z"], // Fri scan, Mon 09:00
    ["2026-10-27T11:50:00Z", "2026-10-28T11:00:00Z"], // Tue scan, Wed 07:00 before today's run
  ]) {
    const { page } = await openAt(seedWithScan(lastRun), now);
    assert.equal(await staleWarning(page).count(), 0, `no warning for ${lastRun} at ${now}`);
    assert.doesNotMatch(await page.locator("body").innerText(), /hasn.t run since/i);
    await page.close();
  }
});

// ── 3. P1: loading and failed loads never look like an empty tracker ──────────────────────────

test("RR-M3.2-7 before the first jobs snapshot the Inbox shows a loading state, not 'Nothing new right now'", async () => {
  const { page } = await openSeed(null, { query: "?hold=jobs" });
  await page.waitForFunction(() => /loading/i.test(document.querySelector<HTMLElement>("#view")?.innerText || ""), null, { timeout: 3000 });
  assert.doesNotMatch(await page.locator("#view").innerText(), /Nothing new right now/);
  await page.evaluate(() => window.__RR_RELEASE__("jobs"));
  await page.locator("#view .job").first().waitFor({ timeout: 3000 });
  await page.close();
});

test("RR-M3.2-8 a failed jobs read shows 'Couldn't load your roles' with Reload, never the empty state", async () => {
  const { page, errors } = await openSeed(null, { query: "?fail=jobs" });
  const alert = page.locator("[role=alert]").filter({ hasText: /couldn.t load your roles/i });
  await alert.first().waitFor({ state: "visible", timeout: 3000 });
  assert.equal(await page.getByRole("button", { name: /reload/i }).count() > 0, true, "has a Reload button");
  for (const id of ["inbox", "pipeline", "all"]) {
    await openTab(page, id);
    const text = await page.locator("#view").innerText();
    assert.doesNotMatch(text, /Nothing new right now|Nothing in the pipeline|No roles yet/, id);
    assert.match(text, /couldn.t load your roles/i, id);
  }
  assert.deepEqual(errors.filter((e) => !/fail|demo/i.test(e)), []);
  await page.close();
});

// ── 4. P1: adding something that's already tracked never overwrites it ────────────────────────

async function addRole(page: Page, company: string, title: string, status: string) {
  if (!(await page.locator("#addJob").isVisible())) await page.locator("#addRole summary").click();
  await page.fill("#aj-co", company);
  await page.fill("#aj-ti", title);
  await page.selectOption("#aj-st", status);
  await page.locator("#addJob button[type=submit]").click();
}
// RR-M4.3: the card has no status chip; its one date says the status ("Applied Oct 28").
const cardsFor = (page: Page, title: string) => page.locator("#view .job").filter({ hasText: title });

test("RR-M3.2-9 adding a role the scan already found says it's tracked and adds no duplicate", async () => {
  const { page } = await openSeed(null);
  await page.click("#tab-pipeline");
  const title = "Senior Product Manager, Installer Platform"; // Brightwell Solar, Applied in the demo seed
  await addRole(page, "Brightwell Solar", title, "saved");
  await toastMatches(page, /already/);
  await page.click("#tab-all");
  await cardsFor(page, title).first().waitFor();
  assert.equal(await cardsFor(page, title).count(), 1, "one card, no duplicate");
  assert.equal(await cardsFor(page, title).locator(".meta", { hasText: /^Applied |· Applied / }).count(), 1, "still Applied");
  await page.close();
});

test("RR-M3.2-10 adding the same manual role twice keeps the first one's status", async () => {
  const { page } = await openSeed(null);
  await page.click("#tab-pipeline");
  const title = "Senior PM, Duplicate Check (demo)";
  await addRole(page, "Quillfern Labs (demo)", title, "applied");
  await cardsFor(page, title).first().waitFor({ timeout: 3000 });
  await addRole(page, "Quillfern Labs (demo)", title, "saved");
  await toastMatches(page, /already/);
  await page.click("#tab-all");
  assert.equal(await cardsFor(page, title).count(), 1);
  assert.equal(await cardsFor(page, title).locator(".meta", { hasText: /^Applied |· Applied / }).count(), 1, "status not overwritten to Saved");
  await page.close();
});

test("RR-M3.2-11 re-adding a vetoed company doesn't silently un-veto it", async () => {
  const { page } = await openSeed(null);
  await openTab(page, "watch");
  await page.fill("#coName", "QuickCash Advance");
  await page.selectOption("#coAts", "greenhouse");
  await page.fill("#coSlug", "quickcash");
  await page.locator("#addCo button[type=submit]").click();
  await toastMatches(page, /already|never show/);
  const row = page.locator("#view .row").filter({ hasText: "QuickCash Advance" });
  assert.equal(await row.count(), 1);
  assert.equal(await row.getByRole("button", { name: "Restore" }).count(), 1, "still under Never show");
  await page.close();
});
