# Demo and architecture (one page)

Presentation: **4 Dec 2026**, live on the deployed app (slides or a video do not replace it), followed by the repository
walkthrough. This page is the run sheet; the answers to the staff's questions are in [`walkthrough.md`](walkthrough.md).

## The idea in three sentences

Many eBay listings of the shop `partureshop` are hardly ever shown to buyers. The app finds them, draws a test and a control
group by lot, and moves the test listings through three levers (**new title**, **ads**, **lower price**); nothing changes on
eBay until **an admin approves** it. Every phase is measured against the control group over the same days, and everything
lands in a log that cannot be edited.

## Architecture

```
Builders (3) and admin (Niko)
        │  browser
        ▼
Cloudflare Access (e-mail code) ──► Cloudflare Tunnel ──► server laptop
                                                          ├─ PROD     (main, eBay keys, write switches)  ──► eBay APIs
                                                          └─ PREVIEW  (vorschau, always a dry run)
Company hub ──hourly, whitelist only──► pm.db (read only)
GitHub ──► watcher ──► only after passing tests ──► PROD  /  branch vorschau ──► PREVIEW
```

Why this way:
- **Two roles, enforced on the server:** builders see everything, only the admin approves. Every route has a test for the wrong role.
- **Four locks before eBay changes:** keys on the machine, the switch in `.env`, an admin approval, a fresh read of the listing.
- **Nothing overwritten:** if title or price on eBay is not what the app expects, it writes nothing.
- **Complete log:** append-only, a database trigger forbids changing and deleting.
- **Honest data:** the newest traffic day is yesterday, the header says "traffic up to …", every evaluation stores its data day.
- **Operation:** watcher restarts the app, deploys only after green tests, daily backup with a tested restore.

## Demo run (about 8 minutes)

| # | Show | What to say |
|---|---|---|
| 1 | **Problem** page | "80 % of the eBay sales come from under a fifth of the listings. Most listings are hardly seen. That is the problem." |
| 2 | **Products**: header with **LIVE**, "traffic up to …"; open one row | "Every product with eBay price, sales, impressions and a diagnosis. The data comes from the shop every hour; the newest day is yesterday." |
| 3 | **Funnel**: the tree *Where every product stands* | "Every product sits in exactly one branch. Not eligible, with the reason. Eligible. Drawn by lot into control and test group." |
| 4 | Click the running phase: old and new title, the discarded AI suggestions with the reason | "The AI suggests, the rule check throws out everything risky: no 'Original', no new brands, sizes or English words." |
| 5 | Signed in as **builder** (second browser): the same step without buttons; then try the approval anyway | "A builder cannot approve. Hiding the button is not the permission: the server answers 403." |
| 6 | As **admin**: *Next phase →* / *Approve* (shows **LIVE** or dry run), then the listing on eBay in a second window | "Only now does the app write, after reading the listing again. A real change on a real shop." |
| 7 | **Results**: pick the run of 20 Nov, net effect per phase, balance at the draw, *Day by day* | "Test against control over the same days. If the whole shop gets busier, the control rises too and the net effect stays near zero. With 10 against 10 and 4 days the app says 'interim' or 'too early', and so do we." |
| 8 | **Log** and operating status | "Who approved and changed what and when. Cannot be edited afterwards." |
| 9 | **Settings**: enter an invalid value (a waiting time of 1 day) | "Rejected with a clear message. Every rule value has limits, checked on the server." |
| 10 | Briefly the **PREVIEW** (band "nothing here changes eBay") | "Everyone tries changes here first. PROD only gets what passed the tests on `main`." |

Before the demo, each of these steps is done once on the deployed app, in this order, with the accounts that will be used.

## If something fails (decide before, not during)

On the server, `npm run demo-check` in `C:\parture\prod` asks the first rows of this table at once (app, version, watcher, data,
backup, eBay, AI key) and prints one green or red line each. It reads only. The browser sessions and the room network stay manual.

| Dependency | Check on the day | Fallback |
|---|---|---|
| Server laptop / app | `https://app.parture-team.com/healthz` answers, version = `main` | PREVIEW (`vorschau.parture-team.com`); if both are down, the local app on the demo laptop (`npm start`, team copy of the data, dry run) |
| Cloudflare Access | both browser profiles have a valid session (sign in the evening before and in the morning) | the local app on the demo laptop |
| App login | admin and builder account signed in, in two browsers | `npm run benutzer -- passwort <name>` on the server |
| eBay API | step 6 once on PREVIEW as a dry run | show the dry run and the log entry; the listings changed on 20 Nov are live on eBay and can be shown there |
| Gemini (AI titles) | one listing with a fresh suggestion | the titles already suggested are stored; say that a title can be typed by hand and passes the same rule check |
| Hourly data export | header "traffic up to" shows yesterday | the app keeps the last `pm.db` and shows the warning; say so |
| Network in the room | open every tab before our slot | phone hotspot; the screenshots in `docs/belege/screens/` |

If something breaks during the demo: say in one sentence what happened, and go on with the next step.

## Name these openly (comes up in questions)

- Four days and ten listings per group prove nothing yet; the app shows an interim and says "too early to judge". The waiting
  times were shortened so that the listings pass several phases before 4 Dec.
- The first tranche (20 Nov) was split before the lot drew in pairs; its balance at the draw is shown in Results.
- The app knows no costs. The price floor is a guard, the admin checks the margin.
- Removing an ad on eBay (part of *Undo*) is tested with a recorded writer and has not run against eBay yet.
- Stack: plain Node.js instead of Python with Streamlit, agreed with the teaching staff; say why (`docs/architektur.md`) and
  what it cost us.

## Before and during the real run

- **Do not touch the Shopify titles of the listings in the funnel:** the shop's own system copies a title change in the Shopify
  shop to eBay within minutes and would overwrite the test title.
- Blocked listings (table `sperre` in `pm.db`, the listings of a running price test of the shop) go into no draw.
- Dates: **25 Nov** Phase 1 → next phase, **30 Nov** Phase 2 → next phase, **4 Dec** Phase 3 live with its interim.
- **3 Dec:** full rehearsal on PROD (read only) and on PREVIEW (clicks). No merges on 3 Dec.

## Who built what (say it openly)

- **Group:** the idea and the subject core: the problem analysis, the diagnosis rules, the funnel with a control group, the
  approval path, the results pages, the eBay-only scope, the interface texts.
- **AI agents** (allowed in this course; in Git as "Parture Server-KI" or recognisable by `Co-Authored-By`): the server
  operation (two environments, watcher, backup; specified and directed by Niko, including the access through Cloudflare), the hourly data export, a large part of the tests and the documentation, and
  the fixes from our own review (`docs/fix-checkliste.md`).
- Commits on `main` at the hand-in: see `git shortlog -sn`. Most commits come from Niko and the server agent; the other
  three members contributed through their own pull requests (#3, #45, #47, #48/#55, #54 and those after this page was written).
- **Reviews:** until the hand-in almost every pull request was merged by its author without a review recorded on GitHub. CI
  (tests and secret scan) ran on each one, and the server tests again before it deploys. From the hand-in on, a pull request is
  merged only after another member approved it, and `main` is protected.

**The group checks this section before the demo: what is written here must be true.**

## Speaker roles (to be filled in by the group)

| Step | Who speaks | Who clicks |
|---|---|---|
| 1–2 Problem, Products | … | … |
| 3–4 Funnel tree, AI title and rule check | … | … |
| 5–6 Builder refused, admin approves, eBay | Niko (admin) | … |
| 7 Results | … | … |
| 8–10 Log, invalid input, PREVIEW and teamwork | … | … |

Walkthrough: every member takes one block of [`walkthrough.md`](walkthrough.md) (*How is it built · Why that way · Limits ·
How could it change*) and can answer the other three as well.
