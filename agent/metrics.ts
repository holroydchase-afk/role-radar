// RR-AGENT metrics: counts come only from the tracker file; tokens and cost only from stamped *-job-hunt.md run logs. Read-only.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { isHumanSent } from "./tracker.ts";

export type Metrics = {
  rolesFound: number; drafts: number; sent: number; responses: number; interviews: number;
  tokens: number | null; cost: string | null; note: string;
};

function rows(path: string): Record<string, any>[] {
  if (!existsSync(path)) return [];
  const out: Record<string, any>[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      if (r && typeof r === "object") out.push(r);
    } catch { /* a torn line is skipped, never guessed at */ }
  }
  return out;
}

/** The key: value lines of the agentrun block in a run log. */
function runFields(text: string): Record<string, string> {
  const block = /```agentrun\n([\s\S]*?)```/.exec(text)?.[1] ?? "";
  const out: Record<string, string> = {};
  for (const line of block.split("\n")) {
    const m = /^([a-z_]+):\s*(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

export function computeMetrics(o: { trackerPath: string; runsDir: string }): Metrics {
  const reached = new Map<string, Set<string>>(); // roleId -> every status it ever reached
  for (const r of rows(o.trackerPath)) {
    if (typeof r.roleId !== "string") continue;
    if (r.type === "role") {
      if (!reached.has(r.roleId)) reached.set(r.roleId, new Set(["found"]));
    } else if (r.type === "status" && typeof r.status === "string") {
      if (r.status === "sent" && !isHumanSent(r)) continue; // forged or model-set sent rows are not counted
      reached.get(r.roleId)?.add(r.status);
    }
  }
  const ever = (s: string) => [...reached.values()].filter((set) => set.has(s)).length;

  let tokens: number | null = null;
  let amount = 0;
  let priced = true;
  if (existsSync(o.runsDir)) {
    for (const name of readdirSync(o.runsDir).sort()) {
      if (!/-job-hunt\.md$/.test(name)) continue;
      const f = runFields(readFileSync(join(o.runsDir, name), "utf8"));
      if (f.stamped !== "yes") continue;
      tokens = (tokens ?? 0) + ["stamp_input", "stamp_output", "stamp_cache_creation", "stamp_cache_read"].reduce((a, k) => a + (Number(f[k]) || 0), 0);
      const measured = f.stamp_prices !== undefined && !/not measured/i.test(f.stamp_cost ?? "");
      if (measured) amount += Number(f.cost_usd) || 0; else priced = false;
    }
  }

  return {
    rolesFound: reached.size, drafts: ever("drafted"), sent: ever("sent"), responses: ever("response"), interviews: ever("interview"),
    tokens, cost: tokens !== null && priced ? String(Math.round(amount * 1e6) / 1e6) : null,
    note: reached.size === 0 ? "no data: the tracker is missing or empty" : "",
  };
}
