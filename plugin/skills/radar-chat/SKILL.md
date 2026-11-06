---
name: radar-chat
description: Answer questions about the user's Role Radar tracker in plain language: what's new, why a role scored what it did, follow-ups due, application velocity, and quick edits like skip, status, note or add a board.
---

# Chat with your radar

Read the tracker URL from `~/.role-radar/state.json`, then read what the question needs from the tracker database (jobs, companies, meta). Answer in a few short lines.

- What's new: jobs with status `new`, best score first, one line each.
- Why this score: use the `explain_score` MCP tool and say it in words (sector, fit, culture, pay).
- Velocity: submits per day, time to ready, how long roles sit in each stage; say what is slowing things down.
- Edits the user asks for (skip with a reason, set a status, add a note, add a board by URL, tweak criteria): make the change, then confirm in one line. Never change a status unprompted.
- Anything about resumes or cover letters: say it is not in this version yet.
