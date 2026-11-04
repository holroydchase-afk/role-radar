# Claims register

What we can truthfully say today, with proof. Owned by positioning; public copy only uses listed claims. Sample data only.

| Claim | Proof |
|---|---|
| Scores each role 0-100 against an editable `criteria.yaml`, with the reasons shown. | `src/scoring.ts`, `tests/` scoring suites |
| The public demo runs on made-up sample data and saves nothing. | `demo/`, the demo bar's Details drawer |
| Use the scoring from Claude through a local MCP server (`score_job`, `match_job`, `explain_score`, `get_criteria`). | `mcp/server.ts`, `tests/mcp-server.test.ts` |
| Recruiter records are owner-only on the private page. | `app/capabilities.json` |
