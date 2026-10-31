// RR-M4.3 calmer card (ux-reviewer UX-H-R3, R4, R7, R9, R10; architect §2 and §4; ACs UX-H-AC9b on the card, AC10-AC14).
// The tile shows the computed score with Fit · Values · Culture under the title, the closed card keeps one meta line,
// one reason line and at most 4 buttons, and everything else moves into a Details sheet with a single Save.
// Demo data only: the base demo seed plus three made-up roles below. Red first.
//
// Contract the engineer builds to (stable selectors):
//   Card  `#view article.job#role-<id>`
//   - `.score` tile: the COMPUTED total, String(scoreJob(job, specData).score), memoized per (jobs, specData); not the
//     stored job.score. `.hi` when the computed total is >= 70.
//   - `.subscores`: exactly one, under the title. Three parts `[data-part="fit"]`, `[data-part="values"]`,
//     `[data-part="culture"]`, reading `Fit 45/60 · Values 45/45 · Culture 10/10` from scoreSplit(scoreJob(job), job).
//     When split.cultureRated is false the culture part reads `Culture not checked` (no number).
//     Each part's aria-label names the part, its points and its badge word: Fit from job.fit (Strong/Partial/Stretch),
//     Values from valuesFitOf (Great/Good/Neutral/No), Culture from cultureFitOf (Great/Good/Maybe/No/Unrated), or
//     "not checked". Fit + Values + Culture shown = the tile unless split.capped (AC9b). Dark mode contrast >= 4.5:1.
//   - `.reason`: at most one. The first sentence of fitNote, or on Needs action the action reason
//     (`Follow-up due Oct 28`). CSS -webkit-line-clamp 2 below 900px, 1 at 900px+.
//   - `.meta`: exactly one visible line, `location · pay · <one date for the status>` (Found for new, Viewed or Found
//     for viewed, Applied for applied...). No chips in it.
//   - Buttons (button, a.btn, select, [role=button] outside the h2), at most 4, no select:
//       one filled primary `.btn.cta` for the status (private build): Apply (`[data-apply]`) on new/viewed/saved,
//       `I submitted it` on applying, `Follow-up sent` on applied with a follow-up due; none on other statuses;
//       then `[data-quick="skipped"]` reading `Skip` (new..applying) or `Withdraw` (applied, screen, interviewing,
//       offer); then `button[data-details="<id>"]` named "Details" (aria-haspopup="dialog").
//       `button[data-preview]` ("Preview") only when job.descriptionHtml or job.descriptionPlain is stored; it shows
//       that stored text in #preview. No `Open posting` / `Sample posting` on the closed card.
//   - Not on the closed card: Experience chip, status chip (.chip.st), tags, sector/lane pills, score math
//     (.why-score), Values/Culture rows (.fitr), dates row (.dates), "Copies an intake prompt", the
//     "Lane, tags, referral, notes" disclosure.
//   - Status changes (the primary button, or the sheet's Status select) save at once with the existing Undo toast.
//   Details sheet `#detailsSheet`, role="dialog", one per page, opened by the card's Details button
//   - Bottom sheet below 900px (full width, flush with the bottom), right-hand panel at 900px+ (flush right, not full width).
//   - Holds: a "Why this score" section (.fitr Values and Culture with reasons, score math .why-score, the full
//     fitNote), a select labeled "Status" (saves on change, Undo toast), the date history, fields labeled Lane, Tags,
//     Referral, Follow up on, Next step, Notes, an "Open posting" link (or Sample posting on demo links) and the Apply
//     hint "Copies an intake prompt for a new chat" (private build, before applying).
//   - Exactly one submit button, named "Save". No "Save details" anywhere on the page.
//   - Escape discards edits, closes the sheet and returns focus to the card's Details button.
//   Sort: "Best match" orders by the computed score.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chromium } from "playwright";
import type { Browser, Page, Locator } from "playwright";
import { buildDemo } from "../scripts/build-demo.mjs";
import { openDemo as open, openTab } from "../scripts/browser.mjs";

// Page globals (top-level let in the page's classic script), read inside page.evaluate.
declare const jobs: any[];
declare const specData: unknown;

const read = (p: string) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const baseSeed = () => JSON.parse(read("demo/seed.json"), (k, v) => (typeof v === "string" && v.startsWith("@file:") ? read(v.slice(6)) : v));

// Made-up roles. card-hi and card-lo carry stale stored scores (computed 90 vs stored 10, computed 20 vs stored 95),
// so a tile or sort that reads job.score shows up. card-hi and card-cult have a stored description; card-lo has none.
const FIXTURES: Record<string, Record<string, unknown>> = {
  "card-hi": {
    company: "Brightgrid Solar (demo)", title: "Senior PM, Battery Storage", location: "Remote, US", comp: "$170K–$200K",
    source: "manual", url: "https://brightgrid.invalid/jobs/1", firstSeen: "@t-0", postedAt: "@d-1", status: "new", statusAt: "@t-0",
    fit: "strong", score: 10, sector: "Solar, storage & distributed energy", lane: "Geospatial / clean energy", tags: ["priority-demo"],
    fitNote: "Home battery dashboards match past utility-data work. Gap: no hardware experience. Pay clears the stretch target.",
    descriptionPlain: "Brightgrid (a made-up demo company) builds home battery software. You will own the storage roadmap.",
  },
  "card-lo": {
    company: "Lowfit Labs (demo)", title: "Product Manager, Internal Tools", location: "Remote, US", comp: "$120K–$140K",
    source: "manual", url: "https://example.com/jobs/lowfit", firstSeen: "@t-0", status: "new", statusAt: "@t-0",
    fit: "stretch", score: 95, fitNote: "Internal tools are a stretch from platform work. Level is below target.",
  },
  "card-cult": {
    company: "Carbonwise (demo)", title: "Senior PM, Carbon Reporting", location: "Remote, US", comp: "$160K–$180K",
    source: "manual", url: "https://carbonwise.invalid/jobs/7", firstSeen: "@t-1", viewedAt: "@t-0", status: "viewed", statusAt: "@t-0",
    fit: "maybe", score: 1, fitNote: "Emissions data products fit; carbon accounting standards are new. Calm pace per the posting.",
    cultureSignals: { good: ["sustainable pace"], red: [] },
    cultureChecks: { calm_pace: "posting: sustainable pace", remote_us: "remote anywhere in the US" },
    descriptionHtml: "<p>Carbonwise (a made-up demo company) measures emissions for mid-size manufacturers.</p>",
  },
};
const seedWithFixtures = () => { const s = baseSeed(); return { ...s, jobs: { ...s.jobs, ...FIXTURES } }; };

let browser: Browser;
type Opts = Parameters<typeof open>[1] & { publicDemo?: boolean; seed?: Record<string, any> };
const openDemo = ({ publicDemo = false, seed = seedWithFixtures(), ...opts }: Opts = {}) =>
  open(browser, { html: buildDemo({ publicDemo, seed }), file: "dist/test-card.html", ready: "#view article.job", ...opts });
const PHONE = { width: 390, height: 844 };
const LAPTOP = { width: 1280, height: 800 };
const anchor = (id: string) => "role-" + id.replace(/[^A-Za-z0-9_-]/g, "_");
const card = (page: Page, id: string) => page.locator(`#view article.job#${anchor(id)}`);
const firstSentence = (s: string) => (String(s).trim().match(/^.*?[.!?](?=\s|$)/) || [String(s).trim()])[0];
const DATE = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{1,2}\b/g;
const jobState = (page: Page, id: string) => page.evaluate((id) => {
  const j = jobs.find((x) => x._id === id); return j ? { ...j } : null;
}, id);
const toastText = (page: Page) => page.evaluate(() => { const t = document.querySelector<HTMLElement>("#toast"); return t && !t.hidden ? t.textContent!.trim() : ""; });

// What the page's own scoring says for each role (computed in the page, from the criteria it loaded).
type Expect = { score: number; stored: unknown; fit: number; values: number; culture: number; rated: boolean; capped: boolean; fitWord: string; valuesWord: string; cultureWord: string; fitNote: string; status: string };
const expected = (page: Page) => page.evaluate(() => {
  const w = window as any, SC = w.RoleRadarScoring;
  const spec = specData, list = jobs as any[];
  const LBL: Record<string, string> = { great: "Great", good: "Good", neutral: "Neutral", maybe: "Maybe", no: "No", unrated: "Unrated" };
  const FIT: Record<string, string> = { strong: "Strong", maybe: "Partial", partial: "Partial", stretch: "Stretch" };
  const out: Record<string, any> = {};
  for (const j of list) {
    const r = SC.scoreJob(j, spec), s = SC.scoreSplit(r, j);
    out[j._id] = { score: r.score, stored: j.score, fit: s.fit, values: s.values, culture: s.culture, rated: s.cultureRated, capped: s.capped,
      fitWord: FIT[String(j.fit || "").toLowerCase()] || "", valuesWord: LBL[SC.valuesFitOf(j, spec).rating] || "",
      cultureWord: LBL[SC.cultureFitOf(j, spec).rating] || "", fitNote: j.fitNote || "", status: j.status || "new" };
  }
  return out;
}) as Promise<Record<string, Expect>>;

// Everything measurable on one closed card.
const measure = (c: Locator) => c.evaluate((el: HTMLElement) => {
  const vis = (x: Element) => { const h = x as HTMLElement, r = h.getBoundingClientRect(); return !!h.offsetParent && r.width > 1 && r.height > 1; };
  const all = (sel: string) => [...el.querySelectorAll(sel)].filter(vis) as HTMLElement[];
  const controls = all("button, a.btn, select, [role=button]").filter((b) => !b.closest("h2"));
  const lines = (e: HTMLElement) => { const cs = getComputedStyle(e); const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4; return Math.round(e.getBoundingClientRect().height / lh); };
  const sub = all(".subscores"), reason = all(".reason"), meta = all(".meta"), h2 = el.querySelector("h2")!;
  return {
    h: el.getBoundingClientRect().height, text: el.innerText,
    tile: el.querySelector(".score")?.textContent!.trim() ?? null, tileHi: !!el.querySelector(".score.hi"),
    controls: controls.map((b) => ({ tag: b.tagName, text: b.tagName === "SELECT" ? "(status select)" : b.innerText.trim(), cta: b.matches(".btn.cta"), quick: b.dataset.quick || "", details: b.hasAttribute("data-details"), preview: b.hasAttribute("data-preview"), apply: b.hasAttribute("data-apply"), haspopup: b.getAttribute("aria-haspopup") })),
    subCount: sub.length, subText: sub[0]?.innerText.replace(/\s+/g, " ").trim() ?? "", subBelowTitle: sub[0] ? sub[0].getBoundingClientRect().top >= h2.getBoundingClientRect().top + 4 : false,
    parts: Object.fromEntries(["fit", "values", "culture"].map((k) => { const p = el.querySelector<HTMLElement>(`.subscores [data-part="${k}"]`); return [k, p ? { text: p.innerText.replace(/\s+/g, " ").trim(), label: p.getAttribute("aria-label") || "" } : null]; })),
    reasonCount: reason.length, reasonText: reason[0]?.textContent!.trim() ?? "", reasonClamp: reason[0] ? (getComputedStyle(reason[0]) as any).webkitLineClamp || getComputedStyle(reason[0]).getPropertyValue("-webkit-line-clamp") : "",
    reasonLines: reason[0] ? lines(reason[0]) : 0,
    metaCount: meta.length, metaText: meta[0]?.innerText.replace(/\s+/g, " ").trim() ?? "", metaLines: meta[0] ? lines(meta[0]) : 0, metaChips: meta[0] ? meta[0].querySelectorAll(".chip").length : 0,
    banned: {
      experienceChip: all(".chip[class*=fit-]").length > 0 || /Experience:/.test(el.innerText),
      statusChip: all(".chip.st").length, tags: all(".tag, .tags").length, pills: all(".chip.lane").length,
      scoreMath: all(".why-score, .score-math").length, fitRows: all(".fitr").length, dates: all(".dates").length,
      applyHint: /Copies an intake prompt/.test(el.innerText), moreForm: all("details.more, details[data-more]").length,
      openPosting: /Open posting|Sample posting/.test(el.innerText),
    },
  };
});

before(async () => { browser = await chromium.launch(); });
after(async () => { await browser?.close(); });

// ── Score tile and sub-scores (AC9b on the card) ───────────────────────────────────────────────────────────────
test("CARD-1 the tile shows the computed score, not the stored job.score", async () => {
  const { page, errors } = await openDemo({ ...LAPTOP });
  const exp = await expected(page);
  const hi = await measure(card(page, "card-hi")), lo = await measure(card(page, "card-lo"));
  assert.equal(exp["card-hi"].score, 90, "fixture: card-hi computes to 90");
  assert.equal(exp["card-lo"].score, 20, "fixture: card-lo computes to 20");
  assert.equal(hi.tile, "90", `card-hi tile shows ${hi.tile} (stored 10, computed 90)`);
  assert.ok(hi.tileHi, "a computed 90 gets the green .hi tile");
  assert.equal(lo.tile, "20", `card-lo tile shows ${lo.tile} (stored 95, computed 20)`);
  assert.ok(!lo.tileHi, "a computed 20 is not green");
  await openTab(page, "all");
  const bad: string[] = [];
  for (const [id, e] of Object.entries(exp)) {
    const t = await card(page, id).locator(".score").textContent().catch(() => null);
    if (t?.trim() !== String(e.score)) bad.push(`${id}: tile ${t?.trim()} vs computed ${e.score}`);
  }
  assert.deepEqual(bad, []);
  assert.deepEqual(errors, []);
  await page.close();
});

test("CARD-2 under the title, Fit · Values · Culture points from scoreSplit, each with its badge word as its label", async () => {
  const { page, errors } = await openDemo({ ...LAPTOP });
  const exp = await expected(page);
  const num = (s: string) => Number(s.replace("−", "-"));
  const bad: string[] = [];
  for (const id of ["card-hi", "card-cult", "greenhouse-1001", "lever-1004"]) {
    const e = exp[id], m = await measure(card(page, id));
    if (m.subCount !== 1) { bad.push(`${id}: ${m.subCount} .subscores lines`); continue; }
    if (!m.subBelowTitle) bad.push(`${id}: .subscores is not under the title`);
    const f = m.parts.fit, v = m.parts.values, c = m.parts.culture;
    if (!f || !v || !c) { bad.push(`${id}: missing [data-part] fit/values/culture in '${m.subText}'`); continue; }
    const fm = f.text.match(/^Fit ([−-]?\d+)\/60$/), vm = v.text.match(/^Values ([−-]?\d+)\/45$/);
    if (!fm || num(fm[1]) !== e.fit) bad.push(`${id}: fit '${f.text}', want 'Fit ${e.fit}/60'`);
    if (!vm || num(vm[1]) !== e.values) bad.push(`${id}: values '${v.text}', want 'Values ${e.values}/45'`);
    if (!new RegExp(`\\bFit\\b[\\s\\S]*\\b${e.fit}\\b[\\s\\S]*\\b60\\b[\\s\\S]*\\b${e.fitWord}\\b`, "i").test(f.label)) bad.push(`${id}: fit aria-label '${f.label}' lacks points and '${e.fitWord}'`);
    if (!new RegExp(`\\bValues\\b[\\s\\S]*${e.values}\\b[\\s\\S]*\\b45\\b[\\s\\S]*\\b${e.valuesWord}\\b`, "i").test(v.label)) bad.push(`${id}: values aria-label '${v.label}' lacks points and '${e.valuesWord}'`);
    if (e.rated) {
      const cm = c.text.match(/^Culture ([−-]?\d+)\/10$/);
      if (!cm || num(cm[1]) !== e.culture) bad.push(`${id}: culture '${c.text}', want 'Culture ${e.culture}/10'`);
      if (!new RegExp(`\\bCulture\\b[\\s\\S]*${e.culture}\\b[\\s\\S]*\\b10\\b[\\s\\S]*\\b${e.cultureWord}\\b`, "i").test(c.label)) bad.push(`${id}: culture aria-label '${c.label}' lacks points and '${e.cultureWord}'`);
      // AC9b: what the card shows adds up to its tile.
      if (!e.capped && fm && vm && cm && num(fm[1]) + num(vm[1]) + num(cm[1]) !== Number(m.tile)) bad.push(`${id}: ${m.subText} doesn't add up to the tile ${m.tile}`);
    } else {
      if (c.text !== "Culture not checked") bad.push(`${id}: unrated culture reads '${c.text}', want 'Culture not checked'`);
      if (!/culture/i.test(c.label) || !/not checked/i.test(c.label)) bad.push(`${id}: culture aria-label '${c.label}'`);
    }
    if (!/^Fit [−-]?\d+\/60 · Values [−-]?\d+\/45 · Culture ([−-]?\d+\/10|not checked)$/.test(m.subText)) bad.push(`${id}: line reads '${m.subText}'`);
  }
  assert.ok(exp["card-cult"].rated && !exp["greenhouse-1001"].rated, "fixtures: one role with culture signals, one without");
  assert.deepEqual(bad, []);
  assert.deepEqual(errors, []);
  await page.close();
});

test("CARD-3 'Best match' orders cards by the computed score (stale stored scores don't move them)", async () => {
  const { page, errors } = await openDemo({ ...LAPTOP });
  const exp = await expected(page);
  for (const tab of ["inbox", "all"]) {
    await openTab(page, tab);
    assert.match(await page.locator("#fcount").innerText(), /Best match/, `${tab} sorts by Best match`);
    const ids = await page.locator("#view article.job").evaluateAll((els) => els.map((e) => e.id.replace(/^role-/, "")));
    const scores = ids.map((id) => exp[id]?.score ?? -1);
    const outOfOrder = scores.findIndex((s, i) => i > 0 && s > scores[i - 1]);
    assert.equal(outOfOrder, -1, `${tab}: computed scores in card order ${ids.map((id, i) => `${id}=${scores[i]}`).join(", ")}`);
    assert.ok(ids.indexOf("card-hi") < ids.indexOf("card-lo"), `${tab}: card-hi (computed 90, stored 10) sorts above card-lo (computed 20, stored 95)`);
  }
  assert.deepEqual(errors, []);
  await page.close();
});

test("CARD-4 dark mode: the sub-score line meets 4.5:1 contrast (UX-H-AC14)", async () => {
  const { page } = await openDemo({ ...PHONE, colorScheme: "dark" });
  const ratios = await page.evaluate(() => {
    const rgb = (c: string) => (c.match(/[\d.]+/g) || []).map(Number);
    const lum = (v: number[]) => { const [r, g, b] = v.slice(0, 3).map((x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    const bgOf = (el: Element | null): number[] => { for (let e = el; e; e = e.parentElement) { const c = rgb(getComputedStyle(e).backgroundColor); if (c.length >= 3 && (c[3] ?? 1) > 0.5) return c; } return [255, 255, 255]; };
    const els = [...document.querySelectorAll<HTMLElement>("#view article.job .subscores, #view article.job .subscores *")].filter((e) => e.offsetParent && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim()));
    return els.slice(0, 30).map((e) => { const a = lum(rgb(getComputedStyle(e).color)), b = lum(bgOf(e)); return { t: e.textContent!.trim().slice(0, 30), r: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) }; });
  });
  assert.ok(ratios.length > 0, "no visible .subscores text to measure");
  const low = ratios.filter((x) => x.r < 4.5).map((x) => `'${x.t}' ${x.r.toFixed(2)}:1`);
  assert.deepEqual(low, []);
  await page.close();
});

// ── Closed card (AC10, R9, R10) ────────────────────────────────────────────────────────────────────────────────
test("CARD-5 a closed New card at 390x844 is <= 240px tall with <= 4 buttons and no select (UX-H-AC10), private and public", async () => {
  for (const publicDemo of [false, true]) {
    const { page, errors } = await openDemo({ ...PHONE, publicDemo });
    const n = await page.locator("#view article.job").count();
    assert.ok(n >= 5, "at least 5 New cards");
    const bad: string[] = [];
    for (let i = 0; i < n; i++) {
      const m = await measure(page.locator("#view article.job").nth(i));
      const tag = `${publicDemo ? "public" : "private"} card ${i + 1} '${m.text.split("\n").slice(0, 2).join(" / ")}'`;
      if (m.h > 240) bad.push(`${tag}: ${Math.round(m.h)}px tall`);
      if (m.controls.length > 4) bad.push(`${tag}: ${m.controls.length} buttons (${m.controls.map((c) => c.text || c.tag).join(", ")})`);
      if (m.controls.some((c) => c.tag === "SELECT")) bad.push(`${tag}: a status select on the closed card`);
      const cta = m.controls.filter((c) => c.cta);
      if (cta.length !== 1) bad.push(`${tag}: ${cta.length} filled primaries (${cta.map((c) => c.text).join(", ")})`);
    }
    assert.deepEqual(bad, []);
    assert.deepEqual(errors, []);
    await page.close();
  }
});

test("CARD-6 the closed card drops the Experience chip, status chip, tags, pills, score math, dates row, Apply hint and inline form", async () => {
  const { page, errors } = await openDemo({ ...PHONE });
  const bad: string[] = [];
  for (const tab of ["inbox", "pipeline"]) {
    await openTab(page, tab);
    const n = await page.locator("#view article.job").count();
    for (let i = 0; i < n; i++) {
      const m = await measure(page.locator("#view article.job").nth(i));
      const on = Object.entries(m.banned).filter(([, v]) => v).map(([k, v]) => `${k}${typeof v === "number" ? "=" + v : ""}`);
      if (on.length) bad.push(`${tab} card ${i + 1} '${m.text.split("\n")[1] || ""}': ${on.join(", ")}`);
    }
  }
  assert.ok(!/priority-demo/.test(await card(page, "card-hi").innerText().catch(() => "")), "card-hi's tag is not on the closed card");
  assert.deepEqual(bad, []);
  assert.deepEqual(errors, []);
  await page.close();
});

test("CARD-7 one reason line: the first sentence of the fit note, clamped to 2 lines on a phone and 1 at 1280", async () => {
  for (const [vp, clamp] of [[PHONE, "2"], [LAPTOP, "1"]] as const) {
    const { page, errors } = await openDemo({ ...vp });
    const exp = await expected(page);
    const bad: string[] = [];
    for (const id of ["card-hi", "card-lo", "card-cult", "greenhouse-1001", "greenhouse-1005", "lever-1004"]) {
      const m = await measure(card(page, id));
      const want = firstSentence(exp[id].fitNote);
      if (m.reasonCount !== 1) { bad.push(`${vp.width} ${id}: ${m.reasonCount} .reason elements`); continue; }
      if (m.reasonText !== want) bad.push(`${vp.width} ${id}: reason '${m.reasonText}', want '${want}'`);
      if (String(m.reasonClamp) !== clamp) bad.push(`${vp.width} ${id}: -webkit-line-clamp '${m.reasonClamp}', want ${clamp}`);
      if (m.reasonLines > Number(clamp)) bad.push(`${vp.width} ${id}: reason shows ${m.reasonLines} lines`);
      if (m.text.includes(exp[id].fitNote) && exp[id].fitNote !== want) bad.push(`${vp.width} ${id}: the full fit paragraph is still on the card`);
    }
    assert.deepEqual(bad, []);
    assert.deepEqual(errors, []);
    await page.close();
  }
});

test("CARD-8 on Needs action the reason line is the action reason (Follow-up due <date>)", async () => {
  const { page, errors } = await openDemo({ ...PHONE });
  await openTab(page, "action");
  const m = await measure(card(page, "greenhouse-1007"));
  assert.equal(m.reasonCount, 1, "one reason line");
  assert.match(m.reasonText, /^Follow-up due (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{1,2}$/);
  assert.equal(await card(page, "greenhouse-1007").locator(".why").count(), 0, "the old separate .why box is folded into .reason");
  assert.deepEqual(errors, []);
  await page.close();
});

test("CARD-9 one meta line: location · pay · one date for the status, no chips (UX-H-R10)", async () => {
  const { page, errors } = await openDemo({ ...LAPTOP });
  const bad: string[] = [];
  const check = async (id: string, label: RegExp) => {
    const m = await measure(card(page, id));
    if (m.metaCount !== 1) { bad.push(`${id}: ${m.metaCount} .meta lines`); return; }
    const dates = m.metaText.match(DATE) || [];
    if (dates.length !== 1) bad.push(`${id}: ${dates.length} dates in '${m.metaText}'`);
    if (!label.test(m.metaText)) bad.push(`${id}: '${m.metaText}' lacks ${label}`);
    if (m.metaLines > 1) bad.push(`${id}: meta wraps to ${m.metaLines} lines`);
    if (m.metaChips) bad.push(`${id}: ${m.metaChips} chips in the meta line`);
    if ((m.text.match(DATE) || []).length > 1) bad.push(`${id}: ${(m.text.match(DATE) || []).length} dates on the card`);
  };
  await check("card-hi", /Remote, US.*\$170K–\$200K.*Found /);
  await check("greenhouse-1001", /Found /);
  await check("card-cult", /(Viewed|Found) /);
  await openTab(page, "pipeline");
  await check("greenhouse-1007", /Applied /);
  await check("alert-northstar-sr-pm", /Applied /);
  assert.deepEqual(bad, []);
  assert.deepEqual(errors, []);
  await page.close();
});

test("CARD-10 the button row: one primary for the status, then Skip (Withdraw from Applied on), then Details", async () => {
  const { page, errors } = await openDemo({ ...LAPTOP });
  const bad: string[] = [];
  const row = async (id: string, primary: RegExp | null, skip: string | null) => {
    const m = await measure(card(page, id));
    const names = m.controls.map((c) => c.text).join(", ");
    const cta = m.controls.filter((c) => c.cta);
    if (primary ? cta.length !== 1 || !primary.test(cta[0].text) : cta.length !== 0) bad.push(`${id}: primaries [${cta.map((c) => c.text)}], want ${primary ?? "none"}`);
    const iP = m.controls.findIndex((c) => c.cta), iS = m.controls.findIndex((c) => c.quick === "skipped"), iD = m.controls.findIndex((c) => c.details);
    if (skip && (iS < 0 || m.controls[iS].text !== skip)) bad.push(`${id}: skip button reads '${iS < 0 ? "(none)" : m.controls[iS].text}', want '${skip}' [${names}]`);
    if (iD < 0) bad.push(`${id}: no Details button [${names}]`);
    else {
      if (!/Details/.test(m.controls[iD].text)) bad.push(`${id}: Details button reads '${m.controls[iD].text}'`);
      if (m.controls[iD].haspopup !== "dialog") bad.push(`${id}: Details has aria-haspopup='${m.controls[iD].haspopup}'`);
    }
    if (primary && iP >= 0 && skip && !(iP < iS)) bad.push(`${id}: primary is not before ${skip} [${names}]`);
    if (iS >= 0 && iD >= 0 && !(iS < iD)) bad.push(`${id}: ${skip} is not before Details [${names}]`);
    if (m.controls.length > 4) bad.push(`${id}: ${m.controls.length} buttons [${names}]`);
  };
  await row("greenhouse-1001", /^Apply$/, "Skip"); // new
  await row("lever-1004", /^Apply$/, "Skip"); // viewed
  await openTab(page, "pipeline");
  await row("manual-heliohome-sr-pm", /^I submitted it$/, "Skip"); // applying
  await row("greenhouse-1007", /^Follow-up sent$/, "Withdraw"); // applied, follow-up due
  await row("alert-northstar-sr-pm", null, "Withdraw"); // applied, follow-up not due
  await row("ashby-1008", null, "Withdraw"); // screen
  await row("greenhouse-1010", null, "Withdraw"); // interviewing
  assert.deepEqual(bad, []);
  assert.deepEqual(errors, []);
  await page.close();
});

test("CARD-11 Saved roles get Apply as the primary", async () => {
  const s = seedWithFixtures();
  s.jobs["card-saved"] = { company: "Savedline (demo)", title: "Senior PM, Saved", location: "Remote, US", status: "saved", statusAt: "@t-0", firstSeen: "@t-2", fit: "strong", source: "manual", fitNote: "Saved for later." };
  const { page, errors } = await openDemo({ ...LAPTOP, seed: s });
  await openTab(page, "pipeline");
  const m = await measure(card(page, "card-saved"));
  const cta = m.controls.filter((c) => c.cta);
  assert.deepEqual(cta.map((c) => c.text), ["Apply"]);
  assert.ok(cta[0].apply, "the primary is the Apply ([data-apply]) button");
  assert.equal(m.controls.find((c) => c.quick === "skipped")?.text, "Skip");
  assert.deepEqual(errors, []);
  await page.close();
});

// ── Preview only with a stored description (AC12, R7) ─────────────────────────────────────────────────────────
test("CARD-12 Preview shows only when a description is stored, and opens that stored text; no Open posting on the card", async () => {
  const { page, errors } = await openDemo({ ...LAPTOP });
  const has = async (id: string) => (await card(page, id).locator("button[data-preview]").count()) > 0;
  assert.ok(await has("card-hi"), "card-hi (descriptionPlain) has Preview");
  assert.ok(await has("card-cult"), "card-cult (descriptionHtml) has Preview");
  assert.ok(!(await has("card-lo")), "card-lo (no description) has no Preview");
  assert.ok(!(await has("greenhouse-1001")), "a demo role with no stored description has no Preview");
  for (const id of ["card-hi", "card-lo", "greenhouse-1001"]) {
    const n = await card(page, id).getByRole("link", { name: /Open posting/ }).count() + await card(page, id).getByRole("button", { name: /Open posting|Sample posting/ }).count();
    assert.equal(n, 0, `${id}: Open/Sample posting is on the closed card`);
  }
  await card(page, "card-hi").locator("button[data-preview]").click();
  await page.locator("#preview").waitFor({ state: "visible", timeout: 3000 });
  await page.waitForFunction(() => /own the storage roadmap/.test(document.querySelector("#preview")?.textContent || ""), null, { timeout: 3000 });
  await page.keyboard.press("Escape");
  await card(page, "card-cult").locator("button[data-preview]").click();
  await page.waitForFunction(() => /measures emissions for mid-size manufacturers/.test(document.querySelector("#preview")?.textContent || ""), null, { timeout: 3000 });
  assert.deepEqual(errors, []);
  await page.close();
});

// ── Status saves at once, with Undo (R4) ──────────────────────────────────────────────────────────────────────
test("CARD-13 the card's primary saves the status at once with the Undo toast; Undo puts it back", async () => {
  const { page, errors } = await openDemo({ ...LAPTOP });
  await openTab(page, "pipeline");
  await card(page, "manual-heliohome-sr-pm").locator(".btn.cta").click();
  await page.waitForFunction(() => jobs.find((j) => j._id === "manual-heliohome-sr-pm")?.status === "applied", null, { timeout: 3000 });
  assert.match(await toastText(page), /Moved to Applied/);
  await page.locator("#toast").getByRole("button", { name: "Undo" }).click();
  await page.waitForFunction(() => jobs.find((j) => j._id === "manual-heliohome-sr-pm")?.status === "applying", null, { timeout: 3000 });
  assert.deepEqual(errors, []);
  await page.close();
});

// ── Details sheet (R4, AC11) ──────────────────────────────────────────────────────────────────────────────────
const openDetails = async (page: Page, id: string) => {
  await card(page, id).locator(`button[data-details]`).click({ timeout: 3000 });
  const sheet = page.locator("#detailsSheet");
  await sheet.waitFor({ state: "visible", timeout: 3000 });
  return sheet;
};

test("CARD-14 Details is a dialog: a bottom sheet on a phone, a right-hand panel at 900px+", async () => {
  for (const vp of [PHONE, LAPTOP]) {
    const { page, errors } = await openDemo({ ...vp });
    const sheet = await openDetails(page, "card-hi");
    assert.equal(await sheet.getAttribute("role"), "dialog");
    assert.equal(await page.locator("#detailsSheet").count(), 1, "one Details sheet on the page");
    const b = (await sheet.boundingBox())!;
    if (vp === PHONE) {
      assert.ok(Math.abs(b.y + b.height - vp.height) <= 2, `phone: sheet bottom ${Math.round(b.y + b.height)} vs ${vp.height}`);
      assert.ok(b.x <= 1 && b.width >= vp.width - 2, `phone: sheet spans the width (${Math.round(b.x)}, ${Math.round(b.width)})`);
    } else {
      assert.ok(Math.abs(b.x + b.width - vp.width) <= 2, `laptop: sheet right edge ${Math.round(b.x + b.width)} vs ${vp.width}`);
      assert.ok(b.width < vp.width * 0.6 && b.x > 300, `laptop: sheet is a side panel (x ${Math.round(b.x)}, w ${Math.round(b.width)})`);
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), 0, "no sideways scroll");
    assert.deepEqual(errors, []);
    await page.close();
  }
});

test("CARD-15 Details holds Why this score, Status, dates, Lane, Tags, Referral, Follow up on, Next step, Notes, Open posting and the Apply hint", async () => {
  const { page, errors } = await openDemo({ ...LAPTOP });
  const exp = await expected(page);
  const sheet = await openDetails(page, "card-hi");
  const text = await sheet.innerText();
  assert.match(text, /Why this score/);
  assert.match(await sheet.locator(".fitr").innerText(), /Values[\s\S]*Culture/);
  assert.match(await sheet.locator(".why-score").innerText(), /45 sector/);
  assert.ok(text.includes(exp["card-hi"].fitNote), "the full fit paragraph");
  assert.equal(await sheet.getByLabel("Status", { exact: true }).inputValue(), "new");
  assert.match(text, /Found (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{1,2}/, "date history");
  assert.equal(await sheet.getByLabel(/^Lane/).inputValue(), "Geospatial / clean energy");
  assert.match(await sheet.getByLabel(/^Tags/).inputValue(), /priority-demo/);
  for (const l of [/^Referral/, /^Follow up on/, /^Next step/, /^Notes/]) assert.equal(await sheet.getByLabel(l).count(), 1, `field ${l}`);
  assert.equal(await sheet.getByRole("link", { name: /Open posting/ }).getAttribute("href"), "https://brightgrid.invalid/jobs/1");
  assert.match(text, /Copies an intake prompt for a new chat/);
  assert.deepEqual(errors, []);
  await page.close();
});

test("CARD-16 one Save: the sheet has exactly one submit button, named Save, and 'Save details' is gone from the page (UX-H-AC11)", async () => {
  const { page, errors } = await openDemo({ ...LAPTOP });
  const sheet = await openDetails(page, "card-hi");
  const submits = sheet.locator('button[type="submit"], input[type="submit"]');
  assert.equal(await submits.count(), 1);
  assert.equal((await submits.first().innerText()).trim(), "Save");
  for (const tab of ["inbox", "pipeline", "all"]) {
    await page.keyboard.press("Escape");
    await openTab(page, tab);
    assert.ok(!(await page.evaluate(() => document.body.innerHTML.includes("Save details"))), `${tab}: 'Save details' on the page`);
  }
  assert.deepEqual(errors, []);
  await page.close();
});

test("CARD-17 Save in the sheet stores the edits; the Status select saves on its own with Undo", async () => {
  const { page, errors } = await openDemo({ ...LAPTOP });
  let sheet = await openDetails(page, "card-hi");
  await sheet.getByLabel(/^Notes/).fill("Ask about the battery roadmap");
  await sheet.getByLabel(/^Next step/).fill("Read the posting tonight");
  await sheet.getByRole("button", { name: "Save", exact: true }).click();
  await page.waitForFunction(() => jobs.find((j) => j._id === "card-hi")?.notes === "Ask about the battery roadmap", null, { timeout: 3000 });
  assert.equal((await jobState(page, "card-hi"))!.nextStep, "Read the posting tonight");
  await page.locator("#detailsSheet").waitFor({ state: "hidden", timeout: 3000 });
  // Status: no Save press needed.
  sheet = await openDetails(page, "card-hi");
  await sheet.getByLabel("Status", { exact: true }).selectOption("saved");
  await page.waitForFunction(() => jobs.find((j) => j._id === "card-hi")?.status === "saved", null, { timeout: 3000 });
  assert.match(await toastText(page), /Moved to Saved/);
  await page.locator("#toast").getByRole("button", { name: "Undo" }).click();
  await page.waitForFunction(() => jobs.find((j) => j._id === "card-hi")?.status === "new", null, { timeout: 3000 });
  assert.deepEqual(errors, []);
  await page.close();
});

test("CARD-18 Escape discards the sheet's edits and puts focus back on the card's Details button", async () => {
  const { page, errors } = await openDemo({ ...PHONE });
  const sheet = await openDetails(page, "card-hi");
  await sheet.getByLabel(/^Notes/).fill("Unsaved draft");
  await page.keyboard.press("Escape");
  await page.locator("#detailsSheet").waitFor({ state: "hidden", timeout: 3000 });
  assert.notEqual((await jobState(page, "card-hi"))!.notes, "Unsaved draft");
  assert.ok(await page.evaluate(() => document.activeElement?.matches('#role-card-hi button[data-details]') ?? false), "focus is on card-hi's Details button");
  // Reopened, the draft is gone.
  const again = await openDetails(page, "card-hi");
  assert.equal(await again.getByLabel(/^Notes/).inputValue(), "");
  assert.deepEqual(errors, []);
  await page.close();
});

// ── First screen (AC13) ───────────────────────────────────────────────────────────────────────────────────────
test("CARD-19 on a phone the first New card and the digest both start above 844px (UX-H-AC13)", async () => {
  const { page, errors } = await openDemo({ ...PHONE });
  const tops = await page.evaluate(() => ({
    card: document.querySelector("#view article.job")?.getBoundingClientRect().top ?? 9999,
    digest: document.querySelector("#digestCard")?.getBoundingClientRect().top ?? 0,
  }));
  assert.ok(tops.card < 844, `first card starts at ${Math.round(tops.card)}px`);
  assert.ok(tops.digest < 844, `digest starts at ${Math.round(tops.digest)}px`);
  assert.deepEqual(errors, []);
  await page.close();
});
