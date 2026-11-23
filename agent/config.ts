// RR-AGENT config: pinned model ids, dated price table, repo-path guard (AG-19).
import { realpathSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Pinned ids, never aliases like "latest".
export const SONNET_MODEL = "claude-sonnet-5-5"; // agent
export const OPUS_MODEL = "claude-opus-5-5"; // grader

// USD per million tokens, from the claude-api skill's model table (cached 2026-11-03):
// Sonnet 5.5 $2 in / $10 out, Opus 5.5 $4 in / $20 out. Standard rates, prompts up to the
// base context; cache and long-context surcharges are not modelled, so usd is an estimate.
export const PRICES_AS_OF = "2026-11-23";
export const PRICES: Record<string, { inputPerMTok: number; outputPerMTok: number }> = {
  [SONNET_MODEL]: { inputPerMTok: 2, outputPerMTok: 10 },
  [OPUS_MODEL]: { inputPerMTok: 4, outputPerMTok: 20 },
};

// Resolve through symlinks, even when the leaf does not exist yet.
function realish(p: string): string {
  const missing: string[] = [];
  let cur = resolve(p);
  for (;;) {
    try {
      const real = realpathSync(cur);
      return missing.length ? join(real, ...missing.reverse()) : real;
    } catch {
      const up = dirname(cur);
      if (up === cur) return resolve(p);
      missing.push(cur.slice(up.length).replace(/^[\\/]+/, ""));
      cur = up;
    }
  }
}

const within = (child: string, parent: string) => child === parent || child.startsWith(parent + sep);

const SHIPPED_READ_ONLY = ["demo/agent/facts.json", "demo/agent/cases.json", "demo/seed.json"];

/** Throws naming envName when path is inside the repo. Only with readOnly, the three exact shipped demo files are allowed. Returns the resolved path. */
export function assertOutsideRepo(path: string, envName: string, opts: { readOnly?: boolean } = {}): string {
  const abs = resolve(path);
  const roots = new Set([REPO_ROOT, realish(REPO_ROOT)]);
  const shipped = new Set<string>();
  if (opts.readOnly) for (const rel of SHIPPED_READ_ONLY) for (const root of roots) shipped.add(join(root, rel));
  for (const p of [abs, realish(abs)]) {
    for (const root of roots) {
      if (within(p, root) && !(opts.readOnly && shipped.has(p))) {
        throw new Error(`${envName} must point outside the repo (real data never lives in a public repo): ${abs}`);
      }
    }
  }
  return abs;
}
