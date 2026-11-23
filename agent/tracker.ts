// RR-AGENT tracker: append-only JSONL, one line per write. `sent` needs the approval marker, which only the CLI passes.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { assertOutsideRepo } from "./config.ts";

export const STATUSES = ["found", "drafted", "ready", "sent", "response", "interview", "rejected", "dropped"] as const;
export type Status = (typeof STATUSES)[number];
export type RoleInput = { id: string; title: string; company: string; score?: number; url?: string };
export type Draft = { kind: string; ref: string };
export type Role = RoleInput & { status: Status; drafts: Draft[]; updatedAt: string; approvedBy?: "cli" };

/** A status row counts as a real "sent" only when the human approve command marked it. */
export const isHumanSent = (row: Record<string, unknown>): boolean => row.status === "sent" && row.approvedBy === "cli";

export function createTracker(path: string, opts: { log?: (line: string) => void } = {}) {
  if (typeof path !== "string" || path === "") throw new Error("ROLE_RADAR_TRACKER is not set: point it at a file outside the repo");
  const file = assertOutsideRepo(path, "ROLE_RADAR_TRACKER"); // write target: demo/ is not exempt

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
        if (role) { role.status = r.status; role.updatedAt = r.ts; if (r.approvedBy === "cli") role.approvedBy = "cli"; }
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
    setStatus(roleId: string, status: string, o?: { approvedBy?: unknown }) {
      need(roleId);
      if (!(STATUSES as readonly unknown[]).includes(status)) throw new Error(`invalid status: ${String(status)}`);
      if (status === "sent") {
        if (o?.approvedBy !== "cli") {
          opts.log?.(`refused_status ${roleId} sent`);
          throw new Error("sent needs human approval, set by the CLI approve command, never the model");
        }
        append({ type: "status", roleId, status, approvedBy: "cli" });
        return;
      }
      append({ type: "status", roleId, status });
    },
    get(id: string): Role { return need(id); },
    list(): Role[] { return [...fold().values()]; },
  };
}
export type Tracker = ReturnType<typeof createTracker>;
