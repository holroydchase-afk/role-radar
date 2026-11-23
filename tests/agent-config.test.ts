/* RR-AGENT v2: repo-path guard (AG-19, kept) and demo facts. Made-up data only. No network.
 *
 * agent/config.ts exports:
 * (v2: model ids, PRICES and PRICES_AS_OF are gone: AGV2-2; see agent-privacy.test.ts)
 *   assertOutsideRepo(path, envName)  throws an Error naming envName when the resolved path (.. segments resolved) is inside the repo tree.
 *       Exception: paths under <repo>/demo/ (made-up data). Returns the resolved absolute path otherwise.
 * demo/agent/facts.json: { facts: [{ id, text, tags: string[] }], ... } made up, labeled as demo.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { assertOutsideRepo } from "../agent/config.ts";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");

test("AG-19 a facts path inside the repo tree is refused, naming ROLE_RADAR_FACTS", () => {
  for (const p of [join(REPO, "facts.json"), join(REPO, "agent", "facts.json"), join(REPO, "docs", "me", "facts.json"), join(REPO, "demo", "..", "facts.json"), resolve(REPO, "agent/../facts.json")]) {
    assert.throws(() => assertOutsideRepo(p, "ROLE_RADAR_FACTS"), /ROLE_RADAR_FACTS/, p);
  }
});

test("AG-19 a repo-root path itself is refused, and a symlink pointing into the repo is refused", () => {
  assert.throws(() => assertOutsideRepo(REPO, "ROLE_RADAR_FACTS"), /ROLE_RADAR_FACTS/);
  const d = mkdtempSync(join(tmpdir(), "rr-agent-c-"));
  try {
    symlinkSync(join(REPO, "package.json"), join(d, "facts.json"));
    assert.throws(() => assertOutsideRepo(join(d, "facts.json"), "ROLE_RADAR_FACTS"), /ROLE_RADAR_FACTS/);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("AG-19 paths outside the repo and the made-up demo folder are allowed", () => {
  const out = join(tmpdir(), "somewhere", "facts.json");
  assert.equal(assertOutsideRepo(out, "ROLE_RADAR_FACTS"), resolve(out));
  const demo = join(REPO, "demo", "agent", "facts.json");
  assert.equal(assertOutsideRepo(demo, "ROLE_RADAR_FACTS", { readOnly: true }), demo); // PS-R1: demo/ is read-only-exact now
});

test("AG-19 a prefix-sibling of the repo (same name plus suffix) is not mistaken for inside", () => {
  assert.doesNotThrow(() => assertOutsideRepo(REPO + "-private/facts.json", "ROLE_RADAR_FACTS"));
});

// --- demo facts ---
const raw = readFileSync(join(REPO, "demo", "agent", "facts.json"), "utf8");
const doc = JSON.parse(raw);

test("AG-19 demo facts: at least 6 facts, each {id, text, tags[]}, ids unique", () => {
  assert.ok(Array.isArray(doc.facts) && doc.facts.length >= 6);
  const ids = new Set<string>();
  for (const f of doc.facts) {
    assert.equal(typeof f.id, "string");
    assert.ok(f.id.length > 0 && !/\s/.test(f.id), `id ${f.id}`);
    assert.equal(typeof f.text, "string");
    assert.ok(f.text.length > 10);
    assert.ok(Array.isArray(f.tags) && f.tags.length >= 1 && f.tags.every((t: unknown) => typeof t === "string"));
    assert.ok(!ids.has(f.id), `duplicate ${f.id}`);
    ids.add(f.id);
  }
});

test("AG-19 demo facts are labeled made up and hold no emails, links or phone numbers", () => {
  assert.match(raw, /made[- ]up|fictional|demo/i);
  assert.ok(!raw.includes("@"), "no @ addresses");
  assert.ok(!/https?:\/\/|www\./i.test(raw), "no links");
  assert.ok(!/\(?\b\d{3}\)?[-. ]\d{3}[-. ]\d{4}\b/.test(raw), "no phone numbers");
});
