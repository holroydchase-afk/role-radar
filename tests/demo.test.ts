import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildDemo } from "../scripts/build-demo.mjs";
import { renderScanPrompt } from "../scripts/render-scan-prompt.mjs";
import { scanText } from "../scripts/check-private.mjs";

const seed = JSON.parse(readFileSync(new URL("../demo/seed.json", import.meta.url), "utf8"));

test("every demo recruiter is visibly labeled as demo data", () => {
  for (const [id, r] of Object.entries<{ name: string }>(seed.recruiters)) {
    assert.match(id, /^demo-/);
    assert.match(r.name, /\(demo\)$/);
  }
});

test("demo seed links only to example.com and carries no personal data patterns", () => {
  for (const j of Object.values<{ url?: string }>(seed.jobs)) if (j.url) assert.match(j.url, /^https:\/\/example\.com\//);
  assert.deepEqual(scanText(JSON.stringify(seed)), []);
});

test("demo build injects the seed and mock database ahead of the page scripts", () => {
  const html = buildDemo();
  assert.ok(html.indexOf("window.__RR_SEED__") < html.indexOf("js-yaml.min.js"));
  assert.ok(html.includes("window.__RR_DEMO__ = true"));
  assert.ok(html.includes("owner: Demo Candidate"), "criteria spec is inlined from criteria.yaml");
  assert.ok(!/<\/script>(?![\s\S]*<script)/.test(html.split("window.__RR_SEED__=")[1].split(";</script>")[0]));
});

test("scan prompt renders every placeholder from a profile", () => {
  const profile = JSON.parse(readFileSync(new URL("../demo/profile.json", import.meta.url), "utf8"));
  const out = renderScanPrompt(profile);
  assert.ok(!/\{\{[A-Z_]+\}\}/.test(out));
  assert.ok(out.startsWith("You are running Demo Candidate's weekday job scan."));
  assert.throws(() => renderScanPrompt({ ...profile, TRACKER_URL: "" }), /missing: TRACKER_URL/);
});

test("injected data survives $-patterns that String.replace would expand", () => {
  const tricky = "Pays $' and $& and $1";
  const html = buildDemo({ seed: { jobs: { x: { company: tricky } } } });
  assert.ok(html.includes(JSON.stringify(tricky)));
});
