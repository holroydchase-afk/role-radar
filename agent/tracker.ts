// RR-AGENT tracker: append-only JSONL, one line per write. Sending needs a human approval flag.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { assertOutsideRepo } from "./config.ts";

export const STATUSES = ["found", "drafted", "ready", "sent", "response", "interview", "rejected", "dropped"] as const;
export type Status = (typeof STATUSES)[number];
export type RoleInput = { id: string; title: string; company: string; score?: number; url?: string };
export type Draft = { kind: string; ref: string };
export type Role = RoleInput & { status: Status; drafts: Draft[]; updatedAt: string };

export function createTracker(path: string, opts: { harness?: { log(f: Record<string, unknown>): void } } = {}) {
  if (typeof path !== "string" || path === "") throw new Error("ROLE_RADAR_TRACKER is not set: point it at a file outside the repo");
  const file = assertOutsideRepo(path, "ROLE_RADAR_TRACKER");

  const append = (row: Record<string, unknown>) => {
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, JSON.stringify({ ...row, ts: new Date().toISOString() }) + "\n");
  };

  const fold = (): Map<string, Role> => {
    const roles = new Map<string, Role>();
    if (!existsSync(file)) return roles;
    for (const line of readFileSync(file, "utf8").split("\n")) {
      if (!line) continue;
      const r = JSON.parse(line);
      if (r.type === "role") {
        const { type: _t, roleId, ts, ...fields } = r;
        const prev = roles.get(roleId);
        roles.set(roleId, { status: "found", drafts: [], ...prev, ...fields, id: roleId, updatedAt: ts });
      } else if (r.type === "draft") {
        const role = roles.get(r.roleId);
        if (role) { role.drafts.push(r.draft); role.updatedAt = r.ts; }
      } else if (r.type === "status") {
        const role = roles.get(r.roleId);
        if (role) { role.status = r.status; role.updatedAt = r.ts; }
      }
    }
    return roles;
  };

  const need = (id: string): Role => {
    const role = fold().get(id);
    if (!role) throw new Error(`unknown role: ${id}`);
    return role;
  };

  return {
    upsertRole(role: RoleInput) {
      const { id, ...rest } = role;
      append({ type: "role", roleId: id, ...rest });
    },
    addDraft(roleId: string, draft: Draft) {
      need(roleId);
      append({ type: "draft", roleId, draft: { kind: draft.kind, ref: draft.ref } });
    },
    setStatus(roleId: string, status: string, o?: { approved?: unknown }) {
      need(roleId);
      if (!(STATUSES as readonly unknown[]).includes(status)) throw new Error(`invalid status: ${String(status)}`);
      if (status === "sent" && o?.approved !== true) {
        opts.harness?.log({ event: "refused_sent", roleId });
        throw new Error("sent needs human approval (approved: true), set by the CLI, never the model");
      }
      append({ type: "status", roleId, status });
    },
    get(id: string): Role { return need(id); },
    list(): Role[] { return [...fold().values()]; },
  };
}
export type Tracker = ReturnType<typeof createTracker>;
