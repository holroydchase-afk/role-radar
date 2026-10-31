// Ruled out: every role the owner eliminates is kept with a reason and a date, listed on its own
// tab and counted as progress next to applications. Demo data only.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import type { Browser, Page } from "playwright";
import { buildDemo } from "../scripts/build-demo.mjs";
import { openDemo as open, openTab } from "../scripts/browser.mjs";

let browser: Browser;
const openDemo = (opts = {}) => open(browser, { ...opts, file: "dist/test-ruled.html" });

before(async () => { browser = await chromium.launch(); });
after(async () => { await browser?.close(); });

test("Home and Ruled out count today's and this week's applications and ruled-out roles", async () => {
  const { page, errors } = await openDemo();
  // The demo has one role ruled out today (screened out in an intake chat) and one applied today.
  // RR-M4.1: these counts left the header; RR-M4.4: Home (Applications) and the Ruled out tab carry them.
  await openTab(page, "home");
  assert.match(await page.locator('#home-apps [role="meter"]').getAttribute("aria-valuetext") ?? "", /^1 application\b/);
  assert.match(await page.locator('#home-apps [data-tile="done"]').innerText(), /\b\d+ this week\b/);
  assert.match(await page.locator("#homeWeek").innerText(), /^\d+ ruled out this week/);
  await openTab(page, "ruled");
  assert.equal(await page.locator("#view h3").first().textContent(), "Today · 1 ruled out");
  assert.deepEqual(errors, []);
  await page.close();
});

test("the Ruled out tab lists skipped roles newest first, with the reason, note and day", async () => {
  const { page, errors } = await openDemo();
  assert.equal((((await page.locator('#moreSheet [data-tab="ruled"]').textContent()) ?? "")).replace(/\D/g, ""), "4");
  await openTab(page, "ruled");
  const view = page.locator("#view");
  assert.match(await view.locator(".sum").innerText(), /This week you applied to \d+ and ruled out \d+/);
  assert.match(await view.locator(".sum").innerText(), /4 ruled out in all · Culture 2 · .*Location 1/);
  const heads = await view.locator("h3").allTextContents();
  assert.equal(heads[0], "Today · 1 ruled out");
  const rows = await view.locator(".row").allInnerTexts();
  assert.match(rows[0], /Harborline Mutual · Location\. Belfast office only, and the posting had already closed · screened in intake/);
  assert.match(rows[1], /Tidewater Analytics · Culture/);
  assert.match(rows[2], /Tidewater Analytics · Culture\. Reviews say always-on/);
  assert.match(rows[3], /Copperleaf Insurance · Not remote/);
  assert.deepEqual(errors, []);
  await page.close();
});

test("skipping with a reason and a note lands on Ruled out and bumps today's count", async () => {
  const { page, errors } = await openDemo();
  await page.click("#tab-inbox");
  const card = page.locator("article.job").first();
  const company = (await card.locator(".co").innerText()).trim();
  await card.locator("[data-quick=skipped]").click();
  await page.locator("[data-skipform] [data-skipwhy='Location']").click();
  await page.locator("[data-skipform] textarea[name=skipNote]").fill("Needs relocation to Denver");
  await page.click("[data-skipform] button[type=submit]");
  await page.waitForFunction(() => document.querySelector('#moreSheet [data-tab="ruled"] .n')?.textContent === "5");
  await openTab(page, "ruled");
  const first = await page.locator("#view .row").first().innerText();
  assert.ok(first.toUpperCase().includes(company.toUpperCase()) || first.includes(company), first);
  assert.match(first, /Location\. Needs relocation to Denver/);
  assert.equal(await page.locator("#view h3").first().textContent(), "Today · 2 ruled out");
  assert.deepEqual(errors, []);
  await page.close();
});

test("Reconsider moves a ruled-out role back to New and clears its reason", async () => {
  const { page, errors } = await openDemo();
  await openTab(page, "ruled");
  await page.locator("#view .row", { hasText: "Senior Product Manager, Growth" }).locator("[data-reconsider]").click();
  await page.waitForFunction(() => !/Manager, Growth/.test(document.querySelector("#view .ruled")!.textContent!));
  assert.match(await page.locator("#toast").innerText(), /Moved to Viewed/);
  await page.click("#tab-inbox");
  const card = page.locator("article.job", { hasText: "Tidewater" });
  assert.equal(await card.count(), 1);
  assert.doesNotMatch(await card.innerText(), /Ruled out|Culture\./);
  assert.deepEqual(errors, []);
  await page.close();
});

test("a skipped card says when and why it was ruled out", async () => {
  const { page } = await openDemo();
  await page.click("#tab-all");
  const card = page.locator("article.job", { hasText: "Copperleaf" });
  // RR-M4.3: the card shows when (its one date); Details shows when and why.
  assert.match(await card.locator(".meta").innerText(), /Ruled out \w{3} \d{1,2}/);
  await card.locator("button[data-details]").click();
  assert.match(await page.locator("#detailsSheet").innerText(), /Ruled out \w{3} \d{1,2}: Not remote/);
  await page.close();
});

test("public demo: Ruled out works without mentioning intake", async () => {
  const { page, errors } = await openDemo({ html: buildDemo({ publicDemo: true }) });
  await openTab(page, "ruled");
  const text = await page.locator("#view").innerText();
  assert.match(text, /Harborline Mutual/);
  assert.doesNotMatch(text, /intake|resume/i);
  assert.deepEqual(errors, []);
  await page.close();
});

test("an empty tracker shows a plain Ruled out message and a zero count", async () => {
  const { page } = await openDemo({ html: buildDemo({ seed: { jobs: {}, companies: {}, recruiters: {}, meta: {} } }), ready: "#tab-inbox" });
  await openTab(page, "ruled");
  assert.match(await page.locator("#view").innerText(), /Nothing ruled out yet/);
  assert.equal(((await page.locator('#moreSheet [data-tab="ruled"] .n').textContent()) ?? "").trim(), "0");
  // RR-M4.1: Today/This week counts moved from the header; RR-M4.4: they live on Home.
  await openTab(page, "home");
  assert.match(await page.locator('#home-apps [role="meter"]').getAttribute("aria-valuetext") ?? "", /^0 applications\b/);
  assert.match((await page.locator('#home-apps [data-tile="done"]').innerText()).replace(/\s+/g, " "), /^0 Done 0 this week$/);
  assert.match(await page.locator("#homeWeek").innerText(), /^0 ruled out this week/);
  await page.close();
});
