// Unit tests for src/posting.ts: finding a role's public job-board API and reading its description.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import * as P from "../src/posting.ts";
const seed = JSON.parse(readFileSync(new URL("../demo/seed.json", import.meta.url), "utf8"));
const companies = Object.entries<Record<string, any>>(seed.companies).map(([_id, c]) => ({ ...c, _id }));
const UUID = "0c2f6d1e-8a7b-4c3d-9e1f-2a3b4c5d6e7f";

test("posting links on each board resolve to slug and job id", () => {
  assert.deepEqual(P.fromUrl("https://job-boards.greenhouse.io/acme/jobs/6098827004"), { ats: "greenhouse", slug: "acme", id: "6098827004", eu: false });
  assert.deepEqual(P.fromUrl("https://boards.greenhouse.io/acme/jobs/123?gh_src=x"), { ats: "greenhouse", slug: "acme", id: "123", eu: false });
  assert.deepEqual(P.fromUrl("https://boards.greenhouse.io/embed/job_app?for=acme&token=456"), { ats: "greenhouse", slug: "acme", id: "456", eu: false });
  assert.deepEqual(P.fromUrl(`https://jobs.ashbyhq.com/acme/${UUID}/application`), { ats: "ashby", slug: "acme", id: UUID, eu: false });
  assert.deepEqual(P.fromUrl(`https://jobs.lever.co/acme/${UUID}`), { ats: "lever", slug: "acme", id: UUID, eu: false });
  assert.equal(P.fromUrl(`https://jobs.eu.lever.co/acme/${UUID}`)?.eu, true);
  assert.equal(P.fromUrl("https://www.ziprecruiter.com/c/Acme/Job/x"), null);
  assert.equal(P.fromUrl("javascript:alert(1)"), null);
  assert.equal(P.fromUrl(""), null);
});

test("scan jobs without a board link resolve through their doc id and company", () => {
  assert.deepEqual(P.postingSource({ _id: "greenhouse-1001", ats: "greenhouse", company: "Sunfield Energy", url: "https://example.com/x" }, companies),
    { ats: "greenhouse", slug: "sunfield", id: "1001", eu: false });
  assert.deepEqual(P.postingSource({ _id: "lever-1004", source: "lever", company: "Orbitline" }, companies), { ats: "lever", slug: "orbitline", id: "1004", eu: false });
  assert.deepEqual(P.postingSource({ _id: "ashby-abc", ats: "ashby", companyId: "ashby-acme", company: "Whoever" }, []), { ats: "ashby", slug: "acme", id: "abc", eu: false });
  // Company name must match on the same board.
  assert.equal(P.postingSource({ _id: "ashby-1", ats: "ashby", company: "Sunfield Energy" }, companies), null);
});

test("manual and alert roles with a board link still get a preview", () => {
  assert.equal(P.postingSource({ _id: "manual-acme-pm", source: "manual", url: "https://job-boards.greenhouse.io/acme/jobs/9" })?.slug, "acme");
});

test("other sources have no preview source", () => {
  for (const j of Object.entries<Record<string, any>>(seed.jobs).map(([_id, j]): Record<string, any> => ({ ...j, _id })).filter((j) => !["greenhouse", "ashby", "lever"].includes(j.ats)))
    assert.equal(P.postingSource(j, companies), null, j._id);
});

test("api urls are the public board endpoints, with slugs encoded", () => {
  assert.equal(P.apiUrl({ ats: "greenhouse", slug: "acme", id: "1" }), "https://boards-api.greenhouse.io/v1/boards/acme/jobs/1");
  assert.equal(P.apiUrl({ ats: "ashby", slug: "a b", id: "1" }), "https://api.ashbyhq.com/posting-api/job-board/a%20b");
  assert.equal(P.apiUrl({ ats: "lever", slug: "acme", id: "x", eu: true }), "https://api.eu.lever.co/v0/postings/acme/x?mode=json");
  assert.equal(P.apiUrl({ ats: "lever", slug: "../x", id: "y" }), "https://api.lever.co/v0/postings/..%2Fx/y?mode=json");
});

test("greenhouse content is decoded once, keeping literal entities in the text", () => {
  const src = { ats: "greenhouse", slug: "acme", id: "1" };
  assert.equal(P.extractHtml(src, { content: "&lt;p&gt;Pay &amp;amp; perks &amp;mdash; $200,700&amp;mdash;$250,900&lt;/p&gt;" }), "<p>Pay &amp; perks &mdash; $200,700&mdash;$250,900</p>");
  assert.equal(P.decodeEntities("&#8212;&#x2014;&nbsp;&bogus;"), "—— &bogus;");
  assert.equal(P.extractHtml(src, {}), "");
});

test("ashby picks the matching job off the board", () => {
  const data = { jobs: [{ id: "a", descriptionHtml: "<p>A</p>" }, { id: "b", descriptionPlain: "B & <b>" }] };
  assert.equal(P.extractHtml({ ats: "ashby", id: "a" }, data), "<p>A</p>");
  assert.equal(P.extractHtml({ ats: "ashby", id: "b" }, data), "<p>B &amp; &lt;b&gt;</p>");
  assert.equal(P.extractHtml({ ats: "ashby", id: "zzz" }, data), "");
});

test("lever joins description, lists and closing text", () => {
  const html = P.extractHtml({ ats: "lever", id: "x" }, { description: "<div>Intro</div>", lists: [{ text: "You <will>", content: "<li>Ship</li>" }], additional: "<div>Pay</div>" });
  assert.equal(html, "<div>Intro</div><h3>You &lt;will&gt;</h3><ul><li>Ship</li></ul><div>Pay</div>");
  assert.equal(P.extractHtml({ ats: "lever", id: "x" }, { ok: false }), "");
});
