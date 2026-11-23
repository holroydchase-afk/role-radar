# Reuse: studio-agents promotion candidates

The job-hunt agent reuses the studio-agents harness (kill switch `agent-guard`, run logs `check-agent-run`, `stamp-run`, `agent-scorecard`, `eval-miss-*`) instead of carrying its own. The v1 `agent/harness.ts` and `agent/llm.ts` are deleted.

Not promoted yet. Promote once a second product needs them: copy the file plus a sync script first, no package (reuse rule).

| Candidate | Files | What it is | Note |
|---|---|---|---|
| Repo-path guard | `agent/config.ts` | `assertOutsideRepo`: refuses real-data paths inside a public repo, symlinks included | No Role Radar imports. |
| Draft grounding check | `agent/tools.ts` | every claim cites a known fact id; outreach length, link and email checks | Imports `src/scoring.ts` for scoring; split the checks out when promoting. |
| Eval case generator | `evals/job-hunt/generate.mjs` | writes blind `prompt.md` and `graders/criteria.md` per case; studio `eval-miss-cases` has no job-hunt mode yet | Fold into studio-agents with intake B1. |
