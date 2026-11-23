# Privacy and security review: job-hunt agent (PR 3)

Reviewer: privacy-security. Date: 2026-11-23. Scope: `agent/*.ts`, `demo/agent/*`, README "Job-hunt agent". Standards: CLAUDE.md hard rules (public repo), OWASP ASVS L2 (V7 logging, V5 input, V8 data protection), STRIDE/LINDDUN. Read-only review; no code changed.

## Verdict
No P0. Two P1s to fix before this is run with real data. Safe to merge as code (demo data only) once PS-R1 and PS-R2 have failing tests and fixes; no live-page change, so no Chase gate on the live product.

## Checked and clean
- Personal data: `demo/agent/facts.json` and `cases.json` are labeled made-up (Example Co, Sample Inc, invented firms). Grep for emails, key-like strings and phone numbers in `agent/`, `demo/agent/`, README found only `@example.com` in a test and fake `sk-ant-TEST...` test keys. Run `npm run check:private` with the denylist before commit as usual.
- API key: read only in `llm.ts` and sent only as the `x-api-key` header to api.anthropic.com. Errors report the HTTP status only, the body is not echoed. `run.ts` prints only the first line of an error. The key never reaches `harness.log`, tracker rows or tool results.
- Log rows: `llm_call` (tokens, usd, model, arm), `tool_call` (tool name, ok), `refused_sent` (roleId), `killed`, `cap_hit`, `max_turns`, `failed_grade` (caseId). No prompts, facts, job text or drafts.
- No send path: no tool sends anything, no network call except `llm.ts`. `track` hides `sent` in its schema, and the runtime check still lets `sent` through to `tracker.setStatus`, which refuses it without `approved === true` and logs `refused_sent`. Only `run.ts approve` passes `approved: true`. Confirmed by reading every caller of `setStatus`.
- Posting text goes only into model prompts (`roleBrief`, capped at 3000 chars), never into a command, path, URL fetch or send. Role lookup uses `Object.hasOwn`.

## Status
PS-R8 to PS-R11 are fixed and pinned by `tests/agent-privacy-v2.test.ts`: terminal-only `approve`, `status` and `begin` (no env override), strict role ids and counter-named drafts, `sent` counted only with the approval marker, run-state fails closed, kill switch on every model command. The tool allowlist for the subagent is a launch setting (see the runbook), not code. Still open: PS-R7 and the Max-account retention toggle.

## Findings

**PS-R1 (P1, FIXED 2026-11-23) The path guard exempts all of `demo/`, so real data can be written inside the public repo.** `assertOutsideRepo` allows any path under `<repo>/demo/`; confirmed `demo/tracker.jsonl` and `demo/agent/run.jsonl` are accepted. `.gitignore` has `*.log` only, so a real `.jsonl` tracker or log there would show up as committable and `check-private` would not flag recruiter or company names. Fix: allow only the exact shipped demo files for read-only inputs (facts, jobs); never allow `demo/` for the tracker or log (write targets). Add `*.jsonl` and `agent/*.local.*` to `.gitignore`. Standard: CLAUDE.md hard rule 1, ASVS V8.

**PS-R2 (P1, FIXED 2026-11-23) `ROLE_RADAR_FACTS` and `ROLE_RADAR_JOBS` are not guarded at all.** Only the tracker and log go through `assertOutsideRepo`. The task and README say real facts must live outside the repo; a real facts file placed in `agent/` or the repo root is accepted silently, and `eval` falls back to demo facts without saying so. Fix: guard both env paths with the same function (real facts are read-only, but the guard is what keeps them from being committed), and have `eval` print which facts file it used. Standard: data minimization, ASVS V8.

**PS-R3 (P2, FIXED 2026-11-23) Prompt injection cannot reach a send path, but it can steer the tracker.** A hostile posting (title, company, description) can persuade the model to call `track` with `ready`, `response`, `interview` or `dropped`, which inflates `metrics` and hides roles. Harm is integrity only and local. Fix: the model may set only `found`, `drafted`, `dropped`; `ready` and later statuses are human-set via CLI. Test: a track call with `interview` is refused. Standard: STRIDE Tampering, OWASP LLM01.

**PS-R4 (P2) Outreach link check is shallow, and `tailor` has none.** Only `http(s)://` and `www.` are caught, so `evil.example/x`, markdown links and obfuscated emails pass, and resume and cover text are not link-checked. Not exploitable for sending (nothing is sent, a human reads the draft), but a human may paste an injected link. Fix: one shared validator that flags any domain-like token or `@` not in the facts, applied to all three drafts. Standard: ASVS V5.

**PS-R5 (P2) `approve` leaves no proof of approval.** The `sent` status row is the same shape as any other row, and `approve` works on a role that was never drafted. Fix: write `approvedBy: "cli"` on the row, refuse when the role has no `drafted` or `ready` status, and have `metrics` count `sent` only from rows carrying that marker. Standard: STRIDE Repudiation.

**PS-R6 (P2) Free-text `drafts[].ref` is model-controlled and unbounded.** It lands in the tracker (outside the repo, so not a leak), but could hold whole drafts or fact text. Fix: limit length and shape (a relative file name or short id). Also `refused_sent` logs `roleId`; fine today, keep ids opaque.

**PS-R7 (P2) Vendor terms not verified in this review.** Real facts, job text and drafts go to Anthropic via the API (and the Opus grader sees facts in `eval`). Needs a live check of Anthropic's commercial terms on training and retention, cited with the date, before the first real run. The README should say plainly that facts and postings are sent to the model vendor. Standard: AI/ML bar.

## Scheduled
- STRIDE/LINDDUN one-pager for the agent (docs/product): by 2026-12-07.
- gitleaks and dependency scan in CI: by 2026-12-07.
- File permissions on the tracker and log (0600) on creation: next agent milestone.

## Needs Chase
Go for the first live run with real facts, after PS-R1, PS-R2 and PS-R7 are closed. Whether the Anthropic account used has the data-retention setting he wants.

---

# Re-review: job-hunt agent v2 (subagent harness)

Reviewer: privacy-security. Date: 2026-11-23. Scope: uncommitted v2 rebuild on `claude/project-thread-ej59bm`: `agent/*.ts`, `evals/job-hunt/`, `demo/agent/`, `docs/product/JOB-HUNT-RUN.md`, the job-hunt section of `docs/eng/AGENT-NOTES.md`, README "Job-hunt agent", and the studio tools synced into `scripts/` and `docs/references/`. Read-only review, no code changed. Standards: CLAUDE.md hard rules, OWASP ASVS L2, STRIDE, OWASP LLM01/LLM06. PS-R1 to PS-R3 are closed in v2 and still hold (config.ts guard, model limited to found/drafted/dropped). PS-R4 to PS-R7 carry over (the link check in `tools.ts` is unchanged; PS-R5 is only half done, see PS-R10).

## Verdict
No P0. Two P1s to fix, test first, before any real-data run: PS-R8 and PS-R9. Safe to merge as code (demo data only, no live-page change). Not safe for a real run.

## Checked and clean
- Personal data: `demo/agent/facts.json` and `cases.json` are labeled made-up; `evals/job-hunt/*` is generated from them. Grep for emails, key patterns and phone numbers across `agent/`, `demo/agent/`, `evals/job-hunt/`, `scripts/`, `docs/references/`, the runbook and notes found only regex source text in `check-story-entry.mjs`. `check-private` is clean (generic patterns only: no denylist is loaded here, so run it with the real one before commit).
- Network: no `fetch`, http or API key anywhere in `agent/`. Synced studio tools make no network calls of their own. `browser.mjs` and `ux-shots.mjs` drive a local Playwright browser; `browser.mjs` stubs cdnjs and Google Fonts rather than fetching. `stamp-run.mjs --test` and `qa-run3.mjs` run a caller-given shell command (caller trust, not model-reachable). `stamp-run` keeps only token sums, never transcript text. `log-agent-run.sh` logs agent name and time only. `eval-miss-cases.mjs` passes the full environment to the child tests it generates (info only; content comes from the repo).
- Path guard: `assertOutsideRepo` resolves symlinks and allows only the three exact shipped files, read-only. The tracker is never exempt.
- Injection to a send path: none exists. Posting text and draft JSON are parsed with `JSON.parse`, validated, and written as JSON data. Nothing is executed, fetched or sent. `track` accepts only found/drafted/dropped, checked before any write.

## Findings

**FIXED. PS-R8 (P1, reproduced) `approve` and `begin` are reachable by the model; "human only" rests on the prompt.** The subagent has a shell and `agent/run.ts` is one file, so it can run `node agent/run.ts approve <id>` (I did, with no TTY: the role went to `sent` with `approvedBy: "cli"`). The runbook says "keep them out of its prompt", which is not a control, and a hostile posting can ask for it (LLM01/LLM06 excessive agency). Same for `status`, and for `begin`, which resets the limits. The model can also append a forged `{"status":"sent","approvedBy":"cli"}` row to the tracker file or edit `run-state.json` directly, since both sit in one writable folder. Fix, failing test first: (a) `approve`, `status` and `begin` refuse unless stdin and stdout are a TTY (`process.stdin.isTTY`), which a subagent's shell is not; (b) run the subagent with a tool allowlist limited to `node agent/run.ts <scan|score|tailor-submit|outreach-submit|track|metrics>` and no raw file writes (document it in AGENT-NOTES); (c) say plainly in the runbook that a prompt is not the guard. Standard: STRIDE Elevation, ASVS V4.1.

**FIXED. PS-R9 (P1, reproduced) Role id from the jobs file is used in a file name: path traversal on write.** `save()` builds `${roleId}-${kind}-${n}.json` under `drafts/`. The id only has to exist as a key in the jobs file, which comes from a scrape or export. With id `../../evil`, `tailor-submit` wrote `<tracker dir>/../evil-resume-1.json` (outside `drafts/`). A crafted id can land a `.json` file anywhere the user can write, including inside the public repo, bypassing the guard. `wx` prevents overwrite only. Fix: require ids to match `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$` (reject `..` and separators) in `requireRole`, and build the name from a counter, not the id. Standard: ASVS V12.3 and V5.

**FIXED. PS-R10 (P2) A `sent` count can be forged and the approval marker is not checked.** `computeMetrics` counts any `sent` status row (`ever("sent")`), with or without `approvedBy: "cli"`, so a hand-written or model-written row inflates the headline number. Carry-over of PS-R5. Fix: count `sent` only from rows with `approvedBy === "cli"`; make `fold` and `metrics` skip a `sent` row without it. A plain file cannot stop a user-level forger (needs PS-R8 controls), but the metric should not trust it. Standard: STRIDE Tampering and Repudiation.

**FIXED. PS-R11 (P2) Limits and kill switch fail open and are checked once.** `readState` returns zero steps on a corrupt or missing file, so deleting or breaking `run-state.json` resets the counters (the runbook claims limits "only get tighter", which is false once the file can be edited). The kill switch is checked only in `begin`, so creating `.claude/job-hunt.off` mid-run does not stop the loop. Fix: check the switch on every command; treat an unreadable state file as limit reached; update the runbook wording. Standard: ASVS V11 (business logic limits).

**PS-R12 (P2) Grounding checks ids, not content; the link check is still shallow.** A claim can carry any text as long as it cites a real fact id, so an injected claim ("Led a team at Acme") passes. Resume drafts get no link or email check at all, and the outreach check misses bare domains and markdown links (PS-R4, unchanged). A human reads every draft, so impact is a bad draft, not a send. Fix: one validator for all drafts (domain-like tokens and `@` must appear in the facts); log a warning when claim text shares no words with the cited fact. README "grounded" wording should say "cites a fact id", not "true". Standard: ASVS V5, OWASP LLM01.

**PS-R13 (P2) Run artifacts can land in the public repo.** The runbook writes `docs/runs/<date>-job-hunt.md` and `evals/job-hunt/runs/<run id>/transcripts/` inside the repo. Transcripts and run-log bodies will hold posting text, company names and drafts; today they use demo data, but a real run follows the same path. `.gitignore` covers `*.jsonl` only. Fix: ignore `evals/job-hunt/runs/` and `docs/runs/*-job-hunt.md` for real runs (keep demo logs by explicit add), or point `ROLE_RADAR_RUNS` outside the repo; guard `ROLE_RADAR_RUNS` with `assertOutsideRepo` for real data. Standard: CLAUDE.md hard rule 1, ASVS V8.

**PS-R14 (P2, low) `scan` and `track` pass job `title`, `company`, `url` unvalidated into the tracker and model context.** Types are not checked (an object value serialises into the tracker), and `url` is stored as is. Local only, no leak. Fix: coerce to short strings and allow only http(s) urls. Also: tracker, drafts and `run-state.json` are created with default umask; set 0600 and the folder 0700 (scheduled item from before). Standard: ASVS V5, V8.

## Scheduled
- 0600 tracker and drafts, STRIDE/LINDDUN one-pager for v2, gitleaks and dependency scan in CI: by 2026-12-07.
- Add `job-hunt` to `check-agent-run.mjs` (intake B1) so run logs are CI-gated: next sync.
- PS-R7 vendor terms: still open. v2 sends facts and postings to Anthropic through a Claude plan (Max); confirm the consumer-plan training setting and cite the page with the date before a real run.

## Needs Chase
Go for the first real-data run only after PS-R8, PS-R9 and PS-R7 are closed. Confirm the model-training and retention toggle on the Max account used.
