// UI polish to 8/10 (ux-reviewer RR-UX3-*, before score 5/10: 390px 4.5, 1280px 5.5). Each test pins the
// user-visible outcome of one P0/P1 fix with thresholds, not pixel-perfect values. Demo data only; red first.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { buildDemo } from "../scripts/build-demo.mjs";
import { openDemo as open } from "../scripts/browser.mjs";

let browser;
const openDemo = (opts = {}) => open(browser, { ...opts, file: "dist/test-ui-polish.html" });
const openPublic = (opts = {}) => openDemo({ html: buildDemo({ publicDemo: true }), ...opts });
const PHONE = { width: 390, height: 844 };
const LAPTOP = { width: 1280, height: 800 };
const accentRgb = (page) => page.evaluate(() => {
  const s = document.createElement("span");
  s.style.color = "var(--accent)"; document.body.append(s);
  const c = getComputedStyle(s).color; s.remove(); return c;
});

before(async () => { browser = await chromium.launch(); });
after(async () => { await browser?.close(); });

test("RR-UX3-1 each role card's score is a prominent tile at the card's top right", async () => {
  const { page } = await openPublic(LAPTOP);
  const cards = await page.locator(".job").evaluateAll((els) => els.filter((c) => c.querySelector(".score")).map((c) => {
    const s = c.querySelector(".score"), cs = getComputedStyle(s), b = s.getBoundingClientRect(), r = c.getBoundingClientRect();
    return { font: parseFloat(cs.fontSize), weight: Number(cs.fontWeight), w: b.width, h: b.height, dTop: b.top - r.top, dRight: r.right - b.right };
  }));
  assert.ok(cards.length >= 3, "cards with a score");
  for (const c of cards) {
    assert.ok(c.font >= 22, `score font ${c.font}px`);
    assert.ok(c.weight >= 700, `score weight ${c.weight}`);
    assert.ok(c.w >= 44 && c.h >= 44, `score box ${Math.round(c.w)}x${Math.round(c.h)}`);
    assert.ok(c.dTop <= 24, `score sits ${Math.round(c.dTop)}px below the card top`);
    assert.ok(c.dRight <= 40, `score sits ${Math.round(c.dRight)}px from the card's right edge`);
  }
  await page.close();
});

test("RR-UX3-2 on a phone the tabs are one scrollable row and the first title shows on the first screen", async () => {
  const { page } = await openPublic(PHONE);
  const t = await page.locator("#tabs").evaluate((el) => {
    const cs = getComputedStyle(el);
    return { wrap: cs.flexWrap, ox: cs.overflowX, h: el.getBoundingClientRect().height };
  });
  assert.equal(t.wrap, "nowrap", "tabs don't wrap");
  assert.ok(["auto", "scroll"].includes(t.ox), `tabs scroll sideways (overflow-x ${t.ox})`);
  assert.ok(t.h < 60, `tab row is ${Math.round(t.h)}px tall`);
  const title = await page.locator(".job h2").first().boundingBox();
  assert.ok(title.y >= 0 && title.y + title.height <= 844, `first title ends at ${Math.round(title.y + title.height)}px`);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth) <= 390, "no sideways page scroll");
  // Every tab is still reachable: scroll it into view and pick it.
  const ids = await page.locator("#tabs button").evaluateAll((els) => els.map((e) => e.id));
  assert.ok(ids.length >= 2);
  for (const id of ids) {
    await page.locator("#" + id).scrollIntoViewIfNeeded();
    await page.locator("#" + id).click();
    assert.equal(await page.locator("#" + id).getAttribute("aria-selected"), "true", `${id} opens`);
  }
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth) <= 390, "no sideways page scroll after switching");
  await page.close();
});

test("RR-UX3-3 on a phone each role title spans most of the card's width", async () => {
  const { page } = await openPublic(PHONE);
  const ratios = await page.locator(".job").evaluateAll((els) => els.map((c) => {
    const cs = getComputedStyle(c), inner = c.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    return c.querySelector("h2").getBoundingClientRect().width / inner;
  }));
  assert.ok(ratios.length >= 3);
  for (const r of ratios) assert.ok(r >= 0.75, `title spans ${Math.round(r * 100)}% of the card`);
  await page.close();
});

test("RR-UX3-4 each New card has one primary action and laptop-sized targets", async () => {
  const { page } = await openPublic(LAPTOP);
  const accent = await accentRgb(page);
  const cards = await page.locator(".job").evaluateAll((els, accent) => els.map((c) => {
    const btns = [...c.querySelectorAll(".ctl button, .ctl .btn, .apply-row button")].filter((b) => b.offsetParent);
    const solid = btns.filter((b) => getComputedStyle(b).backgroundColor === accent);
    return { n: btns.length, solid: solid.length, minH: Math.min(...btns.map((b) => b.getBoundingClientRect().height)) };
  }), accent);
  assert.ok(cards.length >= 3);
  for (const c of cards) {
    assert.equal(c.solid, 1, `${c.solid} of ${c.n} actions are solid accent (want exactly one primary)`);
    assert.ok(c.minH >= 36, `smallest card button ${Math.round(c.minH)}px tall at 1280`);
  }
  const tabH = await page.locator("#tabs button").evaluateAll((els) => Math.min(...els.map((e) => e.getBoundingClientRect().height)));
  assert.ok(tabH >= 36, `tab buttons ${Math.round(tabH)}px tall at 1280`);
  await page.close();
  const phone = await openPublic(PHONE);
  const minPhone = await phone.page.locator(".job .ctl button, .job .ctl .btn, #tabs button").evaluateAll((els) =>
    Math.min(...els.filter((b) => b.offsetParent).map((b) => b.getBoundingClientRect().height)));
  assert.ok(minPhone >= 44, `smallest button ${Math.round(minPhone)}px tall at 390`);
  await phone.page.close();
});

test("RR-UX3-5 the Values/Culture text column lines up across every card", async () => {
  for (const vp of [LAPTOP, PHONE]) {
    const { page } = await openDemo({ ...vp, query: "" });
    await page.click("#tab-all");
    const xs = await page.locator(".job .fitr .r").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().left));
    assert.ok(xs.length >= 4, "fit rows on several cards");
    const spread = Math.max(...xs) - Math.min(...xs);
    assert.ok(spread <= 1, `text column x varies by ${Math.round(spread)}px at ${vp.width}`);
    await page.close();
  }
});

test("RR-UX3-6 links in the page use the accent and the 'see Alerts' link is a phone-sized target", async () => {
  const { page } = await openDemo(PHONE);
  const accent = await accentRgb(page);
  await page.click("#tab-criteria");
  const link = page.locator('#view a[href="#alerts"]');
  await link.waitFor();
  const colors = await page.locator("#view a:not(.btn)").evaluateAll((els) => els.filter((a) => a.offsetParent).map((a) => getComputedStyle(a).color));
  assert.ok(colors.length >= 1);
  for (const c of colors) {
    assert.notEqual(c, "rgb(0, 0, 238)", "no default browser-blue links");
    assert.equal(c, accent, "links use the accent");
  }
  const h = (await link.boundingBox()).height;
  assert.ok(h >= 44, `'see Alerts' link is ${Math.round(h)}px tall at 390`);
  await page.close();
});

test("RR-UX3-7 body text is 16px and chips, company names and fit keys aren't all caps", async () => {
  const { page } = await openPublic(LAPTOP);
  const body = await page.evaluate(() => parseFloat(getComputedStyle(document.body).fontSize));
  assert.ok(body >= 16, `body text ${body}px`);
  const caps = await page.locator(".job .chip, .job .co, .job .fitr .k small").evaluateAll((els) =>
    els.filter((e) => !e.classList.contains("demo") && getComputedStyle(e).textTransform === "uppercase")
      .map((e) => e.className || e.tagName));
  assert.deepEqual([...new Set(caps)], [], "elements still set in uppercase");
  await page.close();
});
