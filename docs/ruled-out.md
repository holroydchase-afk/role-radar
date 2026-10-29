# Ruled out

Every role the owner eliminates is kept, with a reason and a date, and counted as progress next to applications. Applying to one role and ruling out five is a productive day, and the page says so.

## Where it shows
- **Header:** `Today: applied 1, ruled out 5 · This week: applied 2, ruled out 11` (weeks start Monday, local time). "Applied" counts `appliedAt`; "ruled out" counts jobs whose status is `skipped`, by `skippedAt` (or `statusAt` for older skips).
- **Ruled out tab:** every skipped role, newest first, grouped by day, with the reason and note, a count by reason, and a *Reconsider* button that moves the role back to New (with Undo).
- **Cards:** a skipped card says `Ruled out Oct 23: Location. Belfast office only`.

## Skipping
*Skip* on a card opens *Why skip?*: one reason chip from `meta/config.skipReasons` (defaults: Comp too low, Not remote, Location, Wrong level, Wrong domain, Culture, Posting closed, Other) and a short comment on what made it a no (up to 300 characters). Both are required, because the comment is what the scan learns from. The page writes:

```json
{ "status": "skipped", "statusAt": "<ISO>", "skippedAt": "<ISO>", "skippedBy": "owner", "skipReason": "Culture", "skipNote": "Reviews say always-on, weekend releases" }
```

## The feedback loop
`src/skip-feedback.js` reads the owner's skips from the last 30 days (rule skips never count) and turns repeats into suggestions. Nothing changes on its own:

| Pattern | Suggestion | Criteria change |
|---|---|---|
| 2+ skips at one company, none pursued there | Never show the company | add to `hard_exclude.companies` |
| 2+ Wrong level / Wrong domain skips share a title word that no pursued role has | Skip titles with the word | add to `role.title_exclude` |
| A word or phrase in 2+ Culture comments | Treat it as a culture red flag | add to `culture.red_flags` (soft, -10) |
| 3+ Wrong domain skips in a weight-2+ sector, none pursued | Lower the sector's weight by 1 | set `sectors[id].weight` |
| 2+ Comp too low skips with a stated top | Raise the base floor just past them (at most 30%, below any pursued role's top) | set `comp.base_floor_usd` |
| 2+ Location / Not remote, or 2+ Posting closed skips | A note for the scan (no criteria change) | none |

The **Ruled out** tab shows them under *What your skips are teaching the scan*, each with the roles and comments behind it. *Add to criteria* puts the change into the Criteria editor (comments kept, one line changed) with a banner; only *Save criteria* applies it, and *Discard* drops it. *Not now* sets a suggestion aside for good.

The page keeps `meta/skipFeedback` current for the scan: `{open: [{id, kind, text, why, change}], scanNotes, dismissed, accepted, updatedAt}`. The scan follows `scanNotes`, marks new roles that look like past skips in their fit note (without changing scores), lists up to 3 open suggestions in the digest under "Your skips suggest", and never edits the criteria itself.

## Who skipped it
Only the owner's own decisions count as ruled out. `skippedBy` says who made the call: `"owner"` for the page's Skip and an intake No, `"rule"` for a scan or a criteria cleanup that takes roles out in bulk. A skip without the field counts as the owner's. Rule skips are left out of the header count and the family email's "ruled out", and listed apart on the Ruled out tab under "Removed by screening rules". The definitions live in `src/progress.js`.

## From an intake chat
When an intake screen returns No, the intake writes the same fields to the tracker's `jobs` collection, so the role is counted and the scan never re-adds it:

- Role already in the tracker: update that job with the fields above (`skippedBy: "owner"`).
- Role not in the tracker: create `jobs/manual-<company-slug>-<title-slug>` with `company`, `title`, `url`, `source: "intake"`, `firstSeen`, `lane`, `tags: []` plus the fields above.

Reason is one of the configured skip reasons; the note is required, one short line with the deciding fact (no names, emails or other personal data).
