# Repository walkthrough: questions and answers

The staff open the repository and ask high-level questions; any member can be asked about any part. Each answer below
points to the file where it can be shown. Read it once together, then let every member explain one block out loud.

## How is it built?

**What does the app do, in one sentence?**
It finds eBay listings that buyers rarely see, moves them through three levers (title, ads, price) and measures each step
against a control group, with an admin approving every change. → `README.md`, page *Funnel*

**Where is the data stored?**
Two SQLite files. `pm.db` is the catalogue: written every night by the company hub with a whitelist of public fields, opened
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
193 tests: accepted and rejected actions for every module, every route without login and with the wrong role. Not covered:
the real eBay and Gemini APIs, the layout in a browser, real impression effects. → `docs/tests.md`

**What happens if eBay or Gemini is unavailable?**
eBay: the step fails with eBay's message, stays open and nothing changes. Gemini: the listing shows "no suggestion yet" with
the reason, the next run tries again, or a title can be typed by hand. → `README.md`, *When something is unavailable*

**What can the app not know?**
Costs. So it cannot judge whether a lower price still pays off: the admin checks that before approving the price step.

**How long until you know whether it works?**
One waiting time: 14 days for the title, plus the 3-day data lag. Few listings per phase make the first numbers noisy.

## How could it change?

- **More levers:** a new phase is one entry in `STUFEN` and one branch in `fuehreAus` (e.g. new photos).
- **Other marketplaces:** the funnel logic is marketplace-neutral; only `ebay-schreiben.mjs` would need a sibling.
- **Automatic approval for small steps:** technically one condition in `gibFrei`; deliberately not done, a human decides.
- **Statistics:** with more listings, a significance test could replace the fixed +20 % mark (`besserAb` in `regeln.mjs`).
