# Set up the server: PROD and PREVIEW

This guide puts the app on the server laptop (Windows; notes for Mac/Linux at the end). It is written so that a person or an AI can work through it step by step. Every step has a **probe**: only go on when it is right.

## The target picture

```
GitHub
  main (reviewed, by pull request) ──► PROD     C:\parture\prod       port 5070   eBay keys, writing after approval, traffic import
  vorschau (builders push)         ──► PREVIEW  C:\parture\vorschau   port 5071   NO keys, shows changes after 1 to 2 minutes

Browser ─► Cloudflare Access (e-mail code) ─► Cloudflare tunnel ─► 127.0.0.1:5070 / :5071 ─► app login (role admin/builder)
```

Three security rules carry the whole design:

1. **The eBay keys exist only in the `.env` of PROD.** PREVIEW has none. Whoever can push code to PREVIEW can therefore never change anything on eBay or read keys.
2. **PROD takes only what is on `main` and passes the tests.** `main` receives changes only through a pull request with a review. Whoever has a version run on a machine with keys could read the keys, so there is no unchecked auto-deploy there.
3. **Nothing is directly reachable from outside.** The app listens only on `127.0.0.1`. From outside the only way is the Cloudflare tunnel, and Cloudflare Access sits in front of it.

## 1. Prerequisites (once)

| What | Probe |
|---|---|
| Node.js 22 or newer | `node -v` shows v22 or higher |
| Git | `git --version` |
| Power: hibernation and standby off, start automatically after a power failure (BIOS), Wi-Fi or LAN stays on | do not touch the laptop for 10 minutes, afterwards it is reachable |
| An account on the server that only Niko uses | |

The laptop must run permanently and stay plugged in. If it fails, the app is off. The backup and the watcher catch crashes, but not a switched-off computer.

## 2. Get the code (two folders)

```powershell
mkdir C:\parture; cd C:\parture
git clone -b main     https://github.com/nik1231-alt/Parture-Groupwork.git prod
git clone -b vorschau https://github.com/nik1231-alt/Parture-Groupwork.git vorschau
cd prod;     npm ci
cd ..\vorschau; npm ci
```

If the repo is private, the server needs access for this (simplest is `gh auth login` with Niko's account, or a deploy key that is **read-only**). Probe: `git -C C:\parture\prod pull --ff-only` reports "Already up to date".

> If the branch `vorschau` does not exist yet: Niko creates it (`git push origin main:vorschau`), see `docs/entwicklung.md`.

## 3. The `.env` per environment

```powershell
copy C:\parture\prod\server\env.prod.beispiel C:\parture\prod\.env
copy C:\parture\vorschau\server\env.vorschau.beispiel C:\parture\vorschau\.env
```

Then fill them in (Niko enters the eBay values himself; they are never copied into a chat, a ticket or the repo). Important:

- PROD: `EBAY_SCHREIBEN` stays **empty** at first (dry run). `PM_UMGEBUNG=prod`, port 5070.
- PREVIEW: **no** `EBAY_*`, no `TELEGRAM_*`. `PM_UMGEBUNG=vorschau`, port 5071.
- `CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD` come from step 6.

Probe: `git -C C:\parture\prod status` does **not** show the `.env` (it is git-ignored). `node scripts\geheimnis-scan.mjs` reports "clean".

## 4. Users, first start, probe

```powershell
cd C:\parture\prod
npm test                                   # all tests green
npm run benutzer -- anlegen niko admin     # the password is asked for hidden
node app\server.mjs                        # start briefly by hand
```

Probe in a second window: `curl http://127.0.0.1:5070/healthz` returns `{"ok":true,...}`, and `http://127.0.0.1:5070/` shows the login page. Then end it with Ctrl+C. The same for `vorschau` (port 5071) with its own users. The accounts of the two environments are separate (each has its own `daten\app.db`).

Accounts as **builder** are created for the other three people. Niko hands the passwords over in person, never in plain text in a chat channel that others can read.

## 5. The watcher as a permanent service

```powershell
cd C:\parture\prod;     .\server\windows\installiere.ps1 -Umgebung prod
cd C:\parture\vorschau; .\server\windows\installiere.ps1 -Umgebung vorschau
```

This creates one scheduled task each (starts at boot, even without a logon, restarts itself after a crash) and disables the old task `Parture PM (5060)`, which pulled `main` without a test gate.

What the watcher (`app/waechter.mjs`) does:
- PROD: every 10 minutes `git fetch`. If there is a new version on `main`: fast-forward only, `npm ci` if `package-lock.json` changed, `npm test` **without eBay keys**. Passed → restart the app. Failed → straight back to the old version, the app keeps running unchanged, the version is remembered and not tested again.
- PREVIEW: every minute, follows the branch `vorschau` even after a force push.
- Both: start the app, restart it with a pause after a crash, restart it hard after three missing `/healthz` answers.

Probes:
- `Get-ScheduledTask 'Parture Waechter*'` shows both tasks `Running`.
- `C:\parture\prod\daten\waechter.log` shows that the app started.
- Crash test: end the app's `node.exe` process in the Task Manager → after a few seconds it runs again (log: app ended … restart).
- Restart the laptop → after booting both ports answer without a logon.
- Rollout test: see `docs/entwicklung.md`, section "Rehearsal: a test PR all the way to PROD".

## 6. Cloudflare: tunnel and Access

Prerequisite: a **domain** managed at Cloudflare (the free plan is enough). Without your own domain there is only the provisional quick tunnel (changing address), which is not a permanent state.

**6a. Tunnel** (on the server, install `cloudflared`, e.g. `winget install Cloudflare.cloudflared`):

```powershell
cloudflared tunnel login                          # browser: choose the domain
cloudflared tunnel create parture                 # prints the TUNNEL-ID
cloudflared tunnel route dns parture app.YOUR-DOMAIN.com
cloudflared tunnel route dns parture vorschau.YOUR-DOMAIN.com
# configuration to C:\Users\<name>\.cloudflared\config.yml, template: server\cloudflare\config.beispiel.yml
cloudflared tunnel ingress validate
cloudflared service install                       # runs as a Windows service and starts again after a restart
```

**6b. Access** (Cloudflare Zero Trust, in the browser): *Access → Applications → Add → Self-hosted*, **two** applications, one each for `app.YOUR-DOMAIN.com` and `vorschau.YOUR-DOMAIN.com`. Login: *One-time PIN* (e-mail code). Rule *Allow*: **only** the e-mail addresses of the four people. Then copy the **Application Audience (AUD) Tag** of each application and enter it in the respective `.env` as `CF_ACCESS_AUD`. `CF_ACCESS_TEAM_DOMAIN` is `<teamname>.cloudflareaccess.com` (the team name is in the Zero Trust dashboard, for example under *Settings → Custom Pages*). Then restart the watcher (`Stop-ScheduledTask -TaskName 'Parture Waechter (prod)'`, then `Start-ScheduledTask …`) so that the app re-reads the `.env`.

Probes (all four must be right):
1. `https://app.YOUR-DOMAIN.com` in a private window → Cloudflare login page (e-mail code), **not** the app.
2. Log in with an allowed e-mail → app login page.
3. With a non-allowed e-mail → refused.
4. `curl https://app.YOUR-DOMAIN.com/api/ich` without an Access cookie → Cloudflare page or 302/403, never app content. And even if someone reached the origin past Cloudflare: the app answers without a valid token with **401** (`CF_ACCESS_*` set).

Afterwards end the provisional quick tunnel on Niko's Mac.

## 7. Data and traffic

On PROD, with the keys set:

```powershell
cd C:\parture\prod
npm run export          # builds daten\pm.db: listings, sales, daily traffic values
```

- The eBay Analytics API has a hard request limit (HTTP 429). The 90-day build-up therefore runs **resumably** over several runs/days (cache `daten\traffic-tage.db`). On a 429 the run stops cleanly and continues next time. Until the 90 days are there, the app uses period sums.
- Afterwards the import runs **by itself every day from 5 a.m.** (`EBAY_TRAFFIC_AUTO=an`), with finished days only (3 days delay); the last 3 days are re-checked and checked against the account total (below 80 % coverage it aborts, the old file stays).
- Visible in the app: tab **Log → Traffic import** and **System**. If the data is more than 2 days behind target, a yellow warning appears at the top and (with Telegram) a message.

Probes: the Log tab shows "Last successful import" with today's date; at the top of the app it says "traffic up to <date>", which is 3 days back with this import (with the hub export on PROD it is yesterday, see README → Data).

## 8. Backup

Runs automatically every day from 3 a.m. (`SICHERUNG_AUTO` not set to `aus`): `daten\sicherung\` (14 pieces), additionally to `SICHERUNG_ZIEL2` if set (another drive or a cloud folder). `pm.db` is not backed up; it can be rebuilt from eBay.

- Back up now: `npm run sicherung` or **Back up now** in the Log tab.
- List: `npm run sicherung -- liste`
- **Test the restore (once, before it matters):** stop the app (stop the task), `npm run sicherung -- wiederherstellen app-YYYY-MM-DD-HHMM.db`, start the app, log in. The previous file stays next to it as `app.db.vor-wiederherstellung-…`.

## 9. Switch on writing to eBay (only after the probes)

1. PROD runs with `EBAY_SCHREIBEN` empty. In the Approvals tab submit a test with 2 listings and approve it: the log shows **Dry run** ("would be changed"), nothing changes on eBay.
2. Niko chooses the 4 listings for the first real test (preferably slow sellers).
3. Niko sets `EBAY_SCHREIBEN=an`, restart the watcher.
4. Real mini test: a builder proposes → Niko approves → check on eBay that the title is changed → check the log (old and new title, eBay's answer).
5. Close the test with "revert" → approve the reverting change → check on eBay.
6. Watch and note the error cases: eBay refuses (listings with sales), the title was changed by hand (the app then overwrites nothing), the listing is not active.

One approval changes at most 50 listings at once. Before every change the app reads the current title and writes only if it matches the expected one.

## 10. Final test (security)

- Builder account: `/api/freigabe/erteilen`, `/api/rolle`, `/api/sicherung` return **403**.
- Without a login every `/api/…` address returns 401 (except `/healthz` and login).
- Five wrong passwords lock the name, 20 wrong ones lock the address.
- `curl -I https://app.YOUR-DOMAIN.com` (with an Access cookie) shows `X-Frame-Options: DENY`, `Content-Security-Policy`, and the cookie is `HttpOnly; SameSite=Strict; Secure`.
- `node scripts\geheimnis-scan.mjs --historie` reports "clean".
- On PREVIEW: `GET /api/betrieb` shows `schreibenAn:false`, `zugangsdaten:false`, `umgebung:"vorschau"`.

## Mac or Linux instead of Windows

Steps 2 to 4 and 6 to 10 are the same (adapt paths and shell). Instead of the scheduled task you start the watcher as a service:
- macOS: LaunchDaemon or LaunchAgent with `KeepAlive`, program `node`, arguments `app/waechter.mjs --branch main --intervall 600`, WorkingDirectory the PROD folder. (Practical note: background processes with access to `Desktop`/`Documents` fail on macOS privacy permissions, so create the folder outside of them, e.g. `/Users/<name>/parture`.)
- Linux: systemd unit with `Restart=always`, `ExecStart=/usr/bin/node app/waechter.mjs --branch main --intervall 600`, `WorkingDirectory=…/prod`.

## If something goes wrong

| Observation | Cause and solution |
|---|---|
| App unchanged after a deploy | Read the log: `REJECTED …` means tests failed (the output is in the log), `BLOCKED …` means a local change or no fast-forward in the PROD folder |
| 401 on the app | `CF_ACCESS_AUD`/`CF_ACCESS_TEAM_DOMAIN` wrong or the Access application belongs to the other host name |
| `Traffic import` stays on error | HTTP 429 = eBay limit, continue tomorrow; otherwise read the message in the log |
| Chrome shows `ERR_UNSAFE_PORT` | Port 5060 is blocked in the browser, hence 5070/5071 |
| Data-outdated warning | Check the import (log), are the eBay keys valid? The refresh token expires after about 18 months |
