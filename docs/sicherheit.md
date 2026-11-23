# Security: threats, measures, evidence

For the group, the teaching staff and the demo. Every measure points to the test that proves it (`npm test` runs them all).
Figures measured on 19 Nov 2026 on the branch `feat/sicherheit`.

**The app contains no customer or buyer data.** Neither `pm.db` nor `app.db` nor the log knows buyer names,
addresses, e-mails or single orders. The export (`app/export-ebay.mjs`, function `verkaeufe()`, lines 93 to 121 with comments)
reads only the item number (`legacyItemId`), quantity, line price and order date from the eBay order interface and
condenses them at once into four values per item (pieces in total, pieces in 90 days, average price, last sale date).
Single orders are never stored. Evidence: `app/test.mjs` → *"No customer data: pm.db has no columns for buyers, and the export reads only item, quantity, price, date from orders"* (checks the columns of the team copy and exactly these
five fields in the export code). The log contains only team user names, listing numbers and titles.

## Threat model

| # | Who / what | What could happen | Measure | Evidence (file → test) |
|---|---|---|---|---|
| 1 | **A stranger on the internet** | calls the app, reads data, tries addresses | Cloudflare Access (login by e-mail code) in front of PROD and PREVIEW; the app also checks the Access JWT (algorithm RS256, `aud`, `exp`, signature against the Cloudflare keys) and refuses in any doubt; the app listens only on `127.0.0.1`, no port is open. Behind that the app's own login: every route except four deliberately public ones answers 401 without a session | `test-routen-schutz.mjs` → *"Cloudflare Access: with the aud set only with a valid JWT …"*, *"every non-public route: 401 without login"*, *"static files: without login only the login page, everything else 401"*; server probe: `docs/server-checkliste.md` (B11, C5 to C7, F5) |
| 2 | **A builder without admin rights** | approves themself, makes themself admin, triggers a backup or the eBay import, switches writing on | Roles are checked **in the server** (`adminNoetig`), the interface only hides things. Admin only: read/set roles, approve, reject, start directly, traffic import, backup. The write switch `EBAY_SCHREIBEN` exists only in the server's `.env`; no route and no setting can set it | `test-routen-schutz.mjs` → *"every admin route: a builder gets 403, and is still a builder afterwards"*, *"eBay write switch: no route and no setting can set EBAY_SCHREIBEN …"*; `test-rollen-http.mjs` → *"Builder: roles, approval, rejecting and starting directly are blocked (403)"*; `test-freigabe.mjs` → *"Approval: a builder cannot approve anything, and nothing happens on eBay"* |
| 3 | **A lost laptop** (of a builder) | someone finds passwords, sessions or eBay keys | Builder computers hold no keys (only PROD has them). Passwords only as a scrypt hash with their own salt, session tokens only as a SHA-256 hash in the database. A session ends after 12 hours; a password change ends all other sessions; logging out deletes the session on the server | `test.mjs` → *"Login: the hash is scrypt (N=16384, r=8, p=1, 64 bytes) with its own 16-byte salt per user"*, *"Login: a correct login returns a session, the token is only in the database as a hash"*, *"Login: a session expires after 12 hours …"*, *"Login: changing the password checks the old one, requires a new one, ends other sessions and issues a new one"*; `test-http.mjs` → *"Logging out ends the session on the server"* |
| 4 | **A leaked commit** | an eBay token, a `.env` or a database lands on GitHub | `.env*` and `*.db` are in `.gitignore` (exception: the team copy without costs or customers). `npm run scan` looks for token patterns and forbidden files; the CI scans the whole history on every push | `scripts/geheimnis-scan.mjs` (CI: `.github/workflows/pruefung.yml`, step "Secret scan"); status 19 Nov: *"clean"* |
| 5 | **A malicious listing title** (e.g. `<script>` in the eBay title) | a script runs in an admin's browser and clicks "Approve" | Data enters the page only through `textContent` (0× `innerHTML`); the API delivers JSON with `nosniff`; the CSP `script-src 'self'` additionally blocks injected scripts. The title goes to eBay XML-escaped | `test-xss.mjs` → *"API: a title with <script> comes back as JSON text, unchanged, never as HTML"*, *"Interface: no innerHTML, outerHTML, …"*, *"CSP: every HTML response allows only scripts from the app itself …"*; `test-freigabe.mjs` → *"eBay writer: titles are escaped for XML …"* |
| 6 | **CSRF from a foreign site** | a page an admin has open sends "approve" to the app | Cookie `SameSite=Strict` and `HttpOnly`; every POST must have `Content-Type: application/json` (415 otherwise) and must not carry a foreign `Origin` (403); CSP `form-action 'self'`, `frame-ancestors 'none'` | `test-routen-schutz.mjs` → *"CSRF: every POST route rejects a foreign origin (403) and a wrong type (415), even with a valid admin session"*, *"Forms send nowhere except to the app itself"*; `test-http.mjs` → *"Write action with login, but from a foreign site or with the wrong type: rejected"* |
| 7 | **Brute force on the login** | trying passwords or locking other people's accounts | Minimum length 10 characters; after **5** failed attempts the name is locked for 15 minutes, after **20** failed attempts across all names the address is; same message and same computing time for a wrong name and a wrong password | `test.mjs` → *"Login: minimum length exactly 10 characters, lock after exactly 5 failed attempts per name and 20 per address, 15 minutes"*, *"Login: after MAX_FEHLVERSUCHE (5) failed attempts the name is locked …"*, *"Login: lock per address across all names …"*, *"Login: wrong password, unknown name and odd inputs are rejected, with the same message"* |
| 8 | **Someone pushes bad code to `main`** | PROD runs with a broken or malicious version | Way of working: only by pull request with a review (`docs/entwicklung.md`); the CI runs on every PR. The watcher rolls out only if `npm test` is green, otherwise the old version keeps running; fast-forward only; the watcher's secrets do not reach the test run | `test-waechter.mjs` → *"failed tests: fall back to the old version …"*, *"no fast-forward (local commit on the server): PROD blocks …"*, *"Secrets from the watcher's environment do not reach the test run"* (branch protection on GitHub is so far an agreement, not enforced) |
| 9 | **eBay refuses, or someone changed the title by hand** | the app overwrites something wrong or loses track | Writing only with all three keys **and** `EBAY_SCHREIBEN=an`; before every change the title is read, and if it differs nothing is written; at most 50 listings per approval; every outcome (changed, refused, error, dry run) is in the log, which can only be appended to; approval is a state machine, illegal transitions give 409 | `test-freigabe.mjs` → *"eBay latch 1 … 4"*, *"Approval: if the title was changed by hand on eBay in the meantime, nothing is overwritten"*, *"Approval: if eBay rejects the change …"*, *"Limit: …"* (2 tests), *"State machine: …"* (3 tests); `test-freigabe.mjs` → *"Log: it is append-only, changing and deleting fail"* |
| 10 | **The hub delivers outdated or broken data** | decisions on old figures, half a file | `pm.db` is replaced only when the rebuild is finished (atomically), otherwise the old one stays; the app shows the data age and warns from 2 days behind; a hub error is reported as 502 instead of silently showing old data | `test-betrieb-http.mjs` → *"Data age: expected = today minus delay. On time is fine, 1 day behind too, from 2 days it is outdated"*; `test-traffic.mjs` → *"Fetch: a short error is retried, a lasting error aborts instead of delivering half a day"* |

## The points of checklist A3 one by one

| # | Point | Evidence |
|---|---|---|
| A3.2 | Every route: 401 without login, builder on an admin route 403 | `test-routen-schutz.mjs` reads `ROUTEN`, `POST_ROUTEN` and the directly handled addresses from `app/server.mjs`: **34 routes** (method + path), of which 33 under `/api` plus `/healthz` (31 different `/api` paths; `/api/einstellungen` and `/api/experiment` exist as GET and POST). 30 need a login, 7 of them for admins only (recognised by `adminNoetig`, mandatory list in the test). Public with a reason: `/healthz`, `POST /api/login`, `GET /api/ich`, `POST /api/logout`. A new unprotected route makes the test fail |
| A3.3 | scrypt with salt, lock after 5 (name) or 20 (address), minimum length 10, password change ends other sessions, logout deletes on the server | see rows 3 and 7; additionally `test-rollen-http.mjs` → *"Changing the password through the server: … old session ends …"* |
| A3.4 | Cookie HttpOnly, SameSite=Strict, Secure only over HTTPS, lifetime 12 hours | `test-routen-schutz.mjs` → *"Cookie: HttpOnly and SameSite=Strict always, Secure only over HTTPS (behind Cloudflare), limited lifetime"*; `test.mjs` → *"Login: the cookie is read and is HttpOnly, SameSite=Strict, Secure over HTTPS"* |
| A3.5 | Origin check on POST, no forms to foreign hosts | row 6 |
| A3.6 | XSS | row 5 |
| A3.7 | Input checked in the module: title at most 80 characters, item number digits only (6 to 20), test id a positive whole number, approval states | `test.mjs` → *"Enter title: only for the test group, checked, overwritable"* (81 characters → 400, 80 allowed); `test-freigabe.mjs` → *"Input: test id only as a positive whole number, kind only titel/zurueck, eBay item number only digits"*, *"State machine: rejected is final …"*, *"… applied is final …"*, *"… discarded …"*, *"Submit: … not twice"* |
| A3.8 | Secrets | row 4. `npm run scan` on 19 Nov: clean |
| A3.9 | Roles on the server | row 2 |
| A3.10 | Access from outside | row 1 |
| A3.12 | Undo on eBay (F7): admin only, read before write, dry run without switches | `test-leiter.mjs` → *"Undo on eBay (F7): …"* (3 tests: reverse order, price, eBay changed in between / nothing to undo / dry run); `test-rollen-http.mjs` → builder gets 403 on `/api/leiter/rueckgaengig`. The ad is only removed from the app's own campaign |
| A3.11 | eBay write path, one test per latch | `test-freigabe.mjs` → *"eBay latch 1: without all three credentials no call goes out, even with EBAY_SCHREIBEN=an"*, *"eBay latch 2: only exactly EBAY_SCHREIBEN=an switches writing on"*, *"eBay writer: without EBAY_SCHREIBEN=an nothing is ever written …"*, *"eBay latch 3: read before write with the real writer …"*, *"Limit: …"*, *"eBay latch 4: every outcome is in the log …"* |
| A3.12 | Dependencies and Node version | one direct dependency (`better-sqlite3`, with 38 indirect packages); `npm audit --omit=dev` on 19 Nov: *"found 0 vulnerabilities"*. Node fixed: `"engines": { "node": ">=22" }` in `package.json`, `.nvmrc` = `22` (server: Node 22.22.3, CI: Node 22) |
| A3.13 | No customer data | sentence at the top |

## Why the cookie is not `Secure` locally

A cookie with `Secure` is sent back by the browser only over HTTPS. Locally the app runs over `http://127.0.0.1:5070`, where
you would be logged out again right after logging in. The app therefore sets `Secure` exactly when the request came over HTTPS: on
the server Cloudflare terminates HTTPS and reports it with `X-Forwarded-Proto: https`, so all cookies on PROD and
PREVIEW carry `Secure`. Locally the traffic never leaves the computer (the app listens only on `127.0.0.1`), so there is nothing
to eavesdrop on. An attacker who sets the header themself only makes the cookie stricter, never weaker.

## Access from outside

Both environments are behind Cloudflare Access (login by e-mail code for the team only). If `CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD`
are set in the server's `.env`, the app additionally accepts **only** requests with a valid Access JWT
(`accessOk()` in `app/server.mjs`: RS256, `aud` contains its own application, `exp` not expired, signature against the
public keys from `https://<team>/cdn-cgi/access/certs`). This protects even if someone creates a host name once
without an Access rule. The app and its watchers listen only on `127.0.0.1`; only the Cloudflare tunnel is reachable from outside.
Setup and probe from outside: `docs/server-checkliste.md` (B11, C1 to C8, F5) and `docs/server-einrichtung.md` step 6.

## Known limits (honestly)

- The failed-attempt counters are in memory; a restart resets them. For a team of five people behind Cloudflare Access that is enough.
- The log can only be appended to inside the app (a trigger in the database). Whoever reaches `daten/app.db` directly could remove the triggers: it is evidence, not tamper-proof proof.
- Settings (diagnosis thresholds, test size) may also be changed and reset by builders. They change nothing on eBay, but they change the app's suggestions.
- The JWT check does not check an issuer (`iss`); the `aud` is unique per Access application and the signature comes from the keys of the own team domain.
- Branch protection on `main` is enforced since the hand-in (23 Nov 2026): pull request with one approval, the check `tests` must pass, no force push, also for admins. Before that it was an agreement (`docs/entwicklung.md`).
