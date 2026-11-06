# Role Radar for Claude (plugin)

A private job-search radar that runs in your own Claude account. Nothing is hosted for you and nobody else sees your data.

## Install (Claude Code)
```
/plugin marketplace add <owner>/role-radar
/plugin install role-radar@role-radar
/radar-setup
```
`/radar-setup` asks what you want (titles, pay floor, sectors, red flags), publishes your private tracker page, finds starter job boards, runs a first scan and schedules the weekday scan.

## Everyday use
- `/scan` runs a scan now.
- `/radar <question>`: what's new, why a role scored what it did, what needs follow-up, how your velocity is trending.

## Privacy
Your criteria live in `~/.role-radar/`. Your tracker is a private Claude artifact with its own database in your account. The plugin ships no personal data.

## Maintainers
`npm run build:plugin` rebuilds `plugin/page/` and `plugin/mcp/server.mjs` from the app sources; commit the result.
