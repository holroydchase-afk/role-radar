// RR-M4.4 Home tab (ux-reviewer UX-H-R5 and the rest of R6; architect §3 reuse; ACs UX-H-AC2 final, AC3, AC4,
// AC5, AC6, AC7, AC8, AC13, AC14). Home is the default tab and answers "what do I do next?": the morning digest and
// board health, application counts, the post-application stepper, a short Get ready list and the first Pipeline cards.
// Demo data only (demo/seed.json plus made-up roles below). Written red-first by qa-tdd.
//
// Contract the engineer builds to (stable selectors):
//   Tab bar (AC2 final, both builds)
//   - #tabs shows exactly: #tab-home (Home, no count), #tab-inbox (New + `.n`), #tab-pipeline (Pipeline + `.n`),
//     #tab-all (All, no count), #moreBtn (More). No sideways scroll at 360, 390 and 1280; each tab >= 44px tall.
//   - Home is the default tab (fresh storage, no ?tab=): #view[data-tab="home"], #tab-home aria-selected="true".
//   - ?tab=home opens Home. ?tab=action and ?tab=progress open Home (the Needs action and Progress tabs are gone).
//   - #moreSheet rows: people (Recruiters, private build only), ruled, criteria, watch, filters. No action/progress.
//   - Home has no filter bar (#fbar / #q not shown).
//   Home sections, in DOM order inside #view, each `section#home-<key>` whose first h2 reads exactly:
//     #home-morning "This morning" · #home-apps "Applications" · #home-after "After you apply" ·
//     #home-ready "Get ready" · #home-pipeline "Pipeline"
//   #home-morning
//   - Hint text `Top N of M new` (N rows, M = the New tab count) when M > N.
//   - Up to 5 rows `#home-morning a[href="#role-<id>"]`, the digest's top picks in the Criteria #digestPreview order,
//     each with a `.score` holding that digest score (the computed scoreJob total), then `Company · Title` on one line.
//     Each row >= 48px and one line tall (<= 60px at 390). Activating a row focuses `article.job#role-<id>` (as the
//     old #digestCard entries did via focusRole).
//   - #homeHealth: coverageLine(scan.coverage, companies).text. Demo: `8 of 9 boards OK · 1 failing`, and "1 failing"
//     is a link or button that opens Watchlist (#view[data-tab="watch"]). A stale scan still shows #scanStale on Home.
//   #home-apps
//   - Three tiles, buttons `[data-tile="todo"]` To do, `[data-tile="inprogress"]` In progress, `[data-tile="done"]`
//     Done, each with its number in `.num`: homeStats().todo, .inProgress, .done; the Done tile also reads
//     `<doneThisWeek> this week`. Demo: 0, 1, 4 (1 this week).
//   - Tapping a tile uses the All tab's existing Status filter (view.status): To do opens All filtered to Saved,
//     In progress opens All filtered to Applying. Done (several statuses) opens Pipeline.
//   - The week bar reused from Progress: `#home-apps ol.days` with 7 `li`, plus `Today X of Y` and a role="meter"
//     with aria-valuenow X, from PG.dashboard(jobs, {bar: config.dailyBar}).today.
//   #home-after
//   - Stepper `[data-stage]` in order applied, screen, interviewing, offer, labeled Waiting, Screen, Interviews, Offer,
//     number in `.num` = homeStats().stages (demo 2, 1, 1, 0).
//   - #homeClosed, one grey (muted, never red) line: `N closed · H of E heard back (sent 14+ days ago)`,
//     N = homeStats().closed, H and E = dashboard().response.heard / .eligible, never a bare % (UX-H2-R7;
//     demo `0 closed · 2 of 2 heard back (sent 14+ days ago)`). With nothing eligible yet it reads `N closed`.
//   - `details#moreStats` (summary "More stats"), closed by default, holding the old Funnel, Response rate and
//     Sector mix cards (headings "Funnel", "Response rate", "Sector mix...").
//   - The visible text of Home never contains "Rejected" (AC6), More stats open or not.
//   #home-ready (AC8)
//   - Up to 5 rows `[data-ready="<kind>"]` (>= 56px), most urgent first. Two lines (UX-H2-R5): the company, then what
//     to do in muted text. Kinds in this order:
//       followup   `<Company>` / `Follow up · due Oct 29`     button "Follow-up sent"  (applied, followUpDue <= today)
//       submit     `<Company>` / `Send it`                    button "I submitted it"  (applying 2+ days)
//       nextstep   `<Company>` / `Add next step`              button "Add step"        (screen/interviewing, no nextStep)
//       decide     `<Company>` / `Decide · saved N days ago`  button "Open"            (saved 7+ days)
//       recruiters `Recruiter · N due` (one line)             button "Open"            (owner's build only; opens Recruiters)
//     Each row's button is >= 44px tall. More than 5 due: a `See all N` link. None: `Nothing due. Nice.`
//   - Public build: no recruiters row, no "Recruiter" and no "<N> due" text anywhere on Home.
//   #home-pipeline
//   - The first 3 cards of the Pipeline tab, same order, same card component (`article.job#role-<id>`), and an
//     "Open Pipeline" link or button that opens #view[data-tab="pipeline"].
//   Phone 390x844: #home-morning and its first row start above 844px; no sideways scroll at 360/390.
//   Dark mode: #homeHealth, #homeClosed and the stepper labels meet 4.5:1.
//   Perf (RR-H-21 bulk seed, 2,000 roles): switching New → Home renders in under 500ms.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chromium } from "playwright";
import type { Browser, Page } from "playwright";
import { buildDemo } from "../scripts/build-demo.mjs";
import { openDemo as open, openTab } from "../scripts/browser.mjs";

// Page globals (top-level let/const in the page's classic script), read inside page.evaluate.
declare const jobs: any[];
declare const config: any;
declare const RoleRadarProgress: any;

const read = (p: string) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const baseSeed = () => JSON.parse(read("demo/seed.json"), (k, v) => (typeof v === "string" && v.startsWith("@file:") ? read(v.slice(6)) : v));

let browser: Browser;
type Opts = Parameters<typeof open>[1] & { publicDemo?: boolean; seed?: Record<string, any> };
const openDemo = ({ publicDemo = false, seed, ...opts }: Opts = {}) =>
  open(browser, { html: buildDemo({ publicDemo, ...(seed ? { seed } : {}) }), file: "dist/test-home.html", ready: "#tabs button", ...opts });
const PHONE = { width: 390, height: 844 };
const SMALL = { width: 360, height: 740 };
const LAPTOP = { width: 1280, height: 800 };
const BUILDS: [string, boolean][] = [["private", false], ["public", true]];
const SECTIONS = [["morning", "This morning"], ["apps", "Applications"], ["after", "After you apply"], ["ready", "Get ready"], ["pipeline", "Pipeline"]] as const;
const MORE_ROWS = ["people", "ruled", "criteria", "watch", "filters"];

const viewTab = (page: Page) => page.locator("#view").getAttribute("data-tab");
const waitViewTab = (page: Page, id: string) =>
  page.waitForFunction((id) => document.querySelector("#view")?.getAttribute("data-tab") === id, id, { timeout: 3000 });
// Home is open and drawn (its last section exists).
const waitHome = async (page: Page) => {
  try {
    await waitViewTab(page, "home");
    await page.locator("#view #home-pipeline").waitFor({ state: "attached", timeout: 3000 });
  } catch {
    assert.fail(`Home did not open: #view[data-tab="${await viewTab(page)}"], #home-pipeline ${await page.locator("#home-pipeline").count() ? "present" : "missing"}`);
  }
};
const visibleTabIds = (page: Page) => page.locator("#tabs button").evaluateAll((els: HTMLElement[]) =>
  els.filter((e) => e.offsetParent && e.getBoundingClientRect().width > 0).map((e) => e.id));
// What a person can read: visible text nodes, leaving out <option>s (a closed select shows one value, not its list).
const visibleText = (page: Page, sel: string) => page.locator(sel).evaluate((root) => {
  const out: string[] = [];
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (w.nextNode()) {
    const p = w.currentNode.parentElement;
    if (!p || p.closest("option, script, style, template")) continue;
    const r = p.getBoundingClientRect();
    if (!p.checkVisibility?.() || (r.width === 0 && r.height === 0)) continue;
    out.push(w.currentNode.textContent || "");
  }
  return out.join(" ").replace(/\s+/g, " ").trim();
});
const cardIds = (page: Page, sel: string) => page.locator(`${sel} article.job[id^="role-"]`).evaluateAll((els: HTMLElement[]) =>
  els.filter((e) => e.offsetParent).map((e) => e.id.replace(/^role-/, "")));
const nums = (page: Page, sel: string) => page.locator(sel).evaluateAll((els: HTMLElement[]) =>
  els.map((e) => e.querySelector<HTMLElement>(".num")?.innerText.trim() ?? "?"));
const statsInPage = (page: Page) => page.evaluate(() => {
  const PG = RoleRadarProgress;
  return { h: PG.homeStats(jobs), d: PG.dashboard(jobs, { bar: Number(config.dailyBar) || 3 }) };
});

// Seed with nothing due: the follow-up moves out, HelioHome was just picked, Pebblepay has a next step, no recruiter due.
const nothingDueSeed = () => {
  const s = baseSeed();
  s.jobs["greenhouse-1007"].followUpDue = "@d--3";
  s.jobs["manual-heliohome-sr-pm"].statusAt = "@t-0";
  s.jobs["ashby-1008"].nextStep = "Recruiter call (demo)";
  for (const r of Object.values(s.recruiters as Record<string, any>)) r.nextStepDue = "@d--9";
  return s;
};

before(async () => { browser = await chromium.launch(); });
after(async () => { await browser?.close(); });

// ── Default tab and tab bar (UX-H-R2 final, R5; AC2, AC3, AC4) ───────────────────────────────────────────────────

test("HOME-1 AC2 the tab bar is Home, New, Pipeline, All, More in both builds; only New and Pipeline show counts", async () => {
  for (const [name, publicDemo] of BUILDS) {
    const { page, errors } = await openDemo({ ...LAPTOP, publicDemo, ready: "#tab-inbox .n" });
    assert.deepEqual(await visibleTabIds(page), ["tab-home", "tab-inbox", "tab-pipeline", "tab-all", "moreBtn"], `${name}: tab bar`);
    const labels = await page.locator("#tabs button").evaluateAll((els: HTMLElement[]) => els.filter((e) => e.offsetParent)
      .map((e) => [...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join("").trim()));
    assert.deepEqual(labels, ["Home", "New", "Pipeline", "All", "More"], `${name}: labels`);
    const counted = await page.locator("#tabs .n").evaluateAll((els: HTMLElement[]) => els.filter((e) => e.offsetParent).map((e) => e.closest("button")!.id));
    assert.deepEqual(counted, ["tab-inbox", "tab-pipeline"], `${name}: only New and Pipeline carry a count`);
    assert.doesNotMatch(await page.locator("#tab-home").innerText(), /\d/, `${name}: Home shows no number`);
    assert.deepEqual(errors, []);
    await page.close();
  }
});

test("HOME-2 AC4 Home is the default tab in both builds, with no filter bar", async () => {
  for (const [name, publicDemo] of BUILDS) {
    const { page, errors } = await openDemo({ ...PHONE, publicDemo });
    await waitHome(page).catch(() => {});
    assert.equal(await viewTab(page), "home", `${name}: opens on Home`);
    assert.equal(await page.locator("#tab-home").getAttribute("aria-selected"), "true", `${name}: Home tab selected`);
    assert.notEqual(await page.locator("#moreBtn").getAttribute("aria-current"), "page", `${name}: More not current`);
    assert.equal(await page.locator("#q").isVisible().catch(() => false), false, `${name}: no search box on Home`);
    assert.equal(await page.locator("#fbar").isVisible().catch(() => false), false, `${name}: no filter bar on Home`);
    assert.deepEqual(errors, []);
    await page.close();
  }
});

test("HOME-3 AC2 #tabs never scrolls sideways at 360, 390 or 1280 with five tabs, every tab >= 44px tall", async () => {
  const bad: string[] = [];
  for (const [name, publicDemo] of BUILDS) for (const vp of [SMALL, PHONE, LAPTOP]) {
    const { page } = await openDemo({ ...vp, publicDemo });
    const t = await page.locator("#tabs").evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth, ids: [...el.querySelectorAll("button")].map((b) => b.id),
      short: [...el.querySelectorAll<HTMLElement>("button")].filter((b) => b.offsetParent && b.getBoundingClientRect().height < 44).map((b) => b.id) }));
    if (!t.ids.includes("tab-home")) bad.push(`${name} ${vp.width}: no #tab-home`);
    if (t.sw > t.cw) bad.push(`${name} ${vp.width}: #tabs scrollWidth ${t.sw} > clientWidth ${t.cw}`);
    if (t.short.length) bad.push(`${name} ${vp.width}: under 44px: ${t.short.join(", ")}`);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (over > 0) bad.push(`${name} ${vp.width}: page scrolls sideways by ${over}px`);
    await page.close();
  }
  assert.deepEqual(bad, []);
});

test("HOME-4 AC3 ?tab=home opens Home; the old ?tab=action and ?tab=progress links land on Home (both builds)", async () => {
  for (const [name, publicDemo] of BUILDS) for (const q of ["home", "action", "progress"]) {
    const { page, errors } = await openDemo({ ...LAPTOP, publicDemo, query: `?tab=${q}` });
    await waitHome(page).catch(() => {});
    assert.equal(await viewTab(page), "home", `${name}: ?tab=${q}`);
    assert.equal(await page.locator("#tab-home").getAttribute("aria-selected"), "true", `${name} ?tab=${q}: Home selected`);
    assert.deepEqual(errors, [], `${name} ?tab=${q}`);
    await page.close();
  }
});

test("HOME-5 AC3 More keeps Recruiters (owner only), Ruled out, Criteria, Watchlist, Scan rules; Needs action and Progress are gone", async () => {
  for (const [name, publicDemo] of BUILDS) {
    const { page } = await openDemo({ ...PHONE, publicDemo, ready: "#tab-inbox .n" });
    await page.click("#moreBtn");
    await page.locator("#moreSheet").waitFor({ state: "visible", timeout: 2000 });
    const rows = await page.locator("#moreSheet [data-tab]").evaluateAll((els: HTMLElement[]) => els.filter((e) => e.offsetParent).map((e) => e.dataset.tab));
    assert.deepEqual(rows, publicDemo ? MORE_ROWS.filter((r) => r !== "people") : MORE_ROWS, `${name}: More rows`);
    assert.doesNotMatch(await page.locator("#moreSheet").innerText(), /Needs action|Progress/, `${name}: no Needs action or Progress row`);
    await page.close();
  }
});

test("HOME-6 AC4 Home's section headings, in order: This morning, Applications, After you apply, Get ready, Pipeline", async () => {
  for (const [name, publicDemo] of BUILDS) {
    const { page, errors } = await openDemo({ ...LAPTOP, publicDemo });
    await waitHome(page);
    const got = await page.locator('#view section[id^="home-"]').evaluateAll((els: HTMLElement[]) =>
      els.filter((e) => !e.parentElement!.closest('section[id^="home-"]')).map((e) => [e.id, e.querySelector("h2")?.innerText.trim() ?? ""]));
    assert.deepEqual(got, SECTIONS.map(([k, h]) => ["home-" + k, h]), `${name}: sections`);
    assert.deepEqual(errors, []);
    await page.close();
  }
});

// ── This morning (UX-H-R5 §1; AC7, AC13) ─────────────────────────────────────────────────────────────────────────

test("HOME-7 This morning: 'Top N of M new' and up to 5 one-line rows (>= 48px) matching the digest's picks and scores", async () => {
  const { page, errors } = await openDemo({ ...PHONE });
  await waitHome(page);
  const rows = page.locator('#home-morning a[href^="#role-"]');
  const got = await rows.evaluateAll((as: HTMLElement[]) => as.map((a) => ({ id: a.getAttribute("href")!.slice(6),
    score: a.querySelector<HTMLElement>(".score")?.innerText.trim() ?? "", text: a.innerText.replace(/\s+/g, " ").trim(), h: a.getBoundingClientRect().height })));
  const newCount = (await page.locator("#tab-inbox .n").innerText()).replace(/\D/g, "");
  // The digest the scan sends, as the Criteria tab previews it.
  await openTab(page, "criteria");
  await page.locator("#digestPreview ol.dig li").first().waitFor({ timeout: 3000 });
  const digest = await page.locator("#digestPreview ol.dig li").evaluateAll((lis: HTMLElement[]) =>
    lis.map((li) => ({ score: li.querySelector<HTMLElement>(".score")!.innerText.trim(), name: li.querySelectorAll("span")[1]!.textContent!.trim() })));
  const want = digest.slice(0, 5);
  assert.ok(got.length > 0 && got.length <= 5, `1 to 5 rows, got ${got.length}`);
  assert.deepEqual(got.map((r) => r.score), want.map((d) => d.score), "scores in digest order");
  for (const [i, r] of got.entries()) {
    assert.ok(r.text.includes(want[i].name), `row ${i + 1} reads '${want[i].name}', got '${r.text}'`);
    assert.ok(r.h >= 48 && r.h <= 60, `row ${i + 1} is ${Math.round(r.h)}px (48px, one line)`);
  }
  await page.click("#tab-home");
  await waitHome(page);
  if (Number(newCount) > got.length) assert.match(await page.locator("#home-morning").innerText(), new RegExp(`Top ${got.length} of ${newCount} new`));
  assert.deepEqual(errors, []);
  await page.close();
});

test("HOME-8 tapping a This morning row opens and focuses that role's card", async () => {
  const { page, errors } = await openDemo({ ...PHONE });
  await waitHome(page);
  const first = page.locator('#home-morning a[href^="#role-"]').first();
  const anchor = (await first.getAttribute("href"))!.slice(1);
  await first.click();
  await page.waitForFunction((a) => document.activeElement?.id === a, anchor, { timeout: 3000 });
  assert.ok(await page.evaluate(() => !!document.activeElement?.matches("#view article.job")), "focus is on the role's card");
  assert.deepEqual(errors, []);
  await page.close();
});

test("HOME-9 AC7 the health line reads '8 of 9 boards OK · 1 failing' on the demo, and '1 failing' opens Watchlist", async () => {
  const { page, errors } = await openDemo({ ...LAPTOP });
  await waitHome(page);
  assert.equal((await page.locator("#homeHealth").innerText()).replace(/\s+/g, " ").trim(), "8 of 9 boards OK · 1 failing");
  const link = page.locator("#homeHealth").locator("a, button", { hasText: "1 failing" });
  assert.equal(await link.count(), 1, "'1 failing' is a link");
  await link.click();
  await waitViewTab(page, "watch");
  assert.deepEqual(errors, []);
  await page.close();
});

test("HOME-10 AC7 all boards OK reads 'N boards read · all OK'; a stale scan still shows its warning on Home", async () => {
  const s = baseSeed();
  for (const c of Object.values(s.companies as Record<string, any>)) c.failStreak = 0;
  s.meta.scan.lastRun = "@t-10";
  const { page, errors } = await openDemo({ ...PHONE, seed: s });
  await waitHome(page);
  assert.equal((await page.locator("#homeHealth").innerText()).replace(/\s+/g, " ").trim(), "9 boards read · all OK");
  await page.locator("#scanStale").waitFor({ state: "visible", timeout: 3000 });
  assert.match(await page.locator("#scanStale").innerText(), /hasn't run since/);
  assert.deepEqual(errors, []);
  await page.close();
});

// ── Applications (UX-H-R5 §2; AC5) ───────────────────────────────────────────────────────────────────────────────

test("HOME-11 AC5 Applications tiles To do / In progress / Done equal homeStats() on the demo (0, 1, 4 with 1 this week)", async () => {
  const { page, errors } = await openDemo({ ...PHONE });
  await waitHome(page);
  const { h } = await statsInPage(page);
  assert.deepEqual([h.todo, h.inProgress, h.done, h.doneThisWeek], [0, 1, 4, 1], "homeStats on the demo seed (qa-tdd M4.2, by hand)");
  const tiles = page.locator("#home-apps [data-tile]");
  assert.deepEqual(await tiles.evaluateAll((els: HTMLElement[]) => els.map((e) => e.dataset.tile)), ["todo", "inprogress", "done"]);
  assert.deepEqual(await nums(page, "#home-apps [data-tile]"), [String(h.todo), String(h.inProgress), String(h.done)]);
  const labels = await tiles.allInnerTexts();
  assert.match(labels[0], /To do/);
  assert.match(labels[1], /In progress/);
  assert.match(labels[2], /Done/);
  assert.match(labels[2], new RegExp(`\\b${h.doneThisWeek} this week\\b`), "Done tile says how many this week");
  assert.deepEqual(errors, []);
  await page.close();
});

test("HOME-12 tapping a tile opens the roles behind it: In progress → All filtered to Applying, To do → Saved, Done → Pipeline", async () => {
  const s = baseSeed();
  s.jobs["demo-saved-old"] = { company: "Saltmarsh Grid (demo)", title: "Senior PM, Saved Long Ago", status: "saved", statusAt: "@t-8", firstSeen: "@t-9", score: 70, location: "Remote, US" };
  const { page, errors } = await openDemo({ ...PHONE, seed: s });
  await waitHome(page);
  await page.click('#home-apps [data-tile="inprogress"]');
  await waitViewTab(page, "all");
  assert.deepEqual(await cardIds(page, "#view"), ["manual-heliohome-sr-pm"], "All, only the Applying role");
  await page.click("#tab-home");
  await waitHome(page);
  await page.click('#home-apps [data-tile="todo"]');
  await waitViewTab(page, "all");
  assert.deepEqual(await cardIds(page, "#view"), ["demo-saved-old"], "All, only the Saved role");
  await page.click("#tab-home");
  await waitHome(page);
  await page.click('#home-apps [data-tile="done"]');
  await waitViewTab(page, "pipeline");
  assert.deepEqual(errors, []);
  await page.close();
});

test("HOME-13 Applications shows the week bar (7 days) and 'Today X of Y' with a meter, from dashboard()", async () => {
  const { page, errors } = await openDemo({ ...PHONE });
  await waitHome(page);
  const { d } = await statsInPage(page);
  assert.equal(await page.locator("#home-apps ol.days li").count(), 7, "Mon to Sun");
  assert.match((await page.locator("#home-apps").innerText()).replace(/\s+/g, " "), new RegExp(`Today ${d.today.total} of ${d.today.bar}\\b`));
  assert.equal(await page.locator('#home-apps [role="meter"]').getAttribute("aria-valuenow"), String(d.today.total));
  assert.deepEqual(errors, []);
  await page.close();
});

// ── After you apply (UX-H-R5 §3, R6; AC5, AC6) ───────────────────────────────────────────────────────────────────

test("HOME-14 AC5 the stepper is Waiting 2 → Screen 1 → Interviews 1 → Offer 0 on the demo, plus '0 closed · 2 of 2 heard back'", async () => {
  const { page, errors } = await openDemo({ ...PHONE });
  await waitHome(page);
  const { h, d } = await statsInPage(page);
  const steps = page.locator("#home-after [data-stage]");
  assert.deepEqual(await steps.evaluateAll((els: HTMLElement[]) => els.map((e) => e.dataset.stage)), ["applied", "screen", "interviewing", "offer"]);
  assert.deepEqual(await nums(page, "#home-after [data-stage]"), ["2", "1", "1", "0"]);
  assert.deepEqual(await nums(page, "#home-after [data-stage]"), [h.stages.applied, h.stages.screen, h.stages.interviewing, h.stages.offer].map(String));
  const texts = await steps.allInnerTexts();
  ["Waiting", "Screen", "Interviews", "Offer"].forEach((w, i) => assert.match(texts[i] ?? "", new RegExp(`\\b${w}\\b`), `step ${i + 1} label`));
  assert.equal(d.response.pct, 100, "demo response rate");
  assert.equal((await page.locator("#homeClosed").innerText()).replace(/\s+/g, " ").trim(), `${h.closed} closed · ${d.response.heard} of ${d.response.eligible} heard back (sent ${d.response.afterDays}+ days ago)`);
  assert.deepEqual(errors, []);
  await page.close();
});

test("HOME-15 AC6 a rejection after applying shows as a grey '1 closed', and Home never says 'Rejected', More stats open or not", async () => {
  const s = baseSeed();
  s.jobs["demo-rejected"] = { company: "Quarry Ledger (demo)", title: "Senior PM, Rejected Role", status: "rejected", statusAt: "@t-2", appliedAt: "@t-20", firstSeen: "@t-22", score: 70,
    statusHistory: [{ status: "applied", at: "@t-20" }, { status: "rejected", at: "@t-2" }] };
  const { page, errors } = await openDemo({ ...LAPTOP, seed: s });
  await waitHome(page);
  const { h, d } = await statsInPage(page);
  assert.equal(h.closed, 1);
  const closed = page.locator("#homeClosed");
  assert.match((await closed.innerText()).replace(/\s+/g, " "), new RegExp(`^1 closed · ${d.response.heard} of ${d.response.eligible} heard back \\(sent ${d.response.afterDays}\\+ days ago\\)$`));
  const [r, g] = await closed.evaluate((e) => (getComputedStyle(e).color.match(/[\d.]+/g) || []).map(Number));
  assert.ok(!(r > 150 && r - g > 60), `closed line is grey, not red (rgb ${r},${g})`);
  assert.doesNotMatch(await visibleText(page, "#view"), /Rejected/i, "closed More stats");
  const more = page.locator("details#moreStats");
  assert.equal(await more.count(), 1, "More stats disclosure");
  await more.locator("summary").click();
  assert.doesNotMatch(await visibleText(page, "#view"), /Rejected/i, "open More stats");
  assert.deepEqual(errors, []);
  await page.close();
});

test("HOME-16 R6 'More stats' is closed by default and holds the old Funnel, Response rate and Sector mix", async () => {
  const { page, errors } = await openDemo({ ...LAPTOP });
  await waitHome(page);
  const more = page.locator("#home-after details#moreStats");
  assert.equal(await more.count(), 1, "details#moreStats inside After you apply");
  assert.match(await more.locator("summary").innerText(), /^More stats/);
  assert.equal(await more.evaluate((e) => (e as HTMLDetailsElement).open), false, "closed by default");
  for (const hd of ["Funnel", "Response rate", "Sector mix"]) assert.equal(await page.getByRole("heading", { name: new RegExp("^" + hd) }).isVisible().catch(() => false), false, `${hd} hidden until opened`);
  await more.locator("summary").click();
  for (const hd of ["Funnel", "Response rate", "Sector mix"]) assert.ok(await more.getByRole("heading", { name: new RegExp("^" + hd) }).isVisible(), `${hd} inside More stats`);
  assert.match(await more.innerText(), /100% heard back/);
  assert.deepEqual(errors, []);
  await page.close();
});

// ── Get ready (UX-H-R5 §4, R6; AC8) ──────────────────────────────────────────────────────────────────────────────

test("HOME-17 AC8 Get ready on the demo: Follow up, Send it, Add next step, then Recruiter · 2 due (owner), company first, each with its one verb", async () => {
  const { page, errors } = await openDemo({ ...PHONE });
  await waitHome(page);
  const rows = page.locator("#home-ready [data-ready]");
  const got = await rows.evaluateAll((els: HTMLElement[]) => els.map((e) => {
    const b = [...e.querySelectorAll<HTMLElement>("button, a")].filter((x) => x.offsetParent);
    return { kind: e.dataset.ready, text: e.innerText.replace(/\s+/g, " ").trim(), h: e.getBoundingClientRect().height,
      btns: b.map((x) => x.innerText.trim()), bh: Math.min(...b.map((x) => x.getBoundingClientRect().height)) };
  }));
  assert.deepEqual(got.map((r) => r.kind), ["followup", "submit", "nextstep", "recruiters"]);
  const want = [["Brightwell Solar Follow up · due ", "Follow-up sent"], ["HelioHome Send it", "I submitted it"], ["Pebblepay Add next step", "Add step"], ["Recruiter · 2 due", "Open"]];
  for (const [i, [label, verb]] of want.entries()) {
    assert.ok(got[i].text.startsWith(label), `row ${i + 1}: want '${label}', got '${got[i].text}'`);
    assert.deepEqual(got[i].btns, [verb], `row ${i + 1}: one button '${verb}'`);
    assert.ok(got[i].h >= 56, `row ${i + 1} is ${Math.round(got[i].h)}px`);
    assert.ok(got[i].bh >= 44, `row ${i + 1} button is ${Math.round(got[i].bh)}px`);
  }
  assert.deepEqual(errors, []);
  await page.close();
});

test("HOME-18 AC8 Get ready's buttons act: Follow-up sent clears the row, I submitted it marks Applied, Recruiter Open opens Recruiters", async () => {
  const { page, errors } = await openDemo({ ...PHONE });
  await waitHome(page);
  await page.locator('#home-ready [data-ready="followup"]').getByRole("button", { name: "Follow-up sent" }).click();
  await page.locator('#home-ready [data-ready="followup"]').waitFor({ state: "detached", timeout: 3000 });
  await page.locator('#home-ready [data-ready="submit"]').getByRole("button", { name: "I submitted it" }).click();
  await page.waitForFunction(() => jobs.find((j) => j._id === "manual-heliohome-sr-pm")?.status === "applied", null, { timeout: 3000 });
  await page.locator('#home-ready [data-ready="recruiters"]').getByRole("button", { name: "Open" }).click();
  await waitViewTab(page, "people");
  assert.deepEqual(errors, []);
  await page.close();
});

test("HOME-19 AC8 saved 7+ days shows '<Company>' / 'Decide · saved N days ago' → Open; more than 5 due shows 5 rows and 'See all N'", async () => {
  const s = baseSeed();
  s.jobs["demo-saved-old"] = { company: "Saltmarsh Grid (demo)", title: "Senior PM, Saved Long Ago", status: "saved", statusAt: "@t-8", firstSeen: "@t-9", score: 70 };
  for (let i = 1; i <= 3; i++) s.jobs[`demo-fup-${i}`] = { company: `Followup Co ${i} (demo)`, title: `Senior PM ${i}`, status: "applied", statusAt: `@t-${10 + i}`, appliedAt: `@t-${10 + i}`, followUpDue: `@d-${3 + i}`, firstSeen: `@t-${12 + i}`, score: 60 };
  const { page, errors } = await openDemo({ ...PHONE, seed: s });
  await waitHome(page);
  // Due: 4 follow-ups + Send it + Add next step + Decide + Recruiters = 8.
  const kinds = await page.locator("#home-ready [data-ready]").evaluateAll((els: HTMLElement[]) => els.map((e) => e.dataset.ready));
  assert.equal(kinds.length, 5, `at most 5 rows, got ${kinds.join(", ")}`);
  assert.deepEqual(kinds, ["followup", "followup", "followup", "followup", "submit"], "most urgent first");
  assert.match(await page.locator("#home-ready").innerText(), /See all 8\b/);
  await page.close();
  // Decide row on its own (nothing else due).
  const s2 = nothingDueSeed();
  s2.jobs["demo-saved-old"] = s.jobs["demo-saved-old"];
  const p2 = await openDemo({ ...PHONE, seed: s2 });
  await waitHome(p2.page);
  const row = p2.page.locator('#home-ready [data-ready="decide"]');
  assert.equal(await row.count(), 1);
  assert.match((await row.innerText()).replace(/\s+/g, " "), /^Saltmarsh Grid \(demo\) Decide · saved 8 days ago/);
  assert.deepEqual(await row.locator("button, a").allInnerTexts(), ["Open"]);
  assert.deepEqual([...errors, ...p2.errors], []);
  await p2.page.close();
});

test("HOME-20 AC8 with nothing due, Get ready reads 'Nothing due. Nice.'", async () => {
  const { page, errors } = await openDemo({ ...PHONE, seed: nothingDueSeed() });
  await waitHome(page);
  assert.equal(await page.locator("#home-ready [data-ready]").count(), 0);
  assert.match(await page.locator("#home-ready").innerText(), /Nothing due\. Nice\./);
  assert.deepEqual(errors, []);
  await page.close();
});

test("HOME-21 privacy: the public demo's Home has no recruiter row and no recruiter 'due' count; the owner's has both", async () => {
  const pub = await openDemo({ ...PHONE, publicDemo: true });
  await waitHome(pub.page);
  assert.equal(await pub.page.locator('#home-ready [data-ready="recruiters"]').count(), 0, "public: no recruiters row");
  const kinds = await pub.page.locator("#home-ready [data-ready]").evaluateAll((els: HTMLElement[]) => els.map((e) => e.dataset.ready));
  assert.deepEqual(kinds, ["followup", "submit", "nextstep"], "public: the role rows still show");
  const html = await pub.page.locator("#view").innerHTML();
  assert.doesNotMatch(await visibleText(pub.page, "#view"), /\bRecruiters?\b|\b\d+ due\b/i, "public: no recruiter text on Home");
  assert.doesNotMatch(html, /\bRecruiters?\b|data-ready="recruiters"/i, "public: nothing recruiter in the markup");
  await pub.page.close();
  const own = await openDemo({ ...PHONE });
  await waitHome(own.page);
  assert.match(await own.page.locator('#home-ready [data-ready="recruiters"]').innerText(), /Recruiter · 2 due/);
  await own.page.close();
});

// ── Pipeline (UX-H-R5 §5) ────────────────────────────────────────────────────────────────────────────────────────

test("HOME-22 Pipeline shows the Pipeline tab's first 3 cards in its order, and 'Open Pipeline' opens it", async () => {
  const { page, errors } = await openDemo({ ...LAPTOP });
  await waitHome(page);
  const home = await cardIds(page, "#home-pipeline");
  await page.click("#tab-pipeline");
  await waitViewTab(page, "pipeline");
  const pipe = await cardIds(page, "#view");
  assert.ok(pipe.length >= 3, "demo pipeline has at least 3 roles");
  assert.deepEqual(home, pipe.slice(0, 3), "Home shows the first 3 Pipeline cards");
  await page.click("#tab-home");
  await waitHome(page);
  await page.locator("#home-pipeline").getByRole("link", { name: "Open Pipeline" }).or(page.locator("#home-pipeline").getByRole("button", { name: "Open Pipeline" })).click();
  await waitViewTab(page, "pipeline");
  assert.deepEqual(errors, []);
  await page.close();
});

// ── Phone, dark mode, perf (AC13, AC14, RR-H-21) ─────────────────────────────────────────────────────────────────

test("HOME-23 AC13 on a 390x844 phone, This morning and its first row start above the fold; no sideways scroll at 360 or 390", async () => {
  for (const vp of [PHONE, SMALL]) {
    const { page } = await openDemo({ ...vp });
    await waitHome(page);
    const top = await page.locator("#home-morning").evaluate((e) => e.getBoundingClientRect().top);
    const row = await page.locator('#home-morning a[href^="#role-"]').first().evaluate((e) => e.getBoundingClientRect().top);
    if (vp === PHONE) {
      assert.ok(top < 844, `This morning starts at ${Math.round(top)}px`);
      assert.ok(row < 844, `first row starts at ${Math.round(row)}px`);
    }
    const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(over <= 0, `${vp.width}: Home scrolls sideways by ${over}px`);
    await page.close();
  }
});

test("HOME-24 AC14 dark mode: the health line, the closed line and the stepper labels meet 4.5:1", async () => {
  const { page } = await openDemo({ ...PHONE, colorScheme: "dark" });
  await waitHome(page);
  const ratios = await page.evaluate(() => {
    const rgb = (c: string) => (c.match(/[\d.]+/g) || []).map(Number);
    const lum = (v: number[]) => { const [r, g, b] = v.slice(0, 3).map((x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    const bgOf = (el: Element | null): number[] => { for (let e = el; e; e = e.parentElement) { const c = rgb(getComputedStyle(e).backgroundColor); if (c.length >= 3 && (c[3] ?? 1) > 0.5) return c; } return [255, 255, 255]; };
    const els = [...document.querySelectorAll<HTMLElement>("#homeHealth, #homeHealth *, #homeClosed, #homeClosed *, #home-after [data-stage], #home-after [data-stage] *")]
      .filter((e) => e.offsetParent && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim()));
    return els.map((e) => { const a = lum(rgb(getComputedStyle(e).color)), b = lum(bgOf(e)); return { t: e.textContent!.trim().slice(0, 30), r: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) }; });
  });
  assert.ok(ratios.length >= 5, `found ${ratios.length} text elements to measure`);
  assert.deepEqual(ratios.filter((x) => x.r < 4.5).map((x) => `'${x.t}' ${x.r.toFixed(2)}:1`), []);
  await page.close();
});

test("HOME-25 RR-H-21 2,000 roles: Home opens first, its counts are right, and switching New → Home takes under 500ms", async () => {
  const bulk: Record<string, object> = {};
  for (let i = 0; i < 2000; i++) {
    const status = i < 1000 ? "new" : i < 1500 ? "applied" : "skipped";
    bulk["bulk-" + i] = { company: `Bulk Co ${i} (demo)`, title: `Senior PM ${i}`, status, score: i % 101, location: "Remote, US", ...(status === "skipped" ? { skippedBy: "owner", skipReason: "Other", skipNote: "bulk" } : {}) };
  }
  const { page, errors } = await openDemo({ ...LAPTOP, seed: { ...baseSeed(), jobs: bulk }, ready: "#tab-inbox .n" });
  await waitHome(page);
  assert.deepEqual(await nums(page, "#home-after [data-stage]"), ["500", "0", "0", "0"], "500 Waiting");
  assert.ok(await page.locator('#home-morning a[href^="#role-"]').count() <= 5, "at most 5 picks");
  assert.ok(await page.locator("#home-pipeline article.job").count() <= 3, "at most 3 cards");
  await page.click("#tab-inbox");
  await waitViewTab(page, "inbox");
  const t0 = Date.now();
  await page.click("#tab-home");
  await waitHome(page);
  const ms = Date.now() - t0;
  console.log(`# HOME-25 New → Home with 2,000 roles: ${ms}ms`);
  assert.ok(ms < 500, `Home took ${ms}ms`);
  assert.deepEqual(errors, []);
  await page.close();
});
