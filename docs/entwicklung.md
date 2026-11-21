# Developer guide: how the group works on the tool

For all three builders and Niko. Goal: every change is visible to everyone after 1 to 2 minutes, and nothing unchecked lands on the live system.

## The environments

| Environment | Address | What runs there | Who changes it |
|---|---|---|---|
| **local** | `http://127.0.0.1:5070` | your own computer, your own data | you |
| **PREVIEW** (`vorschau`) | `https://vorschau.<domain>` | branch `vorschau`, **without eBay keys** (cannot change anything on eBay) | anyone by pushing to `vorschau` |
| **PROD** (live) | `https://app.<domain>` | branch `main`, with eBay keys and approval | only by a pull request that somebody else reviews |

At the top of the app there is a badge: **PREVIEW** or **LIVE**. Anyone who mixes up the preview with the live system sees it at once.

## One-time setup (local)

```bash
git clone https://github.com/nik1231-alt/Parture-Groupwork.git
cd Parture-Groupwork
npm install
cp .env.beispiel .env              # Windows: copy .env.beispiel .env  (enter nothing, no eBay keys)
npm run benutzer -- anlegen <your-name> admin     # locally you may be admin, it is only your computer
npm start                          # http://127.0.0.1:5070
```

Without `daten/pm.db` the app uses the team copy `daten-team/pm.db` (catalogue, sales, traffic sums). You need **no** credentials. `npm run dev` starts with reload on changes.

`npm test` must be green before you share anything (it takes about 30 seconds). `npm run scan` checks that no secret is in the repository.

## The way a change goes

```
1. git switch -c topic/short-name            own branch (from main)
2. change, try it locally, npm test
3. git push origin topic/short-name:vorschau show it: live on the PREVIEW after 1 to 2 minutes
   (or merge into vorschau directly, see below)
4. open a pull request against main          description: what, why, how tested
5. another person reviews and merges         never merge your own change yourself
6. PROD takes main after 10 minutes at most, but only if the tests pass there
```

Rules:
- **Never push directly to `main`.** (GitHub enforces this only with branch protection; until then it is an agreement.)
- **`vorschau` is a playground.** It is overwritten hard when needed (force push). Two people pushing there at the same time overwrite each other: agree briefly ("I have the preview right now"). Whatever should stay belongs in a pull request to `main`.
- One change per pull request, with a test if it changes logic (tests are in `app/test*.mjs`, `node:test`).
- No `.env`, no `.db` (except `daten-team/pm.db`), no `node_modules`, no passwords, tokens or eBay data in commits, issues, pull requests or chats.
- Describe schema wishes for `pm.db` as an issue: the export is then adapted. Writing into `pm.db` directly is pointless, it is overwritten.

## What happens automatically on every pull request

GitHub Actions (`.github/workflows/pruefung.yml`) runs: `npm ci`, the **secret scan** (files and the whole history) and **all tests**. A red mark means: do not merge.

On PROD a new `main` version is also rolled out only after the tests pass. If they fail there, the old version stays live, and the log (`daten/waechter.log`) names the reason.

## Rehearsal: a test PR all the way to PROD

Play it through together once after the setup:
1. Branch `test/probe`, a harmless visible change (e.g. a word in the text of the *Settings* page).
2. `git push origin test/probe:vorschau` → visible after 1 to 2 minutes at `https://vorschau.<domain>`.
3. Pull request against `main`, the CI turns green, another person merges.
4. After 10 minutes at most the change is on `https://app.<domain>`. In the tab **Log → System** the new version appears.
5. Revert the change again (second pull request).

## How the app is built

```
app/server.mjs        HTTP server (no framework), routes, login, roles, schedulers (traffic import, backup)
app/login.mjs         users, sessions, lock after failed attempts, change password
app/rollen.mjs        admin / builder
app/freigabe.mjs      proposals, approval, rejecting, reverting (limit 50 per approval)
app/ebay-schreiben.mjs  read and change titles on eBay (only with keys and EBAY_SCHREIBEN=an)
app/protokoll.mjs     log, append-only (database triggers forbid changing and deleting)
app/experimente.mjs   tests: draw, title, start, verdict
app/titelhilfe.mjs    word hints from the own data (invents no titles)
app/demo.mjs          three example verdicts with invented figures
app/traffic.mjs, export-ebay.mjs   traffic import and data build from the eBay API
app/sicherung.mjs     daily backup, restore
app/benachrichtigung.mjs  Telegram message to the admin
app/waechter.mjs      auto-deploy with a test gate, app monitoring (server only)
public/               interface (plain JavaScript, texts only via textContent)
scripts/geheimnis-scan.mjs   secret scan
server/               templates for the server (.env, Cloudflare, Windows task)
docs/                 these documents
```

Many file and function names are German (`freigabe` = approval, `leiter` = ladder/funnel, `sicherung` = backup, `waechter` = watcher).
The README has a short table with the meanings.

### Fixed numbers: each exactly once

Server, tests and interface read the same constant; the interface gets it through the API (`/api/betrieb` → `regeln`, plus `/api/experimente`, `/api/freigaben`, `/api/traffic/status`), never as its own copy.

| Number | Constant | File |
|---|---|---|
| title at most 80 characters | `TITEL_MAX_ZEICHEN` | `app/regeln.mjs` |
| at most 50 changes per approval | `MAX_AENDERUNGEN` | `app/freigabe.mjs` |
| target mark +20 % (adjustable) | `EINSTELLUNGEN.besserAb` | `app/regeln.mjs` |
| lock after 5 failed attempts for 15 minutes | `MAX_FEHLVERSUCHE`, `SPERRE_MINUTEN` | `app/login.mjs` |
| data delay 3 days / last 3 days re-checked | `VERZOEGERUNG_STANDARD` (effective: `verzoegerungTage()`), `NACHPRUEFEN_TAGE` | `app/traffic.mjs` |

### The draw and the block list

The draw (`experimente.ziehe`) is reproducible: the random value (`seed`) is stored in `experiment.seed` and in the log (`test_created`). The groups are equally large (with an odd number at most 1 difference), no listing appears twice. Listings from the table `sperre` in `pm.db` (from the hub: a running price experiment; blocked by `number` or by the eBay item number `external_id`, up to and including `bis`) are never drawn. If the table is missing, nothing is blocked. Tests: `app/test-los.mjs`.

### Check scripts

- `npm test`: all tests (about 35 seconds). Among them `app/test-durchlauf.mjs`, the whole path against the real server (builder draws and proposes, admin approves as a dry run, log, test view), and `app/test-oberflaeche.mjs` (no German left in visible texts).
- `npm run tote`: exported functions in `app/` that no other file mentions. The output must be empty; intended exceptions are justified in the exception list in the script.
- Child processes in tests (server): end them and wait for `exit` first, then delete files: on Windows the running process keeps `app.db` open (EBUSY).

Conventions: modules return `{ ok, wert }` or `{ ok: false, status, fehler }` (`wert` = value, `fehler` = error). Text from data (e.g. eBay titles) is never inserted as HTML. All visible texts of the interface, all messages and all comments are English. Input is checked in the module (type, length, state), not only in the interface.

## What builders cannot do (and should not)

- Write to eBay: the keys exist only with Niko on PROD.
- Approve or change roles: admin only (the server checks this, not only the interface).
- Put unchecked code on PROD: for that it must go through `main`, review and tests.

## Three rules from running the server (17/18 Nov 2026)

- **Always wait for child processes in tests to finish, and only then clean up.** `kill()` does not end a process at once; on Windows it still holds files such as `app.db` open and `rmSync` fails with `EBUSY`. Pattern:
  ```js
  if (server && server.exitCode === null) { const weg = new Promise((r) => server.once("exit", r)); server.kill(); await weg; }
  fs.rmSync(verz, { recursive: true, force: true });
  ```
  If a process starts children itself (the watcher starts the app), `kill()` on the parent does **not** end the child on Windows: remember the child's PID and end it yourself (`app/test-waechter.mjs`).
- **Before `npm ci` the watcher stops the app** (hook `vorInstallation`, since PR #9). Windows locks the loaded `better_sqlite3.node`; an `npm ci` while the app runs fails with `EPERM` and leaves an almost empty `node_modules`. Whoever changes `package.json` triggers this path.
- **The watcher loads its own code only at start.** A change to `app/waechter.mjs` takes effect only when the task is restarted: stop the task, end the old `node …\app\server.mjs` by PID (it survives `Stop-ScheduledTask` and holds the port), start the task. Niko or the server AI does this, not the watcher itself.

The CI currently runs on Ubuntu only. A Windows matrix is prepared, because the two errors above occurred only on Windows; pushing the workflow change needs a token with the `workflow` scope (issue #18). `npm test` takes about 35 seconds locally; over 60 seconds counts as an error that gets fixed.
