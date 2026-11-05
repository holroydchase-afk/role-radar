/* The Claude plugin (plugin/ + .claude-plugin/marketplace.json): manifests parse, the committed page and MCP bundle
 * match the sources (run `npm run build:plugin` when this fails), the bundled server answers without node_modules,
 * and nothing personal ships. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { bundle, ENTRIES } from "../scripts/build.mjs";

const read = (p: string) => readFileSync(new URL("../" + p, import.meta.url), "utf8");

test("manifests parse and the marketplace points at ./plugin", () => {
  const plugin = JSON.parse(read("plugin/.claude-plugin/plugin.json"));
  assert.equal(plugin.name, "role-radar");
  const market = JSON.parse(read(".claude-plugin/marketplace.json"));
  assert.equal(market.plugins[0].source, "./plugin");
  assert.ok(JSON.parse(read("plugin/.mcp.json")).mcpServers["role-radar"]);
});

test("every command and skill has front matter", () => {
  for (const f of ["commands/radar-setup", "commands/scan", "commands/radar", "commands/assess", "skills/radar-setup/SKILL", "skills/radar-scan/SKILL", "skills/radar-chat/SKILL"])
    assert.match(read(`plugin/${f}.md`), /^---\n[\s\S]*?description:/, f);
});

test("the shipped page matches the app sources", () => {
  assert.equal(read("plugin/page/role-radar.html"), read("app/role-radar.html"));
  assert.equal(read("plugin/page/capabilities.json"), read("app/capabilities.json"));
  for (const name of Object.keys(ENTRIES)) assert.equal(read(`plugin/page/${name}.js`), bundle(name), name);
});

test("the bundled MCP server lists its tools with no dependencies installed", () => {
  const input = [
    '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}',
    '{"jsonrpc":"2.0","method":"notifications/initialized"}',
    '{"jsonrpc":"2.0","id":2,"method":"tools/list"}',
  ].join("\n") + "\n";
  const r = spawnSync("node", [new URL("../plugin/mcp/server.mjs", import.meta.url).pathname], { input, encoding: "utf8", timeout: 8000, env: { ...process.env, ROLE_RADAR_CRITERIA: new URL("../criteria.yaml", import.meta.url).pathname } });
  for (const tool of ["score_job", "match_job", "explain_score", "get_criteria"]) assert.match(r.stdout, new RegExp(tool));
});

test("the plugin ships no personal data", () => {
  const files = ["README.md", "example-criteria.yaml", ...readdirSync(new URL("../plugin/commands", import.meta.url)).map((f) => "commands/" + f)];
  for (const f of files) {
    assert.doesNotMatch(read("plugin/" + f), /[\w.+-]+@(?!example\.)[\w-]+\.\w+/, f);
    assert.doesNotMatch(read("plugin/" + f), /claude\.ai\/(code\/)?artifact\//, f);
  }
  assert.ok(existsSync(new URL("../plugin/scripts/fetch-boards.py", import.meta.url)));
});
