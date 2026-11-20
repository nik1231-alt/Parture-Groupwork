# Rules for coding agents in this repository

These rules hold for every coding agent (Claude, Codex, Copilot …) and every person. Change them only through a pull request.

## Secrets

- Secrets are never written into code, tests, docs or commit messages. Code reads them by name from the environment
  (`process.env.EBAY_APP_ID`, `process.env.GOOGLE_API_KEY`).
- `.env` is never committed (it is in `.gitignore`). Only `.env.beispiel` with empty placeholders is in the repository.
- Run `npm run scan` before every commit, and `npm run scan -- --historie` before the repository is made public.
- If a secret ever lands in a commit: revoke it at the provider first, then remove it. Deleting the file later does not
  remove it from the history.

## Data

- No costs, fees, margins, revenue, customer data or addresses, ever. The catalogue `pm.db` comes from a whitelist.
- `daten/` (with `app.db` and backups) is never committed. Tests build their own throwaway databases.

## eBay

- Nothing may write to eBay without an admin's approval, a fresh read of the listing and the switch in `.env`
  (`EBAY_SCHREIBEN`, plus `EBAY_WERBUNG` / `EBAY_PREIS` for ads and prices).
- Never switch these on in code or tests. Tests use a fake writer.

## Code

- Plain Node.js (ESM) and plain browser JavaScript; the only dependency is `better-sqlite3`, pinned to an exact version.
  Adding a dependency needs a reason in the pull request.
- Data from outside (titles, user input, eBay answers) is inserted into the page as text only (`textContent`), never as HTML.
- All text in this repository is English: the interface (`app/test-oberflaeche.mjs` checks it), messages, documentation, comments and test names. Many file, function and variable names are German; keep them (renaming is risky), but write new names in English and see the README section "German names" for the meanings.
- Every new rule gets a test next to it, including the rejected case (wrong role → 403, invalid input → 400, wrong state → 409).
- `npm test` must be green before a pull request is merged into `main`. The watcher deploys `main` to PROD only after green tests.
