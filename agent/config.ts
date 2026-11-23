// RR-AGENT config: the repo root and the repo-path guard (AG-19). Nothing else lives here.
import { realpathSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

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
