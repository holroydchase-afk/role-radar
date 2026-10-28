# Role Radar v1 plan

Goal: a portfolio-ready v1. A recruiter or hiring manager can open the repo, understand the problem and the product in two minutes, see it working on demo data, and trust that the code is tested. The live app stays private, with real data.

Ground rules: the repo is public, so it only ever holds demo data (see CLAUDE.md). One branch and one draft PR per task, stacked in order. `HANDOFF.md` is updated in every push.

## Plan

IDs follow the studio standard (`docs/planning-ids.md` in the studio-agents repo): milestone `M1`, task `M1.1`, step `M1.1.1`. Across products this repo's code is `RR` (for example `RR-M1.5`). Status is todo, doing, blocked, done or dropped. The old M1–M4 and Hardening labels map to these IDs in `HANDOFF.md`. New branches are named `m2.1-short-name`.

### M1: Portfolio-ready v1 (done, merged Oct 21, 2026)

- [x] **M1.1: Plan and source** (done) (`m1-plan-and-source`)
  - The page (`app/role-radar.html`), an example `criteria.yaml` and a scan prompt template (`scan/scan-prompt.template.md`) are in the repo, scrubbed of personal data.
  - Fictional demo data (`demo/seed.json`) and an in-memory database (`demo/mock-claude.js`) run the page outside claude.ai: `npm run build:demo` writes `dist/demo.html`.
  - `npm run check:private` blocks personal data (emails, phones, artifact links, task ids, Gmail links, plus a private denylist kept outside the repo); a pre-commit hook runs it.
  - `npm test` passes.
- [x] **M1.2: Core flow** (done) (`m2-core-flow`)
  - Scoring from `criteria.yaml` lives in a pure, tested module (`src/scoring.js`): matching gates, hard excludes, sector weight, fit, culture, comp, values penalty, clamp, minimum score, and digest caps per sector.
  - The page uses the same module to show a score breakdown, so the rules the scan follows are visible and checkable.
  - Known page bugs fixed, with a browser test for each (see HANDOFF.md).
  - A browser smoke test loads every tab on demo data with no console errors.
  - Fixes are applied to the live private artifact too.
- [x] **M1.3: Case study** (done) (`m3-case-study`)
  - README reads as a short case study: the problem, how it works (diagram), what it saves, what I would do next.
  - Screenshots of the main tabs, captured by script from demo data only (`npm run screenshots`).
- [x] **M1.4: Privacy toggle** (done) (`m4-privacy-toggle`)
  - One switch hides recruiter names and notes (initials plus company only) and remembers the choice per viewer; on by default on any shared view.
  - Browser test proves names are absent from the page when hidden.
  - Applied to the live private artifact.
- [x] **M1.5: Hardening** (done) (`hardening`)
  - Edge cases: missing or broken criteria, js-yaml failing to load, empty collections, past and future due dates.
  - Docs: how to run your own copy (`docs/SETUP.md`).
  - Phone: filters fold behind one button so roles show on the first screen.

### M2: v1.1, fit ratings and onboarding

- [x] **M2.1: Culture and values ratings** (done, PR #11) (`culture-values-ratings`): values and culture badges with reasons, filters and a "Best culture" sort. Badges never change the score.
- [x] **M2.2: Gmail onboarding** (done, PR #12) (`gmail-onboarding`)
  - Recruiters tab: *Import from Gmail* searches the inbox through the viewer's Gmail connector (read-only tools only), lists the people found for review, and saves only the ones picked. Opens by itself while the list is empty.
  - Pure, tested module `src/gmail-import.js`: skips sent mail, no-reply senders, job boards and applicant tracking systems; company from the email domain; agency vs in-house vs referral; last contact from the newest email (long threads read in full); marks people already in the list.
  - Demo: a fake Gmail connector over fictional threads, so the flow runs in tests and screenshots.

- [x] **M2.3: Gmail status backfill** (done, draft PR) (`claude/project-thread-0029ai`)
  - Pipeline tab: *Check Gmail for status updates* finds application confirmations, interview invites, rejections and offers from the companies in the pipeline and suggests status changes for review. Nothing is saved until ticked.
  - Pure, tested functions in `src/gmail-import.js`: signal from subject and snippet, role matched by company (title breaks ties), forward-only moves (or Rejected), the email's date as the status date, old emails from an earlier application ignored.
  - Live app only; the public demo stays radar only.

- [x] **M2.4: Private recruiters** (done, PRs #34-#36, live page republished Oct 24): recruiter records are owner-only through a database rule (`app/capabilities.json`); `src/recruiter-store.js` keeps viewers who aren't the owner from asking for them. Design: `docs/private-recruiters.md`.
- [x] **M2.5: Culture gate** (done, PR #38): roles with hard culture red flags are skipped, startups get -20. Live page not yet republished with it.
- [ ] **M2.6: Progress tab and skip feedback** (draft PRs #39, #40): one source for the Progress tab and the daily email; a skip takes a reason chip and a comment, and skips suggest criteria changes.

### M3: Functional, recruiter-grade release (planned Oct 28, 2026)

Goal: the real product works on day one for a new user, CI gates every deploy, and the demo shows what the scan produces. One draft PR per task, stacked.

- [x] **M3.1: Plan**: this section, posted to Chase.
- [x] **M3.2: Works for real**: an empty tracker can enter criteria (editor + "Start from the example"); a stale-scan warning; loading and error states that don't look like an empty tracker; adding a role or company twice no longer overwrites the first.
- [x] **M3.3: UI to 8/10**: ux-reviewer before and after at 390 and 1280 px; fix P0 and P1, park P2s.
- [x] **M3.4: Harden**: `ci.yml` runs the full test suite and the privacy check on every PR; Pages deploys only after CI passes; dependabot; README CI badge; privacy-security review.
- [x] **M3.5: Enhancements**: a "This morning's digest" card on New (what the scan sends, from the same scoring code); deep links (`?tab=`, `#role-`) to the proof screens.
- [x] **M3.6: Demo check**: build and load the public demo headless, then load chaseholroyd.com/role-radar/.
- [x] **M3.7: Reusable blocks**: CI, dependabot and the gated deploy here; shared privacy check and plain-JS repo template go to Product Studio as an INTAKE.

## Later

Unnumbered until scheduled into a milestone.

- Chat with Role Radar.
- "Reuse this resume": find other saved roles a tailored resume already fits.
- Open-source kit so other job seekers can run their own copy.
