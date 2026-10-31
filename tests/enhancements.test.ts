// RR-M3.5 enhancements (staff-pm picks for recruiter impact), written test-first: these fail until they land.
//   1. "This morning's digest" card at the top of the New tab: what the weekday scan would send to the phone.
//   2. Deep links: ?tab=<id> opens a tab, #role-<id> jumps to a role card, tab changes update the URL.
// Demo data only (demo/seed.json): every company and role here is made up.
//
// RR-M4.4: the digest card moved off New onto Home (the default tab) as #home-morning "This morning": the top 5 of
// the same ranking. The digest tests below follow it there; tests/home.test.ts holds its full contract.
// Contract the engineer builds to:
//   - #home-morning on Home, before Home's Pipeline cards, with a heading "This morning". Always open (no toggle).
//   - Its entries are links a[href="#role-<id>"], the first min(5, N) of the Criteria tab's #digestPreview list, in
//     the same order. Each entry shows the role's score. Activating one opens the role on its tab (New) and focuses it.
//   - Every role card is article.job with id="role-<_id>" (e.g. id="role-greenhouse-1001").
//   - ?tab=<id> beats the remembered tab (localStorage "rr-tab"); an unknown id falls back to the usual default.
//     Hidden tabs never open by URL: ?tab=people on the public radar-only build stays on the default tab (Home).
//   - Clicking a tab rewrites the URL (history.replaceState) to ?tab=<id>, so a copied URL reopens that tab.
//   - #role-<id> scrolls to and focuses that role's card: from Home on the role's own tab (New or Pipeline);
//     from another tab, switching to All roles if that tab hides it.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chromium } from "playwright";
import type { Browser, BrowserContextOptions, Page } from "playwright";
import { buildDemo } from "../scripts/build-demo.mjs";
import { openDemo as open, openTab } from "../scripts/browser.mjs";

const read = (p: string) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const baseSeed = () => JSON.parse(read("demo/seed.json"), (k, v) => (typeof v === "string" && v.startsWith("@file:") ? read(v.slice(6)) : v));
const SEED = baseSeed();
const label = (id: string) => `${SEED.jobs[id].company} · ${SEED.jobs[id].title}`;

let browser: Browser;
// A browser stand-in whose pages run `init` before the app's scripts (e.g. to set the remembered tab).
const withInit = (init: (arg?: any) => void, arg: unknown) => ({ newPage: async (o?: BrowserContextOptions) => { const p = await browser.newPage(o); await p.addInitScript(init, arg); return p; } });
const clearStorage = () => { try { localStorage.clear(); } catch (_) {} };
const remember = (t: string) => { try { localStorage.clear(); localStorage.setItem("rr-tab", t); } catch (_) {} };
type Opts = Parameters<typeof open>[1] & { publicDemo?: boolean; seed?: Record<string, any>; init?: (arg?: any) => void; initArg?: unknown };
const openDemo = ({ publicDemo = true, seed, init = clearStorage, initArg, ...opts }: Opts = {}) =>
  open(withInit(init, initArg), { html: buildDemo({ publicDemo, ...(seed ? { seed } : {}) }), file: "dist/test-enhancements.html", ready: "#tab-inbox .n", ...opts });

const selectedTab = (page: Page) => page.locator("#tabs [role=tab][aria-selected=true]").getAttribute("id");
const digestCard = (page: Page) => page.locator("#home-morning");
const entryIds = (page: Page) => page.locator('#home-morning a[href^="#role-"]').evaluateAll((as) => as.map((a) => a.getAttribute("href")!.slice(6)));
// Waits until the role card with this id holds focus and sits inside the viewport.
const cardFocusedInView = (page: Page, id: string, timeout = 3000) => page.waitForFunction((id) => {
  const c = document.getElementById("role-" + id);
  if (!c || !c.matches("article.job") || !c.contains(document.activeElement)) return false;
  const r = c.getBoundingClientRect();
  return r.top < innerHeight && r.bottom > 0;
}, id, { timeout });

before(async () => { browser = await chromium.launch(); });
after(async () => { await browser?.close(); });

// ── 1. This morning's digest ───────────────────────────────────────────────────────────────────

test("RR-M3.5-1 every role card carries id=\"role-<id>\" so it can be linked to", async () => {
  const { page } = await openDemo({ width: 1280, height: 800 });
  await page.click("#tab-all");
  const ids = await page.locator("#view article.job").evaluateAll((as) => as.map((a) => a.id));
  assert.ok(ids.length > 0);
  for (const id of ids) assert.match(id, /^role-.+/, "each card has a role-<id> anchor");
  assert.equal(await page.locator("article.job#role-greenhouse-1001").count(), 1);
  await page.close();
});

test("RR-M3.5-2 at 1280px Home opens with 'This morning' (the digest) above the first role card", async () => {
  const { page, errors } = await openDemo({ width: 1280, height: 800 });
  assert.equal(await selectedTab(page), "tab-home");
  assert.equal(await digestCard(page).count(), 1, "#home-morning on Home");
  assert.match(await digestCard(page).locator("h2").innerText(), /^This morning$/);
  const card = await digestCard(page).boundingBox();
  const first = await page.locator("#view article.job").first().boundingBox();
  assert.ok(card!.y < first!.y, "the digest sits above the first role card");
  assert.ok(await page.locator('#home-morning a[href^="#role-"]').first().isVisible());
  assert.deepEqual(errors, []);
  await page.close();
});

test("RR-M3.5-3 the card lists the same roles, in the same order, as the Criteria tab's Digest preview, with scores", async () => {
  const { page } = await openDemo({ width: 1280, height: 800 });
  await digestCard(page).waitFor({ timeout: 3000 });
  const ids = await entryIds(page);
  await openTab(page, "criteria");
  await page.locator("#digestPreview ol.dig li").first().waitFor({ timeout: 3000 });
  const preview = await page.locator("#digestPreview ol.dig li").evaluateAll((lis: HTMLElement[]) =>
    lis.map((li) => ({ text: li.innerText, score: li.querySelector(".score")?.textContent!.trim() })));
  assert.ok(preview.length > 0, "the demo's digest preview has roles");
  assert.equal(ids.length, Math.min(5, preview.length), "the digest's top 5 (after caps)");
  ids.forEach((id, i) => assert.ok(preview[i].text.includes(label(id)), `entry ${i + 1} is ${preview[i].text.split("\n")[0]}, card has ${label(id)}`));
  // Each entry shows the score the digest sends.
  await page.click("#tab-home");
  const entries = await page.locator('#home-morning a[href^="#role-"]').evaluateAll((as: HTMLElement[]) => as.map((a) => (a.closest("li") || a).innerText));
  entries.forEach((t, i) => assert.ok(t.includes(preview[i].score!), `entry ${i + 1} shows score ${preview[i].score}`));
  await page.close();
});

test("RR-M3.5-4 activating a digest entry scrolls to and focuses that role's card", async () => {
  const { page, errors } = await openDemo({ width: 1280, height: 800 });
  await digestCard(page).waitFor({ timeout: 3000 });
  const ids = await entryIds(page);
  assert.ok(ids.length >= 2, "the demo digest has at least two roles");
  const last = ids[ids.length - 1];
  await page.locator(`#home-morning a[href="#role-${last}"]`).click();
  await cardFocusedInView(page, last);
  assert.equal(await selectedTab(page), "tab-inbox", "opens on New: the role is there");
  // Keyboard works too.
  await page.click("#tab-home");
  await page.locator(`#home-morning a[href="#role-${ids[0]}"]`).focus();
  await page.keyboard.press("Enter");
  await cardFocusedInView(page, ids[0]);
  assert.deepEqual(errors, []);
  await page.close();
});

test("RR-M3.5-5 on a 390px phone This morning's first pick shows on Home's first screen, and New's first title on New's", async () => {
  const { page, errors } = await openDemo({ width: 390, height: 844 });
  await digestCard(page).waitFor({ timeout: 3000 });
  assert.match(await digestCard(page).locator("h2").innerText(), /^This morning$/);
  const pick = (await page.locator('#home-morning a[href^="#role-"]').first().boundingBox())!;
  assert.ok(pick.y + pick.height <= 844, `first pick ends at ${Math.round(pick.y + pick.height)}px`);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "no horizontal scroll on Home");
  // New no longer carries the digest, so its first role title still shows on the first screen.
  await page.click("#tab-inbox");
  const box = (await page.locator("#view article.job h2").first().boundingBox())!;
  const line = await page.locator("#view article.job h2").first().evaluate((el) => parseFloat(getComputedStyle(el).lineHeight));
  assert.ok(box.y + line <= 844, `first title line ends at ${Math.round(box.y + line)}px`);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "no horizontal scroll on New");
  assert.deepEqual(errors, []);
  await page.close();
});

test("RR-M3.5-6 with nothing in New, This morning has no picks and a short empty line, never an error", async () => {
  const seed = baseSeed();
  for (const j of Object.values<{ status: string }>(seed.jobs)) if (["new", "viewed"].includes(j.status)) j.status = "skipped";
  const { page, errors } = await openDemo({ seed, width: 1280, height: 800, ready: "#tab-inbox" });
  await page.waitForFunction(() => /\d/.test(document.querySelector("#tab-pipeline .n")?.textContent || ""), null, { timeout: 3000 });
  await digestCard(page).waitFor({ timeout: 3000 });
  assert.equal(await page.locator('#home-morning a[href^="#role-"]').count(), 0);
  assert.ok((await digestCard(page).innerText()).length < 200, "a short empty line, not a wall of text");
  assert.equal(await page.locator("#view [role=alert]").count(), 0);
  assert.deepEqual(errors, []);
  // And the digest only lives on Home (RR-M4.4 moved it off New).
  await page.close();
  const full = await openDemo({ width: 1280, height: 800 });
  for (const t of ["inbox", "all"]) {
    await full.page.click("#tab-" + t);
    assert.equal(await full.page.locator("#home-morning, #digestCard").count(), 0, `no digest on ${t}`);
  }
  await full.page.close();
});

// ── 2. Deep links ──────────────────────────────────────────────────────────────────────────────

test("RR-M3.5-7 ?tab=criteria opens Criteria on the public demo, overriding the remembered tab", async () => {
  const { page, errors } = await openDemo({ query: "?tab=criteria", init: remember, initArg: "all", width: 1280, height: 800 });
  await page.waitForFunction(() => document.querySelector("#view")?.getAttribute("data-tab") === "criteria", null, { timeout: 3000 });
  await page.locator("#critText, #digestPreview").first().waitFor({ timeout: 3000 });
  assert.deepEqual(errors, []);
  await page.close();
});

test("RR-M3.5-8 ?tab=pipeline and ?tab=all open those tabs on the private build too", async () => {
  for (const [q, want] of [["?tab=pipeline", "tab-pipeline"], ["?tab=all", "tab-all"]]) {
    const { page, errors } = await openDemo({ publicDemo: false, query: q, init: remember, initArg: "inbox" });
    await page.waitForFunction((w) => document.getElementById(w)?.getAttribute("aria-selected") === "true", want, { timeout: 3000 });
    assert.deepEqual(errors, []);
    await page.close();
  }
});

test("RR-M3.5-9 an unknown ?tab= falls back to the normal default with no error", async () => {
  const { page, errors } = await openDemo({ query: "?tab=nope%3Cscript%3E" });
  assert.equal(await selectedTab(page), "tab-home");
  assert.ok(await page.locator("#view #home-morning").isVisible());
  assert.deepEqual(errors, []);
  await page.close();
  // With a remembered tab, the fallback is the remembered tab.
  const r = await openDemo({ query: "?tab=bogus", init: remember, initArg: "all" });
  assert.equal(await selectedTab(r.page), "tab-all");
  await r.page.close();
});

test("RR-M3.5-10 ?tab=people never opens Recruiters on the public radar-only demo; the owner's build does open it", async () => {
  const { page, errors } = await openDemo({ query: "?tab=people" });
  assert.equal(await page.locator('#tab-people, #moreSheet [data-tab="people"]').count(), 0, "no Recruiters tab");
  assert.equal(await selectedTab(page), "tab-home");
  assert.equal(await page.locator("#view article.job.rec").count(), 0, "no recruiter cards");
  assert.doesNotMatch(new URL(page.url()).search, /tab=people/, "the URL is not left pointing at a hidden tab");
  assert.deepEqual(errors, []);
  await page.close();
  // Allowed direction: the private build (owner view) opens Recruiters from the link.
  const own = await openDemo({ publicDemo: false, query: "?tab=people" });
  await own.page.waitForFunction(() => document.querySelector("#view")?.getAttribute("data-tab") === "people", null, { timeout: 3000 });
  await own.page.close();
});

test("RR-M3.5-11 clicking a tab rewrites the URL to ?tab=<id>, and that URL reopens the same tab", async () => {
  const { page, errors } = await openDemo({ width: 1280, height: 800 });
  const entries = await page.evaluate(() => history.length); // about:blank + the demo: 2 before any click
  await page.click("#tab-pipeline");
  await page.waitForFunction(() => new URLSearchParams(location.search).get("tab") === "pipeline", null, { timeout: 3000 });
  assert.equal(await page.evaluate(() => history.length), entries, "replaceState, not a new history entry per tab");
  const copied = new URL(page.url()).search;
  await page.close();
  // A fresh visitor (nothing remembered) opens the copied link.
  const again = await openDemo({ query: copied, width: 1280, height: 800 });
  assert.equal(await selectedTab(again.page), "tab-pipeline");
  assert.deepEqual(errors, []);
  await again.page.close();
});

test("RR-M3.5-12 #role-<id> scrolls to and focuses that card on New", async () => {
  const id = "himalayas-1006"; // a New role far enough down to need a scroll at 390px
  const { page, errors } = await openDemo({ query: "#role-" + id, width: 390, height: 844 });
  await cardFocusedInView(page, id);
  assert.equal(await selectedTab(page), "tab-inbox");
  assert.deepEqual(errors, []);
  await page.close();
});

test("RR-M3.5-13 #role-<id> for a role New hides switches to All roles and focuses it; from Home it opens on Pipeline", async () => {
  const id = "greenhouse-1007"; // applied, so not on New
  const { page, errors } = await openDemo({ query: "?tab=inbox#role-" + id, width: 1280, height: 800 });
  await cardFocusedInView(page, id);
  assert.equal(await selectedTab(page), "tab-all");
  assert.deepEqual(errors, []);
  await page.close();
  const home = await openDemo({ query: "#role-" + id, width: 1280, height: 800 });
  await cardFocusedInView(home.page, id);
  assert.equal(await selectedTab(home.page), "tab-pipeline");
  assert.deepEqual(home.errors, []);
  await home.page.close();
});

test("RR-M3.5-14 an unknown #role-<id> is ignored: default tab, no error", async () => {
  const { page, errors } = await openDemo({ query: "#role-does-not-exist" });
  assert.equal(await selectedTab(page), "tab-home");
  assert.ok(await page.locator("#view #home-morning").isVisible());
  assert.deepEqual(errors, []);
  await page.close();
});
