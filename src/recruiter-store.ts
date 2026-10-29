/* Role Radar recruiter store: the one place the page reads and writes recruiter records.
 * Recruiters are private to the page's owner. The artifact database enforces it with an
 * owner-only rule on the "recruiters" path (RULES, declared in app/capabilities.json when the
 * page is published); this store adds the page side: a viewer who isn't the owner never
 * asks the database for recruiters and never sees the tab.
 *
 *   mode   owner    the platform says this viewer owns the page: read and write
 *          viewer   anyone else the page is shared with: nothing is read, writes refuse
 *          unknown  the platform can't say (no `user` answer): read, and let the rule decide
 *          off      the public demo, or no database: nothing at all
 *
 * Design and deploy checklist: docs/private-recruiters.md.
 * ES module. scripts/build.mjs bundles it to build/recruiter-store.js, a classic script that sets window.RoleRadarRecruiters. */

export type Mode = "pending" | "owner" | "viewer" | "unknown" | "off";
export type Recruiter = Record<string, unknown> & { _id: string };

/** The slice of the artifact database the store uses. */
export interface Db {
  collection(path: string): {
    onSnapshot(
      next: (snap: { docs: { id: string; data(): Record<string, unknown> }[] }) => void,
      error: (e: unknown) => void,
    ): () => void;
  };
  doc(path: string): { set(doc: unknown): Promise<unknown>; update(patch: unknown): Promise<unknown> };
}
/** The platform's answer about who is viewing. */
export interface Viewer { isOwner?: unknown }
export interface StoreOptions { db?: Db | null; user?: Viewer | null; publicView?: boolean }
export interface RecruiterStore {
  readonly mode: Mode;
  readonly visible: boolean;
  readonly canWrite: boolean;
  init(): Promise<Mode>;
  subscribe(cb: (list: Recruiter[]) => void, onError?: (e: unknown) => void): () => void;
  add(key: string, doc: unknown): Promise<unknown>;
  update(key: string, patch: unknown): Promise<unknown>;
}

export const PATH = "recruiters";
export const RULES = [{ path: PATH, read: "owner", write: "owner" }];

export function create({ db = null, user = null, publicView = false }: StoreOptions = {}): RecruiterStore {
  let mode: Mode = "pending";
  const store: RecruiterStore = {
    get mode() { return mode; },
    get visible() { return mode === "owner" || mode === "unknown"; },
    get canWrite() { return mode === "owner" || mode === "unknown"; },
    async init() {
      if (publicView || !db) return (mode = "off");
      if (!user || typeof user.isOwner !== "function") return (mode = "unknown");
      try {
        const own = await user.isOwner();
        mode = own === true ? "owner" : own === false ? "viewer" : "unknown";
      } catch (_) {
        mode = "unknown";
      }
      return mode;
    },
    /** Calls cb(list) now and on every change. Viewers and the public demo get [] once. */
    subscribe(cb, onError) {
      if (!store.visible) { cb([]); return () => {}; }
      // visible means init found a database.
      return db!.collection(PATH).onSnapshot((s) => cb(s.docs.map((d) => ({ ...d.data(), _id: d.id }))), onError || (() => {}));
    },
    async add(key, doc) { guard(); return db!.doc(PATH + "/" + key).set(doc); },
    async update(key, patch) { guard(); return db!.doc(PATH + "/" + key).update(patch); },
  };
  function guard() { if (!store.canWrite) throw new Error("Only the page's owner can change recruiters."); }
  return store;
}
