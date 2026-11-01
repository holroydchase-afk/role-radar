// ux-reviewer findings on the Search settings card and the Work/Pay filters (docs/reviews/2026-11-01-settings-filters.md,
// UX-R1..R7). Written red first, before the fixes. UX-R8 (demo seed) is deferred; UX-R9 (VoiceOver on a real iPhone) is
// manual. Demo data only: every company below is made up and marked "(demo)"; the criteria are the repo's example
// criteria.yaml (a made-up demo candidate).
//
// Also changed to the new intended behavior: RR-FS-3 and DCL-11 (chip order, UX-R1) and CARD-9 (meta line, UX-R4).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chromium } from "playwright";
import type { Browser, Page } from "playwright";
import { buildDemo } from "../scripts/build-demo.mjs";
import { openDemo as open, openTab, currentTab } from "../scripts/browser.mjs";

const read = (p: string) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const SPEC = read("criteria.yaml");
const baseSeed = () => JSON.parse(read("demo/seed.json"), (k, v) => (typeof v === "string" && v.startsWith("@file:") ? read(v.slice(6)) : v));
const FILE = "dist/test-settings-review.html";
const PHONE = { width: 390, height: 844 };
const LAPTOP = { width: 1280, height: 800 };
const settle = (page: Page) => page.waitForTimeout(150);

let browser: Browser;
before(async () => { browser = await chromium.launch(); });
after(async () => { await browser?.close(); });

type Opts = Parameters<typeof open>[1];
/** The Criteria tab. `ready` is #settings, not #critText: after UX-R5 the editor is folded away by default. */
async function openCriteria(spec?: string, opts: Opts = {}) {
  const seed = baseSeed();
  if (spec !== undefined) seed.meta.criteria.spec = spec;
  return open(browser, { html: buildDemo({ seed }), file: FILE, ready: "#settings", query: "?tab=criteria", ...opts });
}
const role = (company: string, location: string | undefined, comp: string | undefined) =>
  ({ company, title: "Senior Product Manager", ...(location !== undefined ? { location } : {}), ...(comp ? { comp } : {}), fit: "maybe", status: "new", statusAt: "@t-0", firstSeen: "@t-0", source: "greenhouse" });
const JOBS = {
  "rv-us": role("Lumenfield (demo)", "Remote, US", "$170K–$205K"),
  "rv-den": role("Frontrange Grid (demo)", "Denver, CO (Hybrid)", "$175K–$205K"),
  "rv-unk": role("Lakeshore Data (demo)", "Chicago, IL", "$160K–$190K"),
  "rv-nopay": role("Openfield (demo)", "Remote, US", undefined),
};
const openRoles = (opts: Opts = {}) =>
  open(browser, { html: buildDemo({ seed: { ...baseSeed(), jobs: JOBS, companies: {}, recruiters: {} } }), file: FILE, ready: "#view article.job", query: "?tab=inbox", ...LAPTOP, ...opts });
async function filtersSheet(page: Page) {
  if ((await page.locator("#ftoggle").getAttribute("aria-expanded")) !== "true") await page.click("#ftoggle");
  await page.locator("#fv-pay-lo").waitFor({ state: "visible", timeout: 3000 });
}
const isOff = (page: Page, sel: string) => page.locator(sel).evaluate((el) => (el as HTMLInputElement).disabled === true || el.getAttribute("aria-disabled") === "true");

// ── UX-R1 (P1): Remote (US) is the 2nd quick chip and fully on screen at 390px ──────────────────────────────────
test("UX-R1 at 390x844 the quick chips read Last 24 hrs, Remote (US), Strong fit, Good values, Good culture, and Remote (US) is fully in view", async () => {
  const { page, errors } = await open(browser, { ...PHONE, file: FILE, ready: "#tab-inbox .n" });
  await openTab(page, "inbox");
  await settle(page);
  assert.deepEqual(await page.locator("#fbar .chips [data-chip]").allInnerTexts(), ["Last 24 hrs", "Remote (US)", "Strong fit", "Good values", "Good culture"]);
  const m = await page.evaluate(() => {
    const row = document.querySelector("#fbar .chips") as HTMLElement, chip = row.querySelector('[data-chip="remote"]') as HTMLElement;
    const r = chip.getBoundingClientRect();
    return { scrollLeft: row.scrollLeft, pageX: window.scrollX, left: r.left, right: r.right, vw: document.documentElement.clientWidth };
  });
  assert.equal(m.scrollLeft, 0, "no sideways swipe on the chip row");
  assert.equal(m.pageX, 0, "no sideways page scroll");
  assert.ok(m.left >= 0 && m.right <= 390, `Remote (US) spans x=${Math.round(m.left)}..${Math.round(m.right)}, want inside 0..390`);
  assert.deepEqual(errors, []);
  await page.close();
});

// ── UX-R2 (P1): the Settings pay boxes say Floor and Stretch target, not Min / Max ─────────────────────────────
test("UX-R2 the Settings pay boxes are labeled Floor and Stretch target, and the value line reads Floor $150K · Target $185K", async () => {
  const { page, errors } = await openCriteria();
  // The label's words (an input adds no text; UX-R7's "$" prefix is dropped).
  const name = async (sel: string) => (await page.locator(sel).innerText()).replace(/\$/g, "").replace(/\s+/g, " ").trim();
  assert.equal(await name("label[for=set-pay-min]"), "Floor");
  assert.equal(await name("label[for=set-pay-max]"), "Stretch target");
  assert.equal((await page.locator("#set-pay-val").innerText()).trim(), "Floor $150K · Target $185K");
  // The hint stays.
  assert.match(await page.locator("#settings").innerText(), /Pay that reaches the stretch target adds 10 to the score\./);
  assert.deepEqual(errors, []);
  await page.close();
});

// ── UX-R3 (P1): Include-no-pay is disabled, with a hint, while Pay is Any ──────────────────────────────────────
test("UX-R3 while Pay is the full range, Include roles with no pay listed is disabled with 'Set a pay range first.'; moving a handle enables it", async () => {
  const { page, errors } = await openRoles(PHONE);
  await filtersSheet(page);
  const np = page.locator("#fv-nopay");
  const hint = page.locator("#fv-pay").getByText("Set a pay range first.", { exact: true });
  assert.equal(await np.isVisible(), true, "the box stays visible");
  assert.equal(await np.isDisabled(), true, "full range: the box is disabled");
  assert.equal(await hint.count(), 1, 'the hint "Set a pay range first." is in the Pay group');
  assert.equal(await hint.isVisible(), true, "the hint shows while Pay is Any");
  await page.locator("#fv-pay-lo").focus();
  await page.keyboard.press("ArrowRight");
  await settle(page);
  assert.equal(await page.locator("#fv-pay-lo").getAttribute("aria-valuetext"), "$105K", "the handle moved");
  assert.equal(await page.locator("#fv-nopay").isDisabled(), false, "one handle moved: the box is enabled");
  assert.equal(await page.locator("#fv-pay").getByText("Set a pay range first.", { exact: true }).isVisible(), false, "the hint goes away");
  await page.locator("#fv-pay-lo").focus();
  await page.keyboard.press("Home");
  await settle(page);
  assert.equal(await page.locator("#fv-nopay").isDisabled(), true, "back to the full range: disabled again");
  assert.deepEqual(errors, []);
  await page.close();
});

// ── UX-R4 (P2): no duplicate work type on the card ─────────────────────────────────────────────────────────────
test("UX-R4 a card with a work pill drops the location from its meta line; a card with no pill (Not stated) keeps it", async () => {
  const { page, errors } = await openRoles();
  const cards = await page.locator("#view article.job").evaluateAll((cs) => Object.fromEntries(cs.map((c) => [
    c.querySelector(".co")!.textContent!.trim(),
    { pill: (c.querySelector(".wk") as HTMLElement | null)?.innerText.trim() || "", meta: (c.querySelector(".meta") as HTMLElement | null)?.innerText.trim() || "" }])));
  const us = cards["Lumenfield (demo)"], den = cards["Frontrange Grid (demo)"], unk = cards["Lakeshore Data (demo)"];
  assert.equal(us.pill, "Remote (US)");
  assert.doesNotMatch(us.meta, /Remote/, `remote_us meta '${us.meta}' repeats the work type`);
  assert.match(us.meta, /^\$170K–\$205K · Found /, "meta starts with pay");
  assert.equal(den.pill, "Hybrid");
  assert.doesNotMatch(den.meta, /Denver|Hybrid/, `hybrid meta '${den.meta}' repeats the location`);
  assert.equal(unk.pill, "", "Not stated: no pill");
  assert.match(unk.meta, /^Chicago, IL · \$160K–\$190K · Found /, "no pill: the location text stays");
  // The full location stays in Details.
  await page.locator("#view article.job", { hasText: "Lumenfield (demo)" }).locator("[data-details]").click();
  await page.locator("#detailsSheet").waitFor({ state: "visible", timeout: 3000 });
  assert.match(await page.locator("#detailsSheet").innerText(), /Remote, US/);
  assert.deepEqual(errors, []);
  await page.close();
});

// ── UX-R5 (P2): Criteria order, with the text editor last and folded ──────────────────────────────────────────
test("UX-R5 Criteria cards read Search settings, Digest preview, Alerts, Never show, Scoring, Fit ratings, then Advanced: edit as text, closed by default", async () => {
  const { page, errors } = await openCriteria(undefined, PHONE);
  // Card headings and <summary> lines in page order (a summary that wraps an h2 counts once).
  const heads = await page.evaluate(() => [...document.querySelectorAll("#view h2, #view summary")]
    .map((h) => (h as HTMLElement).innerText.trim()).filter((t, i, a) => t && t !== a[i - 1]));
  assert.deepEqual(heads, ["Search settings", "Digest preview", "Alerts", "Never show", "Scoring", "Fit ratings", "Advanced: edit as text"]);
  const adv = await page.evaluate(() => {
    const s = [...document.querySelectorAll("#view summary")].find((x) => x.textContent!.trim() === "Advanced: edit as text");
    const d = s?.closest("details");
    return { summary: !!s, details: !!d, open: d ? d.open : null, holdsEditor: !!d?.querySelector("#critText") };
  });
  assert.deepEqual(adv, { summary: true, details: true, open: false, holdsEditor: true }, "Advanced is a closed <details> around the editor");
  assert.equal(await page.locator("#critText").isVisible(), false, "the YAML is folded away");
  await page.locator("#view summary", { hasText: "Advanced: edit as text" }).click();
  assert.equal(await page.locator("#critText").isVisible(), true, "one tap opens it");
  assert.deepEqual(errors, []);
  await page.close();
});

test("UX-R5 Advanced opens by itself when the saved text doesn't parse (SET-10's Fix the text below first)", async () => {
  const { page, errors } = await openCriteria(SPEC + "\nrole: [unclosed\n");
  assert.match(await page.locator("#settings").innerText(), /Fix the text below first\./);
  const isOpen = await page.evaluate(() => document.querySelector("#critText")?.closest("details")?.open ?? null);
  assert.equal(isOpen, true, "the Advanced <details> is open so the text to fix is on screen");
  assert.equal(await page.locator("#critText").isVisible(), true);
  assert.deepEqual(errors, []);
  await page.close();
});

test("UX-R5 Advanced opens by itself after Add to criteria", async () => {
  const { page, errors } = await open(browser, { file: FILE });
  await openTab(page, "ruled");
  await page.locator("section.fb li", { hasText: "Never show Tidewater" }).locator("[data-fbaccept]").click();
  assert.equal(await currentTab(page), "criteria");
  const isOpen = await page.evaluate(() => document.querySelector("#critText")?.closest("details")?.open ?? null);
  assert.equal(isOpen, true, "the Advanced <details> is open on the suggested change");
  assert.equal(await page.locator("#critText").isVisible(), true);
  assert.deepEqual(errors, []);
  await page.close();
});

// ── UX-R6 (P2): the Filters pay handles aren't named like the Highest pay sort ────────────────────────────────
test("UX-R6 the Filters pay handles are named Pay from and Pay up to", async () => {
  const { page, errors } = await openRoles();
  await filtersSheet(page);
  assert.equal(await page.locator("#fv-pay-lo").getAttribute("aria-label"), "Pay from");
  assert.equal(await page.locator("#fv-pay-hi").getAttribute("aria-label"), "Pay up to");
  assert.equal(await page.getByRole("slider", { name: "Highest pay", exact: true }).count(), 0, "no slider shares the sort's name");
  assert.deepEqual(errors, []);
  await page.close();
});

// ── UX-R7 (P2): the Settings pay boxes say they're in dollars ─────────────────────────────────────────────────
test("UX-R7 the Settings pay boxes show a $ prefix inside the box and 'In dollars, e.g. 150000' under them; a typed value matches the value line after blur", async () => {
  const { page, errors } = await openCriteria(undefined, PHONE);
  for (const id of ["set-pay-min", "set-pay-max"]) {
    const m = await page.evaluate((id) => {
      const input = document.getElementById(id)!, box = input.getBoundingClientRect();
      const scope = input.closest("label") || input.parentElement!;
      const sign = [...scope.querySelectorAll("*")].find((e) => e !== input && e.children.length === 0 && e.textContent!.trim() === "$") as HTMLElement | undefined;
      if (!sign) return { sign: false, inside: false };
      const r = sign.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      return { sign: r.width > 0 && getComputedStyle(sign).visibility !== "hidden", inside: cx > box.left && cx < box.right && cy > box.top && cy < box.bottom };
    }, id);
    assert.deepEqual(m, { sign: true, inside: true }, `#${id} has a visible "$" inside the box`);
  }
  const hint = page.locator("#settings").getByText("In dollars, e.g. 150000", { exact: true });
  assert.equal(await hint.count(), 1, 'the hint "In dollars, e.g. 150000" is in the card');
  assert.equal(await hint.isVisible(), true);
  const boxBottom = (await page.locator("#set-pay-min").boundingBox())!, hb = (await hint.boundingBox())!;
  assert.ok(hb.y >= boxBottom.y + boxBottom.height - 1, "the hint sits under the boxes");
  await page.locator("#set-pay-min").fill("160000");
  await page.locator("#set-pay-min").blur();
  await settle(page);
  assert.equal(await page.locator("#set-pay-min").inputValue(), "160000");
  assert.match(await page.locator("#set-pay-val").innerText(), /\$160K/, "the value line matches the box after blur");
  assert.deepEqual(errors, []);
  await page.close();
});
