# ADR-AGENT: harness and Llm interface for RR-AGENT (before PR 1)

Status: proposed, architect review 2026-11-23. Scope: docs/product/SPEC-AGENT.md. Repo-only decision (no STU-DEC); promotion is a later studio call.

## Verdict: OK with changes (rung: "one-off script, Node 22 runs `.ts` directly, `tsc` noEmit")
No new dependency. `package.json` is untouched: the real Llm is `fetch` (Node 22 built in) to the Messages API. Both runtime deps (`js-yaml`, MCP SDK) stay as they are; no Anthropic SDK.

## Llm interface (`agent/llm.ts`, fixed)
```ts
type Block = {type:"text";text:string} | {type:"tool_use";id:string;name:string;input:unknown}
           | {type:"tool_result";tool_use_id:string;content:string;is_error?:boolean};
interface Llm { complete(req:{model:string; system:string; messages:Msg[]; tools?:ToolDef[]; maxTokens:number}):
  Promise<{content:Block[]; stopReason:string; usage:{inputTokens:number; outputTokens:number}}> }
```
Exports: `realLlm({env, fetch})` (key from `ANTHROPIC_API_KEY`, checked before any request, never logged), `fakeLlm(script)` for tests. `fetch` is a constructor argument so AG-5 stubs it. Only this file may call `fetch` (AG-18).

## Harness (`agent/harness/`)
- Log: JSONL at `$ROLE_RADAR_AGENT_LOG` (unset fails, names the var, writes nothing in the repo). One event per line: run id, ts, agent, model, event, tool, input/output tokens, usd, ok. Tokens are API `usage` only.
- Kill: file `<log dir>/KILL` or `ROLE_RADAR_AGENT_KILL=1`, checked before every LLM and tool call.
- Cap: `ROLE_RADAR_AGENT_MAX_USD` (default 1.00), summed from the log, so a restarted run still counts.
- One config file `agent/harness/config.ts`: pinned model ids (no aliases) and the price table, with an "as of" date and per-million-token rates. Confirm the Sonnet and Opus ids with Chase (open question 7); I did not invent them.
- Wrap the Llm in a `metered(llm, harness)` decorator, so loop, tools and eval share one choke point for log, kill and cap.

## Where real data lives
Env paths outside the repo: `ROLE_RADAR_FACTS`, `ROLE_RADAR_TRACKER`, `ROLE_RADAR_AGENT_LOG` (plus `ROLE_RADAR_JOBS` if Chase approves). Resolve to a real path and refuse anything inside the repo root, symlinks included (AG-19; apply it to all four paths, not only facts). Repo holds only `demo/agent/` made-up data. Log lines carry no prompt text and no facts, only counts and ids.

## Risks
1. **Type stripping.** Erasable syntax only: no `enum`, `namespace`, parameter properties, or `import =`. Use `import type`, and `.ts` extensions in imports (already enforced by tsconfig `erasableSyntaxOnly`, `verbatimModuleSyntax`). Node 22.18+ is needed (mcp/server.ts has the same floor); CI pins `node-version: 22`, so fine.
2. **tsconfig `include` is `src, tests, mcp`.** `agent/` would not be typechecked. PR 1 must add `agent` to `include`. Low risk, no workflow change.
3. **Test glob is `tests/*.test.ts`.** Put agent tests in `tests/` (e.g. `tests/agent-*.test.ts`) or the CI `npm test` will not run them. Do not change the script.
4. **No CI workflow change needed** for PR 1. If anyone adds a live-API step to `ci.yml`, stop: that needs a secret and my review. Live runs stay on the laptop (AG-27).
5. **Cap race.** The cap is checked before each call, so one call can overshoot by its own cost. Acceptable; say "cap is checked before each call" in the README.
6. **Price table staleness.** usd is an estimate from listed prices; the table carries a date, and nothing in the README quotes usd without a log.
7. **check-private** scans the diff; keep the key name only as an env var name, and put no sample keys in tests (use `"test-key"`).

## Promote to studio-agents later (not now)
Candidates once a second product needs them: `harness/` (JSONL log, KILL, cap, `metered`), the `Llm` interface plus fake, and the blind-grader eval shape. Per the reuse rule: copy file plus sync script first, no package. Record them in `docs/REUSE.md` when PR 1 lands. Keep harness files free of Role Radar imports so they copy cleanly.

## Cost to undo
Low: a new `agent/` folder, one `tsconfig` line, no dependency or workflow. Delete the folder to remove it.
