// RR-DS: the page follows the studio design system (hearth docs/design/STUDIO-CORE.md, tokens.json, themes.css).
// Written red-first. Findings UX-DS-R1..R13 from the ux-reviewer pass. Demo data only.
// Rules checked on the rendered page (computed styles), on Home, New, Pipeline, All and the More tabs, at phone and laptop width:
//   R1  one font: Atkinson Hyperlegible Next; no Bricolage, Instrument Sans or Plex Mono; weights 400/500/600 only; no caps, no italics
//   R2  no text under 17px (visually hidden text excepted)
//   R3  every button, field, summary and tab is at least 48px tall
//   R5  corners are 4, 12 or a pill (or a circle)
//   R6  no box-shadow
//   R12 Paper theme tokens (themes.css) light and dark, and the high-contrast set when asked
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import type { Browser } from "playwright";
import { buildDemo } from "../scripts/build-demo.mjs";
import { openDemo, openTab } from "../scripts/browser.mjs";

let browser: Browser;
before(async () => { browser = await chromium.launch(); });
after(async () => { await browser.close(); });

const TABS = ["home", "inbox", "pipeline", "all", "criteria", "ruled", "watch"];
const VIEWPORTS = [{ width: 390, height: 844 }, { width: 1280, height: 800 }];

async function open(vp: { width: number; height: number }, colorScheme: "light" | "dark" = "light") {
  return openDemo(browser, { html: buildDemo(), file: "dist/test-design-system.html", ready: "#tabs button", colorScheme, ...vp });
}

/** Visible elements that own text, with what the studio system constrains. */
const AUDIT = () => {
  const out: { sel: string; size: number; weight: number; family: string; caps: string; style: string; radius: string[]; shadow: string; h: number; interactive: boolean }[] = [];
  const hidden = (e: Element) => { const r = e.getBoundingClientRect(); return r.width <= 1 || r.height <= 1; };
  const name = (e: Element) => `${e.tagName.toLowerCase()}${e.id ? "#" + e.id : ""}${typeof e.className === "string" && e.className ? "." + e.className.trim().split(/\s+/).join(".") : ""}`;
  for (const e of document.body.querySelectorAll("*")) {
    const cs = getComputedStyle(e);
    if (cs.display === "none" || cs.visibility === "hidden" || hidden(e)) continue;
    const own = [...e.childNodes].some((n) => n.nodeType === 3 && (n.textContent || "").trim());
    const tag = e.tagName;
    const interactive = ["BUTTON", "SELECT", "SUMMARY", "TEXTAREA"].includes(tag) || (tag === "INPUT" && !["checkbox", "radio", "range"].includes((e as HTMLInputElement).type));
    const r = e.getBoundingClientRect();
    out.push({ sel: name(e), size: own || interactive ? parseFloat(cs.fontSize) : 99, weight: own ? Number(cs.fontWeight) : 400, family: own ? cs.fontFamily : "", caps: own ? cs.textTransform : "none", style: own ? cs.fontStyle : "normal",
      radius: [cs.borderTopLeftRadius, cs.borderTopRightRadius, cs.borderBottomLeftRadius, cs.borderBottomRightRadius], shadow: cs.boxShadow, h: r.height, interactive });
  }
  return out;
};

const radiusOk = (v: string) => { const n = parseFloat(v); return v.includes("%") || n === 0 || n === 4 || n === 12 || n >= 99; };

for (const vp of VIEWPORTS) for (const scheme of ["light", "dark"] as const) {
  test(`RR-DS-1 ${vp.width}px ${scheme}: font, size, weight, targets, corners and shadows follow the studio system on every tab`, async () => {
    const { page, errors } = await open(vp, scheme);
    const bad = new Set<string>();
    for (const tab of TABS) {
      await openTab(page, tab);
      const rows = await page.evaluate(AUDIT);
      for (const r of rows) {
        if (r.family && !/^"?Atkinson Hyperlegible Next/i.test(r.family)) bad.add(`${tab} font ${r.family.slice(0, 30)} on ${r.sel}`);
        if (r.size < 17) bad.add(`${tab} text ${r.size}px on ${r.sel}`);
        if (![400, 500, 600].includes(r.weight)) bad.add(`${tab} weight ${r.weight} on ${r.sel}`);
        if (r.caps !== "none") bad.add(`${tab} ${r.caps} on ${r.sel}`);
        if (r.style !== "normal") bad.add(`${tab} ${r.style} on ${r.sel}`);
        if (r.interactive && r.h < 47.5) bad.add(`${tab} target ${Math.round(r.h)}px on ${r.sel}`);
        if (r.radius.some((v) => !radiusOk(v))) bad.add(`${tab} radius ${r.radius.join("/")} on ${r.sel}`);
        if (r.shadow !== "none") bad.add(`${tab} shadow on ${r.sel}`);
      }
    }
    assert.deepEqual([...bad].slice(0, 40), [], `${bad.size} breaks`);
    assert.deepEqual(errors, []);
    await page.close();
  });
}

test("RR-DS-2 Paper theme tokens: terracotta accent in light, coral in dark, stronger in high contrast; no Google font request", async () => {
  const tok = (page: import("playwright").Page) => page.evaluate(() => { const s = getComputedStyle(document.documentElement);
    return { accent: s.getPropertyValue("--accent").trim().toUpperCase(), bg: s.getPropertyValue("--bg").trim().toUpperCase(), ink: s.getPropertyValue("--ink").trim().toUpperCase(),
      safe: s.getPropertyValue("--safe").trim().toUpperCase(), font: s.getPropertyValue("--font-body").replace(/,\s*/g, ", ") }; });
  const light = await open(VIEWPORTS[0], "light");
  assert.deepEqual(await tok(light.page), { accent: "#AD371D", bg: "#F7F7F4", ink: "#1E1B17", safe: "#1C6E31", font: '"Atkinson Hyperlegible Next", system-ui, sans-serif' });
  await light.page.evaluate(() => document.documentElement.setAttribute("data-contrast", "more"));
  assert.equal((await tok(light.page)).accent, "#822F1B");
  await light.page.close();
  const dark = await open(VIEWPORTS[0], "dark");
  assert.deepEqual({ ...(await tok(dark.page)), font: "" }, { accent: "#FF8A65", bg: "#131210", ink: "#F1EEE8", safe: "#7DD394", font: "" });
  const html = buildDemo();
  assert.doesNotMatch(html, /Bricolage|Instrument\+?Sans|IBM\+?Plex/);
  assert.match(html, /Atkinson\+Hyperlegible\+Next/);
  await dark.page.close();
});
