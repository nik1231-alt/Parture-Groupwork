# Welcher Test prüft welches Modul (Checkliste A4.1)

Stand 19.11.2026, ermittelt aus den Importen der Testdateien (`app/test*.mjs`) auf dem zusammengeführten Stand der
offenen Pull Requests (#11, #12, #29, #30). `npm test` führt alle aus, 172 Tests, ca. 37 s.

| Modul | Testdateien |
|---|---|
| `auswertung.mjs` | `test-auswertung.mjs` |
| `benachrichtigung.mjs` | `test-benachrichtigung.mjs` |
| `bewertung.mjs` | `test.mjs`, `test-los.mjs` |
| `demo.mjs` | `test-demo.mjs`, `test-auswertung.mjs` |
| `ebay-schreiben.mjs` | `test-freigabe.mjs` (echter Schreiber mit Ersatz für `fetch`, Riegel 1–4) |
| `einstellungen.mjs` | `test.mjs`, `test-freigabe.mjs`, `test-auswertung.mjs`, `test-routen-schutz.mjs` |
| `experimente.mjs` | `test.mjs`, `test-los.mjs`, `test-freigabe.mjs`, `test-auswertung.mjs` |
| `export-ebay.mjs` | `test.mjs` (keine Kundendaten: liest aus Bestellungen nur Artikel, Menge, Preis, Datum) |
| `freigabe.mjs` | `test-freigabe.mjs` |
| `login.mjs` | `test.mjs`, `test-http.mjs` und alle HTTP-Tests |
| `protokoll.mjs` | `test-freigabe.mjs` (nur anhängen, Trigger) |
| `regeln.mjs` | `test.mjs`, `test-los.mjs`, `test-freigabe.mjs`, `test-titelhilfe.mjs`, `test-demo.mjs`, `test-auswertung.mjs`, `test-durchlauf.mjs` |
| `rollen.mjs` | `test-freigabe.mjs`, `test-rollen-http.mjs`, `test-routen-schutz.mjs`, `test-durchlauf.mjs` |
| `server.mjs` | `test-http.mjs`, `test-rollen-http.mjs`, `test-routen-schutz.mjs`, `test-xss.mjs`, `test-betrieb-http.mjs`, `test-fehlerbilder-http.mjs`, `test-durchlauf.mjs` (echter Server, Wegwerf-Datenbank) |
| `sicherung.mjs` | `test-sicherung.mjs` |
| `titelhilfe.mjs` | `test-titelhilfe.mjs` |
| `traffic.mjs` | `test-traffic.mjs`, `test-betrieb-http.mjs` |
| `waechter.mjs` | `test-waechter.mjs` (Ausrollen, Rückfall, Absturz, hängende App, in temporären Git-Repos) |
| Oberfläche `public/` | `test-oberflaeche.mjs` (nur Englisch), `test-xss.mjs` (kein `innerHTML`, CSP) |

## Ausnahmen

| Modul | Warum ohne eigenen Test |
|---|---|
| `benutzer.mjs` | dünne Kommandozeile (Passwort verdeckt abfragen, Argumente lesen) über `login.mjs` und `rollen.mjs`; deren Logik ist getestet |

Was ohne automatischen Test bleibt: die Rückkehr an dieselbe Stelle nach abgelaufener Sitzung in der Oberfläche (nur im
Browser prüfbar, Screenshot-Beleg A1.10) und die Telefonbreite (gemessen mit Edge headless bei 400 und 360 px, A1.12).
