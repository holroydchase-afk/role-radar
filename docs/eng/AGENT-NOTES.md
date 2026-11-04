# Agent notes

Product-specific knowledge for the studio agents, one section per agent. Re-apply after every `sync.sh`; never hand-edit `.claude/agents/`.

## qa-tdd
- `npm test` runs the roster check, the log check, then `node --test "tests/*.test.ts"`. Browser tests need Playwright's Chromium; never run `playwright install`.
- Run `PRIVATE_DENYLIST=<path to the private denylist> npm run check:private` before every push. The denylist lives outside the repo; never copy it in.

## privacy-security
- This repo is public. Demo data in `demo/` is made up; real applications, recruiters and Gmail content never enter the repo.

## engineer
- Logic is strict TypeScript in `src/*.ts`. The page is `app/role-radar.html` plus bundles from `scripts/build.mjs`.
