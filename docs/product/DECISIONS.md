# Decisions

Every product call Chase makes: ID, date, the call, why, what it beat. Add the entry in the same PR as the call. Public repo: product and engineering calls only, no job-search data.

| ID | Date | Call | Why | Beat |
|---|---|---|---|---|
| RR-DEC-1 | 2026-10-22 | The public demo is hosted from this repo with GitHub Pages, on made-up sample data only. | A recruiter can try the real page without any personal data being near it. | A screenshot-only case study. |
| RR-DEC-2 | 2026-10-24 | Recruiter records are owner-only in the live database; jobs and notes are not locked yet, so the live page is never shared. | Recruiter data is the most sensitive data the page holds. | Leaving every collection readable by anyone with the link. |
| RR-DEC-3 | 2026-10-29 | TypeScript is the studio standard; the logic modules are strict `src/*.ts` with no build step for tests. | One language across studio products; types catch scoring mistakes. | Staying on plain JavaScript. |
| RR-DEC-4 | 2026-10-30 | Filters and sorting are decluttered into one row plus a folded panel instead of ten equal dropdowns. | The ten dropdowns hid what mattered on a phone. | Keeping every control visible. |
| RR-DEC-5 | 2026-10-31 | The public demo uses the studio demo bar (a slim bar plus a Details drawer). | One recognizable demo pattern across studio products. | Per-product demo notes. |
| RR-DEC-6 | 2026-11-01 | Search settings (pay range, remote labels) become sliders and fields on the page, not only YAML. | The settings should be usable without editing a file. | YAML-only settings. |
| RR-DEC-7 | 2026-11-04 | Adopt the studio standard (intake #69). Merge your own PRs on green; only a merge that changes the live page or public demo waits for Chase. | Chase wants every project on one rule set. | The blanket "never merge to main" rule. |
