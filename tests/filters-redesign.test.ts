// RR-FS: filters and sorting redesign (Chase, 2026-10-30, from the approved phone mock). One row of search, Sort and
// Filters; four quick chips (Last 24 hrs first); the rest in the Filters sheet; four sorts with a default per tab.
// Demo data only; red first.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import type { Browser, Page } from "playwright";
import { openDemo as open, openTab } from "../scripts/browser.mjs";

let browser: Browser;
type Opts = Parameters<typeof open>[1];
const openDemo = (opts: Opts = {}) => open(browser, { ...opts, file: "dist/test-filters-redesign.html" });
const PHONE = { width: 390, height: 844 };
const LAPTOP = { width: 1280, height: 800 };
const cos = (page: Page) => page.locator("#view article.job .co").allInnerTexts();
const settle = (page: Page) => page.waitForTimeout(120);

before(async () => { browser = await chromium.launch(); });
after(async () => { await browser?.close(); });

test("RR-FS-1 on a phone, search, Sort and Filters share one row and the first role starts on the first screen", async () => {
  const { page, errors } = await openDemo(PHONE);
  for (const id of ["inbox", "pipeline", "action", "all"]) {
    await openTab(page, id);
    const [q, s, f] = await Promise.all(["#q", "#fsort", "#ftoggle"].map((sel) => page.locator(sel).boundingBox()));
    assert.ok(q && s && f, `controls visible on ${id}`);
    const mid = (b: { y: number; height: number }) => b.y + b.height / 2;
    assert.ok(Math.abs(mid(q) - mid(s)) < 6 && Math.abs(mid(s) - mid(f)) < 6, `one row on ${id}: ${mid(q)}, ${mid(s)}, ${mid(f)}`);
  }
  await page.click("#tab-inbox");
  const first = (await page.locator("#view .job h2").first().boundingBox())!;
  assert.ok(first.y + first.height <= 844, `first title ends at ${Math.round(first.y + first.height)}px`);
  assert.deepEqual(errors, []);
  await page.close();
});

test("RR-FS-2 each tab has its own default sort: New and All by match, Pipeline by recent change, Needs action by follow-up", async () => {
  const { page } = await openDemo(LAPTOP);
  const expect: Record<string, string> = { inbox: "Best match", pipeline: "Recently changed", action: "Follow-up date", all: "Best match" };
  for (const [id, label] of Object.entries(expect)) {
    await openTab(page, id);
    assert.match(await page.locator("#fcount").innerText(), new RegExp(label), `${id} sorted by ${label}`);
  }
  await page.click("#tab-pipeline");
  assert.deepEqual(await cos(page), ["Northstar Utilities", "Pebblepay", "HelioHome", "Watermark Climate", "Brightwell Solar"], "Pipeline newest change first");
  await openTab(page, "action");
  const due = await cos(page);
  assert.deepEqual(due, ["Pebblepay", "Brightwell Solar", "HelioHome"], "oldest follow-up first, none last");
  await page.close();
});

test("RR-FS-3 four quick chips, Last 24 hrs first; a chip toggles, shows pressed and narrows the list", async () => {
  const { page, errors } = await openDemo(LAPTOP);
  await page.click("#tab-inbox");
  assert.deepEqual(await page.locator("#fbar [data-chip]").allInnerTexts(), ["Last 24 hrs", "Strong fit", "Good values", "Good culture"]);
  const before = (await cos(page)).length;
  const day = page.locator('#fbar [data-chip="day"]');
  await day.click();
  await settle(page);
  assert.equal(await page.locator('#fbar [data-chip="day"]').getAttribute("aria-pressed"), "true");
  assert.deepEqual((await cos(page)).sort(), ["Carbonmark", "Gridlark", "Sunfield Energy"]);
  assert.match(await page.locator("#fcount").innerText(), new RegExp(`3 of ${before}`));
  await page.click('#fbar [data-chip="strong"]');
  await settle(page);
  assert.deepEqual(await cos(page), ["Sunfield Energy"], "chips combine");
  await page.click('#fbar [data-chip="day"]');
  await page.click('#fbar [data-chip="strong"]');
  await settle(page);
  assert.equal((await cos(page)).length, before);
  assert.equal(await page.locator('#fbar [data-chip="day"]').getAttribute("aria-pressed"), "false");
  assert.deepEqual(errors, []);
  await page.close();
});

test("RR-FS-3b Good culture and Good values chips match 'good or better'", async () => {
  const { page } = await openDemo(LAPTOP);
  await page.click("#tab-all");
  await page.click('#fbar [data-chip="culture"]');
  await settle(page);
  assert.deepEqual((await cos(page)).sort(), ["Ledgerly", "Sunfield Energy"]);
  await page.click('#fbar [data-chip="values"]');
  await settle(page);
  assert.deepEqual(await cos(page), ["Sunfield Energy"]);
  await page.close();
});

test("RR-FS-4 a filter set in the sheet shows as a removable chip, and removing it restores the list", async () => {
  const { page } = await openDemo(LAPTOP);
  await page.click("#tab-all");
  const all = (await cos(page)).length;
  await page.click("#ftoggle");
  await page.selectOption("#fv-lane", "Checkout");
  await settle(page);
  const chip = page.locator('#fbar [data-unset="lane"]');
  assert.match(await chip.innerText(), /Lane: Checkout/);
  assert.match(await page.locator("#ftoggle").innerText(), /Filters\s*1/);
  assert.ok((await cos(page)).length < all);
  await chip.click();
  await settle(page);
  assert.equal((await cos(page)).length, all);
  assert.equal(await page.locator('#fbar [data-unset]').count(), 0);
  await page.close();
});

test("RR-FS-5 the Status filter is only on All; Experience, Values and Culture dropdowns are gone (the chips cover them)", async () => {
  const { page } = await openDemo(LAPTOP);
  for (const id of ["inbox", "pipeline", "action"]) {
    await openTab(page, id);
    if ((await page.locator("#ftoggle").getAttribute("aria-expanded")) !== "true") await page.click("#ftoggle");
    assert.equal(await page.locator("#fv-status").count(), 0, `no Status filter on ${id}`);
  }
  await page.click("#tab-all");
  if ((await page.locator("#ftoggle").getAttribute("aria-expanded")) !== "true") await page.click("#ftoggle");
  assert.ok(await page.locator("#fv-status").isVisible());
  for (const gone of ["#fv-fit", "#fv-values", "#fv-culture", "#fv-sort"]) assert.equal(await page.locator(gone).count(), 0, `${gone} removed`);
  assert.deepEqual(await page.locator("#fv-found option").allInnerTexts(), ["Any time", "This week", "Last 30 days"]);
  await page.close();
});

test("RR-FS-6 a view saved by the old page (sort 'posted', culture 'good+', status on New) loads without errors", async () => {
  const { page, errors } = await openDemo(LAPTOP);
  await page.evaluate(() => {
    localStorage.setItem("rr-tab", "inbox");
    localStorage.setItem("rr-view", JSON.stringify({ q: "", status: "viewed", culture: "good+", found: "1", sort: "posted" }));
  });
  await page.reload();
  await page.waitForSelector("#fbar");
  assert.match(await page.locator("#fcount").innerText(), /Best match|Newest|Recently changed|Follow-up date/);
  assert.equal(await page.locator('#fbar [data-chip="culture"]').getAttribute("aria-pressed"), "true", "culture good+ becomes the chip");
  assert.equal(await page.locator('#fbar [data-chip="day"]').getAttribute("aria-pressed"), "true", "found today becomes Last 24 hrs");
  assert.equal(await page.locator('#fbar [data-unset="status"]').count(), 0, "status filter dropped outside All");
  assert.deepEqual(errors, []);
  await page.close();
});

test("RR-FS-7 Sort offers four choices, marks this tab's default, and remembers the pick per tab across reloads", async () => {
  const { page, errors } = await openDemo(LAPTOP);
  await page.click("#tab-inbox");
  await page.click("#fsort");
  assert.equal(await page.locator("#fsort").getAttribute("aria-expanded"), "true");
  const labels = await page.locator("#fbar .sorts label").allInnerTexts();
  assert.deepEqual(labels.map((l) => l.split("\n")[0].trim()), ["Best match", "Newest", "Recently changed", "Follow-up date"]);
  assert.match(labels[0], /default here/);
  await page.check("#fsort-found");
  await settle(page);
  assert.match(await page.locator("#fcount").innerText(), /Newest/);
  await page.click("#tab-pipeline");
  assert.match(await page.locator("#fcount").innerText(), /Recently changed/, "other tabs keep their own sort");
  await page.reload();
  await page.waitForSelector("#fbar");
  await page.click("#tab-inbox");
  assert.match(await page.locator("#fcount").innerText(), /Newest/, "remembered after reload");
  assert.deepEqual(errors, []);
  await page.close();
});

test("RR-FS-8 on a phone every chip and control is 44px tall, and nothing scrolls sideways with a sheet open", async () => {
  const { page } = await openDemo({ ...PHONE, query: "" });
  await page.click("#tab-inbox");
  const small = await page.locator("#fbar button, #fbar input, #fbar select").evaluateAll((els: HTMLElement[]) =>
    els.filter((e) => e.offsetParent && e.getBoundingClientRect().height < 44).map((e) => e.id || e.textContent!.trim()));
  assert.deepEqual(small, []);
  for (const btn of ["#ftoggle", "#fsort"]) {
    await page.click(btn);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(over <= 0, `${btn} open: overflows by ${over}px`);
    await page.keyboard.press("Escape");
  }
  await page.close();
});

test("RR-FS-9 Escape or Done closes a sheet and puts focus back on its button", async () => {
  const { page } = await openDemo(PHONE);
  await page.click("#tab-all");
  await page.click("#ftoggle");
  assert.ok(await page.locator("#fbar .fields").isVisible());
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("#ftoggle").getAttribute("aria-expanded"), "false");
  assert.equal(await page.evaluate(() => document.activeElement?.id), "ftoggle");
  await page.click("#ftoggle");
  await page.click("#fdone");
  assert.equal(await page.locator("#ftoggle").getAttribute("aria-expanded"), "false");
  assert.equal(await page.evaluate(() => document.activeElement?.id), "ftoggle");
  await page.close();
});
