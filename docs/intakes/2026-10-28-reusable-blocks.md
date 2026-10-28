# INTAKE for Product Studio: reusable blocks from Role Radar (RR-M3.7, 2026-10-28)

Paste this into the Product Studio project. It touches studio-agents and pm-tools only; Role Radar's own repo already carries its side (PR "RR-M3.4").

## 1. Plain-JS CI seed for studio-agents `templates/repo/` (STACK.md row "CI, Pages deploy gated on CI, dependabot, README badge": Now)
Role Radar now has the three files, proven on its PR stack. Copy them as the plain-JS variant:
- `.github/workflows/ci.yml`: on `pull_request` and push to `main`; `contents: read`; `npm ci`, the personal-data check, `npx playwright install --with-deps chromium`, `npm test`, then the demo build. No secrets.
- `.github/workflows/pages.yml`: triggered by `workflow_run` of `ci` on `main` (`types: [completed]`), deploys only when `conclusion == 'success'` and the run's event was `push`; checks out `workflow_run.head_sha`; `pages: write` and `id-token: write` only on the deploy job.
- `.github/dependabot.yml`: npm + github-actions, weekly, minor and patch grouped.
- README badge with a relative link, so no owner name is hard-coded: `[![ci](../../actions/workflows/ci.yml/badge.svg)](../../actions/workflows/ci.yml)`.
Source: the role-radar repo, branch of the RR-M3.4 PR (or main once merged). `tests/ci-config.test.mjs` there pins the rules (CI runs `npm test` and the privacy check; Pages waits for CI) and could ship with the template.
Gap seen: pm-tools has no `ci.yml` either.

## 2. Privacy check as a shared script (STACK.md row "Privacy check": Now)
Split Role Radar's `scripts/check-private.mjs` into the shared scanner (studio-agents `templates/scripts/`) plus a small per-repo patterns file (allowed email domains, extra patterns). Keep the private denylist outside every repo (`PRIVATE_DENYLIST=...`).
Found tonight: the studio-refresh files synced from studio-agents (CLAUDE.md, `scripts/check-agents.sh`, `scripts/check-logs.mjs`, `.claude/agents/architect.md`) name the GitHub owner, which the private denylist blocks on purpose (repo content must not link the GitHub handle). Role Radar rewords its copies to "studio-agents" in RR-M3.7. Fix at the source: drop the owner name from those files in studio-agents (say "the studio-agents repo"), so the next `/onboard refresh` doesn't bring it back.

## 3. Demo kit note (STACK.md row "Demo kit": when Crew Clock or Charlie builds a demo)
Role Radar's `demo/mock-claude.js` is a richer second demo kit than pm-tools' `fake-db.js`: it enforces database access rules (owner-only paths), fakes MCP connectors (Gmail), supports `?as=viewer`, and has test-only `?fail=<collection>` / `?hold=<collection>` hooks for loading and error states. Consider merging the two when the next demo is built. Not urgent.

## 4. Pattern worth a STACK.md line (stack doc row, no shared code)
"Every app page shows a loading state before the first read and an error state with Reload on a failed read; never an empty state for either" (Role Radar RR-M3.2 found the empty tracker was indistinguishable from a broken read).
