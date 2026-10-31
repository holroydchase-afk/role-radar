// RR-M4 review fixes (ux-reviewer round 2: UX-H2-R1..R5, R7, R8, R9, R11, R12; privacy-security PS-M4-R1 UI half).
// Chief-of-staff rulings, no score changes (Chase is still deciding whether culture checks add points).
// Demo data only: demo/seed.json plus two made-up roles below. Written red-first by qa-tdd.
//
// Contract the engineer builds to (stable selectors, same as card.test.ts and home.test.ts unless noted):
//   Card sub-scores `.subscores` (FIX-1, FIX-2; UX-H2-R1, R2)
//   - Three parts `[data-part="fit|values|culture"]`, numbers only, no "/" anywhere in .subscores:
//       `Fit 45 · Values 45 · Culture 0`. Each part reads `<Name> <points>` then its badge word when one exists
//       (a small badge after the number): Fit from job.fit (Strong/Partial/Stretch), Values from valuesFitOf
//       (Great/Good/Neutral/No; no word when Unrated), Culture from cultureFitOf (Great/Good/Maybe/No; no word when
//       Unrated). Example: `Fit 35 Strong · Values 30 Good · Culture 0 Great`.
//   - Culture with no points (0), no culture checks (Unrated) and no culture signals reads `Culture –` (en dash).
//   - The words "not checked" never appear on a card (text or aria-label).
//   - The Culture word on the card equals the Culture badge in Details (`#detailsSheet .fitr` second `.rate`) for
//     every demo role, Sunfield (greenhouse-1001) included.
//   - Fit + Values + Culture on the card = the tile, unless scoreSplit().capped.
//   Details "Why this score" (FIX-3; UX-H2-R2)
//   - The text of all `#detailsSheet .why-score` elements, split into non-empty lines: line 1 is
//     `Fit N + Values N + Culture N = total` (N from scoreSplit, total = the tile). Then one line per group with
//     points, `Fit: experience 35 + pay 10` (a trailing `(max 60)` is allowed), whose terms add up to that group.
//     Tip: one `.why-score` element per line keeps RR-UX4-7 (each <= 2 lines on a phone) green.
//   Card buttons (FIX-4, FIX-5, FIX-12; UX-H2-R3, R12)
//   - At 360x740 on New and Pipeline (private and public builds) each card has <= 3 visible buttons, all in one row
//     (same top), and is <= 240px tall. No Preview button on the card: `.ctl` has no [data-preview].
//   - Cards keep: primary (if any), Skip/Withdraw, Details. With a primary: primary, Skip/Withdraw, Details.
//     With no primary (applied with no follow-up due, screen, interviewing): Details, then Withdraw.
//   - The Details sheet has a `Preview posting` button only when job.descriptionHtml/descriptionPlain is stored;
//     it opens #preview with that stored text.
//   Tabs (FIX-6; UX-H2-R4): at 360 and 390 every `#tabs` button >= 48px wide and >= 44px tall; no sideways scroll.
//   Get ready (FIX-7; UX-H2-R5): at 360 each `#home-ready [data-ready]` row shows the whole company name (no clipping
//     ancestor cuts it; scrollWidth <= clientWidth) and, for follow-ups, the whole `due <Mon D>` text. Row >= 56px.
//   #homeClosed (FIX-8; UX-H2-R7): `N closed · H of E heard back` (dashboard().response.heard / .eligible), never a %.
//     Extra words after it, like `(sent 14+ days ago)`, are fine.
//   Done tile (FIX-9; UX-H2-R8): opens Pipeline showing exactly homeStats().done cards (demo: 4), none Saved or
//     Applying; #fcount starts with that number.
//   Pipeline (FIX-10; UX-H2-R9): "Check Gmail for status updates" and "Add a role found somewhere else" sit after the
//     last card (DOM order and on screen).
//   Meta (FIX-11; UX-H2-R11): at 360 no card's `.meta` is cut off (scrollWidth <= clientWidth); it wraps instead.
//   Plain-text description (FIX-13; PS-M4-R1): a descriptionPlain holding `<script>` shows as text in the preview.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chromium } from "playwright";
import type { Browser, Page, Locator } from "playwright";
import { buildDemo } from "../scripts/build-demo.mjs";
import { openDemo as open, openTab } from "../scripts/browser.mjs";

declare const jobs: any[];
declare const specData: unknown;
declare const config: any;
declare const RoleRadarProgress: any;

const read = (p: string) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const baseSeed = () => JSON.parse(read("demo/seed.json"), (k, v) => (typeof v === "string" && v.startsWith("@file:") ? read(v.slice(6)) : v));
// Made-up roles: one with nothing known about culture (reads `Culture –`), one with culture signals and checks.
const FIXTURES: Record<string, Record<string, unknown>> = {
  "fix-bare": {
    company: "Brightgrid Solar (demo)", title: "Senior PM, Battery Storage", location: "Remote, US", comp: "$170K–$200K",
    source: "manual", url: "https://brightgrid.invalid/jobs/1", firstSeen: "@t-0", status: "new", statusAt: "@t-0",
    fit: "strong", sector: "Solar, storage & distributed energy", fitNote: "Home battery dashboards match past utility-data work.",
  },
  "fix-cult": {
    company: "Carbonwise (demo)", title: "Senior PM, Carbon Reporting", location: "Remote, US", comp: "$160K–$180K",
    source: "manual", url: "https://carbonwise.invalid/jobs/7", firstSeen: "@t-1", status: "new", statusAt: "@t-0",
    fit: "maybe", fitNote: "Emissions data products fit.",
    cultureSignals: { good: ["sustainable pace"], red: [] },
    cultureChecks: { calm_pace: "posting: sustainable pace", remote_us: "remote anywhere in the US" },
  },
};
const seedWithFixtures = () => { const s = baseSeed(); return { ...s, jobs: { ...s.jobs, ...FIXTURES } }; };

let browser: Browser;
type Opts = Parameters<typeof open>[1] & { publicDemo?: boolean; seed?: Record<string, any> };
const openDemo = ({ publicDemo = false, seed, ...opts }: Opts = {}) =>
  open(browser, { html: buildDemo({ publicDemo, ...(seed ? { seed } : {}) }), file: "dist/test-review-fixes.html", ready: "#tabs button", ...opts });
const SMALL = { width: 360, height: 740 };
const PHONE = { width: 390, height: 844 };
const LAPTOP = { width: 1280, height: 800 };
const anchor = (id: string) => "role-" + id.replace(/[^A-Za-z0-9_-]/g, "_");
const card = (page: Page, id: string) => page.locator(`#view article.job#${anchor(id)}`);
const num = (s: string) => Number(String(s).replace("−", "-"));
const noSideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

type Expect = { score: number; fit: number; values: number; culture: number; rated: boolean; capped: boolean; fitWord: string; valuesWord: string; cultureWord: string; status: string; company: string };
const expected = (page: Page) => page.evaluate(() => {
  const SC = (window as any).RoleRadarScoring;
  const LBL: Record<string, string> = { great: "Great", good: "Good", neutral: "Neutral", maybe: "Maybe", no: "No", unrated: "Unrated" };
  const FIT: Record<string, string> = { strong: "Strong", maybe: "Partial", partial: "Partial", stretch: "Stretch" };
  const out: Record<string, any> = {};
  for (const j of jobs as any[]) {
    const r = SC.scoreJob(j, specData), s = SC.scoreSplit(r, j);
    out[j._id] = { score: r.score, fit: s.fit, values: s.values, culture: s.culture, rated: s.cultureRated, capped: s.capped,
      fitWord: FIT[String(j.fit || "").toLowerCase()] || "", valuesWord: LBL[SC.valuesFitOf(j, specData).rating] || "",
      cultureWord: LBL[SC.cultureFitOf(j, specData).rating] || "", status: j.status || "new", company: j.company || "" };
  }
  return out;
}) as Promise<Record<string, Expect>>;

const partsOf = (c: Locator) => c.evaluate((el: HTMLElement) => {
  const sub = el.querySelector<HTMLElement>(".subscores");
  const p = (k: string) => { const e = el.querySelector<HTMLElement>(`.subscores [data-part="${k}"]`); return e ? { text: e.innerText.replace(/\s+/g, " ").trim(), label: e.getAttribute("aria-label") || "" } : null; };
  return { sub: sub ? sub.innerText.replace(/\s+/g, " ").trim() : null, subLabels: sub ? [...sub.querySelectorAll("[aria-label]")].map((e) => e.getAttribute("aria-label") || "").join(" | ") : "",
    fit: p("fit"), values: p("values"), culture: p("culture"), tile: el.querySelector(".score")?.textContent!.trim() ?? "", text: el.innerText };
});
// The visible controls on a closed card (the title link in the h2 and an open skip form don't count).
const controls = (c: Locator) => c.evaluate((el: HTMLElement) => {
  const vis = (x: HTMLElement) => { const r = x.getBoundingClientRect(); return !!x.offsetParent && r.width > 1 && r.height > 1; };
  return [...el.querySelectorAll<HTMLElement>("button, a.btn, select, [role=button]")].filter((b) => vis(b) && !b.closest("h2") && !b.closest("form.skipwhy"))
    .map((b) => { const r = b.getBoundingClientRect(); return { text: b.innerText.trim(), top: Math.round(r.top), cta: b.matches(".btn.cta"), quick: b.dataset.quick || "", details: b.hasAttribute("data-details"), preview: b.hasAttribute("data-preview") }; });
});
const openDetails = async (page: Page, id: string) => {
  await card(page, id).locator("button[data-details]").click();
  const sheet = page.locator("#detailsSheet");
  await sheet.waitFor({ state: "visible", timeout: 3000 });
  return sheet;
};
const closeDetails = async (page: Page) => {
  await page.keyboard.press("Escape");
  await page.locator("#detailsSheet").waitFor({ state: "hidden", timeout: 3000 });
};
const allIds = (page: Page) => page.locator("#view article.job[id^='role-']").evaluateAll((els) => els.map((e) => e.id.replace(/^role-/, "")));
const waitViewTab = (page: Page, id: string) =>
  page.waitForFunction((id) => document.querySelector("#view")?.getAttribute("data-tab") === id, id, { timeout: 3000 });
const waitHome = async (page: Page) => { await waitViewTab(page, "home"); await page.locator("#view #home-pipeline").waitFor({ state: "attached", timeout: 3000 }); };
const statsInPage = (page: Page) => page.evaluate(() => ({ h: RoleRadarProgress.homeStats(jobs), d: RoleRadarProgress.dashboard(jobs, { bar: Number(config.dailyBar) || 3 }) }));

// What a part should read: `<Name> <points>` and its badge word when there is one. Culture with nothing known: `Culture –`.
const wantPart = (name: string, n: number, word: string) => `${name} ${n}${word && word !== "Unrated" ? " " + word : ""}`;
const wantCulture = (e: Expect) => !e.rated && e.culture === 0 && e.cultureWord === "Unrated" ? "Culture –" : wantPart("Culture", e.culture, e.cultureWord);

before(async () => { browser = await chromium.launch(); });
after(async () => { await browser?.close(); });

// ── UX-H2-R1 (P0) and R2: the card never contradicts Details, and its parts add up ─────────────────────────────
test("FIX-1 UX-H2-R1 every card's parts read 'Name points Word'; Culture's word equals the Details badge; no 'not checked', 'Culture –' when nothing is known", async () => {
  const { page, errors } = await openDemo({ ...LAPTOP, seed: seedWithFixtures(), query: "?tab=all", ready: "#view article.job" });
  const exp = await expected(page);
  assert.equal(exp["greenhouse-1001"].company, "Sunfield Energy", "fixture: greenhouse-1001 is Sunfield");
  assert.notEqual(exp["greenhouse-1001"].cultureWord, "Unrated", "fixture: Sunfield has culture checks (Details shows a badge)");
  assert.equal(exp["greenhouse-1001"].culture, 0, "fixture: Sunfield has 0 culture points (the P0 contradiction)");
  assert.equal(wantCulture(exp["fix-bare"]), "Culture –", "fixture: fix-bare knows nothing about culture");
  const ids = await allIds(page);
  assert.ok(ids.length >= 15, `All shows the demo roles (${ids.length})`);
  const bad: string[] = [];
  for (const id of ids) {
    const e = exp[id], m = await partsOf(card(page, id));
    if (!m.fit || !m.values || !m.culture) { bad.push(`${id}: missing a [data-part] in '${m.sub}'`); continue; }
    const norm = (s: string) => s.replace(/−/g, "-");
    if (norm(m.fit.text) !== wantPart("Fit", e.fit, e.fitWord)) bad.push(`${id}: '${m.fit.text}', want '${wantPart("Fit", e.fit, e.fitWord)}'`);
    if (norm(m.values.text) !== wantPart("Values", e.values, e.valuesWord)) bad.push(`${id}: '${m.values.text}', want '${wantPart("Values", e.values, e.valuesWord)}'`);
    if (norm(m.culture.text) !== wantCulture(e)) bad.push(`${id}: '${m.culture.text}', want '${wantCulture(e)}'`);
    if (/not checked/i.test(m.text) || /not checked/i.test(m.subLabels)) bad.push(`${id}: the card says 'not checked'`);
    // The card's Culture word is the Details badge.
    const sheet = await openDetails(page, id);
    const badge = (await sheet.locator(".fitr .rate").nth(1).innerText()).trim();
    await closeDetails(page);
    const word = m.culture.text.replace(/^Culture\s+(–|[−-]?\d+)\s*/, "");
    if (badge !== "Unrated" && word !== badge) bad.push(`${id}: card culture '${m.culture.text}' vs Details badge '${badge}'`);
    if (badge === "Unrated" && word) bad.push(`${id}: card culture word '${word}' but Details says Unrated`);
  }
  assert.deepEqual(bad, []);
  assert.deepEqual(errors, []);
  await page.close();
});

test("FIX-2 UX-H2-R2 .subscores has no '/', and Fit + Values + Culture equals the tile unless capped (every card)", async () => {
  const { page, errors } = await openDemo({ ...LAPTOP, seed: seedWithFixtures(), query: "?tab=all", ready: "#view article.job" });
  const exp = await expected(page);
  const bad: string[] = [];
  for (const id of await allIds(page)) {
    const m = await partsOf(card(page, id));
    if (m.sub === null) { bad.push(`${id}: no .subscores`); continue; }
    if (m.sub.includes("/")) bad.push(`${id}: '${m.sub}' has a '/'`);
    const n = (t?: string) => { const x = (t || "").match(/^\w+ ([−-]?\d+)/); return x ? num(x[1]) : 0; };
    const sum = n(m.fit?.text) + n(m.values?.text) + n(m.culture?.text);
    if (!exp[id].capped && sum !== Number(m.tile)) bad.push(`${id}: '${m.sub}' adds to ${sum}, tile ${m.tile}`);
  }
  assert.deepEqual(bad, []);
  assert.deepEqual(errors, []);
  await page.close();
});

// Adds up a group line's terms: "experience 35 + pay 10 (max 60)" -> 45, "sector 45 − values 10" -> 35.
const sumTerms = (body: string) => {
  let total = 0, sign = 1;
  for (const tok of body.replace(/\([^)]*\)/g, "").trim().split(/\s+([+−-])\s+/)) {
    if (tok === "+") { sign = 1; continue; }
    if (tok === "−" || tok === "-") { sign = -1; continue; }
    const m = tok.match(/([−-])?\s*(\d+)/); if (!m) return NaN;
    total += sign * (m[1] ? -1 : 1) * Number(m[2]); sign = 1;
  }
  return total;
};
test("FIX-3 UX-H2-R2 Details 'Why this score' starts 'Fit N + Values N + Culture N = total', then one line per group that adds up", async () => {
  const { page, errors } = await openDemo({ ...LAPTOP, seed: seedWithFixtures(), query: "?tab=all", ready: "#view article.job" });
  const exp = await expected(page);
  assert.equal(sumTerms("experience 35 + pay 10 (max 60)"), 45, "helper self-check");
  const bad: string[] = [];
  for (const id of ["greenhouse-1001", "lever-1004", "greenhouse-1005", "greenhouse-1007", "ashby-1008", "fix-bare", "fix-cult"]) {
    const e = exp[id];
    const sheet = await openDetails(page, id);
    const lines = (await sheet.locator(".why-score").allInnerTexts()).join("\n").split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
    await closeDetails(page);
    const first = (lines[0] || "").replace(/−/g, "-");
    const want = `Fit ${e.fit} + Values ${e.values} + Culture ${e.culture} = ${e.score}`;
    if (first !== want) { bad.push(`${id}: first line '${lines[0]}', want '${want}'`); continue; }
    for (const [g, v] of [["Fit", e.fit], ["Values", e.values], ["Culture", e.culture]] as const) {
      const line = lines.slice(1).find((l) => l.startsWith(g + ":"));
      if (!line) { if (v !== 0) bad.push(`${id}: no '${g}: …' line (group has ${v})`); continue; }
      const s = sumTerms(line.slice(g.length + 1));
      if (s !== v) bad.push(`${id}: '${line}' adds to ${s}, want ${v}`);
    }
  }
  assert.deepEqual(bad, []);
  assert.deepEqual(errors, []);
  await page.close();
});

// ── UX-H2-R3, R12: one button row on a phone; Preview moves into Details ─────────────────────────────────────
test("FIX-4 UX-H2-R3 at 360x740 every New and Pipeline card has <= 3 buttons in one row, no Preview, and is <= 240px (both builds)", async () => {
  for (const publicDemo of [false, true]) {
    const { page, errors } = await openDemo({ ...SMALL, publicDemo, query: "?tab=inbox", ready: "#view article.job" });
    const bad: string[] = [];
    for (const tab of ["inbox", "pipeline"]) {
      await openTab(page, tab);
      const ids = await allIds(page);
      assert.ok(ids.length >= 4, `${tab} has cards`);
      for (const id of ids) {
        const c = card(page, id), ctl = await controls(c), h = (await c.boundingBox())!.height;
        const tag = `${publicDemo ? "public" : "private"} ${tab} ${id}`;
        if (ctl.length > 3) bad.push(`${tag}: ${ctl.length} buttons [${ctl.map((x) => x.text).join(", ")}]`);
        if (ctl.length && Math.max(...ctl.map((x) => x.top)) - Math.min(...ctl.map((x) => x.top)) > 4) bad.push(`${tag}: buttons on ${new Set(ctl.map((x) => x.top)).size} rows`);
        if (ctl.some((x) => x.preview)) bad.push(`${tag}: Preview is still on the card`);
        if (h > 240) bad.push(`${tag}: ${Math.round(h)}px tall`);
      }
    }
    assert.deepEqual(bad, []);
    assert.equal(await noSideways(page), 0);
    assert.deepEqual(errors, []);
    await page.close();
  }
});

test("FIX-5 UX-H2-R3 Details has 'Preview posting' only when a description is stored, and it opens that stored text", async () => {
  const { page, errors } = await openDemo({ ...SMALL, query: "?tab=pipeline", ready: "#view article.job" });
  // greenhouse-1007 (Brightwell, applied, follow-up due) has a stored description; alert-northstar-sr-pm has none.
  let sheet = await openDetails(page, "alert-northstar-sr-pm");
  assert.equal(await sheet.getByRole("button", { name: "Preview posting" }).count(), 0, "no description: no Preview posting");
  await closeDetails(page);
  sheet = await openDetails(page, "greenhouse-1007");
  const pv = sheet.getByRole("button", { name: "Preview posting" });
  assert.equal(await pv.count(), 1, "stored description: one Preview posting button in Details");
  const stored = await page.evaluate(() => { const j = jobs.find((x) => x._id === "greenhouse-1007"); const d = document.createElement("div"); d.innerHTML = j.descriptionHtml || ""; return (d.textContent || j.descriptionPlain || "").replace(/\s+/g, " ").trim().slice(0, 40); });
  assert.ok(stored.length > 10, "fixture: Brightwell has stored text");
  await pv.click();
  await page.locator("#preview").waitFor({ state: "visible", timeout: 3000 });
  await page.waitForFunction((s) => (document.querySelector("#preview")?.textContent || "").replace(/\s+/g, " ").includes(s), stored, { timeout: 3000 });
  assert.deepEqual(errors, []);
  await page.close();
});

test("FIX-12 UX-H2-R12 applied, screen and interviewing cards with no other primary read Details, then Withdraw", async () => {
  const { page, errors } = await openDemo({ ...LAPTOP, query: "?tab=pipeline", ready: "#view article.job" });
  const bad: string[] = [];
  for (const id of ["alert-northstar-sr-pm", "ashby-1008", "greenhouse-1010"]) {
    const ctl = await controls(card(page, id));
    const names = ctl.map((x) => x.text);
    if (ctl.some((x) => x.cta)) bad.push(`${id}: has a primary [${names}]`);
    if (JSON.stringify(names) !== JSON.stringify(["Details", "Withdraw"])) bad.push(`${id}: [${names.join(", ")}], want [Details, Withdraw]`);
  }
  // With a primary the order stays primary, Withdraw, Details.
  const fu = (await controls(card(page, "greenhouse-1007"))).map((x) => x.text);
  if (JSON.stringify(fu) !== JSON.stringify(["Follow-up sent", "Withdraw", "Details"])) bad.push(`greenhouse-1007: [${fu.join(", ")}]`);
  assert.deepEqual(bad, []);
  assert.deepEqual(errors, []);
  await page.close();
});

// ── UX-H2-R4: tab targets ────────────────────────────────────────────────────────────────────────────────────
test("FIX-6 UX-H2-R4 at 360 and 390 every tab is >= 48px wide and >= 44px tall, with no sideways scroll", async () => {
  for (const vp of [SMALL, PHONE]) {
    const { page, errors } = await openDemo({ ...vp });
    const tabs = await page.locator("#tabs button").evaluateAll((els: HTMLElement[]) => els.filter((e) => e.offsetParent).map((e) => { const r = e.getBoundingClientRect(); return { id: e.id, w: r.width, h: r.height }; }));
    assert.equal(tabs.length, 5, "five tabs");
    const small = tabs.filter((t) => t.w < 48 || t.h < 44).map((t) => `${t.id} ${Math.round(t.w)}x${Math.round(t.h)}`);
    assert.deepEqual(small, [], `${vp.width}px`);
    assert.ok(await page.locator("#tabs").evaluate((e) => e.scrollWidth <= e.clientWidth), `${vp.width}: #tabs scrolls sideways`);
    assert.equal(await noSideways(page), 0);
    assert.deepEqual(errors, []);
    await page.close();
  }
});

// ── UX-H2-R5: Get ready rows on a phone ──────────────────────────────────────────────────────────────────────
// Is this text fully visible in the row: no ancestor that clips (overflow other than visible) cuts its box?
const textFits = (row: Locator, needle: string) => row.evaluate((el: HTMLElement, needle: string) => {
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const full = el.innerText.replace(/\s+/g, " ");
  if (!full.includes(needle)) return `'${needle}' not in '${full}'`;
  while (w.nextNode()) {
    const t = w.currentNode as Text, i = (t.nodeValue || "").indexOf(needle);
    if (i < 0) continue;
    const range = document.createRange(); range.setStart(t, i); range.setEnd(t, i + needle.length);
    const r = range.getBoundingClientRect();
    for (let a: HTMLElement | null = t.parentElement; a && a !== el.parentElement; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (a.scrollWidth > a.clientWidth + 1 && (cs.overflowX !== "visible" || cs.textOverflow === "ellipsis")) return `<${a.tagName.toLowerCase()} class="${a.className}"> is cut (scrollWidth ${a.scrollWidth} > ${a.clientWidth})`;
      if (cs.overflowX !== "visible") { const b = a.getBoundingClientRect(); if (r.right > b.right + 1 || r.left < b.left - 1) return `'${needle}' runs past <${a.tagName.toLowerCase()}>`; }
    }
    return r.width > 0 ? "" : `'${needle}' has no box`;
  }
  return `'${needle}' is split across elements`;
}, needle);
test("FIX-7 UX-H2-R5 at 360 each Get ready row shows the whole company and the due date, and is >= 56px tall", async () => {
  const { page, errors } = await openDemo({ ...SMALL });
  await waitHome(page);
  const rows = await page.locator("#home-ready [data-ready]").evaluateAll((els: HTMLElement[]) => els.map((e) => {
    const b = e.querySelector<HTMLElement>("[data-fupsent], [data-job], [data-details], [data-role]");
    const id = b?.dataset.fupsent || b?.dataset.job || b?.dataset.details || "";
    const j = id ? jobs.find((x) => x._id === id) : null;
    return { kind: e.dataset.ready!, company: j ? String(j.company) : "", due: j && e.dataset.ready === "followup" ? j.followUpDue : "", h: e.getBoundingClientRect().height };
  }));
  assert.ok(rows.some((r) => r.kind === "followup"), "demo has a follow-up row (Brightwell Solar)");
  const bad: string[] = [];
  for (const [i, r] of rows.entries()) {
    if (r.h < 56) bad.push(`row ${i + 1} (${r.kind}) is ${Math.round(r.h)}px`);
    if (!r.company) continue;
    const row = page.locator("#home-ready [data-ready]").nth(i);
    const c = await textFits(row, r.company); if (c) bad.push(`row ${i + 1} company: ${c}`);
    if (r.due) {
      const dueText = "due " + await page.evaluate((d) => (window as any).fmtDate ? (window as any).fmtDate(d) : new Date(d + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" }), r.due);
      const d = await textFits(row, dueText); if (d) bad.push(`row ${i + 1} due date: ${d}`);
    }
  }
  assert.deepEqual(bad, []);
  assert.equal(await noSideways(page), 0);
  assert.deepEqual(errors, []);
  await page.close();
});

// ── UX-H2-R7, R8: After you apply and the Done tile ─────────────────────────────────────────────────────────
test("FIX-8 UX-H2-R7 #homeClosed reads 'N closed · H of E heard back' (counts, no percentage); demo '0 closed · 2 of 2 heard back'", async () => {
  const { page, errors } = await openDemo({ ...PHONE });
  await waitHome(page);
  const { h, d } = await statsInPage(page);
  assert.deepEqual([h.closed, d.response.heard, d.response.eligible], [0, 2, 2], "demo numbers");
  const t = (await page.locator("#homeClosed").innerText()).replace(/\s+/g, " ").trim();
  assert.match(t, new RegExp(`^${h.closed} closed · ${d.response.heard} of ${d.response.eligible} heard back\\b`));
  assert.doesNotMatch(t, /%/, "no bare percentage");
  assert.deepEqual(errors, []);
  await page.close();
});

test("FIX-9 UX-H2-R8 the Done tile opens Pipeline showing exactly as many roles as the tile says (demo 4), none Saved or Applying", async () => {
  const { page, errors } = await openDemo({ ...PHONE });
  await waitHome(page);
  const tileN = Number((await page.locator('#home-apps [data-tile="done"] .num').innerText()).trim());
  assert.equal(tileN, 4, "demo Done tile");
  await page.click('#home-apps [data-tile="done"]');
  await waitViewTab(page, "pipeline");
  const ids = await page.locator("#view article.job[id^='role-']").evaluateAll((els: HTMLElement[]) => els.filter((e) => e.offsetParent).map((e) => e.id.replace(/^role-/, "")));
  const sts = await page.evaluate((ids) => ids.map((id) => jobs.find((j) => "role-" + j._id.replace(/[^A-Za-z0-9_-]/g, "_") === "role-" + id)?.status), ids);
  assert.equal(ids.length, tileN, `Pipeline shows ${ids.length} roles [${ids.join(", ")}], tile says ${tileN}`);
  assert.ok(!sts.some((s) => s === "saved" || s === "applying"), `statuses ${sts.join(", ")}`);
  assert.match(await page.locator("#fcount").innerText(), new RegExp(`^${tileN}\\b`), "the count line agrees");
  assert.deepEqual(errors, []);
  await page.close();
});

// ── UX-H2-R9: Pipeline disclosures after the cards ──────────────────────────────────────────────────────────
test("FIX-10 UX-H2-R9 'Check Gmail' and 'Add a role' sit after the last Pipeline card", async () => {
  const { page, errors } = await openDemo({ ...PHONE, query: "?tab=pipeline", ready: "#view article.job" });
  const r = await page.evaluate(() => {
    const cards = [...document.querySelectorAll<HTMLElement>("#view article.job")], last = cards[cards.length - 1];
    const first = cards[0];
    const sums = [...document.querySelectorAll<HTMLElement>("#view details > summary")].filter((s) => /Check Gmail|Add a role/.test(s.innerText));
    return { n: cards.length, items: sums.map((s) => { const d = s.parentElement!; return { text: s.innerText.trim(), after: !!(last.compareDocumentPosition(d) & Node.DOCUMENT_POSITION_FOLLOWING), top: d.getBoundingClientRect().top, lastBottom: last.getBoundingClientRect().bottom, firstTop: first.getBoundingClientRect().top }; }) };
  });
  assert.ok(r.n >= 3, "Pipeline cards");
  assert.equal(r.items.length, 2, `both disclosures on the owner's Pipeline: ${r.items.map((x) => x.text).join(", ")}`);
  for (const x of r.items) {
    assert.ok(x.after, `'${x.text}' comes before the last card in the page`);
    assert.ok(x.top >= x.lastBottom - 1, `'${x.text}' (top ${Math.round(x.top)}) is above the last card's bottom (${Math.round(x.lastBottom)})`);
  }
  assert.deepEqual(errors, []);
  await page.close();
});

// ── UX-H2-R11: meta wraps instead of cutting off ────────────────────────────────────────────────────────────
test("FIX-11 UX-H2-R11 at 360 no card's meta line is cut off (New, Pipeline, All)", async () => {
  const { page, errors } = await openDemo({ ...SMALL, query: "?tab=inbox", ready: "#view article.job" });
  const bad: string[] = [];
  for (const tab of ["inbox", "pipeline", "all"]) {
    await openTab(page, tab);
    const cut = await page.locator("#view article.job .meta").evaluateAll((els: HTMLElement[]) => els.filter((e) => e.offsetParent && e.scrollWidth > e.clientWidth + 1).map((e) => `'${e.innerText.trim()}' ${e.scrollWidth}>${e.clientWidth}`));
    for (const c of cut) bad.push(`${tab}: ${c}`);
  }
  assert.deepEqual(bad, []);
  assert.deepEqual(errors, []);
  await page.close();
});

// ── PS-M4-R1 (UI half): a plain-text description is text, never markup ─────────────────────────────────────
test("FIX-13 PS-M4-R1 a descriptionPlain holding <script> shows as text in the preview and never runs", async () => {
  const s = baseSeed();
  s.jobs["fix-plain"] = { company: "Plaintext Co (demo)", title: "Senior PM, Plain Text", status: "applied", statusAt: "@t-1", appliedAt: "@t-1", firstSeen: "@t-3", source: "manual", location: "Remote, US",
    descriptionPlain: "Intro <script>window.__x=1</script> and <img src=x onerror=\"window.__x=2\"> stay as words.\n\nSecond paragraph." };
  const { page, errors } = await openDemo({ ...LAPTOP, seed: s, query: "?tab=pipeline", ready: "#view article.job" });
  // Open the preview the way the page offers it: Details → Preview posting, or (before UX-H2-R3) the card's Preview.
  const onCard = card(page, "fix-plain").locator("button[data-preview]");
  if (await onCard.count()) await onCard.click();
  else { const sheet = await openDetails(page, "fix-plain"); await sheet.getByRole("button", { name: "Preview posting" }).click(); }
  await page.locator("#pvBody").waitFor({ state: "visible", timeout: 3000 });
  const body = page.locator("#pvBody");
  assert.match(await body.innerText(), /<script>window\.__x=1<\/script>/, "the tag shows as text");
  assert.match(await body.innerText(), /<img src=x onerror=/);
  assert.equal(await body.locator("script, img").count(), 0);
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => (window as any).__x), undefined);
  assert.deepEqual(errors, []);
  await page.close();
});
