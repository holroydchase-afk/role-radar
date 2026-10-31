// Progress numbers (RR-M4.4: the Progress tab moved onto Home: Today and the week under Applications, Funnel,
// Response rate and Sector mix under After you apply's More stats, follow-ups in Get ready): the numbers from
// src/progress.ts on the demo data, the follow-up button, and status history. Demo data only.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import type { Browser } from "playwright";
import { openDemo as open, openTab } from "../scripts/browser.mjs";

let browser: Browser;
const openDemo = (opts = {}) => open(browser, { ...opts, file: "dist/test-progress.html" });
const openMoreStats = async (page: import("playwright").Page) => {
  await openTab(page, "home");
  const d = page.locator("#home-after details#moreStats");
  if (!(await d.evaluate((e) => (e as HTMLDetailsElement).open))) await d.locator("summary").click();
};
const todayMeter = (page: import("playwright").Page) => page.locator('#home-apps [role="meter"]');

before(async () => { browser = await chromium.launch(); });
after(async () => { await browser?.close(); });

test("Home shows today against the bar, the week, and (under More stats) the funnel and response rate", async () => {
  const { page, errors } = await openDemo();
  await openMoreStats(page);
  const view = page.locator("#view");
  // The demo has one application today and no follow-ups sent.
  assert.match((await view.locator("#home-apps").innerText()).replace(/\s+/g, " "), /Today 1 of 3/);
  assert.equal(await todayMeter(page).getAttribute("aria-valuetext"), "1 application and 0 follow-ups sent today");
  assert.equal(await todayMeter(page).getAttribute("aria-valuenow"), "1");
  assert.equal(await view.locator("#home-apps .days li").count(), 7);
  // Applied: 2 in the pipeline, 1 at Screen, 1 interviewing. Screen and interviewing were applied 14+ days ago.
  const funnel = await view.locator("section[aria-labelledby=pg-funnel] .bars li").allInnerTexts();
  assert.deepEqual(funnel.map((r) => r.replace(/\s+/g, " ").trim()), ["Applied 4", "Screen 2 50%", "Interviewing 1 50%", "Offer 0 0%"]);
  assert.match(await view.locator("section[aria-labelledby=pg-resp]").innerText(), /100% heard back[\s\S]*2 of 2 roles/);
  assert.match(await view.locator("section[aria-labelledby=pg-mix]").innerText(), /Solar, storage & distributed energy/);
  assert.deepEqual(errors, []);
  await page.close();
});

test("Follow-up sent counts toward today's bar and sets the next follow-up", async () => {
  const { page, errors } = await openDemo();
  await openTab(page, "home");
  const due = page.locator('#home-ready [data-ready="followup"]');
  assert.equal(await due.count(), 1);
  await due.locator("button", { hasText: "Follow-up sent" }).click();
  await page.waitForFunction(() => document.querySelector('#home-apps [role="meter"]')?.getAttribute("aria-valuenow") === "2");
  assert.equal(await todayMeter(page).getAttribute("aria-valuetext"), "1 application and 1 follow-up sent today");
  assert.match((await page.locator("#home-apps").innerText()).replace(/\s+/g, " "), /Today 2 of 3/);
  assert.equal(await due.count(), 0, "no follow-up left in Get ready");
  // Undo puts it back.
  await page.locator("#toast button", { hasText: "Undo" }).click();
  await page.waitForFunction(() => document.querySelector('#home-apps [role="meter"]')?.getAttribute("aria-valuenow") === "1");
  assert.equal(await due.count(), 1, "the follow-up is due again");
  assert.deepEqual(errors, []);
  await page.close();
});

test("a status move is kept in statusHistory, so the funnel keeps a Screen after a rejection", async () => {
  const { page, errors } = await openDemo();
  await page.click("#tab-pipeline");
  await page.locator("#role-ashby-1008 button[data-details]").click();
  await page.locator("#detailsSheet").getByLabel("Status", { exact: true }).selectOption("rejected");
  await page.keyboard.press("Escape");
  await openMoreStats(page);
  const funnel = await page.locator("section[aria-labelledby=pg-funnel] .bars li").allInnerTexts();
  assert.match(funnel[1].replace(/\s+/g, " "), /^Screen 2/);
  assert.deepEqual(errors, []);
  await page.close();
});

test("skips made by a screening rule are listed apart and not counted as ruled out", async () => {
  const { page, errors } = await openDemo();
  // RR-M4.4: this week's ruled-out count lives on Home (#homeWeek), under Applications.
  await openTab(page, "home");
  const weekCount = async () => (await page.locator("#homeWeek").innerText()).match(/^(\d+) ruled out this week/)?.[1];
  const before = await weekCount();
  assert.ok(before !== undefined, "Home shows this week's ruled-out count");
  await page.evaluate(async () => (await window.claude.use("db")).doc("jobs/greenhouse-1005").update({ status: "skipped", statusAt: new Date().toISOString(), skippedAt: new Date().toISOString(), skippedBy: "rule", skipReason: "Hard exclude" }));
  await page.locator("#homeWeek", { hasText: "plus 1 removed by screening rules" }).waitFor({ timeout: 3000 });
  assert.equal(await weekCount(), before, "this week's ruled-out count is unchanged");
  assert.equal(await page.locator('#moreSheet [data-tab="ruled"] .n').textContent(), "4", "Ruled out count is unchanged");
  await openTab(page, "ruled");
  assert.match(await page.locator(".by-rule summary").innerText(), /Removed by screening rules · 1/);
  assert.deepEqual(errors, []);
  await page.close();
});

test("skipping a role on the page records it as the owner's call", async () => {
  const { page, errors } = await openDemo();
  await page.evaluate(() => { const a = document.querySelector<HTMLElement>("[data-quick=skipped]")!; a.click(); });
  await page.locator("[data-skipwhy]").first().click();
  await page.locator("[data-skipform] textarea[name=skipNote]").fill("Not the right fit");
  await page.click("[data-skipform] button[type=submit]");
  await page.waitForSelector("[data-skipform]", { state: "detached" });
  await openTab(page, "ruled");
  const by = await page.evaluate(() => new Promise(async (ok) => {
    const db = await window.claude.use("db");
    db.collection("jobs").onSnapshot((s) => ok(s.docs.map((d) => d.data()).filter((j) => j.status === "skipped" && j.skippedBy).map((j) => j.skippedBy)));
  }));
  assert.deepEqual(by, ["owner"]);
  assert.deepEqual(errors, []);
  await page.close();
});

test("Home with More stats open fits a phone with no sideways scroll", async () => {
  const { page, errors } = await openDemo({ width: 390, height: 844 });
  await openMoreStats(page);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 0, `page scrolls sideways by ${overflow}px`);
  assert.deepEqual(errors, []);
  await page.close();
});
