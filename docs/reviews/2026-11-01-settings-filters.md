# UX review: Search settings and work/pay filters (2026-11-01)

Reviewer: ux-reviewer. Scope: `docs/settings.md` (RR-SET, RR-FA), uncommitted work on `claude/project-thread-05ro1g`, demo build (owner view, sample data). Persona: Chase, job-hunting urgently, on his phone, wants every filter and sort to be obvious (FA-10) and "the Zillow slider".

## Verdict: Needs changes (0 P0, 3 P1, 6 P2)

- Chase on a 390px phone: the settings card and sliders work well by thumb and keyboard; the quick chip he asked for is off-screen, and one checkbox does nothing.
- Recruiter/hiring manager viewing the public demo: every sample role is Remote (US), so the new filters look empty (UX-R8).

## Changes

| ID | P | Where | Problem | Fix |
|---|---|---|---|---|
| UX-R1 | P1 | Quick chips (q. d) | At 390px, "Remote (US)" starts at x=444, past the right edge of a 390px screen; "Good culture" is cut off. The one chip Chase asked for needs a sideways swipe to find. | Order: **Last 24 hrs, Remote (US), Strong fit, Good values, Good culture**. Remote (US) then sits fully in view at 390px. |
| UX-R2 | P1 | Settings, Base pay | The boxes say "Min (floor)" and "Max (stretch target)" on the same range slider the Filters sheet uses for a real min/max. "Max" reads as a cap ("roles over $185K are hidden"), but the target only adds 10 points. | Labels **"Floor"** and **"Stretch target"**. Value line: **"Floor $150K · Target $185K"**. Keep the hint. Handle names already say floor and target. |
| UX-R3 | P1 | Filters, Pay (q. b) | While Pay is "Any", unticking "Include roles with no pay listed" changes nothing (measured: 6 roles before and after, no chip). A control that silently does nothing fails FA-10. | While the range is full, disable the box and show the hint **"Set a pay range first."** under it. Enable it as soon as either handle moves. Keep it visible, so it doesn't jump into view. |
| UX-R4 | P2 | Role card (q. a) | The work type shows twice: a "Remote (US)" pill and "Remote, US · $170K–$205K · Found Nov 1". | When the card shows a pill, drop the location text from the meta line: **"$170K–$205K · Found Nov 1"**. Show the raw location only when there's no pill (Not stated). The full location stays in Details. |
| UX-R5 | P2 | Criteria tab order (q. c) | The open YAML editor sits third, so Alerts, Never show and Scoring are about 4 screens down on a phone. That puts a text box in front of readable cards for a non-technical reader. | Order: **Search settings, Digest preview, Alerts, Never show, Scoring, Fit ratings, Advanced: edit as text** (last, a `<details>` closed by default, opened automatically by SET-10's "Fix the text below first" and by *Add to criteria*). |
| UX-R6 | P2 | Filters, Pay handles | Screen readers announce the handles as "Lowest pay" and "Highest pay". "Highest pay" is also the name of a sort, so the same words mean two things (Nielsen: consistency). | Name the handles **"Pay from"** and **"Pay up to"**. |
| UX-R7 | P2 | Settings, pay boxes | The boxes show "150000" while the slider shows "$150K". It's easy to drop a zero on a phone keypad. | Put a "$" prefix inside the box. Under the boxes, add **"In dollars, e.g. 150000"**. After blur, check that the value still matches the value line. |
| UX-R8 | P2 | Demo seed | All 6 New roles are Remote (US): five Work boxes show 0, the Remote (US) chip changes nothing and Highest pay has no no-pay role to put last. On the public demo the feature looks broken. | Add sample-only roles: one "San Francisco, CA (Remote)", one "Remote, Canada", one "Denver, CO (Hybrid)" and one with no pay. |
| UX-R9 | P2 | Both pay sliders, iOS VoiceOver | The handles are custom `role="slider"` spans. Keys and drag work (measured), but whether VoiceOver can swipe up and down on them is unverified. Filters Pay has no number-box fallback. **Confirm with a real user on an iPhone.** | If swiping fails, add the Settings card's Min/Max number boxes under the Filters slider (labels "From" / "Up to"). |

Answers to the open questions: (a) yes, drop the duplicate (UX-R4); (b) disable it with a hint rather than hiding it (UX-R3); (c) move Advanced last (UX-R5); (d) Remote (US) goes second, not last (UX-R1).

## Evidence (measured vs inferred)

Measured with Playwright at 390x844 and 1280x800, light and dark, owner view on demo data. No console errors in any run.
- Sideways scroll: none on New, All or Criteria, with sheets open or closed.
- Targets: pay handles 44x44 hit areas, Work rows 173x44, no-pay row 358x44, sort rows ≥44px tall, sector segments and level chips ≥44px, Unsaved bar 60px tall. Native checkbox and radio boxes are 20px and 13px, but their whole labels are the targets. Laptop chips and buttons are 36px (desktop, as before).
- Drag: mouse drag moves each handle and snaps to $5K, and focus stays on the dragged handle. With the handles stacked at $395K/$400K, the pair can still be pulled apart.
- Keys: Arrow +$5K, Page Up +$25K, End stops $5K under the other handle, and the sheet stays open while you drag.
- Accessible names and values: Settings handles read "Base pay floor, $180K" and "Base pay stretch target, $185K". Number boxes, Priority-sector floor, level buttons (`aria-pressed`) and sector radiogroups (each named for its sector) all have names.
- After Save is pressed, the Unsaved bar appears (bar shown) and the value line updates.
- Inferred, not measured: VoiceOver gestures (UX-R9), and how long Settings takes to scan by eye.

Screenshots (scratch, not committed): `/tmp/claude-0/-home-user/a57f0741-a362-5a9d-85a7-2d06908320ca/scratchpad/shots/` (`phone-light-new.png` R1/R4, `phone-light-new-filters-work.png` R3, `phone-light-criteria.png` R2, `phone-dark-criteria-full.png` R5, `phone-light-new-remote.png`, `phone-dark-new-sort.png`).

FA-10 sweep: Work labels, Sort names and hints, "Pay: $180K–$300K" and "Work: ..." chips, and "Include roles with no pay listed" read plainly. The exceptions are UX-R3 and UX-R6. Sector levels Off/Allowed/Good/Priority come with a one-line hint, which is enough.

## Acceptance criteria for qa-tdd

- UX-R1: at 390x844, the right edge of `.chips` "Remote (US)" is ≤ 390 with no scroll, and it is the 2nd chip.
- UX-R2: `label[for=set-pay-min]` reads "Floor" and `label[for=set-pay-max]` reads "Stretch target"; `#set-pay-val` reads "Floor $150K · Target $185K".
- UX-R3: with Pay at full range, `#fv-nopay` is disabled and "Set a pay range first." is visible; after one handle moves, it is enabled.
- UX-R4: a remote_us card's meta line has no "Remote"; an unknown card still shows its location text.
- UX-R5: the last `h2`/summary in the Criteria view is "Advanced: edit as text", and it is closed by default.
- UX-R6: the Filters pay handles' aria-labels are "Pay from" and "Pay up to".

## For Chase

- Nothing needed now. Later: try both pay sliders with VoiceOver on your iPhone (UX-R9).
