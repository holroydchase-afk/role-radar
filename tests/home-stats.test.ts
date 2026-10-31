// RR-M4.2 Home tab numbers as pure functions in src/progress.ts (UX-H-AC5, AC6, AC7; architect §3).
// Written red-first by qa-tdd. Made-up companies only; the seed check uses demo/seed.json.
//
// Contract pinned here:
//   homeStats(jobs: Jobs, { now?: When = Date.now(), tz?: string = "America/New_York" } = {}) → {
//     todo:          count of status "saved"
//     inProgress:    count of status "applying"
//     done:          roles that reached Applied (reached(j) !== ""), including ones now rejected or closed
//     doneThisWeek:  done roles whose appliedAt falls in the week of now (weekStart, Monday 12am in tz)
//     stages:        { applied, screen, interviewing, offer }: CURRENT status counts (not all-time reached)
//     closed:        status rejected or closed that reached Applied (shown as a grey "N closed", never "Rejected")
//     newToReview:   status new + viewed
//   }
//   Each job lands in at most one of todo / inProgress / stages.* / closed / newToReview.
//   skipped, rejected/closed that never got to Applied, and unknown statuses are not counted there.
//   Accepts a list or an id → doc map, like the other progress functions.
//
//   coverageLine(coverage: unknown, companies?: unknown) → null when there is no coverage object, else
//     { text, failing } where failing = companies (not vetoed) with failStreak > 0 when companies are given,
//     otherwise coverage.failed (or failedList.length); N = coverage.attempted.
//     text = "N boards read · all OK" when failing is 0, else "X of N boards OK · K failing" (X = N - K).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import * as P from "../src/progress.ts";

const NY = "America/New_York";
const DAY = 864e5;
// Thu Oct 29 2026, noon EDT. The week started Mon Oct 26 12:00am EDT (04:00Z).
const NOW = Date.parse("2026-10-29T16:00:00Z");
const opts = { now: NOW, tz: NY };
let n = 0;
const j = (status: string, o: Record<string, unknown> = {}): P.ProgressJob => ({ _id: "j" + ++n, company: "Acme " + n, title: "Senior PM", status, ...o });

const STATUSES = ["new", "viewed", "saved", "applying", "applied", "screen", "interviewing", "offer", "skipped", "rejected", "closed"];

test("RR-M4.2-H1 AC5 one role per status: each lands in its own bucket", () => {
  const jobs = STATUSES.map((s) => j(s, ["applied", "screen", "interviewing", "offer", "rejected", "closed"].includes(s) ? { appliedAt: "2026-10-20T15:00:00Z" } : {}));
  const h = P.homeStats(jobs, opts);
  assert.equal(h.todo, 1);
  assert.equal(h.inProgress, 1);
  assert.deepEqual(h.stages, { applied: 1, screen: 1, interviewing: 1, offer: 1 });
  assert.equal(h.closed, 2, "rejected + closed, both with appliedAt");
  assert.equal(h.newToReview, 2);
  assert.equal(h.done, 6, "4 in the pipeline + 2 closed after applying");
  assert.equal(h.doneThisWeek, 0, "Oct 20 is last week");
});

test("RR-M4.2-H2 AC9b each of the 11 statuses lands in at most one bucket; unknown statuses are ignored", () => {
  const buckets = (h: ReturnType<typeof P.homeStats>) => [h.todo, h.inProgress, h.stages.applied, h.stages.screen, h.stages.interviewing, h.stages.offer, h.closed, h.newToReview];
  for (const s of [...STATUSES, "archived", "", "ghosted"]) {
    for (const extra of [{}, { appliedAt: "2026-10-27T15:00:00Z" }]) {
      const h = P.homeStats([j(s, extra)], opts);
      const total = buckets(h).reduce((a, b) => a + b, 0);
      assert.ok(total <= 1, `status "${s}" ${JSON.stringify(extra)} counted ${total} times`);
      if (["archived", "ghosted"].includes(s)) assert.equal(total, 0, `unknown status "${s}" should be ignored`);
    }
  }
  assert.equal(P.homeStats([j("skipped")], opts).closed, 0, "skipped is never closed");
});

test("RR-M4.2-H3 AC6 closed counts rejected/closed only after they reached Applied", () => {
  const jobs = [
    j("rejected", { appliedAt: "2026-10-10T15:00:00Z" }),
    j("closed", { appliedAt: "2026-10-11T15:00:00Z" }),
    j("rejected", { statusHistory: [{ status: "applied" }, { status: "screen" }] }), // reached via history
    j("rejected"), // never applied: a pass before applying
    j("closed"), // posting closed before applying
  ];
  const h = P.homeStats(jobs, opts);
  assert.equal(h.closed, 3);
  assert.equal(h.done, 3, "Done includes the roles now rejected or closed");
  assert.deepEqual(h.stages, { applied: 0, screen: 0, interviewing: 0, offer: 0 }, "stages are current, not all-time");
  assert.ok(!("rejected" in h), "no separate Rejected count for Home to show");
});

test("RR-M4.2-H4 AC5 doneThisWeek uses appliedAt in the current New York week (Monday 12am)", () => {
  const jobs = [
    j("applied", { appliedAt: "2026-10-26T04:30:00Z" }), // Mon 12:30am EDT: this week
    j("screen", { appliedAt: "2026-10-28T20:00:00Z" }), // Wed: this week
    j("rejected", { appliedAt: "2026-10-27T15:00:00Z" }), // this week, now rejected: still done this week
    j("applied", { appliedAt: "2026-10-26T03:30:00Z" }), // Sun 11:30pm EDT: last week
    j("interviewing", { statusHistory: [{ status: "applied" }] }), // done, but no appliedAt
    j("applying", { statusAt: "2026-10-28T15:00:00Z" }), // not sent yet
  ];
  const h = P.homeStats(jobs, opts);
  assert.equal(h.done, 5);
  assert.equal(h.doneThisWeek, 3);
});

test("RR-M4.2-H5 homeStats takes an id → doc map like the other progress functions, and an empty input", () => {
  const map = { a: { status: "saved" }, b: { status: "applying" }, c: { status: "offer", appliedAt: "2026-10-01T15:00:00Z" } };
  const h = P.homeStats(map, opts);
  assert.equal(h.todo, 1);
  assert.equal(h.inProgress, 1);
  assert.equal(h.stages.offer, 1);
  assert.equal(h.done, 1);
  for (const empty of [[], {}, null, undefined]) {
    const e = P.homeStats(empty as P.Jobs, opts);
    assert.deepEqual(e, { todo: 0, inProgress: 0, done: 0, doneThisWeek: 0, stages: { applied: 0, screen: 0, interviewing: 0, offer: 0 }, closed: 0, newToReview: 0 });
  }
});

// The demo seed writes dates as "@t-N" (N days before the page opens); resolve them against NOW.
const seed = JSON.parse(readFileSync(new URL("../demo/seed.json", import.meta.url), "utf8"));
const resolve = (v: unknown): unknown => {
  if (typeof v === "string") {
    const m = /^@([dt])(-?)(-?\d+)$/.exec(v);
    if (!m) return v;
    const days = Number(m[3]) * (m[2] === "-" ? 1 : -1);
    const d = new Date(NOW - days * DAY);
    return m[1] === "d" ? d.toISOString().slice(0, 10) : d.toISOString();
  }
  if (Array.isArray(v)) return v.map(resolve);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, resolve(x)]));
  return v;
};

test("RR-M4.2-H6 AC5 demo seed: 0 to do, 1 in progress, 4 done (1 this week), Waiting 2 · Screen 1 · Interviews 1 · Offer 0, 0 closed, 6 new", () => {
  // By hand from demo/seed.json: applying = HelioHome; applied = greenhouse-1007 (@t-9) and Northstar (@t-0);
  // screen = ashby-1008 (@t-15); interviewing = greenhouse-1010 (@t-25); 5 new + 1 viewed; 4 skipped, none applied.
  const h = P.homeStats(resolve(seed.jobs) as P.Jobs, opts);
  assert.equal(h.todo, 0);
  assert.equal(h.inProgress, 1);
  assert.equal(h.done, 4);
  assert.equal(h.doneThisWeek, 1, "only Northstar (@t-0) is this week; @t-9 is the week before");
  assert.deepEqual(h.stages, { applied: 2, screen: 1, interviewing: 1, offer: 0 });
  assert.equal(h.closed, 0);
  assert.equal(h.newToReview, 6);
});

// ---- coverageLine: the board-health summary Home and the Watchlist share (AC7) ----

test("RR-M4.2-C1 AC7 all boards OK reads 'N boards read · all OK'", () => {
  const cv = { mode: "full", attempted: 9, read: 9, partial: 0, failed: 0 };
  const c = P.coverageLine(cv);
  assert.ok(c);
  assert.equal(c.text, "9 boards read · all OK");
  assert.equal(c.failing, 0);
  const companies = { a: { name: "A", failStreak: 0 }, b: { name: "B" } };
  assert.equal(P.coverageLine(cv, companies)?.text, "9 boards read · all OK");
});

test("RR-M4.2-C2 AC7 any failStreak > 0 reads 'X of N boards OK · K failing'", () => {
  const cv = { mode: "full", attempted: 9, read: 7, partial: 1, failed: 1 };
  const companies = {
    a: { name: "A", status: "active", failStreak: 0 },
    b: { name: "B", status: "active", failStreak: 2 },
    c: { name: "C", status: "active", failStreak: 1 },
    d: { name: "D", status: "vetoed", failStreak: 4 }, // vetoed boards are not read, so never "failing"
    e: { name: "E", status: "active", readMode: "partial", failStreak: 0 }, // partial is not failing
  };
  const c = P.coverageLine(cv, companies);
  assert.equal(c?.text, "7 of 9 boards OK · 2 failing");
  assert.equal(c?.failing, 2);
  // A list of companies works too.
  assert.equal(P.coverageLine(cv, Object.values(companies))?.failing, 2);
});

test("RR-M4.2-C3 AC7 without companies, failing comes from coverage.failed, then failedList", () => {
  assert.equal(P.coverageLine({ attempted: 9, read: 7, partial: 1, failed: 1 })?.text, "8 of 9 boards OK · 1 failing");
  const byList = P.coverageLine({ attempted: 5, read: 3, failedList: [{ name: "X", error: "404" }, "Y"] });
  assert.equal(byList?.text, "3 of 5 boards OK · 2 failing");
  assert.equal(byList?.failing, 2);
});

test("RR-M4.2-C4 AC7 no coverage yet: null, so Home shows nothing (or the 'after the next scan' hint)", () => {
  for (const cv of [null, undefined, "", 0, "full"]) assert.equal(P.coverageLine(cv), null, JSON.stringify(cv));
});

test("RR-M4.2-C5 AC7 demo seed: '8 of 9 boards OK · 1 failing' (Watermark Climate, failStreak 3)", () => {
  const c = P.coverageLine(seed.meta.scan.coverage, resolve(seed.companies));
  assert.equal(c?.text, "8 of 9 boards OK · 1 failing");
  assert.equal(c?.failing, 1);
});
