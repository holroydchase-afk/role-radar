// HARDEN phase, round 5 (2026-10-28): core flows with no test yet, plus bad input and edge data
// (markup in text, very long text, blank input, missing scan fields, unicode, 0/100 scores, many roles).
// Each test is named RR-H-<n>. Demo data only: every company, role and person here is made up.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chromium } from "playwright";
import type { Browser, Page } from "playwright";
import { buildDemo } from "../scripts/build-demo.mjs";
import { openDemo as open, openTab } from "../scripts/browser.mjs";

import * as G from "../src/gmail-import.ts";
const read = (p: string) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const baseSeed = () => JSON.parse(read("demo/seed.json"), (k, v) => (typeof v === "string" && v.startsWith("@file:") ? read(v.slice(6)) : v));
const FILE = "dist/test-qa-tdd.html";
// RR-M4.4: Needs action and Progress folded into Home.
const TABS = ["home", "inbox", "pipeline", "ruled", "all", "people", "criteria", "watch", "filters"];

let browser: Browser;
before(async () => { browser = await chromium.launch(); });
after(async () => { await browser?.close(); });

// The base demo (meta: criteria, config, scan) with the given jobs/companies/recruiters.
const seedWith = (over: Record<string, any>) => ({ ...baseSeed(), ...over });
// RR-M4.4: Home is the default tab; these tests start on New unless they pass their own query.
const openSeed = (seed: Record<string, any>, opts: Parameters<typeof open>[1] = {}) => open(browser, { html: buildDemo({ seed }), file: FILE, ready: "#tab-inbox", query: "?tab=inbox", ...opts });
const toastShown = (page: Page) => page.evaluate(() => { const t = document.querySelector<HTMLElement>("#toast"); return t && !t.hidden ? t.textContent!.trim() : ""; });
const noJunkText = (s: string) => !/\bundefined\b|\bnull\b|\bNaN\b|Invalid Date|\[object Object\]/.test(s);

// ── Escaping: markup in any text field is shown as text, never run ───────────────────────────
const EVIL = `<img src=x onerror="window.__xss=1"><script>window.__xss=2<\/script>"'><b>bold</b>`;

test("RR-H-11 HTML and script in company, title, notes, skip notes, recruiters and watchlist render as text on every tab", async () => {
  const seed = seedWith({
    jobs: {
      e1: { company: "Evil Co (demo) " + EVIL, title: "Senior PM " + EVIL, status: "new", score: 80, fit: "strong", location: EVIL, comp: EVIL, sector: EVIL, lane: EVIL, tags: [EVIL], fitNote: EVIL, url: "https://example.com/evil", descriptionPlain: EVIL },
      e2: { company: "Evil Two (demo)", title: "Staff PM " + EVIL, status: "screen", nextStep: EVIL, notes: EVIL, referral: EVIL, emailNote: EVIL },
      e3: { company: "Evil Three (demo)", title: "PM " + EVIL, status: "skipped", skippedBy: "owner", skipReason: EVIL, skipNote: EVIL, skippedAt: new Date().toISOString() },
    },
    companies: { "greenhouse-evil": { name: "Evil Board (demo) " + EVIL, ats: "greenhouse", slug: "evil", industry: EVIL, status: "active", reviewNote: EVIL, via: EVIL } },
    recruiters: { r1: { name: "Evil Recruiter (demo) " + EVIL, company: EVIL, roles: EVIL, nextStep: EVIL, lastNote: EVIL, outcome: EVIL, type: "agency" } },
  });
  seed.meta.scan = { ...seed.meta.scan, note: EVIL };
  const { page, errors } = await openSeed(seed);
  for (const id of TABS) {
    await openTab(page, id);
    if (id === "people") { const b = page.locator("#recPrivacy"); if (await b.count()) await b.click(); }
  }
  await page.click("#tab-inbox");
  await page.locator("button[data-preview]").first().click();
  await page.waitForTimeout(300);
  await page.keyboard.press("Escape");
  // RR-M4.3: notes, referral, next step and the inbox note live in the Details sheet now.
  for (const id of ["e1", "e2"]) {
    await openTab(page, "all");
    await page.locator(`#role-${id} button[data-details]`).click();
    await page.locator("#detailsSheet").waitFor({ state: "visible" });
    assert.match(await page.locator("#detailsSheet").innerText(), /<img src=x onerror=/, `${id}: the sheet shows the markup as text`);
    await page.keyboard.press("Escape");
  }
  const out = await page.evaluate(() => ({ xss: window.__xss, imgs: document.querySelectorAll('img[src="x"]').length, bolds: [...document.querySelectorAll("b")].filter((b) => b.textContent === "bold").length }));
  assert.equal(out.xss, undefined, "no injected script ran");
  assert.equal(out.imgs, 0, "no injected <img> in the page");
  assert.equal(out.bolds, 0, "no injected <b> in the page");
  assert.match(await page.locator("#view").innerText(), /<img src=x onerror=/, "the markup is shown as text");
  assert.deepEqual(errors, []);
  await page.close();
});

// ── Very long text never makes a phone scroll sideways ───────────────────────────────────────
test("RR-H-12 very long unbroken titles, company names, notes and skip notes don't make the page scroll sideways at 390px", async () => {
  const long = (c: string, n: number) => c.repeat(n);
  const seed = seedWith({
    jobs: {
      l1: { company: "Longname" + long("x", 300) + " (demo)", title: "Senior" + long("A", 400), status: "new", score: 75, fitNote: long("n", 3000), location: long("L", 200), comp: "$" + long("9", 120), tags: [long("t", 150)] },
      l2: { company: "Long Pipe (demo)", title: "Staff" + long("B", 400), status: "screen", nextStep: long("s", 500), notes: long("q", 2000) },
      l3: { company: "Long Skip (demo)", title: "PM" + long("C", 400), status: "skipped", skippedBy: "owner", skipReason: "Other", skipNote: long("z", 300), skippedAt: new Date().toISOString() },
    },
  });
  const { page, errors } = await openSeed(seed, { width: 390, height: 844 });
  for (const id of ["home", "inbox", "pipeline", "ruled", "all"]) {
    if (id === "home") { await openTab(page, id); await page.locator("#moreStats summary").click(); }
    await openTab(page, id);
    const w = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
    assert.ok(w.s <= w.c + 1, `${id}: page is ${w.s}px wide in a ${w.c}px viewport`);
  }
  assert.deepEqual(errors, []);
  await page.close();
});

// ── Blank and junk input on the add forms ────────────────────────────────────────────────────
test("RR-H-13 Add role with whitespace-only company and title adds nothing and says what's missing", async () => {
  const { page, errors } = await openSeed(seedWith({}));
  await page.click("#tab-pipeline");
  const before = await page.locator("#view article.job").count();
  await page.locator("#addRole summary").click();
  await page.fill("#aj-co", "   ");
  await page.fill("#aj-ti", "   ");
  await page.locator("#addJob button[type=submit]").click();
  await page.waitForTimeout(400);
  assert.equal(await page.locator("#view article.job").count(), before, "no blank role added");
  const feedback = (await toastShown(page)) || (await page.evaluate(() => [...document.querySelectorAll<HTMLInputElement>("#addJob input")].some((i) => i.getAttribute("aria-invalid") === "true" || i.validationMessage)));
  assert.ok(feedback, "the person is told the company and title are needed, not left with a silent no-op");
  assert.deepEqual(errors, []);
  await page.close();
});

test("RR-H-14 Add a company with a whitespace-only name doesn't add a nameless company", async () => {
  const { page, errors } = await openSeed(seedWith({}));
  await openTab(page, "watch");
  const rowsBefore = await page.locator("#view .row").count();
  await page.fill("#coName", "   ");
  await page.selectOption("#coAts", "lever");
  await page.fill("#coSlug", "blank-name-demo");
  await page.locator("#addCo button[type=submit]").click();
  await page.waitForTimeout(400);
  const names = await page.locator("#view .row .nm").allInnerTexts();
  assert.equal(names.filter((n) => !n.trim()).length, 0, "no row with an empty name: " + JSON.stringify(names));
  assert.equal(await page.locator("#view .row").count(), rowsBefore, "nothing added");
  assert.deepEqual(errors, []);
  await page.close();
});

test("RR-H-15 Add a company with a slug of only symbols adds nothing and says why", async () => {
  const { page, errors } = await openSeed(seedWith({}));
  await openTab(page, "watch");
  const rowsBefore = await page.locator("#view .row").count();
  await page.fill("#coName", "Symbol Slug (demo)");
  await page.fill("#coSlug", "!!! ///");
  await page.locator("#addCo button[type=submit]").click();
  await page.waitForTimeout(400);
  assert.equal(await page.locator("#view .row").count(), rowsBefore, "nothing added");
  const feedback = (await toastShown(page)) || (await page.evaluate(() => { const i = document.querySelector<HTMLInputElement>("#coSlug")!; return i.getAttribute("aria-invalid") === "true" || !!i.validationMessage; }));
  assert.ok(feedback, "the person is told the slug isn't usable");
  assert.deepEqual(errors, []);
  await page.close();
});

// ── Scan docs with edge values ───────────────────────────────────────────────────────────────
// RR-M4.3: with criteria loaded the tile shows the computed score (tests/card.test.ts CARD-1/CARD-3). Without criteria it
// falls back to the score the scan stored, so this runs with no meta/criteria.
test("RR-H-16 scores of 0 and 100 both show and sort: 100 first, 0 above an unscored role", async () => {
  const jobs = {
    a: { company: "Zero Co (demo)", title: "PM Zero", status: "new", score: 0 },
    b: { company: "Top Co (demo)", title: "PM Hundred", status: "new", score: 100 },
    c: { company: "None Co (demo)", title: "PM Unscored", status: "new" },
    d: { company: "Mid Co (demo)", title: "PM Mid", status: "new", score: 55 },
  };
  const seed = seedWith({ jobs }); delete seed.meta.criteria;
  const { page, errors } = await openSeed(seed, { ready: "#view article.job" });
  const titles = await page.locator("#view article.job h2").allInnerTexts();
  assert.deepEqual(titles, ["PM Hundred", "PM Mid", "PM Zero", "PM Unscored"]);
  assert.deepEqual(await page.locator("#view article.job .score").allInnerTexts(), ["100", "55", "0"]);
  assert.deepEqual(errors, []);
  await page.close();
});

test("RR-H-17 a scan role with no url, comp, score, location or dates shows no 'undefined', 'null' or 'NaN', on the card or in Preview", async () => {
  const jobs = { bare: { company: "Bare Fields (demo)", title: "Senior PM, Bare", status: "new", descriptionPlain: "A bare description." }, b2: { company: "Bare Pipe (demo)", title: "PM, Bare Applied", status: "applied" } };
  const { page, errors } = await openSeed(seedWith({ jobs }));
  for (const id of ["home", "inbox", "pipeline", "all"]) {
    await openTab(page, id);
    if (id === "home") await page.locator("#moreStats summary").click();
    const t = await page.locator("#view").innerText();
    assert.ok(noJunkText(t), `${id} shows junk: ${t.match(/.{0,40}(undefined|null|NaN|Invalid Date).{0,40}/)?.[0]}`);
  }
  await page.click("#tab-inbox");
  assert.equal(await page.locator("#view article.job").getByRole("link", { name: /open posting/i }).count(), 0, "no dead posting link");
  await page.locator("button[data-preview]").first().click();
  await page.locator("#preview").waitFor({ state: "visible" });
  assert.ok(noJunkText(await page.locator("#preview").innerText()));
  await page.keyboard.press("Escape");
  for (const id of ["bare", "b2"]) {
    await openTab(page, "all");
    await page.locator(`#role-${id} button[data-details]`).click();
    await page.locator("#detailsSheet").waitFor({ state: "visible" });
    const t = await page.locator("#detailsSheet").innerText();
    assert.ok(noJunkText(t), `${id} Details shows junk: ${t.match(/.{0,40}(undefined|null|NaN|Invalid Date).{0,40}/)?.[0]}`);
    await page.keyboard.press("Escape");
  }
  assert.deepEqual(errors, []);
  await page.close();
});

test("RR-H-18 a scan role with no title or company still gets a readable heading", async () => {
  const jobs = { nt: { status: "new", score: 60, location: "Remote, US" }, ok: { company: "Has Name (demo)", title: "PM, Named", status: "new", score: 50 } };
  const { page, errors } = await openSeed(seedWith({ jobs }));
  const heads = await page.locator("#view article.job h2").allInnerTexts();
  assert.equal(heads.length, 2);
  assert.ok(heads.every((h) => h.trim()), "every card has a heading: " + JSON.stringify(heads));
  assert.deepEqual(errors, []);
  await page.close();
});

test("RR-H-19 a role with a status the page doesn't know isn't shown as New in its status menu", async () => {
  const jobs = { u: { company: "Odd Status (demo)", title: "PM, Archived", status: "archived", score: 70 } };
  const { page, errors } = await openSeed(seedWith({ jobs }));
  await page.click("#tab-all");
  await page.locator("#role-u button[data-details]").click();
  const sel = page.locator("#detailsSheet").getByLabel("Status", { exact: true });
  await sel.waitFor();
  const shown = await sel.evaluate((s: HTMLSelectElement) => s.options[s.selectedIndex]?.textContent || "");
  assert.notEqual(shown, "New", "the menu claims New for a role whose status is 'archived'");
  assert.deepEqual(errors, []);
  await page.close();
});

test("RR-H-20 unicode and symbols: accents, CJK and emoji render, and search finds them; regex characters don't break search", async () => {
  const jobs = {
    u1: { company: "ZÜRICH Grid (demo)", title: "Producto Sénior, Pagos", status: "new", score: 70 },
    u2: { company: "東京 Mobility (demo)", title: "シニアPM", status: "new", score: 65 },
    u3: { company: "Rocket 🚀 Labs (demo)", title: "Staff PM 🚀", status: "new", score: 60 },
  };
  const { page, errors } = await openSeed(seedWith({ jobs }));
  const cos = await page.locator("#view article.job .co").allInnerTexts();
  assert.deepEqual(cos.sort(), ["Rocket 🚀 Labs (demo)", "ZÜRICH Grid (demo)", "東京 Mobility (demo)"].sort());
  if (!(await page.locator("#q").isVisible())) await page.click("#ftoggle");
  for (const [q, n] of [["zürich", 1], ["東京", 1], ["🚀", 1], ["sénior", 1], ["c++ (.*", 0]] as [string, number][]) {
    await page.fill("#q", q);
    await page.waitForTimeout(150);
    assert.equal(await page.locator("#view article.job").count(), n, `search "${q}"`);
  }
  assert.match(await page.locator("#view").innerText(), /No roles match these filters/);
  assert.deepEqual(errors, []);
  await page.close();
});

test("RR-H-21 2,000 roles: the page opens, counts are right and tabs and search stay quick", async () => {
  const jobs: Record<string, object> = {};
  for (let i = 0; i < 2000; i++) {
    const status = i < 1000 ? "new" : i < 1500 ? "applied" : "skipped";
    jobs["bulk-" + i] = { company: `Bulk Co ${i} (demo)`, title: `Senior PM ${i}`, status, score: i % 101, location: "Remote, US", ...(status === "skipped" ? { skippedBy: "owner", skipReason: "Other", skipNote: "bulk" } : {}) };
  }
  const t0 = Date.now();
  const { page, errors } = await openSeed(seedWith({ jobs }));
  const openMs = Date.now() - t0;
  assert.match(await page.locator("#tab-inbox").innerText(), /1000/);
  assert.match(((await page.locator('#moreSheet [data-tab="ruled"]').textContent()) ?? ""), /500/);
  const t1 = Date.now();
  await page.click("#tab-all");
  await page.waitForFunction(() => document.querySelectorAll("#view article.job").length === 2000);
  const allMs = Date.now() - t1;
  await page.click("#tab-inbox");
  if (!(await page.locator("#q").isVisible())) await page.click("#ftoggle");
  // One keystroke: every key in the search box re-renders the list.
  const t2 = Date.now();
  await page.fill("#q", "B");
  await page.waitForFunction(() => document.querySelector<HTMLInputElement>("#q")?.value === "B" && document.querySelectorAll("#view article.job").length === 1000);
  const typeMs = Date.now() - t2;
  console.log(`# RR-H-21 open ${openMs}ms, All tab ${allMs}ms, one search keystroke ${typeMs}ms`);
  assert.ok(openMs < 8000, `opening took ${openMs}ms`);
  assert.ok(allMs < 2000, `All roles took ${allMs}ms`);
  assert.ok(typeMs < 500, `one search keystroke took ${typeMs}ms`);
  assert.deepEqual(errors, []);
  await page.close();
});

// ── Core flows with no test until now ────────────────────────────────────────────────────────
// RR-M4.3: the status menu and the detail fields moved from the card into the Details sheet (one Save).
const details = async (page: Page, id: string) => {
  await page.locator(`#role-${id} button[data-details]`).click({ timeout: 3000 });
  const sheet = page.locator("#detailsSheet"); await sheet.waitFor({ state: "visible", timeout: 3000 }); return sheet;
};
test("RR-H-22 status walk: Saved → Applying → 'I submitted it' sets Applied and a follow-up date; Screen asks for a next step until one is saved", async () => {
  const jobs = { w: { company: "Walkthrough Co (demo)", title: "Senior PM, Walk", status: "saved", statusAt: new Date().toISOString(), score: 80 } };
  const { page, errors } = await openSeed(seedWith({ jobs }));
  await page.click("#tab-pipeline");
  await (await details(page, "w")).getByLabel("Status", { exact: true }).selectOption("applying");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "I submitted it" }).click({ timeout: 3000 });
  const card = page.locator("#view article.job").filter({ hasText: "Senior PM, Walk" });
  await card.locator(".meta", { hasText: "Applied" }).waitFor({ timeout: 3000 });
  let sheet = await details(page, "w");
  assert.equal(await sheet.getByLabel("Status", { exact: true }).inputValue(), "applied");
  const dates = await sheet.locator(".dates").innerText();
  assert.match(dates, /Applied/);
  assert.match(dates, /Follow up/);
  await sheet.getByLabel("Status", { exact: true }).selectOption("screen");
  await page.keyboard.press("Escape");
  // RR-M4.4: Needs action became Home's Get ready: "Add next step · <Company>" with an Add step button.
  await openTab(page, "home");
  const row = page.locator('#home-ready [data-ready="nextstep"]', { hasText: "Add next step · Walkthrough Co (demo)" });
  await row.waitFor({ timeout: 3000 });
  await row.getByRole("button", { name: "Add step" }).click();
  sheet = page.locator("#detailsSheet"); await sheet.waitFor({ state: "visible", timeout: 3000 });
  await page.fill("#nx-w", "Recruiter screen Thursday");
  await sheet.getByRole("button", { name: "Save", exact: true }).click();
  await row.waitFor({ state: "detached", timeout: 3000 });
  await page.click("#tab-pipeline");
  assert.equal(await (await details(page, "w")).getByLabel(/^Next step/).inputValue(), "Recruiter screen Thursday");
  assert.deepEqual(errors, []);
  await page.close();
});

test("RR-H-23 Save in Details stores the tags trimmed of blanks and ignores a whitespace-only next step", async () => {
  const jobs = { d: { company: "Details Co (demo)", title: "PM, Details", status: "saved", statusAt: new Date().toISOString() } };
  const { page, errors } = await openSeed(seedWith({ jobs }));
  await page.click("#tab-pipeline");
  const sheet = await details(page, "d");
  await page.fill("#tg-d", " , ,priority ,,  referral ,");
  await page.fill("#nx-d", "    ");
  await sheet.getByRole("button", { name: "Save", exact: true }).click();
  await page.waitForFunction("jobs.find((j) => j._id === 'd')?.tags?.length > 0", null, { timeout: 3000 });
  const again = await details(page, "d");
  assert.equal(await again.getByLabel(/^Tags/).inputValue(), "priority, referral");
  assert.equal(await again.getByLabel(/^Next step/).inputValue(), "");
  assert.deepEqual(errors, []);
  await page.close();
});

test("RR-H-24 Never show moves a company to the Never show list and Restore brings it back", async () => {
  const { page, errors } = await openSeed(seedWith({}));
  await openTab(page, "watch");
  const count = async () => parseInt((await page.locator('#moreSheet [data-tab="watch"] .n').textContent()) ?? "", 10);
  const n0 = await count();
  const row = () => page.locator("#view .row").filter({ hasText: "Sunfield Energy" });
  await row().getByRole("button", { name: "Never show" }).click();
  await row().getByRole("button", { name: "Restore" }).waitFor({ timeout: 3000 });
  assert.equal(await count(), n0 - 1);
  await row().getByRole("button", { name: "Restore" }).click();
  await row().getByRole("button", { name: "Never show" }).waitFor({ timeout: 3000 });
  assert.equal(await count(), n0);
  assert.deepEqual(errors, []);
  await page.close();
});

test("RR-H-25 Scan rules: zero, words and negative numbers for the follow-up and stale days never save as 0 or blank", async () => {
  const { page, errors } = await openSeed(seedWith({}));
  await openTab(page, "filters");
  await page.fill("#cFu", "0");
  await page.fill("#cStale", "abc");
  await page.fill("#cSaved", "  ");
  await page.locator("#cfgForm button[type=submit]").click();
  await page.waitForFunction(() => /Settings saved/.test(document.querySelector("#toast")?.textContent || ""), null, { timeout: 3000 });
  await page.click("#tab-all"); // re-read what was saved (RR-H-23: the open form isn't redrawn after a save)
  await openTab(page, "filters");
  for (const id of ["#cFu", "#cStale", "#cSaved"]) {
    const v = Number(await page.locator(id).inputValue());
    assert.ok(Number.isInteger(v) && v > 0, `${id} is ${v}`);
  }
  assert.deepEqual(errors, []);
  await page.close();
});

test("RR-H-26 a new user's criteria that are a plain word or a list are refused with a message; nothing saves", async () => {
  const seed = seedWith({ jobs: {} });
  delete seed.meta.criteria;
  for (const bad of ["hello", "- a\n- b", "   "]) {
    const { page, errors } = await openSeed(seed);
    await openTab(page, "criteria");
    await page.fill("#critText", bad);
    await page.getByRole("button", { name: /save criteria/i }).click();
    const shown = await page.locator("#critErr").waitFor({ timeout: 3000 }).then(() => true, () => false);
    assert.ok(shown, `no error shown for ${JSON.stringify(bad)}; the toast says: ${await page.locator("#toast").textContent()}`);
    assert.match(await page.locator("#critErr").innerText(), /YAML|map|empty/i, `for ${JSON.stringify(bad)}`);
    await page.click("#tab-inbox");
    assert.match(await page.locator("#view").innerText(), /Set your criteria first/, "still no criteria saved");
    assert.deepEqual(errors, []);
    await page.close();
  }
});

test("RR-H-27 Home (with More stats open) copes with junk dates and fields: no NaN, no errors", async () => {
  const jobs = {
    p1: { company: "Junk Dates (demo)", title: "PM 1", status: "applied", appliedAt: "not a date", followUpDue: "soon", statusHistory: "applied", followUpsSent: "x" },
    p2: { company: "Junk Two (demo)", title: "PM 2", status: "screen", statusHistory: [{ status: "screen" }, null, 5], statusAt: 12345 },
    p3: { company: "Junk Three (demo)", title: "PM 3", status: "skipped", skippedAt: "yesterday", skippedBy: "owner" },
  };
  const { page, errors } = await openSeed(seedWith({ jobs }));
  for (const id of ["home", "ruled", "pipeline"]) {
    await openTab(page, id);
    if (id === "home") await page.locator("#moreStats summary").click();
    const t = await page.locator("#view").innerText();
    assert.ok(noJunkText(t), `${id}: ${t.match(/.{0,40}(undefined|null|NaN|Invalid Date).{0,40}/)?.[0]}`);
  }
  assert.deepEqual(errors, []);
  await page.close();
});

// ── Gmail (owner only) with broken connector payloads ────────────────────────────────────────
test("RR-H-28 Gmail import and status check survive malformed threads: no throw, nothing suggested from junk", () => {
  const junk = [null, 5, "x", {}, { messages: null }, { messages: [null, {}, { sender: null, date: "garbage" }, { sender: 42, subject: null, snippet: undefined }] }, { id: "t", messageCount: "many", messages: [{ sender: "", date: "", labelIds: "INBOX" }] }];
  assert.deepEqual(G.candidates(junk), []);
  assert.deepEqual(G.candidates(null), []);
  assert.deepEqual(G.threadsFrom("not json"), []);
  const jobs = [{ _id: "j", company: "", title: "PM", status: "applied" }, { _id: "k", status: "applied" }, null];
  assert.deepEqual(G.statusUpdates(junk, jobs), []);
  assert.deepEqual(G.statusUpdates(junk, {}), []);
});
