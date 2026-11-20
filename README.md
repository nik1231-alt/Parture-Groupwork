# Parture Listing Lab

Team project for *Introduction to Programming* (Fall 2026). The 3D-printing shop **Parture** (`partureshop`, about 760 eBay
listings) has many listings that buyers hardly ever see. This app finds them, moves them through a **funnel** of three
levers (a new title, ads, a lower price) and measures every step against a **control group** drawn by lot, so a busy
season never counts as success. Nothing changes on eBay until an admin approves it, and every action lands in a log that
cannot be edited.

**Live:** https://app.parture-team.com (PROD) · https://vorschau.parture-team.com (preview)
Both sit behind Cloudflare Access (one-time e-mail code), then the app's own login.

## Team

| Name | Student number |
|---|---|
| Niko Bratzke | 81079 |
| Alexander Florian Harder | 80896 |
| Embleton Helmut Oscar Weitmann | 79945 |
| Elias Luka Thiele | 73922 |

## Run it locally

Requirements: Node.js 22 (`.nvmrc`). No keys needed: without them every eBay step is a dry run and titles come from the
built-in title help instead of the AI.

```bash
git clone https://github.com/nik1231-alt/Parture-Groupwork.git
cd Parture-Groupwork
npm ci
cp .env.beispiel .env                         # Windows: copy .env.beispiel .env   (leave it empty)
npm run benutzer -- anlegen <your-name>       # asks for a password (at least 10 characters); the first user becomes admin
npm start                                     # http://127.0.0.1:5070
```

The app then uses the team copy of the catalogue in `daten-team/pm.db` (about 1,000 products, public data only).

| Command | What it does |
|---|---|
| `npm test` | all tests (Node's built-in test runner), about 40 seconds; must be green before every pull request |
| `npm run dev` | start with reload on every change |
| `npm run scan` | secret scan over all files (`npm run scan -- --historie` also scans the whole git history) |
| `npm run benutzer -- liste` / `passwort <name>` / `rolle <name> <admin\|builder>` | manage users |
| `npm run sicherung` / `-- liste` / `-- wiederherstellen <file>` | back up or restore `daten/app.db` |
| `npm run export` | build `pm.db` yourself from the eBay API (admin only, needs keys) |

## The pages

| Page | Who | What |
|---|---|---|
| **Products** | everyone | every product with eBay price, eBay sales, impressions and diagnosis; open a row for its variants, its eBay listing, funnel status and full history |
| **Problem** | everyone | live analysis of why the app exists (eBay only): 80 % of eBay sales come from 17.8 % of the eBay listings, 80 % of eBay impressions from 35 % of the listings (20.11.2026); seen × sold for every listing; how impressions are spread |
| **Funnel** | everyone (actions: admin) | KPIs, all products as one bar by status, why products are not eligible, the ladder as a flow, the effect of each phase against the control group, the work queue with the interim result, and a table of all products with their status and the reason for it |
| **Results** | everyone | what each phase did to impressions, against the control group: net effect per phase, impressions over time as an index, before and after, every listing on its own, and a table; until a phase has a result it shows an example with invented figures (clearly marked) |
| **Team** | admin | assign roles |
| **Log** | everyone | the append-only log and the operating status (environment, version, write switches, backup, data age) |
| **Settings** | everyone (save: admin) | every rule value: limits, waiting times, ad rate, price step |
| **Account** | everyone | change your own password |

## The funnel

```
All products
 ├─ Not eligible ── with the reason: enough impressions · too new or no data · no active eBay listing · blocked by a price test
 └─ Eligible ────── low impressions (bottom quarter of the shop), active on eBay, free
      │  "Draw listings by lot": 2 × free places, split in half
      ├─ Control group ── stays unchanged for 49 days (all three waiting times together)
      └─ Phase 1  new title (AI + rule check) ── 14 days ──► seen again? yes ─► leaves ("Seen again")
         Phase 2  eBay ads 10 %             ── 14 days ──► seen again? yes ─► leaves
         Phase 3  price −10 %               ── 21 days ──► seen again? yes ─► leaves
         Phase 4  manual check: an admin decides to rework, take offline or keep (with a reason)
```

- **Seen again** means: impressions per day during the waiting time, scaled to 90 days, are no longer below the diagnosis limit.
- **Net effect** of a phase = (listing after ÷ before) ÷ (control group after ÷ before) − 1, over exactly the same days. If the
  whole shop gets busier, the control group rises too and the net effect stays near zero. From +20 % a phase counts as clearly better.
- **The lot** uses a stored seed, so the same candidates and the same seed always give the same split (`ziehe` in `app/experimente.mjs`).
- **Movement by hand** (default, *Settings → Funnel movement*): products only move when an admin clicks. *Draw listings by
  lot* takes new listings (with control group); on a running card, *Next phase →* or *Seen again ✓* end the waiting time,
  measured up to that day against the control group and kept in the history. The daily run from 6:00 only fetches AI titles.
- **Automatic movement** (optional): the daily run also evaluates finished waiting times, releases controls and draws new
  listings. Neither mode ever changes eBay without an approval.
- **Data:** the company hub exports the catalogue and eBay traffic to the app every hour (whitelist only, see *Data*).
- **Add a listing** (admin): pick any eligible product from a list and put it on step 1 right away, e.g. for a demo.
- After leaving, a product pauses 90 days before it can enter again.

## Changes on eBay

1. A suggestion is ready on the Funnel page: a new title (AI, title help or typed by hand), the ad rate, or the new price.
2. An admin clicks **Approve and change on eBay** (two clicks, so it cannot happen by accident).
3. The app first reads the listing on eBay. If the title or price is not the expected one, nothing is overwritten.
4. It writes only if this computer has eBay keys **and** the switch is on: `EBAY_SCHREIBEN=an` for titles, plus
   `EBAY_WERBUNG=an` for ads and `EBAY_PREIS=an` for prices (they cost money). Otherwise the approval is a **dry run**:
   checked and logged, nothing changed.
5. If eBay refuses, eBay's message is shown at the listing and in the log, and the step stays open.

**AI titles:** Google Gemini suggests three titles; the **rule check** (`app/titel-regeln.mjs`) lets only safe ones through:
no superlatives, seals or price promises, never "Original"; brands only as "passend für …" and only if the old title had
them; no new numbers, sizes or colours; no keyword lists. Tested against all 745 real titles. Without `GOOGLE_API_KEY` the
suggestion comes from the title help, and a hand-typed title must pass the same rule check.

## When something is unavailable

| What fails | What the app does |
|---|---|
| eBay API (down, token expired) | the step fails with eBay's message, stays open, nothing changed; the log shows it |
| Gemini (no key, quota, outage) | the listing gets "no suggestion yet" with the reason, the next run tries again; a title can be typed by hand |
| Nightly data export | the app keeps the last `pm.db` and shows a warning when traffic data is more than 2 days behind |
| The app itself crashes or hangs | the watcher restarts it within seconds |

## Data

```
Parture hub (company data) ──hourly, whitelist only──► pm.db ──read only──► app ──after approval──► eBay
                                                                             └──► app.db (users, ladder, settings, log)
```

- **`pm.db`** holds only public or technical fields: products, their eBay listing (no other marketplaces), images, 30/90-day traffic sums, daily traffic, the
  block list of a running shop experiment. **Never** costs, fees, margins, revenue, customers or addresses: the export checks
  column names and texts before it swaps the file.
- **`app.db`** belongs to the app and lives on the machine that runs it, never in the repository.
- **Data lag of 3 days:** eBay corrects the last days afterwards, so only finished days count.

## Limits

- The app knows no costs, so it cannot tell whether a lower price still pays off; the admin checks that before approving.
- One waiting time takes 14 to 21 days, so the first measured net effect comes two to three weeks after the first approval.
- With only a few listings per phase the net effect is noisy; it gets reliable as more listings pass through.
- Only eBay. Sales and traffic from other marketplaces (shop, Amazon, Etsy) are out of scope on purpose: the hub does not export
  them, and the app neither shows nor evaluates them. Every sales figure in the app is an eBay figure.

## More

- [`docs/architektur.md`](docs/architektur.md): the system on one page, decisions and the alternatives we rejected
- [`docs/tests.md`](docs/tests.md): which test checks what, and what the tests do not cover
- [`docs/walkthrough.md`](docs/walkthrough.md): questions for the repository walkthrough, with answers
- [`docs/sicherheit.md`](docs/sicherheit.md): threats, measures and the test behind each one
- [`docs/entwicklung.md`](docs/entwicklung.md): how the team works (branches, preview, pull requests, reviews)
- [`AGENTS.md`](AGENTS.md): rules for coding agents working in this repository

## Glossary

| Term | Meaning |
|---|---|
| Listing | one eBay offer of the shop, identified by its item number (`external_id`) |
| Impressions | how often eBay showed the listing in search results or recommendations |
| Eligible | low impressions, active on eBay, not blocked, not on the ladder or pausing |
| Control group | listings drawn by lot that stay unchanged, so each phase can be compared against them |
| Phase | one lever of the ladder: title, ads, price, manual check |
| Net effect | change of the listings divided by the change of the control group over the same days, minus 1 |
| Dry run | everything is checked and logged, but nothing is written to eBay |
| Preview / Live | the second copy of the app for trying changes / the real system |
| Watcher | program on the server that deploys new versions after green tests, restarts the app and backs it up |
| Append-only log | entries can be neither changed nor deleted (database trigger) |
