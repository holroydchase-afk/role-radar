// RR-SET: Search settings card on the Criteria tab (docs/settings.md, SET-1..11; SET-8 is in skip-feedback.test.ts,
// SET-12 is manual). Written red first, before the card exists. Demo data only: the criteria are the repo's example
// criteria.yaml (a made-up demo candidate).
//
// DOM contract the engineer builds to (pinned by these tests):
// - Card: `#settings`, an h2 "Search settings", in place of "At a glance". Scoring, Fit ratings and Alerts cards stay.
// - Base pay: a `.range2` component in #settings with two `[role=slider]` handles `#set-pay-lo` (comp.base_floor_usd)
//   and `#set-pay-hi` (comp.stretch_target_usd): aria-valuemin 100000, aria-valuemax 400000, aria-valuenow in
//   dollars, aria-valuetext like "$150K", $5K steps (arrows ±$5K, Page Up/Down ±$25K, Home/End), low stays at least
//   $5K under high. Number boxes `#set-pay-min` and `#set-pay-max` show the same values in dollars and clamp on blur.
// - `#set-prio`: Priority-sector floor (comp.priority_sector_floor_usd), a single slider (input type=range is fine).
// - Level chips: `button[data-level=<id>][aria-pressed]` for mid, senior, staff, principal, lead, in that order.
// - Sectors: `[role=radiogroup][data-sector=<id>]` per sector, radios value 0-3 named Off / Allowed / Good / Priority.
// - `#set-home` select (US state codes), `#set-minscore` range 0-100 step 5, `#set-digest` range 1-20.
// - A control whose key is missing is disabled ("Not in your criteria yet. Add it under Advanced."); while the text
//   doesn't parse every control is disabled ("Fix the text below first.").
// - Unsaved bar `#unsavedBar` ("Unsaved changes", sticky) with `#setSave` and `#setDiscard`.
// - The YAML editor stays below under the heading "Advanced: edit as text", around the existing `#critText`.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chromium } from "playwright";
import type { Browser, Page } from "playwright";
import { buildDemo } from "../scripts/build-demo.mjs";
import { openDemo as open } from "../scripts/browser.mjs";

const read = (p: string) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const SPEC = read("criteria.yaml");
const baseSeed = () => JSON.parse(read("demo/seed.json"), (k, v) => (typeof v === "string" && v.startsWith("@file:") ? read(v.slice(6)) : v));
const FILE = "dist/test-settings.html";
const PHONE = { width: 390, height: 844 };

let browser: Browser;
before(async () => { browser = await chromium.launch(); });
after(async () => { await browser?.close(); });

/** Opens the demo on the Criteria tab, optionally with another saved criteria text. */
async function openCriteria(spec?: string, opts: Parameters<typeof open>[1] = {}) {
  const seed = baseSeed();
  if (spec !== undefined) seed.meta.criteria.spec = spec;
  return open(browser, { html: buildDemo({ seed }), file: FILE, ready: "#critText", query: "?tab=criteria", ...opts });
}
/** Fails fast, with a plain message, while the card doesn't exist yet. */
async function card(page: Page) {
  assert.equal(await page.locator("#settings").count(), 1, "the Search settings card (#settings) is on the Criteria tab");
  return page.locator("#settings");
}
const draft = (page: Page) => page.locator("#critText").inputValue();
/** A slider's value: aria-valuenow for a custom slider, .value for input type=range. */
const valueOf = (page: Page, sel: string) => page.locator(sel).evaluate((el) => Number(el.getAttribute("aria-valuenow") ?? (el as HTMLInputElement).value));
const isOff = (page: Page, sel: string) => page.locator(sel).first().evaluate((el) => (el as HTMLInputElement).disabled === true || el.getAttribute("aria-disabled") === "true");
/** Polls fn until ok(value) or the timeout, then returns the last value (the caller asserts on it). */
async function until<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 2000): Promise<T> {
  const end = Date.now() + ms;
  let v = await fn();
  while (!ok(v) && Date.now() < end) { await new Promise((r) => setTimeout(r, 50)); v = await fn(); }
  return v;
}
const draftWhen = (page: Page, re: RegExp) => until(() => draft(page), (t) => re.test(t));
/** Lines that differ between two texts with the same line count, as [index, new line]. */
function changed(a: string, b: string): [number, string][] {
  const A = a.split("\n"), B = b.split("\n");
  assert.equal(B.length, A.length, "the edit keeps the line count");
  return A.flatMap((l, i) => (l !== B[i] ? [[i, B[i]] as [number, string]] : []));
}
/** Counts database writes from now on (the mock's db object is shared, and the page calls db.doc(path) per write). */
const countWrites = (page: Page) => page.evaluate(async () => {
  const db = (await window.claude.use("db")) as any, orig = db.doc.bind(db), w = window as any;
  w.__writes = [];
  db.doc = (p: string) => { const d = orig(p); for (const m of ["set", "update", "delete"]) { const f = d[m]; d[m] = (...a: unknown[]) => { w.__writes.push(m + " " + p); return f.apply(d, a); }; } return d; };
});
const writes = (page: Page) => page.evaluate(() => ((window as any).__writes || []) as string[]);
const savedSpec = (page: Page) => page.evaluate(() => new Promise<string>(async (ok) => (await window.claude.use("db")).doc("meta/criteria").onSnapshot((s) => ok(String(s.data()?.spec ?? "")))));

test("SET-1 a Search settings card replaces At a glance; the text editor sits below under Advanced; Scoring, Fit ratings and Alerts stay", async () => {
  const { page, errors } = await openCriteria();
  const c = await card(page);
  assert.equal((await c.locator("h2").first().innerText()).trim(), "Search settings");
  const heads = (await page.locator("#view h2").allInnerTexts()).map((s) => s.trim());
  assert.ok(!heads.includes("At a glance"), "At a glance is gone");
  for (const h of ["Scoring", "Fit ratings", "Alerts"]) assert.ok(heads.includes(h), `${h} card is unchanged`);
  const adv = page.locator("#view").getByText("Advanced: edit as text", { exact: true });
  assert.equal(await adv.count(), 1, 'one "Advanced: edit as text" heading');
  // Order on the page: settings card, then the Advanced heading, then the editor.
  const order = await page.evaluate(() => {
    const s = document.querySelector("#settings")!, t = document.querySelector("#critText")!;
    const a = [...document.querySelectorAll("#view *")].find((e) => e.children.length === 0 && e.textContent!.trim() === "Advanced: edit as text")!;
    const before = (x: Element, y: Element) => !!(x.compareDocumentPosition(y) & Node.DOCUMENT_POSITION_FOLLOWING);
    return { settingsFirst: before(s, a), headingBeforeEditor: before(a, t) };
  });
  assert.deepEqual(order, { settingsFirst: true, headingBeforeEditor: true });
  assert.deepEqual(errors, []);
  await page.close();
});

test("SET-2 Base pay is a two-handle slider ($100K-$400K) at $150K and $185K, with Min and Max boxes showing the same", async () => {
  const { page, errors } = await openCriteria();
  const c = await card(page);
  assert.match(await c.innerText(), /Base pay/);
  assert.equal(await c.locator(".range2 [role=slider]").count(), 2, "two handles in one .range2");
  for (const [sel, now, txt] of [["#set-pay-lo", "150000", "$150K"], ["#set-pay-hi", "185000", "$185K"]]) {
    const h = page.locator(sel);
    assert.equal(await h.getAttribute("role"), "slider", `${sel} is role=slider`);
    assert.equal(await h.getAttribute("aria-valuemin"), "100000");
    assert.equal(await h.getAttribute("aria-valuemax"), "400000");
    assert.equal(await h.getAttribute("aria-valuenow"), now);
    assert.equal(await h.getAttribute("aria-valuetext"), txt);
    assert.ok(await h.evaluate((el) => !!(el.getAttribute("aria-label") || el.getAttribute("aria-labelledby"))), `${sel} has a name`);
  }
  assert.equal(Number(await page.locator("#set-pay-min").inputValue()), 150000);
  assert.equal(Number(await page.locator("#set-pay-max").inputValue()), 185000);
  assert.deepEqual(errors, []);
  await page.close();
});

test("SET-3 pay handles move by key and drag, match the number boxes, never cross, and typed values clamp on blur", async () => {
  const { page, errors } = await openCriteria();
  await card(page);
  const lo = page.locator("#set-pay-lo"), hi = page.locator("#set-pay-hi");
  await lo.focus();
  await page.keyboard.press("ArrowRight");
  assert.equal(await valueOf(page, "#set-pay-lo"), 155000, "arrow = +$5K");
  assert.equal(await lo.getAttribute("aria-valuetext"), "$155K");
  assert.equal(Number(await page.locator("#set-pay-min").inputValue()), 155000, "the Min box follows the handle");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("PageUp");
  assert.equal(await valueOf(page, "#set-pay-lo"), 175000, "Page Up = +$25K");
  const HI = 185000, GAP = 5000; // demo stretch target; handles keep a $5K gap
  await page.keyboard.press("PageUp");
  assert.equal(await valueOf(page, "#set-pay-lo"), HI - GAP, "Page Up stops $5K under high");
  await page.keyboard.press("ArrowRight");
  assert.equal(await valueOf(page, "#set-pay-lo"), HI - GAP, "low never reaches high");
  await page.keyboard.press("Home");
  assert.equal(await valueOf(page, "#set-pay-lo"), 100000, "Home = range minimum");
  await hi.focus();
  await page.keyboard.press("End");
  assert.equal(await valueOf(page, "#set-pay-hi"), 400000, "End = range maximum");
  await page.keyboard.press("PageDown");
  assert.equal(await valueOf(page, "#set-pay-hi"), 375000, "Page Down = -$25K");
  assert.equal(Number(await page.locator("#set-pay-max").inputValue()), 375000);
  // The draft follows: the floor and stretch lines change, their comments stay.
  const t = await draftWhen(page, /stretch_target_usd: 375000/);
  assert.match(t, /^ {2}base_floor_usd: 100000 +# skip if the stated base range tops out below this$/m);
  assert.match(t, /^ {2}stretch_target_usd: 375000 +# \+10 score when the range reaches this$/m);
  // A number box moves its handle; a typed value outside the range clamps on blur.
  await page.locator("#set-pay-min").fill("200000");
  await page.locator("#set-pay-min").blur();
  assert.equal(await valueOf(page, "#set-pay-lo"), 200000, "typing in Min moves the low handle");
  await page.locator("#set-pay-max").fill("999999");
  await page.locator("#set-pay-max").blur();
  assert.equal(Number(await page.locator("#set-pay-max").inputValue()), 400000, "Max clamps to $400K on blur");
  assert.equal(await valueOf(page, "#set-pay-hi"), 400000);
  await page.locator("#set-pay-min").fill("12");
  await page.locator("#set-pay-min").blur();
  assert.equal(Number(await page.locator("#set-pay-min").inputValue()), 100000, "Min clamps to $100K on blur");
  // Drag: pull each handle past the other; they stop $5K apart, on a $5K step.
  const track = (await page.locator("#settings .range2").first().boundingBox())!;
  const drag = async (sel: string, x: number) => {
    const b = (await page.locator(sel).boundingBox())!;
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(x, b.y + b.height / 2, { steps: 8 });
    await page.mouse.up();
  };
  await drag("#set-pay-lo", track.x + track.width * 0.5);
  const midLo = await valueOf(page, "#set-pay-lo");
  assert.ok(midLo > 200000 && midLo < 300000 && midLo % 5000 === 0, `dragging low to mid-track lands on a $5K step near $250K (got ${midLo})`);
  await drag("#set-pay-hi", track.x + 2);
  const [l, h] = [await valueOf(page, "#set-pay-lo"), await valueOf(page, "#set-pay-hi")];
  assert.equal(h - l, 5000, `dragging high past low stops $5K above it (low ${l}, high ${h})`);
  assert.deepEqual(errors, []);
  await page.close();
});

test("SET-4 the Priority-sector floor clamps to the base floor, and lowering the base floor moves both lines", async () => {
  const { page, errors } = await openCriteria();
  await card(page);
  assert.equal(await valueOf(page, "#set-prio"), 140000);
  await page.locator("#set-prio").focus();
  await page.keyboard.press("End");
  assert.equal(await valueOf(page, "#set-prio"), 150000, "can't go above the $150K base floor");
  let t = await draftWhen(page, /priority_sector_floor_usd: 150000/);
  assert.match(t, /^ {2}priority_sector_floor_usd: 150000 +# weight-3 sectors may dip to here/m);
  await page.locator("#set-pay-lo").focus();
  await page.keyboard.press("Home");
  assert.equal(await valueOf(page, "#set-prio"), 100000, "dropping the base floor pulls the priority floor down with it");
  t = await draftWhen(page, /priority_sector_floor_usd: 100000/);
  assert.match(t, /^ {2}base_floor_usd: 100000 /m);
  assert.match(t, /^ {2}priority_sector_floor_usd: 100000 /m);
  assert.deepEqual(errors, []);
  await page.close();
});

test("SET-5 level chips rewrite role.levels as a flow list in the order shown, and the last level can't be turned off", async () => {
  const { page, errors } = await openCriteria();
  const c = await card(page);
  const chips = c.locator("button[data-level]");
  assert.deepEqual(await chips.evaluateAll((bs) => bs.map((b) => (b as HTMLElement).dataset.level)), ["mid", "senior", "staff", "principal", "lead"]);
  assert.deepEqual(await chips.evaluateAll((bs) => bs.map((b) => b.getAttribute("aria-pressed"))), ["false", "true", "true", "true", "true"]);
  const chip = (id: string) => c.locator(`button[data-level=${id}]`);
  await chip("mid").click();
  assert.equal(await chip("mid").getAttribute("aria-pressed"), "true");
  assert.match(await draftWhen(page, /levels: \[mid,/), /^ {2}levels: \[mid, senior, staff, principal, lead\]$/m);
  await chip("staff").click();
  assert.match(await draftWhen(page, /levels: \[mid, senior, principal/), /^ {2}levels: \[mid, senior, principal, lead\]$/m);
  for (const id of ["mid", "senior", "principal"]) await chip(id).click();
  assert.match(await draftWhen(page, /levels: \[lead\]/), /^ {2}levels: \[lead\]$/m);
  await chip("lead").click();
  assert.equal(await chip("lead").getAttribute("aria-pressed"), "true", "the last level stays on");
  assert.match(await c.innerText(), /Keep at least one level\./);
  assert.match(await draft(page), /^ {2}levels: \[lead\]$/m, "the draft keeps one level");
  assert.deepEqual(errors, []);
  await page.close();
});

test("SET-6 each sector's Off / Allowed / Good / Priority control changes only that sector's weight line", async () => {
  const { page, errors } = await openCriteria();
  const c = await card(page);
  const ids = ["solar_energy", "climate_tech", "climate_nonprofit", "space_geo", "outdoor_brands", "green_finance", "big_corp", "fintech"];
  for (const id of ids) assert.equal(await c.locator(`[role=radiogroup][data-sector=${id}]`).count(), 1, `a control for ${id}`);
  const fin = c.locator("[role=radiogroup][data-sector=fintech]");
  assert.deepEqual(await fin.getByRole("radio").evaluateAll((rs) => rs.map((r) => r.getAttribute("value") ?? (r as HTMLElement).dataset.value)), ["0", "1", "2", "3"]);
  for (const name of ["Off", "Allowed", "Good", "Priority"]) assert.equal(await fin.getByRole("radio", { name, exact: true }).count(), 1, `fintech has ${name}`);
  assert.ok(await fin.getByRole("radio", { name: "Allowed", exact: true }).isChecked(), "fintech starts at weight 1");
  await fin.getByRole("radio", { name: "Good", exact: true }).check();
  const t = await draftWhen(page, /weight: 2 +# still allowed/);
  assert.deepEqual(changed(SPEC, t), [[SPEC.split("\n").findIndex((l) => /# still allowed, just lower in the list/.test(l)), "    weight: 2                          # still allowed, just lower in the list"]]);
  assert.deepEqual(errors, []);
  await page.close();
});

test("SET-7 Home state, Min score to add and Digest size write work.home_state, scoring.min_score_to_add and scoring.digest_max_items", async () => {
  const { page, errors } = await openCriteria();
  await card(page);
  const home = page.locator("#set-home");
  assert.equal(await home.evaluate((s) => s.tagName), "SELECT");
  const codes = await home.locator("option").evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value).filter(Boolean));
  assert.ok(codes.length >= 50 && codes.includes("CO") && codes.includes("UT"), `US state codes (${codes.length})`);
  assert.equal(await home.inputValue(), "CO");
  await home.selectOption("UT");
  assert.match(await draftWhen(page, /home_state: UT/), /^ {2}home_state: UT +# reject state lists that leave out CO$/m);
  const ms = page.locator("#set-minscore"), dg = page.locator("#set-digest");
  assert.deepEqual(await ms.evaluate((el) => [el.getAttribute("min"), el.getAttribute("max"), el.getAttribute("step")]), ["0", "100", "5"]);
  assert.deepEqual(await dg.evaluate((el) => [el.getAttribute("min"), el.getAttribute("max")]), ["1", "20"]);
  assert.equal(await valueOf(page, "#set-minscore"), 45);
  assert.equal(await valueOf(page, "#set-digest"), 8);
  await ms.focus();
  await page.keyboard.press("ArrowRight");
  assert.match(await draftWhen(page, /min_score_to_add: 50/), /^ {2}min_score_to_add: 50$/m);
  await dg.focus();
  await page.keyboard.press("ArrowLeft");
  assert.match(await draftWhen(page, /digest_max_items: 7/), /^ {2}digest_max_items: 7$/m);
  assert.deepEqual(errors, []);
  await page.close();
});

test("SET-9 a setting whose key is missing from the YAML is disabled with a pointer to Advanced, and the draft is untouched", async () => {
  const spec = SPEC.split("\n").filter((l) => !/^\s*(digest_max_items|home_state):/.test(l)).join("\n");
  const { page, errors } = await openCriteria(spec);
  const c = await card(page);
  assert.equal(await isOff(page, "#set-digest"), true, "Digest size is disabled");
  assert.equal(await isOff(page, "#set-home"), true, "Home state is disabled");
  assert.equal(await isOff(page, "#set-minscore"), false, "Min score to add (present) still works");
  assert.equal((await c.innerText()).split("Not in your criteria yet. Add it under Advanced.").length - 1, 2, "one note per missing setting");
  await page.locator("#set-digest").focus().catch(() => {});
  await page.keyboard.press("ArrowRight");
  assert.equal(await draft(page), spec, "the draft is untouched");
  assert.equal(await page.locator("#unsavedBar").isVisible(), false, "nothing to save");
  assert.deepEqual(errors, []);
  await page.close();
});

test("SET-10 editing the text updates the controls; text that doesn't parse disables every control", async () => {
  const { page, errors } = await openCriteria();
  await card(page);
  await page.locator("#critText").fill(SPEC.replace("base_floor_usd: 150000", "base_floor_usd: 160000"));
  assert.equal(await until(() => valueOf(page, "#set-pay-lo"), (v) => v === 160000), 160000, "the low handle follows the text");
  assert.equal(Number(await page.locator("#set-pay-min").inputValue()), 160000);
  await page.locator("#critText").fill(SPEC + "\nrole: [unclosed\n");
  const all = ["#set-pay-lo", "#set-pay-hi", "#set-pay-min", "#set-pay-max", "#set-prio", "#settings button[data-level]", "#settings [data-sector] [role=radio]", "#set-home", "#set-minscore", "#set-digest"];
  const off = await until(() => Promise.all(all.map((s) => isOff(page, s))), (v) => v.every(Boolean));
  assert.deepEqual(Object.fromEntries(all.map((s, i) => [s, off[i]])), Object.fromEntries(all.map((s) => [s, true])));
  assert.match(await page.locator("#settings").innerText(), /Fix the text below first\./);
  assert.deepEqual(errors, []);
  await page.close();
});

test("SET-11 a control change goes to the draft with a sticky Unsaved bar and no database write; Discard restores; Save saves", async () => {
  const { page, errors } = await openCriteria(undefined, PHONE);
  const c = await card(page);
  assert.equal(await page.locator("#unsavedBar").isVisible(), false, "no bar before a change");
  const preview = await page.locator("#digestPreview").innerText();
  await countWrites(page);
  const solar = c.locator("[role=radiogroup][data-sector=solar_energy]");
  await solar.getByRole("radio", { name: "Off", exact: true }).check();
  const t = await draftWhen(page, /- id: solar_energy\n.*\n {4}weight: 0/);
  assert.match(t, /- id: solar_energy\n.*\n {4}weight: 0\n/, "critDraft (shown in the editor) holds the edit");
  assert.notEqual(await until(() => page.locator("#digestPreview").innerText(), (v) => v !== preview), preview, "the digest preview re-ranks");
  const bar = page.locator("#unsavedBar");
  assert.ok(await bar.isVisible(), "the Unsaved bar shows");
  assert.match(await bar.innerText(), /Unsaved changes/);
  assert.match(await page.locator("#setSave").innerText(), /Save/);
  assert.match(await page.locator("#setDiscard").innerText(), /Discard/);
  assert.ok(["sticky", "fixed"].includes(await bar.evaluate((el) => getComputedStyle(el).position)), "the bar sticks");
  assert.deepEqual(await writes(page), [], "no database write before Save");
  assert.equal(await savedSpec(page), SPEC);
  await page.click("#setDiscard");
  assert.equal(await until(() => bar.isVisible(), (v) => !v), false, "Discard hides the bar");
  assert.equal(await draft(page), SPEC, "Discard restores the saved text");
  assert.ok(await c.locator("[role=radiogroup][data-sector=solar_energy]").getByRole("radio", { name: "Priority", exact: true }).isChecked(), "and the saved value");
  assert.deepEqual(await writes(page), [], "Discard writes nothing");
  await c.locator("button[data-level=mid]").click();
  await page.click("#setSave");
  const saved = await until(() => savedSpec(page), (s) => s !== SPEC);
  assert.match(saved, /^ {2}levels: \[mid, senior, staff, principal, lead\]$/m, "Save writes the draft");
  assert.deepEqual(await writes(page), ["set meta/criteria"], "one write, through the existing save");
  assert.equal(await until(() => bar.isVisible(), (v) => !v), false, "the bar hides after Save");
  assert.match(await page.locator("#toast").innerText(), /Criteria saved/);
  assert.deepEqual(errors, []);
  await page.close();
});
