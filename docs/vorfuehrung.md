# Demo and architecture (one page)

## The idea in three sentences

We improve the **visibility (impressions)** of eBay listings of the shop `partureshop` through **title tests**: the app draws a test and a control group by lot, a builder enters new titles, **Niko approves**, and only then does the app change the titles on eBay. After the waiting time it compares both groups and says "better", "no difference proven" or "worse", with sales as a safety figure. Everything can be traced in the log.

## Architecture

```
Builders (3) and admin (Niko)
        │  browser
        ▼
Cloudflare Access (e-mail code) ──► Cloudflare Tunnel ──► server laptop
                                                          ├─ PROD     (main, with eBay keys)  ──► eBay APIs (Trading, Analytics, Fulfillment)
                                                          └─ PREVIEW  (vorschau, without keys)
GitHub ──► watcher ──► only after passing tests ──► PROD  /  branch vorschau ──► PREVIEW
```

Why this way:
- **Two roles, enforced on the server:** builders propose, only the admin approves. The keys exist only on PROD.
- **Nothing unchecked on PROD:** pull request, review, automatic tests, and only then auto-deploy.
- **Nothing overwritten:** before every change the app reads the current title; if it differs, nothing happens. Limit of 50 changes per approval. Dry run as long as the write switch is off.
- **Complete log:** append-only, the database forbids changing and deleting.
- **Clean data:** traffic only from finished days (3 days delay), the last days re-checked, control against the account total, a warning when the data is behind.
- **Operation:** daily backup with a tested restore, the watcher restarts the app after a crash, a Telegram message to Niko.

## Demo run (about 8 minutes)

| # | Show | What to say |
|---|---|---|
| 1 | *Listings* page, filter "Low impressions" | "Of about 740 listings, buyers hardly see many. The app shows which ones and why." |
| 2 | Header: **LIVE**, data age, "traffic up to" | "The figures come automatically from the eBay API every day, always with 3 days delay so that they are final." |
| 3 | *Tests* → "Draw a new test" | "By lot: one half gets new titles, the other half stays as a comparison. That shows whether it is the title and not the month." |
| 4 | Log in as **builder**, enter titles (show the title help), "Send for approval" | "The builder cannot change anything on eBay, only propose." Niko gets a Telegram message. |
| 5 | As **admin** → *Approvals*, old and new title side by side, "Approve" | "Only now does the app write to eBay. Before that it checks that the title is still the expected one." |
| 6 | On eBay: the title is changed (in a second window) | "A real change, with Niko's access, only after approval." |
| 7 | *Log* | "Who proposed, approved, changed what and when: cannot be changed afterwards." |
| 8 | *Tests* → "Show an example verdict" | "A real verdict needs 30 days plus data delay. This is what it looks like: better, no difference, worse, with sales as the safety figure." |
| 8b | *Ladder*: the funnel at the top, a card with an AI title (old/new, discarded suggestions with the reason), a running step with progress, open the history | "What the test proves in the small, the ladder does in everyday use: first the title, then ads, then price, and if nothing helps, a person takes a look. The AI writes, the rule checker throws out everything that could draw a warning letter, and Niko has to approve." |
| 9 | Briefly: open the PREVIEW (badge **PREVIEW**), `docs/entwicklung.md` | "Everyone keeps building: push to `vorschau`, visible after 1 to 2 minutes, by pull request and tests to PROD." |

Fallback plan if the network or the server fails: record screenshots of steps 1 to 8 and a screen video beforehand; locally the app also runs without internet with the team copy of the data (`npm start`).

## Name these openly (comes up in questions)

- A real test verdict is not available within the project time (waiting time plus data delay), hence the example verdict with invented figures, clearly marked as such.
- eBay can refuse title changes for listings with sales; the app then shows eBay's message and changes nothing.
- The title help delivers only evidence-based hints from the own data and only when a pattern is clearly visible. It invents no titles.
- Correlation is not proof: that is exactly why there is the group comparison.

## Before and during a real test

- **Do not touch the Shopify titles of the test products** (B1.5): the Parture hub copies every title change in the Shopify shop to eBay within 10 minutes and would overwrite the test title. Lion is informed.
- Blocked listings (table `sperre` in `pm.db`, today the 50 listings of the price-decrease test until 1 Dec) go into no draw.
- Fill in the revert plan before the switch is turned on: [`belege/revert-plan.md`](belege/revert-plan.md).

## Who built what (A5.8, say it openly)

- **Group:** idea and subject core: diagnosis rules, test with a control group, approval flow, login and roles, evaluation with charts, interface.
- **Server AI** (Claude, in Git as "Parture Server-KI" and recognisable by `Co-Authored-By`): server operation (two environments, Cloudflare, watcher, backup), the nightly data export from the hub and, for the hand-in on 22 Nov, part of the tests (route protection, end-to-end run), the security and architecture docs and the clean-up work from the checklist.
- The exact shares are shown by `git shortlog -sn` (with `.mailmap`, one name per person). **The group should check and adjust this list before the demo**: what is written here must be true.

## Questions and answers (B4, two sentences each, one person responsible)

| # | Question | Answer | Who |
|---|---|---|---|
| 1 | Why no framework? | About 4,300 lines with a single dependency, no build step, every line readable. The price: we wrote routing and sessions ourselves, and they are tested. | … |
| 2 | Why SQLite? | One file that is replaced atomically at night, triggers for the log, no database server to run. With five users nothing bigger is needed. | … |
| 3 | Why no costs, no profit, no customers? | The shop's export gives out only a whitelist of public fields; that is a company rule. That is why we phrase the task around impressions, quantity and price. | … |
| 4 | How is it ensured that a builder changes nothing on eBay? | The server checks the role on every request, with a test for every route; the keys exist only on PROD, and writing happens only with the switch. Before every change the app reads the title, and everything is in the log. | … |
| 5 | What if eBay refuses? | The app shows eBay's message on the proposal and in the log. Nothing is changed then. | … |
| 6 | Correlation or cause? | The draw with a control group separates the title effect from season and eBay fluctuations; sales are a safety figure, the mark is +20 %. A real verdict needs 30 days, we show the interim state after x days and the example verdict. | … |
| 7 | What did the AI do, what did the group do? | See the section above, openly and with Git figures. | Niko |
| 8 | What about another month? | Automatic verdict after 30 days, title help with more data, more channels. | … |
| 9 | How did you work together? | One branch per task, pull request with review, CI with tests and secret scan, preview after a minute, PROD only through `main`. Name the figures from `git shortlog -sn`. | … |
| 10 | How do you protect credentials? | `.env` and databases are git-ignored, the secret scan checks every file and the whole history, the keys exist only on PROD. In front sits Cloudflare Access, and the app checks its token as well. | … |

## Speaker roles (B3.2, to be filled in by the group)

| Step | Who speaks |
|---|---|
| 1–2 Listings, data age | … |
| 3–4 Draw a test, titles as builder | … |
| 5–7 Approval, eBay, log (admin) | Niko |
| 8–9 Verdict, teamwork | … |
