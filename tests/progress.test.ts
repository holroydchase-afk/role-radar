// Progress: the shared numbers behind the Progress tab and the daily family email (src/progress.ts).
// Made-up companies only.
import { test } from "node:test";
import assert from "node:assert/strict";

import * as P from "../src/progress.ts";
const NY = "America/New_York";
const iso = (s: string | number) => new Date(s).toISOString();

test("the email window is 7am to 7am New York time, start inclusive, end exclusive", () => {
  // 9am EDT on Sat Oct 24 2026 = 13:00Z: the window is Fri 7am to Sat 7am EDT.
  const w = P.emailWindow("2026-10-24T13:00:00Z");
  assert.equal(iso(w.from), "2026-10-23T11:00:00.000Z");
  assert.equal(iso(w.to), "2026-10-24T11:00:00.000Z");
  // At 6:59am the last full window is the day before.
  const early = P.emailWindow("2026-10-24T10:59:00Z");
  assert.equal(iso(early.to), "2026-10-23T11:00:00.000Z");
  // Exactly 7:00am closes the window that just ended.
  assert.equal(iso(P.emailWindow("2026-10-24T11:00:00Z").to), "2026-10-24T11:00:00.000Z");
});

test("the email window follows DST: 7am stays 7am across the November change", () => {
  // DST ends Sun Nov 1 2026. Mon Nov 2 7am EST = 12:00Z; Sun Nov 1 7am EST = 12:00Z; Sat Oct 31 7am EDT = 11:00Z.
  const w = P.emailWindow("2026-11-02T15:00:00Z");
  assert.equal(iso(w.from), "2026-11-01T12:00:00.000Z");
  assert.equal(iso(w.to), "2026-11-02T12:00:00.000Z");
  const across = P.emailWindow("2026-11-01T15:00:00Z");
  assert.equal(iso(across.from), "2026-10-31T11:00:00.000Z");
  assert.equal(iso(across.to), "2026-11-01T12:00:00.000Z");
});

test("week to date starts Monday 12:00am New York time", () => {
  assert.equal(iso(P.weekStart("2026-10-24T13:00:00Z", NY)), "2026-10-19T04:00:00.000Z");
  // A Monday just after midnight is its own week.
  assert.equal(iso(P.weekStart("2026-10-26T04:30:00Z", NY)), "2026-10-26T04:00:00.000Z");
  // Sunday 11pm belongs to the week before.
  assert.equal(iso(P.weekStart("2026-10-26T03:30:00Z", NY)), "2026-10-19T04:00:00.000Z");
});

const jobs = [
  { _id: "a", company: "Northwind", title: "Senior PM, Lending", status: "applied", appliedAt: "2026-10-24T03:23:00Z", statusAt: "2026-10-24T03:23:00Z" },
  { _id: "b", company: "Contoso", title: "Staff PM, Payments", status: "applied", appliedAt: "2026-10-23T11:00:00Z", statusAt: "2026-10-23T11:00:00Z" },
  // Started and sent in the same period: listed only under sent.
  { _id: "c", company: "Fabrikam", title: "PM, Checkout", status: "applied", appliedAt: "2026-10-24T01:00:00Z", statusAt: "2026-10-24T01:00:00Z",
    statusHistory: [{ status: "applying", at: "2026-10-23T20:00:00Z" }, { status: "applied", at: "2026-10-24T01:00:00Z" }] },
  { _id: "d", company: "Tailspin", title: "Founders team", status: "applying", statusAt: "2026-10-23T21:10:00Z" },
  { _id: "e", company: "Litware", title: "Principal PM", status: "applying", statusAt: "2026-10-21T14:00:00Z" },
  // Exactly at the end of the period: excluded (end exclusive).
  { _id: "f", company: "Adatum", title: "Senior PM", status: "applied", appliedAt: "2026-10-24T11:00:00Z", statusAt: "2026-10-24T11:00:00Z" },
  { _id: "g", company: "Proseware", title: "PM, Billing", status: "skipped", skippedAt: "2026-10-23T15:00:00Z", skipReason: "Location" },
  { _id: "h", company: "Woodgrove", title: "Senior PM", status: "skipped", skippedAt: "2026-10-20T15:00:00Z", skippedBy: "owner" },
  // Taken out by a criteria cleanup, not by the owner.
  { _id: "k", company: "Blue Yonder", title: "PM, Lending", status: "skipped", skippedAt: "2026-10-23T18:00:00Z", skippedBy: "rule", skipReason: "Hard exclude" },
  { _id: "i", company: "Lucerne", title: "Staff PM", status: "screen", appliedAt: "2026-10-01T15:00:00Z", statusAt: "2026-10-22T15:00:00Z" },
  { _id: "j", company: "Humongous", title: "Senior PM", status: "new", score: 60, firstSeen: "2026-10-23T12:00:00Z" },
];
const period = { from: "2026-10-23T11:00:00Z", to: "2026-10-24T11:00:00Z", tz: NY };

test("periodReport lists sent, started and ruled out inside [from, to) with company, title and time", () => {
  const r = P.periodReport(jobs, period);
  assert.deepEqual(r.sent.map((x) => x.company), ["Contoso", "Fabrikam", "Northwind"]);
  assert.deepEqual(r.started.map((x) => x.company), ["Tailspin"]);
  assert.deepEqual(r.ruledOut.map((x) => x.company), ["Proseware"]);
  assert.deepEqual(r.removedByRules.map((x) => [x.company, x.reason]), [["Blue Yonder", "Hard exclude"]]);
  for (const x of [...r.sent, ...r.started, ...r.ruledOut]) {
    assert.ok(x.company && x.title && x.at, JSON.stringify(x));
  }
  assert.equal(r.sent[0].title, "Staff PM, Payments");
  assert.equal(r.sent[0].at, "2026-10-23T11:00:00Z");
});

test("every count equals its list length", () => {
  const r = P.periodReport(jobs, period);
  assert.deepEqual(r.counts, { sent: r.sent.length, started: r.started.length, ruledOut: r.ruledOut.length, removedByRules: r.removedByRules.length });
  const s = r.snapshot;
  assert.equal(s.counts.startedNotSent, s.startedNotSent.length);
  assert.equal(s.counts.sentNoResponse, s.sentNoResponse.length);
  assert.equal(s.counts.interviewsOffers, s.interviewsOffers.length);
});

test("the snapshot shows where things stand, with each role's since-date", () => {
  const s = P.periodReport(jobs, period).snapshot;
  assert.deepEqual(s.startedNotSent.map((x) => [x.company, x.at]), [["Litware", "2026-10-21T14:00:00Z"], ["Tailspin", "2026-10-23T21:10:00Z"]]);
  assert.deepEqual(s.sentNoResponse.map((x) => x.company).sort(), ["Adatum", "Contoso", "Fabrikam", "Northwind"]);
  assert.deepEqual(s.interviewsOffers.map((x) => x.company), ["Lucerne"]);
  assert.equal(s.counts.newUnreviewed, 1);
});

test("week to date runs from Monday midnight to the end of the period", () => {
  const r = P.periodReport(jobs, period);
  assert.equal(r.weekToDate.from, "2026-10-19T04:00:00.000Z");
  assert.equal(r.weekToDate.sent, 3);
  assert.equal(r.weekToDate.ruledOut, 2);
  assert.equal(r.weekToDate.removedByRules, 1);
});

test("zero-state: an empty period still returns every key, with empty lists and zero counts", () => {
  const r = P.periodReport([], period);
  assert.deepEqual(r.sent, []);
  assert.deepEqual(r.started, []);
  assert.deepEqual(r.ruledOut, []);
  assert.deepEqual(r.removedByRules, []);
  assert.deepEqual(r.counts, { sent: 0, started: 0, ruledOut: 0, removedByRules: 0 });
  assert.deepEqual(r.weekToDate.sent, 0);
  assert.deepEqual(r.snapshot.startedNotSent, []);
  assert.deepEqual(r.snapshot.counts, { startedNotSent: 0, sentNoResponse: 0, interviewsOffers: 0, newUnreviewed: 0 });
});

test("a jobs map keyed by id works the same as a list", () => {
  const map = Object.fromEntries(jobs.map(({ _id, ...j }) => [_id, j]));
  assert.deepEqual(P.periodReport(map, period).counts, P.periodReport(jobs, period).counts);
  assert.equal(P.periodReport(map, period).sent[0].id, "b");
});

test("only skippedBy rule counts as removed by rules; older skips without the field are the owner's", () => {
  assert.equal(P.skippedBy({ status: "skipped" }), "owner");
  assert.equal(P.skippedBy({ status: "skipped", skippedBy: "owner" }), "owner");
  assert.equal(P.skippedBy({ status: "skipped", skippedBy: "Rule" }), "rule");
  const d = P.dashboard(jobs, { now: "2026-10-24T20:00:00Z", tz: "America/New_York" });
  assert.equal(d.week.ruledOut, 2);
  assert.equal(d.week.removedByRules, 1);
});

test("reached counts the furthest step, including history after a rejection", () => {
  assert.equal(P.reached({ status: "rejected", statusHistory: [{ status: "applied" }, { status: "screen" }, { status: "rejected" }] }), "screen");
  assert.equal(P.reached({ status: "rejected", appliedAt: "2026-10-01" }), "applied");
  assert.equal(P.reached({ status: "interviewing" }), "interviewing");
  assert.equal(P.reached({ status: "skipped" }), "");
});

test("benchmarks are the roles at the dream_roles anchor companies", () => {
  const spec = { dream_roles: { like: [{ company: "litware" }, { company: "Nobody Inc" }] } };
  assert.deepEqual(P.benchmarks(jobs, spec).map((x) => [x.company, x.status, x.at]), [["Litware", "applying", "2026-10-21T14:00:00Z"]]);
  assert.deepEqual(P.benchmarks(jobs, {}), []);
});

test("topNew keeps every role tied with the last place instead of cutting it", () => {
  const js = ["A", "B", "C", "D", "E", "F"].map((c, i) => ({ company: c, title: "PM", status: "new", score: i < 1 ? 70 : i < 5 ? 60 : 50 }));
  assert.deepEqual(P.topNew(js, 2).map((x) => x.company), ["A", "B", "C", "D", "E"]);
  assert.deepEqual(P.topNew(js, 6).map((x) => x.company), ["A", "B", "C", "D", "E", "F"]);
  assert.deepEqual(P.topNew([], 4), []);
});

test("dashboard: today counts applications plus follow-ups against the bar", () => {
  // Sat Oct 24 2026; the week runs Mon Oct 19 to Sun Oct 25.
  const now = "2026-10-24T20:00:00Z";
  const js = [
    { company: "A", title: "PM", status: "applied", appliedAt: "2026-10-24T14:00:00Z" },
    { company: "B", title: "PM", status: "applied", appliedAt: "2026-10-20T14:00:00Z", followUpsSent: ["2026-10-24T15:00:00Z"] },
    { company: "C", title: "PM", status: "applied", appliedAt: "2026-10-23T14:00:00Z" },
  ];
  const d = P.dashboard(js, { now, tz: NY });
  assert.deepEqual(d.today, { applied: 1, followUps: 1, total: 2, bar: 3, met: false });
  assert.equal(P.dashboard(js, { now, tz: NY, bar: 2 }).today.met, true);
  assert.equal(d.week.applied, 3);
  assert.deepEqual(d.week.days.map((x) => x.applied), [0, 1, 0, 0, 1, 1, 0]);
  assert.deepEqual(d.week.days.map((x) => x.future), [false, false, false, false, false, false, true]);
});

test("dashboard: funnel, response rate after 14 days, follow-ups due and sector mix", () => {
  const now = "2026-10-24T20:00:00Z";
  const js = [
    { company: "A", title: "PM", sector: "Solar", status: "applied", appliedAt: "2026-10-01T14:00:00Z", followUpDue: "2026-10-08" },
    { company: "B", title: "PM", sector: "Solar", status: "rejected", appliedAt: "2026-10-02T14:00:00Z", statusHistory: [{ status: "screen" }] },
    { company: "C", title: "PM", sector: "Fintech", status: "interviewing", appliedAt: "2026-10-03T14:00:00Z" },
    { company: "D", title: "PM", status: "applied", appliedAt: "2026-10-22T14:00:00Z", followUpDue: "2026-10-29" },
  ];
  const d = P.dashboard(js, { now, tz: NY });
  assert.deepEqual(d.funnel, [{ stage: "applied", count: 4 }, { stage: "screen", count: 2 }, { stage: "interviewing", count: 1 }, { stage: "offer", count: 0 }]);
  // D was applied 2 days ago, too soon to count.
  assert.deepEqual(d.response, { heard: 2, eligible: 3, pct: 67, afterDays: 14 });
  assert.deepEqual(d.followUpsDue.map((x) => x.company), ["A"]);
  assert.deepEqual(d.sectorMix, [{ sector: "Solar", count: 2 }, { sector: "Fintech", count: 1 }, { sector: "Other", count: 1 }]);
});

test("dashboard on no data has a null response rate, not NaN", () => {
  const d = P.dashboard([], { now: "2026-10-24T20:00:00Z", tz: NY });
  assert.equal(d.response.pct, null);
  assert.deepEqual(d.funnel.map((x) => x.count), [0, 0, 0, 0]);
  assert.deepEqual(d.followUpsDue, []);
  assert.deepEqual(d.sectorMix, []);
});

test("scanStale: overdue once a whole weekday passes without a run, weekends skipped (RR-M3.2)", () => {
  // Mon 07:50 ET scan: fresh Mon and Tue, stale Wed.
  assert.equal(P.scanStale("2026-10-26T11:50:00Z", "2026-10-27T13:00:00Z"), false);
  assert.equal(P.scanStale("2026-10-26T11:50:00Z", "2026-10-28T13:00:00Z"), true);
  // Fri scan: fresh through Monday, stale Tuesday.
  assert.equal(P.scanStale("2026-10-23T11:50:00Z", "2026-10-25T13:00:00Z"), false);
  assert.equal(P.scanStale("2026-10-23T11:50:00Z", "2026-10-26T13:00:00Z"), false);
  assert.equal(P.scanStale("2026-10-23T11:50:00Z", "2026-10-27T13:00:00Z"), true);
  // Same day, and days in New York time (Tue 23:30 ET is already Wed in UTC).
  assert.equal(P.scanStale("2026-10-28T11:50:00Z", "2026-10-28T13:00:00Z"), false);
  assert.equal(P.businessDaysSince("2026-10-28T03:30:00Z", "2026-10-28T13:00:00Z"), 1);
  // Unreadable or missing: never stale; a future run counts as fresh.
  assert.equal(P.scanStale("", "2026-10-28T13:00:00Z"), false);
  assert.equal(P.scanStale("not a date", "2026-10-28T13:00:00Z"), false);
  assert.equal(P.scanStale("2026-10-30T11:50:00Z", "2026-10-28T13:00:00Z"), false);
});
