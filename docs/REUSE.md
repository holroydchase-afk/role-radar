# Reuse: studio-agents promotion candidates

Not promoted yet. Promote once a second product needs them: copy the file plus a sync script first, no package (reuse rule). Keep these files free of Role Radar imports so they copy cleanly.

| Candidate | Files | What it is | Note |
|---|---|---|---|
| Harness | `agent/harness.ts` | JSONL run log, KILL switch, spend cap, `CapExceeded` / `KilledError` | Imports `assertOutsideRepo` from `agent/config.ts`; split that out when promoting. |
| Llm | `agent/llm.ts` | `Llm` interface, `anthropicLlm` (fetch only), `fakeLlm` for tests | No Role Radar imports. |
