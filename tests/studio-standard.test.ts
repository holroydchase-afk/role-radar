// Studio standard (intake #69): CLAUDE.md points at the studio-agents standard, the story-keeper
// agent and the product/eng docs exist, the live-product gate replaces the blanket merge ban,
// agent runs are logged, and none of it carries an email address.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const url = (p: string) => new URL(`../${p}`, import.meta.url);
const read = (p: string) => readFileSync(url(p), "utf8");
const DOCS = ["docs/product/DECISIONS.md", "docs/eng/LESSONS.md", "docs/product/ACCOUNTS.md", "docs/product/MARKETING.md", "docs/eng/AGENT-NOTES.md"];

test("STD-1 CLAUDE.md points at the studio standard and says its own hard rules win", () => {
  const md = read("CLAUDE.md");
  assert.match(md, /Studio standard\.?\*{0,2}:?\s*follow(?: the)? (?:holroydchase-afk\/)?studio-agents(?: repo)?,? ?`?docs\/studio-standard\.md/i, "points at the standard");
  assert.match(md, /this file's hard rules win where they say more/, "own hard rules win");
});

test("STD-2 the agents table has a story-keeper row and the agent file exists", () => {
  assert.match(read("CLAUDE.md"), /^\|\s*[^|]*\|\s*`story-keeper`\s*\|/m, "table row for story-keeper");
  assert.ok(existsSync(url(".claude/agents/story-keeper.md")), ".claude/agents/story-keeper.md exists");
});

test("STD-3 the blanket merge ban is replaced by a live-product gate", () => {
  const md = read("CLAUDE.md");
  assert.ok(!md.includes("Never merge to `main`"), "old blanket rule is gone");
  assert.match(md, /live[- ]product gate/i, "a live-product gate rule exists");
  assert.match(md, /merge[^\n]*(live page|public demo)[^\n]*wait[^\n]*Chase|wait[^\n]*Chase[^\n]*merge[^\n]*(live page|public demo)/i, "merges that change the live page or public demo wait for Chase");
});

test("STD-4 the product and engineering docs exist", () => {
  for (const d of DOCS) assert.ok(existsSync(url(d)), `${d} exists`);
});

test("STD-5 the new docs and CLAUDE.md contain no email addresses", () => {
  for (const f of [...DOCS, "CLAUDE.md"]) {
    assert.ok(existsSync(url(f)), `${f} exists`);
    assert.ok(!/[\w.+-]*@[\w-]+\.[\w.-]+/.test(read(f)), `${f} has no email address`);
  }
});

test("STD-6 agent runs are logged: settings.json wires the logger and both scripts exist", () => {
  assert.ok(read(".claude/settings.json").includes("scripts/log-agent-run.sh"), "settings.json references scripts/log-agent-run.sh");
  assert.ok(existsSync(url("scripts/log-agent-run.sh")), "scripts/log-agent-run.sh exists");
  assert.ok(existsSync(url("scripts/check-agent-runs.sh")), "scripts/check-agent-runs.sh exists");
});

test("STD-7 HANDOFF.md has a status header and lists intake #69 under Done", () => {
  const h = read("HANDOFF.md");
  assert.match(h, /<!-- status[\s\S]*?-->/, "status header exists");
  const done = h.split(/^#{1,3}\s*Done\b.*$/m)[1] || "";
  assert.match(done.split(/^#{1,3}\s/m)[0], /intake #69/i, "Done section mentions intake #69");
});
