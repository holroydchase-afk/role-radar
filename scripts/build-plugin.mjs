// Assembles plugin/ for distribution: the built page (app/role-radar.html + build/*.js), the MCP server bundled
// into one file (no npm install for users), and the stdlib board reader. Run: npm run build:plugin
// The outputs are committed so `/plugin install` works from a plain clone. tests/plugin.test.ts checks they match.
import { buildSync } from "esbuild";
import { cpSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ENTRIES, bundle } from "./build.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "plugin");
mkdirSync(join(out, "page"), { recursive: true });
mkdirSync(join(out, "mcp"), { recursive: true });
cpSync(join(root, "app", "role-radar.html"), join(out, "page", "role-radar.html"));
cpSync(join(root, "app", "capabilities.json"), join(out, "page", "capabilities.json"));
for (const name of Object.keys(ENTRIES)) writeFileSync(join(out, "page", name + ".js"), bundle(name));
const r = buildSync({
  entryPoints: [join(root, "mcp", "server.ts")], bundle: true, format: "esm", platform: "node", target: "node20",
  write: false, logLevel: "silent",
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
});
writeFileSync(join(out, "mcp", "server.mjs"), r.outputFiles[0].text);
console.log("plugin/ rebuilt:", Object.keys(ENTRIES).length, "page scripts + mcp/server.mjs");
