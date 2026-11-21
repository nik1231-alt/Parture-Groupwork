# Handover protocol: bringing the Parture tool onto the server

This document is for the AI (Claude Code or similar) that runs on the **server laptop** and has access to Cloudflare (tunnel, Access) there. It is written so that you can carry on without prior knowledge. The AI on Niko's Mac built and tested the tool. You set it up on the server, switch it live after the probes and hand it over to the group.

**Niko gives you only this as the first sentence:** "Read `docs/uebergabe-server-ki.md` in the repo `Parture-Groupwork` completely and work through it from top to bottom. Ask me only at the points that are marked 'Ask Niko'."

---

## 1. The task in one sentence

The repo `nik1231-alt/Parture-Groupwork` (private GitHub repo, university team project, deadline about **23 Nov 2026**) is a **product management tool for the eBay shop `partureshop`** (focus: more impressions through title tests). It is to run on the server **robustly and presentably**, reachable for all four group members by login, with traffic data arriving automatically every day, and title changes on eBay are to happen only after **approval by Niko** (admin) and with his eBay access, and be logged without gaps.

Niko explicitly wants **"no half-baked things, but a robust system that can be shown and presented"**. Rather fewer features that run reliably than many that only run most of the time.

## 2. Rules of the game for you (binding)

1. **Secrets:** eBay keys, refresh token, Cloudflare tokens, Telegram token, passwords, `.env` contents and tunnel credentials are **never** written into the chat, commits, issues, logs, tool output or documents. Niko enters values into the `.env` **himself** (he opens the file in an editor). You do not print the file (`cat .env` is taboo) and in checks you show only "set / not set". Niko's wish: do not post passwords in the chat.
2. **Nothing with an effect on the outside without Niko's yes:** no push to `main`, no merge, no closing of pull requests, no change to GitHub settings, no switching on `EBAY_SCHREIBEN=an`, no real title change on eBay, no approval of Cloudflare Access persons without his list. Preparing and suggesting yes, executing only after a "yes".
3. **No unchecked versions on the machine with the keys.** PROD follows only `main` and only after passing tests. You do not set up any mechanism that pulls code from a branch that somebody can write to without a review onto a machine with eBay keys. (Reason: whoever has code run there can read the keys.)
4. **A command that ends processes hits only your target.** No `pkill node`, no `taskkill /im node.exe` (that once ended Niko's running server as well). Always by PID or by the task.
5. **Reply to Niko in German**, briefly and honestly. If something did not work or is not tested, say so. In `docs/server-checkliste.md` tick only what you checked yourself with the given **probe**.
6. Work on your own branch (`server/<topic>`), open pull requests, **never write directly to `main`**.

## 3. What is already done (built and checked with 116 automatic tests)

| Area | Status |
|---|---|
| Login | Users/sessions (scrypt, HttpOnly/SameSite/Secure cookie), lock per name (5 failed attempts) and per address (20), change password under *Account*, protective headers/CSP |
| Roles | `admin` (Niko) and `builder` (Alexius76, giacomogrilli, EmbletonNova). The server checks rights, not only the interface. Always at least one admin |
| Approval | Builder: "Send for approval". The admin approves → the app reads the current title on eBay, overwrites **nothing** if it differs from the expected one, writes only with `EBAY_SCHREIBEN=an`, otherwise **dry run**. Limit of 50 listings per approval. A revert ("revert") needs an approval again |
| Log | Tab *Log*, append-only (SQLite triggers forbid changing/deleting) |
| Traffic | Daily values per listing from the eBay Analytics API, cut-off day = today − 3 days, the last 3 days are re-checked, control against the account total (< 80 % aborts), resumable on HTTP 429, automatically every day from 5 a.m. (`EBAY_TRAFFIC_AUTO=an`), warning banner when 2 days or more behind |
| Operation | Watcher `app/waechter.mjs` (auto-deploy with a test gate, restart after a crash/hang), daily backup with restore, Telegram message (optional), status page (tab Log → System), environment badge PREVIEW/LIVE |
| Quality | CI workflow (`.github/workflows/pruefung.yml`), secret scan over files **and the whole Git history** (clean, status 17 Nov), developer guide, setup guide |
| Helpers | Title help (word hints from the own data, invents no titles), example verdicts with invented figures (tab Tests) |

**Not** tested: a real title change on eBay (only against a fake writer), and the new interface was accepted only by API and syntax check, not visually in the browser. That belongs in your probes (section 6).

## 4. Where the code lies right now (check this first!)

Everything lies on **branches**, none of it was on `main` when this document was written:

- `emb/login` (login by EmbletonNova)
- `admin/rollen-freigabe` (PR #4: roles, approval, log, traffic import; base still `emb/login`)
- `admin/server-betrieb` (watcher, backup, Telegram, status page, change password, title help, demo, CI, docs, this document)

**First action:** `git fetch` and check what is on `origin/main` (`git log --oneline origin/main -5`, `git branch -r --contains <commit>`). If the three branches are still missing, **ask Niko** to merge them in the right order (login → PR #4 → operation). You do not merge yourself. Until then you can prepare everything (folders, tunnel, Access) and run the probes from a clone of the branch `admin/server-betrieb`.

The branch **`vorschau`** is needed as well. If it does not exist: Niko creates it or allows you `git push origin main:vorschau` (nothing else).

## 5. The architecture you create

```
GitHub
  main    ──► PROD     C:\parture\prod       port 5070   eBay keys, approval, traffic import, watcher (fast-forward + tests only)
  vorschau──► PREVIEW  C:\parture\vorschau   port 5071   NO keys, watcher follows hard, every minute

Browser ─► Cloudflare Access (e-mail code, only the 4 addresses) ─► Cloudflare tunnel (service) ─► 127.0.0.1:5070 / :5071 ─► app login
```

- The app listens only on `127.0.0.1`. Open no incoming firewall ports.
- With `CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD` set, the app accepts **only** requests with a valid Cloudflare Access token (otherwise 401). Two Access applications, two different AUDs (one per host name).
- Chrome blocks port 5060 (`ERR_UNSAFE_PORT`): hence 5070/5071, not 5060.

## 6. Your work plan (from top to bottom)

The detailed commands and probes are in **`docs/server-einrichtung.md`** (same numbering of the steps). Tick things off in **`docs/server-checkliste.md`** (IDs B1 … H6). Use your own branch/PR for the ticks.

**Phase 1: prepare the server (B)**
1. Check the state of the machine: operating system, Node ≥ 22, Git, hibernation off, network stable, which old tasks/processes run (`Get-ScheduledTask`, are ports 5060/5070/5071 in use?). There may still be **`C:\parture-pm`** with the old task "Parture PM (5060)" (pulls `main` without tests): `installiere.ps1` disables it. **Do not delete** the data there (`daten\app.db`, `.env`); look at it first and clarify with Niko (**Ask Niko** whether it should be taken over).
2. Two clones `C:\parture\prod` (`main`) and `C:\parture\vorschau` (`vorschau`), `npm ci`, `npm test` green in both.
3. Create the `.env` per environment from `server\env.prod.beispiel` / `env.vorschau.beispiel`. **Niko enters the eBay values himself.** `EBAY_SCHREIBEN` stays **empty**.
4. Create users (`npm run benutzer -- anlegen …`), have the passwords asked for hidden, **do not** print them. Niko = admin, the three others = builder; both environments.
5. Watcher as a task: `.\server\windows\installiere.ps1 -Umgebung prod|vorschau`. Probes: crash test, restart of the laptop, `daten\waechter.log`.

**Phase 2: access from outside (C)** (you have the Cloudflare rights)
6. Named tunnel `parture` with two host names (`app.<domain>`, `vorschau.<domain>`), installed as a service; config from `server\cloudflare\config.beispiel.yml`. **Ask Niko** for the domain (must be managed at Cloudflare) and the team name.
7. Two Access applications (self-hosted), login *One-time PIN*, rule *Allow* only for the four e-mail addresses (**Ask Niko** for the addresses). Enter the AUD tags in the `.env` (an AUD is not a password, but still treat it sparingly), restart the watcher.
8. Probes from `server-einrichtung.md` step 6 (four of them). Only when all are right: have the quick tunnel and the app on Niko's Mac ended (**Niko** does that, it is his Mac; the group currently uses the temporary address there).

**Phase 3: data and backup (D)**
9. First `npm run export` on PROD. **Known:** the eBay Analytics API has a hard request limit (HTTP 429). The 90-day build-up therefore continues by itself over several runs/days (cache). On a 429 do not hammer repeatedly, continue the next day. Check the progress and coverage in the tab *Log*; coverage (sum of listings against the account total) should be close to 100 %, below 80 % is an error. Data may count as "done" only when the last 3 days have been re-checked.
10. `EBAY_TRAFFIC_AUTO=an`: check the next day that the import ran by itself at/after 5 a.m. (log: "Last successful import" with today's date).
11. Backup: `npm run sicherung`, **really test the restore once** (step 8 in `server-einrichtung.md`), set `SICHERUNG_ZIEL2` to another drive or a cloud folder (**Ask Niko** where).
12. Optional: let `PM_DB` of the preview point to the `pm.db` of PROD (read-only), so that the same figures are shown there.

**Phase 4: writing after approval (E)**
13. Dry-run probe on PROD (switch empty): submit two listings, approve, the log shows **Dry run**, nothing changes on eBay.
14. **Ask Niko:** which **4 listings** may the first real test change (slow sellers, hardly any sales)? Only then `EBAY_SCHREIBEN=an` (Niko sets it himself), restart the watcher.
15. Real mini test with Niko present: the builder account proposes → Niko approves → **look on eBay** that the title is changed → check the log → close the test with "revert" → approve the reverting change → look on eBay. Note what eBay refuses (**expected:** eBay can refuse title changes for listings with sales; the app then shows eBay's message, changes nothing and logs it).
16. Telegram: Niko creates a bot and enters `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID` himself in the PROD `.env`. Probe: a builder submits a proposal → the message arrives at Niko's.

**Phase 5: security and handover to the group (F, G)**
17. Niko changes his password under *Account* and deletes the file `daten/erstes-passwort.txt` on the Mac (**Niko**).
18. Run through `server-einrichtung.md` step 10 completely (a builder gets 403 on admin routes, headers, cookie flags, secret scan, `/api/betrieb` of the preview shows `schreibenAn:false`).
19. The probe "test PR all the way to PROD" from `docs/entwicklung.md` together with a builder. All three log in to PREVIEW and PROD.

**Phase 6: presentation (H)**
20. Play through the demo with Niko: diagnosis → draw a test → title (with the title help) → approval → eBay → log → example verdict. Fallback plan: screenshots or a short video in case the network is missing. Feature freeze one day before the hand-in.

## 7. Known stumbling blocks

- **There is no real verdict within 6 days:** a test needs at least the waiting time (default 30 days, adjustable in *Settings*) plus 3 days of data delay. That is why the example verdicts exist. Do not promise that a real result exists.
- **Chrome/port:** 5060 is blocked. Do not mistake `ERR_UNSAFE_PORT` for "server broken" either.
- **eBay Analytics:** data in LA time; `traffic_report` with `listing_ids` in batches of 200 (an `offset` is ignored); limit 429.
- **The eBay refresh token** expires after about 18 months; on auth errors in the import check that first.
- **macOS peculiarity** (if the server is a Mac): background services fail on privacy permissions for `Desktop`/`Documents`; create the folder outside (e.g. `~/parture`). Symlinks such as `/tmp` → `/private/tmp` are taken into account in the watcher.
- **`vorschau` is overwritten hard:** whatever should stay belongs in a pull request to `main`.
- **GitHub branch protection** does not exist for a private free repo (GitHub Pro needed, free in the Student Developer Pack). Until Niko has activated it, "never directly to `main`" is only an agreement. That is a known residual risk, point Niko to it.
- The CI runs only once the workflow file lies on a pushed branch.

## 8. It is done when

- [ ] `https://app.<domain>` and `https://vorschau.<domain>` are reachable only with Access (e-mail code) and app login; probes 1 to 4 passed.
- [ ] After a restart of the laptop both environments and the tunnel run without any action.
- [ ] A push to `vorschau` is visible after 2 minutes at most; a merged PR is on PROD after 10 minutes at most; a PR with red tests is **not** rolled out (log: REJECTED).
- [ ] Traffic arrives by itself every day; coverage plausible; the warning banner appears when behind.
- [ ] The backup runs daily, the restore was tested once, the second location is set.
- [ ] A real eBay mini test (proposal → approval → title changed on eBay → log → revert) has been played through and can be traced in the log.
- [ ] Builders have no way to eBay on PROD (403, no keys on PREVIEW).
- [ ] Niko has changed his password, the password file is deleted, `node scripts/geheimnis-scan.mjs --historie` is clean.
- [ ] `docs/server-checkliste.md` is ticked honestly, open points are in it with the reason.

## 9. What you need from Niko ("Ask Niko")

1. The domain at Cloudflare, the team name of the Zero Trust account.
2. The four e-mail addresses for Access.
3. Whether data/users from an old installation (`C:\parture-pm`) should be taken over.
4. Where the second backup copy should go.
5. The 4 listings for the first real test and his date for the joint mini test.
6. The Telegram bot (he creates it and enters the values himself).
7. The hand-in format and the exact hand-in date.

## 10. Quick reference

```
npm test                          all tests (must be green)
npm run scan [-- --historie]      secret scan
npm run benutzer -- anlegen <name> [admin|builder] | passwort <name> | rolle <name> <role> | liste
npm run export                    build pm.db from eBay (PROD, with keys)
npm run sicherung [-- liste | -- wiederherstellen <file>]
node app/waechter.mjs --branch main --intervall 600          PROD watcher (runs as a task)
node app/waechter.mjs --branch vorschau --hart --intervall 60   PREVIEW watcher
GET /healthz            sign of life with version (without login)
GET /api/betrieb        status: environment, version, write switch, backup, traffic (logged in)
Logs: daten\waechter.log (watcher), daten\app.log (app), tab "Log" in the app (the business log)
```

Repo: `https://github.com/nik1231-alt/Parture-Groupwork` · eBay account: `partureshop` (eBay only, only this account) · Roles: Niko = admin, Alexius76 / giacomogrilli / EmbletonNova = builder.
