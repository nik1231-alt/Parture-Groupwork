# Repository walkthrough: questions and answers

The staff open the repository and ask high-level questions; any member can be asked about any part. Each answer below
points to the file where it can be shown. Read it once together, then let every member explain one block out loud.

## How is it built?

**What does the app do, in one sentence?**
It finds eBay listings that buyers rarely see, moves them through three levers (title, ads, price) and measures each step
against a control group, with an admin approving every change. → `README.md`, page *Funnel*

**Where is the data stored?**
Two SQLite files. `pm.db` is the catalogue: written every hour by the company hub with a whitelist of public fields, opened
read-only by the app. `app.db` belongs to the app: users, sessions, settings, ladder state, log. Neither is in the
repository; locally the app uses the team copy `daten-team/pm.db`. → `app/server.mjs` (`mitDb`, `appDb`), `docs/architektur.md`

**How does a request flow through the app?**
`app/server.mjs`: Cloudflare Access check → session cookie → role → route. GET routes read, POST routes change; every
change that matters writes a log entry. → the `ROUTEN` and `POST_ROUTEN` blocks and `adminNoetig`

**Why no framework?**
One dependency, no build, every line explainable. The price is that routing and sessions are written by hand, which is why
they have their own tests. → `docs/architektur.md`, table *Decisions*

## Why was it built that way?

**Why a control group?**
Impressions change with season and with eBay itself. Comparing a listing only with its own past would credit every busy
December to the new title. The control group stays unchanged over the same days, so the net effect shows what the phase did.
→ `app/leiter.mjs` (`nimmAuf`, `werteAus`), test *Saison vs. echter Effekt* in `app/test-leiter.mjs`

**Why is the lot reproducible?**
The seed is stored in the history of each listing. Same candidates and same seed give the same split, so anyone can check
that nobody picked the groups by hand. → `ziehe` in `app/experimente.mjs`

**Why title, then ads, then price?**
Cheapest first: a title costs nothing, ads cost only when something sells, a lower price costs margin on every sale.

**Why can the AI not change titles itself?**
One wrong word ("Original", a brand that is not ours) can mean a legal warning for the shop. The rule check removes those
words, and a human approves. → `app/titel-regeln.mjs`, `app/test-titel-regeln.mjs`

**How do you make sure nothing goes wrong on eBay?**
Four locks: keys on the machine, the switch in `.env`, an admin approval, and a fresh read of the listing right before
writing (if title or price is not what the app expects, it writes nothing). → `app/leiter.mjs` (`fuehreAus`), `app/test-leiter.mjs`

## What are its limits?

**What do the tests cover, and what not?**
283 tests: accepted and rejected actions for every module, every route without login and with the wrong role. Not covered:
the real eBay and Gemini APIs, the layout in a browser, real impression effects. → `docs/tests.md`

**What happens if eBay or Gemini is unavailable?**
eBay: the step fails with eBay's message, stays open and nothing changes. Gemini: the listing shows "no suggestion yet" with
the reason, the next run tries again, or a title can be typed by hand. → `README.md`, *When something is unavailable*

**What can the app not know?**
Costs. So it cannot judge whether a lower price still pays off: the admin checks that before approving the price step.

**How long until you know whether it works?**
One waiting time: 4 days per phase since 21 Nov (to reach several phases before the presentation), plus one day until the eBay figures of the last day are in. Four days and few listings per phase make the numbers noisy, so the app shows an interim and "too early to judge"; 14 / 14 / 21 days in Settings measure more reliably. The control group lasts all three waiting times plus 7 days, because each next phase starts only when an admin decides.

## How could it change?

- **More levers:** a new phase is one entry in `STUFEN` and one branch in `fuehreAus` (e.g. new photos).
- **Other marketplaces:** the funnel logic is marketplace-neutral; only `ebay-schreiben.mjs` would need a sibling.
- **Automatic approval for small steps:** technically one condition in `gibFrei`; deliberately not done, a human decides.
- **Statistics:** the verdict already uses a 95 % range per listing (`schaetze` in `app/ergebnisse.mjs`); with more listings
  the +20 % mark (`besserAb`) could become a pre-registered minimum effect with a planned sample size.

## The hard questions (our own review, 21 Nov)

We asked ourselves how the professor could attack the app and fixed what we could (`docs/fix-checkliste.md`, F1–F9).
Short answer first, then the honest limit, then where to show it.

### Method and statistics

**"You picked the listings with the fewest impressions. Won't they rise anyway?"** (regression to the mean)
Yes, and that is why the control group is drawn from the same pool: it rises too, and only the difference counts.
→ `app/leiter.mjs` (`kontrollVergleich`), README *The funnel*

**"How do you know it was the title and not Christmas or an eBay change?"**
The control group runs over exactly the same days. Net effect = (test after ÷ before) ÷ (control after ÷ before) − 1.
→ `netto` in `app/auswertung.mjs`

**"With 10 against 10, one group can be stronger by chance."**
Since 21 Nov the lot draws in pairs of similar listings and a coin decides within each pair; Results show the balance at the
draw (both groups over the 30 days before). Limit: the tranche of 20 Nov was split before that, its balance is shown too.
→ `ziehe` in `app/experimente.mjs`, `ausgleich` in `app/ergebnisse.mjs`

**"Four days and ten listings — is anything significant?"**
No, and the app says so: a 95 % range per listing, a verdict only from 5 listings with data, otherwise "interim" or "too early to
judge". The 4 days are chosen so the listings pass several phases before 4 Dec, not because they are the right length.
→ `schaetze`, `urteil` in `app/ergebnisse.mjs`, README *Limits*

**"You look at the live numbers every day. Isn't that p-hacking?"** (peeking)
We move on at dates fixed in advance (25 Nov, 30 Nov). Moving on before the waiting time is complete needs a confirmation
("End early after X of Y days? (recorded)"), the server refuses it otherwise, and Results show every early end.
→ `schiebeVonHand` in `app/leiter.mjs`

**"Phase 2 starts after Phase 1. Isn't the ads effect mixed with the title effect?"**
Each phase is measured against its own 30 days before, so it shows what was added on top. Limit: if the title is still
working, part of that is credited to the ads (carry-over). → README *Limits*

**"Why +20 %? Why impressions and not sales?"**
+20 % is a setting fixed before the test, not after. Most of these listings never sold, so sales are too rare to measure
in weeks; impressions come first. Sales and click rate run along as guard figures in *Day by day*.

### Data

**"Where does the data come from and how fresh is it?"**
The company hub exports the catalogue and eBay traffic every hour (whitelist only). It fetches every eBay day once, on the day
after, so the newest day is yesterday; the header says so. Every evaluation stores the data day it used (`datenBis`).
Limit: whether eBay corrects a day later is not measured. → README *Data*, `app/traffic.mjs` (`HUB_VERZOEGERUNG`)

**"What if someone changes a test or control listing on eBay during the waiting time?"**
The app notes the expected title and price of every listing on the ladder and compares it every 15 minutes with the
catalogue. A difference is marked on the card, in the tree, the history and the log; a control listing changed from outside
drops out of the control group. Limit: the catalogue is updated about once a day. → `pruefeFremdaenderungen` in `app/leiter.mjs`

### Real changes, real money

**"The app knows no costs. What stops it from selling below cost?"**
An admin checks the margin, and as a guard the price never goes below *Lowest price the app may set* (Settings); an approval
below it is refused even for an older suggestion. Limit: the floor is a guard, not a margin check. → `baueVorschlag`, `gibFrei`

**"A change was a mistake. How do you go back?"**
*Undo on eBay* (admin, two clicks) puts back everything the app changed, the last change first: price, ad (only from the app's
own campaign), title. Read before write, dry run without switches, and the listing leaves the ladder.
→ `macheRueckgaengig` in `app/leiter.mjs`, `entferneWerbung` in `app/ebay-schreiben.mjs`

**"Two admins click Approve at the same time?"** One eBay write per listing at a time: a second click during the eBay call gets
"being changed right now" instead of writing twice (Approve, Approve all and Undo share the lock); *Approve all* reports every
listing separately. → `mitSperre` in `app/server.mjs`, lock in `app/listing-lock.mjs`, test `app/test-listing-lock.mjs`

### AI titles

**"What if the AI invents a compatibility or adds English words?"**
The rule check allows no new brands, numbers, sizes, colours or English words; brands only after "passend für". "Wallmount" and
"Circular Saw" in two live titles came from the old titles, the AI kept them. → `app/titel-regeln.mjs`

### Operations and security

**"It all runs on one laptop?"** Yes: watcher with restart, auto-deploy only after green tests, daily backup with a tested
restore. No second machine (README *Limits*).

**"A bad commit goes straight live?"** Only through a pull request with green CI, and the server tests again before it deploys.
Branch protection on GitHub is active since the repository became public on 23 Nov 2026.

**"How is access protected?"** Cloudflare Access (e-mail code) plus the app login: scrypt passwords, lock after 5 failed
attempts per name and 20 per address, HttpOnly + SameSite=Strict cookie, foreign origins rejected, roles checked in the server.
→ `docs/sicherheit.md`

### The team

**"Who wrote this?"** We used AI assistance, and we say so; every member can explain the data path, the net effect, the
control group and the approval path. The commit history shows who merged what.
