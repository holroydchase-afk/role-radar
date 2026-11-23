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

## Findings

**PS-R1 (P1) The path guard exempts all of `demo/`, so real data can be written inside the public repo.** `assertOutsideRepo` allows any path under `<repo>/demo/`; confirmed `demo/tracker.jsonl` and `demo/agent/run.jsonl` are accepted. `.gitignore` has `*.log` only, so a real `.jsonl` tracker or log there would show up as committable and `check-private` would not flag recruiter or company names. Fix: allow only the exact shipped demo files for read-only inputs (facts, jobs); never allow `demo/` for the tracker or log (write targets). Add `*.jsonl` and `agent/*.local.*` to `.gitignore`. Standard: CLAUDE.md hard rule 1, ASVS V8.

**PS-R2 (P1) `ROLE_RADAR_FACTS` and `ROLE_RADAR_JOBS` are not guarded at all.** Only the tracker and log go through `assertOutsideRepo`. The task and README say real facts must live outside the repo; a real facts file placed in `agent/` or the repo root is accepted silently, and `eval` falls back to demo facts without saying so. Fix: guard both env paths with the same function (real facts are read-only, but the guard is what keeps them from being committed), and have `eval` print which facts file it used. Standard: data minimization, ASVS V8.

**PS-R3 (P2) Prompt injection cannot reach a send path, but it can steer the tracker.** A hostile posting (title, company, description) can persuade the model to call `track` with `ready`, `response`, `interview` or `dropped`, which inflates `metrics` and hides roles. Harm is integrity only and local. Fix: the model may set only `found`, `drafted`, `dropped`; `ready` and later statuses are human-set via CLI. Test: a track call with `interview` is refused. Standard: STRIDE Tampering, OWASP LLM01.

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
