# Checklist: Parture tool on the server, with access, coding, live traffic and approval

Status: 17 Nov 2026 (evening; everything built is on the branch `admin/server-betrieb`, committed locally, not yet pushed) · Deadline: about 23 Nov 2026 · Legend: ☐ open · ◐ built or prepared, but not yet on the server or confirmed by Niko · ☑ done and checked with the probe · **[C]** Claude does it · **[N]** Niko does it · **[G]** the group does it

## Target picture

```
GitHub ── main (reviewed) ─────────► PROD    (server, with eBay keys, writing after approval, daily traffic import)
   └──── vorschau (builders push) ─► PREVIEW (server, WITHOUT keys, shows changes at once, cannot change anything on eBay)
All access: browser → Cloudflare (login by e-mail code) → tunnel → app (127.0.0.1 only) → own login with a role
```

- **PROD** takes only code that was reviewed by pull request and merged into `main`.
- **PREVIEW** takes every push to the branch `vorschau` within 1 to 2 minutes. There are no keys there.
- "Write commands after approval come to me" means: a builder sends a proposal, Niko (admin) approves, and the PROD app then changes the title with **Niko's** eBay access and logs it. Niko gets a notification as soon as a proposal is waiting (block E).

---

## A. Code and collaboration on GitHub

- ☐ A1 **[C]** Open a pull request for the login (`emb/login` → `main`) *(suggestion: PR #4 already contains the login commit, re-target it to `main` instead of two PRs; waiting for Niko's yes)*
- ☐ A2 **[N]** Review and merge the login PR (agree with EmbletonNova)
- ☐ A3 **[N]** Review and merge PR #4 (roles, approval, log, import) (it then switches to `main` automatically)
- ☐ A4 **[N]** Protect `main`: only through a pull request, at least 1 review (GitHub Pro through the Student Developer Pack)
- ☐ A5 **[C]** Create the branch `vorschau` and define: builders work on `vorschau` or their own branches and merge there
- ◐ A6 **[C]** Set up automatic tests on GitHub (`npm test` on every PR, without keys) *(workflow `.github/workflows/pruefung.yml` written; runs only after the first push)*
- ☑ A7 **[C]** Secret scan in the pipeline (no key, token or password in the code) *(`npm run scan`; files and whole history clean, counter-test with a planted finding passed)*
- ☑ A8 **[C]** README: developer guide (clone, start locally, create a user, branch, PR, review, merge) *(`docs/entwicklung.md`)*

## B. Prepare the server (once)

- ☐ B1 **[N]** Decide the server: operating system, access (remote), does it run permanently, power and network stable
- ☐ B2 **[N]** Power options: hibernation and standby off, start automatically after a power failure
- ☐ B3 **[N]** Install Node 22 or newer and Git, check `node -v` and `git -v`
- ☑ B4 **[C]** Write the setup guide for the server (step by step, for Windows and Mac) *(`docs/server-einrichtung.md`, every step with a probe)*
- ☐ B5 **[N]** Clone the repo twice: folder `prod` (branch `main`) and `vorschau` (branch `vorschau`)
- ☑ B6 **[C]** `.env` templates for PROD and PREVIEW (own ports, own databases, PREVIEW without keys and without a write switch) *(`server/env.prod.beispiel`, `server/env.vorschau.beispiel`)*
- ☐ B7 **[N]** Fill in the `.env` on the server (PROD: eBay keys, `EBAY_SCHREIBEN`, `EBAY_TRAFFIC_AUTO`)
- ◐ B8 **[C]** Start scripts that bring the app back up by themselves after a restart and a crash (task scheduler or service) *(`server/windows/installiere.ps1` written, not yet run on Windows)*
- ◐ B9 **[C]** Auto-deploy: PROD fetches only `main` (fast-forward only), builds, restarts. PREVIEW fetches `vorschau` every minute *(watcher `app/waechter.mjs`: 8 tests including a process test with auto-deploy, crash and a hanging app, on the Mac; not yet run on Windows)*
- ☑ B10 **[C]** The deploy aborts if `npm test` fails, the old version keeps running *(tested: failed tests → fall back to the old version, the bad version is not tested again)*
- ☐ B11 **[N]** Check: the app listens only on `127.0.0.1`, no incoming ports opened in the firewall

## C. Access from outside (Cloudflare)

- ☐ C1 **[N]** Create a Cloudflare account
- ☐ C2 **[N]** Set up the domain at Cloudflare (connect an existing one or buy a new one)
- ☐ C3 **[N]** Install a named tunnel on the server as a service (runs again after a restart)
- ☑ C4 **[C]** Configuration template and steps for two addresses: `app.<domain>` (PROD) and `vorschau.<domain>` *(`server/cloudflare/config.beispiel.yml`, guide in `server-einrichtung.md` step 6; still untested against real Cloudflare)*
- ☐ C5 **[N]** Cloudflare Access: login by e-mail code for the four addresses (Niko and the three others)
- ☐ C6 **[N]** Enter `CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD` in both `.env` files
- ☐ C7 **[C]** Test from outside: without Access → 401, with Access → login page, with login → app
- ☐ C8 **[C]** End the Mac quick tunnel, stop the Mac app as soon as PROD runs

## D. Data and live traffic

- ☐ D1 **[N]** Decide: take users and tests from the Mac (`daten/app.db`) to the server or start fresh
- ☐ D2 **[C]** If taking them: transfer the file safely, check the roles
- ☐ D3 **[N]** First export on the server (`npm run export`), check the age of the data
- ◐ D4 **[C]** The 90-day backfill runs over several days until eBay lifts the limit (check the progress in the log) *(the import is built resumable and limit-safe and tested; the backfill itself is still to come, eBay limit)*
- ◐ D5 **[C]** Daily import from 5 a.m. automatically, 3 days delay, control against the account total *(built and tested; not yet confirmed live)*
- ☑ D6 **[C]** Status in the app: last success, last error, age of the data. A warning when data is older than 2 days *(warning banner and status in the Log tab; checked by an HTTP test and a browser screenshot)*
- ☑ D7 **[C]** Daily backup of `app.db` and `traffic-tage.db` to a second location, restore tested once *(`npm run sicherung`, daily backup inside the server, restore checked in a test; restore on the server and the second location are still to come)*
- ☐ D8 **[C]** Renew the team copy `daten-team/pm.db` regularly from PROD (for the builders' local development)

## E. Writing after approval

- ☐ E1 **[N]** eBay keys only on PROD, nowhere else. Confirm PREVIEW has no keys
- ☐ E2 **[C]** Dry run on PROD (write switch off): listings are found, titles recognised
- ☐ E3 **[N]** Decide which 4 listings the first real test may change
- ☐ E4 **[C]** Real mini test: propose → approve → check on eBay → check the log
- ☐ E5 **[C]** Play through a revert completely once
- ◐ E6 **[C]** Document the error cases (eBay refuses, title changed by hand, listing inactive) *(the expected cases are covered in the app and tested; real eBay answers still unknown)*
- ☑ E7 **[C]** Limit per approval (e.g. at most 50 titles at once) *(limit 50, tested)*
- ◐ E8 **[C]** Notification to Niko when a proposal is waiting (Telegram or e-mail) *(Telegram, checked by a test with a fake network; a real bot token is still missing)*
- ☑ E9 **[C]** Check: builders get 403 on PROD for approval and roles *(checked in the server test: a builder gets 403; confirm once more on PROD)*

## F. Security

- ☐ F1 **[N]** Change the admin password, delete the file `erstes-passwort.txt`
- ☑ F2 **[C]** Change the password in the app itself (each person for themself) *(Account tab, server test)*
- ☑ F3 **[C]** Lock per address on failed attempts *(5 failed attempts per name, 20 per address; tested)*
- ☐ F4 **[C]** Create accounts on PROD and PREVIEW, hand the credentials safely to the three others
- ◐ F5 **[C]** Check protective headers, cookie flags and rights from outside (final test) *(headers, cookie and 403 tests run automatically; the check from outside through Cloudflare is still to come)*
- ☐ F6 **[N]** Check who has access to the server (only Niko)

## G. Access and coding for the group

- ☐ G1 **[N]** Confirm the three others' GitHub access (they have it, write permission)
- ☐ G2 **[G]** Everyone clones the repo, `npm install`, creates a local user, `npm start`: changes visible at once
- ☐ G3 **[G]** Way of working: own branch → push to `vorschau` to show → PR against `main` → review → merge
- ☐ G4 **[C]** Rehearsal: test push to `vorschau`, visible after 1 to 2 minutes
- ☐ G5 **[C]** Rehearsal: test PR against `main`, the CI runs, after the merge the change is on PROD
- ☐ G6 **[G]** All three log in to PREVIEW and PROD and see tests and approvals

## H. Presentation and acceptance

- ☑ H1 **[C]** Demo mode with an example verdict (there will be no real verdict within 6 days) *(expandable in the Tests tab, three examples with invented figures, checked in the browser)*
- ☑ H2 **[C]** Title suggestions per listing (the builder checks and adopts them) *(as the title help: invents no titles, shows only evidence-based words from the own data; on the real data it currently finds no clear pattern and then shows only a note)*
- ☑ H3 **[C]** Run plan for the demo (diagnosis → draw a test → title → approval → eBay → log → result) *(`docs/vorfuehrung.md`)*
- ☑ H4 **[C]** Architecture overview (one page) and a tidied README *(`docs/vorfuehrung.md`, README)*
- ☐ H5 **[G]** Dress rehearsal of the demo, fallback plan (screenshots/video in case the network is missing)
- ☐ H6 **[N]** Feature freeze one day before the hand-in, afterwards only bug fixes

---

## Schedule

| Day | Blocks |
|---|---|
| 1 | A (everything except A4), B1 to B3, start C1 and C2 |
| 2 | B4 to B11, C3 to C6, F1 |
| 3 | D, E1 to E5, F2 to F4 |
| 4 | E6 to E9, G, H1 and H2 |
| 5 | F5, H3 to H5 (dress rehearsal), feature freeze |
| 6 | Buffer, hand-in |

## Dependencies that shape the plan

- Everything under B to G depends on B1 (server) and C2 (domain). Without both, only A, F2, F3, E8 and H remain.
- E4 (real test) needs E3 (your selection) and a running PROD (B, C).
- D4 depends on the eBay limit and runs by itself over several days.
