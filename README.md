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
| **Products** | everyone | every product with eBay price, eBay sales, impressions and diagnosis; open a row for its variants, channel reference details, funnel status and full history |
| **Problem** | everyone | live analysis of why the app exists (eBay only): 80 % of eBay sales come from 17.8 % of the eBay listings, 80 % of eBay impressions from 35 % of the listings (20.11.2026); seen × sold for every listing; how impressions are spread |
| **Funnel** | everyone (actions: admin) | KPIs and one tree in which every product sits in exactly one branch (not eligible with its reasons, eligible, drawn → control group / test group → phases, seen again, pausing); a running phase shows its live interim against the control group; click a step to work on it (draw, approve, decide); the effect of each phase, and a table of all products with their status and the reason for it |
| **Results** | everyone | pick a run (the listings started on one day) or all runs: how impressions changed in each phase compared with the control group, and whether the difference is clear or could be chance. While a phase is still in its waiting time the page shows a **live interim** with the real eBay figures so far (marked as interim, updates itself); the example with invented figures (clearly marked) only opens by itself when nothing runs at all. Below, **Day by day**: each phase against the control group as a daily curve, with click rate and sales as guard metrics |
| **Team** | admin | assign roles |
| **Log** | everyone | the append-only log and the operating status (environment, version, write switches, backup, data age) |
| **Settings** | everyone (save: admin) | every rule value: limits, waiting times, ad rate, price step |
| **Account** | everyone | change your own password |

## The funnel

```
All products
 ├─ Not eligible ── with the reason: enough impressions · too new or no data · no active eBay listing · blocked by a price test · already sold on eBay
 └─ Eligible ────── low impressions (bottom quarter of the shop), active on eBay, never sold on eBay, free
      │  "Draw listings by lot": 2 × free places, split in half
      ├─ Control group ── stays unchanged for 19 days (all three waiting times plus 7 days buffer for the decisions)
      └─ Phase 1  new title (AI + rule check) ── 4 days ──► seen again? yes ─► leaves ("Seen again")
         Phase 2  eBay ads 10 %             ── 4 days ──► seen again? yes ─► leaves   (skipped if already advertised)
         Phase 3  price −10 %               ── 4 days ──► seen again? yes ─► leaves
         Phase 4  manual check: an admin decides to rework, take offline or keep (with a reason)
```

- **Seen again** means: impressions per day during the waiting time, scaled to 90 days, are no longer below the diagnosis limit.
- **Net effect** of a phase = (listing after ÷ before) ÷ (control group after ÷ before) − 1, over exactly the same days. If the
  whole shop gets busier, the control group rises too and the net effect stays near zero. From +20 % a phase counts as clearly better.
- **The lot** uses a stored seed, so the same candidates and the same seed always give the same split (`ziehe` in `app/experimente.mjs`).
  Since 21 Nov it draws in **pairs**: the drawn listings are sorted by impressions, neighbours form a pair, and a coin decides which
  of each pair is tested. So both groups get one listing of every size and a strong listing cannot land in one group by chance.
  Results show the balance at the draw (both groups over the 30 days before).
- **Movement by hand** (default, *Settings → Funnel movement*): products only move when an admin clicks. *Draw listings by
  lot* takes new listings (with control group); on a running card, *Next phase →* or *Seen again ✓* end the waiting time,
  measured up to that day against the control group and kept in the history. Before the waiting time is complete the button asks
  "End early after X of Y days? (recorded)": the evaluation is marked as ended early and Results show it, so nobody can quietly
  move on when the numbers happen to look good. The daily run from 6:00 only fetches AI titles.
- **Automatic movement** (optional): the daily run also evaluates finished waiting times, releases controls and draws new
  listings. Neither mode ever changes eBay without an approval.
- **Data:** the company hub exports the catalogue and eBay traffic to the app every hour (whitelist only, see *Data*).
- **Funnel page:** one view built around the tree *Where every product stands*: every product sits in exactly one branch and the
  branches add up to their parent (reasons for not eligible fold out). Each step shows what waits there (*8 to approve*, *2 to
  decide*) and a running phase its live interim (*day 3 of 14 · interim +12 % vs. control*); clicking a step opens just that step
  below the tree with its buttons (draw, approve all, decide). Below: the effect of each phase. Second tab: *All products*.
- **Draw by lot** (admin): you choose how many listings and whether a control group of the same size is drawn. There is no
  upper limit; the preview lists exactly the listings that go into the lot.
- **Already advertised listings skip Phase 2.** The app reads every running Promoted Listings campaign on eBay (every 6 hours
  for the display) and checks the single listing again right before Phase 2; an advertised listing moves straight to the price
  step, so no second ad is created. If eBay cannot be asked, Phase 2 is not approved.
- **Approve** shows whether it writes LIVE to eBay or runs as a dry run. *Approve all N* approves a whole group (titles, or ads and price) at once; ticked rows can be approved as a selection.
  After a change the app reads the listing back and shows what is on eBay now.
- **Take off the ladder / Start over:** a listing that was never changed on eBay is eligible again right away; one that was
  changed pauses 90 days. *Add one specific listing* puts any eligible product on step 1 (without a control partner).

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
them; no new numbers, sizes or colours; no new English words (a word like “Wallmount” stays only if the old title had it); no keyword lists. Tested against all 745 real titles. Without `GOOGLE_API_KEY` the
suggestion comes from the title help, and a hand-typed title must pass the same rule check.

## When something is unavailable

| What fails | What the app does |
|---|---|
| eBay API (down, token expired) | the step fails with eBay's message, stays open, nothing changed; the log shows it |
| Gemini (no key, quota, outage) | the listing gets "no suggestion yet" with the reason, the next run tries again; a title can be typed by hand |
| Nightly data export | the app keeps the last `pm.db` and shows a warning when traffic data is more than 2 days behind |
| The app itself crashes or hangs | the watcher restarts it within seconds |

## Data

Analysis is scoped to the main `ebay` channel. Products without that channel do not enter the product analysis,
diagnosis, prioritisation or new experiments. Sales, current prices and last-sale dates come from its channel rows,
never from the catalogue's totals across platforms. Conversion is eBay units sold divided by eBay views over 90 days.
Traffic sums and daily before/after comparisons accept a row only when both its product number and item ID match
an `ebay` channel row. Unknown IDs and the separate `ebay-ali` account are excluded. Missing channel metrics stay
unknown; they are not replaced by catalogue totals. Catalogue creation date remains product metadata used for the
existing grace period; it is not an eBay listing start date.

Other channels in product details and `/api/kanaele` are reference data only. `/api/live` is a raw catalogue reference
endpoint, not an input to analysis. Older hub catalogues can contain multiple platforms; the bundled eBay exporter
only fetches eBay. Existing saved experiment baselines and historical verdicts are not rewritten by this change;
use newly started measurements for comparisons under the strict channel filter.

```
Parture hub (company data) ──hourly, whitelist only──► pm.db ──read only──► app ──after approval──► eBay
                                                                             └──► app.db (users, ladder, settings, log)
```

- **`pm.db`** holds only public or technical fields: products, their eBay listing (no other marketplaces), images, 30/90-day traffic sums, daily traffic, the
  block list of a running shop experiment. **Never** costs, fees, margins, revenue, customers or addresses: the export checks
  column names and texts before it swaps the file.
- **`app.db`** belongs to the app and lives on the machine that runs it, never in the repository.
- **Data delay:** on PROD the traffic comes from the company hub, which fetches every eBay day **once, on the day after**, and
  not again later; so the newest day is yesterday (header: "traffic up to …", the tooltip says where it comes from). Whether eBay
  still adjusts a day afterwards is not measured (checking it would use the eBay request limit, which the hub already
  exhausts every day). Every evaluation stores the last data day it used (`datenBis`), so it can be reproduced. The app's own
  import (`npm run export`, not used on PROD) waits 3 days and fetches the last 3 days again.

## Limits

- The app knows no costs, so it cannot tell whether a lower price still pays off; the admin checks that before approving.
  As a guard the price step never goes below *Settings → Lowest price the app may set* (default 2.99 €), and an approval
  below it is refused, also for a suggestion made before the floor was raised.
- Waiting times are 4 days per phase since 21 Nov 2026, so the listings pass several phases before the presentation. Four days of
  impressions are noisy: a phase shows an interim and usually "too early to judge". For a real measurement set 14 / 14 / 21 days in
  *Settings* (the earlier defaults); the control group always lasts all three waiting times plus 7 days.
- With only a few listings per phase the net effect is noisy; it gets reliable as more listings pass through.
- Only eBay. Sales and traffic from other marketplaces (shop, Amazon, Etsy) are out of scope on purpose: the hub does not export
  them in new exports. Older catalogues may still show other channels as labelled reference details; these never enter analysis. All performance metrics use eBay only.

## More

- [`docs/architektur.md`](docs/architektur.md): the system on one page, decisions and the alternatives we rejected
- [`docs/tests.md`](docs/tests.md): which test checks what, and what the tests do not cover
- [`docs/walkthrough.md`](docs/walkthrough.md): questions for the repository walkthrough, with answers
- [`docs/fix-checkliste.md`](docs/fix-checkliste.md): the fixes from our own "how would the professor attack this?" review, ticked one by one
- [`docs/sicherheit.md`](docs/sicherheit.md): threats, measures and the test behind each one
- [`docs/entwicklung.md`](docs/entwicklung.md): how the team works (branches, preview, pull requests, reviews)
- [`AGENTS.md`](AGENTS.md): rules for coding agents working in this repository

## German names

The code was started in German, so many file, function, table and setting names are German. They are kept on purpose: the
running server, its database and the Windows tasks use them, and renaming them shortly before the hand-in would risk breaking the live system.
Everything a person reads (interface, messages, documentation, comments, test names) is English. New names are written in English.

| German name | Meaning | Where |
|---|---|---|
| `leiter` | ladder / funnel: the steps a listing goes through (title → ads → price → manual check) | `app/leiter.mjs`, `/api/leiter` |
| `freigabe` | approval by an admin | `app/freigabe.mjs`, `/api/freigaben` |
| `protokoll` | log (append-only) | `app/protokoll.mjs`, `/api/protokoll` |
| `waechter` | watcher: deploys new versions after green tests, restarts the app | `app/waechter.mjs` |
| `sicherung` | backup | `app/sicherung.mjs`, `npm run sicherung` |
| `benutzer`, `rollen`, `login` | users, roles, sign-in | `app/benutzer.mjs`, `app/rollen.mjs`, `app/login.mjs` |
| `einstellungen`, `regeln` | settings, rules (default values) | `app/einstellungen.mjs`, `app/regeln.mjs` |
| `bewertung`, `auswertung`, `ergebnisse` | assessment of a listing, evaluation of a test, results of the phases | `app/bewertung.mjs`, `app/auswertung.mjs`, `app/ergebnisse.mjs` |
| `experimente` | tests with a test and a control group (the "Tests" page) | `app/experimente.mjs` |
| `titelhilfe`, `titel-regeln`, `ki-titel` | title help, title rule checker, AI title suggestions | `app/titelhilfe.mjs`, `app/titel-regeln.mjs`, `app/ki-titel.mjs` |
| `ebay-schreiben`, `export-ebay` | writing to eBay, building `pm.db` from eBay | `app/ebay-schreiben.mjs`, `app/export-ebay.mjs` |
| `benachrichtigung` | notification (Telegram) | `app/benachrichtigung.mjs` |
| `EBAY_SCHREIBEN`, `EBAY_WERBUNG`, `EBAY_PREIS` | switches: writing to eBay, ads, price (each must be `an` = on) | `.env` |
| `PM_UMGEBUNG` | environment: `prod`, `vorschau` (preview) or empty (local) | `.env` |
| `vorschau` | preview (branch and environment) | git, server |
| `Los`, `ziehen` | draw by lot, to draw | tests, ladder |
| `Probelauf` | dry run | approval, ladder |
| `kanal`, `produkt`, `bild`, `sperre`, `stand` | tables of `pm.db`: channel, product, image, block list, state | `daten-team/pm.db` |
| `aenderung`, `erholt`, `ueberarbeiten`, `behalten` | change, recovered ("seen again"), rework, keep | database, ladder |

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
