// RR-AGENT config: pinned model ids, dated price table, repo-path guard (AG-19).
import { realpathSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Pinned ids, never aliases like "latest".
export const SONNET_MODEL = "claude-sonnet-5-5"; // agent
export const OPUS_MODEL = "claude-opus-5-5"; // grader

// UNVERIFIED ESTIMATES: these prices were not checked against the vendor's
// price list and may be stale. usd in the log is an estimate; check the
// vendor's current pricing before trusting a cap. USD per million tokens.
export const PRICES_AS_OF = "2026-11-23";
export const PRICES: Record<string, { inputPerMTok: number; outputPerMTok: number }> = {
  [SONNET_MODEL]: { inputPerMTok: 3, outputPerMTok: 15 },
  [OPUS_MODEL]: { inputPerMTok: 15, outputPerMTok: 75 },
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

/** Throws naming envName when path is inside the repo (except demo/). Returns the resolved path. */
export function assertOutsideRepo(path: string, envName: string): string {
  const abs = resolve(path);
  const roots = new Set([REPO_ROOT, realish(REPO_ROOT)]);
  for (const p of [abs, realish(abs)]) {
    for (const root of roots) {
      if (within(p, root) && !within(p, join(root, "demo"))) {
        throw new Error(`${envName} must point outside the repo (real data never lives in a public repo): ${abs}`);
      }
    }
  }
  return abs;
}
