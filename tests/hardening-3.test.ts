// Night-shift hardening, round 4 (2026-10-24): edges in the features shipped after PR #31
// (Gmail status check, Ruled out). Each test is named RR-H-<n>; they were written red first.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import type { Browser } from "playwright";
import { buildDemo } from "../scripts/build-demo.mjs";
import { openDemo as open, openTab } from "../scripts/browser.mjs";

import * as G from "../src/gmail-import.ts";
const at = (local: string, domain: string) => [local, domain].join("@");
const smsg = (sender: unknown, date: unknown, subject: string, snippet: string) => ({ sender, date, subject, snippet, labelIds: ["INBOX"] });
const thread = (id: string, messages: unknown[]) => ({ id, messageCount: messages.length, messages });

test("RR-H-9 a short company name doesn't match the tail of another company's email domain", () => {
  const jobs = [{ _id: "v1", company: "Volt", title: "Senior PM, Charging", status: "applied", appliedAt: "2026-03-01" }];
  const other = thread("o", [smsg("Talent <" + at("talent", "revolt.example") + ">", "2026-03-10T12:00:00", "Interview invitation", "We'd like to schedule an interview.")]);
  assert.deepEqual(G.statusUpdates([other], jobs), [], "revolt.example is not Volt");
  const ats = thread("a", [smsg("Recruiting <" + at("no-reply", "mail.revolt.example") + ">", "2026-03-10T12:00:00", "Interview invitation", "")]);
  assert.deepEqual(G.statusUpdates([ats], jobs), [], "mail.revolt.example is not Volt either");
  const own = thread("v", [smsg("Recruiting <" + at("no-reply", "careers.volt.example") + ">", "2026-03-10T12:00:00", "Interview invitation", "")]);
  assert.equal(G.statusUpdates([own], jobs)[0]?.to, "screen", "a subdomain of the company's own domain still matches");
  const dashed = thread("d", [smsg("Recruiting <" + at("no-reply", "volt-energy.example") + ">", "2026-03-10T12:00:00", "Interview invitation", "")]);
  assert.equal(G.statusUpdates([dashed], [{ ...jobs[0], company: "Volt Energy" }])[0]?.to, "screen");
});

let browser: Browser;
before(async () => { browser = await chromium.launch(); });
after(async () => { await browser?.close(); });

const localDay = (d: Date) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");

test("RR-H-10 Ruled out stays newest-first by day when dates mix date-only and full timestamps", async () => {
  // In New York, 23:30 yesterday is already "today" in UTC: a plain string sort put it above today's role.
  const ny = (d: Date) => new Date(d.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const nowNy = ny(new Date());
  const today = localDay(nowNy);
  const y = new Date(nowNy); y.setDate(y.getDate() - 1);
  const lateYesterday = new Date(Date.UTC(y.getFullYear(), y.getMonth(), y.getDate(), 23 + 4, 30)).toISOString(); // 23:30 EDT
  const jobs = {
    a: { company: "Harborline Mutual (demo)", title: "Role A", status: "skipped", skipReason: "Location", skippedAt: today },
    b: { company: "Tidewater Analytics (demo)", title: "Role B", status: "skipped", skipReason: "Culture", skippedAt: lateYesterday },
    c: { company: "Copperleaf Insurance (demo)", title: "Role C", status: "skipped", skipReason: "Not remote", statusAt: today },
  };
  const { page, errors } = await open(browser, { html: buildDemo({ seed: { jobs, companies: {}, recruiters: {}, meta: {} } }), ready: "#tab-inbox", file: "dist/test-h3.html", timezoneId: "America/New_York" });
  await openTab(page, "ruled");
  const heads = await page.locator("#view .ruled h3").allInnerTexts();
  assert.equal(heads.length, 2, "each day appears once: " + heads.join(" | "));
  assert.match(heads[0], /^Today · 2 ruled out$/i);
  assert.deepEqual(errors, []);
  await page.close();
});
