# Search settings and work/pay filters (RR-SET, RR-FA)

Ask (Chase, 2026-11-01): settings as fields and sliders ("the Zillow slider"), filters and sorts that read plainly, and a way to tell "Remote, US" from "San Francisco (Remote)". Front end only: scan-side remote detection and the live criteria values belong to other threads. One PR, demo data only.

Bet: Chase changes pay, levels and sectors in under a minute on his phone without touching YAML, and cuts the city-bound "remote" noise from New with one tap. Signal: he edits criteria from the card, not the text box, the next time the values change.

## RR-SET: Search settings card (Criteria tab)

| ID | Type | Given / When / Then |
|---|---|---|
| SET-1 | auto | Given the Criteria tab, when it renders, then a "Search settings" card replaces "At a glance", and the YAML editor stays below it under the heading "Advanced: edit as text". Scoring, Fit ratings and Alerts cards are unchanged. |
| SET-2 | auto | Given comp.base_floor_usd 150000 and stretch_target_usd 185000, when the card renders, then a two-handle "Base pay" slider ($100K to $400K, $5K steps) shows $150K and $185K, with Min and Max number boxes beside it showing the same values. |
| SET-3 | auto | Given the pay slider, when a handle moves (drag, arrow keys ±$5K, Page Up/Down ±$25K, Home/End) or a number box changes, then the other control matches, handles never cross (low stays at least $5K under high), typed values clamp to the range on blur, and each handle is role="slider" with aria-valuetext like "$150K". |
| SET-4 | auto | Given the "Priority-sector floor" single slider, when it is set above the base floor, then it clamps to the base floor; when the base floor drops below it, both lines change in the draft. |
| SET-5 | auto | Given level chips mid, senior, staff, principal, lead (aria-pressed), when one is toggled, then role.levels is rewritten as a flow list in the order shown; toggling off the last one is refused with "Keep at least one level." |
| SET-6 | auto | Given each sector in sectors:, when its Off / Allowed / Good / Priority control (radiogroup, values 0-3) changes, then only that sector's weight line changes. |
| SET-7 | auto | Given Home state (select of US state codes), Min score to add (slider 0-100, step 5) and Digest size (slider 1-20), when each changes, then work.home_state, scoring.min_score_to_add and scoring.digest_max_items change in the draft. |
| SET-8 | auto | Given applyToYaml with op "set" and an array value, when the target line is a flow list, then it writes `[a, b, c]` and keeps the trailing comment; every other line of the file is byte-identical (unit test in skip-feedback.test.ts). |
| SET-9 | auto | Given a setting whose key is missing from the YAML (applyToYaml returns null), when the card renders, then that control is disabled with "Not in your criteria yet. Add it under Advanced.", and the draft is untouched. |
| SET-10 | auto | Given the text box is edited, when the text parses, then the card's controls show the new values; when it doesn't parse, then every control is disabled with "Fix the text below first." |
| SET-11 | auto | Given any control change, then critDraft holds the edit, the digest preview updates, and a sticky "Unsaved changes · Save · Discard" bar appears; no database write happens until Save (fake db write count 0). Save uses the existing save and validation path; Discard restores the saved values and hides the bar. |
| SET-12 | manual | Given a 390x844 phone, when Chase drags both pay handles with a thumb and toggles a sector, then every target is at least 44px, nothing scrolls sideways, and VoiceOver reads each control's name and value (ux-reviewer). |

## RR-FA: Workplace and pay filters, sorts

| ID | Type | Given / When / Then |
|---|---|---|
| FA-1 | auto | Given pure `workplaceOf(job)`, then: "Remote, US", "Remote (United States)", "US - Remote", "Remote" -> remote_us; "San Francisco, CA (Remote)", "Remote - New York", "Remote, within 50 miles of Chicago" -> remote_metro with city; "Remote, Canada", "Remote (EMEA)", "UK Remote" -> remote_non_us; "Denver, CO (Hybrid)", "Hybrid remote, Austin" -> hybrid; "On-site, Austin, TX", "In office" -> onsite; "Remote (site-to-site travel)" is not onsite; "", missing, or a bare city -> unknown. Hybrid and on-site words beat "remote". |
| FA-2 | auto | Given job.workplace is one of remote_us, remote_metro, remote_non_us, hybrid, onsite (the ids the scan writes from 2026-11-01), then it wins over the location text, and job.workplaceCity names the city for remote_metro; any other value is ignored. |
| FA-3 | auto | Given a role card, then it shows one work label: "Remote (US)", "Remote near San Francisco", "Remote outside US", "Hybrid", "On-site"; unknown shows none. |
| FA-4 | auto | Given the Filters sheet, when boxes in the "Work" checkbox group are ticked (Remote (US), Remote near a city, Remote outside US, Hybrid, On-site, Not stated; each with its count), then roles matching any ticked box show, the count updates, and a removable "Work: ..." chip appears. No box ticked = no filter. (Chase, 2026-11-01: "break all the categories mentioning remote into a checkbox filter group. Then we don't miss anything.") |
| FA-5 | auto | Given the quick chips, when "Remote (US)" is pressed, then the Work group is set to just Remote (US) and the checkbox shows it; pressing again clears the Work filter. The chip reads pressed only when Remote (US) is the only box ticked. |
| FA-6 | auto | Given the Filters sheet "Pay" slider (same component as SET-2), when set to $180K-$300K, then a role shows if its range overlaps it (top ≥ low and bottom ≤ high, from parseComp); roles with no pay show only while "Include roles with no pay listed" is checked (default on); the chip reads "Pay: $180K-$300K". Full range = no filter, no chip. |
| FA-7 | auto | Given the Sort sheet, when "Highest pay" is picked, then roles order by top of range, then bottom, then Best match; roles with no pay come last. |
| FA-8 | auto | Given work, pay and include-no-pay are set, when the page reloads, then they come back; bad stored values are dropped; Clear all and Reset clear them. |
| FA-9 | auto | Given 2,000 roles, when Work and Pay filters and Highest pay sort apply, then render stays inside the existing RR-H-21 budget. |
| FA-10 | manual | Given every filter, sort and chip label, when ux-reviewer reads them at 390px, then each says what it does in plain words, with no P0/P1. |

## Not in this PR
- Histogram behind the pay track: polish, not the ask; the slider and number boxes work without it.
- work.remote select, planned move, startup penalty, title include/exclude, culture flags, adding or renaming sectors: rarely changed; Advanced covers them.
- Scan-side remote detection and the live floor/sector values: other threads.
