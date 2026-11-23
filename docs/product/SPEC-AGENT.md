# SPEC-AGENT: RR-AGENT, a job-hunt agent inside Role Radar

Status: draft for Chase's go. Scope source of truth for RR-AGENT. Public repo: demo and made-up data only.

## The bet
Chase: "a real job-hunt agent (a tool loop where the model chooses tools)". Who must believe it: hiring managers reading the portfolio, and Chase using it nightly. Proof: the agent beats plain Claude on a blind Opus grade over made-up roles, and every number shown comes from logs or the tracker. Stop condition: if after PR 3 the agent does not beat single-prompt Claude on the eval (win rate under 60% over 3 runs of the set), publish the result anyway and stop building tools; the finding is the story.

## Decided by Chase (not re-litigated)
TypeScript in `agent/`, Node 22 type stripping (like `mcp/server.ts`). No new dependency: Messages API via `fetch` behind an injectable `Llm` interface; tests use a fake. Real facts, tracker and logs live outside the repo: env `ROLE_RADAR_FACTS`, `ROLE_RADAR_TRACKER`, `ROLE_RADAR_AGENT_LOG`. Demo facts and cases in `demo/agent/` are made up. Agents run on Sonnet, grader on Opus. Local harness now, same shape as the studio-agents one, flagged for promotion.

## Tools (the model picks; the loop runs them)
- `scan`: returns roles from the existing weekday scan output (the jobs store the page reads). No second scraper. Demo reads `demo/seed.json`.
- `score`: `src/scoring.ts` (`matchJob`, `scoreJob`, `explain`) with the explanation text. No new scoring logic.
- `tailor`: draft resume plus short cover note, grounded only on the facts file.
- `outreach`: 1-3 natural sentences per role to a hiring manager or recruiter.
- `track`: writes every role, draft and status to the tracker.

## Hard rules for the agent
- Drafts only. Nothing is sent, submitted or emailed. No tool has a send path.
- `sent` status is refused by `track` unless the call carries Chase's explicit approval flag, set by the CLI (`--approve-sent <roleId>`), never by the model.
- Never invent experience: every claim in a draft maps to a fact id in the facts file.

## Harness (`agent/harness/`)
Run log JSONL (one event per line: run id, ts, agent, model, event, tool, input/output tokens, usd, ok). Token counts come from API `usage`, never estimated. Kill switch: a file `<log dir>/KILL` or env `ROLE_RADAR_AGENT_KILL=1`, checked before every LLM call and tool call. Cost cap: env `ROLE_RADAR_AGENT_MAX_USD` (default 1.00 per run), summed from logged usage times a price table in code. Opus blind grader in `agent/evals/`.

## Acceptance criteria
Type: auto = test, manual = Chase or a live run.

Harness and LLM (PR 1)
- AG-1 (auto) Given a fake `Llm` returning usage {input:120, output:30}, when a call is made, then the log has one JSONL line with those exact counts and a usd computed from the price table.
- AG-2 (auto) Given `ROLE_RADAR_AGENT_LOG` unset, when a run starts, then it fails with a message naming the variable and writes nothing inside the repo.
- AG-3 (auto) Given the KILL file exists or env is 1, when the loop would make its next LLM or tool call, then it stops, logs `killed`, and makes no further call.
- AG-4 (auto) Given logged usd crosses the cap mid-run, then the next call is refused, `cap_hit` is logged, and the run exits non-zero.
- AG-5 (auto) Given a real `Llm` with `fetch` stubbed, when called, then it posts to the Messages API with the model id, tools and `x-api-key` from env, maps `usage` and `tool_use` blocks, and never logs the key.
- AG-6 (auto) Given `ANTHROPIC_API_KEY` unset, then the real Llm fails with a clear message before any request.
- AG-7 (auto) Given the tracker file, when `track` writes, then entries append with role id, status, draft refs and timestamp; the file lives at `ROLE_RADAR_TRACKER`.
- AG-8 (auto) Given status `sent` without the approval flag, then `track` refuses, logs `refused_sent`, and the tracker is unchanged. With the flag for that role id, it records `sent`.
- AG-9 (auto) Given a status outside found, drafted, ready, sent, response, interview, rejected, dropped, then `track` rejects it.

Tools and loop (PR 2)
- AG-10 (auto) `scan` returns jobs from the seed shape and does not call the network.
- AG-11 (auto) `score` output equals `scoreJob` plus `explain` for the same job and criteria (pinned against `src/scoring.ts`).
- AG-12 (auto) Given a fake Llm that requests tools in order scan, score, tailor, outreach, track, then the loop executes them in that order, feeds results back, and ends on a final message.
- AG-13 (auto) Given the model names an unknown tool or bad input, then the loop returns an error result to the model and continues; it does not crash.
- AG-14 (auto) The loop stops at a max-turn limit (default 12) and logs `max_turns`.
- AG-15 (auto) `tailor` rejects a draft whose claims cite a fact id not in the facts file, and the draft is not saved as `ready`.
- AG-16 (auto) Given a facts file lacking a skill the role needs, the tailor prompt forbids claiming it and the draft lists it under "gaps"; a fake Llm that invents a claim is caught by AG-15.
- AG-17 (auto) `outreach` rejects output over 3 sentences or empty, and any output containing a link or email address not in the facts file.
- AG-18 (auto) No tool module imports `node:net`, `node:http`, `nodemailer` or similar, and no tool calls `fetch` (only the Llm does). Pinned by a source-scan test.
- AG-19 (auto) Real facts path inside the repo tree is refused.

Evals, metrics, CLI, docs (PR 3)
- AG-20 (auto) `demo/agent/cases.json` holds at least 8 made-up roles, each labeled good or bad fit, with a reason; a test checks the labels and that no real company names or `@` addresses appear.
- AG-21 (auto) Eval runs each case through the agent and through plain Claude (one prompt, same facts and criteria). Output pairs are assigned to A or B by a seeded shuffle; the grader prompt contains no hint of which is which; the key is stored only in the eval result.
- AG-22 (auto) The grader runs on Opus, the agents on Sonnet; the model ids are asserted in the call log.
- AG-23 (auto) The grader scores fit judgement (does it agree with the label), groundedness (no invented claims), and usefulness, 0-5 each, returned as JSON; malformed JSON is retried once then logged as a failed grade, not dropped.
- AG-24 (auto) Eval report shows win/tie/loss for the agent, mean scores, tokens and usd per arm, all read from the log.
- AG-25 (auto) `metrics` prints roles found, drafts ready, applications sent, responses, interviews, computed only from the tracker and log. With no tracker it prints zeros and says "no data", never a guess.
- AG-26 (auto) CLI: `node agent/cli.ts run|eval|metrics`, with `--approve-sent <roleId>`; `--help` lists them; the model has no way to pass the approval flag.
- AG-27 (manual) With `ANTHROPIC_API_KEY`, one demo run and one eval pass on the laptop; Chase reads two drafts and confirms nothing is invented. Not possible tonight.
- AG-28 (auto) `npm run check:private` clean; README section and `HANDOFF.md` updated; no real recruiter, company contact or job-search data in the diff.

## PR slicing (each about 1 session, merge on green, none touches the live page or demo)
1. PR 1: `agent/harness/` (log, kill, cap, price table), `agent/llm.ts` (interface, fetch impl, fake), `agent/tracker.ts`, `demo/agent/facts.json`. AG-1..9, AG-19.
2. PR 2: `agent/tools/*`, `agent/loop.ts`. AG-10..18.
3. PR 3: `agent/evals/`, `demo/agent/cases.json`, `agent/metrics.ts`, `agent/cli.ts`, README and DECISIONS entry (RR-DEC-8). AG-20..26, AG-28.
Each PR: qa-tdd red first and green 3x; privacy-security on PR 1 (paths, key handling) and PR 3 (demo data); architect note on the Llm interface and harness promotion before PR 1.

## Non-goals and known blockers
- Not now: sending email or applying (never), ZipRecruiter and Gmail intake (not reachable from a scheduled run), multi-agent orchestration, scheduling the agent, a UI on the page, resume file export beyond Markdown, any change to the live page or public demo.
- Blocker: no live API run possible without `ANTHROPIC_API_KEY`; AG-27 and any real eval numbers wait for Chase.
- Blocker: studio-agents shared harness not visible here. The local harness copies its intended shape (JSONL events, kill, cap); flag for promotion into studio-agents and swap when reachable.
- Price table is hardcoded and can go stale; usd is "from real usage times listed price", and the table carries a date.

## Metrics (signal per goal)
Roles found, drafts ready, applications sent, responses, interviews: counted from tracker and log only. Eval signal: agent win rate vs plain Claude, blind. Cost signal: usd per ready draft from the log. Nothing is quoted in the README unless a log or tracker produced it.

## Morning questions for Chase
1. Where does `scan` read from? Recommend a JSON export of the scan's jobs (path in `ROLE_RADAR_JOBS`, a fourth env var) because the live database is not reachable from the repo; demo uses `demo/seed.json`.
2. Per-run cost cap default: recommend $1.00 for runs, $5.00 for a full eval.
3. Facts file format: recommend JSON with ids per fact (`{id, text, tags}`) so claims are checkable; you write the real one outside the repo.
4. Eval size: recommend 8 cases (4 good, 4 bad), 3 repeats, to keep one eval under about $5.
5. Publish eval results in the README even if the agent loses? Recommend yes, labeled with date and run count.
6. Approve a decision entry RR-DEC-8 for "drafts only, `sent` needs explicit approval". Recommend yes.
7. Model ids and price table: confirm which Sonnet and Opus ids to pin. Recommend pinning in one config file, no aliases.
