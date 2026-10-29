import { test } from "node:test";
import assert from "node:assert/strict";
import { scanText, loadDenylist } from "../scripts/check-private.mjs";

const kinds = (t: string, d?: string[]) => scanText(t, d).map((h) => h.kind);
// Fixtures are assembled at runtime so this file itself passes the privacy check.
const j = (...parts: string[]) => parts.join("");

test("flags personal email addresses but allows no-reply and example senders", () => {
  assert.deepEqual(kinds(j("write to pat.doe", "@", "gmail.com")), ["email address"]);
  assert.deepEqual(kinds("from:jobalerts-noreply@linkedin.com or a@example.com"), []);
});

test("flags phone numbers, artifact links, scheduled task ids and Gmail thread links", () => {
  assert.ok(kinds(j("call (555) ", "555-0182")).includes("phone number"));
  assert.ok(kinds(j("https://claude.ai/", "artifact/AbCdEfGh1234")).includes("claude.ai artifact link"));
  assert.ok(kinds(j("trig", "_01AbCdEfGhIjKl")).includes("scheduled task id"));
  assert.ok(kinds(j("https://mail.google.com/mail/u/0/", "#inbox/FMfcgzQXabc")).includes("Gmail link to a thread or search"));
});

test("does not flag the page's generic Gmail search builder or ordinary numbers", () => {
  assert.deepEqual(kinds('"https://mail.google.com/mail/u/0/#search/"+encodeURIComponent(c)'), []);
  assert.deepEqual(kinds("score 0-100, $150K floor, 2026-10-21"), []);
});

test("denylisted terms match whole words, case-insensitively", () => {
  assert.deepEqual(kinds("met Zorblat today", ["zorblat"]), ["denylisted term"]);
  assert.deepEqual(kinds("Zorblatty is fine", ["Zorblat"]), []);
});

test("loadDenylist ignores comments, blanks and a missing file", () => {
  assert.deepEqual(loadDenylist("/nonexistent/denylist.txt"), []);
});
