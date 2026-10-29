// Night-shift hardening (2026-10-23): edge cases in the pure modules that a scan, a posting or a
// Gmail thread can hand the page. Each test is named RR-H-<n>; they were written red first.
import { test } from "node:test";
import assert from "node:assert/strict";

import * as S from "../src/scoring.ts";
import * as P from "../src/posting.ts";
import * as G from "../src/gmail-import.ts";
const at = (local: string, domain: string) => [local, domain].join("@");
const msg = (sender: unknown, date: unknown, subject = "Hello") => ({ sender, date, subject, labelIds: ["INBOX"] });
const thread = (id: string, messages: unknown[]) => ({ id, messageCount: messages.length, messages });

test("RR-H-1 a 401(k) mention is not read as a $401K salary", () => {
  assert.deepEqual(S.parseComp("$170K–$205K + equity, 401(k) match"), { min: 170000, max: 205000 });
  assert.deepEqual(S.parseComp("$150,000 - $175,000, 401k with 4% match"), { min: 150000, max: 175000 });
  assert.equal(S.parseComp("Great benefits including a 401(k)"), null);
  const spec = { comp: { stretch_target_usd: 220000 } };
  const r = S.scoreJob({ company: "Acme", title: "Senior Product Manager", fit: "maybe", comp: "$170K–$205K, 401(k)" }, spec);
  assert.equal(r.parts.comp, 0, "no stretch bonus from a retirement plan");
});

test("RR-H-2 an empty comp object counts as no comp, so the floor gate doesn't drop the role", () => {
  assert.equal(S.parseComp({ min: null, max: null }), null);
  assert.equal(S.parseComp({ min: "", max: "" }), null);
  assert.equal(S.parseComp({}), null);
  assert.deepEqual(S.parseComp({ min: 172000, max: null }), { min: 172000, max: 172000 });
  const spec = { comp: { base_floor_usd: 150000 } };
  const m = S.matchJob({ company: "Acme", title: "Senior Product Manager", location: "Remote, US", comp: { min: null, max: null } }, spec);
  assert.deepEqual(m.reasons, []);
});

test("RR-H-3 a malformed posting link doesn't throw; it just has no preview source", () => {
  assert.doesNotThrow(() => P.fromUrl("https://boards.greenhouse.io/%E0%A4%A/jobs/123"));
  assert.equal(P.fromUrl("https://boards.greenhouse.io/%E0%A4%A/jobs/123"), null);
  assert.doesNotThrow(() => P.postingSource({ url: "https://jobs.lever.co/%zz/0c2f6d1e-8a7b-4c3d-9e1f-2a3b4c5d6e7f" }, []));
});

test("RR-H-4 Lever lists without a heading don't add an empty heading", () => {
  const html = P.extractHtml({ ats: "lever" }, { description: "<p>About</p>", lists: [{ text: "", content: "<li>One</li>" }] });
  assert.ok(!/<h3>\s*<\/h3>/.test(html), html);
  assert.match(html, /<li>One<\/li>/);
});

test("RR-H-5 every Gmail suggestion gets a usable, unique key, even for names with no Latin letters", () => {
  const list = G.candidates([
    thread("t1", [msg(`"李明" <${at("li", "gmail.com")}>`, "2026-09-01")]),
    thread("t2", [msg(`"王芳" <${at("wang", "gmail.com")}>`, "2026-09-02")]),
    thread("t3", [msg(`"José Núñez" <${at("jose", "sunfield.example")}>`, "2026-09-03")]),
  ]);
  const keys = list.map((c) => c.key);
  assert.equal(keys.length, 3);
  for (const k of keys) assert.match(k, /^[a-z0-9][a-z0-9-]*$/, "key " + JSON.stringify(k));
  assert.equal(new Set(keys).size, 3, "keys collide: " + keys.join(", "));
  assert.ok(keys.includes("jose-nunez-sunfield"), "accents fold to plain letters: " + keys.join(", "));
});

test("RR-H-6 a sender whose display name is just their address gets a real name from the address", () => {
  const email = at("riley.chen", "sunfield.example");
  const [c] = G.candidates([thread("t1", [msg(`"${email}" <${email}>`, "2026-09-01")])]);
  assert.equal(c.name, "Riley Chen");
});
