// Night-shift hardening (2026-10-23), browser side: the UX sweep's findings (RR-UX-n) and
// page-level edge cases (RR-H-n), each written red first. Demo data only.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import type { Browser, Page } from "playwright";
import { buildDemo } from "../scripts/build-demo.mjs";
import { openDemo as open, openTab, openAdvanced } from "../scripts/browser.mjs";

let browser: Browser;
const openDemo = (opts = {}) => open(browser, { ...opts, file: "dist/test-hardening.html" });
// RR-M4.4: Home is the default tab; these public-demo tests start on New, where the role cards are.
const openPublic = (opts = {}) => openDemo({ html: buildDemo({ publicDemo: true }), query: "?tab=inbox", ...opts });
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
  await openAdvanced(page); // UX-R5: the editor is folded under Advanced
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
  await openAdvanced(page); // UX-R5: the editor is folded under Advanced
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
  await page.click("#tab-all");
  await page.locator(".job", { hasText: "Gridlark" }).locator("button[data-details]").click();
  await page.locator("#detailsSheet").getByRole("button", { name: "Preview posting" }).click(); // UX-H2-R3: Preview lives in Details
  await page.waitForSelector("#pvBody");
  const foot = await page.locator(".pv-src").innerText();
  assert.match(foot, /Sample description written for this demo/);
  assert.doesNotMatch(foot, /^Word for word/);
  await page.close();
});

test("RR-UX-6/7 the demo label says what's made up and that changes reset on reload", async () => {
  const { page } = await openPublic();
  // Issue #62: the old #demoNote chip and #demoTry line became the studio Demo bar (tests/demo-bar.test.ts);
  // its drawer now says what is made up and that a reload starts over.
  const demoBar = page.getByRole("region", { name: "Demo" });
  await demoBar.getByRole("button", { name: "Demo details" }).click();
  const drawer = page.locator("#" + (await demoBar.getByRole("button", { name: "Demo details" }).getAttribute("aria-controls")));
  assert.match(await drawer.innerText(), /made-up sample data/i);
  assert.match(await drawer.innerText(), /reload to start over/);
  await openTab(page, "criteria");
  await openAdvanced(page); // UX-R5: the editor is folded under Advanced
  await page.click("#critForm button[type=submit]");
  assert.match(await toastText(page), /for this visit/);
  await page.close();
});

// RR-M4.3: Save is the New card's primary on the public build (the owner's build leads with Apply), so these use it.
test("RR-UX-9 moving a role out of New offers Undo and keeps focus on the list", async () => {
  const { page } = await openPublic();
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
  // No old reason left on the record: Details would show it as "Ruled out …: <reason>" (RR-M4.3: status lives there).
  await page.click("#tab-all");
  await page.locator("article.job", { hasText: title }).locator("button[data-details]").click();
  await page.locator("#detailsSheet").waitFor({ state: "visible" });
  assert.doesNotMatch(await page.locator("#detailsSheet").innerText(), /Ruled out|Not the right fit/);
  assert.equal(await page.evaluate((t) => { const j = (0, eval)("jobs").find((x: any) => x.title === t); return [j.skipReason || "", j.skipNote || ""].join(""); }, title), "");
  await page.close();
});

test("RR-R2-1/2 the Status menu also offers Undo, and Undo puts focus back on the restored card", async () => {
  const { page } = await openDemo();
  const first = page.locator("article.job").first();
  const title = await first.locator("h2").innerText();
  await first.locator("button[data-details]").click();
  await page.locator("#detailsSheet").getByLabel("Status", { exact: true }).selectOption("applying");
  assert.match(await toastText(page), /Moved to Applying/);
  assert.equal(await page.evaluate(() => document.activeElement!.id), "ds-st", "focus stays on the Status menu in Details");
  await page.click("#toast button", { timeout: 2000 });
  await page.waitForFunction((t) => document.activeElement && document.activeElement.closest("article.job")?.querySelector("h2")?.textContent === t, title);
  await page.close();
});

test("RR-R2-2 the Undo toast stays while the pointer or focus is on it", async () => {
  const { page } = await openPublic();
  await page.locator("article.job").first().locator("button[data-quick=saved]").click();
  await page.hover("#toast button");
  await page.waitForTimeout(6500);
  assert.ok(await page.locator("#toast").isVisible());
  await page.close();
});

// SET-1 replaced the "At a glance" card with the Search settings card (#settings), so the summary is now the
// values its controls show. Same intent: a blocked save must not make the saved criteria look wiped.
async function settingsShown(page: Page) {
  return page.evaluate(() => {
    const v = (s: string) => (document.querySelector(s) as HTMLInputElement | null)?.value ?? null;
    const t = (s: string) => document.querySelector(s)?.textContent?.trim() ?? null;
    return {
      payMin: v("#set-pay-min"), payMax: v("#set-pay-max"), payText: t("#set-pay-val"), prio: v("#set-prio"),
      levels: [...document.querySelectorAll('#settings button[data-level][aria-pressed="true"]')].map((b) => (b as HTMLElement).dataset.level),
      sectors: [...document.querySelectorAll("#settings [role=radiogroup][data-sector]")].map((g) =>
        [(g as HTMLElement).dataset.sector, (g.querySelector("input:checked") as HTMLInputElement | null)?.value ?? null]),
      home: v("#set-home"), minScore: v("#set-minscore"), digest: v("#set-digest"), more: t("#set-more"),
    };
  });
}

test("RR-R2-3 after a blocked save the summary still shows the saved criteria", async () => {
  const { page } = await openDemo();
  await openTab(page, "criteria");
  await openAdvanced(page); // UX-R5: the editor is folded under Advanced
  await page.locator("#settings").waitFor();
  const saved = await settingsShown(page);
  // Guard: the snapshot is the saved criteria.yaml, not the controls' empty defaults.
  assert.equal(saved.payMin, "150000");
  assert.equal(saved.payMax, "185000");
  assert.equal(saved.home, "CO");
  assert.ok(saved.sectors.length > 0 && saved.sectors.every(([, w]) => w !== null), "every sector shows its saved weight");
  await page.locator("#critText").fill("foo: 1\n");
  await page.click("#critForm button[type=submit]");
  await page.locator("#critErr").waitFor();
  assert.deepEqual(await settingsShown(page), saved, "the settings card shows the saved values, not the blocked draft");
  assert.match(await page.locator("#settings").innerText(), /Fix the text below first\./, "and says why its controls are off");
  assert.equal(await page.locator("#critText").inputValue(), "foo: 1\n", "the blocked draft stays in the editor to fix");
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
