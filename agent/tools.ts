// RR-AGENT tools: scan, score, tailor, outreach, track. Drafts only: there is no send path.
// No network here: model calls go through the injected Llm (agent/llm.ts), jobs come from a local file.
import { readFileSync } from "node:fs";
import { scoreJob, matchJob, explain } from "../src/scoring.ts";
import { SONNET_MODEL } from "./config.ts";
import { STATUSES } from "./tracker.ts";
import type { Llm } from "./llm.ts";
import type { Harness } from "./harness.ts";
import type { Tracker } from "./tracker.ts";

export type ToolDef = {
  name: string;
  description: string;
  schema: { type: "object"; properties: Record<string, unknown>; required?: string[] };
  run(input: unknown): Promise<unknown>;
};

export type ToolDeps = {
  llm: Llm; harness: Harness; tracker: Tracker; criteria: any; jobsPath: string; factsPath: string;
};

type Fact = { id: string; text: string; tags?: string[] };

const asRecord = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

export function createTools(deps: ToolDeps): ToolDef[] {
  const { llm, harness, tracker, criteria, jobsPath, factsPath } = deps;

  const jobs = (): Record<string, any> => asRecord(JSON.parse(readFileSync(jobsPath, "utf8")).jobs);
  const facts = (): Fact[] => {
    const f = JSON.parse(readFileSync(factsPath, "utf8")).facts;
    return Array.isArray(f) ? f : [];
  };
  const roleIdOf = (input: unknown): string => {
    const id = asRecord(input).roleId;
    if (typeof id !== "string" || id === "") throw new Error("roleId is required (a string)");
    return id;
  };
  const jobOf = (id: string) => {
    const all = jobs();
    if (!Object.hasOwn(all, id)) throw new Error(`unknown roleId: ${id}`);
    return all[id];
  };
  const ask = async (req: { system: string; user: string; maxTokens?: number }): Promise<string> => {
    harness.checkKill();
    const res = await llm.call({
      model: SONNET_MODEL, system: req.system, messages: [{ role: "user", content: req.user }], maxTokens: req.maxTokens ?? 1500,
    });
    harness.record(res.usage, SONNET_MODEL);
    return res.text;
  };
  const roleBrief = (id: string, job: any) =>
    `Role ${id}: ${job.title ?? ""} at ${job.company ?? ""}.\n${String(job.description ?? job.summary ?? "").slice(0, 3000)}`;
  const roleProp = { roleId: { type: "string", description: "Role id from scan" } };

  const scan: ToolDef = {
    name: "scan",
    description: "List the roles in the jobs file (id, company, title, score fields if present). No network.",
    schema: { type: "object", properties: {} },
    async run() {
      return {
        jobs: Object.entries(jobs()).map(([id, j]) => ({
          id, company: j.company, title: j.title, location: j.location, comp: j.comp, url: j.url,
        })),
      };
    },
  };

  const score: ToolDef = {
    name: "score",
    description: "Score one role 0-100 against the criteria, with the explanation and the hard-filter match.",
    schema: { type: "object", properties: roleProp, required: ["roleId"] },
    async run(input) {
      const roleId = roleIdOf(input);
      const job = jobOf(roleId);
      const result = scoreJob(job, criteria);
      return { roleId, score: result.score, explanation: explain(result), match: matchJob(job, criteria) };
    },
  };

  const tailor: ToolDef = {
    name: "tailor",
    description: "Draft a resume and cover letter for one role, grounded only in the candidate's facts. Lists gaps.",
    schema: { type: "object", properties: roleProp, required: ["roleId"] },
    async run(input) {
      const roleId = roleIdOf(input);
      const job = jobOf(roleId);
      const known = facts();
      const system = [
        "You tailor a resume and cover letter for one role. Use ONLY these facts about the candidate:",
        ...known.map((f) => `- ${f.id}: ${f.text}`),
        "You must never claim anything outside these facts. Every claim cites the fact ids that support it.",
        "If the role needs a skill the facts do not show, do not invent it: list it under \"gaps\".",
        "Reply with JSON only: {\"resume\":[{\"text\":string,\"facts\":[id]}],\"cover\":[{\"text\":string,\"facts\":[id]}],\"gaps\":[string]}.",
      ].join("\n");
      const text = await ask({ system, user: roleBrief(roleId, job), maxTokens: 2000 });
      let draft: any;
      try {
        draft = JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/g, ""));
      } catch {
        throw new Error("tailor draft is not valid JSON");
      }
      const ids = new Set(known.map((f) => f.id));
      const check = (section: string): { text: string; facts: string[] }[] => {
        const claims = draft?.[section];
        if (!Array.isArray(claims)) throw new Error(`tailor draft needs a "${section}" array`);
        for (const c of claims) {
          if (typeof c?.text !== "string" || !Array.isArray(c?.facts) || c.facts.length === 0) {
            throw new Error(`a ${section} claim has no fact ids: every claim must cite a fact`);
          }
          for (const f of c.facts) {
            if (typeof f !== "string" || !ids.has(f)) throw new Error(`a ${section} claim cites unknown fact id: ${String(f)}`);
          }
        }
        return claims;
      };
      const resume = check("resume");
      const cover = check("cover");
      const gaps = Array.isArray(draft.gaps) ? draft.gaps.filter((g: unknown) => typeof g === "string") : [];
      return { roleId, resume, cover, gaps };
    },
  };

  const outreach: ToolDef = {
    name: "outreach",
    description: "Draft a short (1 to 3 sentences) message to a recruiter or hiring manager. Draft only, never sent.",
    schema: { type: "object", properties: roleProp, required: ["roleId"] },
    async run(input) {
      const roleId = roleIdOf(input);
      const job = jobOf(roleId);
      const known = facts();
      const system = [
        "Write a short, natural outreach message of at most 3 sentences. Plain text only.",
        "Use only these facts, and include no link or email address unless it appears in them:",
        ...known.map((f) => `- ${f.id}: ${f.text}`),
      ].join("\n");
      const text = (await ask({ system, user: roleBrief(roleId, job), maxTokens: 300 })).trim();
      if (!text) throw new Error("outreach draft is empty");
      const corpus = known.map((f) => f.text).join("\n");
      const trim = (s: string) => s.replace(/[.,;:!?)\]'"]+$/, "");
      for (const u of text.match(/(?:https?:\/\/|www\.)\S+/gi) ?? []) {
        if (!corpus.includes(trim(u))) throw new Error(`outreach contains a link not in the facts: ${trim(u)}`);
      }
      for (const e of text.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g) ?? []) {
        if (!corpus.includes(e)) throw new Error(`outreach contains an email address not in the facts: ${e}`);
      }
      const sentences = text.split(/[.!?]+(?:\s+|$)/).filter((s) => s.trim() !== "");
      if (sentences.length > 3) throw new Error(`outreach is too long: ${sentences.length} sentences, the limit is 3`);
      return { roleId, text };
    },
  };

  const track: ToolDef = {
    name: "track",
    description: "Record a role's status (never \"sent\") and draft references in the tracker.",
    schema: {
      type: "object",
      properties: {
        roleId: roleProp.roleId,
        status: { type: "string", enum: STATUSES.filter((s) => s !== "sent") },
        drafts: {
          type: "array",
          items: { type: "object", properties: { kind: { type: "string" }, ref: { type: "string" } }, required: ["kind", "ref"] },
        },
      },
      required: ["roleId", "status"],
    },
    async run(input) {
      const roleId = roleIdOf(input);
      const rec = asRecord(input);
      const status = rec.status;
      if (typeof status !== "string" || !(STATUSES as readonly string[]).includes(status)) {
        throw new Error(`invalid status: ${String(status)}`);
      }
      const drafts = rec.drafts === undefined ? [] : rec.drafts;
      if (!Array.isArray(drafts)) throw new Error("drafts must be an array of {kind, ref}");
      for (const d of drafts) {
        if (typeof asRecord(d).kind !== "string" || typeof asRecord(d).ref !== "string") throw new Error("each draft needs kind and ref strings");
      }
      const job = jobOf(roleId);
      const sc = scoreJob(job, criteria).score;
      tracker.upsertRole({ id: roleId, title: job.title, company: job.company, score: sc, ...(job.url ? { url: job.url } : {}) });
      // No approval flag is ever passed: "sent" is refused by the tracker (and logged).
      tracker.setStatus(roleId, status);
      for (const d of drafts as { kind: string; ref: string }[]) tracker.addDraft(roleId, { kind: d.kind, ref: d.ref });
      return { roleId, status, drafts: drafts.length };
    },
  };

  return [scan, score, tailor, outreach, track];
}
