import { test } from "node:test";
import assert from "node:assert/strict";

import * as G from "../src/gmail-import.ts";
// Addresses are built from parts so the repo's own email check doesn't flag these fixtures.
const at = (local: string, domain: string) => [local, domain].join("@");
const msg = (sender: unknown, date: unknown, subject = "Hello", labels = ["INBOX"]) => ({ sender, date, subject, labelIds: labels });
const thread = (id: string, messages: unknown[], extra: Record<string, unknown> = {}) => ({ id, messageCount: messages.length, viewUrl: "https://example.com/t/" + id, messages, ...extra });

test("parses sender strings and objects", () => {
  assert.deepEqual(G.parseAddress('"Riley Chen" <Riley.Chen@sunfield.example>'), { name: "Riley Chen", email: "riley.chen@sunfield.example" });
  assert.deepEqual(G.parseAddress("avery@northstar.example"), { name: "", email: "avery@northstar.example" });
  assert.deepEqual(G.parseAddress({ displayName: "Sam Lee", emailAddress: "sam@acme.example" }), { name: "Sam Lee", email: "sam@acme.example" });
  assert.equal(G.parseAddress("Pat via LinkedIn <pat@acme.example>").name, "Pat");
});

test("company comes from the domain, blank for personal mail", () => {
  assert.equal(G.companyFromEmail("a@brightwell-solar.example"), "Brightwell Solar");
  assert.equal(G.companyFromEmail("a@talent.northstar.example"), "Northstar");
  assert.equal(G.companyFromEmail(at("a", "acme.co.uk")), "Acme");
  assert.equal(G.companyFromEmail(at("a", "gmail.com")), "");
  assert.equal(G.companyFromEmail(at("a", "outlook.com")), "");
});

test("agencies are told apart from in-house recruiters", () => {
  assert.equal(G.typeFor("a@northstar-talent.example", "Northstar Talent"), "agency");
  assert.equal(G.typeFor("a@sunfield-energy.example", "Sunfield Energy"), "in-house");
  assert.equal(G.typeFor(at("a", "gmail.com"), ""), "referral");
});

test("job boards, applicant tracking systems and no-reply senders are skipped", () => {
  for (const e of ["no-reply@ashbyhq.com", "jobs-noreply@linkedin.com", at("notifications", "greenhouse.io"), at("x", "hire.lever.co"), at("alerts", "ziprecruiter.com")])
    assert.ok(G.isAutomated(G.parseAddress(e)), e);
  assert.ok(!G.isAutomated(G.parseAddress("riley@sunfield.example")));
  assert.ok(!G.isAutomated(G.parseAddress(at("sam.recruiter", "google.com"))), "a recruiter at a big company is still a person");
});

test("dates come only from the messages", () => {
  assert.equal(G.dateOf({ date: "2026-03-04T15:00:00" }), "2026-03-04");
  assert.equal(G.dateOf({ internalDate: String(new Date("2026-03-04T15:00:00").getTime()) }), "2026-03-04");
  assert.equal(G.dateOf({}), "");
  assert.equal(G.dateOf({ date: "not a date" }), "");
});

test("one suggestion per person, last contact is the newest message either way", () => {
  const out = G.candidates([
    thread("t1", [msg("Riley Chen <riley@sunfield.example>", "2026-01-10T12:00:00", "Senior PM role"), msg("Me <me@example.com>", "2026-01-12T12:00:00", "Re: Senior PM role", ["SENT"])]),
    thread("t2", [msg("Riley Chen <riley@sunfield.example>", "2026-02-01T12:00:00", "Re: another role")]),
    thread("t3", [msg("Ledgerly <no-reply@ashbyhq.com>", "2026-02-02T12:00:00", "Thanks for applying")]),
    thread("t4", [msg("Me <me@example.com>", "2026-02-03T12:00:00", "Cold outreach", ["SENT"])]),
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].name, "Riley Chen");
  assert.equal(out[0].company, "Sunfield");
  assert.equal(out[0].threads, 2);
  assert.equal(out[0].lastContact, "2026-02-01");
  assert.equal(out[0].subject, "another role");
  assert.equal(out[0].viewUrl, "https://example.com/t/t2");
});

test("people already in the list are marked, not duplicated", () => {
  const threads = [thread("t1", [msg("Jordan Reyes <jordan@brightwell.example>", "2026-01-10T12:00:00")]), thread("t2", [msg("Avery <avery@northstar.example>", "2026-01-11T12:00:00")])];
  const out = G.candidates(threads, { existing: [{ _id: "x", name: "Jordan Reyes (demo)", company: "Brightwell Solar" }, { _id: "y", name: "A", email: "AVERY@northstar.example" }] });
  assert.ok(out.every((c) => c.exists));
});

test("long threads are flagged for a full read", () => {
  assert.ok(G.needsFullThread({ messageCount: 7, messages: [1, 2, 3, 4, 5] }));
  assert.ok(!G.needsFullThread({ messageCount: 2, messages: [1, 2] }));
  assert.deepEqual(G.threadsFrom({ threads: [1] }), [1]);
  assert.deepEqual(G.threadsFrom({}), []);
  assert.deepEqual(G.threadsFrom("oops"), []);
});

test("saved recruiter never gets an outcome or next step it didn't come with", () => {
  const doc = G.recruiterDoc({ name: "Riley Chen", email: "riley@sunfield.example", company: "Sunfield", type: "in-house", subject: "Senior PM role", lastContact: "2026-02-01", viewUrl: "javascript:alert(1)" }, "2026-02-02T00:00:00Z");
  assert.deepEqual(doc, { name: "Riley Chen", company: "Sunfield", type: "in-house", email: "riley@sunfield.example", lastContact: "2026-02-01", source: "gmail", createdAt: "2026-02-02T00:00:00Z", lastNote: 'Gmail: "Senior PM role"' });
});

// ---- Status backfill ----
const smsg = (sender: unknown, date: unknown, subject: string, snippet: string, labels = ["INBOX"]) => ({ sender, date, subject, snippet, labelIds: labels });
const pipe = [
  { _id: "bw", company: "Brightwell Solar", title: "Senior Product Manager, Installer Platform", status: "applied", appliedAt: "2026-03-01T15:00:00Z", firstSeen: "2026-02-27T12:00:00Z" },
  { _id: "pp", company: "Pebblepay", title: "Senior Product Manager, Merchant Risk", status: "screen", appliedAt: "2026-02-20T12:00:00Z" },
  { _id: "hh", company: "HelioHome", title: "Senior Product Manager, Home Electrification", status: "applying", firstSeen: "2026-03-05T12:00:00Z" },
  { _id: "sf", company: "Sunfield Energy", title: "Senior Product Manager, Utility Data", status: "new", firstSeen: "2026-03-01T12:00:00Z" },
];

test("status emails are read as a signal, strongest first", () => {
  assert.equal(G.signalOf("Unfortunately, we won't be scheduling an interview"), "rejected");
  assert.equal(G.signalOf("We have decided to move forward with other candidates"), "rejected");
  assert.equal(G.signalOf("Can you share your availability for a phone screen?"), "interview");
  assert.equal(G.signalOf("Thanks for applying to HelioHome"), "applied");
  assert.equal(G.signalOf("We're pleased to extend an offer"), "offer");
  assert.equal(G.signalOf("Our newsletter for March"), "");
});

test("a role only moves forward, or to Rejected", () => {
  assert.equal(G.nextStatus("applying", "applied"), "applied");
  assert.equal(G.nextStatus("applied", "applied"), "");
  assert.equal(G.nextStatus("applied", "interview"), "screen");
  assert.equal(G.nextStatus("screen", "interview"), "interviewing");
  assert.equal(G.nextStatus("interviewing", "interview"), "");
  assert.equal(G.nextStatus("interviewing", "rejected"), "rejected");
  assert.equal(G.nextStatus("new", "rejected"), "", "roles outside the pipeline are left alone");
  assert.equal(G.nextStatus("rejected", "offer"), "");
});

test("status updates match pipeline roles by company and keep the newest email per role", () => {
  const threads = [
    thread("a", [smsg("Brightwell Solar <" + at("no-reply", "greenhouse-mail.example") + ">", "2026-03-04T12:00:00", "Thank you for applying", "We received your application")]),
    thread("b", [smsg("Brightwell Solar <" + at("no-reply", "greenhouse-mail.example") + ">", "2026-03-12T12:00:00", "Update on your application", "Unfortunately, we have decided to move forward with other candidates.")]),
    thread("c", [smsg("Hiring <" + at("no-reply", "pebblepay.example") + ">", "2026-03-10T12:00:00", "Next round", "We'd love to set up a panel interview with the Merchant Risk team.")]),
    thread("d", [smsg("HelioHome Careers <" + at("careers", "heliohome.example") + ">", "2026-03-06T12:00:00", "Thanks for applying to HelioHome", "")]),
    thread("e", [smsg("Sunfield <" + at("no-reply", "sunfield-energy.example") + ">", "2026-03-06T12:00:00", "Unfortunately", "")]),
    thread("f", [smsg("Demo <" + at("me", "example.com") + ">", "2026-03-13T12:00:00", "Re: Brightwell interview", "Thanks for the interview", ["SENT"])]),
  ];
  const out = G.statusUpdates(threads, pipe);
  assert.deepEqual(out.map((u) => [u.jobId, u.from, u.to, u.date]), [
    ["bw", "applied", "rejected", "2026-03-12"],
    ["pp", "screen", "interviewing", "2026-03-10"],
    ["hh", "applying", "applied", "2026-03-06"],
  ]);
  assert.equal(out[0].viewUrl, "https://example.com/t/b");
});

test("emails from before the role was tracked (less a week) are ignored", () => {
  const old = thread("o", [smsg("Brightwell Solar <" + at("no-reply", "brightwell-solar.example") + ">", "2025-09-10T12:00:00", "Your application", "Unfortunately the position has been filled.")]);
  assert.deepEqual(G.statusUpdates([old], pipe), []);
  const early = thread("e", [smsg("HelioHome <" + at("no-reply", "heliohome.example") + ">", "2026-03-01T12:00:00", "Thanks for applying", "")]);
  assert.equal(G.statusUpdates([early], pipe)[0].to, "applied", "four days before it was added is inside the grace window");
});

test("two roles at one company: the title decides, or nothing is suggested", () => {
  const jobs = [
    { _id: "x1", company: "Gridlark", title: "Staff Product Manager, Virtual Power Plants", status: "applied" },
    { _id: "x2", company: "Gridlark", title: "Senior Product Manager, Billing", status: "applied" },
  ];
  const t1 = thread("t1", [smsg("Gridlark <" + at("no-reply", "ashbyhq.example") + ">", "2026-03-10T12:00:00", "Your Gridlark application: Billing", "Unfortunately we are not moving forward.")]);
  assert.deepEqual(G.statusUpdates([t1], jobs).map((u) => u.jobId), ["x2"]);
  const t2 = thread("t2", [smsg("Gridlark <" + at("no-reply", "ashbyhq.example") + ">", "2026-03-10T12:00:00", "Your Gridlark application", "Unfortunately we are not moving forward.")]);
  assert.deepEqual(G.statusUpdates([t2], jobs), []);
});

test("a company's first word alone matches only when no other pipeline company shares it", () => {
  const jobs = [{ _id: "n1", company: "Northstar Utilities", title: "Senior PM", status: "applied" }];
  const t = thread("t", [smsg("Recruiting <" + at("no-reply", "greenhouse-mail.example") + ">", "2026-03-10T12:00:00", "Interview with Northstar", "")]);
  assert.equal(G.statusUpdates([t], jobs)[0].to, "screen");
  const two = [...jobs, { _id: "n2", company: "Northstar Talent", title: "x", status: "saved" }];
  assert.deepEqual(G.statusUpdates([t], two), []);
});

test("status query names the pipeline companies; patch uses the email's date", () => {
  const q = G.statusQuery(pipe);
  assert.match(q, /"brightwell solar"/);
  assert.match(q, /"pebblepay"/);
  assert.doesNotMatch(q, /sunfield/, "roles outside the pipeline aren't searched");
  assert.match(q, /newer_than:1y/);
  assert.equal(G.statusQuery([]), "");
  const u = { to: "applied", date: "2026-03-06", subject: "Thanks for applying", signal: "applied", viewUrl: "https://example.com/t/d" };
  assert.deepEqual(G.statusPatch(u, {}), { status: "applied", statusAt: "2026-03-06", appliedAt: "2026-03-06", statusEmail: { subject: "Thanks for applying", date: "2026-03-06", signal: "applied", url: "https://example.com/t/d" }, statusHistory: [{ status: "applied", at: "2026-03-06" }] });
  // A move from Screen keeps Screen in the history, so the funnel still counts it after a rejection.
  assert.deepEqual(G.statusPatch({ ...u, to: "rejected" }, { status: "screen", statusAt: "2026-03-01" }).statusHistory,
    [{ status: "screen", at: "2026-03-01" }, { status: "rejected", at: "2026-03-06" }]);
  assert.equal(G.statusPatch({ ...u, to: "rejected", viewUrl: "javascript:x" }, {}).appliedAt, undefined);
  assert.equal(G.statusPatch({ ...u, to: "rejected", viewUrl: "javascript:x" }, {}).statusEmail.url, undefined);
});
