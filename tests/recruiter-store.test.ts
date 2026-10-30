// Private recruiters (RR-PR): recruiter records are readable by the page's owner only.
// Unit tests for src/recruiter-store.ts and the publish manifest, browser tests for what a
// viewer who isn't the owner sees. Design: docs/private-recruiters.md.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chromium } from "playwright";
import type { Browser, Page } from "playwright";
import { buildDemo } from "../scripts/build-demo.mjs";
import { openDemo as open, openTab } from "../scripts/browser.mjs";

import * as R from "../src/recruiter-store.ts";
const seed = JSON.parse(readFileSync(new URL("../demo/seed.json", import.meta.url), "utf8"));
const manifest = JSON.parse(readFileSync(new URL("../app/capabilities.json", import.meta.url), "utf8"));

// A db stand-in that records every path the store touches.
type Doc = Record<string, unknown>;
function spyDb(docs: Record<string, Doc> = {}) {
  const touched: string[] = [];
  return {
    touched,
    collection(name: string) {
      touched.push(name);
      return { onSnapshot(cb: (s: { docs: { id: string; data(): Doc }[] }) => void) { cb({ docs: Object.entries(docs).map(([id, d]) => ({ id, data: () => d })) }); return () => {}; } };
    },
    doc(path: string) {
      touched.push(path);
      return { async set(d: Doc) { docs[path.split("/").pop()!] = d; }, async update(p: Doc) { Object.assign(docs[path.split("/").pop()!], p); } };
    },
  };
}
const owner = (v: boolean) => ({ isOwner: async () => v });

test("RR-PR-1 a viewer who isn't the owner gets no recruiters and the store never reads them", async () => {
  const db = spyDb({ r1: { name: "Casey (demo)" } });
  const s = R.create({ db, user: owner(false) });
  assert.equal(await s.init(), "viewer");
  assert.equal(s.visible, false);
  assert.equal(s.canWrite, false);
  let got = null;
  s.subscribe((list) => { got = list; });
  assert.deepEqual(got, []);
  await assert.rejects(s.add("r2", { name: "x" }), /owner/);
  await assert.rejects(s.update("r1", { name: "x" }), /owner/);
  assert.deepEqual(db.touched, [], "no recruiter path was read or written");
});

test("RR-PR-2 the owner reads and writes recruiters through the store", async () => {
  const db = spyDb({ r1: { name: "Casey (demo)" } });
  const s = R.create({ db, user: owner(true) });
  assert.equal(await s.init(), "owner");
  assert.equal(s.visible, true);
  assert.equal(s.canWrite, true);
  let got: R.Recruiter[] = [];
  s.subscribe((list) => { got = list; });
  assert.deepEqual(got.map((r) => [r._id, r.name]), [["r1", "Casey (demo)"]]);
  await s.add("r2", { name: "Jo (demo)" });
  await s.update("r1", { outcome: "x" });
  assert.deepEqual(db.touched, ["recruiters", "recruiters/r2", "recruiters/r1"]);
});

test("RR-PR-3 the public demo and a page with no database never touch recruiters", async () => {
  const db = spyDb({ r1: { name: "Casey (demo)" } });
  for (const s of [R.create({ db, user: owner(true), publicView: true }), R.create({ db: null, user: owner(true) })]) {
    assert.equal(await s.init(), "off");
    assert.equal(s.visible, false);
    let got = null;
    s.subscribe((list) => { got = list; });
    assert.deepEqual(got, []);
  }
  assert.deepEqual(db.touched, []);
});

test("RR-PR-4 when the platform can't say who is viewing, the page asks and the rules decide", async () => {
  for (const user of [null, { isOwner: async () => { throw new Error("unavailable"); } }]) {
    const s = R.create({ db: spyDb(), user });
    assert.equal(await s.init(), "unknown");
    assert.equal(s.visible, true, "the owner keeps the tab; a non-owner's read comes back empty under the rule");
  }
});

test("RR-PR-5 the publish manifest makes recruiters owner-only and keeps Gmail read-only", () => {
  assert.deepEqual(manifest.db.rules, R.RULES);
  assert.deepEqual(R.RULES, [{ path: "recruiters", read: "owner", write: "owner" }]);
  assert.deepEqual(manifest.mcp, { servers: [{ server: "Gmail", tools: ["search_threads", "batch_get_threads"] }] });
  assert.deepEqual(Object.keys(manifest).sort(), ["db", "mcp"], "no capability beyond the ones the page uses");
});

test("RR-PR-6 every recruiter read and write in the page goes through the store", () => {
  const page = readFileSync(new URL("../app/role-radar.html", import.meta.url), "utf8");
  assert.doesNotMatch(page, /db\.(doc|collection)\(\s*["'`]recruiters/, "direct recruiter db call in the page");
  assert.match(page, /<script src="recruiter-store\.js"><\/script>/);
});

// Browser: the real page on demo data, with the in-memory db enforcing the same rule.
let browser: Browser;
const openDemo = (opts = {}) => open(browser, { ...opts, file: "dist/test-recruiter-store.html" });
before(async () => { browser = await chromium.launch(); });
after(async () => { await browser?.close(); });

const rendered = (page: Page) => page.evaluate(() => document.body.innerText + document.querySelector("#view")!.innerHTML + document.querySelector("#tabs")!.innerHTML);

test("RR-PR-7 a shared viewer sees no recruiter data on any tab", async () => {
  const { page, errors } = await openDemo({ query: "?as=viewer" });
  await page.waitForFunction(() => window.__RR_DB_READS__ && window.__RR_DB_READS__.includes("jobs"));
  assert.equal(await page.locator('#tab-people, #moreSheet [data-tab="people"]').count(), 0, "no Recruiters tab");
  const recs = Object.values<{ name: string; lastNote?: string; email?: string }>(seed.recruiters);
  for (const id of ["inbox", "pipeline", "action", "ruled", "all", "criteria", "watch", "filters"]) {
    await openTab(page, id);
    const html = await rendered(page);
    for (const r of recs) {
      assert.ok(!html.includes(r.name), `${id}: name visible: ${r.name}`);
      if (r.lastNote) assert.ok(!html.includes(r.lastNote), `${id}: note visible`);
      if (r.email) assert.ok(!html.includes(r.email), `${id}: email visible`);
    }
  }
  await openTab(page, "criteria");
  assert.doesNotMatch(await page.locator("#alertsCard, .alerts").first().innerText().catch(() => ""), /recruiter or hiring manager emailed/i);
  const reads = await page.evaluate(() => window.__RR_DB_READS__);
  assert.ok(!reads.some((p) => /^recruiters/.test(p)), "page asked the db for recruiters: " + reads.join(","));
  assert.deepEqual(errors, []);
  await page.close();
});

test("RR-PR-8 a remembered Recruiters tab falls back to New for a shared viewer", async () => {
  const { page } = await openDemo();
  await openTab(page, "people");
  await page.goto(page.url().split("?")[0] + "?as=viewer");
  await page.waitForSelector(".job");
  await page.waitForFunction(() => (window.__RR_DB_READS__ || []).includes("jobs"));
  assert.equal(await page.locator('#tab-people, #moreSheet [data-tab="people"]').count(), 0);
  assert.equal(await page.locator("#tab-inbox").getAttribute("aria-selected"), "true");
  await page.close();
});

test("RR-PR-9 the owner still sees, adds and imports recruiters", async () => {
  const { page, errors } = await openDemo();
  await page.waitForSelector('#moreSheet [data-tab="people"]', { state: "attached" });
  await openTab(page, "people");
  await page.click("#recPrivacy");
  const recs = Object.values<{ name: string; lastNote?: string; email?: string }>(seed.recruiters);
  assert.ok((await rendered(page)).includes(recs[0].name));
  assert.ok(await page.locator("#gmFind").count(), "Gmail import still offered");
  assert.deepEqual(errors, []);
  await page.close();
});

test("RR-PR-10 the demo db enforces the owner-only rule like the platform does", async () => {
  const { page } = await openDemo({ html: buildDemo(), query: "?as=viewer" });
  const out = await page.evaluate(async () => {
    const db = await window.claude.use("db");
    const snap = await db.collection("recruiters").get();
    let write = "ok";
    try { await db.doc("recruiters/x").set({ name: "x" }); } catch (e) { write = (e as { code: string }).code; }
    return { n: snap.docs.length, write };
  });
  assert.deepEqual(out, { n: 0, write: "invalid_argument" });
  await page.close();
});
