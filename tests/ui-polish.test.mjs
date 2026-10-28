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

// ── RR-UX4: ux-reviewer AFTER pass (6.5/10). Private build unless noted; demo data only; red first. ──
const openPrivate = (opts = {}) => openDemo({ html: buildDemo(), ...opts });
const openEmpty = (opts = {}) => openDemo({ html: buildDemo({ seed: {} }), ready: "#tab-inbox", ...opts });
const filterFieldsShown = (page) => page.locator("#fbar .fields").evaluate((el) => !!el.offsetParent && el.getBoundingClientRect().height > 0);

test("RR-UX4-1 filters start collapsed behind 'Filters and sort' at every width, so Pipeline's first role shows on a laptop screen", async () => {
  for (const vp of [LAPTOP, PHONE]) {
    const { page } = await openPrivate(vp);
    for (const id of ["inbox", "pipeline", "all"]) {
      await page.click(`#tab-${id}`);
      assert.equal(await filterFieldsShown(page), false, `filter fields hidden by default on ${id} at ${vp.width}`);
      assert.ok(await page.locator("#ftoggle").isVisible(), `#ftoggle visible on ${id} at ${vp.width}`);
      assert.equal(await page.locator("#ftoggle").getAttribute("aria-expanded"), "false");
    }
    await page.close();
  }
  const { page } = await openPrivate(LAPTOP);
  await page.click("#tab-pipeline");
  const t = await page.locator("#view .job h2").first().boundingBox();
  assert.ok(t && t.y + t.height <= 800, `first Pipeline title ends at ${Math.round(t.y + t.height)}px (viewport 800)`);
  await page.click("#ftoggle");
  assert.equal(await page.locator("#ftoggle").getAttribute("aria-expanded"), "true");
  assert.equal(await filterFieldsShown(page), true, "toggle still opens the filters");
  await page.close();
});

test("RR-UX4-2 Pipeline's 'Check Gmail' and 'Add a role' rows are full-size targets with room before the first card", async () => {
  const { page } = await openPrivate(LAPTOP);
  await page.click("#tab-pipeline");
  const m = await page.evaluate(() => {
    const sums = [...document.querySelectorAll("#view > details > summary, #view details:not(.job details) > summary")]
      .filter((s) => !s.closest(".job") && s.offsetParent).map((s) => ({ text: s.textContent.trim(), h: s.getBoundingClientRect().height }));
    const dets = [...document.querySelectorAll("#view details")].filter((d) => !d.closest(".job") && d.offsetParent);
    const last = dets[dets.length - 1], job = document.querySelector("#view .job");
    return { sums, gap: last && job ? job.getBoundingClientRect().top - last.getBoundingClientRect().bottom : null };
  });
  assert.ok(m.sums.length >= 2, `found ${m.sums.length} section rows`);
  for (const s of m.sums) assert.ok(s.h >= 44, `'${s.text}' row is ${Math.round(s.h)}px tall at 1280`);
  assert.ok(m.gap !== null && m.gap >= 12, `gap from last section row to first card is ${m.gap === null ? "n/a" : Math.round(m.gap)}px`);
  await page.close();
});

test("RR-UX4-3 on a phone each Values/Culture reason sits under its label and uses the card's width", async () => {
  const { page } = await openPrivate(PHONE);
  await page.click("#tab-all");
  const rows = await page.locator(".job .fitr").evaluateAll((els) => els.flatMap((f) => {
    const fw = f.getBoundingClientRect().width, ks = [...f.querySelectorAll(".k")];
    return [...f.querySelectorAll(".r")].map((r, i) => {
      const rb = r.getBoundingClientRect(), kb = ks[i]?.getBoundingClientRect();
      return { below: kb ? rb.top >= kb.bottom - 1 : false, ratio: rb.width / fw };
    });
  }));
  assert.ok(rows.length >= 4);
  for (const r of rows) {
    assert.ok(r.below, "reason starts below its label row");
    assert.ok(r.ratio >= 0.85, `reason spans ${Math.round(r.ratio * 100)}% of the fit block`);
  }
  await page.close();
});

test("RR-UX4-4 every card on Pipeline, All and Needs action has at most one emphasized (accent) action", async () => {
  const { page } = await openPrivate(LAPTOP);
  const accent = await accentRgb(page);
  for (const id of ["pipeline", "all", "action"]) {
    await page.click(`#tab-${id}`);
    const cards = await page.locator("#view .job").evaluateAll((els, accent) => els.map((c) => {
      const btns = [...c.querySelectorAll("button, a.btn")].filter((b) => b.offsetParent && !b.closest("details"));
      const filled = btns.filter((b) => b.matches(".btn.cta, .primary") || getComputedStyle(b).backgroundColor === accent);
      const accented = btns.filter((b) => { const cs = getComputedStyle(b); return cs.backgroundColor === accent || cs.borderTopColor === accent; });
      return { title: c.querySelector("h2")?.textContent.trim(), filled: filled.map((b) => b.textContent.trim()), accented: accented.map((b) => b.textContent.trim()) };
    }), accent);
    assert.ok(cards.length >= 1, `cards on ${id}`);
    for (const c of cards) {
      assert.ok(c.filled.length <= 1, `${id}: '${c.title}' has ${c.filled.length} filled primaries: ${c.filled.join(", ")}`);
      assert.ok(c.accented.length <= 1, `${id}: '${c.title}' has competing accent actions: ${c.accented.join(", ")}`);
    }
  }
  await page.close();
});

test("RR-UX4-5 on an empty criteria editor 'Start from the example' is the primary; once there's text, Save is", async () => {
  const { page } = await openEmpty(LAPTOP);
  const accent = await accentRgb(page);
  await page.click("#tab-criteria");
  await page.locator("#critText").waitFor({ state: "visible", timeout: 3000 });
  const bg = (name) => page.getByRole("button", { name }).evaluate((b) => getComputedStyle(b).backgroundColor);
  assert.equal(await bg(/start from the example/i), accent, "example is solid primary on an empty editor");
  assert.notEqual(await bg(/save criteria/i), accent, "Save is not primary on an empty editor");
  await page.locator("#critText").fill("weights:\n  sector: 1\n");
  await page.locator("#critText").dispatchEvent("input");
  assert.equal(await bg(/save criteria/i), accent, "Save becomes primary once there's text");
  await page.close();
});

test("RR-UX4-6 first run with no criteria: New's empty state points to Criteria", async () => {
  const { page } = await openEmpty(LAPTOP);
  await page.click("#tab-inbox");
  const text = await page.locator("#view").innerText();
  assert.match(text, /set your criteria/i, "empty New mentions setting criteria");
  const btn = page.locator("#view").getByRole("button", { name: /open criteria/i });
  assert.equal(await btn.count(), 1, "'Open Criteria' button in the empty state");
  await btn.click();
  assert.equal(await page.locator("#tab-criteria").getAttribute("aria-selected"), "true");
  await page.close();
});

test("RR-UX4-7 on a phone the score math is small and at most two lines", async () => {
  const { page } = await openPublic(PHONE);
  const m = await page.locator(".job .score-math, .job .why-score").evaluateAll((els) => els.map((e) => {
    const cs = getComputedStyle(e), fs = parseFloat(cs.fontSize);
    const lh = cs.lineHeight === "normal" ? fs * 1.2 : parseFloat(cs.lineHeight);
    return { fs, h: e.getBoundingClientRect().height, lh };
  }));
  assert.ok(m.length >= 3, "score math on several New cards");
  for (const x of m) {
    assert.ok(x.fs <= 13.5, `score math ${x.fs}px`);
    assert.ok(x.h <= 2.6 * x.lh, `score math ${Math.round(x.h)}px tall = ${(x.h / x.lh).toFixed(1)} lines`);
  }
  await page.close();
});

test("RR-UX4-8 a failed load looks like an error, not loading: solid border and a filled Reload", async () => {
  const { page } = await openPrivate({ ...LAPTOP, query: "?fail=jobs", ready: "#tab-inbox" });
  const accent = await accentRgb(page);
  const card = page.locator("[role=alert]").filter({ hasText: /couldn.t load your roles/i }).first();
  await card.waitFor({ state: "visible", timeout: 3000 });
  assert.equal(await card.evaluate((e) => getComputedStyle(e).borderTopStyle), "solid", "error card border");
  const reload = card.getByRole("button", { name: /reload/i });
  assert.equal(await reload.evaluate((b) => getComputedStyle(b).backgroundColor), accent, "Reload is a filled primary");
  await page.close();
});

// ── RR-UX5: ux-reviewer pass at 7.0/10. Remaining P1/P2 findings; demo data only; red first. ──
// Distinct text-line rows an element's visible text renders on (rounded line tops).
const lineRows = (els) => {
  const tops = new Set();
  for (const el of els) {
    if (!el || el.hidden || !el.getClientRects().length) continue;
    const r = document.createRange(); r.selectNodeContents(el);
    for (const b of r.getClientRects()) if (b.width > 1 && b.height > 1) tops.add(Math.round(b.top / 6));
  }
  return tops.size;
};

test("RR-UX5-1 at 1280 the tabs are one row and every tab still opens (public, ?full and private)", async () => {
  const bad = [];
  for (const [name, opts] of [["public", {}], ["public ?full", { query: "?full" }], ["private", { html: buildDemo() }]]) {
    const { page } = name === "private" ? await openDemo({ ...LAPTOP, ...opts }) : await openPublic({ ...LAPTOP, ...opts });
    const t = await page.locator("#tabs").evaluate((el) => {
      const bs = [...el.querySelectorAll("button")].filter((b) => b.offsetParent);
      return { n: bs.length, tops: [...new Set(bs.map((b) => Math.round(b.getBoundingClientRect().top)))], h: el.getBoundingClientRect().height };
    });
    assert.ok(t.n >= 2, `${name}: ${t.n} tabs`);
    if (t.tops.length !== 1 || t.h >= 56) bad.push(`${name}: ${t.n} tabs on ${t.tops.length} rows, #tabs ${Math.round(t.h)}px tall`);
    const ids = await page.locator("#tabs button").evaluateAll((els) => els.filter((e) => e.offsetParent).map((e) => e.id));
    for (const id of ids) {
      await page.locator("#" + id).click();
      assert.equal(await page.locator("#" + id).getAttribute("aria-selected"), "true", `${name}: ${id} opens`);
    }
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth) <= 1280, `${name}: no sideways page scroll`);
    await page.close();
  }
  assert.deepEqual(bad, []);
});

test("RR-UX5-2 at 1280 the header meta is at most 2 lines and New's first role title shows above 800px", async () => {
  const bad = [];
  for (const [name, go] of [["public", () => openPublic(LAPTOP)], ["private", () => openPrivate(LAPTOP)]]) {
    const { page } = await go();
    await page.click("#tab-inbox");
    const rows = await page.evaluate((src) => (0, eval)(`(${src})`)([...document.querySelectorAll("header #demoNote, header #demoTry, header #progress, header #scanLine")]), String(lineRows));
    const dig = await page.locator("#digestCard").evaluate((d) => d.open).catch(() => null);
    assert.notEqual(dig, false, `${name}: digest card is open by default at 1280`);
    const t = await page.locator("#view article.job h2").first().boundingBox();
    if (rows > 2) bad.push(`${name}: header meta (demo note, today, last scan) renders on ${rows} lines`);
    if (!(t && t.y >= 0 && t.y + t.height <= 800)) bad.push(`${name}: first New title ends at ${t ? Math.round(t.y + t.height) : "n/a"}px (viewport 800)`);
    await page.close();
  }
  assert.deepEqual(bad, []);
});

test("RR-UX5-3 Apply shows only before applying: not on Applied, Screen, Interviewing or Offer cards", async () => {
  const { page } = await openPrivate(LAPTOP);
  const seen = new Set();
  for (const id of ["pipeline", "all"]) {
    await page.click(`#tab-${id}`);
    const cards = await page.locator("#view article.job").evaluateAll((els) => els.map((c) => ({
      title: c.querySelector("h2")?.textContent.trim(),
      status: c.querySelector("select[data-setstatus]")?.value,
      apply: [...c.querySelectorAll("button, a")].filter((b) => b.offsetParent && (b.matches("[data-apply]") || /^\s*apply\b/i.test(b.textContent))).map((b) => b.textContent.trim()),
    })));
    for (const c of cards) {
      seen.add(c.status);
      if (["applied", "screen", "interviewing", "offer"].includes(c.status))
        assert.deepEqual(c.apply, [], `${id}: '${c.title}' (${c.status}) still shows ${c.apply.join(", ")}`);
      if (["new", "viewed", "saved", "applying"].includes(c.status))
        assert.ok(c.apply.length >= 1, `${id}: '${c.title}' (${c.status}) lost its Apply`);
    }
  }
  assert.ok(["applied", "screen", "interviewing"].some((s) => seen.has(s)), `demo covers applied-or-later cards (saw ${[...seen].join(", ")})`);
  assert.ok(["saved", "applying"].some((s) => seen.has(s)), "demo covers saved/applying cards");
  await page.close();
});

test("RR-UX5-5 on a phone Progress's 'Follow-up sent' button text stays on one line", async () => {
  const { page } = await openPrivate(PHONE);
  await page.click("#tab-progress");
  const b = page.locator("section[aria-labelledby=pg-fu] button", { hasText: "Follow-up sent" }).first();
  await b.waitFor();
  const rows = await b.evaluate((el, src) => (0, eval)(`(${src})`)([el]), String(lineRows));
  const m = await b.evaluate((el) => ({ h: el.getBoundingClientRect().height, ws: getComputedStyle(el).whiteSpace }));
  assert.equal(rows, 1, `'Follow-up sent' wraps to ${rows} lines at 390 (height ${Math.round(m.h)}px, white-space ${m.ws})`);
  await page.close();
});
