# What the tests check, and what they do not

`npm test` runs every file below with Node's built-in test runner: **193 tests, all green on `main`**, about 40 seconds
(measured 20.11.2026). CI runs the same command on every pull request. No test talks to the real eBay or Gemini, and no
test touches `pm.db` or `app.db`: each one builds a throwaway database in memory or in a temp folder.

## Which test checks which module

| Module | Test files | Accepted and rejected actions covered |
|---|---|---|
| `leiter.mjs` | `test-leiter.mjs` (13) | intake only of eligible listings; lot with seed and control group; net effect = 0 when the whole shop rises, real effect when only the listing rises; end of the control time; funnel status = candidates of the next run; approval only by admins (403); a title that failed the rule check cannot be approved (400); no overwrite when the title or price on eBay differs; dry run without the switch; variants with different prices are not lowered |
| `titel-regeln.mjs`, `ki-titel.mjs` | `test-titel-regeln.mjs` (8) | superlatives, "Original", new brands, new numbers, keyword lists are refused; all 745 real titles checked; Gemini answer parsed from a fake `fetch` |
| `ebay-schreiben.mjs`, `freigabe.mjs` | `test-freigabe.mjs` (26) | four locks before writing (keys, switch, admin, expected title); eBay errors keep the step open; approvals of at most 50 listings |
| `login.mjs`, `rollen.mjs` | `test-http.mjs`, `test-rollen-http.mjs`, `test.mjs` | wrong password, lockout after failed tries, expired session, changing your own password, there is always one admin |
| `server.mjs` (all routes) | `test-routen-schutz.mjs` (11) | **every** route is read from the source code: without login 401, builder on an admin route 403 (new routes are covered automatically) |
| `server.mjs` (browser safety) | `test-xss.mjs`, `test-fehlerbilder-http.mjs`, `test-betrieb-http.mjs`, `test-durchlauf.mjs` | no `innerHTML`, strict CSP, foreign origin refused, broken JSON refused, a full run from builder to admin through the real server; builder cannot change settings (403) |
| `regeln.mjs`, `einstellungen.mjs`, `bewertung.mjs` | `test.mjs` (51), `test-los.mjs` | diagnosis limits, settings out of range refused, block list, the lot is fair and repeatable |
| `auswertung.mjs`, `demo.mjs` | `test-auswertung.mjs`, `test-demo.mjs` | net effect, outliers, the example verdicts |
| `ergebnisse.mjs`, `ergebnisse-demo.mjs` | `test-ergebnisse.mjs` | runs are evaluated separately, clear increase / clear decrease / no clear effect / too early, same numbers as the Funnel page, the example view |
| `dashboard.mjs` (Results, part “Day by day”) | `test-dashboard.mjs` | status planned / running / final per phase, net effect with the same windows as the ladder, only controls that cover the whole waiting time, aborted and reset starts ignored, daily curve indexed to 100 |
| `traffic.mjs`, `sicherung.mjs`, `waechter.mjs` | `test-traffic.mjs`, `test-sicherung.mjs`, `test-waechter.mjs` | data lag, backup and restore, deploy only after green tests, rollback, restart of a hanging app (in temporary git repositories) |
| `benachrichtigung.mjs`, `titelhilfe.mjs` | `test-benachrichtigung.mjs`, `test-titelhilfe.mjs` | messages only with a token; title help suggests only words that exist |
| `public/` | `test-oberflaeche.mjs` | every visible text is English |

## What the tests do not cover

| Not covered | Why | How we checked it instead |
|---|---|---|
| The real eBay API | a test must never change a real listing | read call against PROD on 20.11. (listing 406390008472, status Active); writes only in a supervised dry run |
| The real Gemini API | costs money and the answer changes every time | one live call on 20.11. (HTTP 200); the parser is tested with recorded answers |
| Layout in the browser (phone width, dark mode) | no browser in CI | screenshots with headless Chrome at 1280 and 400 px, light and dark |
| Whether a phase really brings impressions back | needs weeks of real traffic | that is what the control group on PROD will show; the first result is due one waiting time (4 days since 21 Nov) after the first approval, but four days are noisy |
| Load with many users at once | four users | not tested |
| Removing an ad on eBay (undo, F7) | it would change a real campaign | tested with a recorded writer; the call (`bulk_delete_ads_by_listing_id` on the app's own campaign only) has not run against eBay yet |
| Changes made outside the app (F6) on real data | needs someone to change a listing on eBay | probe on a copy of PROD: the first check noted 20 states and marked nothing; the marking itself is tested with recorded catalogue states |
| Corrections eBay makes to a day afterwards | checking costs the eBay request limit | not measured; every evaluation stores its data day (`datenBis`) |

`benutzer.mjs` has no test of its own: it is a thin command line over `login.mjs` and `rollen.mjs`, whose logic is tested.
