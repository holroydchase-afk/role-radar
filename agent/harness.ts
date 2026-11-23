// RR-AGENT harness: JSONL run log, KILL switch, spend cap. Log lines carry counts and ids, never prompts or facts.
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { assertOutsideRepo } from "./config.ts";

// Lets callers read a non-zero exit code off any caught Error (tests do).
declare global { interface Error { exitCode?: number } }

export type Prices = Record<string, { inputPerMTok: number; outputPerMTok: number }>;

export class CapExceeded extends Error {
  exitCode = 3;
  constructor(msg: string) { super(msg); this.name = "CapExceeded"; }
}
export class KilledError extends Error {
  exitCode = 4;
  constructor(msg: string) { super(msg); this.name = "KilledError"; }
}

export function createHarness(opts: { logPath?: string | null; killPath?: string; capUsd: number; prices: Prices }) {
  if (typeof opts.logPath !== "string" || opts.logPath === "") {
    throw new Error("ROLE_RADAR_AGENT_LOG is not set: point it at a log file outside the repo");
  }
  const logPath = assertOutsideRepo(opts.logPath, "ROLE_RADAR_AGENT_LOG");
  const killPath = opts.killPath ?? join(dirname(logPath), "KILL");
  const runId = randomUUID();
  let spentUsd = 0;
  let capped = false;

  const log = (fields: Record<string, unknown>) => {
    mkdirSync(dirname(logPath), { recursive: true });
    appendFileSync(logPath, JSON.stringify({ runId, ts: new Date().toISOString(), ...fields }) + "\n");
  };

  return {
    runId,
    get spentUsd() { return spentUsd; },
    log,
    record(tokens: { input: number; output: number }, model: string): number {
      const p = opts.prices[model];
      if (!p) throw new Error(`no price for model ${model}: add it to the price table`);
      if (capped) throw new CapExceeded(`spend cap of $${opts.capUsd} already hit`);
      const usd = (tokens.input * p.inputPerMTok) / 1e6 + (tokens.output * p.outputPerMTok) / 1e6;
      spentUsd += usd;
      log({ event: "llm_call", model, input_tokens: tokens.input, output_tokens: tokens.output, usd, ok: true });
      if (spentUsd > opts.capUsd) {
        capped = true;
        log({ event: "cap_hit", usd: spentUsd, cap_usd: opts.capUsd });
        throw new CapExceeded(`spend cap of $${opts.capUsd} exceeded ($${spentUsd.toFixed(4)})`);
      }
      return usd;
    },
    checkKill(): void {
      if (existsSync(killPath) || process.env.ROLE_RADAR_AGENT_KILL === "1") {
        log({ event: "killed" });
        throw new KilledError("kill switch is on (KILL file or ROLE_RADAR_AGENT_KILL=1)");
      }
    },
  };
}
export type Harness = ReturnType<typeof createHarness>;
