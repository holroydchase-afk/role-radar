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

// ── PS-M4-R1 sanitizer guards (privacy-security, OWASP ASVS 5.3.3) ──────────────────────────────────────────────
// sanitizeHtml needs a real DOM, so these run src/posting.ts (bundled as is) in Chromium. Each attack is sanitized,
// then attached to the live document (so any surviving handler would fire), and the output is checked:
// no script/style/svg/math/img/iframe/form/base/meta/object/video/noscript/details/input elements, no attribute on
// any element except href/target/rel on <a>, every href matching ^https?://, and window.__x never set.
// privacy-security found every case below inert at 342bef4, so these are guards: they pass today and lock it in.
import { buildSync } from "esbuild";
import { chromium } from "playwright";
const ATTACKS: [string, string][] = [
  ["svg + script", `<svg><script>window.__x=1</script><a href="https://ok.invalid/">x</a></svg><svg onload="window.__x=1"></svg>`],
  ["MathML style mXSS", `<math><mtext><table><mglyph><style><img src=x onerror="window.__x=2"></style></mglyph></table></mtext></math>`],
  ["MathML mi style", `<math><mi><style><img src=x onerror=window.__x=2></style></mi></math>`],
  ["noscript title trick", `<noscript><p title="</noscript><img src=x onerror=window.__x=3>">x</p></noscript>`],
  ["mixed-case javascript: with spaces", `<a href="  JaVaScRiPt:window.__x=4">a</a><a href="java\tscript:window.__x=4">b</a><a href="&#106;avascript:window.__x=4">c</a>`],
  ["data: and // links", `<a href="data:text/html,<script>window.__x=5</script>">d</a><a href="//evil.invalid/x">e</a><a href="/relative">f</a>`],
  ["style attributes", `<p style="background:url(javascript:window.__x=6)">s</p><div style="position:fixed;inset:0">cover</div>`],
  ["form, base, meta refresh", `<form action="https://evil.invalid"><input name="q" autofocus onfocus="window.__x=7"><button>go</button></form><base href="https://evil.invalid/"><meta http-equiv="refresh" content="0;url=https://evil.invalid">`],
  ["details ontoggle", `<details open ontoggle="window.__x=8"><summary>s</summary>x</details>`],
  ["video onerror", `<video><source onerror="window.__x=9"></video><video src=x onerror="window.__x=9"></video>`],
  ["object", `<object data="javascript:window.__x=10"></object><embed src="javascript:window.__x=10">`],
  ["id/class clobbering", `<p id="moreBtn" class="btn cta" name="tabs">clobber</p><a id="tabs" class="x" name="y" href="https://ok.invalid/">ok</a><form id="detailsSheet"></form>`],
  ["event handlers on kept tags", `<p onclick="window.__x=11" onmouseover="window.__x=11">p</p><a href="https://ok.invalid/" onclick="window.__x=11" style="color:red" title="t" data-x="1">a</a>`],
];
const BANNED = "script, style, svg, math, img, iframe, form, base, meta, object, embed, video, audio, source, noscript, details, input, button, link, template";
let sanitizerJs: string | null = null;
const bundle = () => sanitizerJs ??= buildSync({ entryPoints: [new URL("../src/posting.ts", import.meta.url).pathname], bundle: true, format: "iife", globalName: "PostingUnderTest", write: false, platform: "browser" }).outputFiles[0].text;

test("PS-M4-R1 sanitizeHtml leaves every known attack inert: no dangerous elements, only href/target/rel on links, http(s) hrefs only", async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.setContent("<!doctype html><html><body><main id=host></main></body></html>");
    await page.addScriptTag({ content: bundle() });
    const bad: string[] = [];
    for (const [name, html] of ATTACKS) {
      const r = await page.evaluate(async ({ html, BANNED }) => {
        const w = window as any; w.__x = undefined;
        const host = document.getElementById("host")!; host.textContent = "";
        const box = document.createElement("div"); host.appendChild(box);
        box.appendChild(w.PostingUnderTest.sanitizeHtml(html, document));
        await new Promise((res) => setTimeout(res, 150));
        const els = [...box.querySelectorAll<HTMLElement>("*")];
        return {
          banned: [...box.querySelectorAll(BANNED)].map((e) => e.tagName.toLowerCase()),
          attrs: els.flatMap((e) => [...e.attributes].filter((a) => !(e.tagName === "A" && ["href", "target", "rel"].includes(a.name))).map((a) => `${e.tagName.toLowerCase()}[${a.name}]`)),
          hrefs: [...box.querySelectorAll("a[href]")].map((a) => a.getAttribute("href") || ""),
          rels: [...box.querySelectorAll("a[href]")].map((a) => a.getAttribute("rel") || ""),
          x: w.__x, base: document.baseURI, clobbered: (document.getElementById("moreBtn") || document.getElementById("tabs")) !== null,
        };
      }, { html, BANNED });
      if (r.banned.length) bad.push(`${name}: kept <${r.banned.join(">, <")}>`);
      if (r.attrs.length) bad.push(`${name}: kept attributes ${r.attrs.join(", ")}`);
      for (const h of r.hrefs) if (!/^https?:\/\//.test(h)) bad.push(`${name}: href '${h}'`);
      for (const rel of r.rels) if (rel !== "noopener noreferrer") bad.push(`${name}: rel '${rel}'`);
      if (r.x !== undefined) bad.push(`${name}: ran (window.__x = ${r.x})`);
      if (/evil/.test(r.base)) bad.push(`${name}: base URL changed to ${r.base}`);
      if (r.clobbered) bad.push(`${name}: an id survived (DOM clobbering)`);
    }
    // Words survive: the sanitizer keeps text, not just nothing.
    const kept = await page.evaluate(() => { const d = document.createElement("div"); d.appendChild((window as any).PostingUnderTest.sanitizeHtml(`<p onclick="x()">Real <b>words</b> <a href="https://ok.invalid/">stay</a></p>`, document)); return d.innerHTML; });
    assert.equal(kept, `<p>Real <b>words</b> <a href="https://ok.invalid/" target="_blank" rel="noopener noreferrer">stay</a></p>`);
    assert.deepEqual(bad, []);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
