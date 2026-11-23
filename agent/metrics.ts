// RR-AGENT metrics: counts come only from the tracker file and the run log. Read-only, no guessing.
import { existsSync, readFileSync } from "node:fs";

export type Metrics = {
  rolesFound: number; draftsReady: number; applicationsSent: number; responses: number; interviews: number;
  tokens: { input: number; output: number }; usd: number; note: string;
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

export function computeMetrics(o: { trackerPath: string; logPath: string }): Metrics {
  const reached = new Map<string, Set<string>>(); // roleId -> every status it ever reached
  for (const r of rows(o.trackerPath)) {
    if (typeof r.roleId !== "string") continue;
    if (r.type === "role") {
      if (!reached.has(r.roleId)) reached.set(r.roleId, new Set(["found"]));
    } else if (r.type === "status" && typeof r.status === "string") {
      reached.get(r.roleId)?.add(r.status);
    }
  }
  const ever = (s: string) => [...reached.values()].filter((set) => set.has(s)).length;

  const tokens = { input: 0, output: 0 };
  let usd = 0;
  for (const r of rows(o.logPath)) {
    if (r.event !== "llm_call") continue;
    tokens.input += Number(r.input_tokens) || 0;
    tokens.output += Number(r.output_tokens) || 0;
    usd += Number(r.usd) || 0;
  }

  return {
    rolesFound: reached.size, draftsReady: ever("ready"), applicationsSent: ever("sent"),
    responses: ever("response"), interviews: ever("interview"),
    tokens, usd, note: reached.size === 0 ? "no data: the tracker is missing or empty" : "",
  };
}
