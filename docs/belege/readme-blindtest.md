# README followed blind on a fresh copy (issue #20)

The course guide asks to "follow the commands on a fresh copy of the repository and confirm that they work", because the
staff review the repository without the team. Done on 20.11.2026 on Windows 11, Node.js 22.22, in an empty folder, with the
commands exactly as written in `README.md` (`main` at 58684f0).

| Step (README) | Result |
|---|---|
| `git clone …` and `cd Parture-Groupwork` | ok, 2 s |
| `npm ci` | ok, 38 packages, 2 s (better-sqlite3 ships a prebuilt binary for Windows and Node 22) |
| `cp .env.beispiel .env` | ok |
| `npm run benutzer -- anlegen pruefer` | ok, "Benutzer angelegt: pruefer (Rolle: admin)" |
| `npm start` | server starts, sign-in works, **but every page said "The product data (pm.db) is not available yet"** |
| `npm test` | 193 of 193 green, 38 s |

## What went wrong and what we changed

`.env.beispiel` contained `PM_DB=daten/pm.db`. After copying it, that value wins over the built-in order (own export, then
the team copy `daten-team/pm.db`), and a fresh clone has no `daten/pm.db`. Anyone following the README saw an empty app.

Fix: `PM_DB=` is empty in `.env.beispiel`, with a comment why. A new test in `app/test.mjs` reads the template and fails if
`PM_DB` has a value, if any key or token is filled in, or if a write switch is on. After the fix the same fresh clone
started with the team copy (991 products) and the Funnel page loaded.

Note for running it on the team server itself: port 5070 is taken by PROD there, so start with `PM_PORT=5078 npm start`.
