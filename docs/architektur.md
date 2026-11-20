# Architecture on one page

## Picture

```
 Builders, admins
        │ browser
        ▼
 Cloudflare Access (one-time e-mail code) ──► Cloudflare Tunnel ──► server laptop (Windows), ports only on 127.0.0.1
                                                                       │
                       ┌───────────────────────────────────────────────┴──────────────────────┐
                       ▼                                                                      ▼
             PROD  app/server.mjs :5070 (branch main)                          PREVIEW :5071 (branch vorschau, write switches off)
               │ reads                    │ writes                   │ after approval, switch on
               ▼                          ▼                          ▼
            pm.db  ◄── hourly hub export   app.db                    eBay Trading API (title, ads, price)
            (whitelist, read only)        (users, sessions, ladder,  Google Gemini (title suggestions)
                                           settings, log)

 GitHub (pull request + CI) ──► watcher app/waechter.mjs ──► npm ci, npm test ──► only when green: restart the app
```

## Modules

| File | Job |
|---|---|
| `server.mjs` | HTTP server (`node:http`), login and roles on every request, routes, the daily ladder run |
| `leiter.mjs` | the funnel: who is eligible and why (`trichter`), the lot with control group (`nimmAuf`), approval and eBay step (`gibFrei`, `fuehreAus`), evaluation against the control group (`werteAus`, `wirkung`) |
| `regeln.mjs` | the diagnosis (low impressions / fine / wait) and every default rule value |
| `ki-titel.mjs`, `titel-regeln.mjs`, `titelhilfe.mjs` | AI suggestions, the rule check every title must pass, and the AI-free title help |
| `ebay-schreiben.mjs` | the only way to eBay: read first, then write title, ad rate or price |
| `experimente.mjs`, `auswertung.mjs` | the lot (`ziehe`) and the net effect (`netto`), shared by the ladder and the older title test |
| `login.mjs`, `rollen.mjs`, `protokoll.mjs` | passwords and sessions, roles, the append-only log |
| `einstellungen.mjs` | rule values with type and range checks; only admins may save |
| `waechter.mjs`, `sicherung.mjs` | deploy after green tests, restart on crash or hang, daily backup |
| `public/app.js` | the whole interface in plain JavaScript; data is inserted as text only (`textContent`), never as HTML |

## Data flow

1. **Every hour** (since 20.11.2026; before only at 04:30) the Parture hub writes `pm.db` with whitelisted columns only, eBay only (catalogue, the eBay listing per product, eBay units, prices,
   images, traffic counts, block list). The file is written completely and then swapped atomically. Costs and customers
   never go in: the export checks column names and texts before the swap.
2. **The app opens `pm.db` read-only on every request** (`mitDb` in `app/server.mjs`), so it never hangs on the old file
   after the nightly swap.
3. **`app.db`** belongs to the app: users, sessions, settings, ladder, log. It is backed up daily.
4. **To eBay** there is one way only: an admin approves → `leiter.gibFrei` → `ebay-schreiben.mjs`. The listing is read
   first; if title or price differ from what the app expects, nothing happens. Without keys or without the switch it is a dry run.
5. **Evaluation:** when a phase starts, the app stores the listing's impressions per day of the 30 days before. When the
   waiting time is over (with a data lag of 3 days), it compares the listing and the control group over the same days.

## Decisions

| Decision | Why | Rejected alternative |
|---|---|---|
| **No framework**, `node:http` and plain JavaScript in the browser | one dependency (`better-sqlite3`, pinned), no build step, every line readable and testable | Express/React: faster at the start, but a build, many dependencies and magic nobody can explain in the walkthrough. Price: routing and sessions written by hand, with tests |
| **SQLite** for data and app state | one file, atomic swap of `pm.db`, a trigger makes the log append-only, no database server to run | PostgreSQL: multi-user strength that 4 people do not need, and one more service |
| **Whitelist data** instead of access to the company database | the team sees only what is public anyway; company rule: no costs, no customers | a redacted copy: a new column in the original would silently come along |
| **Control group drawn by lot, running inside the ladder** | impressions swing with season and eBay; only the comparison with listings that stayed unchanged over the same days shows what a phase did | before/after only: December always looks better than October. A separate test page: two places doing the same thing |
| **Three levers in a fixed order** (title, ads, price) | cheapest first: a title costs nothing, ads cost only on a sale, a lower price costs margin on every sale | all at once: nobody would know which lever worked |
| **AI suggests, a rule check filters, a human approves** | real listings of a real shop; one bad title (brand misuse, "Original") can mean a legal warning | AI writes directly: fast, but no protection against exactly those mistakes |
| **Two environments** (PROD, preview) | everyone sees changes after one or two minutes without untested code writing to eBay | only local: nobody works on the same state; only PROD: every try would be live |
| **Watcher on the server** instead of a hosting service | data and keys stay on the company machine; deploy only after green tests, restart on crash or hang, backup | Render/Fly/Vercel: keys and data at third parties, cost, and `pm.db` would not get there |
| **Append-only log** (database trigger) | proof of who did what and when, even against bugs in the app itself | a normal table: a bug could overwrite entries |

## Where the app touches files and the network

Found with `grep -n "fetch\|new Database(" app/*.mjs` (tests excluded). Everything else only computes.

| Place | What | When |
|---|---|---|
| `server.mjs` `mitDb` | `pm.db`, **read only**, opened per request | always |
| `server.mjs` `appDb` | `daten/app.db`, the app's own data | always |
| `server.mjs` `accessOk` | Cloudflare Access keys (`/cdn-cgi/access/certs`), at most hourly | only on the server |
| `server.mjs` `/api/live` | hub `/api/pm/katalog` with its own token | only on the server |
| `ebay-schreiben.mjs` | eBay OAuth + Trading API (`GetItem`, revise title, price, Promoted Listings) | only after approval, only with keys and switch |
| `ki-titel.mjs` | Google Gemini `generateContent` | in the daily run and on "Ask the AI again", only with `GOOGLE_API_KEY` |
| `export-ebay.mjs`, `traffic.mjs` | eBay API (read), builds `pm.db` itself | only by hand (`npm run export`) or with `EBAY_TRAFFIC_AUTO=an`; off on PROD, traffic comes from the hub |
| `benachrichtigung.mjs` | Telegram `sendMessage` | only with `TELEGRAM_*` in `.env` |
| `sicherung.mjs` | reads `app.db`, writes copies | daily from 3:00 |
| `waechter.mjs` | the app's own `/healthz`, `git`, `npm` | only on the server |

## What the app deliberately does not do

Amazon and other marketplaces, costs or profit, customer data, automatic approval, ending listings on eBay ("take offline"
after the manual check is a task for the admin, not an API call).
