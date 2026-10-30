// Recruiter-facing sweep, 2026-10-24 night shift (ux-reviewer RR-N3-*): what a recruiter sees on a
// phone in 90 seconds and a hiring manager on a laptop in 5 minutes. Demo data only; red first.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import type { Browser } from "playwright";
import { buildDemo } from "../scripts/build-demo.mjs";
import { openDemo as open, openTab } from "../scripts/browser.mjs";

let browser: Browser;
const openDemo = (opts = {}) => open(browser, { ...opts, file: "dist/test-showcase.html" });
before(async () => { browser = await chromium.launch(); });
after(async () => { await browser?.close(); });

test("RR-N3-2 on a phone, the public demo shows the first role's title on the first screen", async () => {
  const { page } = await openDemo({ html: buildDemo({ publicDemo: true }), width: 390, height: 844 });
  // The progress line (+49px) had pushed the first card off screen; its first title line must show.
  const box = (await page.locator(".job h2").first().boundingBox())!;
  const line = await page.locator(".job h2").first().evaluate((el) => parseFloat(getComputedStyle(el).lineHeight));
  assert.ok(box.y + line <= 844, `first title line ends at ${Math.round(box.y + line)}px`);
  await page.close();
});

test("RR-N3-3 the demo's progress shows an application today, not zeros", async () => {
  const { page } = await openDemo();
  // RR-M4.1: the Today/This week line left the header; the Progress tab shows the same counts.
  await openTab(page, "progress");
  assert.match(await page.locator("section[aria-labelledby=pg-today] .hint").innerText(), /^1 application\b/);
  assert.match(await page.locator("section[aria-labelledby=pg-week] .line").innerText(), /^Applied [1-9]/);
  await openTab(page, "ruled");
  assert.equal(await page.locator("#view h3").first().textContent(), "Today · 1 ruled out");
  await page.close();
});

test("RR-N3-4 the demo's Gmail status check has no example.com links and says the emails are samples", async () => {
  const { page, errors } = await openDemo();
  await page.click("#tab-pipeline");
  await page.locator("details.gmail-status summary").click();
  await page.click("#gsFind");
  await page.waitForSelector("details.gmail-status .gmlist");
  assert.equal(await page.locator('details.gmail-status a[href*="example.com"]').count(), 0);
  assert.match(await page.locator("details.gmail-status .gmlist").innerText(), /Sample email/);
  assert.deepEqual(errors, []);
  await page.close();
});

test("RR-N3-5 the Alerts card uses plain words, not rule ids or channel codes", async () => {
  const { page } = await openDemo();
  await openTab(page, "criteria");
  const text = await page.locator("#alertsPreview").innerText();
  assert.doesNotMatch(text, /\b[a-z]+_[a-z_]+\b/, "a snake_case id is showing");
  assert.doesNotMatch(text, /go to: push/);
  assert.match(text, /phone notification/);
  await page.close();
});

test("RR-N3-6 the demo's alert preview reads the same at any hour (demo clock is 9:00 in the spec's time zone)", async () => {
  const { page } = await openDemo();
  await openTab(page, "criteria");
  assert.doesNotMatch(await page.locator("#alertsPreview").innerText(), /held for quiet hours/);
  await page.close();
});

test("RR-N3-7 At a glance points to the Alerts card", async () => {
  const { page } = await openDemo({ html: buildDemo({ publicDemo: true }) });
  await openTab(page, "criteria");
  const link = page.locator('.ccard a[href="#alerts"]');
  assert.equal(await link.count(), 1);
  assert.match(await link.innerText(), /Alerts/);
  assert.equal(await page.locator("#alerts").count(), 1);
  await page.close();
});

test("RR-N3-8 the demo's preview says it's a sample above the description", async () => {
  const { page } = await openDemo({ width: 390, height: 844 });
  await page.click("#tab-all");
  await page.click('.job:has-text("Gridlark") button[data-preview]');
  await page.waitForSelector("#pvBody li");
  const order = await page.evaluate(() => {
    const src = document.querySelector(".pv-src")!, body = document.querySelector("#pvBody")!;
    return !!(src.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  assert.ok(order, "the sample note comes before the description");
  await page.close();
});
