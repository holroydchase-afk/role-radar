// Night-shift hardening (2026-10-23), browser side: the UX sweep's findings (RR-UX-n) and
// page-level edge cases (RR-H-n), each written red first. Demo data only.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import type { Browser, Page } from "playwright";
import { buildDemo } from "../scripts/build-demo.mjs";
import { openDemo as open, openTab } from "../scripts/browser.mjs";

let browser: Browser;
const openDemo = (opts = {}) => open(browser, { ...opts, file: "dist/test-hardening.html" });
const openPublic = (opts = {}) => openDemo({ html: buildDemo({ publicDemo: true }), ...opts });
const toastText = (page: Page) => page.locator("#toast").innerText();

before(async () => { browser = await chromium.launch(); });
after(async () => { await browser?.close(); });

test("RR-UX-2 on a phone the tab bar doesn't cover a fifth of the screen while scrolling", async () => {
  for (const [w, h] of [[390, 844], [320, 640]]) {
    const { page } = await openPublic({ width: w, height: h });
    await page.click("#tab-all");
    await page.evaluate(() => window.scrollTo(0, 1500));
    await page.waitForTimeout(50);
    const bottom = await page.locator("#tabs").evaluate((el) => el.getBoundingClientRect().bottom);
    assert.ok(bottom <= 64, `tabs cover ${Math.round(bottom)}px at ${w}x${h}`);
    await page.close();
  }
});

test("RR-UX-3 saving criteria that would drop the sections the scan reads is blocked", async () => {
  const { page } = await openDemo();
  await openTab(page, "criteria");
  const before = await page.locator("#critText").inputValue();
  await page.locator("#critText").fill("foo: 1\n");
  await page.click("#critForm button[type=submit]");
  const msg = await toastText(page);
  assert.match(msg, /would remove/i);
  assert.match(msg, /sector weights/);
  assert.match(msg, /Nothing was saved/);
  assert.match(await page.locator("#critForm .err").innerText(), /would remove/i);
  // Discarding brings back the saved spec, so it was never overwritten.
  await page.click("#critReset");
  assert.equal(await page.locator("#critText").inputValue(), before);
  // A normal edit still saves.
  await page.locator("#critText").fill(before.replace("min_score_to_add: 50", "min_score_to_add: 55"));
  await page.click("#critForm button[type=submit]");
  assert.match(await toastText(page), /saved/i);
  await page.close();
});

test("RR-UX-4 a YAML error names the line, says nothing was saved and puts focus on the editor", async () => {
  const { page } = await openDemo({ width: 390, height: 844 });
  await openTab(page, "criteria");
  await page.locator("#critText").fill("role:\n  title_include: [Senior\nsectors: x\n");
  await page.click("#critForm button[type=submit]");
  assert.match(await toastText(page), /^Line \d+ has a YAML error\. Nothing was saved\.$/);
  const a = await page.evaluate(() => {
    const t = document.activeElement!;
    const err = document.getElementById(t.getAttribute("aria-describedby") || "-");
    const r = err && err.getBoundingClientRect();
    return { id: t.id, invalid: t.getAttribute("aria-invalid"), err: err && err.textContent, top: r && r.top, bottom: r && r.bottom };
  });
  assert.equal(a.id, "critText");
  assert.equal(a.invalid, "true");
  assert.ok(a.err && a.err.length > 5, "error text is linked to the editor");
  assert.ok(a.top! >= 0 && a.bottom! <= 844, `error is on screen (top ${a.top})`);
  await page.close();
});

test("RR-UX-5 the demo's preview says its description is a sample, not word for word from a board", async () => {
  const { page } = await openPublic();
  await page.locator(".job button[data-preview]").first().click();
  await page.waitForSelector("#pvBody");
  const foot = await page.locator(".pv-src").innerText();
  assert.match(foot, /Sample description written for this demo/);
  assert.doesNotMatch(foot, /^Word for word/);
  await page.close();
});

test("RR-UX-6/7 the demo label says what's made up and that changes reset on reload", async () => {
  const { page } = await openPublic();
  assert.ok((await page.locator("#demoNote").textContent())!.length <= 28, "chip stays on one line at 320px");
  assert.ok(await page.locator("#demoTry").isVisible());
  assert.match(await page.locator("#demoTry").innerText(), /roles, recruiters and scores are made up/i);
  assert.match(await page.locator("#demoTry").innerText(), /resets when you reload/);
  await openTab(page, "criteria");
  await page.click("#critForm button[type=submit]");
  assert.match(await toastText(page), /for this visit/);
  await page.close();
});

test("RR-UX-9 moving a role out of New offers Undo and keeps focus on the list", async () => {
  const { page } = await openDemo();
  const first = page.locator("article.job").first();
  const title = await first.locator("h2").innerText();
  await first.locator("button[data-quick=saved]").click();
  assert.match(await toastText(page), /Moved to Saved/);
  const focus = await page.evaluate(() => document.activeElement && document.activeElement.closest("article.job") ? "card" : document.activeElement!.tagName);
  assert.equal(focus, "card");
  await page.click("#toast button", { timeout: 2000 });
  await page.waitForFunction((t) => [...document.querySelectorAll("article.job h2")].some((h) => h.textContent === t), title);
  await page.close();
});

test("RR-UX-10 the toast is announced, and the list isn't re-read on every keystroke", async () => {
  const { page } = await openDemo();
  assert.equal(await page.locator("#toast").getAttribute("role"), "status");
  assert.equal(await page.locator("#view").getAttribute("aria-live"), null);
  await page.close();
});

test("RR-UX-11 after adding everyone from Gmail, the import says nothing is left to add", async () => {
  const { page } = await openDemo();
  await openTab(page, "people");
  await page.click("#recPrivacy");
  await page.locator("details.gmail summary").click();
  await page.click("#gmFind");
  await page.waitForSelector(".gmlist");
  await page.click("#gmAdd");
  await page.waitForFunction(() => /Nothing left to add/.test(document.querySelector("details.gmail")?.textContent || ""));
  assert.equal(await page.locator("#gmAdd").count(), 0);
  assert.doesNotMatch(await page.locator("details.gmail").innerText(), /Untick anyone/);
  await page.close();
});

test("RR-UX-13 the public Watchlist strip uses plain words, not board slugs", async () => {
  const { page } = await openPublic();
  await openTab(page, "watch");
  const strip = await page.locator(".health").innerText();
  assert.doesNotMatch(strip, /mode full|greenhouse:|lever:/);
  assert.match(strip, /Orbitline moved its job board \(Greenhouse → Lever\)/);
  await page.close();
});

test("RR-H-7 two recruiters added by hand with non-Latin names at one company are both kept", async () => {
  const { page } = await openDemo();
  await openTab(page, "people");
  await page.click("#recPrivacy");
  const n0 = await page.locator(".rec").count();
  for (const name of ["李明", "王芳"]) {
    await page.locator("details[data-more=_rec] summary").click().catch(() => {});
    if (!(await page.locator("#ar-n").isVisible())) await page.locator("details[data-more=_rec] summary").click();
    await page.fill("#ar-n", name);
    await page.fill("#ar-c", "Sunfield");
    await page.click("#addRec button[type=submit]");
    await page.waitForFunction(([n]) => document.querySelector(".list")?.textContent.includes(n), [name]);
  }
  assert.equal(await page.locator(".rec").count(), n0 + 2);
  await page.close();
});

test("RR-H-8 Undo after Skip with a reason puts the role back with no skip reason left behind", async () => {
  const { page } = await openDemo();
  const first = page.locator("article.job").first();
  const title = await first.locator("h2").innerText();
  await first.locator("button[data-quick=skipped]").click();
  await page.locator("[data-skipwhy]").first().click();
  await page.locator("[data-skipform] textarea[name=skipNote]").fill("Not the right fit");
  await page.click("[data-skipform] button[type=submit]");
  await page.click("#toast button", { timeout: 2000 });
  await page.waitForFunction((t) => [...document.querySelectorAll("article.job h2")].some((h) => h.textContent === t), title);
  // Skip it again from the status menu: an old reason left on the record would show up as "Skipped: …".
  await page.click("#tab-all");
  const card = page.locator("article.job", { hasText: title });
  await card.locator("select[id^=st-]").selectOption("skipped");
  await page.waitForTimeout(200);
  assert.doesNotMatch(await page.locator("article.job", { hasText: title }).innerText(), /Skipped:/);
  await page.close();
});

test("RR-R2-1/2 the Status menu also offers Undo, and Undo puts focus back on the restored card", async () => {
  const { page } = await openDemo();
  const first = page.locator("article.job").first();
  const title = await first.locator("h2").innerText();
  await first.locator("select[id^=st-]").selectOption("applying");
  assert.match(await toastText(page), /Moved to Applying/);
  assert.equal(await page.evaluate(() => !!document.activeElement!.closest("article.job")), true, "focus stays in the list");
  await page.click("#toast button", { timeout: 2000 });
  await page.waitForFunction((t) => document.activeElement && document.activeElement.closest("article.job")?.querySelector("h2")?.textContent === t, title);
  await page.close();
});

test("RR-R2-2 the Undo toast stays while the pointer or focus is on it", async () => {
  const { page } = await openDemo();
  await page.locator("article.job").first().locator("button[data-quick=saved]").click();
  await page.hover("#toast button");
  await page.waitForTimeout(6500);
  assert.ok(await page.locator("#toast").isVisible());
  await page.close();
});

test("RR-R2-3 after a blocked save the summary still shows the saved criteria", async () => {
  const { page } = await openDemo();
  await openTab(page, "criteria");
  const glance = await page.locator("div.ccard", { hasText: "At a glance" }).innerText();
  await page.locator("#critText").fill("foo: 1\n");
  await page.click("#critForm button[type=submit]");
  assert.equal(await page.locator("div.ccard", { hasText: "At a glance" }).innerText(), glance);
  assert.doesNotMatch(await page.locator("#view").innerText(), /No sectors yet/);
  await page.close();
});

test("RR-R2-6 long watchlist change notes don't sit in a fully rounded pill", async () => {
  const { page } = await openPublic({ width: 390, height: 844 });
  await openTab(page, "watch");
  const r = await page.locator(".hchip", { hasText: "moved its job board" }).evaluate((el) => parseFloat(getComputedStyle(el).borderTopLeftRadius));
  assert.ok(r <= 12, "radius " + r);
  await page.close();
});
