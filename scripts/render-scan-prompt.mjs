// Fills scan/scan-prompt.template.md with a profile and prints the prompt for the scheduled scan.
// Usage: node scripts/render-scan-prompt.mjs [profile.json]   (default: profile.local.json, else demo/profile.json)
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** @param {Record<string, unknown>} profile @param {string} [template] @returns {string} */
export function renderScanPrompt(profile, template = readFileSync(join(root, "scan/scan-prompt.template.md"), "utf8")) {
  const missing = new Set();
  const out = template
    .replace(/^<!--.*?-->\n/, "")
    .replace(/\{\{([A-Z_]+)\}\}/g, (_, k) => {
      const v = profile[k];
      if (typeof v !== "string" || !v.trim()) { missing.add(k); return `{{${k}}}`; }
      return v.trim();
    });
  if (missing.size) throw new Error("Profile is missing: " + [...missing].join(", "));
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const p = process.argv[2] || (existsSync(join(root, "profile.local.json")) ? join(root, "profile.local.json") : join(root, "demo/profile.json"));
  process.stdout.write(renderScanPrompt(JSON.parse(readFileSync(p, "utf8"))));
}
