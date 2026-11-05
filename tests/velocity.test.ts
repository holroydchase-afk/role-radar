// RR-VEL: application velocity on Home (Chase, 2026-11-05: track applications a day, hours to ready, gate runs and
// tokens per resume, shown as visuals on the Home page). Written red-first. Made-up companies only.
//
// Contract: P.velocity(jobs, { now, tz, days = 14 }) → {
//   perDay:   the last `days` days (oldest first, today last) as { day, applied }
//   avgPerDay: applications in the window / days, one decimal
//   sampled:  count of roles with job.effort
//   medianHours (readyAt - startedAt), medianGateRuns, medianTokensK: median of the sampled roles, null when none
//   gateTarget: 5
//   recent:   up to 6 sampled roles, newest readyAt first, as { id, company, hours, gateRuns, tokensK }
// }
// job.effort is optional: { startedAt, readyAt, gateRuns?, tokensK? }. Roles without it are never an error.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chromium } from "playwright";
import type { Browser } from "playwright";
import * as P from "../src/progress.ts";
import { openDemo as open, openTab } from "../scripts/browser.mjs";

const NY = "America/New_York";
const NOW = Date.parse("2026-11-05T16:00:00Z");
const opts = { now: NOW, tz: NY };
let n = 0;
const j = (o: Record<string, unknown> = {}): P.ProgressJob => ({ _id: "v" + ++n, company: "Demo Co " + n, title: "Senior PM", status: "applied", ...o });
const eff = (startedAt: string, readyAt: string, gateRuns?: number, tokensK?: number) => ({ effort: { startedAt, readyAt, gateRuns, tokensK } });

test("VEL-1 perDay covers the last 14 days, today last, and avgPerDay is applications / days", () => {
  const jobs = [j({ appliedAt: "2026-11-05T14:00:00Z" }), j({ appliedAt: "2026-11-04T14:00:00Z" }), j({ appliedAt: "2026-11-04T15:00:00Z" }), j({ appliedAt: "2026-10-01T14:00:00Z" })];
  const v = P.velocity(jobs, opts);
  assert.equal(v.perDay.length, 14);
  assert.equal(v.perDay[13].day, "2026-11-05");
  assert.equal(v.perDay[13].applied, 1);
  assert.equal(v.perDay[12].applied, 2);
  assert.equal(v.avgPerDay, 0.2);
});

test("VEL-2 medians over sampled roles; roles without effort are skipped", () => {
  const jobs = [
    j(eff("2026-11-04T10:00:00Z", "2026-11-04T12:00:00Z", 15, 400)),
    j(eff("2026-11-04T10:00:00Z", "2026-11-04T11:00:00Z", 5, 200)),
    j(eff("2026-11-04T10:00:00Z", "2026-11-04T14:00:00Z", 7, 300)),
    j({}),
  ];
  const v = P.velocity(jobs, opts);
  assert.equal(v.sampled, 3);
  assert.equal(v.medianHours, 2);
  assert.equal(v.medianGateRuns, 7);
  assert.equal(v.medianTokensK, 300);
  assert.equal(v.gateTarget, 5);
});

test("VEL-3 no effort data → nulls, empty recent, no throw; bad dates ignored", () => {
  const v = P.velocity([j({}), j({ effort: { startedAt: "nope", readyAt: "2026-11-04T10:00:00Z" } })], opts);
  assert.equal(v.medianHours, null);
  assert.equal(v.medianGateRuns, null);
  assert.equal(v.medianTokensK, null);
  assert.deepEqual(v.recent, []);
  assert.equal(P.velocity(null, opts).perDay.length, 14);
});

test("VEL-4 recent is newest-first, capped at 6", () => {
  const jobs = Array.from({ length: 8 }, (_, i) => j({ company: "Co" + i, ...eff(`2026-11-0${i < 4 ? 1 : 2}T10:00:00Z`, `2026-11-0${i < 4 ? 1 : 2}T1${i}:00:00Z`, 3 + i, 100 + i) }));
  const v = P.velocity(jobs, opts);
  assert.equal(v.recent.length, 6);
  assert.equal(v.recent[0].company, "Co7");
  assert.deepEqual(Object.keys(v.recent[0]).sort(), ["company", "gateRuns", "hours", "id", "tokensK"]);
});

let browser: Browser;
before(async () => { browser = await chromium.launch(); });
after(async () => { await browser?.close(); });

test("VEL-5 Home shows a Velocity section with the 14-day chart, three medians and recent resumes (demo)", async () => {
  const { page, errors } = await open(browser, { file: "dist/test-velocity.html" });
  await openTab(page, "home");
  const s = page.locator("#home-velocity");
  assert.equal(await s.count(), 1);
  assert.equal(await s.locator("ol.vdays li").count(), 14);
  const text = (await s.innerText()).replace(/\s+/g, " ");
  assert.match(text, /per day/);
  assert.match(text, /Hours to ready/);
  assert.match(text, /Gate runs/);
  assert.match(text, /Tokens/);
  assert.ok((await s.locator("ul.vrecent li").count()) >= 3);
  assert.deepEqual(errors, []);
});

test("VEL-6 the demo seed's effort data is made up: no real names or numbers pasted from the live log", () => {
  const seed = readFileSync("demo/seed.json", "utf8");
  assert.match(seed, /"effort"/);
  assert.doesNotMatch(seed, /gate-id|rounds\.md/);
});
