// RR-M4.1 header and tab bar declutter (ux-reviewer UX-H-R1, R2, R8 and the tab half of R6; ACs UX-H-AC1, AC2,
// AC3, AC14). A title plus one line; tabs Home · New · Pipeline · All · More (Home added in M4.4, see tests/home.test.ts);
// the rest moves into a More sheet so nothing is lost. Demo data only (demo/seed.json); red first.
//
// Contract the engineer builds to (stable selectors):
//   Header
//   - At most one visible text line under <h1> on the live layout. Demo-only explainers (#demoNote, #demoTry, #lede,
//     #showcase) are not counted. #progress (Today/This week) is hidden or gone; #scanLine holds no Today/This week
//     counts and no board count, and reads like `Scan 8:24 AM · 6 new` with N = the New tab count.
//   - Stale scan: #scanStale stays (role=status, "Scan hasn't run since <date>") and is then the only meta line.
//   Tab bar
//   - #tabs holds exactly five visible buttons, in order: #tab-home (Home), #tab-inbox (New), #tab-pipeline (Pipeline),
//     #tab-all (All), #moreBtn (More). Same in the private and public builds.
//   - Only New and Pipeline show a count (`.n`). All and More show none.
//   - #tabs scrollWidth <= clientWidth at 360, 390 and 1280; every tab button is >= 44px tall.
//   - #moreBtn: aria-haspopup="dialog", aria-expanded="true|false", aria-controls="moreSheet". When a recruiter
//     follow-up is due (private build only) it shows a dot `#moreBtn .dot` and its accessible name says "<N> due"
//     (aria-label or visually hidden text). When a More tab is open, #moreBtn has aria-current="page".
//   More sheet (reuse the PR #57 Filters sheet pattern: .sheet + scrim)
//   - #moreSheet: role="dialog", visible only while open, rendered on every tab (not only where #fbar exists).
//   - Rows are buttons `#moreSheet [data-tab="<id>"]`, in order: people (Recruiters, private build only, text
//     includes "<N> due"), ruled (Ruled out), criteria (Criteria), watch (Watchlist), filters (Scan rules).
//     Needs action and Progress left More in M4.4 (Home's Get ready and More stats). Each row is >= 48px tall.
//   - Picking a row opens that tab, closes the sheet, and rewrites the URL to ?tab=<id> (as tabs do today).
//   - Escape closes the sheet and puts focus back on #moreBtn.
//   Open tab hook
//   - #view carries data-tab="<id>" for the tab it is showing (tabs inside More have no #tab-<id> button any more).
//   Deep links: ?tab=ruled, ?tab=criteria (and the other More ids) still open their tab. Since M4.4 the old
//   ?tab=action and ?tab=progress open Home.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chromium } from "playwright";
import type { Browser, Page } from "playwright";
import { buildDemo } from "../scripts/build-demo.mjs";
import { openDemo as open } from "../scripts/browser.mjs";

const read = (p: string) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const baseSeed = () => JSON.parse(read("demo/seed.json"), (k, v) => (typeof v === "string" && v.startsWith("@file:") ? read(v.slice(6)) : v));
// Recruiters whose next step is due today or earlier ("@d-N", N >= 0), the number Recruiters shows as due.
const DUE = Object.values(baseSeed().recruiters as Record<string, { nextStepDue?: string }>)
  .filter((r) => /^@d-\d+$/.test(r.nextStepDue || "")).length;

let browser: Browser;
type Opts = Parameters<typeof open>[1] & { publicDemo?: boolean; seed?: Record<string, any> };
const openDemo = ({ publicDemo = false, seed, ...opts }: Opts = {}) =>
  open(browser, { html: buildDemo({ publicDemo, ...(seed ? { seed } : {}) }), file: "dist/test-declutter.html", ready: "#tabs button", ...opts });
const PHONE = { width: 390, height: 844 };
const SMALL = { width: 360, height: 740 };
const LAPTOP = { width: 1280, height: 800 };
const settle = (page: Page) => page.waitForTimeout(120);
const BUILDS: [string, boolean][] = [["private", false], ["public", true]];
const MORE_ROWS = [["people", "Recruiters"], ["ruled", "Ruled out"], ["criteria", "Criteria"], ["watch", "Watchlist"], ["filters", "Scan rules"]] as const;

const visibleTabIds = (page: Page) => page.locator("#tabs button").evaluateAll((els: HTMLElement[]) =>
  els.filter((e) => e.offsetParent && e.getBoundingClientRect().width > 0).map((e) => e.id));
const viewTab = (page: Page) => page.locator("#view").getAttribute("data-tab");
const waitViewTab = (page: Page, id: string) =>
  page.waitForFunction((id) => document.querySelector("#view")?.getAttribute("data-tab") === id, id, { timeout: 3000 });
const sheetOpen = (page: Page) => page.locator("#moreSheet").isVisible().catch(() => false);
const openMore = async (page: Page) => {
  await page.click("#moreBtn");
  await page.locator("#moreSheet").waitFor({ state: "visible", timeout: 2000 });
};
// Header text lines under the title, as the live app shows them (demo-only explainers are not counted).
const metaLines = (page: Page) => page.evaluate(() => {
  const skip = "h1, #demoNote, #demoTry, #lede, #showcase, #showcase *";
  const leaves = [...document.querySelectorAll<HTMLElement>("header p, header span, header div")]
    .filter((e) => !e.matches(skip) && !e.closest("#showcase") && e.offsetParent && e.getBoundingClientRect().height > 0)
    .filter((e) => [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim()));
  return leaves.map((e) => {
    const lh = parseFloat(getComputedStyle(e).lineHeight) || parseFloat(getComputedStyle(e).fontSize) * 1.4;
    return { id: e.id || e.className, text: e.innerText.trim(), rows: Math.round(e.getBoundingClientRect().height / lh) };
  });
});

before(async () => { browser = await chromium.launch(); });
after(async () => { await browser?.close(); });

// ── Header (UX-H-R1, UX-H-AC1) ────────────────────────────────────────────────────────────────

test("DCL-1 UX-H-AC1 the header is the title plus one line: no Today/This week counts, no board count, 'N new' = New", async () => {
  const bad: string[] = [];
  for (const vp of [PHONE, LAPTOP]) {
    const { page, errors } = await openDemo({ ...vp, ready: "#tab-inbox .n" });
    await page.waitForFunction(() => /\S/.test(document.querySelector("#scanLine")?.textContent || ""));
    const lines = await metaLines(page);
    if (lines.length > 1) bad.push(`${vp.width}: ${lines.length} header lines: ${lines.map((l) => `${l.id}="${l.text}"`).join(" | ")}`);
    for (const l of lines) if (l.rows > 1) bad.push(`${vp.width}: ${l.id} wraps onto ${l.rows} rows`);
    if (await page.locator("#progress").isVisible().catch(() => false)) bad.push(`${vp.width}: #progress (Today/This week) still shows`);
    const line = await page.locator("#scanLine").innerText();
    if (/today|this week/i.test(line)) bad.push(`${vp.width}: scan line has Today/This week: ${line}`);
    if (/boards?\b/i.test(line)) bad.push(`${vp.width}: scan line still counts boards (moves to Home): ${line}`);
    const n = /(\d+) new\b/.exec(line)?.[1];
    const newTab = (await page.locator("#tab-inbox .n").innerText()).replace(/\D/g, "");
    if (!/^Scan\b/.test(line) || n !== newTab) bad.push(`${vp.width}: want "Scan <time> · ${newTab} new", got "${line}"`);
    assert.deepEqual(errors, []);
    await page.close();
  }
  assert.deepEqual(bad, []);
});

test("DCL-2 UX-H-AC1 a stale scan keeps its warning, and the warning is then the only header line", async () => {
  const seed = baseSeed();
  seed.meta.scan.lastRun = "@t-10";
  const { page, errors } = await openDemo({ ...PHONE, seed, ready: "#tab-inbox .n" });
  await page.locator("#scanStale").waitFor({ state: "visible", timeout: 3000 });
  assert.match(await page.locator("#scanStale").innerText(), /hasn't run since/);
  const lines = await metaLines(page);
  assert.deepEqual(lines.map((l) => l.id), ["scanStale"], `one line, the warning: ${JSON.stringify(lines)}`);
  assert.deepEqual(errors, []);
  await page.close();
});

// ── Tab bar (UX-H-R2, UX-H-AC2 for M4.1) ──────────────────────────────────────────────────────

test("DCL-3 UX-H-AC2 the tab bar is Home, New, Pipeline, All, More in both builds; only New and Pipeline show counts", async () => {
  for (const [name, publicDemo] of BUILDS) {
    const { page, errors } = await openDemo({ ...LAPTOP, publicDemo, ready: "#tab-inbox .n" });
    assert.deepEqual(await visibleTabIds(page), ["tab-home", "tab-inbox", "tab-pipeline", "tab-all", "moreBtn"], `${name}: tab bar`);
    const labels = await page.locator("#tabs button").evaluateAll((els: HTMLElement[]) => els.filter((e) => e.offsetParent)
      .map((e) => [...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join("").trim()));
    assert.deepEqual(labels, ["Home", "New", "Pipeline", "All", "More"], `${name}: labels`);
    const counted = await page.locator("#tabs .n").evaluateAll((els: HTMLElement[]) => els.filter((e) => e.offsetParent).map((e) => e.closest("button")!.id));
    assert.deepEqual(counted, ["tab-inbox", "tab-pipeline"], `${name}: only New and Pipeline carry a count`);
    for (const id of ["tab-home", "tab-all", "moreBtn"]) assert.doesNotMatch(await page.locator("#" + id).innerText(), /\d/, `${name}: ${id} shows no number`);
    assert.deepEqual(errors, []);
    await page.close();
  }
});

test("DCL-4 UX-H-AC2 #tabs never scrolls sideways at 360, 390 or 1280, and every tab is at least 44px tall", async () => {
  const bad: string[] = [];
  for (const [name, publicDemo] of BUILDS) for (const vp of [SMALL, PHONE, LAPTOP]) {
    const { page } = await openDemo({ ...vp, publicDemo });
    const t = await page.locator("#tabs").evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth,
      short: [...el.querySelectorAll<HTMLElement>("button")].filter((b) => b.offsetParent && b.getBoundingClientRect().height < 44).map((b) => b.id) }));
    if (t.sw > t.cw) bad.push(`${name} ${vp.width}: #tabs scrollWidth ${t.sw} > clientWidth ${t.cw}`);
    if (t.short.length) bad.push(`${name} ${vp.width}: under 44px: ${t.short.join(", ")}`);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (over > 0) bad.push(`${name} ${vp.width}: page scrolls sideways by ${over}px`);
    await page.close();
  }
  assert.deepEqual(bad, []);
});

// ── More sheet (UX-H-R2, R8, UX-H-AC3) ────────────────────────────────────────────────────────

test("DCL-5 UX-H-AC3 More opens a dialog listing Recruiters (with due count), Ruled out, Criteria, Watchlist, Scan rules", async () => {
  const { page, errors } = await openDemo({ ...PHONE, ready: "#tab-inbox .n" });
  const more = page.locator("#moreBtn");
  assert.equal(await more.getAttribute("aria-haspopup"), "dialog");
  assert.equal(await more.getAttribute("aria-controls"), "moreSheet");
  assert.equal(await more.getAttribute("aria-expanded"), "false");
  assert.equal(await sheetOpen(page), false, "closed until asked");
  await openMore(page);
  assert.equal(await more.getAttribute("aria-expanded"), "true");
  assert.equal(await page.locator("#moreSheet").getAttribute("role"), "dialog");
  const rows = await page.locator("#moreSheet [data-tab]").evaluateAll((els: HTMLElement[]) => els.filter((e) => e.offsetParent).map((e) => e.dataset.tab));
  assert.deepEqual(rows, MORE_ROWS.map(([id]) => id), "rows in order");
  for (const [id, label] of MORE_ROWS) assert.match(await page.locator(`#moreSheet [data-tab="${id}"]`).innerText(), new RegExp(`^${label}`), `${id} row label`);
  assert.match(await page.locator('#moreSheet [data-tab="people"]').innerText(), new RegExp(`\\b${DUE} due\\b`), "Recruiters row shows the due count");
  assert.deepEqual(errors, []);
  await page.close();
});

test("DCL-6 UX-H-AC3 every More row is at least 48px tall and the open sheet never scrolls the page sideways at 360", async () => {
  const { page } = await openDemo({ ...SMALL, ready: "#tab-inbox .n" });
  await openMore(page);
  const short = await page.locator("#moreSheet [data-tab]").evaluateAll((els: HTMLElement[]) =>
    els.filter((e) => e.offsetParent && e.getBoundingClientRect().height < 48).map((e) => `${e.dataset.tab} ${Math.round(e.getBoundingClientRect().height)}px`));
  assert.deepEqual(short, []);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "no sideways scroll with More open");
  await page.close();
});

test("DCL-7 UX-H-AC3 Escape closes More and puts focus back on the More button", async () => {
  const { page } = await openDemo({ ...PHONE, ready: "#tab-inbox .n" });
  await openMore(page);
  await page.keyboard.press("Escape");
  await settle(page);
  assert.equal(await sheetOpen(page), false, "sheet closed");
  assert.equal(await page.locator("#moreBtn").getAttribute("aria-expanded"), "false");
  assert.equal(await page.evaluate(() => document.activeElement?.id), "moreBtn");
  // Also from a tab with no filter bar (Criteria): the sheet is not tied to #fbar.
  await openMore(page);
  await page.click('#moreSheet [data-tab="criteria"]');
  await waitViewTab(page, "criteria");
  await openMore(page);
  await page.keyboard.press("Escape");
  await settle(page);
  assert.equal(await sheetOpen(page), false);
  assert.equal(await page.evaluate(() => document.activeElement?.id), "moreBtn");
  await page.close();
});

test("DCL-8 picking a More row opens that tab, closes the sheet, marks More current and rewrites the URL", async () => {
  const { page, errors } = await openDemo({ ...LAPTOP, ready: "#tab-inbox .n" });
  for (const [id] of MORE_ROWS) {
    await openMore(page);
    await page.click(`#moreSheet [data-tab="${id}"]`);
    await waitViewTab(page, id);
    assert.equal(await sheetOpen(page), false, `${id}: sheet closes`);
    assert.equal(new URL(page.url()).searchParams.get("tab"), id, `${id}: URL`);
    assert.equal(await page.locator("#moreBtn").getAttribute("aria-current"), "page", `${id}: More marked current`);
  }
  await page.click("#tab-all");
  await waitViewTab(page, "all");
  assert.notEqual(await page.locator("#moreBtn").getAttribute("aria-current"), "page", "More not current on All");
  assert.equal(await page.locator("#tab-all").getAttribute("aria-selected"), "true");
  assert.deepEqual(errors, []);
  await page.close();
});

test("DCL-9 deep links ?tab=ruled, criteria, watch and filters still open their tabs; the old action and progress links open Home (both builds)", async () => {
  for (const [name, publicDemo] of BUILDS) for (const id of ["ruled", "criteria", "watch", "filters"]) {
    const { page, errors } = await openDemo({ ...LAPTOP, publicDemo, query: `?tab=${id}` });
    await waitViewTab(page, id);
    assert.equal(await viewTab(page), id, `${name}: ?tab=${id}`);
    assert.equal(await page.locator("#moreBtn").getAttribute("aria-current"), "page", `${name} ${id}: More marked current`);
    assert.deepEqual(errors, [], `${name} ${id}`);
    await page.close();
  }
  for (const [name, publicDemo] of BUILDS) for (const id of ["action", "progress"]) {
    const { page, errors } = await openDemo({ ...LAPTOP, publicDemo, query: `?tab=${id}` });
    await waitViewTab(page, "home").catch(() => {});
    assert.equal(await viewTab(page), "home", `${name}: ?tab=${id} opens Home`);
    assert.notEqual(await page.locator("#moreBtn").getAttribute("aria-current"), "page", `${name} ${id}: More not current on Home`);
    assert.deepEqual(errors, [], `${name} ${id}`);
    await page.close();
  }
});

test("DCL-10 privacy: the public demo's More has no Recruiters row and no due dot; the owner's build has both", async () => {
  const pub = await openDemo({ ...PHONE, publicDemo: true, ready: "#tab-inbox .n" });
  assert.equal(await pub.page.locator("#moreBtn .dot").count(), 0, "public: no due dot");
  assert.doesNotMatch((await pub.page.locator("#moreBtn").getAttribute("aria-label")) || "", /due/, "public: no due in the name");
  await openMore(pub.page);
  const rows = await pub.page.locator("#moreSheet [data-tab]").evaluateAll((els: HTMLElement[]) => els.filter((e) => e.offsetParent).map((e) => e.dataset.tab));
  assert.deepEqual(rows, MORE_ROWS.filter(([id]) => id !== "people").map(([id]) => id), "public rows");
  assert.doesNotMatch(await pub.page.locator("#moreSheet").innerText(), /Recruiter|\bdue\b/i);
  await pub.page.close();
  // ?tab=people on the public build falls back to the default tab and never shows a recruiter.
  const deep = await openDemo({ ...PHONE, publicDemo: true, query: "?tab=people", ready: "#tab-inbox .n" });
  await settle(deep.page);
  assert.notEqual(await viewTab(deep.page), "people");
  assert.equal(await deep.page.locator("#view article.job.rec").count(), 0);
  await deep.page.close();
  // Allowed direction: the owner sees the dot, "N due" in More's name, and can open Recruiters from More.
  const own = await openDemo({ ...PHONE, ready: "#tab-inbox .n" });
  await own.page.locator("#moreBtn .dot").waitFor({ state: "visible", timeout: 3000 });
  const name = (await own.page.locator("#moreBtn").getAttribute("aria-label")) || (await own.page.locator("#moreBtn").textContent()) || "";
  assert.match(name, new RegExp(`\\b${DUE} due\\b`), "More's accessible name says how many are due");
  await openMore(own.page);
  await own.page.click('#moreSheet [data-tab="people"]');
  await waitViewTab(own.page, "people");
  await own.page.close();
});

// ── No regression on PR #57 (UX-H-AC14) ───────────────────────────────────────────────────────

test("DCL-11 UX-H-AC14 the PR #57 filter bar (search, Sort, Filters, four chips) stays on New, Pipeline and All", async () => {
  const { page, errors } = await openDemo({ ...PHONE, ready: "#tab-inbox .n" });
  for (const id of ["inbox", "pipeline", "all"]) {
    await page.click(`#tab-${id}`);
    await settle(page);
    for (const sel of ["#q", "#fsort", "#ftoggle"]) assert.ok(await page.locator(sel).isVisible(), `${id}: ${sel}`);
    assert.deepEqual(await page.locator("#fbar [data-chip]").allInnerTexts(), ["Last 24 hrs", "Strong fit", "Good values", "Good culture"], `${id}: chips`);
  }
  assert.deepEqual(errors, []);
  await page.close();
});
