# Fix checklist before the submission

Written on 21 Nov 2026 from a "how would the professor attack this?" review (method, data, real money, AI, operations,
security, tests, team). Each fix names the question it answers, what changes, where, how we know it is done, and its tests.
Items are ticked one after the other in the pull request that does them; the PR number stands next to the tick.

**Deadline:** commits after **Mon 23 Nov 2026, 23:59** are not graded. Every code fix below must be merged and live on PROD
before then. The presentation is on 4 Dec.

Legend: `[ ]` open · `[x]` done · **Who:** Server-KI (code, docs, deploy) or Niko (decisions and anything only the team can do).
Order = the order they are worked on: small and certain first, the large eBay write (undo) last, the walkthrough at the end
so that it describes the final state.

---

## A. Code and docs (Server-KI)

### F1 · One truth about the data delay ✅ (PR #59)
**Question:** "eBay corrects the last days afterwards. Do you measure with uncorrected numbers? Your README says 3 days of
delay, the app header says traffic up to yesterday."

Today: README, `docs/architektur.md`, `docs/server-einrichtung.md`, `docs/server-checkliste.md` and `docs/entwicklung.md`
say "3 days delay". On PROD the app uses the hub export, whose traffic ends **yesterday** (`stand.traffic_bis`, 1 day).
The app's own import (`app/traffic.mjs`, `VERZOEGERUNG_STANDARD`) is not what PROD uses.

- [x] Find out in the hub whether the last days are fetched again after eBay corrected them (traffic warehouse), and how
      large the corrections are (compare a day as first fetched with the same day a few days later).
      *Result: the hub fetches only missing days, every eBay day once on the day after. The size of later corrections cannot
      be measured without spending the eBay request limit, which the hub already uses up every day.*
- [x] Decide and write down the rule: either the hub re-fetches (then 1 day is fine and the docs say so), or the app only
      counts days up to `traffic_bis − N` for evaluations (one named constant).
      *Decision: keep the hub's newest day (yesterday) — a longer delay would cost the phases before 4 Dec — say openly that
      corrections are not measured, and store the data day. Constant `HUB_VERZOEGERUNG = 1` in `app/traffic.mjs`; the
      data-age warning uses it for the hub export (`verzoegerungFuer`).*
- [x] Every evaluation stores the data day it used (`datenBis` in the details of `ausgewertet`), so a result can be
      reproduced later even if corrected numbers arrive.
- [x] Header and Log say the rule in one sentence ("traffic up to 20 Nov · the last N days can still change").
- [x] All five docs and the walkthrough say the same. *(README, architektur, server-einrichtung changed; server-checkliste
      and entwicklung describe the app's own import and stay correct; walkthrough follows in F9.)*
- [x] Test: an evaluation records `datenBis`; if a delay constant is introduced, the effective end day respects it.
      *(test-leiter: automatic and by hand; test-betrieb-http: data age with the hub export.)*

**Done when:** `grep -rn "3 days"` shows no contradiction to what the app does, and the rule is visible in the app.

### F2 · Early move is visible and recorded (no silent peeking) ✅ (PR #60)
**Question:** "You look at the live numbers every day. What stops you from moving on when the numbers look good?"

Today "Next phase →" and "Seen again ✓" work at any time. `schiebeVonHand` already stores `gemessenTage`.

- [x] Before the waiting time is over, the buttons ask once: "This ends the waiting time early after X of Y days. It is
      recorded and shown in Results." (second click confirms, like Approve). *The server refuses an early move without the
      confirmation (409), so it also holds for direct API calls.*
- [x] The evaluation stores `vorzeitig: true` and the planned end day.
- [x] Results and the history show "ended early: X of Y days" at the phase and the listing.
- [x] Protocol entry `ladder_moved` carries `vorzeitig`.
- [x] Tests: early move → `vorzeitig` true with the measured days; move after the end → false. *(test-leiter, test-ergebnisse)*

**Done when:** an early move cannot happen without the user seeing it, and it is visible afterwards.

### F3 · Price floor ✅ (PR #61)
**Question:** "The app knows no costs. What stops Phase 3 from selling below cost?"

Today `baueVorschlag("preis")` lowers by the price step (10 %) and rounds to .49/.99; the admin checks the margin.

- [x] New setting "Lowest price the app may set" (euros, default 2.99, admin only, with help text).
- [x] The price suggestion never goes below it. If the step would fall below, the suggestion says so and the listing can
      only be skipped to the manual check, not approved.
- [x] Right before writing, the approval (`gibFrei`) checks the floor again (a setting changed after the suggestion must still hold).
- [x] The approval card shows old price, new price and the floor.
- [x] Tests: suggestion respects the floor, variants with several prices, approval refused below the floor, setting
      limits (validation).
- [x] Docs: README (Limits, Changes on eBay), Settings description.

**Done when:** no code path can write a price below the floor.

### F4 · AI titles stay German ✅ (PR #62)
**Question:** "The live titles contain ‘Wallmount’ and ‘Circular Saw’. Does that help a German search?"

- [x] Rule check (`app/titel-regeln.mjs`): new English words that were not in the old title are rejected (a short, named
      list of common English listing words such as mount, wallmount, holder, bracket, cover, case, saw, circular, drill),
      with a clear reason.
- [x] The AI prompt says: German only, keep English words only if the old title had them.
- [x] Re-run the rule check against all 745 real titles: no old title is rejected (the check only judges new words).
      *760 eBay titles today; 21 already contain a listed English word; none is rejected against itself.*
- [x] List the live titles that would fail now (No. 2009, No. 405) in the PR, so the team can decide whether to rework them.
      *Finding: none would fail. “Wallmount” (No. 2009) and “Circular Saw” (No. 405) were already in the old titles; the AI
      kept them, it did not invent them. That is the honest answer to the question above.*
- [x] Tests: "Wallmount" new → rejected; "Wallmount" already in the old title → allowed; German compound words unaffected.
      *(test-titel-regeln, including both live titles and the loanwords Set / Cover.)*

**Done when:** a new title with an English word that was not there before cannot be approved.

### F5 · Balanced draw (matched pairs) ✅ (PR #63)
**Question:** "With 10 against 10, one group can be stronger by chance. How do you know the split is fair?"

Today `ziehe` (experimente.mjs) shuffles with a stored seed and splits in half. The ladder draws the top 2n of the sorted
candidates and splits them.

- [x] `ziehe` sorts the 2n drawn listings by impressions in 90 days, forms neighbouring pairs, and a seeded coin decides
      per pair which one goes to the test group. Same seed + same candidates = same split (as before).
- [x] Odd number: the last one goes to the control group, as before (keeps the tested group sizes unchanged).
- [x] Results show the balance before the start: impressions per 90 days of test vs. control for every run.
      *Computed from the daily traffic over the 30 days before the draw day, so the tranche of 20 Nov shows it too.*
- [x] Docs: README "The lot", walkthrough (why pairs). *(walkthrough in F9)*
- [x] Tests: deterministic, every listing exactly once, the difference of the group sums is at most the sum of the pair
      differences (strictly more balanced than the worst case), old title tests (`experimente`) keep working.

**Done when:** new draws are paired and the balance is visible. (The running tranche of 20 Nov stays as it is.)

### F6 · Changes made outside the app are noticed ✅ (PR #64)
**Question:** "What if someone changes a test or control listing on eBay during the waiting time?"

Today the app reads eBay only right before writing. During the waiting time nobody checks.

- [x] At the draw, store a snapshot per listing (title and price from the hub export, table `kanal`): for control
      listings the state at the draw, for test listings the state the app wrote (new title, new price).
      *Taken at the first check after the draw (at most 15 minutes later), and after every title or price change the app made;
      a step done by hand on eBay takes the new state from the catalogue after 2 days.*
- [x] Every hourly data refresh compares the snapshot with `kanal` (no extra eBay calls). *Every 15 minutes and before each
      draw; the catalogue itself is updated by the hub at least once a day, so a change shows up within a day.*
- [x] A difference marks the listing "changed outside the app since <day>": badge on the card and in the funnel tree,
      entry in the history and the protocol.
- [x] Evaluations store the mark; a control listing changed from outside drops out of the control group from that day;
      Results count and name them. *(It drops out of every comparison, not only from that day: the conservative choice.)*
- [x] Tests: control price changed → marked and excluded; test title not the written one → marked; no change → nothing.
      *(test-leiter, 3 tests; probe on a copy of PROD: 20 states noted, 0 false marks.)*

**Done when:** a change made outside the app shows up within a day (the catalogue's rhythm) and cannot silently enter a result.

### F7 · Undo a step on eBay ✅ (PR #65)
**Question:** "A new title performs badly or was a mistake. How do you go back?"

Today the old title and price are in the history, but there is no undo; "take offline" is only a task for the admin.
The eBay writer can set a title, a price and switch an ad on, not off.

- [x] Writer: `entferneWerbung(itemId)` (Marketing API, remove the listing from the app's campaign), dry run without
      credentials or switches, like the other writes.
- [x] Action "Undo on eBay" on a listing whose step was applied: builds the reverse change (title → old title, price →
      old price, ad → removed) as a suggestion that needs the same two-click approval.
      *Done as one action that undoes everything the app changed, last change first, behind the two-click confirmation
      (admin only, checked in the server).*
- [x] Read before write: undo only if eBay still shows what the app wrote; otherwise nothing is overwritten and the
      message says what is on eBay now.
- [x] After undo: the listing leaves the ladder as "undone", pauses like other leavers, the phase measurement is marked
      cancelled and does not enter Results. History and protocol (`ladder_undone`) keep both changes.
- [x] VORSCHAU shows it as a dry run. *(VORSCHAU has no write switches, so every undo there is a dry run.)*
- [x] Tests: undo title / price / ad, mismatch refuses, builder gets 403, dry run without switches, the listing leaves
      the measurement. *(test-leiter +3, test-rollen-http +1)*
- [x] Docs: README (Changes on eBay), security doc (new write path), walkthrough. *(walkthrough in F9)*

**Done when:** every change the app can make on eBay can be undone through the app, with approval and a record.

### F8 · Limits written down honestly
**Question:** "What are the limits of your method?"

- [ ] README "Limits" and `docs/tests.md` name: 4-day waiting times are noisy; carry-over (a title can still work when the
      ads start); spill-over (test listings could take impressions from others, unlikely with 10 of 760 but unproven);
      only listings that never sold; the top of the eligible list is drawn, not a random sample of all eligible ones;
      one server; the app knows no costs (floor from F3 is a guard, not a margin check).
- [ ] Each limit has one sentence on what we would do with more time.

### F9 · Walkthrough with the hard questions
**Question:** all of the above, asked to any member.

- [ ] `docs/walkthrough.md`: the professor's questions from the review, grouped by angle, each with the short answer and
      the honest limit, pointing to the file that shows it.
- [ ] Written last, so it describes the final state after F1–F8.

---

## B. Only the team can do these (Niko)

- [ ] **S1 Repo public.** Decide about the old history (an early team copy of `pm.db` had units of all channels; no costs
      or personal data; the secret scan is clean). Settings → Danger zone → Change visibility.
- [ ] **S2 Branch protection** once public (free then): main requires a pull request and the `tests` check, no force push.
      Server-KI can set it with the API after S1.
- [ ] **S3 Access for the teaching staff:** Cloudflare Zero Trust → Access → "Groupwork PROD (parture)" → policy
      "Parture Groupwork" → Include → *Emails ending in* `@novasbe.pt`. Plus a demo account with role builder
      (Server-KI can create it; the password goes into the Moodle comment, never into the repo).
- [ ] **S4 Moodle:** one member submits the repository link before Mon 23 Nov, 23:59.
- [ ] **S5 Elias' git identity:** `git config user.name` / `user.email` set to his GitHub account before his next commit.
- [ ] **S6 Access files:** delete `C:\parture\zugang-*.txt` on the server once the three members have their passwords.
- [ ] **S7 Everyone reads F9** and can explain data path, net effect, control group and the approval path without notes.

## C. Running the funnel until 4 Dec (admin in the app)

- [ ] **Tue 25 Nov:** Phase 1 is due → "Next phase →" for all, then "Approve all" for ads (or price for listings that are
      already advertised). Check prices against costs before approving.
- [ ] **Sun 30 Nov:** Phase 2 is due → "Next phase →", check and approve the prices.
- [ ] **Optional now:** a second tranche (10 + 10) for more listings per phase.
- [ ] **3 Dec:** dry run of the demo on PROD (read only) and on VORSCHAU (clicks), following `docs/vorfuehrung.md`.
- [ ] **4 Dec:** Phase 1 and 2 measured, Phase 3 live with its interim.
