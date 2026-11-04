# Lessons

Post mortems, newest first: what happened, why, the rule or guard it added. Read before picking a version or calling a build ready. Public repo: no personal data.

## 2026-11-02: ubuntu-latest broke browser tests
`ubuntu-latest` moved to 26.04, where the pinned Playwright could not install, and CI went red on an unrelated PR. Guard: the test job is pinned to `ubuntu-24.04` and `tests/ci-config.test.ts` (RR-CI-4) fails if it is unpinned. Rule: look up the runner and tool versions you depend on instead of trusting "latest". Remove the pin once the Playwright bump passes on 26.04.

## 2026-10-31: a copied script named the repo owner
A script copied from another repo carried the owner's name in a comment, and `check:private` failed after the push. Rule: run `check:private` and read its result before pushing. Fix it with a follow-up commit, never a history rewrite.

## 2026-10-22: the demo linked to an old snapshot
The portfolio still pointed at an old demo snapshot while this repo hosted a newer one. Rule: when a change alters what the portfolio page or demo shows, update the portfolio in the same stretch of work (HANDOFF "Portfolio / public presence").
