# Ruled out

Every role the owner eliminates is kept, with a reason and a date, and counted as progress next to applications. Applying to one role and ruling out five is a productive day, and the page says so.

## Where it shows
- **Header:** `Today: applied 1, ruled out 5 · This week: applied 2, ruled out 11` (weeks start Monday, local time). "Applied" counts `appliedAt`; "ruled out" counts jobs whose status is `skipped`, by `skippedAt` (or `statusAt` for older skips).
- **Ruled out tab:** every skipped role, newest first, grouped by day, with the reason and note, a count by reason, and a *Reconsider* button that moves the role back to New (with Undo).
- **Cards:** a skipped card says `Ruled out Oct 23: Location. Belfast office only`.

## Skipping
*Skip* on a card asks *Why skip?* with the reasons from `meta/config.skipReasons` (defaults: Comp too low, Not remote, Location, Wrong level, Wrong domain, Culture, Posting closed, Other) and an optional one-line note. The page writes:

```json
{ "status": "skipped", "statusAt": "<ISO>", "skippedAt": "<ISO>", "skippedBy": "owner", "skipReason": "Location", "skipNote": "Belfast office only" }
```

## Who skipped it
Only the owner's own decisions count as ruled out. `skippedBy` says who made the call: `"owner"` for the page's Skip and an intake No, `"rule"` for a scan or a criteria cleanup that takes roles out in bulk. A skip without the field counts as the owner's. Rule skips are left out of the header count and the family email's "ruled out", and listed apart on the Ruled out tab under "Removed by screening rules". The definitions live in `src/progress.js`.

## From an intake chat
When an intake screen returns No, the intake writes the same fields to the tracker's `jobs` collection, so the role is counted and the scan never re-adds it:

- Role already in the tracker: update that job with the fields above (`skippedBy: "owner"`).
- Role not in the tracker: create `jobs/manual-<company-slug>-<title-slug>` with `company`, `title`, `url`, `source: "intake"`, `firstSeen`, `lane`, `tags: []` plus the fields above.

Reason is one of the configured skip reasons; the note is one short line with the deciding fact (no names, emails or other personal data).
