# Job-hunt run: runbook

Spec: `SPEC-AGENT-V2.md`. The agent is a model-driven tool loop run as a Claude Code subagent on Max, scored blind. There is no API key and no dollar cap. Real data runs on the laptop only; a cloud thread uses the made-up demo files.

## Before the first run
- Laptop only for real data: your facts, jobs export and tracker live outside the repo. A cloud thread cannot reach those paths and must not hold them.
- Set: `ROLE_RADAR_FACTS` (JSON `{facts:[{id,text,tags}]}`, shape in `demo/agent/facts.json`), `ROLE_RADAR_JOBS` (jobs export, shape in `demo/seed.json`), `ROLE_RADAR_TRACKER` (a `.jsonl` file). Optional: `ROLE_RADAR_RUNS` (run logs, default `docs/runs`), `ROLE_RADAR_MAX_ROLES` (5), `ROLE_RADAR_MAX_STEPS` (30). Any path inside the repo is refused.
- The posting text and your facts go to the model vendor through your Claude plan. Check its data terms before a real run.

## One run
1. **Begin (you, from a terminal).** `node agent/run.ts begin` checks the kill switch (`scripts/agent-guard.mjs kill job-hunt`; create `.claude/job-hunt.off` or `.claude/agents.off` to halt) and resets the step and role counters in `run-state.json` beside the tracker. It refuses without a terminal, so the model cannot run it. Only `begin` creates `run-state.json`: if it is missing or unreadable, every model command refuses (it fails closed, it does not reset), and you must run `begin` again. The kill switch is re-checked on every model command, including `metrics`, so creating the file mid-run stops the loop.
2. **Loop.** Start a Sonnet subagent with the run prompt in `docs/eng/AGENT-NOTES.md`, with a tool allowlist: only `node agent/run.ts scan|score|tailor-submit|outreach-submit|track|metrics` and no raw file reads or writes of the tracker folder. It runs `scan`, `score <id>`, writes a draft, pipes it into `tailor-submit <id>` or `outreach-submit <id>`, and records `track <id> found|drafted|dropped`. Ungrounded drafts are rejected with a one-line reason; limits refuse with `limit`. Role ids must match `^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$`; draft files are named from a counter, never from the id.
3. **Stamp.** Write `docs/runs/<date>-job-hunt.md` (an `agentrun` block, `agent: job-hunt`), then run from the caller, never the agent: `node scripts/stamp-run.mjs docs/runs/<date>-job-hunt.md --transcript <subagent.jsonl>`. Tokens in `metrics` come only from stamped logs. Cost stays "not measured" unless you pass `--prices`.
4. **Review and approve (you, from a terminal).** Read every draft in `drafts/` beside the tracker. Send it yourself, then `node agent/run.ts approve <id>` (needs a saved draft; the only path to `sent`). Later statuses: `node agent/run.ts status <id> <ready|response|interview|rejected>`. `approve`, `status` and `begin` are human-only: they refuse unless stdin and stdout are a terminal, and no env var or flag overrides that. A prompt is not the guard: a hostile posting can ask the model to run them, so the controls are the terminal check and the tool allowlist, not wording in the prompt. `metrics` counts `sent` only for rows the `approve` command marked.
5. **Metrics.** `node agent/run.ts metrics`: counts from the tracker, tokens and cost from stamped logs, else "not measured".

## Blind eval, by hand (per the studio training plan)
- `node evals/job-hunt/generate.mjs` writes `evals/job-hunt/job-hunt-<case id>/{prompt.md, graders/criteria.md}` from `demo/agent/cases.json` (8 made-up cases, 4 good and 4 bad fit).
- For each case run two Sonnet subagents on `prompt.md`: one that also uses `agent/run.ts` (demo env), one plain. Save both transcripts under `evals/job-hunt/runs/<run id>/transcripts/`.
- A fresh Opus subagent grades each response against `criteria.md` as PASS or FAIL, seeing the response only (no arm, no run order). You keep the arm key.
- 3 repeats. Record `results.json`, then `eval-miss-score` and `agent-scorecard` output under `evals/`. Publish the result with the date and run count even if the agent loses. Stop rule: under 60 percent wins over 3 runs means publish and stop adding tools.

## What is NOT proven
- Nothing has run live. No real run, no real eval numbers, no claim the agent beats a plain session.
- `job-hunt` is not yet in studio-agents `check-agent-run.mjs`, so run logs are written but not CI-gated (intake B1).
- The blind grader is a manual process; arm blindness depends on you not leaking the key.
- The demo cases are eight made-up roles; they say nothing about real postings.
- "Agent" here means a tool loop run as a Claude Code subagent, scored blind. It is not autonomous.
