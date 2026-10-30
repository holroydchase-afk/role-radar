// Browser tests: the real page on demo data, in headless Chromium.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chromium } from "playwright";
import type { Browser } from "playwright";
import { buildDemo } from "../scripts/build-demo.mjs";
import { openDemo as open } from "../scripts/browser.mjs";

let browser: Browser;
const openDemo = (opts = {}) => open(browser, { ...opts, file: "dist/test-demo.html" });

before(async () => { browser = await chromium.launch(); });
after(async () => { await browser?.close(); });

test("every tab renders on demo data without errors", async () => {
  const { page, errors } = await openDemo();
  for (const id of ["inbox", "pipeline", "action", "all", "people", "criteria", "watch", "filters"]) {
    await page.click(`#tab-${id}`);
    assert.ok((await page.locator("#view").innerText()).trim().length > 0, id);
  }
  assert.deepEqual(errors, []);
  await page.close();
});

test("demo pages say they are demo data", async () => {
  const { page } = await openDemo();
  assert.ok(await page.locator("#demoNote").isVisible());
  await page.close();
});

test("the filter bar keeps its styles (stray <style> tag fixed)", async () => {
  const { page } = await openDemo();
  await page.click("#tab-inbox");
  const bg = await page.evaluate(() => getComputedStyle(document.querySelector(".fbar")!).backgroundColor);
  assert.notEqual(bg, "rgba(0, 0, 0, 0)");
  await page.close();
});

test("cards explain their score with the criteria rules", async () => {
  const { page } = await openDemo();
  await page.click("#tab-all");
  const lines = await page.locator(".why-score").allInnerTexts();
  assert.ok(lines.length >= 10);
  assert.ok(lines.some((l) => /^45 sector \+ 35 experience \+ 10 comp = 90/.test(l)), lines.join("\n"));
  assert.ok(!lines.some((l) => /scan said/.test(l)), "demo scores match the rules");
  await page.close();
});

test("digest preview re-ranks live as the criteria are edited", async () => {
  const { page } = await openDemo();
  await page.click("#tab-criteria");
  const first = () => page.locator("#digestPreview li").first().innerText();
  assert.match(await first(), /Gridlark.*\n.*dream role/, "a dream-role anchor tops the digest");
  const text = await page.locator("#critText").inputValue();
  // Make fintech the top priority, with no dream-role bonus, and watch it move up.
  const edited = text.replace(/(- id: fintech\n(?:.*\n)*?\s+weight: )1/, "$13").replace(/bonus: 15/, "bonus: 0");
  assert.notEqual(edited, text);
  await page.locator("#critText").fill(edited);
  await page.waitForFunction(() => /Ledgerly/.test(document.querySelector("#digestPreview li")?.textContent || ""));
  assert.match(await first(), /Ledgerly/);
  await page.close();
});

test("alerts preview lists the rules and updates live as the criteria are edited", async () => {
  const { page, errors } = await openDemo();
  await page.click("#tab-criteria");
  const preview = () => page.locator("#alertsPreview").innerText();
  assert.match(await preview(), /recruiter or hiring manager emails or replies: alert right away/);
  assert.match(await preview(), /scoring 85\+: alert right away/);
  const text = await page.locator("#critText").inputValue();
  const edited = text.replace("min_score: 85, level: loud", "min_score: 70, level: off");
  assert.notEqual(edited, text);
  await page.locator("#critText").fill(edited);
  await page.waitForFunction(() => /scoring 70\+: do nothing/.test(document.querySelector("#alertsPreview")?.textContent || ""));
  assert.deepEqual(errors, []);
  await page.close();
});

test("non-http links from scan data are not clickable", async () => {
  const html = buildDemo().replace("https://example.com/jobs/sunfield-utility-data", "javascript:alert(1)");
  const { page } = await openDemo({ html });
  await page.click("#tab-all");
  assert.equal(await page.locator('a[href^="javascript:"]').count(), 0);
  await page.close();
});

test("criteria tab explains itself when the YAML reader can't load", async () => {
  const { page } = await openDemo({ blockYaml: true });
  await page.click("#tab-criteria");
  assert.match(await page.locator("#view").innerText(), /YAML reader didn't load/);
  await page.close();
});

test("no horizontal scroll at phone width", async () => {
  const { page } = await openDemo({ width: 390 });
  for (const id of ["inbox", "people", "criteria"]) {
    await page.click(`#tab-${id}`);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(over <= 0, `${id} overflows by ${over}px`);
  }
  await page.close();
});

test("the search box stays inside the filter bar", async () => {
  const { page } = await openDemo();
  const [bar, box] = await Promise.all([page.locator("#fbar").boundingBox(), page.locator("#q").boundingBox()]);
  assert.ok(box!.x + box!.width <= bar!.x + bar!.width, `search ends at ${box!.x + box!.width}, bar at ${bar!.x + bar!.width}`);
  await page.close();
});

test("recruiter details are hidden until the viewer shows them", async () => {
  const seed = JSON.parse(readFileSync(new URL("../demo/seed.json", import.meta.url), "utf8"));
  const recs = Object.values<{ name: string; company: string; lastNote?: string }>(seed.recruiters);
  const { page, errors } = await openDemo();
  // Rendered markup and text only: the demo build also embeds the seed in a script tag.
  const shown = () => page.evaluate(() => document.querySelector<HTMLElement>("#app, main, body")!.innerText + document.querySelector("#view")!.innerHTML);
  await page.click("#tab-people");
  let html = await shown();
  for (const r of recs) {
    assert.ok(!html.includes(r.name), `name visible: ${r.name}`);
    if (r.lastNote) assert.ok(!html.includes(r.lastNote), "note visible");
  }
  assert.equal(await page.locator("#view a[href*='mail']").count(), 0);
  assert.ok(await page.locator("#view").getByText(recs[0].company).first().isVisible());

  await page.click("#recPrivacy");
  html = await shown();
  for (const r of recs) assert.ok(html.includes(r.name), `name missing: ${r.name}`);

  // The choice is remembered for this viewer.
  await page.reload();
  await page.waitForSelector(".job");
  await page.click("#tab-people");
  assert.ok((await shown()).includes(recs[0].name));
  await page.click("#recPrivacy");
  assert.ok(!(await shown()).includes(recs[0].name));
  assert.deepEqual(errors, []);
  await page.close();
});

test("on a phone, filters fold away behind one button", async () => {
  const { page } = await openDemo({ width: 390, height: 844 });
  await page.click("#tab-inbox");
  assert.ok(await page.locator("#q").isVisible());
  assert.ok(!(await page.locator("#fv-lane").isVisible()));
  const firstCard = (await page.locator(".job").first().boundingBox())!;
  assert.ok(firstCard.y < 844, `first card starts below the fold at ${firstCard.y}`);
  await page.click("#ftoggle");
  assert.ok(await page.locator("#fv-lane").isVisible());
  await page.close();
});

// Superseded by RR-UX4-1 (2026-10-28): filters fold behind the toggle at every width. The toggle still opens them.
test("on a wide screen, filters fold behind the toggle and open on demand", async () => {
  const { page } = await openDemo({ width: 1100 });
  assert.ok(await page.locator("#ftoggle").isVisible());
  assert.ok(!(await page.locator("#fv-lane").isVisible()));
  await page.click("#ftoggle");
  assert.ok(await page.locator("#fv-lane").isVisible());
  await page.close();
});

test("cards show Values and Culture badges with a reason", async () => {
  const { page, errors } = await openDemo();
  await page.click("#tab-all");
  const card = (co: string) => page.locator("article.job", { hasText: co }).first().locator(".fitr");
  assert.match(await card("Sunfield Energy").innerText(), /Values\s+Great[\s\S]*Culture\s+Great/i);
  assert.match(await card("Ledgerly").innerText(), /Values\s+Neutral[\s\S]*Culture\s+Good[\s\S]*but launch crunch risk/i);
  assert.match(await card("Pebblepay").innerText(), /Culture\s+No/i);
  assert.match(await card("Orbitline").innerText(), /rated up after research/);
  assert.match(await card("Gridlark").innerText(), /Unrated[\s\S]*Not checked yet/i);
  assert.deepEqual(errors, []);
  await page.close();
});

// Since RR-FS (2026-10-30) Values and Culture are quick chips ("good or better"), not dropdowns.
test("Values and Culture filters narrow the list", async () => {
  const { page } = await openDemo({ width: 1100 });
  await page.click("#tab-all");
  await page.click('#fbar [data-chip="culture"]');
  await page.waitForFunction(() => document.querySelectorAll<HTMLElement>("article.job").length === 2);
  const cos = await page.locator("article.job .co").allTextContents();
  assert.deepEqual(cos.sort(), ["Ledgerly", "Sunfield Energy"]);
  await page.click('#fbar [data-chip="values"]');
  await page.waitForFunction(() => document.querySelectorAll<HTMLElement>("article.job").length === 1);
  await page.close();
});

test("the Criteria tab explains the fit ratings", async () => {
  const { page } = await openDemo();
  await page.click("#tab-criteria");
  const card = page.locator("div.ccard", { has: page.locator("h2", { hasText: "Fit ratings" }) });
  assert.match(await card.innerText(), /\+2\s+calm pace/);
  assert.match(await card.innerText(), /−1\s+launch crunch risk/);
  assert.match(await page.locator("div.ccard", { hasText: "At a glance" }).innerText(), /Home state\s+CO → UT/);
  await page.close();
});

// Preview panel: the posting's own text, loaded from the board's public API on click.
test("clicking a role opens its description in a side panel on wide screens", async () => {
  const { page, errors } = await openDemo({ width: 1300, height: 900 });
  await page.click("#tab-all");
  const card = page.locator(".job", { hasText: "Sunfield Energy" });
  await card.locator("h2 a").click();
  const panel = page.locator("#preview");
  await panel.locator("#pvBody li").first().waitFor();
  assert.match(await panel.locator("#pvTitle").innerText(), /Utility Data/);
  assert.match(await panel.innerText(), /Own the roadmap for utility data ingestion/);
  assert.match(await panel.innerText(), /Greenhouse's public job board/);
  const pb = (await panel.boundingBox())!, cb = (await card.boundingBox())!;
  assert.ok(pb.x > cb.x + cb.width - 1, "panel sits to the right of the list");
  assert.equal(Math.round(pb.y), 0);
  assert.ok(await card.evaluate((el) => el.classList.contains("sel")));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), 0);
  // Ashby and Lever shapes render too.
  await page.locator(".job", { hasText: "Gridlark" }).getByRole("button", { name: "Preview" }).click();
  await page.waitForFunction(() => /Virtual Power Plants/.test(document.querySelector("#pvTitle")?.textContent!) && /three product teams/.test(document.querySelector("#pvBody")?.textContent || ""));
  await page.locator(".job", { hasText: "Orbitline" }).getByRole("button", { name: "Preview" }).click();
  await page.waitForFunction(() => /What we're looking for/.test(document.querySelector("#pvBody")?.textContent || ""));
  await page.keyboard.press("Escape");
  assert.ok(await panel.isHidden());
  assert.deepEqual(errors, []);
  await page.close();
});

test("Gmail import: finds recruiters, skips known ones and job boards, adds only the picked", async () => {
  const { page, errors } = await openDemo();
  await page.click("#tab-people");
  await page.click("#recPrivacy");
  await page.locator("details.gmail summary").click();
  await page.click("#gmFind");
  await page.waitForSelector(".gmlist");
  const rows = await page.locator(".gmlist li").allInnerTexts();
  assert.equal(rows.length, 4, rows.join("\n"));
  assert.ok(!rows.some((r) => /Ledgerly|ashby/i.test(r)), "job board mail skipped");
  assert.match(rows.find((r) => /Jordan Reyes/.test(r))!, /already added/);
  // The long thread was read in full, so the last contact is the newest email, not the preview's.
  const riley = rows.find((r) => /Riley Chen/.test(r))!;
  const d = new Date(Date.now() - 2 * 864e5);
  assert.match(riley, new RegExp(d.toLocaleDateString(undefined, { month: "short" }) + "\\s+" + d.getDate()));
  // Only read-only Gmail tools were called.
  const tools = await page.evaluate(() => window.__RR_MCP_CALLS__.map((c) => c.tool));
  assert.deepEqual([...new Set(tools)].sort(), ["batch_get_threads", "search_threads"]);
  // Untick the friend, add the other two.
  await page.locator(".gmlist li", { hasText: "Taylor Morgan" }).locator("input").uncheck();
  assert.match(await page.locator("#gmAdd").innerText(), /Add 2 recruiters/);
  await page.click("#gmAdd");
  await page.waitForFunction(() => document.querySelectorAll<HTMLElement>(".rec").length === 7);
  const list = await page.locator(".list").innerText();
  assert.match(list, /Riley Chen/);
  assert.match(list, /Avery Brooks/);
  assert.doesNotMatch(list, /Taylor Morgan/);
  assert.match(list, /NORTHSTAR TALENT[\s\S]*AGENCY/i);
  assert.deepEqual(errors, []);
  await page.close();
});

test("roles without a board feed show an Open posting link instead", async () => {
  const { page } = await openDemo({ width: 1300 });
  await page.click("#tab-all");
  await page.locator(".job", { hasText: "Carbonmark" }).getByRole("button", { name: "Preview" }).click();
  const panel = page.locator("#preview");
  assert.match(await panel.innerText(), /No preview for this source/);
  assert.match(await panel.innerText(), /ZipRecruiter/);
  // Demo roles are made up, so the panel says so instead of linking to example.com (RR-P1-2).
  assert.equal(await panel.locator('a[href*="example.com"]').count(), 0);
  assert.match(await panel.innerText(), /made-up role/);
  // A board that no longer lists the role says so.
  await page.locator(".job", { hasText: "Watermark Climate" }).getByRole("button", { name: "Preview" }).click();
  await page.waitForFunction(() => /isn't on the board anymore/.test(document.querySelector("#preview")?.textContent || ""));
  await page.close();
});

test("on a phone the preview is a full-screen sheet that closes back to the card", async () => {
  const { page, errors } = await openDemo({ width: 390, height: 844 });
  await page.click("#tab-all");
  const btn = page.locator(".job", { hasText: "Ledgerly" }).getByRole("button", { name: "Preview" });
  await btn.click();
  const panel = page.locator("#preview");
  await panel.locator("#pvBody").waitFor();
  const b = (await panel.boundingBox())!;
  assert.deepEqual([b.x, b.y, b.width, b.height].map(Math.round), [0, 0, 390, 844]);
  assert.equal(await page.evaluate(() => document.activeElement!.id), "pvClose");
  assert.ok(await panel.locator("#pvBody").evaluate((el) => el.scrollWidth <= el.clientWidth));
  await page.click("#pvClose");
  assert.ok(await panel.isHidden());
  assert.equal(await page.evaluate(() => (document.activeElement as HTMLElement).dataset.preview), "greenhouse-1005");
  assert.deepEqual(errors, []);
  await page.close();
});

test("Gmail import explains a missing connector instead of failing silently", async () => {
  const seed = JSON.parse(readFileSync(new URL("../demo/seed.json", import.meta.url), "utf8"), (k, v) => (typeof v === "string" && v.startsWith("@file:") ? readFileSync(new URL("../" + v.slice(6), import.meta.url), "utf8") : v));
  seed.gmail.error = "server_not_connected";
  const { page } = await openDemo({ html: buildDemo({ seed }) });
  await page.click("#tab-people");
  await page.click("#recPrivacy");
  await page.locator("details.gmail summary").click();
  await page.click("#gmFind");
  assert.match(await page.locator("details.gmail .err").innerText(), /Add the Gmail connector/);
  await page.close();

  delete seed.gmail;
  const { page: p2 } = await openDemo({ html: buildDemo({ seed }) });
  await p2.click("#tab-people");
  await p2.click("#recPrivacy");
  await p2.locator("details.gmail summary").click();
  assert.match(await p2.locator("details.gmail").innerText(), /works when this page is open in Claude/);
  await p2.close();
});

test("Gmail status check suggests pipeline updates and saves only the ticked ones", async () => {
  const { page, errors } = await openDemo();
  await page.click("#tab-pipeline");
  await page.locator("details.gmail-status summary").click();
  await page.click("#gsFind");
  await page.waitForSelector("details.gmail-status .gmlist");
  const rows = await page.locator("details.gmail-status .gmlist li").allInnerTexts();
  assert.equal(rows.length, 3, rows.join("\n"));
  assert.match(rows.find((r) => /Brightwell/.test(r))!, /Applied\s*→\s*Rejected/i);
  assert.match(rows.find((r) => /Pebblepay/.test(r))!, /Screen\s*→\s*Interviewing/i);
  assert.match(rows.find((r) => /HelioHome/.test(r))!, /Applying\s*→\s*Applied/i);
  assert.ok(!rows.some((r) => /Watermark/.test(r)), "an email from before the role was tracked is ignored");
  assert.ok(!rows.some((r) => /Ledgerly|Sunfield/.test(r)), "roles outside the pipeline are left alone");
  // The search named the pipeline companies and used only read-only tools.
  const calls = await page.evaluate(() => window.__RR_MCP_CALLS__);
  assert.match(calls[0].input.query, /"pebblepay"/);
  assert.deepEqual([...new Set(calls.map((c) => c.tool))].sort().filter((t) => t !== "batch_get_threads"), ["search_threads"]);
  // Leave Pebblepay alone, update the other two.
  await page.locator("details.gmail-status .gmlist li", { hasText: "Pebblepay" }).locator("input").uncheck();
  assert.match(await page.locator("#gsApply").innerText(), /Update 2 roles/);
  await page.click("#gsApply");
  await page.waitForFunction(() => document.querySelectorAll<HTMLElement>("details.gmail-status .gmlist li").length === 1);
  const jobs = await page.evaluate(async () => {
    const db = await window.claude.use("db");
    const get = async (id: string) => (await db.doc("jobs/" + id).get()).data()!;
    return { bw: await get("greenhouse-1007"), hh: await get("manual-heliohome-sr-pm"), pp: await get("ashby-1008") };
  });
  assert.equal(jobs.bw.status, "rejected");
  assert.match(jobs.bw.statusAt, /^\d{4}-\d{2}-\d{2}$/, "status date is the email's date");
  assert.equal(jobs.bw.statusEmail.subject, "Update on your application");
  assert.equal(jobs.hh.status, "applied");
  assert.equal(jobs.hh.appliedAt, jobs.hh.statusAt);
  assert.ok(jobs.hh.followUpDue);
  assert.equal(jobs.pp.status, "screen", "unticked role unchanged");
  assert.deepEqual(errors, []);
  await page.close();
});

test("Gmail status check is not on the public demo", async () => {
  const { page } = await openDemo({ html: buildDemo({ publicDemo: true }) });
  await page.click("#tab-pipeline");
  assert.equal(await page.locator("details.gmail-status").count(), 0);
  await page.close();
});

test("Gmail import is hidden while recruiter details are hidden", async () => {
  const { page } = await openDemo();
  await page.click("#tab-people");
  assert.equal(await page.locator("details.gmail").count(), 0);
  await page.close();
});

test("the Watchlist shows board health from the last scan", async () => {
  const { page, errors } = await openDemo();
  await page.click("#tab-watch");
  const strip = page.locator(".health");
  const t = await strip.innerText();
  assert.match(t, /Boards: 7\/9 read \(solar\/climate 4\/5\)/);
  assert.match(t, /full scan/); // RR-UX-13 plain words
  assert.ok(await strip.evaluate((el) => el.classList.contains("low")), "80% priority coverage is flagged");
  assert.equal(await strip.locator(".hchip.bad").first().getAttribute("title"), "404 from board API (demo)");
  assert.match(t, /Orbitline moved its job board \(Greenhouse → Lever\)/);
  const dot = async (co: string) => (await page.locator(".row", { hasText: co }).locator(".hdot").getAttribute("class"))!;
  assert.match(await dot("Sunfield Energy"), /green/);
  assert.match(await dot("Gridlark"), /amber/);
  assert.match(await dot("Watermark Climate"), /red/);
  assert.match(await dot("Copperleaf Insurance"), /grey/);
  assert.equal(await page.locator(".row", { hasText: "QuickCash" }).locator(".hdot").count(), 0);
  assert.deepEqual(errors, []);
  await page.close();
});

test("public demo: radar only, no resume or recruiter tools anywhere", async () => {
  const html = buildDemo({ publicDemo: true });
  const { page, errors } = await openDemo({ html });
  assert.equal(await page.locator("#tab-people").count(), 0, "no Recruiters tab");
  for (const id of ["inbox", "pipeline", "action", "ruled", "all", "criteria", "watch", "filters"]) {
    await page.click(`#tab-${id}`);
    const text = await page.locator("#view").innerText();
    assert.doesNotMatch(text, /resume|intake/i, `${id} mentions resume tooling`);
    assert.equal(await page.locator("#view .apply").count(), 0, `${id} has an Apply button`);
  }
  await page.click("#tab-all");
  assert.match(await page.locator("#lede").innerText(), /my own call/);
  assert.match(await page.locator(".why-score").first().innerText(), /sector/);
  await page.click("#tab-filters");
  assert.equal(await page.locator("#cCmd, #cInstr").count(), 0);
  assert.deepEqual(errors, []);
  await page.close();
});

test("public demo with ?full shows the resume and recruiter tools", async () => {
  const html = buildDemo({ publicDemo: true });
  const { page, errors } = await openDemo({ html, query: "?full" });
  assert.equal(await page.locator("#tab-people").count(), 1);
  await page.click("#tab-all");
  assert.ok((await page.locator("#view .apply").count()) > 0);
  await page.click("#tab-filters");
  assert.equal(await page.locator("#cCmd, #cInstr").count(), 2);
  await page.click("#tab-people");
  assert.match(await page.locator("#view").innerText(), /Show details/);
  assert.deepEqual(errors, []);
  await page.close();
});

test("a remembered Recruiters tab falls back to New in the public demo", async () => {
  const html = buildDemo({ publicDemo: true });
  const { page } = await openDemo({ html, query: "?full" });
  await page.click("#tab-people");
  await page.goto(page.url().split("?")[0]);
  await page.waitForSelector("#tab-inbox");
  assert.equal(await page.locator("#tab-inbox").getAttribute("aria-selected"), "true");
  await page.close();
});

test("public demo says what it is and links back to the portfolio in the first screen (RR-P0-1)", async () => {
  const html = buildDemo({ publicDemo: true });
  for (const [width, height] of [[390, 844], [1280, 800]]) {
    for (const query of ["", "?full"]) {
      const { page, errors } = await openDemo({ html, width, height, query });
      const back = page.locator('a[href="https://chaseholroyd.com/role-radar.html"]');
      assert.equal(await back.count(), 1, `back link ${width} ${query}`);
      const box = await back.boundingBox();
      assert.ok(box && box.y + box.height <= height, `back link in first screen at ${width}`);
      assert.equal(await page.locator('#showcase a[href="https://chaseholroyd.com/"]').count(), 1);
      const lede = page.locator("#lede");
      assert.ok(await lede.isVisible());
      assert.match(await lede.innerText(), /job-search radar I built/);
      const lb = (await lede.boundingBox())!;
      assert.ok(lb.y + lb.height <= height, `lede in first screen at ${width}`);
      assert.deepEqual(errors, []);
      await page.close();
    }
  }
});

test("the app outside the public demo has no showcase bar", async () => {
  const { page } = await openDemo();
  assert.ok(!(await page.locator("#showcase").isVisible()));
  assert.ok(!(await page.locator("#lede").isVisible()));
  await page.close();
});

test("public demo says 'my own call' once, not on every card (RR-P2-1)", async () => {
  const html = buildDemo({ publicDemo: true });
  const { page } = await openDemo({ html });
  await page.click("#tab-all");
  assert.doesNotMatch(await page.locator("#view").innerText(), /my own call/);
  assert.match(await page.locator("#lede").innerText(), /my own call/);
  await page.close();
});

test("a role added on Pipeline shows up right away (RR-P1-1)", async () => {
  const { page, errors } = await openDemo();
  await page.click("#tab-pipeline");
  await page.locator("#addRole summary").click();
  await page.fill("#aj-co", "Quillfern Labs");
  await page.fill("#aj-ti", "Senior PM, Test Role");
  await page.locator("#addJob button[type=submit]").click();
  await page.waitForFunction(() => /Quillfern Labs/i.test(document.querySelector<HTMLElement>("#view")!.innerText), null, { timeout: 2000 });
  assert.deepEqual(errors, []);
  await page.close();
});

test("a company added to the watchlist shows up right away (RR-P1-1)", async () => {
  const { page } = await openDemo();
  await page.click("#tab-watch");
  await page.fill("#coName", "Quillfern Labs");
  await page.fill("#coSlug", "quillfern");
  await page.locator("#addCo button[type=submit]").click();
  await page.waitForFunction(() => /Quillfern Labs/i.test(document.querySelector<HTMLElement>("#view")!.innerText), null, { timeout: 2000 });
  await page.close();
});

test("a recruiter added on ?full shows up right away (RR-P1-1)", async () => {
  const { page } = await openDemo();
  await page.click("#tab-people");
  await page.click("#recPrivacy");
  const form = page.locator("#addRec");
  if (!(await form.isVisible())) await page.locator("details:has(#addRec) summary").click();
  await page.fill("#ar-n", "Quill Fernsby (demo)");
  await page.fill("#ar-c", "Quillfern Labs");
  await form.locator("button[type=submit]").click();
  await page.waitForFunction(() => /Quill Fernsby/i.test(document.querySelector<HTMLElement>("#view")!.innerText), null, { timeout: 2000 });
  await page.close();
});

test("demo roles have no example.com links; 'Sample posting' explains itself (RR-P1-2)", async () => {
  const { page, errors } = await openDemo();
  await page.click("#tab-all");
  assert.equal(await page.locator('a[href*="example.com"]').count(), 0);
  const btn = page.locator("#view button", { hasText: "Sample posting" }).first();
  await btn.click();
  assert.match(await page.locator("#toast").innerText(), /made-up role/);
  assert.deepEqual(errors, []);
  await page.close();
});

test("board HTML is sanitized before it is shown", async () => {
  const seed = JSON.parse(readFileSync(new URL("../demo/seed.json", import.meta.url), "utf8"));
  seed.jobs["greenhouse-777"] = { company: "Acme", title: "Senior Product Manager", ats: "greenhouse", source: "greenhouse", status: "new", firstSeen: "@t-1", url: "https://job-boards.greenhouse.io/acmetest/jobs/777" };
  const evil = `<p onclick="window.__x=1">Real words <b>stay</b>.</p><script>window.__x=2<\/script><img src=x onerror="window.__x=3"><a href="javascript:window.__x=4">bad link</a><a href="https://example.com/benefits">good link</a><style>body{display:none}</style><iframe src="https://example.com"></iframe>`;
  const esc = (h: string) => h.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const { page, errors } = await openDemo({ html: buildDemo({ seed }), width: 1300, ready: "#view" });
  let asked = "";
  await page.route("https://boards-api.greenhouse.io/**", (route) => { asked = route.request().url(); route.fulfill({ contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ id: 777, content: esc(evil) }) }); });
  await page.click("#tab-all");
  await page.locator(".job", { hasText: "Acme" }).getByRole("button", { name: "Preview" }).click();
  await page.locator("#pvBody b").waitFor();
  assert.equal(asked, "https://boards-api.greenhouse.io/v1/boards/acmetest/jobs/777");
  const body = page.locator("#pvBody");
  assert.match(await body.innerText(), /Real words stay\./);
  assert.equal(await body.locator("script, img, style, iframe, [onclick]").count(), 0);
  assert.equal(await body.locator("a").first().getAttribute("href"), null);
  assert.equal(await body.locator("a").nth(1).getAttribute("rel"), "noopener noreferrer");
  await body.locator("p").click();
  assert.equal(await page.evaluate(() => window.__x), undefined);
  assert.deepEqual(errors, []);
  await page.close();
});

test("RR-UX-1 the chip beside the score names what it rates (experience), so 90 + chip never reads as a contradiction", async () => {
  const { page } = await openDemo();
  await page.click("#tab-all");
  const chips = await page.locator("#view .chip[class*=fit-]").allTextContents();
  assert.ok(chips.length >= 10);
  for (const c of chips) assert.match(c, /^Experience: (strong|partial|stretch)$/);
  assert.match((await page.locator("#view .score").first().getAttribute("title"))!, /Criteria score, 0.100/);
  assert.equal(await page.locator('#fbar [data-chip="strong"]').innerText(), "Strong fit");
  await page.close();
});

test("header numbers agree with the Watchlist strip and the New tab (RR-P1-4)", async () => {
  const { page } = await openDemo();
  const line = await page.locator("#scanLine").innerText();
  const [, boards, fresh] = /(\d+) boards · (\d+) new/.exec(line) || [];
  assert.ok(boards, line);
  const newCount = await page.locator("#tab-inbox .n").innerText();
  assert.equal(fresh, newCount.trim(), "new matches = New tab");
  await page.click("#tab-watch");
  assert.match(await page.locator("#view").innerText(), new RegExp(`\\d+/${boards} read`));
  assert.doesNotMatch(line, /demo data/i, "the badge already says demo");
  assert.equal(await page.locator("#scanLine .mono").count(), 0, "one font in the scan line (RR-P2-2)");
  await page.close();
});

test("light theme chips meet 4.5:1 contrast (RR-P1-5)", async () => {
  const { page } = await openDemo();
  const ratio = await page.evaluate(() => {
    const lum = (c: string) => { const v = c.match(/\d+/g)!.slice(0, 3).map((x: any) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
    const r = (el: Element | null) => { const s = getComputedStyle(el!); const a = lum(s.color), b = lum(s.backgroundColor); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); };
    return { demo: r(document.querySelector("#demoNote")), fit: r(document.querySelector(".fit-strong")), score: r(document.querySelector(".score.hi")) };
  });
  for (const [k, v] of Object.entries(ratio)) assert.ok(v >= 4.5, `${k} ${v.toFixed(2)}`);
  await page.close();
});

test("phone controls are at least 44px tall (RR-P1-6)", async () => {
  const html = buildDemo({ publicDemo: true });
  const { page } = await openDemo({ html, width: 390, height: 844 });
  for (const id of ["inbox", "pipeline", "watch", "filters"]) {
    await page.click(`#tab-${id}`);
    if (id === "pipeline") await page.locator("#addRole summary").click();
    const small = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>("button, a.btn, select, input:not([type=checkbox]):not([type=radio]), [role=tab], .showcase a, summary")]
      .filter((el) => el.offsetParent !== null)
      .map((el): [string, number] => [el.id || el.textContent!.trim().slice(0, 20), Math.round(el.getBoundingClientRect().height)])
      .filter(([, h]) => h < 44));
    assert.deepEqual(small, [], id);
  }
  await page.close();
});

test("public demo works with the CDN blocked: js-yaml is inlined (RR-P2-9)", async () => {
  const html = buildDemo({ publicDemo: true });
  assert.doesNotMatch(html, /cdnjs\.cloudflare\.com\/ajax\/libs\/js-yaml/);
  assert.match(html, /js-yaml 4\.1\.0 .*@license MIT/);
  const { page, errors } = await openDemo({ html, blockYaml: true });
  await page.click("#tab-criteria");
  assert.ok((await page.locator("#digestPreview li").count()) > 0);
  assert.deepEqual(errors, []);
  await page.close();
});

test("a board that can't be reached falls back to the posting link", async () => {
  const seed = JSON.parse(readFileSync(new URL("../demo/seed.json", import.meta.url), "utf8"));
  seed.jobs["lever-9"] = { company: "Acme", title: "Senior Product Manager", ats: "lever", source: "lever", status: "new", firstSeen: "@t-1", url: `https://jobs.lever.co/acmetest/0c2f6d1e-8a7b-4c3d-9e1f-2a3b4c5d6e7f` };
  const { page } = await openDemo({ html: buildDemo({ seed }), width: 1300, ready: "#view" });
  await page.route("https://api.lever.co/**", (route) => route.abort());
  await page.click("#tab-all");
  await page.locator(".job", { hasText: "Acme" }).getByRole("button", { name: "Preview" }).click();
  await page.waitForFunction(() => /Couldn't load the description/.test(document.querySelector("#preview")?.textContent || ""));
  assert.ok(await page.locator("#preview").getByRole("link", { name: /Open posting/ }).isVisible());
  await page.close();
});

test("cards name sources in plain words (RR-P2-3)", async () => {
  const { page } = await openDemo();
  await page.click("#tab-all");
  const text = await page.locator("#view").innerText();
  assert.match(text, /Greenhouse/);
  assert.match(text, /ZipRecruiter/);
  assert.doesNotMatch(text, /\b(greenhouse|ziprecruiter|himalayas)\b/);
  await page.close();
});

test("no date repeats as '<status> since' on the same card (RR-P2-7)", async () => {
  const { page } = await openDemo();
  await page.click("#tab-pipeline");
  for (const d of await page.locator(".dates").allInnerTexts()) {
    const m = /Applied\s+(\w+ \d+).*Applied since\s+(\w+ \d+)/s.exec(d);
    assert.ok(!m || m[1] !== m[2], d);
  }
  await page.close();
});

test("public demo on a laptop folds filters so the first role shows (RR-P2-4)", async () => {
  const html = buildDemo({ publicDemo: true });
  const { page } = await openDemo({ html, width: 1280, height: 800 });
  assert.ok(!(await page.locator("#fbar .fields").isVisible()));
  const first = (await page.locator(".job").first().boundingBox())!;
  assert.ok(first.y < 800, `first role at ${first.y}`);
  await page.click("#ftoggle");
  assert.ok(await page.locator("#fbar .fields").isVisible());
  await page.close();
});

test("page has a main landmark and valid headings (RR-P2-5)", async () => {
  const { page } = await openDemo();
  assert.equal(await page.locator("main").count(), 1);
  await page.click("#tab-criteria");
  assert.equal(await page.locator(".ccard h3").count(), 0);
  assert.equal(await page.locator(".pips:not([role=img])").count(), 0);
  await page.close();
});

test("public demo cards show one category chip, the sector (RR-P2-11)", async () => {
  const html = buildDemo({ publicDemo: true });
  const { page } = await openDemo({ html });
  await page.click("#tab-all");
  const first = page.locator(".job").first();
  const chips = await first.locator(".chip.lane").allTextContents();
  assert.deepEqual(chips.map((c) => c.toLowerCase()), ["solar, storage & distributed energy"]);
  await page.close();
});

test("Recruiters tab says its number is next steps due (RR-P2-12)", async () => {
  const { page } = await openDemo();
  await page.click("#tab-people");
  const due = await page.locator("#view .rec .next", { hasText: "due" }).count();
  assert.equal(await page.locator("#tab-people .n").innerText(), `${due} due`);
  await page.close();
});

test("Criteria 'At a glance' reads as plain words (RR-P2-13)", async () => {
  const { page } = await openDemo();
  await page.click("#tab-criteria");
  const kv = page.locator(".kv b");
  const font = await kv.first().evaluate((el) => getComputedStyle(el).fontFamily);
  assert.doesNotMatch(font, /Plex Mono/);
  const text = (await kv.allInnerTexts()).join(" | ");
  assert.match(text, /Fully remote, US/);
  assert.match(text, /^Senior, staff/);
  await page.close();
});

test("the Filters button's text is centered", async () => {
  const html = buildDemo({ publicDemo: true });
  const { page } = await openDemo({ html, width: 390, height: 844 });
  assert.equal(await page.locator("#ftoggle").evaluate((el) => getComputedStyle(el).alignItems), "center");
  await page.close();
});
