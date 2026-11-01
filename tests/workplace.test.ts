// RR-FA: workplace labels, the Work and Pay filters and the Highest pay sort (docs/settings.md, FA-1..9; FA-10 is
// manual). Written red first, before any of it exists. Demo data only: every company below is made up and marked
// "(demo)"; the criteria are the repo's example criteria.yaml.
//
// Contract the engineer builds to (pinned by these tests):
// - Pure `workplaceOf(job)` exported from src/scoring.ts (so the page gets it as window.RoleRadarScoring.workplaceOf),
//   returning { id, city?, label }. ids: remote_us, remote_metro, remote_non_us, hybrid, onsite, unknown. Labels:
//   "Remote (US)", "Remote near <City>", "Remote outside US", "Hybrid", "On-site", "" (unknown). A valid
//   job.workplace (one of the five known ids, from the scan) wins over job.location; job.workplaceCity names the
//   city for remote_metro. Any other job.workplace value is ignored.
// - Role card: one work label in an element `.wk` (none for unknown).
// - Filters sheet (#ffields): `fieldset#fv-work` with `input[type=checkbox][name=work][value=<id>]`, labels
//   "Remote (US)", "Remote near a city", "Remote outside US", "Hybrid", "On-site", "Not stated", each with its count.
//   A removable "Work: ..." chip shows while any box is ticked.
// - Quick chip `[data-chip="remote"]` "Remote (US)" in #fbar: sets Work to just remote_us; again clears Work.
// - Pay: a `.range2` in #ffields with `[role=slider]` handles `#fv-pay-lo` / `#fv-pay-hi` ($100K-$400K, $5K steps,
//   same keys as the settings slider) and checkbox `#fv-nopay` ("Include roles with no pay listed", default checked).
//   Chip "Pay: $180K-$300K". Full range = no filter, no chip.
// - Sort radio `input[name=fsort][value=pay]` labeled "Highest pay".
// - Saved view (localStorage rr-view): view.work (array of ids), view.payLo / view.payHi (numbers or ""),
//   view.noPay ("0" when unchecked, else ""). Bad stored values are dropped; Clear all and Reset clear them.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chromium } from "playwright";
import type { Browser, Page } from "playwright";
import { buildDemo } from "../scripts/build-demo.mjs";
import { openDemo as open, openTab } from "../scripts/browser.mjs";
import * as S from "../src/scoring.ts";

interface Workplace { id: string; city?: string; label: string }
// Looked up at run time so the suite (and typecheck) runs before the export exists; the tests fail on it instead.
const workplaceOf = (S as unknown as Record<string, unknown>).workplaceOf as ((job: S.Job) => Workplace) | undefined;
const wp = (job: S.Job): Workplace => {
  assert.equal(typeof workplaceOf, "function", "src/scoring.ts exports workplaceOf(job)");
  return workplaceOf!(job);
};

const read = (p: string) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const baseSeed = () => JSON.parse(read("demo/seed.json"), (k, v) => (typeof v === "string" && v.startsWith("@file:") ? read(v.slice(6)) : v));
const FILE = "dist/test-workplace.html";
const LAPTOP = { width: 1280, height: 800 };

// Nine new roles, one per workplace case. Titles are the same so Best match differs only by experience fit.
const role = (company: string, location: string | undefined, comp: string | undefined, fit: string, extra: Record<string, unknown> = {}) =>
  ({ company, title: "Senior Product Manager", ...(location !== undefined ? { location } : {}), ...(comp ? { comp } : {}), fit, status: "new", statusAt: "@t-0", firstSeen: "@t-0", source: "greenhouse", ...extra });
const JOBS = {
  "wk-us1": role("Lumenfield (demo)", "Remote, US", "$170K–$205K", "stretch"),
  "wk-us2": role("Quietpine (demo)", "Remote (United States)", "$120K–$150K", "maybe", { workplace: "remote" }), // not a known id: ignored
  "wk-sf": role("Baywire (demo)", "San Francisco, CA (Remote)", "$190K–$240K", "maybe"),
  "wk-aus": role("Pecanlight (demo)", "Remote, US", "$305K–$340K", "maybe", { workplace: "remote_metro", workplaceCity: "Austin" }),
  "wk-can": role("Mapleworks (demo)", "Remote, Canada", "$140K–$180K", "maybe"),
  "wk-den": role("Frontrange Grid (demo)", "Denver, CO (Hybrid)", "$175K–$205K", "maybe"),
  "wk-on": role("Ironbridge (demo)", "On-site, Austin, TX", undefined, "stretch"),
  "wk-unk": role("Lakeshore Data (demo)", "Chicago, IL", "$170K–$205K", "strong"),
  "wk-nopay": role("Openfield (demo)", "Remote, US", undefined, "strong"),
};
const N = Object.keys(JOBS).length;
const seedWith = (jobs: Record<string, object>) => ({ ...baseSeed(), jobs, companies: {}, recruiters: {} });

let browser: Browser;
before(async () => { browser = await chromium.launch(); });
after(async () => { await browser?.close(); });

const openRoles = (jobs: Record<string, object> = JOBS, opts: Parameters<typeof open>[1] = {}) =>
  open(browser, { html: buildDemo({ seed: seedWith(jobs) }), file: FILE, ready: "#view article.job", query: "?tab=inbox", ...LAPTOP, ...opts });
const cos = (page: Page) => page.locator("#view article.job .co").allInnerTexts();
const settle = (page: Page) => page.waitForTimeout(150);
async function sheet(page: Page) {
  if ((await page.locator("#ftoggle").getAttribute("aria-expanded")) !== "true") await page.click("#ftoggle");
  assert.equal(await page.locator("#ffields fieldset#fv-work").count(), 1, "the Filters sheet has a Work group (fieldset#fv-work)");
}
const box = (page: Page, id: string) => page.locator(`#fv-work input[type=checkbox][name=work][value=${id}]`);
const ticked = (page: Page) => page.locator("#fv-work input[name=work]").evaluateAll((bs) => bs.filter((b) => (b as HTMLInputElement).checked).map((b) => (b as HTMLInputElement).value));
const chip = (page: Page, re: RegExp) => page.locator("#fbar [data-unset]").filter({ hasText: re });
/** Sets a pay handle with the keyboard: Home or End, then $25K / $5K steps toward the target. */
async function payTo(page: Page, sel: string, dollars: number) {
  assert.equal(await page.locator(sel).count(), 1, `pay handle ${sel} is in the Filters sheet`);
  await page.locator(sel).focus();
  const fromTop = dollars > 250000;
  await page.keyboard.press(fromTop ? "End" : "Home");
  let gap = Math.abs((fromTop ? 400000 : 100000) - dollars);
  for (; gap >= 25000; gap -= 25000) await page.keyboard.press(fromTop ? "PageDown" : "PageUp");
  for (; gap > 0; gap -= 5000) await page.keyboard.press(fromTop ? "ArrowLeft" : "ArrowRight");
  await settle(page);
}

// ── FA-1, FA-2: workplaceOf (unit) ─────────────────────────────────────────────────────────────────────────────
test("FA-1 workplaceOf reads the location text: US remote, remote near a city, remote outside the US, hybrid, on-site, unknown", () => {
  const cases: [string | undefined, string, string?][] = [
    ["Remote, US", "remote_us"], ["Remote (United States)", "remote_us"], ["US - Remote", "remote_us"], ["Remote", "remote_us"],
    ["San Francisco, CA (Remote)", "remote_metro", "San Francisco"], ["Remote - New York", "remote_metro", "New York"],
    ["Remote, within 50 miles of Chicago", "remote_metro", "Chicago"],
    ["Remote, Canada", "remote_non_us"], ["Remote (EMEA)", "remote_non_us"], ["UK Remote", "remote_non_us"],
    ["Denver, CO (Hybrid)", "hybrid"], ["Hybrid remote, Austin", "hybrid"],
    ["On-site, Austin, TX", "onsite"], ["In office", "onsite"],
    ["", "unknown"], [undefined, "unknown"], ["Chicago, IL", "unknown"],
  ];
  const got = cases.map(([location, id, city]) => {
    const w = wp(location === undefined ? {} : { location });
    return [location, w.id, id === "remote_metro" ? w.city : undefined];
  });
  assert.deepEqual(got, cases.map(([location, id, city]) => [location, id, city]));
  assert.notEqual(wp({ location: "Remote (site-to-site travel)" }).id, "onsite", '"site-to-site" is not on-site');
  const labels = Object.fromEntries([["Remote, US"], ["San Francisco, CA (Remote)"], ["Remote, Canada"], ["Denver, CO (Hybrid)"], ["In office"], ["Chicago, IL"]].map(([l]) => [l, wp({ location: l }).label]));
  assert.deepEqual(labels, { "Remote, US": "Remote (US)", "San Francisco, CA (Remote)": "Remote near San Francisco", "Remote, Canada": "Remote outside US", "Denver, CO (Hybrid)": "Hybrid", "In office": "On-site", "Chicago, IL": "" });
});

test("FA-2 a known job.workplace from the scan wins over the location text, with workplaceCity for remote_metro; other values are ignored", () => {
  assert.equal(wp({ location: "Remote, US", workplace: "hybrid" }).id, "hybrid");
  assert.equal(wp({ location: "Denver, CO (Hybrid)", workplace: "remote_us" }).id, "remote_us");
  assert.equal(wp({ location: "Remote, US", workplace: "onsite" }).label, "On-site");
  assert.equal(wp({ location: "Remote, US", workplace: "remote_non_us" }).id, "remote_non_us");
  assert.deepEqual(wp({ location: "Remote, US", workplace: "remote_metro", workplaceCity: "Austin" }), { id: "remote_metro", city: "Austin", label: "Remote near Austin" });
  for (const bad of ["remote", "unknown", "REMOTE_US", "", 5, null, { id: "hybrid" }]) {
    assert.equal(wp({ location: "Denver, CO (Hybrid)", workplace: bad }).id, "hybrid", `workplace ${JSON.stringify(bad)} is ignored`);
  }
});

// ── FA-3..FA-8: the page ───────────────────────────────────────────────────────────────────────────────────────
test("FA-3 each role card shows one work label; a role with no stated workplace shows none", async () => {
  const { page, errors } = await openRoles();
  assert.equal(await page.evaluate(() => typeof (window as any).RoleRadarScoring?.workplaceOf), "function", "the page gets workplaceOf from scoring.js");
  const labels = await page.locator("#view article.job").evaluateAll((cards) => Object.fromEntries(cards.map((c) => [
    c.querySelector(".co")!.textContent!.trim(), [...c.querySelectorAll(".wk")].map((w) => (w as HTMLElement).innerText.trim()).filter(Boolean)])));
  assert.deepEqual(labels, {
    "Lumenfield (demo)": ["Remote (US)"], "Quietpine (demo)": ["Remote (US)"], "Baywire (demo)": ["Remote near San Francisco"],
    "Pecanlight (demo)": ["Remote near Austin"], "Mapleworks (demo)": ["Remote outside US"], "Frontrange Grid (demo)": ["Hybrid"],
    "Ironbridge (demo)": ["On-site"], "Lakeshore Data (demo)": [], "Openfield (demo)": ["Remote (US)"],
  });
  assert.deepEqual(errors, []);
  await page.close();
});

test("FA-4 the Work checkbox group: six boxes with counts; ticked boxes show matching roles, update the count and add a Work chip", async () => {
  const { page, errors } = await openRoles();
  await sheet(page);
  const ids = await page.locator("#fv-work input[type=checkbox][name=work]").evaluateAll((bs) => bs.map((b) => (b as HTMLInputElement).value));
  assert.deepEqual(ids, ["remote_us", "remote_metro", "remote_non_us", "hybrid", "onsite", "unknown"]);
  const labels = await page.locator("#fv-work input[name=work]").evaluateAll((bs) => bs.map((b) => ((b as HTMLInputElement).labels?.[0]?.innerText || "").replace(/\s+/g, " ").trim()));
  const want: [string, number][] = [["Remote (US)", 3], ["Remote near a city", 2], ["Remote outside US", 1], ["Hybrid", 1], ["On-site", 1], ["Not stated", 1]];
  want.forEach(([l, n], i) => assert.match(labels[i], new RegExp(`^${l.replace(/[()]/g, "\\$&")}\\D*${n}\\D*$`), `"${l}" with its count ${n} (got "${labels[i]}")`));
  assert.deepEqual(await ticked(page), [], "nothing ticked = no filter");
  assert.equal((await cos(page)).length, N);
  await box(page, "remote_metro").check();
  await box(page, "hybrid").check();
  await settle(page);
  assert.deepEqual((await cos(page)).sort(), ["Baywire (demo)", "Frontrange Grid (demo)", "Pecanlight (demo)"]);
  assert.match(await page.locator("#fcount").innerText(), new RegExp(`3 of ${N}`));
  const c = chip(page, /^Work: /);
  assert.equal(await c.count(), 1, "a Work chip");
  assert.match(await c.innerText(), /Remote near a city/);
  assert.match(await c.innerText(), /Hybrid/);
  await c.click();
  await settle(page);
  assert.equal((await cos(page)).length, N, "removing the chip clears the Work filter");
  await sheet(page);
  assert.deepEqual(await ticked(page), []);
  assert.deepEqual(errors, []);
  await page.close();
});

test("FA-5 the Remote (US) quick chip sets Work to just Remote (US), and pressing it again clears Work", async () => {
  const { page, errors } = await openRoles();
  const q = page.locator('#fbar [data-chip="remote"]');
  assert.equal(await q.count(), 1, 'a "remote" quick chip');
  assert.equal((await q.innerText()).trim(), "Remote (US)");
  await q.click();
  await settle(page);
  assert.equal(await page.locator('#fbar [data-chip="remote"]').getAttribute("aria-pressed"), "true");
  assert.deepEqual((await cos(page)).sort(), ["Lumenfield (demo)", "Openfield (demo)", "Quietpine (demo)"]);
  await sheet(page);
  assert.deepEqual(await ticked(page), ["remote_us"], "the checkbox shows it");
  await page.click("#fdone");
  await page.click('#fbar [data-chip="remote"]');
  await settle(page);
  assert.equal(await page.locator('#fbar [data-chip="remote"]').getAttribute("aria-pressed"), "false");
  assert.equal((await cos(page)).length, N);
  // Pressed only when Remote (US) is the only box ticked.
  await sheet(page);
  await box(page, "remote_us").check();
  await box(page, "hybrid").check();
  await settle(page);
  assert.equal(await page.locator('#fbar [data-chip="remote"]').getAttribute("aria-pressed"), "false", "two boxes ticked: the chip isn't pressed");
  assert.deepEqual(errors, []);
  await page.close();
});

test("FA-6 the Pay filter shows roles whose range overlaps it; roles with no pay show only while Include is checked", async () => {
  const { page, errors } = await openRoles();
  await sheet(page);
  assert.equal(await page.locator("#ffields .range2").count(), 1, "a two-handle pay slider in the sheet");
  const np = page.locator("#fv-nopay");
  assert.equal(await np.isChecked(), true, "Include roles with no pay listed is on by default");
  assert.match(await np.evaluate((el) => (el as HTMLInputElement).labels?.[0]?.innerText || ""), /Include roles with no pay listed/);
  assert.equal(await chip(page, /Pay/).count(), 0, "full range: no chip");
  await payTo(page, "#fv-pay-lo", 175000);
  await payTo(page, "#fv-pay-hi", 300000);
  assert.equal(await page.locator("#fv-pay-lo").getAttribute("aria-valuetext"), "$175K");
  assert.equal(await page.locator("#fv-pay-hi").getAttribute("aria-valuetext"), "$300K");
  // Out: Quietpine ($120K-$150K tops out under $175K) and Pecanlight ($305K starts over $300K). Mapleworks tops at $180K: in.
  assert.deepEqual((await cos(page)).sort(), ["Baywire (demo)", "Frontrange Grid (demo)", "Ironbridge (demo)", "Lakeshore Data (demo)", "Lumenfield (demo)", "Mapleworks (demo)", "Openfield (demo)"]);
  assert.match(await chip(page, /Pay/).innerText(), /Pay: \$175K[-–]\$300K/);
  await np.uncheck();
  await settle(page);
  assert.deepEqual((await cos(page)).sort(), ["Baywire (demo)", "Frontrange Grid (demo)", "Lakeshore Data (demo)", "Lumenfield (demo)", "Mapleworks (demo)"], "no-pay roles drop out");
  await payTo(page, "#fv-pay-lo", 100000);
  await payTo(page, "#fv-pay-hi", 400000);
  assert.equal(await chip(page, /Pay/).count(), 0, "back to the full range: no Pay chip");
  assert.deepEqual(errors, []);
  await page.close();
});

test("FA-7 Highest pay sorts by top of range, then bottom, then Best match; roles with no pay come last", async () => {
  const { page, errors } = await openRoles();
  await page.click("#fsort");
  const r = page.locator("#fsortSheet input[name=fsort][value=pay]");
  assert.equal(await r.count(), 1, "a Highest pay sort");
  assert.match(await r.evaluate((el) => (el as HTMLInputElement).labels?.[0]?.innerText || ""), /Highest pay/);
  await r.check();
  await page.waitForFunction(() => /Highest pay/.test(document.querySelector("#fcount")?.textContent || ""), null, { timeout: 3000 });
  assert.deepEqual(await cos(page), [
    "Pecanlight (demo)", // $340K top
    "Baywire (demo)", // $240K
    "Frontrange Grid (demo)", // $205K top, $175K bottom
    "Lakeshore Data (demo)", // $205K / $170K, strong fit
    "Lumenfield (demo)", // $205K / $170K, stretch fit
    "Mapleworks (demo)", // $180K
    "Quietpine (demo)", // $150K
    "Openfield (demo)", // no pay, strong fit
    "Ironbridge (demo)", // no pay, stretch fit
  ]);
  assert.deepEqual(errors, []);
  await page.close();
});

test("FA-8 Work, Pay and Include-no-pay come back after a reload; bad stored values are dropped; Clear all and Reset clear them", async () => {
  const { page, errors } = await openRoles();
  await sheet(page);
  await box(page, "hybrid").check();
  await payTo(page, "#fv-pay-lo", 175000);
  await payTo(page, "#fv-pay-hi", 300000);
  await page.locator("#fv-nopay").uncheck();
  await settle(page);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("rr-view") || "{}"));
  assert.deepEqual({ work: stored.work, payLo: stored.payLo, payHi: stored.payHi, noPay: stored.noPay }, { work: ["hybrid"], payLo: 175000, payHi: 300000, noPay: "0" });
  await page.reload();
  await page.waitForSelector("#fbar");
  assert.deepEqual(await cos(page), ["Frontrange Grid (demo)"]);
  await sheet(page);
  assert.deepEqual(await ticked(page), ["hybrid"]);
  assert.equal(await page.locator("#fv-pay-lo").getAttribute("aria-valuenow"), "175000");
  assert.equal(await page.locator("#fv-pay-hi").getAttribute("aria-valuenow"), "300000");
  assert.equal(await page.locator("#fv-nopay").isChecked(), false);
  // Reset in the sheet clears all three.
  await page.click("#freset");
  await settle(page);
  assert.deepEqual(await ticked(page), []);
  assert.equal(await page.locator("#fv-pay-lo").getAttribute("aria-valuenow"), "100000");
  assert.equal(await page.locator("#fv-pay-hi").getAttribute("aria-valuenow"), "400000");
  assert.equal(await page.locator("#fv-nopay").isChecked(), true);
  assert.equal((await cos(page)).length, N);
  // Clear all does too.
  await box(page, "onsite").check();
  await payTo(page, "#fv-pay-lo", 150000);
  await page.click("#fdone");
  await page.click("#fclear");
  await settle(page);
  assert.equal((await cos(page)).length, N);
  assert.equal(await page.locator("#fbar [data-unset]").count(), 0);
  await sheet(page);
  assert.deepEqual(await ticked(page), []);
  assert.equal(await page.locator("#fv-pay-lo").getAttribute("aria-valuenow"), "100000");
  // Bad stored values load without errors and are dropped; known work ids survive.
  await page.evaluate(() => localStorage.setItem("rr-view", JSON.stringify({ q: "", work: ["bogus", "hybrid", 3], payLo: "abc", payHi: { x: 1 }, noPay: 7, sorts: {} })));
  await page.reload();
  await page.waitForSelector("#fbar");
  assert.deepEqual(await cos(page), ["Frontrange Grid (demo)"], "work keeps hybrid, drops the rest");
  assert.equal(await chip(page, /Pay/).count(), 0, "bad pay values: no Pay filter");
  await sheet(page);
  assert.equal(await page.locator("#fv-nopay").isChecked(), true, "bad noPay: back to the default");
  await page.evaluate(() => localStorage.setItem("rr-view", JSON.stringify({ q: "", work: "hybrid", sorts: {} })));
  await page.reload();
  await page.waitForSelector("#fbar");
  assert.equal((await cos(page)).length, N, "work that isn't an array is dropped");
  assert.deepEqual(errors, []);
  await page.close();
});

// ── FA-9: 2,000 roles stay inside the RR-H-21 budget ─────────────────────────────────────────────────────────────
test("FA-9 2,000 roles with Work and Pay filters and the Highest pay sort stay inside the RR-H-21 budget", async () => {
  const LOCS = ["Remote, US", "Denver, CO (Hybrid)", "San Francisco, CA (Remote)", "On-site, Austin, TX"];
  const jobs: Record<string, object> = {};
  for (let i = 0; i < 2000; i++) {
    const comp = i % 5 === 0 ? undefined : `$${100 + (i % 200)}K–$${150 + (i % 250)}K`;
    jobs["bulk-" + i] = { company: `Bulk Co ${i} (demo)`, title: `Senior PM ${i}`, status: "new", location: LOCS[i % 4], ...(comp ? { comp } : {}) };
  }
  // Expected: Remote (US) or Hybrid, and pay overlapping $150K-$300K or no pay listed.
  const want = Object.values(jobs).filter((j: any, i) => {
    if (i % 4 > 1) return false;
    const r = S.parseComp(j.comp);
    return !r || (r.max >= 150000 && r.min <= 300000);
  }).length;
  const t0 = Date.now();
  const { page, errors } = await openRoles(jobs, { ready: "#tab-inbox" });
  const openMs = Date.now() - t0;
  await page.evaluate(() => localStorage.setItem("rr-view", JSON.stringify({ q: "", work: ["remote_us", "hybrid"], payLo: 150000, payHi: 300000, noPay: "", sorts: { inbox: "pay", all: "pay" } })));
  await page.reload();
  await page.waitForSelector("#fbar");
  const t1 = Date.now();
  await openTab(page, "all");
  await page.waitForFunction((n) => document.querySelectorAll("#view article.job").length === n, want, { timeout: 10000 });
  const allMs = Date.now() - t1;
  assert.match(await page.locator("#fcount").innerText(), /Highest pay/);
  // One more Work box: a single re-render, held to the one-keystroke budget. Like RR-H-21's keystroke, the clock
  // covers one key press, the app's change handler and the re-render up to the card count changing. Finding and
  // focusing the box happens before the clock starts: locator.check() re-resolves the selector and runs Playwright's
  // actionability checks over ~1,000 cards, which cost ~130ms locally and ~2.5x that on CI (QA-R1, PR #68).
  await sheet(page);
  await box(page, "onsite").focus();
  assert.equal(await box(page, "onsite").isChecked(), false, "On-site starts unticked");
  const t2 = Date.now();
  await page.keyboard.press("Space");
  await page.waitForFunction((n) => document.querySelectorAll("#view article.job").length > n, want, { timeout: 10000 });
  const tickMs = Date.now() - t2;
  assert.equal(await box(page, "onsite").isChecked(), true, "Space ticked On-site");
  assert.deepEqual(await ticked(page), ["remote_us", "hybrid", "onsite"], "the saved Work boxes plus On-site");
  console.log(`# FA-9 open ${openMs}ms, All tab filtered and sorted ${allMs}ms, one Work box ${tickMs}ms (want ${want} roles)`);
  assert.ok(openMs < 8000, `opening took ${openMs}ms`);
  assert.ok(allMs < 2000, `All roles, filtered and sorted by pay, took ${allMs}ms`);
  assert.ok(tickMs < 500, `one Work box took ${tickMs}ms`);
  assert.deepEqual(errors, []);
  await page.close();
});
