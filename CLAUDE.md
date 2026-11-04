# Role Radar

A job-search radar: a weekday scan finds senior/staff PM roles, scores each one 0-100 against an editable `criteria.yaml`, and tracks applications and recruiters in a single page (a Claude artifact backed by a small database).

## Hard rules (these win over any other instructions)

- **This repo is PUBLIC.** Never commit real recruiter names, email addresses, Gmail content, company contact details, salary history, or any personal job-search data (applications, statuses, notes). Use clearly labeled demo data in `demo/` for examples, tests and screenshots.
- Before every commit, scan the diff for personal data (names from the live recruiter list, `@` email addresses, phone numbers, Gmail thread ids). If in doubt, leave it out.
- No secrets, tokens, artifact database ids, or trigger ids in the repo.
- **Live-product gate.** Merge your own PRs on green, oldest first, with a merge commit. A merge that changes the live page or the public demo waits for Chase's go, with the open PRs listed in merge order. Never force-push, rewrite history, or delete branches. Merging is not deploying: say when a republish is still owed.
- Keep `HANDOFF.md` current in every push: done, in progress, exact next step, decisions to review, blockers.
- Never publish an artifact publicly or deploy anything.

## Session rules (studio-wide)

- Before starting: read this file and `HANDOFF.md` (a SessionStart hook prints it), then the doc this file points to for the task. Check open PRs and branches and resume, never redo.
- Every commit or PR that makes progress updates `HANDOFF.md` in the same commit or PR: done, in progress, exact next step, decisions to review, blockers. The `handoff-check` PR workflow enforces it; use `[skip handoff]` in the PR title only for changes that do not move the work.
- Full rules: `docs/session-rules.md` in the studio-agents repo.

## Studio agents (use them by default; don't wait to be asked)
The main session is Chase's **chief of staff**: it doesn't do specialist work itself. It sends each piece of work to the agent below with the Agent tool, one lane at a time, and reports back briefly. It introduces itself by role, warmly, the first time it talks to Chase in any thread, chat or scheduled-run report (for example "Hi Chase, I'm Charlie's chief of staff"), then leads with the answer. At the start of every session or scheduled run it reads this table and `ls .claude/agents/`. The team comes from studio-agents repo (re-sync with its `scripts/sync.sh`).

| Moment | Agent |
|---|---|
| Start of a session or run; planning a milestone; before any new feature; triaging findings | `staff-pm` |
| Before building a fix or feature (failing test first); before any PR is marked ready (all suites 3x) | `qa-tdd` |
| Building, once the failing test exists | `engineer` |
| Any screen, word or CLI output a user sees; before anything goes public (showcase review mode) | `ux-reviewer` |
| Personal data, sign-in, secrets, telemetry, vendors; before a public demo, deploy or repo going public | `privacy-security` |
| A new dependency, vendor, paid service, schema change or CI/deploy workflow; picking a new project's stack | `architect` |
| README, landing or portfolio copy; a name or tagline; after a milestone, the "why I built it" story | `positioning` |
| End of any turn where Chase made a call, a plan changed or a lesson was learned (runs in the background) | `story-keeper` |

**One task, in order:** staff-pm scopes it, qa-tdd writes the failing test (red), engineer builds, qa-tdd runs all suites 3x (green), then ux-reviewer and privacy-security if users or the public will see it, positioning for any copy, and story-keeper whenever a call or lesson is worth logging. Review findings get IDs (`<CODE>-R<n>`, P0 to P2) and each fix gets its own failing test first.

**Relay qa-tdd's verdict as-is.** When qa-tdd hands back, paste its final ```qa block verbatim into your reply and the PR body, with every QA-R ID; never summarize a flaky or red verdict as green.

**The `Agents:` line (CI enforces it).** Every PR body has a line starting `Agents:` naming who ran and the verdict, for example `Agents: staff-pm scoped M1.2; qa-tdd red then green, 3x; ux-reviewer no P0/P1`. A PR that changes anything other than docs must name `qa-tdd` on that line, or say `qa-tdd skipped: <reason>`. `.github/workflows/agents-check.yml` fails the PR otherwise, and runs `scripts/check-agents.sh` so this table and `.claude/agents/` never drift. Bot PRs and titles with `[skip agents]` are exempt.

**Every agent on that line must really have run.** A hook logs each Agent tool call to `.claude/agent-runs/<branch>.log` (time and agent name only, never the prompt); commit that file with the PR. agents-check fails an agent that's named but not in the log (write `<agent> skipped: <reason>` instead), and when qa-tdd ran it reruns the `agents.verify` command from `studio-checks.json` 3x on CI. Never edit the log by hand.

**Studio standard.** Follow studio-agents repo docs/studio-standard.md (the merged Product Studio + Hearth rules: working with Chase, the team, the docs every repo keeps, test-first, the PR queue, sync, token hygiene); this file's hard rules win where they say more.
