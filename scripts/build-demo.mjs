// Builds dist/demo.html: the real page plus an in-memory database seeded with fictional demo data.
// --public builds the hosted demo (chaseholroyd.com/role-radar/): radar only unless the URL has ?full.
// Usage: node scripts/build-demo.mjs [--public] [outFile]
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

export function buildDemo({ seed: seedOverride, publicDemo = false } = {}) {
  const page = read("app/role-radar.html");
  const seed = seedOverride || JSON.parse(read("demo/seed.json"), (k, v) =>
    typeof v === "string" && v.startsWith("@file:") ? read(v.slice(6)) : v);
  const seedJson = JSON.stringify(seed).replace(/</g, "\\u003c");
  const flag = publicDemo ? `<script>window.__RR_PUBLIC__=!new URLSearchParams(location.search).has("full");window.__RR_SHOWCASE__=true;</script>\n` : "";
  const inject = flag + `<script>window.__RR_SEED__=${seedJson};</script>\n<script>${read("demo/mock-claude.js")}</script>\n`;
  const marker = '<script src="https://cdnjs.cloudflare.com/ajax/libs/js-yaml/';
  if (!page.includes(marker)) throw new Error("Could not find the js-yaml script tag to inject before.");
  let out = page;
  for (const name of ["scoring.js", "gmail-import.js", "posting.js", "alerts.js", "progress.js", "recruiter-store.js"]) {
    const tag = `<script src="${name}"></script>`;
    if (!out.includes(tag)) throw new Error(`Could not find the ${name} script tag.`);
    out = out.replace(tag, () => `<script>${read("src/" + name)}</script>`);
  }
  const meta = publicDemo
    ? '<meta name="description" content="Role Radar demo: a job-search radar that scores every role 0-100 against editable criteria. All data is made up."><meta name="robots" content="noindex"><link rel="icon" href="/assets/favicon.svg">'
    : "";
  const head = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">${meta}</head><body>\n`;
  let body = out.replace(marker, () => inject + marker);
  // The public demo inlines js-yaml (MIT, license header kept) so the Criteria tab never depends on a CDN.
  if (publicDemo) {
    const cdn = /<script src="https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/js-yaml\/[^"]+"><\/script>/;
    if (!cdn.test(body)) throw new Error("Could not find the js-yaml script tag to inline.");
    const yaml = read("node_modules/js-yaml/dist/js-yaml.min.js").replace(/<\/script/gi, "<\\/script");
    body = body.replace(cdn, () => `<script>${yaml}</script>`);
  }
  return head + body + "\n</body></html>\n";
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const publicDemo = args.includes("--public");
  const out = args.find((a) => !a.startsWith("--")) || join(root, publicDemo ? "_site/index.html" : "dist/demo.html");
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, buildDemo({ publicDemo }));
  console.log("Wrote " + out);
}
