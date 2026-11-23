# SPEC-AGENT-V2: RR-AGENT on the studio harness, no API key

Status: supersedes `SPEC-AGENT.md` and `docs/eng/ADR-AGENT.md` (Llm and harness parts). Public repo: demo and made-up data only.

## The bet
Chase (Nov 23): reuse the studio-agents harness (`docs/agent-harness.md`), don't rebuild it; Claude Max, no API key, no separate billing, no dollar cap. Who must believe it: hiring managers reading the portfolio, and Chase using it nightly. Proof: the agent beats a plain Claude session on a blind Opus grade over made-up roles, and every number shown comes from the tracker, `docs/runs/` logs or stamped transcripts. Stop: if the agent wins under 60% of cases over 3 runs of the set, publish the result and stop adding tools (kept from v1).

## Design (decided, refined here)
- The model is a Claude Code subagent (Sonnet). It drives the loop by running `node agent/run.ts <command>`. No LLM call and no `fetch` in this repo.
- The repo holds only deterministic, product-specific code. Judgement (what to draft, what to say) is the model's; checking it is the repo's.
- Commands: `scan`, `score <id>`, `tailor-submit <id>` and `outreach-submit <id>` (draft JSON on stdin), `track <id> <found|drafted|dropped>`, `metrics`. CLI-only, never named in the run prompt: `status <id> <status>`, `approve <id>` (only path to `sent`).
- Draft JSON: `{claims:[{text, fact_ids:[...]}], gaps:[...], text}`. A claim without a known fact id is rejected; `gaps` lists skills the role needs that facts lack.
- Real facts and tracker live outside the repo (`ROLE_RADAR_FACTS`, `ROLE_RADAR_TRACKER`, `ROLE_RADAR_JOBS`). Demo data in `demo/agent/`.
- Run task prompt: `docs/eng/AGENT-NOTES.md`. Runbook: `docs/product/JOB-HUNT-RUN.md`. No agent file in this repo.
- Studio tools replace the harness: `agent-guard kill` before a run; run log `docs/runs/<date>-job-hunt.md` checked by `check-agent-run`; `stamp-run` for real tokens after; `agent-scorecard`; `eval-miss-cases` and `eval-miss-score`; grader is a fresh Opus subagent blind to arm.
- Limits instead of a cost cap: max roles per run (default 5) and max steps (default 30) as command counters, enforced by `run.ts` with a state file beside the tracker. Tokens and cost shown as stamped numbers or "not measured". Never a dollar figure the repo computed.

## Acceptance criteria (auto = test, manual = Chase or a live run)
Obsolete from SPEC-AGENT: AG-1..6, 12..14, 16 (prompt part), 18 (fetch part), 21..24, 27. Kept as-is: AG-7, 9, 10, 11, 19, 20. Reworded below: AG-8, 15, 17, 18, 25, 26, 28.

Deletions and no-API
- AGV2-1 (auto) Given the repo, then `agent/` has no `fetch`, `node:net`, `node:http`, `nodemailer`, `ANTHROPIC_API_KEY` or `x-api-key` (source scan). Replaces AG-5, 6, 18.
- AGV2-2 (auto) Then `agent/` has no price table, usd arithmetic or `Llm` import; no file named harness, llm, loop, evals. `package.json` gains no dependency.
- AGV2-3 (auto) Given `ROLE_RADAR_FACTS`, `_TRACKER` or `_JOBS` unset or inside the repo (symlinks included), when any command that needs it runs, then exit non-zero naming the variable and nothing is written in the repo. `scan` and `score` fall back to demo data only with `--demo`.

Tools
- AGV2-4 (auto) `scan` prints roles from the jobs export (`--demo`: `demo/seed.json`), no network, and stops at max roles per run.
- AGV2-5 (auto) `score` output equals `scoreJob` plus `explain` for the same job and criteria (AG-11 kept).
- AGV2-6 (auto) Given a draft citing a fact id not in facts, when `tailor-submit` runs, then exit non-zero, reason names the claim index, nothing is saved, tracker unchanged.
- AGV2-7 (auto) Given a valid draft, then it is saved under `$(dirname ROLE_RADAR_TRACKER)/drafts/` and the tracker records `drafted` with the draft ref.
- AGV2-8 (auto) Given an outreach draft that is empty, over 3 sentences, ungrounded, or contains a link or email not in facts, then `outreach-submit` rejects it and saves nothing.
- AGV2-9 (auto) Given `track <id> sent|ready|response|interview|rejected`, then refused and logged `refused_status`; only found, drafted, dropped pass. Replaces AG-8.
- AGV2-10 (auto) Given `approve <id>` on a role with a saved draft, then `sent` is recorded with an `approvedBy: cli` marker; without a saved draft it is refused. Stdin or argv from `tailor-submit`, `outreach-submit`, `track` cannot set that marker (tested with a draft containing `approve`).
- AGV2-11 (auto) Given more commands than max steps, or a fourth distinct role past max roles, then the command refuses with `limit` and exits non-zero.
- AGV2-12 (auto) Bad input or unknown command returns a one-line error and non-zero; never a stack trace. `--help` lists commands and omits nothing the model may use.

Metrics and run logs
- AGV2-13 (auto) `metrics` prints roles found, drafts, sent, responses, interviews from tracker only; tokens and cost only from `docs/runs/*-job-hunt.md` stamp fields, else "not measured". No tracker prints zeros and "no data". Replaces AG-25.
- AGV2-14 (auto) No repo code prints or computes dollars (test greps output and source for `usd` and `$`).
- AGV2-15 (auto) A demo run log in `docs/runs/` passes `check-agent-run` (needs AGV2-B1).

Evals, data, docs
- AGV2-16 (auto) `demo/agent/cases.json` keeps 8 made-up cases (4 good, 4 bad fit), reasons, no real companies or `@` (AG-20).
- AGV2-17 (auto) An eval case folder built by `eval-miss-cases` from the 8 cases has `criteria.md` per case with groundedness (no invented claims), fit judgement vs label, and usefulness; no arm names in it.
- AGV2-18 (manual) Per the training plan: run the agent and a plain Claude session on each case as Sonnet subagents; a fresh Opus subagent grades each PASS or FAIL blind to arm; `eval-miss-score` and `agent-scorecard` output saved under `evals/`. 3 repeats. Result published even if the agent loses, with date and run count.
- AGV2-19 (manual) Chase reads two drafts from a real run and confirms nothing is invented.
- AGV2-20 (auto) `npm run check:private` clean; README section, `HANDOFF.md`, RR-DEC-8 ("drafts only, `sent` needs CLI approval") updated; no real data in diff.

## File-by-file
- `agent/harness.ts` DELETE. `agent/llm.ts` DELETE. `agent/loop.ts` DELETE. `agent/evals.ts` DELETE.
- `agent/config.ts` CHANGE: keep `REPO_ROOT`, `assertOutsideRepo`; delete model ids, `PRICES`, `PRICES_AS_OF`.
- `agent/tools.ts` CHANGE: keep scan, score, track; replace LLM-backed tailor/outreach with `tailor-submit` and `outreach-submit` validators; drop `ToolDef`, Llm and Harness imports.
- `agent/tracker.ts` KEEP; change the `harness.log` option to a plain refusal log line; add `approvedBy`.
- `agent/metrics.ts` CHANGE: drop usd and token sums from a harness log; read stamp fields from run logs.
- `agent/run.ts` CHANGE: command dispatcher (above); remove `eval`, `anthropicLlm`, harness; add step and role counters.
- `demo/agent/facts.json`, `demo/agent/cases.json` KEEP. `docs/eng/AGENT-NOTES.md` CHANGE (run prompt). New: `docs/product/JOB-HUNT-RUN.md`, `docs/runs/`, `evals/job-hunt/` case spec.
- `docs/product/SPEC-AGENT.md`, `docs/eng/ADR-AGENT.md` mark superseded at top.

## Tests
- DELETE: `agent-llm`, `agent-harness`, `agent-loop`, `agent-evals`; the cap, price and usd cases inside `agent-config`, `agent-cli`, `agent-metrics`.
- REWRITE: `agent-tools` (submit validators, AGV2-4..8, 11), `agent-tracker` (AGV2-9, 10), `agent-cli` (AGV2-12, 3), `agent-metrics` (AGV2-13), `agent-privacy` (AGV2-1, 2, 3, 14; keep path and demo-data checks).
- NEW: `agent-runlog` (AGV2-15), `agent-cases` (AGV2-16, 17). Test glob `tests/*.test.ts` unchanged.

## Slices (1 session each, docs/tests/agent code only, no live page or demo)
1. qa-tdd red tests above, engineer deletes and rewrites (AGV2-1..14). 2. Runbook, run prompt, `docs/runs` demo log, case spec (AGV2-15..17, 20). 3. Manual eval and publish (AGV2-18, 19).

## Blockers and questions
- B1 Intake to studio-agents: add `job-hunt` to `AGENTS` in `check-agent-run.mjs` (one line plus test). Until then AGV2-15 and run logs fail validation. Recommend: file today; meanwhile the run log is written but not CI-gated.
- B2 `stamp-run` and `agent-scorecard` need the Role Radar repo to sync tools (`sync-tools.sh`, everything, flat into `scripts/`). Recommend: sync all.
- B3 Blind grader is a hand process (harness gap 1). Recommend: use it as written, record what was missing for gap 8.
- Q1 `ROLE_RADAR_JOBS` as export path for `scan`. Recommend yes (live DB unreachable from repo).
- Q2 Max roles 5, max steps 30. Recommend yes.
- Q3 Facts format JSON `{id, text, tags}`; you write the real one outside the repo. Recommend yes.
- Q4 A cloud thread cannot reach a laptop path for real facts; real runs happen locally. Recommend laptop only, demo in cloud.
- Q5 Is a Claude Code subagent loop "an agent" for the portfolio? It matches the studio bar, but claim only "model-driven tool loop run as a Claude Code subagent, scored blind", never "autonomous".
