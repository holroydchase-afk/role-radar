// Issue #62: the studio demo bar (pm-tools docs/DEMO-BANNER.md, "DEMO-BAR") replaces Role Radar's own demo notice.
// Written red first by qa-tdd. Demo data only (demo/seed.json).
//
// Contract the engineer builds to:
//   - Shown only when window.__RR_DEMO__ (the public build and the private demo build). The live page has no bar.
//   - One <section aria-label="Demo"> at the top of the page, in the page flow (not sticky), outside <header> and
//     above the <h1>. Collapsed on every load; at most 48px tall; no sideways scroll down to 320px.
//   - Far left: a link "← Portfolio" to https://chaseholroyd.com/role-radar.html (the target the old #showcase
//     "← Chase Holroyd" link used), at least 44px tall.
//   - Then one <button aria-expanded aria-controls="<panel id>" aria-label="Demo details"> (>= 44px) holding the
//     badge (.demo-bar__badge, text "Demo"), the summary and "Details" + a decorative chevron (aria-hidden).
//     Summary: "Sample data" on phones; from 600px it must not claim changes are kept ("changes stay in this
//     browser" is untrue here) and says they reset on reload.
//   - The drawer (the element aria-controls names) is hidden until opened, pushes the app down, has 16px+ text:
//       "This is the real Role Radar, running on made-up sample data. Changes to roles and recruiters aren't saved
//       anywhere; reload to start over." (main session copy call: view settings are remembered in localStorage)
//     and the way back in full as a link to the same target (>= 44px). No Reset demo button: nothing persists
//     (demo/mock-claude.js keeps every write in an in-memory Map re-seeded on each load; see DEMO-BAR-9).
//   - Esc closes the drawer (focus on the toggle or inside the drawer) and puts focus back on the toggle.
//   - Bar font = --f-body, bar background = --surface; the badge never wears --accent; badge and summary
//     text meet 4.5:1 against the bar in light and dark.
//   - The old notice (#demoNote, #demoTry) and the old #showcase back-link strip are removed, so the bar is the
//     only demo mark. The public intro (#lede) is a portfolio intro, not a demo notice, and stays.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import type { Browser, Page } from "playwright";
import { buildDemo } from "../scripts/build-demo.mjs";
import { openDemo as open } from "../scripts/browser.mjs";

let browser: Browser;
const FILE = "dist/test-demo-bar.html";
const BACK = "https://chaseholroyd.com/role-radar.html";
const COPY_WHAT = "This is the real Role Radar, running on made-up sample data.";
const COPY_RESET = "Changes to roles and recruiters aren't saved anywhere; reload to start over.";
type Opts = Parameters<typeof open>[1];
const BUILDS: [string, () => string][] = [["public", () => buildDemo({ publicDemo: true })], ["private", () => buildDemo()]];
// A short timeout so a missing bar fails fast instead of waiting 30s per locator.
const openBuild = async (html: string, opts: Opts = {}) => {
  const r = await open(browser, { html, file: FILE, ready: "#tabs button", ...opts });
  r.page.setDefaultTimeout(5000);
  return r;
};
const VIEWPORTS = [{ width: 390, height: 844 }, { width: 1280, height: 800 }];

const bar = (page: Page) => page.getByRole("region", { name: "Demo" });
const toggle = (page: Page) => bar(page).getByRole("button", { name: "Demo details" });
const panelOf = async (page: Page) => page.locator("#" + (await toggle(page).getAttribute("aria-controls")));
const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const h1Top = (page: Page) => page.locator("h1").evaluate((el) => el.getBoundingClientRect().top);

before(async () => { browser = await chromium.launch(); });
after(async () => { await browser?.close(); });

for (const [name, html] of BUILDS) {
  for (const vp of VIEWPORTS) {
    test(`DEMO-BAR-1 ${name} ${vp.width}px: one slim Demo bar, collapsed on load, with the way back visible`, async () => {
      const { page, errors } = await openBuild(html(), vp);
      assert.equal(await bar(page).count(), 1, "one region named Demo");
      assert.equal(await bar(page).evaluate((el) => el.tagName), "SECTION");
      const box = (await bar(page).boundingBox())!;
      assert.ok(box.height <= 48, `bar is ${box.height}px tall`);
      assert.ok(box.y < 1, `bar sits at the top of the page (y=${box.y})`);
      assert.equal(await bar(page).evaluate((el) => !!el.closest("header")), false, "bar is outside <header>");
      assert.ok(box.y + box.height <= (await h1Top(page)) + 0.5, "bar is above the title");
      assert.notEqual(await bar(page).evaluate((el) => getComputedStyle(el).position), "sticky");
      assert.notEqual(await bar(page).evaluate((el) => getComputedStyle(el).position), "fixed");

      const home = bar(page).getByRole("link", { name: "← Portfolio" });
      assert.equal(await home.isVisible(), true, "← Portfolio is on the collapsed bar");
      assert.equal(await home.getAttribute("href"), BACK);
      assert.ok(((await home.boundingBox())?.height ?? 0) >= 44, "back link is a 44px target");

      const t = toggle(page);
      assert.equal(await t.count(), 1, 'one button named "Demo details"');
      assert.equal(await t.getAttribute("aria-label"), "Demo details");
      assert.equal(await t.getAttribute("aria-expanded"), "false");
      assert.ok(await t.getAttribute("aria-controls"), "toggle names its panel");
      assert.ok(((await t.boundingBox())?.height ?? 0) >= 44, "toggle is a 44px target");
      assert.equal(await (await panelOf(page)).isHidden(), true, "drawer is closed on load");
      assert.equal((await bar(page).locator(".demo-bar__badge").textContent())?.trim(), "Demo");
      assert.equal(await t.locator('svg:not([aria-hidden="true"])').count(), 0, "chevron is decorative");

      const text = await bar(page).innerText();
      assert.match(text, /Sample data/);
      assert.doesNotMatch(text, /stay in this browser|saved/i, "the bar must not say changes are kept");
      if (vp.width >= 600) assert.match(text, /reload/i, "from 600px the summary says it resets on reload");
      assert.ok((await overflow(page)) <= 0, `scrolls sideways by ${await overflow(page)}px`);
      assert.deepEqual(errors, []);
      await page.close();
    });
  }
}

test("DEMO-BAR-2 at 320px: no sideways scroll, bar at most 48px, back link and toggle visible", async () => {
  for (const [name, html] of BUILDS) {
    const { page } = await openBuild(html(), { width: 320, height: 640 });
    assert.ok((await overflow(page)) <= 0, `${name}: scrolls sideways by ${await overflow(page)}px at 320`);
    assert.ok(((await bar(page).boundingBox())?.height ?? 99) <= 48, `${name}: bar height at 320`);
    assert.equal(await bar(page).getByRole("link", { name: "← Portfolio" }).isVisible(), true, `${name}: back link`);
    assert.equal(await toggle(page).isVisible(), true, `${name}: toggle`);
    await page.close();
  }
});

test("DEMO-BAR-3 opening shows the standard copy for Role Radar and pushes the app down", async () => {
  for (const [name, html] of BUILDS) {
    for (const vp of VIEWPORTS) {
      const { page } = await openBuild(html(), vp);
      const closedTop = await h1Top(page);
      await toggle(page).click();
      assert.equal(await toggle(page).getAttribute("aria-expanded"), "true");
      const panel = await panelOf(page);
      await panel.waitFor({ state: "visible" });
      const text = ((await panel.innerText()) ?? "").replace(/\s+/g, " ");
      assert.ok(text.includes(COPY_WHAT), `${name} ${vp.width}: drawer says "${COPY_WHAT}" (got "${text}")`);
      assert.ok(text.includes(COPY_RESET), `${name} ${vp.width}: drawer says "${COPY_RESET}"`);
      assert.ok(text.indexOf(COPY_WHAT) < text.indexOf(COPY_RESET), "what it is comes before how to start over");
      assert.doesNotMatch(text, /saved only in this browser|Reset demo puts/, "no claim the demo keeps changes");
      assert.ok((await h1Top(page)) > closedTop, `${name} ${vp.width}: the drawer pushes the app down instead of covering it`);
      const p = panel.locator("p").first();
      assert.ok(parseFloat(await p.evaluate((el) => getComputedStyle(el).fontSize)) >= 16, "drawer text is 16px+");
      const back = panel.locator(`a[href="${BACK}"]`);
      assert.ok((await back.count()) >= 1, `${name}: the way back in full, to ${BACK}`);
      assert.ok(((await back.first().boundingBox())?.height ?? 0) >= 44, "the drawer's back link is a 44px target");
      for (const b of await panel.locator("button, a").all()) {
        if (!(await b.isVisible())) continue;
        const h = (await b.boundingBox())?.height ?? 0;
        assert.ok(h >= 44, `${name}: "${(await b.innerText()).trim()}" is ${h}px tall`);
      }
      assert.ok((await overflow(page)) <= 0, `${name} ${vp.width}: open drawer scrolls sideways`);
      await page.close();
    }
  }
});

test("DEMO-BAR-4 Esc closes the drawer and puts focus back on the toggle", async () => {
  const { page } = await openBuild(buildDemo({ publicDemo: true }), VIEWPORTS[0]);
  const panel = await panelOf(page);
  // From the toggle itself.
  await toggle(page).click();
  await panel.waitFor({ state: "visible" });
  await page.keyboard.press("Escape");
  assert.equal(await toggle(page).getAttribute("aria-expanded"), "false");
  assert.equal(await panel.isHidden(), true);
  assert.equal(await toggle(page).evaluate((el) => el === document.activeElement), true, "focus on the toggle");
  // From a link inside the drawer.
  await toggle(page).click();
  await panel.waitFor({ state: "visible" });
  await panel.getByRole("link").first().focus();
  await page.keyboard.press("Escape");
  assert.equal(await toggle(page).getAttribute("aria-expanded"), "false");
  assert.equal(await panel.isHidden(), true);
  assert.equal(await toggle(page).evaluate((el) => el === document.activeElement), true, "focus back on the toggle");
  await page.close();
});

test("DEMO-BAR-5 the bar uses Role Radar's own font and surface, and the badge is not the accent color", async () => {
  for (const colorScheme of ["light", "dark"] as const) {
    const { page } = await openBuild(buildDemo({ publicDemo: true }), { ...VIEWPORTS[1], colorScheme });
    const r = await page.evaluate(() => {
      const probe = (prop: string, v: string) => { const i = document.createElement("i"); i.style.setProperty(prop, v); document.body.append(i); const c = getComputedStyle(i).getPropertyValue(prop); i.remove(); return c; };
      const b = document.querySelector('section[aria-label="Demo"]')!;
      const badge = b.querySelector(".demo-bar__badge")!;
      return {
        barFont: getComputedStyle(b).fontFamily, appFont: getComputedStyle(document.documentElement).getPropertyValue("--f-body").trim(),
        barBg: getComputedStyle(b).backgroundColor, surface: probe("background-color", "var(--surface)"),
        badgeBg: getComputedStyle(badge).backgroundColor, badgeFg: getComputedStyle(badge).color,
        accent: probe("background-color", "var(--accent)"), accentFg: probe("color", "var(--accent)"),
      };
    });
    assert.equal(r.barFont.replace(/\s+/g, ""), r.appFont.replace(/\s+/g, ""), `${colorScheme}: bar font`);
    assert.equal(r.barBg, r.surface, `${colorScheme}: bar background is --surface`);
    assert.notEqual(r.badgeBg, r.accent, `${colorScheme}: badge background is the accent`);
    assert.notEqual(r.badgeFg, r.accentFg, `${colorScheme}: badge text is the accent`);
    await page.close();
  }
});

test("DEMO-BAR-6 badge and summary text meet 4.5:1 against the bar in light and dark", async () => {
  for (const colorScheme of ["light", "dark"] as const) {
    const { page } = await openBuild(buildDemo({ publicDemo: true }), { ...VIEWPORTS[1], colorScheme });
    const ratios = await page.evaluate(() => {
      const rgb = (c: string) => c.match(/[\d.]+/g)!.slice(0, 3).map(Number);
      const lum = (c: string) => { const v = rgb(c).map((x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
      const ratio = (a: string, b: string) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
      const b = document.querySelector('section[aria-label="Demo"]')!;
      const bg = getComputedStyle(b).backgroundColor;
      const out: Record<string, number> = {};
      for (const el of b.querySelectorAll<HTMLElement>(".demo-bar__badge, button span, a")) {
        if (!el.offsetParent || !el.textContent!.trim()) continue;
        const own = getComputedStyle(el).backgroundColor;
        const back = /rgba\(.*,\s*0\)$/.test(own) || own === "transparent" ? bg : own;
        out[el.className || el.textContent!.trim()] = ratio(getComputedStyle(el).color, back);
      }
      return out;
    });
    assert.ok(Object.keys(ratios).length >= 2, "found the badge and summary");
    for (const [k, v] of Object.entries(ratios)) assert.ok(v >= 4.5, `${colorScheme} ${k}: ${v.toFixed(2)}:1`);
    await page.close();
  }
});

test("DEMO-BAR-7 nothing persists, so there is no Reset demo or Keep button", async () => {
  for (const [name, html] of BUILDS) {
    const { page } = await openBuild(html(), VIEWPORTS[0]);
    await toggle(page).click();
    const panel = await panelOf(page);
    await panel.waitFor({ state: "visible" });
    assert.equal(await panel.getByRole("button", { name: /Reset/ }).count(), 0, `${name}: no Reset button`);
    assert.equal(await panel.getByRole("button", { name: "Keep" }).count(), 0, `${name}: no Keep button`);
    await page.close();
  }
});

test("DEMO-BAR-8 the old demo notice and #showcase strip are gone: the bar is the only demo mark", async () => {
  for (const [name, html] of BUILDS) {
    for (const query of name === "public" ? ["", "?full"] : [""]) {
      const { page } = await openBuild(html(), { ...VIEWPORTS[0], query });
      for (const id of ["#demoNote", "#demoTry", "#showcase"]) assert.equal(await page.locator(id).count(), 0, `${name}${query}: ${id} removed`);
      const header = await page.locator("header").innerText();
      assert.doesNotMatch(header, /Demo data|Try anything|resets when you reload/i, `${name}${query}: no demo line in the header`);
      assert.equal(await page.getByRole("region", { name: "Demo" }).count(), 1);
      assert.equal(await page.locator(`a[href="${BACK}"]:visible`).count(), 1, `${name}${query}: one visible way back (in the bar)`);
      await page.close();
    }
  }
});

// Evidence for dropping Reset: a visitor's change is gone after a reload (the in-memory demo database re-seeds).
test("DEMO-BAR-9 reload really starts over: a role moved out of New is back after reloading", async () => {
  const { page } = await openBuild(buildDemo({ publicDemo: true }), { ...VIEWPORTS[1], query: "?tab=inbox", ready: ".job" });
  const first = page.locator("article.job").first();
  const title = await first.locator("h2").innerText();
  await first.locator("button[data-quick=saved]").click();
  await page.waitForFunction((t) => ![...document.querySelectorAll("#view article.job h2")].some((h) => h.textContent === t), title);
  await page.reload();
  await page.waitForSelector(".job");
  await page.click("#tab-inbox");
  await page.waitForFunction((t) => [...document.querySelectorAll("#view article.job h2")].some((h) => h.textContent === t), title, { timeout: 3000 });
  await page.close();
});

test("DEMO-BAR-10 the live page (no demo flag) shows no Demo bar", async () => {
  const live = buildDemo().replace("window.__RR_DEMO__ = true", "window.__RR_DEMO__ = false");
  assert.ok(!live.includes("window.__RR_DEMO__ = true"), "test setup: demo flag switched off");
  for (const vp of VIEWPORTS) {
    const { page, errors } = await openBuild(live, vp);
    assert.equal(await page.getByRole("region", { name: "Demo" }).count(), 0, `${vp.width}: no Demo region`);
    assert.equal(await page.getByRole("button", { name: "Demo details" }).count(), 0);
    assert.equal(await page.getByRole("link", { name: "← Portfolio" }).count(), 0);
    assert.equal(await page.locator(".demo-bar:visible").count(), 0);
    assert.deepEqual(errors, []);
    await page.close();
  }
});
