# Checklist: the tool up to the hand-in and the demo

Status 18 Nov 2026, measured on the repo (main = b4435b1, vorschau = 4213d27) and on the server. This is a working document: the status
columns are from 18/19 Nov and later work is tracked in the issues and pull requests. Every item has a
responsible person, a **proof** (how you can see that it is done) and a date. Whoever completes an item
ticks it here and names the number in the pull request (e.g. "A3.4"). The assignment to people is a suggestion:
distribute it in the group, but every item needs exactly one name.

| Date | What |
|---|---|
| **22 Nov 2026** | Hand-in: the code is done. Afterwards only bug fixes, docs, rehearsal. No new features. |
| 23 Nov to 3 Dec | eBay live path, real test run with data, dress rehearsal. |
| **4 Dec 2026** | Demo (about 8 minutes, run in `docs/vorfuehrung.md`). |

The course grades: **code quality and tests, Git collaboration, function and interface, presentation and docs,
security.** Sections A1 to A6 follow exactly these five criteria plus the data path.

## Worked off on 19 Nov 2026 (server AI, on behalf of Niko)

Everything is ready as pull requests and together on PREVIEW (version `df0ccd8`, 172 tests green). **Nothing is merged into `main`
yet**: the group does that after review (A5.2). Order of merging: #10 → #11 → #29 → #30, then #12, #13, #14.

| Item | Status | Proof |
|---|---|---|
| A1.3, B1.4 Draw reproducible, equally large, nothing twice, block list, only running eBay listings | done | #30, `app/test-los.mjs`; the hub delivers `sperre` (50 listings until 1 Dec) |
| A1.4, A1.6, A1.7 Title rules, dry run, log | done | #30 `test-durchlauf.mjs`, existing tests in `test-freigabe.mjs` |
| A1.8 Evaluation panel to `main` | PR open | #11 (code by EmbletonNova) |
| A1.10 Error cases | done (session expired in the interface without an automatic test) | #30 `test-fehlerbilder-http.mjs` |
| A1.11 English only | done | #30 `test-oberflaeche.mjs` |
| A1.12 Phone width | done, measured 400/360 px | #30 |
| A1.1, A1.2, A1.5, A1.9, A6.6 Screenshots | open (group) | issue #19 |
| A2.1 Data access | done | #14 `docs/architektur.md` |
| A2.2, A4.8 Constants | done | #30, `/api/betrieb.regeln` |
| A2.3 Team copy | done | #13 |
| A2.4 Message on an old data version | open (not a must, Telegram on PROD is missing, B2.6) | — |
| A3.1–A3.13, A6.3 Security | done | #29 `docs/sicherheit.md`, `test-routen-schutz.mjs`, `test-xss.mjs` |
| A4.1 Module → test | done | #14 `docs/tests.md` |
| A4.2 End-to-end test | done | #30 |
| A4.3 Run time, wait for child processes | done (about 37 s) | #12 |
| A4.4, A4.6 Convention, dead code | done | #30, `npm run tote` |
| A4.5 CI on Windows | ready, not pushed (token without the `workflow` scope) | issue #18 |
| A4.7 Comments | open (review) | issue #21 |
| A5.1, A5.2, A5.3 Distribution, reviews, branch protection | open (group, Niko) | issues #15, #16, #17 |
| A5.4 Issues | done | #15–#28 |
| A5.5 PR template, A5.7 `.mailmap`, A5.8 AI share | done, A5.8 to be checked by the group | #14 |
| A5.6 Delete old branches | open: only after the merge | — |
| A6.1, A6.2, A6.4, A6.5 README, architecture, development, glossary | done; A6.1 blind rehearsal open | #14, #12, issue #20 |
| B1.1 Lion's approval | done: Lion by Telegram on 19 Nov "Yes 1123" | message centre #1123 |
| B1.5, B1.9 Shopify note, revert plan | done (template) | #14 `docs/belege/revert-plan.md` |
| B1.10 No own Analytics calls | checked: `EBAY_TRAFFIC_AUTO` on PROD is empty | — |
| B2.2, B2.3 Backup, watcher logs | checked 19 Nov: backup of 18 Nov in both places, logs without errors since the fix of 18 Nov | repeat before the demo |
| B1.2, B1.3, B1.6–B1.8, B2.1, B2.4–B2.6, B3, C | open (people) | issues #22–#28 |

Found on the side and fixed in the hub: `pm.db` carried the time of the nightly rebuild as `created_at`, so
on PROD every listing was on "Wait" and no test found candidates. Since 19 Nov the real creation date is there.

## Current state (measured 18 Nov 2026, not estimated)

| Measurement | Value | Meaning for the checklist |
|---|---|---|
| Tests | **120** in 11 files (`node:test`), `npm test` green on Ubuntu (CI) and Windows (server) | The base is good. Gaps: evaluation (only on `vorschau`), end-to-end run, Windows in the CI. |
| API routes | 32 under `/api/*` plus `/healthz` | Every route needs a test for "401 without login" and "builder on an admin route 403" (A3.2). |
| Pages | Listings, Tests, Approvals, Team (admin only), Log, Settings; login | The evaluation panel (defd8b5) is only on `vorschau`, not yet in `main` (A1.8). |
| Code | about 4,300 lines in `app/` and `public/`, **one** dependency (better-sqlite3), no framework | A strength for the presentation: be able to explain why (A6.3). |
| Security | scrypt passwords, lock after failed attempts, cookies HttpOnly + SameSite=Strict + Secure, origin check, CSP, X-Frame-Options, roles on the server, Access JWT check, append-only log (DB trigger), secret scan in the CI, write switch `EBAY_SCHREIBEN` | Present, but described nowhere as a whole and not every measure has a test (A3). |
| Git | 9 merged pull requests, **0 reviews**, 0 issues, commits: nik1231-alt 10, Niko 5, EmbletonNova 4, server AI 4, **Alexius76 0, giacomogrilli 0** | The most critical finding for "collaboration" (A5). |
| CI | `.github/workflows/pruefung.yml`: npm ci, secret scan with history, tests, Ubuntu only | Two Windows-specific errors (EPERM/EBUSY) were found only on the server (A4.5). |
| Operation | PROD `app.parture-team.com` (main) and PREVIEW `vorschau.parture-team.com` (vorschau) behind Cloudflare Access, watcher with a test gate, daily backup, restore rehearsed | Done. Open: eBay keys on PROD and Lion's approval (B1). |
| Data | `pm.db` every night 04:30 from the hub: 984 products, 2,155 channels, 6,357 images, traffic 120 days (98 days present, coverage 98.6 %) | Done. The team copy `daten-team/pm.db` is older and without traffic tables (A2.3). |

---

## A. Until the hand-in on 22 Nov: the code is done

### A1. Function: the one run must work (criterion "function and interface")

The core of the tool is a single path: find a listing with low impressions → draw a test → propose a title →
approve → change on eBay → log → evaluate. Every step is played through once **with real data on
PREVIEW** and the result is stored as a screenshot in `docs/belege/`.

| # | Item | Who | Proof | By |
|---|---|---|---|---|
| A1.1 | Listings: the filter "Low impressions" shows the right listings (spot check against `pm.db`: recalculate 5 listings by SQL) | Builder 1 | Screenshot + the 5 SQL lines in `docs/belege/a1-1.md` | 20 Nov |
| A1.2 | Header: environment (PREVIEW/LIVE), data age, "traffic up to" agree with `stand` in `pm.db` | Builder 1 | Screenshot | 20 Nov |
| A1.3 | Tests → "Draw a new test": the draw is reproducible (seed in the log), groups equally large, no listing twice, listings of the price-decrease list are excluded (list comes from the hub, see B1.4) | Builder 2 | Test in `app/test-freigabe.mjs` or an `app/experimente` test that checks exactly these four properties | 21 Nov |
| A1.4 | Enter titles as builder: length rule 80 characters, the title help shows only evidence-based hints, "Send for approval" locks the proposal against further changes | Builder 2 | Does a test exist? If not: add one. Screenshot | 21 Nov |
| A1.5 | Approvals as admin: old and new side by side, Approve/Reject, limit of 50 per approval, a builder gets 403 (already tested: `test-rollen-http.mjs`) | Niko | Existing test named, screenshot | 20 Nov |
| A1.6 | eBay writing as a dry run (`EBAY_SCHREIBEN` off): the app shows what it would change, changes nothing, the log gets the entry "dry run" | Niko | Log line as a screenshot | 20 Nov |
| A1.7 | Log: every step from A1.3 to A1.6 is in it with time, person, old/new; an attempt to change or delete a row fails at the trigger (test exists: name it) | Builder 3 | Test name + screenshot | 20 Nov |
| A1.8 | **Evaluation panel (defd8b5) by pull request into `main`**, with `app/test-auswertung.mjs`; review by another person | Niko (PR), Builder 3 (review) | PR number, CI green, merge | **19 Nov** |
| A1.9 | "Show an example verdict": the example figures are clearly labelled as an example (text "example data" visible), the three charts render even with empty data without an error in the console | Builder 3 | Screenshot, console empty | 21 Nov |
| A1.10 | Error cases: `pm.db` missing → 503 with an understandable text; eBay refuses → eBay's message visible, nothing changed; session expired → back to the login without losing the form data | Builder 1 | 3 screenshots | 21 Nov |
| A1.11 | Interface in English, consistent terms (listing, test, approval, log, settings), no German left in visible texts (`grep` over `public/`) | Builder 1 | `grep` result empty | 21 Nov |
| A1.12 | Phone width (400 px): no horizontal scroll bar on Listings/Approvals/Log | Builder 2 | Screenshot | 21 Nov |

### A2. Data path: where the figures come from and how fresh they are

| # | Item | Who | Proof | By |
|---|---|---|---|---|
| A2.1 | The app reads **only** `pm.db` (the hub's whitelist: product, channel, image, traffic). No code accesses other files or APIs, except `export-ebay.mjs` (admin, local) and `ebay-schreiben.mjs` (PROD) | Server AI | `grep` for `fetch(`/`Database(` in `app/` with a list of the places | 19 Nov |
| A2.2 | The data delay of 3 days and "last days re-checked" are the same number in the code and in the header (one constant) | Builder 2 | Constant named | 20 Nov |
| A2.3 | Renew the **team copy** `daten-team/pm.db` from the current server `pm.db` (with traffic tables), so that locally and in the fallback plan the same interface appears as live. It contains no costs, no customers (whitelist). | Niko | Commit, file size, `stand` row | 20 Nov |
| A2.4 | What happens if the hub does not deliver at night: the app shows the old version with its date, the admin gets a Telegram message when the version is older than 2 days (check whether it exists; otherwise an issue, not a must until 22 Nov) | Server AI | Test run with a shifted date | 25 Nov |

### A3. Security (its own grading criterion)

What exists must be **described as a whole and proven with a test for each item**. A page `docs/sicherheit.md`
with exactly this table, every row pointing to the test.

| # | Item | Who | Proof | By |
|---|---|---|---|---|
| A3.1 | `docs/sicherheit.md`: threat model in ten rows (who might want what: stranger on the net, builder without admin rights, lost laptop, leaked commit) and the measure in each case | Builder 3 | File in the PR | 21 Nov |
| A3.2 | **Every** one of the 32 routes: 401 without login, builder on an admin route 403. One test that reads the route list from `server.mjs` and tries all of them, instead of a handful of chosen ones | Builder 3 | The test counts 32 routes; fails if a new route is unprotected | 21 Nov |
| A3.3 | Login: scrypt with salt, lock after N failed attempts (name N), minimum length 10, a password change ends other sessions, logout deletes the session on the server | Niko | Tests in `test.mjs`/`test-http.mjs` named | 20 Nov |
| A3.4 | Cookies: HttpOnly, SameSite=Strict, Secure only over HTTPS (deliberately not locally: justify), limited session duration | Niko | Test named, justification in `docs/sicherheit.md` | 20 Nov |
| A3.5 | CSRF: origin check on POST (test exists); forms without `action` to foreign hosts | Builder 3 | Test named | 20 Nov |
| A3.6 | XSS: all data via `textContent`, no `innerHTML` with data (status: 33× `textContent`, 0× `innerHTML`); CSP header; a test that pushes a title with `<script>` through and checks that it appears as text | Builder 1 | New test | 21 Nov |
| A3.7 | Input is checked in the module (type, length, state): title 80 characters, listing number numeric, approval states as a state machine (open → approved/rejected → written), illegal transitions 409 | Builder 2 | Tests in `test-freigabe.mjs` named or added | 21 Nov |
| A3.8 | Secrets: `.env` and `*.db` in `.gitignore`, `npm run scan` clean (status: 55 files), the CI checks the whole history; no tokens in the log or in logs (`grep` for `EBAY_`, `TOKEN` in `daten/*.log` after a run) | Niko | Scan output, `grep` empty | 20 Nov |
| A3.9 | Roles on the server: a builder cannot approve, change roles, back up, set the eBay switch (test exists: `test-rollen-http.mjs`); the interface only hides, the server decides | Niko | Test named | 20 Nov |
| A3.10 | Access from outside: Cloudflare Access in front of both environments, the app also checks the Access JWT (aud, expiry, signature); ports 127.0.0.1 only (server probe on 17 Nov passed) | Server AI | Probe record in `docs/server-checkliste.md` | done |
| A3.11 | eBay write path: only with keys **and** `EBAY_SCHREIBEN=an`, read-before-write (title differs → nothing), limit 50, everything in the log. One test per latch | Niko | Tests named | 21 Nov |
| A3.12 | `npm audit` without known gaps in the one dependency; Node version fixed (`engines` in `package.json`, `.nvmrc`) | Builder 2 | Output in the PR | 20 Nov |
| A3.13 | No customer or buyer data in the app, in `pm.db` or in the log (`export-ebay.mjs` aggregates orders only into numbers). A sentence about this in `docs/sicherheit.md` | Niko | Sentence + `grep` | 20 Nov |

### A4. Code quality and tests

| # | Item | Who | Proof | By |
|---|---|---|---|---|
| A4.1 | Every module in `app/` has a test file or is on an exception list with a reason in `docs/entwicklung.md` (today without their own test: `bewertung.mjs`, `einstellungen.mjs`, `regeln.mjs`, `protokoll.mjs`, `ebay-schreiben.mjs`, `export-ebay.mjs`) | Builder 3 | Table module → test file | 21 Nov |
| A4.2 | **One end-to-end test** over the whole path from A1 against the running server (login builder → proposal → login admin → approval → dry-run writing → log → evaluation) | Builder 2 | `app/test-durchlauf.mjs` | 21 Nov |
| A4.3 | `npm test` under 60 seconds, no flaky tests (two Windows clean-up errors were fixed on 17/18 Nov: wait for the end of the process, then delete). Rule in `docs/entwicklung.md`: always wait for child processes with `once("exit")` | Server AI | Run time in the PR, rule in the doc | 19 Nov |
| A4.4 | Convention `{ ok, wert }` / `{ ok: false, status, fehler }` everywhere; spot check 10 functions; align deviations | Builder 1 | List of the 10 | 21 Nov |
| A4.5 | CI also on **Windows** (`runs-on: [ubuntu-latest, windows-latest]` as a matrix), because the server is Windows and two errors occurred only there | Server AI | Green run on both | 19 Nov |
| A4.6 | No dead code: remove functions that nobody imports or justify them (simple script: every exported function against `grep` in the repo) | Builder 1 | Script output empty | 21 Nov |
| A4.7 | Comments say the **why**, not the what; the head of every file names its purpose in two sentences (spot check of all 20 `app/*.mjs`) | all | Ticked off in the review | 22 Nov |
| A4.8 | No numbers twice: delay of 3 days, limit 50, mark +20 %, lock after N failed attempts each exactly one named constant, used the same by tests and interface | Builder 2 | `grep` for the literals shows one place each | 21 Nov |

### A5. Git collaboration (the weakest point today)

Measured on 18 Nov: 9 merged PRs, **not a single review**, no issues, two members without a commit. Assessors see that
in a minute. By the hand-in the picture must be right, and through real work, not through cosmetic commits.

| # | Item | Who | Proof | By |
|---|---|---|---|---|
| A5.1 | **Alexius76 and giacomogrilli** each take at least two items from A1 to A4 and deliver them as their own PRs (suggestion: Builder 1 = Alexius76, Builder 2 = giacomogrilli, Builder 3 = EmbletonNova) | Niko distributes | PR list per person | 19 Nov (distribution), 22 Nov (merge) |
| A5.2 | **Every PR from now on has a review** by another person with at least one comment on the content, the author never merges themself | all | GitHub review visible | from now on |
| A5.3 | Switch on **branch protection on `main`**: Niko gets the GitHub Student Developer Pack (GitHub Pro for free), then the rule: PR mandatory, 1 review mandatory, CI mandatory, no force push. Until then the agreement from `docs/entwicklung.md` applies | Niko | Screenshot of the rule | 20 Nov |
| A5.4 | Issues as a work list: every item of this checklist that needs code becomes an issue with a number, a responsible person and a date; PRs close issues ("closes #12") | Niko creates, all use | Issue list | 19 Nov |
| A5.5 | PR template `.github/pull_request_template.md`: what, why, how tested, checklist number, screenshot for interface changes | Builder 3 | File in the repo | 19 Nov |
| A5.6 | Delete old branches once merged (`admin/*`, `emb/*`, `fix/*`, `server/*`); only `main`, `vorschau` and active work branches stay open | Niko | `git branch -r` shows ≤ 5 branches | 22 Nov |
| A5.7 | Commit messages say the why (spot check of the last 20); author names are right (one member appears twice today: `nik1231-alt` and `Niko`; unify with `.mailmap` or Git config) | Niko | `git shortlog` shows 4 people + server AI | 20 Nov |
| A5.8 | The server AI's contribution is marked as such (committer "Parture Server-KI", Co-Authored-By) and named honestly in the presentation: server operation, watcher, data export. The subject core (test logic, approval, evaluation, interface) is the group's work | Niko | Sentence in `docs/vorfuehrung.md` | 21 Nov |

### A6. Documentation (criterion "presentation and docs")

| # | Item | Who | Proof | By |
|---|---|---|---|---|
| A6.1 | `README.md` up to date: the section "Structure" names only 5 routes and the old interface today; new: purpose in three sentences, pages, roles, data path, local start, link to the docs. Everything in the README must work when followed (one person follows it blind) | Builder 1 writes, Builder 2 tries | Record of the rehearsal | 21 Nov |
| A6.2 | `docs/architektur.md` (one page): picture from `vorfuehrung.md` plus the data flow `pm.db` → app → eBay, and the table "decision → why → alternative" (no framework, SQLite, whitelist data, two environments, watcher instead of a hosting service, draw procedure instead of before/after) | Builder 3 | File | 21 Nov |
| A6.3 | `docs/sicherheit.md` (see A3.1) | Builder 3 | File | 21 Nov |
| A6.4 | Extend `docs/entwicklung.md`: watcher fix of 18 Nov (app stops before npm ci), rule "wait for child processes", note "the watcher process loads code only at start, restart the task after watcher changes" | Server AI | Commit | 19 Nov |
| A6.5 | Glossary (10 terms, English/German): Listing, Impressions, Test group / Control group, Approval, Verdict, Safety metric (sales), Data lag, Preview/Live, Watcher, Append-only log | Builder 2 | Section in the README | 21 Nov |
| A6.6 | Screenshots of the 8 demo steps in `docs/belege/` (also the fallback plan) | Builder 1 | Files | 22 Nov |

---

## B. Between the hand-in and the demo (23 Nov to 3 Dec)

### B1. eBay live: the real title change

The order is mandatory, no step is skipped. Outside the probes and the demo the switch `EBAY_SCHREIBEN` stays **off**.

| # | Item | Who | Proof | By |
|---|---|---|---|---|
| B1.1 | Lion's approval in the hub's message centre (#1123): eBay access for the app, the four test listings, title test with revert. Without this click nothing live happens | Lion | Answer to #1123 | as soon as possible |
| B1.2 | eBay developer app (Niko's account) with **only** the necessary scopes; consent on the seller account; keys typed **by Niko himself** into `C:\parture\prod\.env` (the editor is opened by the server, nothing via chat or repo) | Niko | `.env` shows "set" (never the value) | after B1.1 |
| B1.3 | Restart the PROD watcher (stop the task, end the app process, start the task); `/api/betrieb` shows `zugangsdaten: true`, `schreibenAn: false` | Server AI | Output | after B1.2 |
| B1.4 | Block list from the hub: the 50 listings of the running price-decrease test (until 24 Nov) must not go into any title test; list in `pm.db` as table `sperre` (extend the whitelist export) and taken into account by the draw (A1.3) | Server AI (export), Builder 2 (draw) | Test: a blocked listing is never drawn | 21 Nov |
| B1.5 | Shopify twins: the four test listings have Shopify counterparts; the hub writes Shopify title changes to eBay within 10 minutes. **During a test do not touch the Shopify titles of these products.** A sentence in `docs/vorfuehrung.md` and a note in the app on the Approvals page | Niko (agreement with Lion), Builder 1 (note) | Sentence + screenshot | 24 Nov |
| B1.6 | Dry run on PROD with two listings with the switch off: the log shows "would change", eBay unchanged | Niko | Log | 24 Nov |
| B1.7 | **Mini test with Lion present**: switch on, one listing, proposal → approval → check on eBay → log → revert via the app ("reverting change") → check on eBay → switch off | Niko + Lion | 4 screenshots | 24/25 Nov |
| B1.8 | **Start the real test early** (25 Nov at the latest, draw from the four listings plus control), so that on 4 Dec with 3 days of delay **at least 7 days of real data** are in the evaluation panel and not only the example verdict | Niko | Test start in the log | 25 Nov |
| B1.9 | Revert plan in writing: which listings, old title, who clicks, when; after the demo revert all titles or keep them deliberately (Lion decides) | Niko | `docs/belege/revert-plan.md` | 25 Nov |
| B1.10 | eBay daily limit of the Analytics API: traffic comes from the hub, the app does not call Analytics itself (check: `EBAY_TRAFFIC_AUTO` stays off) | Server AI | `.env` shows off | 24 Nov |

### B2. Operation and server

| # | Item | Who | Proof | By |
|---|---|---|---|---|
| B2.1 | Each of the four accesses logged in once on PROD **and** PREVIEW (Access PIN + app login), password changed; the handover files `C:\parture\zugang-*.txt` and `erste-passwoerter-*.txt` deleted afterwards | all; the server AI deletes | Message "in" per person, `ls` empty | 20 Nov |
| B2.2 | Backup: daily copy in `daten/sicherung` and on `SICHERUNG_ZIEL2` (Google Drive) exists; restore rehearsed once on PREVIEW (done 17 Nov), once more before the demo | Server AI | File list with dates | 2 Dec |
| B2.3 | Watcher logs of both environments without ERROR/REJECTED in the last 7 days before the demo; `/healthz` version = `main` | Server AI | Log excerpt | 3 Dec |
| B2.4 | Server laptop: free memory (on 17 Nov only about 500 MB), unnecessary windows and sessions closed, no Windows updates on 3/4 Dec | Niko with Lion | Measurement | 3 Dec |
| B2.5 | After a restart of the server nothing runs until somebody logs on (no automatic logon). On the demo day somebody is at the server or the server stays on | Lion/Niko | Agreement | 3 Dec |
| B2.6 | The Telegram message to the admin on a new proposal works on PROD (create a bot, `TELEGRAM_*` in `.env`) or deliberately leave it out and do not claim it in the demo | Niko | Test message or sentence deleted | 25 Nov |

### B3. Dress rehearsal (twice, with a stopwatch)

| # | Item | Who | Proof | By |
|---|---|---|---|---|
| B3.1 | The run from `docs/vorfuehrung.md` completely on PROD, second window with the eBay listing, measure the time (target 8 minutes, limit 10) | all | Time noted | 27 Nov and 2 Dec |
| B3.2 | Speaker roles: who says what at which step; everyone speaks at least once; hand-overs practised | Niko | Assignment in the doc | 27 Nov |
| B3.3 | Fallback plan: screen video of the 9 steps (without sound or with), screenshots, local app with a fresh team copy on the demo laptop, rehearsed offline (Wi-Fi off) | Builder 1 | Video + offline rehearsal | 28 Nov |
| B3.4 | Question list with answers (see B4) talked through aloud | all | Doc | 2 Dec |
| B3.5 | Demo laptop: browser with both Access sessions (valid 7 days: log in once on 28 Nov or later), eBay login in the second window, zoom 125 %, notifications off | Niko | Checklist ticked | 3 Dec |

### B4. Prepare honest answers

Taken from `docs/vorfuehrung.md` and extended. Every answer in two sentences, one person responsible.

1. Why no framework? (4,300 lines, one dependency, everything readable, no build step; cost: routing and sessions written ourselves, but tested.)
2. Why SQLite? (One file, atomic replacement of the nightly file, triggers for the log, no server component.)
3. Why are there no costs, no profit, no customers in the data? (Whitelist export, company rule; the task is phrased around impressions, quantity and price.)
4. How is it ensured that a builder changes nothing on eBay? (Roles on the server with a test, keys only on PROD, switch, read-before-write, log.)
5. What if eBay refuses the change? (The message is shown, nothing changed, a log entry.)
6. Correlation or cause? (Draw with a control group, sales as a safety figure, +20 % mark; a real verdict needs 30 days, we show the interim state after x days plus the example.)
7. What did the AI do, what did the group do? (A5.8: server operation, watcher, export by the server AI; subject core by the group. Say it openly.)
8. What would you do with another month? (Automatic verdict after 30 days, more channels, title help with more data.)
9. How did you work together? (Branches, PRs with review, CI, preview after 1 minute, PROD only through main with tests. Name the figures from `git shortlog`.)
10. How do you protect credentials? (A3.8, A3.10, secret scan over the history, Access in front of the app.)

---

## C. The day of the demo (4 Dec)

30 minutes before, Niko ticks off:

- [ ] `https://app.parture-team.com/healthz` and `https://vorschau.parture-team.com/healthz` answer, version of PROD = `main`.
- [ ] Both Access sessions on the demo laptop are valid, app login as builder **and** as admin works (two browser profiles or two browsers).
- [ ] The eBay listing for step 6 is open in the second window, logged in.
- [ ] `EBAY_SCHREIBEN=an` is set **only immediately before step 5** (watcher restart rehearsed beforehand, takes 30 seconds) and set back to off right after step 6.
- [ ] The revert plan (B1.9) lies next to it as a printout.
- [ ] Fallback plan at hand: video, screenshots, local app started.
- [ ] Niko's phone shows the Telegram message (B2.6) or the sentence about it is left out.
- [ ] After the demo: switch off, export the log (screenshot), revert according to B1.9, a short message to Lion.

---

## D. Do not build (scope protection)

From 22 Nov nothing new is added. Explicitly not: Amazon or further marketplaces, cost or profit figures,
customer data, AI-generated titles, automatic approval, price changes, a second data format next to `pm.db`.
Whoever has an idea creates an issue with the label "after the demo".

## Responsibilities at a glance (suggestion)

| Who | Focus | Items |
|---|---|---|
| **Niko** (admin) | eBay, Lion, approval, branch protection, issues, presentation lead | A1.5, A1.6, A1.8, A2.3, A3.3, A3.4, A3.8, A3.9, A3.11, A3.13, A5.1, A5.3, A5.4, A5.6, A5.7, A5.8, B1.*, B2.4, B2.6, B3.2, B3.5, C |
| **Builder 1** (suggestion Alexius76) | interface, listings, README, proofs, fallback plan | A1.1, A1.2, A1.10, A1.11, A3.6, A4.4, A4.6, A6.1, A6.6, B1.5, B3.3 |
| **Builder 2** (suggestion giacomogrilli) | draw, approval states, constants, end-to-end test | A1.3, A1.4, A1.12, A2.2, A3.7, A3.12, A4.2, A4.8, A6.5, B1.4 |
| **Builder 3** (suggestion EmbletonNova) | evaluation, security, log, architecture doc, PR template | A1.7, A1.8 (review), A1.9, A3.1, A3.2, A3.5, A4.1, A5.5, A6.2, A6.3 |
| **Server AI** | export, block list, watcher, CI Windows, server probes | A2.1, A2.4, A4.3, A4.5, A6.4, B1.3, B1.4, B1.10, B2.1 (deleting), B2.2, B2.3 |

Updates are made here, not in chats: whoever completes something ticks the box in the same PR.
