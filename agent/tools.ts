// RR-AGENT tools: scan, score, tailor-submit, outreach-submit, track. Drafts only: there is no send path.
// No network and no model call here. The model (a Claude Code subagent) writes the drafts; this file only checks and stores them.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { scoreJob, matchJob, explain } from "../src/scoring.ts";
import { assertOutsideRepo } from "./config.ts";
import type { Tracker } from "./tracker.ts";

// The model may set only these; ready, response, interview, rejected and sent are human-set via the CLI.
export const MODEL_STATUSES = ["found", "drafted", "dropped"];
const KNOWN_STATUSES = ["found", "drafted", "ready", "sent", "response", "interview", "rejected", "dropped"];

export type ToolDeps = { tracker: Tracker; trackerPath: string; criteria: any; jobsPath: string; factsPath: string; maxRoles: number };
type Fact = { id: string; text: string; tags?: string[] };
type Claim = { text: string; fact_ids: string[] };
type Draft = { claims: Claim[]; gaps: string[]; text: string };

export const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const asRecord = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

export function createTools(deps: ToolDeps) {
  const { tracker, criteria } = deps;
  const jobsPath = assertOutsideRepo(deps.jobsPath, "ROLE_RADAR_JOBS", { readOnly: true });
  const factsPath = assertOutsideRepo(deps.factsPath, "ROLE_RADAR_FACTS", { readOnly: true });
  const draftsDir = join(dirname(deps.trackerPath), "drafts");

  const jobs = (): Record<string, any> => asRecord(JSON.parse(readFileSync(jobsPath, "utf8")).jobs);
  const facts = (): Fact[] => {
    const f = JSON.parse(readFileSync(factsPath, "utf8")).facts;
    return Array.isArray(f) ? f : [];
  };
  const requireRole = (id: unknown): any => {
    if (typeof id !== "string" || id === "") throw new Error("a role id is required");
    if (!SAFE_ID.test(id)) throw new Error("unsafe role id: use letters, digits, _ and - only (max 64, no leading - or _)");
    const all = jobs();
    if (!Object.hasOwn(all, id)) throw new Error(`unknown role id: ${id}`);
    return all[id];
  };

  /** Parse and ground a draft. Throws one-line errors naming the claim index. */
  const parseDraft = (raw: string): Draft => {
    if (!raw.trim()) throw new Error("no draft on stdin: pipe the draft JSON in");
    let d: unknown;
    try { d = JSON.parse(raw); } catch { throw new Error("the draft on stdin is not valid JSON"); }
    const rec = asRecord(d);
    if (!Array.isArray(rec.claims) || rec.claims.length === 0) throw new Error("the draft needs a non-empty claims array");
    const ids = new Set(facts().map((f) => f.id));
    const claims: Claim[] = rec.claims.map((c: unknown, i: number) => {
      const cr = asRecord(c);
      if (typeof cr.text !== "string" || cr.text.trim() === "") throw new Error(`claim ${i} has no text`);
      if (!Array.isArray(cr.fact_ids) || cr.fact_ids.length === 0) throw new Error(`claim ${i} cites no fact ids: every claim must cite a fact`);
      for (const f of cr.fact_ids) {
        if (typeof f !== "string" || !ids.has(f)) throw new Error(`claim ${i} cites an unknown fact id: ${String(f)}`);
      }
      return { text: cr.text, fact_ids: cr.fact_ids as string[] };
    });
    const gaps = rec.gaps === undefined ? [] : rec.gaps;
    if (!Array.isArray(gaps) || gaps.some((g) => typeof g !== "string")) throw new Error("gaps must be an array of strings");
    if (typeof rec.text !== "string" || rec.text.trim() === "") throw new Error("the draft needs non-empty text");
    return { claims, gaps: gaps as string[], text: rec.text };
  };

  const save = (kind: "resume" | "outreach", roleId: string, job: any, draft: Draft) => {
    mkdirSync(draftsDir, { recursive: true });
    const n = readdirSync(draftsDir).length + 1;
    const name = `${kind}-${n}.json`; // counter only: the role id never reaches a path
    writeFileSync(join(draftsDir, name), JSON.stringify({ roleId, kind, ...draft }, null, 2) + "\n", { flag: "wx" });
    tracker.upsertRole({ id: roleId, title: job.title, company: job.company, score: scoreJob(job, criteria).score, ...(job.url ? { url: job.url } : {}) });
    tracker.addDraft(roleId, { kind, ref: `drafts/${name}` });
    tracker.setStatus(roleId, "drafted");
    return { roleId, status: "drafted", draft: `drafts/${name}`, gaps: draft.gaps };
  };

  return {
    requireRole,
    scan() {
      const all = Object.entries(jobs());
      for (const [id] of all) if (!SAFE_ID.test(id)) throw new Error("unsafe role id in the jobs file: use letters, digits, _ and - only (max 64, no leading - or _)");
      return {
        jobs: all.slice(0, deps.maxRoles).map(([id, j]) => ({
          id, company: j.company, title: j.title, location: j.location, comp: j.comp, url: j.url,
        })),
      };
    },
    score(id: string) {
      const job = requireRole(id);
      const result = scoreJob(job, criteria);
      return { roleId: id, score: result.score, explanation: explain(result), match: matchJob(job, criteria) };
    },
    tailorSubmit(id: string, raw: string) {
      const job = requireRole(id);
      return save("resume", id, job, parseDraft(raw));
    },
    outreachSubmit(id: string, raw: string) {
      const job = requireRole(id);
      const draft = parseDraft(raw);
      const text = draft.text.trim();
      const corpus = facts().map((f) => f.text).join("\n");
      const trim = (s: string) => s.replace(/[.,;:!?)\]'"]+$/, "");
      for (const u of text.match(/(?:https?:\/\/|www\.)\S+/gi) ?? []) {
        if (!corpus.includes(trim(u))) throw new Error(`outreach contains a link not in the facts: ${trim(u)}`);
      }
      for (const e of text.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g) ?? []) {
        if (!corpus.includes(e)) throw new Error(`outreach contains an email address not in the facts: ${e}`);
      }
      const sentences = text.split(/[.!?]+(?:\s+|$)/).filter((s) => s.trim() !== "");
      if (sentences.length > 3) throw new Error(`outreach is too long: ${sentences.length} sentences, the limit is 3`);
      return save("outreach", id, job, draft);
    },
    /** Throws for a bad or human-only status; writes nothing. */
    checkStatus(id: string, status: unknown) {
      if (typeof status !== "string" || !KNOWN_STATUSES.includes(status)) throw new Error(`invalid status: ${String(status)} (the model may set only ${MODEL_STATUSES.join(", ")})`);
      if (!MODEL_STATUSES.includes(status)) throw new Error(`refused_status ${id} ${status}: the model may set only ${MODEL_STATUSES.join(", ")}`);
    },
    track(id: string, status: unknown) {
      this.checkStatus(id, status);
      const job = requireRole(id);
      tracker.upsertRole({ id, title: job.title, company: job.company, score: scoreJob(job, criteria).score, ...(job.url ? { url: job.url } : {}) });
      tracker.setStatus(id, status as string);
      return { roleId: id, status };
    },
  };
}
export type Tools = ReturnType<typeof createTools>;
