// Skip handling, browser side: a skip needs a reason chip and a comment, and the Ruled out tab turns repeated
// skips into suggested criteria changes the owner accepts on the Criteria tab. Demo data only.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import type { Browser, Page } from "playwright";
import { openDemo as open } from "../scripts/browser.mjs";
import type * as SF from "../src/skip-feedback.ts";

let browser: Browser;
const openDemo = (opts: Parameters<typeof open>[1] = {}) => open(browser, { ...opts, file: "dist/test-skip-feedback.html" });
// Resolves with the document's data (loosely typed: the tests dig into it), or null when it's missing.
const dbDoc = (page: Page, path: string) => page.evaluate((p) => new Promise<any>(async (ok) => (await window.claude.use("db")).doc(p).onSnapshot((s) => ok(s.exists ? s.data() : null))), path);

before(async () => { browser = await chromium.launch(); });
after(async () => { await browser?.close(); });

test("a skip needs both a reason chip and a comment, and nothing saves until both are there", async () => {
  const { page, errors } = await openDemo();
  await page.click("#tab-inbox");
  const card = page.locator("article.job").first();
  const title = await card.locator("h2").innerText();
  await card.locator("[data-quick=skipped]").click();
  const form = page.locator("[data-skipform]");
  // Focus moves after the form renders; wait for it rather than reading it the same tick (flaked on CI).
  const focused = await page.waitForFunction(() => (document.activeElement as HTMLElement | null)?.dataset.skipwhy !== undefined, null, { timeout: 5000 }).then(() => true, () => false);
  assert.equal(focused, true, "focus lands on the first reason");
  await form.locator("button[type=submit]").click();
  assert.equal(await form.locator("[data-skiperr]").innerText(), "Pick a reason first.");
  await form.locator("[data-skipwhy='Wrong level']").click();
  assert.equal(await form.locator("[data-skipwhy='Wrong level']").getAttribute("aria-pressed"), "true");
  assert.ok(await form.locator("[data-skiperr]").isHidden(), "picking a reason clears the message");
  await form.locator("button[type=submit]").click();
  assert.match(await form.locator("[data-skiperr]").innerText(), /Add a few words/);
  assert.equal(await page.evaluate(() => (document.activeElement as HTMLInputElement | null)?.name), "skipNote");
  // Still not skipped.
  assert.equal(await page.locator("article.job", { hasText: title }).count(), 1);
  await form.locator("[data-skipwhy='Culture']").click();
  assert.equal(await form.locator("[data-skipwhy='Wrong level']").getAttribute("aria-pressed"), "false", "one reason at a time");
  await form.locator("textarea[name=skipNote]").fill("Team page says always-on support rotation");
  await form.locator("button[type=submit]").click();
  await page.waitForFunction((t) => ![...document.querySelectorAll("#view article.job h2")].some((h) => h.textContent === t), title);
  await page.click("#tab-ruled");
  assert.match(await page.locator("#view .row").first().innerText(), /Culture\. Team page says always-on support rotation/);
  assert.deepEqual(errors, []);
  await page.close();
});

test("Ruled out shows what the skips suggest, with the roles behind each one", async () => {
  const { page, errors } = await openDemo();
  await page.click("#tab-ruled");
  const fb = page.locator("section.fb");
  const text = await fb.innerText();
  assert.match(text, /What your skips are teaching the scan/);
  assert.match(text, /Never show Tidewater Analytics\nYou ruled out 2 of its roles\./);
  assert.match(text, /Treat "always-on" as a culture red flag/);
  assert.match(text, /Read the location section before adding a role\n2 roles got through/);
  assert.match(text, /"Reviews say always-on, with weekend releases"/);
  assert.equal(await fb.locator("[data-fbaccept]").count(), 2, "scan notes have no criteria button");
  assert.deepEqual(errors, []);
  await page.close();
});

test("Add to criteria opens the change in the editor, and only Save applies it", async () => {
  const { page, errors } = await openDemo();
  await page.click("#tab-ruled");
  await page.locator("section.fb li", { hasText: "Never show Tidewater" }).locator("[data-fbaccept]").click();
  assert.equal(await page.locator("#tab-criteria").getAttribute("aria-selected"), "true");
  assert.match(await page.locator("#fromSkips").innerText(), /From your skips: Never show Tidewater Analytics\. .*Nothing changes until you save\./);
  assert.match(await page.locator("#critText").inputValue(), /companies: \[Tidewater Analytics\]/);
  assert.doesNotMatch((await dbDoc(page, "meta/criteria")).spec, /Tidewater/, "not saved yet");
  await page.click("#critForm button[type=submit]");
  await page.waitForFunction(() => !document.querySelector("#fromSkips"));
  assert.match((await dbDoc(page, "meta/criteria")).spec, /companies: \[Tidewater Analytics\]/);
  await page.waitForFunction(async () => ((await new Promise<{ accepted?: string[] } | undefined>(async (ok) => (await window.claude.use("db")).doc("meta/skipFeedback").onSnapshot((s) => ok(s.data())))) || {}).accepted?.includes("company:tidewater analytics"));
  await page.click("#tab-ruled");
  assert.doesNotMatch(await page.locator("section.fb").innerText(), /Never show Tidewater/, "an accepted change stops showing");
  assert.deepEqual(errors, []);
  await page.close();
});

test("Discard drops a suggested change; Not now sets one aside for good", async () => {
  const { page, errors } = await openDemo();
  await page.click("#tab-ruled");
  await page.locator("[data-fbaccept='culture:always-on']").click();
  assert.match(await page.locator("#critText").inputValue(), /red_flags: \[.*"?always-on"?\]/);
  await page.click("#critReset");
  assert.equal(await page.locator("#fromSkips").count(), 0);
  assert.doesNotMatch(await page.locator("#critText").inputValue(), /always-on/);
  await page.click("#tab-ruled");
  await page.locator("[data-fbdismiss='culture:always-on']").click();
  await page.waitForFunction(() => !/always-on" as a culture/.test(document.querySelector("section.fb")!.textContent!));
  const fb = await dbDoc(page, "meta/skipFeedback");
  assert.deepEqual(fb.dismissed, ["culture:always-on"]);
  assert.ok(fb.open.some((s: SF.Suggestion) => s.id === "company:tidewater analytics"));
  assert.deepEqual(fb.scanNotes.map((s: SF.Suggestion) => s.id), ["scan:location"]);
  assert.deepEqual(errors, []);
  await page.close();
});

test("a new skip refreshes what the scan reads in meta/skipFeedback", async () => {
  const { page, errors } = await openDemo();
  assert.equal(await dbDoc(page, "meta/skipFeedback"), null);
  await page.click("#tab-inbox");
  await page.locator("article.job").first().locator("[data-quick=skipped]").click();
  await page.locator("[data-skipform] [data-skipwhy='Posting closed']").click();
  await page.locator("[data-skipform] textarea[name=skipNote]").fill("Closed when I opened it");
  await page.click("[data-skipform] button[type=submit]");
  await page.waitForFunction(async () => !!(await new Promise(async (ok) => (await window.claude.use("db")).doc("meta/skipFeedback").onSnapshot((s) => ok(s.exists)))));
  const fb = await dbDoc(page, "meta/skipFeedback");
  assert.ok(fb.updatedAt);
  assert.ok(fb.open.length >= 2 && fb.open.every((s: SF.Suggestion) => s.change && s.text));
  assert.deepEqual(errors, []);
  await page.close();
});

test("the skip form and suggestions fit a phone with no sideways scroll", async () => {
  const { page, errors } = await openDemo({ width: 390, height: 844 });
  await page.click("#tab-inbox");
  await page.locator("article.job").first().locator("[data-quick=skipped]").click();
  let overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 0, `skip form scrolls sideways by ${overflow}px`);
  await page.click("[data-skipcancel]");
  await page.click("#tab-ruled");
  overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 0, `Ruled out scrolls sideways by ${overflow}px`);
  assert.deepEqual(errors, []);
  await page.close();
});
