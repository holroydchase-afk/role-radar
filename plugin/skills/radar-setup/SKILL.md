---
name: radar-setup
description: Guided onboarding for Role Radar. Interviews the user about their search, writes their criteria.yaml, publishes their private tracker page, loads starter job boards, runs the first scan and schedules the weekday scan.
---

# Role Radar setup

Goal: one sitting, about 10 minutes, and the user ends with a private tracker page, a first scan and a scheduled weekday scan. Ask short questions, one topic at a time, and offer a sensible default for each so the user can just say "ok". Never ask for anything you can infer.

## 1. Interview (ask, then write the answers down)
1. Target: job titles and level (for example "Senior or Staff Product Manager, individual contributor").
2. Pay: hard floor in USD base (skip roles that top out below it), and a target. Pay is optional on many postings; say that unknown pay is kept.
3. Where: fully remote? Home state (a posting whose state list leaves it out is skipped), and any city where hybrid is fine.
4. Sectors they want, each weighted 0-3 (3 = dream, priority pay floor). Offer examples, then take their words.
5. Never-show list: companies and business models to exclude.
6. Culture: signals they like, phrases that are red flags, and which red flags mean "never show" versus "just score lower".
7. Background in 3-5 sentences (used for fit: strong / maybe / stretch). Offer to read a resume they paste, never required.
8. A few dream roles or companies (they get a bonus).
9. Optional: whether the scan may read Gmail (read-only) to update application statuses. Default no.

## 2. Write criteria
Use the structure of the example criteria shipped at `${CLAUDE_PLUGIN_ROOT}/example-criteria.yaml` (the `role`, `work`, `comp`, `sectors`, `hard_exclude`, `culture`, `values_penalty`, `scoring`, `search` sections; version 2). Write the result to `~/.role-radar/criteria.yaml` (create the folder). Read it back to the user in plain language (not YAML) and fix anything they correct. Validate by calling the `get_criteria` and `explain_score` MCP tools on one made-up job.

## 3. Publish the tracker
Publish the page with the Artifact tool. The page is the single file `${CLAUDE_PLUGIN_ROOT}/page/role-radar.html` plus its seven sibling scripts (`files` map) and `capabilities.json` as the capabilities, unchanged. Keep it private: never make it public. Load the artifact-capabilities and artifact-design skills first if the tool asks. Save the artifact URL to `~/.role-radar/state.json` (this file is the user's, never committed anywhere).
Then write the user's criteria into the page database doc `meta/criteria` as `{spec: <the YAML text>, updatedAt}`, and `meta/config` with defaults (lanes, followUpBusinessDays 5, staleAppliedDays 14, staleSavedDays 7).

## 4. Starter boards
From the user's sectors, find 20-40 real company career boards (Greenhouse, Ashby, Lever first) with WebSearch and verify each by fetching its public board feed. Write each verified one as `companies/<ats>-<slug>` with `status: active`, the rest `unverified`. Be honest about how many you verified. More can be added any time by pasting a careers URL into chat.

## 5. First scan, schedule, done
Run the `radar-scan` skill once. Then create a weekday scheduled task (CronCreate, around 7:45 local time) that runs `/scan`. Finish with: the page link, the top 3 roles found, what is scheduled and when, and the three things to try (`/radar what's new`, `/radar why did X score so low`, adding a board).

## Rules
- Everything personal stays in the user's own Claude account and `~/.role-radar/`. Never write it into any repo.
- If a step cannot be done in this environment (no Artifact tool, no scheduling), say so in one line, give the user the one manual step, and keep going with the rest.
