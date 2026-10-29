# Private recruiters

_RR-M2.4, designed 2026-10-24 (night shift). Status: deployed to the live page 2026-10-24 (version 25); every check in steps 2-5 passed._

## The problem

The live page keeps recruiter records (name, company, email, notes, next steps) in its artifact database, in the `recruiters` collection. Today that collection uses the default rules: everyone the page is shared with can read it. The Recruiters tab hides names on screen (PR #4), but that is a curtain, not a lock. Anyone the page is shared with could still read the records.

**Goal:** a viewer who isn't the owner gets no recruiter data at all, and the owner's Recruiters tab, *Import from Gmail* and the scheduled scan keep working unchanged.

## Options considered

| Option | How | Verdict |
|---|---|---|
| A. Owner-only rule on `recruiters` | Declare `db.rules: [{path: "recruiters", read: "owner", write: "owner"}]` when publishing. The platform then treats the path as non-existent for everyone but the artifact's owner (reads come back empty, writes reject), in `get`, queries and `onSnapshot` alike. | **Chosen.** No data moves. Nothing can be lost, and the scan, recruiter watch and intake chats (which act as Chase, the owner) keep the same path. |
| B. Per-viewer subtree `data/users/<id>/recruiters` | Each viewer's own subtree is private, even from the owner. | Rejected. The data would have to move, every writer outside the page (scan, recruiter watch, intake) would need Chase's opaque user id, and if more than one person can post in the project, each would see a different list. |
| C. New `private/...` path plus a one-time migration | Copy `recruiters/*` to a new owner-only path, then delete the old docs. | Rejected for now. Same protection as A, plus a migration that could lose or split data, and three external writers to repoint. A gets the same lock with one republish. |
| D. Page-side hiding only | The page doesn't render recruiters for non-owners. | Not enough on its own: the database would still answer a direct read. Kept as a second layer on top of A. |

The routine brief asked for "a private backend, the shared database as a read-for-migration source, and a one-time migration". With option A, the private backend is the same path under an owner-only rule, so the republish is the migration and no copy is needed. If the platform ever stops supporting the rule, `src/recruiter-store.ts` is the one place to swap in option B or C. This choice is listed under "Decisions to review" in HANDOFF.md.

## How it works

Two layers:

1. **The database rule (the lock).** `app/capabilities.json` is the publish manifest: `db.rules` makes `recruiters` owner-only, and `mcp` keeps Gmail read-only (`search_threads`, `batch_get_threads`). "Owner" means the artifact's own owner, not someone granted Editor or Owner in the share menu. For an artifact Claude made inside a project, it means every member who can post in that project. The project is believed to be private to Chase, so that would be Chase alone. This is not verified from the repo: deploy step 2 checks it.
2. **The page (the second layer).** `src/recruiter-store.ts` is the only code that reads or writes recruiters. On load it asks the platform `user.isOwner()`:
   - `owner`: Recruiters tab, Gmail import, add and edit, all as before.
   - `viewer` (shared with someone else): no Recruiters tab, no recruiter events in the Alerts preview, no recruiter count in the header. The page never asks the database for recruiters.
   - `unknown` (the platform can't say who is viewing): the page reads, and the rule decides. The owner still sees their list; anyone else gets an empty one.
   - `off`: the public demo, or no database.

`isOwner()` needs no extra capability, so the manifest adds only the rule.

## What the tests prove

`tests/recruiter-store.test.ts` (RR-PR-1 to RR-PR-10):
- A viewer gets `[]`, writes refuse, and the store never touches a recruiter path (unit, with a spy database).
- The owner reads and writes through the store. The public demo and a page with no database touch nothing.
- The manifest declares exactly the owner-only rule plus read-only Gmail, and nothing more.
- The page has no direct `db.doc("recruiters…")` or `db.collection("recruiters")` call left.
- In the browser, a shared viewer (`?as=viewer` on the demo build) sees no recruiter name, note or email on any tab, has no Recruiters tab (a remembered one falls back to New), and the page never asks the database for recruiters.
- The demo database enforces the same rule (empty read, `invalid_argument` on write), so the demo behaves like the platform.

What the repo can't prove: that the live platform enforces the rule. That check is step 5 of the deploy checklist, run against the live artifact.

## Not covered (scheduled)

- **Other personal data on the live page.** Jobs carry application notes, status emails (subject lines) and resume links, and `meta/config` holds intake settings. They stay readable by anyone the live page is shared with. Recommendation: share the public demo (chaseholroyd.com/role-radar/) with recruiters, never the live page. If the live page ever needs sharing, apply the same pattern with a rule on `jobs` and `meta`, read `view` and write `owner`, plus a separate owner-only notes path. Scheduled, not needed for the recruiter-facing goal.
- **Republishing without the manifest.** Publishing with `capabilities: {db: {}}` would reset the rules to the defaults. Omitting `capabilities` carries the stored rules forward. Every publish of the live page should pass `app/capabilities.json` as-is.

## Deploy checklist (one step for Chase: reply `deploy`)

A Claude session with the Artifact and ArtifactData tools does all of this once Chase replies `deploy`:

1. Merge order: this PR, then the stacked ones. Deploy from `main` after the merge, or from this branch if Chase says deploy first.
2. Owner check before publishing: open the live artifact's share menu (or ask Chase for a screenshot of it) and confirm the owner row is Chase alone. If a project or channel owns it, everyone who can post there counts as owner and would see recruiters; stop and tell Chase. Also read the live artifact's current capabilities and compare them with `app/capabilities.json`. They should differ only by the new rule (today: db + read-only Gmail).
3. Republish the live page (same URL, from project memory) with `app/role-radar.html` and supporting files `scoring.js`, `gmail-import.js`, `posting.js`, `alerts.js` and **`recruiter-store.js`** (new), all from `build/` (`npm run build`; they lived in `src/` before the TypeScript move), plus `capabilities` = the contents of `app/capabilities.json`. Don't change `contract`.
4. Owner check: `ArtifactData list recruiters` as Chase returns the same count as before the republish (note the count first).
5. Rule check: `ArtifactData list recruiters` with a lower `as_level` (`view`, then `interact`, then `admin`) returns nothing. A `get` of one known recruiter doc at `interact` and `admin` reads as non-existent, and an `update` at those levels is refused. If any check shows data, **don't** roll the capabilities back: the old defaults are more open. Keep the rule, make sure the live page isn't shared with anyone, and tell Chase.
6. Open the page as Chase: the Recruiters tab, *Show details* and *Import from Gmail* work. One recruiter edit saves.
7. Update `docs/SETUP.md` so it says recruiters are owner-only and jobs and notes are not. Log the version number and the date in HANDOFF.md ("live page republished with private recruiters").

No data moves, so nothing needs a rollback. If step 5 fails, the fix is to unshare the page, not to restore the old rules.
