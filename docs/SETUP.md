# Run your own copy

Role Radar has three parts: a tracker page, your criteria, and a scan that runs every weekday morning. In production the page is a private Claude artifact with a small database, and the scan is a scheduled Claude task. You need a Claude plan that includes artifacts with a database and scheduled tasks.

## 1. Try the demo first

```sh
npm install
npm run build:demo   # writes dist/demo.html
npm run typecheck    # strict TypeScript over src/ and tests/
npm test
```

Open `dist/demo.html` in a browser. It runs the real page on fictional data, with nothing saved anywhere.

## 2. Write your criteria

Copy [`criteria.yaml`](../criteria.yaml) and make it yours:

- `role` and `work`: the title and location gates a role must pass before it is scored.
- `comp`: your floors and your stretch target, in US dollars.
- `sectors`: what you want, each with a `weight` from 0 to 3. Weight 3 sectors get the priority comp floor.
- `hard_exclude`: companies and business models you never want to see.
- `culture` and `values_penalty`: signals that add or remove points. They lower a score, they never hide a role.
- `scoring`: the minimum score to add a role, how many roles a digest shows, and the cap per sector.
- `search`: the queries and boards the scan checks.

You can edit this later on the page's Criteria tab, which previews tomorrow's digest as you type.

## 3. Publish the tracker

1. Run `npm run build`. It bundles each [`src/*.ts`](../src) module into the classic script the page loads, in `build/`: `scoring.js`, `gmail-import.js`, `posting.js`, `alerts.js`, `progress.js`, `recruiter-store.js` and `skip-feedback.js`. `build/` is gitignored, so build again before every publish. Then ask Claude to publish [`app/role-radar.html`](../app/role-radar.html) as a private artifact with those seven `build/*.js` files as supporting files of the same names. Pass [`app/capabilities.json`](../app/capabilities.json) as its capabilities, as-is: the database with an owner-only rule on `recruiters`, plus the Gmail connector with only the read-only tools `search_threads` and `batch_get_threads`. Pass the same file on every republish; publishing with a bare `db: {}` resets the rule.
2. Open the page. Every tab starts empty.
3. On the Criteria tab, paste your `criteria.yaml` and save.
4. On the Recruiters tab, open *Import from Gmail* and choose *Find recruiters in Gmail*. Claude asks once whether the page may use your Gmail connector (add the connector in claude.ai Settings first if you haven't). Untick anyone who isn't a recruiter, then add the rest. To change what it searches for, set `gmailQuery` in the tracker's `meta/config` to any Gmail search.

Keep the page private. Recruiters are owner-only: the database rule means nobody else the page is shared with can read or change them, and the page hides the tab for them (details: [`docs/private-recruiters.md`](private-recruiters.md)). Jobs, application notes, status emails and `meta/config` are not locked: anyone you share the page with can read them. To show Role Radar to someone, share the public demo, not your page.

## 4. Set up the scan

1. Copy [`demo/profile.json`](../demo/profile.json) to `profile.local.json` (it is gitignored) and fill in your name, target role, priorities, background and your tracker's link.
2. Render the prompt:

   ```sh
   node scripts/render-scan-prompt.mjs > scan-prompt.local.txt   # gitignored
   ```

3. In Claude, create a scheduled task for weekday mornings with that prompt. Give it the tracker page and, if you want status updates from email, read-only Gmail access.

The scan reads your criteria from the tracker on every run, so changing criteria never needs a new prompt.

## 5. Keep your data out of git

If you fork this repo, your criteria, profile and tracker data are personal. Run `npm run hooks` once so the pre-commit check blocks email addresses, phone numbers and private links. To also block specific names, list them one per line in a file outside the repo and point `PRIVATE_DENYLIST` at it:

```sh
PRIVATE_DENYLIST=~/role-radar-denylist.txt npm run check:private
```
