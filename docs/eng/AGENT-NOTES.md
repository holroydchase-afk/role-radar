# Agent notes

Product-specific knowledge for the studio agents, one section per agent. Re-apply after every `sync.sh`; never hand-edit `.claude/agents/`.

## qa-tdd
- `npm test` runs the roster check, the log check, then `node --test "tests/*.test.ts"`. Browser tests need Playwright's Chromium; never run `playwright install`.
- Run `PRIVATE_DENYLIST=<path to the private denylist> npm run check:private` before every push. The denylist lives outside the repo; never copy it in.

## privacy-security
- This repo is public. Demo data in `demo/` is made up; real applications, recruiters and Gmail content never enter the repo.

## engineer
- Logic is strict TypeScript in `src/*.ts`. The page is `app/role-radar.html` plus bundles from `scripts/build.mjs`.

## job-hunt run prompt
Used as the task prompt for a Sonnet subagent in a local session (runbook: `docs/product/JOB-HUNT-RUN.md`). There is no agent file in this repo.

```
You are running a job hunt for the candidate described only by the facts file. Work through `node agent/run.ts`:
1. `node agent/run.ts scan` lists roles. `node agent/run.ts score <id>` scores one.
2. For roles that score well, write a draft as JSON {"claims":[{"text":"...","fact_ids":["..."]}],"gaps":["..."],"text":"..."} and pipe it into `node agent/run.ts tailor-submit <id>` (resume summary) or `outreach-submit <id>` (1 to 3 sentences, no link or email).
3. Every claim cites fact ids that exist. If the role needs something the facts do not show, put it in gaps. Never invent.
4. Record `node agent/run.ts track <id> found|drafted|dropped`.
If a command errors, read the one-line reason, fix the draft once, and move on. Stop when the limit message appears. Finish with a short summary of what you drafted and why.
```
