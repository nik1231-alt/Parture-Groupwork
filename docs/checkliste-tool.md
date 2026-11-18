# Checkliste: das Tool bis zur Abgabe und Vorführung

Stand 18.11.2026, gemessen am Repo (main = b4435b1, vorschau = 4213d27) und auf dem Server. Jeder Punkt hat eine
Zuständigkeit, einen **Beleg** (woran man sieht, dass er erledigt ist) und einen Termin. Wer einen Punkt erledigt,
hakt ihn hier ab und nennt im Pull Request die Nummer (z. B. „A3.4“). Die Zuordnung an Personen ist ein Vorschlag:
in der Gruppe verteilen, aber jeder Punkt braucht genau einen Namen.

| Termin | Was |
|---|---|
| **22.11.2026** | Abgabe: Code steht. Danach nur noch Fehlerbehebung, Doku, Probe. Keine neuen Funktionen. |
| 23.11. bis 03.12. | eBay-Live-Weg, echter Testlauf mit Daten, Generalprobe. |
| **04.12.2026** | Vorführung (ca. 8 Minuten, Ablauf in `docs/vorfuehrung.md`). |

Der Kurs bewertet: **Code-Qualität und Tests, Git-Zusammenarbeit, Funktion und Oberfläche, Präsentation und Doku,
Sicherheit.** Die Abschnitte A1 bis A6 folgen genau diesen fünf Kriterien plus dem Datenweg.

## Abgearbeitet am 19.11.2026 (Server-KI, im Auftrag von Niko)

Alles liegt als Pull Request bereit und zusammen auf VORSCHAU (Stand `df0ccd8`, 172 Tests grün). **Gemergt nach `main`
ist noch nichts**: das macht die Gruppe nach Review (A5.2). Reihenfolge zum Mergen: #10 → #11 → #29 → #30, dann #12, #13, #14.

| Punkt | Stand | Beleg |
|---|---|---|
| A1.3, B1.4 Los reproduzierbar, gleich groß, nichts doppelt, Sperrliste, nur laufende eBay-Angebote | erledigt | #30, `app/test-los.mjs`; Hub liefert `sperre` (50 Angebote bis 01.12.) |
| A1.4, A1.6, A1.7 Titelregeln, Probelauf, Protokoll | erledigt | #30 `test-durchlauf.mjs`, bestehende Tests in `test-freigabe.mjs` |
| A1.8 Evaluation-Panel nach `main` | PR offen | #11 (Code von EmbletonNova) |
| A1.10 Fehlerbilder | erledigt (Sitzung abgelaufen in der Oberfläche ohne automatischen Test) | #30 `test-fehlerbilder-http.mjs` |
| A1.11 nur Englisch | erledigt | #30 `test-oberflaeche.mjs` |
| A1.12 Telefonbreite | erledigt, gemessen 400/360 px | #30 |
| A1.1, A1.2, A1.5, A1.9, A6.6 Screenshots | offen (Gruppe) | Issue #19 |
| A2.1 Datenzugriffe | erledigt | #14 `docs/architektur.md` |
| A2.2, A4.8 Konstanten | erledigt | #30, `/api/betrieb.regeln` |
| A2.3 Team-Kopie | erledigt | #13 |
| A2.4 Meldung bei altem Datenstand | offen (kein Muss, Telegram auf PROD fehlt, B2.6) | — |
| A3.1–A3.13, A6.3 Sicherheit | erledigt | #29 `docs/sicherheit.md`, `test-routen-schutz.mjs`, `test-xss.mjs` |
| A4.1 Modul → Test | erledigt | #14 `docs/tests.md` |
| A4.2 Ende-zu-Ende-Test | erledigt | #30 |
| A4.3 Laufzeit, Kindprozesse abwarten | erledigt (ca. 37 s) | #12 |
| A4.4, A4.6 Konvention, toter Code | erledigt | #30, `npm run tote` |
| A4.5 CI auf Windows | fertig, nicht gepusht (Token ohne Scope `workflow`) | Issue #18 |
| A4.7 Kommentare | offen (Review) | Issue #21 |
| A5.1, A5.2, A5.3 Verteilung, Reviews, Branch-Schutz | offen (Gruppe, Niko) | Issues #15, #16, #17 |
| A5.4 Issues | erledigt | #15–#28 |
| A5.5 PR-Vorlage, A5.7 `.mailmap`, A5.8 KI-Anteil | erledigt, A5.8 von der Gruppe zu prüfen | #14 |
| A5.6 alte Branches löschen | offen: erst nach dem Merge | — |
| A6.1, A6.2, A6.4, A6.5 README, Architektur, Entwicklung, Glossar | erledigt; A6.1 blind nachmachen offen | #14, #12, Issue #20 |
| B1.1 Lions Freigabe | erledigt: Lion per Telegram 19.11. „Ja 1123“ | Nachrichtenzentrale #1123 |
| B1.5, B1.9 Shopify-Hinweis, Revert-Plan | erledigt (Vorlage) | #14 `docs/belege/revert-plan.md` |
| B1.10 kein eigener Analytics-Abruf | geprüft: `EBAY_TRAFFIC_AUTO` auf PROD leer | — |
| B2.2, B2.3 Sicherung, Wächter-Logs | geprüft 19.11.: Sicherung 18.11. an beiden Orten, Logs ohne Fehler seit dem Fix vom 18.11. | vor der Vorführung wiederholen |
| B1.2, B1.3, B1.6–B1.8, B2.1, B2.4–B2.6, B3, C | offen (Menschen) | Issues #22–#28 |

Nebenbei gefunden und im Hub behoben: `pm.db` trug als `created_at` die Uhrzeit des nächtlichen Neubaus, dadurch stand
auf PROD jedes Angebot auf „Wait“ und kein Test fand Kandidaten. Seit dem 19.11. steht dort das echte Anlagedatum.

## Ist-Stand (gemessen 18.11.2026, nicht geschätzt)

| Messung | Wert | Bedeutung für die Checkliste |
|---|---|---|
| Tests | **120** in 11 Dateien (`node:test`), `npm test` grün auf Ubuntu (CI) und Windows (Server) | Basis ist gut. Lücken: Auswertung (nur auf `vorschau`), Ende-zu-Ende-Durchlauf, Windows in der CI. |
| API-Routen | 32 unter `/api/*` plus `/healthz` | Jede Route braucht einen Test für „ohne Login 401“ und „Builder auf Admin-Route 403“ (A3.2). |
| Seiten | Listings, Tests, Approvals, Team (nur Admin), Log, Settings; Login | Evaluation-Panel (defd8b5) liegt nur auf `vorschau`, noch nicht in `main` (A1.8). |
| Code | ca. 4.300 Zeilen in `app/` und `public/`, **eine** Abhängigkeit (better-sqlite3), kein Framework | Stärke für die Präsentation: begründen können, warum (A6.3). |
| Sicherheit | scrypt-Passwörter, Sperre nach Fehlversuchen, Cookies HttpOnly + SameSite=Strict + Secure, Origin-Prüfung, CSP, X-Frame-Options, Rollen serverseitig, Access-JWT-Prüfung, Protokoll nur anhängen (DB-Trigger), Geheimnis-Scan in der CI, Schreibschalter `EBAY_SCHREIBEN` | Vorhanden, aber nirgends als Ganzes beschrieben und nicht jede Maßnahme hat einen Test (A3). |
| Git | 9 gemergte Pull Requests, **0 Reviews**, 0 Issues, Commits: nik1231-alt 10, Niko 5, EmbletonNova 4, Server-KI 4, **Alexius76 0, giacomogrilli 0** | Für „Zusammenarbeit“ der kritischste Befund (A5). |
| CI | `.github/workflows/pruefung.yml`: npm ci, Geheimnis-Scan mit Historie, Tests, nur Ubuntu | Zwei Windows-spezifische Fehler (EPERM/EBUSY) wurden erst auf dem Server gefunden (A4.5). |
| Betrieb | PROD `app.parture-team.com` (main) und VORSCHAU `vorschau.parture-team.com` (vorschau) hinter Cloudflare Access, Wächter mit Testschranke, tägliche Sicherung, Rücksicherung geprobt | Fertig. Offen: eBay-Keys auf PROD und Lions Freigabe (B1). |
| Daten | `pm.db` nächtlich 04:30 vom Hub: 984 Produkte, 2.155 Kanäle, 6.357 Bilder, Traffic 120 Tage (98 Tage vorhanden, Abdeckung 98,6 %) | Fertig. Team-Kopie `daten-team/pm.db` ist älter und ohne Traffic-Tabellen (A2.3). |

---

## A. Bis zur Abgabe am 22.11.: Code steht

### A1. Funktion: der eine Durchlauf muss sitzen (Kriterium „Funktion und Oberfläche“)

Der Kern des Tools ist ein einziger Weg: Angebot mit wenig Impressionen finden → Test ziehen → Titel vorschlagen →
freigeben → bei eBay ändern → protokollieren → auswerten. Jeder Schritt wird einmal **mit echten Daten auf
VORSCHAU** durchgespielt und das Ergebnis als Screenshot in `docs/belege/` abgelegt.

| # | Punkt | Wer | Beleg | Bis |
|---|---|---|---|---|
| A1.1 | Listings: Filter „Low impressions“ zeigt die richtigen Angebote (Stichprobe gegen `pm.db`: 5 Angebote per SQL nachrechnen) | Builder 1 | Screenshot + die 5 SQL-Zeilen in `docs/belege/a1-1.md` | 20.11. |
| A1.2 | Kopfzeile: Umgebung (PREVIEW/LIVE), Datenstand, „traffic up to“ stimmen mit `stand` in `pm.db` überein | Builder 1 | Screenshot | 20.11. |
| A1.3 | Tests → „Draw a new test“: Los ist reproduzierbar (Seed im Protokoll), Gruppen gleich groß, kein Angebot doppelt, Angebote der Preis-Abstieg-Liste sind ausgeschlossen (Liste kommt vom Hub, siehe B1.4) | Builder 2 | Test in `app/test-freigabe.mjs` oder `app/experimente`-Test, der genau diese vier Eigenschaften prüft | 21.11. |
| A1.4 | Titel eintragen als Builder: Längenregel 80 Zeichen, Titelhilfe zeigt nur belegte Hinweise, „Send for approval“ sperrt den Vorschlag gegen weitere Änderung | Builder 2 | Test vorhanden? Wenn nein: ergänzen. Screenshot | 21.11. |
| A1.5 | Approvals als Admin: alt und neu nebeneinander, Approve/Reject, Obergrenze 50 je Freigabe, Builder bekommt 403 (bereits getestet: `test-rollen-http.mjs`) | Niko | bestehender Test genannt, Screenshot | 20.11. |
| A1.6 | eBay-Schreiben im Probelauf (`EBAY_SCHREIBEN` aus): die App zeigt, was sie ändern würde, ändert nichts, Protokoll bekommt den Eintrag „Probelauf“ | Niko | Protokollzeile als Screenshot | 20.11. |
| A1.7 | Log: jeder Schritt aus A1.3 bis A1.6 steht mit Zeit, Person, alt/neu drin; Versuch, eine Zeile zu ändern oder zu löschen, scheitert am Trigger (Test vorhanden: nennen) | Builder 3 | Testname + Screenshot | 20.11. |
| A1.8 | **Evaluation-Panel (defd8b5) per Pull Request nach `main`**, mit `app/test-auswertung.mjs`; Review durch eine andere Person | Niko (PR), Builder 3 (Review) | PR-Nummer, CI grün, Merge | **19.11.** |
| A1.9 | „Show an example verdict“: Beispielzahlen sind klar als Beispiel beschriftet (Text „example data“ sichtbar), die drei Diagramme rendern auch bei leeren Daten ohne Fehler in der Konsole | Builder 3 | Screenshot Konsole leer | 21.11. |
| A1.10 | Fehlerbilder: `pm.db` fehlt → 503 mit verständlichem Text; eBay lehnt ab → eBays Meldung sichtbar, nichts geändert; Sitzung abgelaufen → zurück zum Login ohne Datenverlust des Formulars | Builder 1 | 3 Screenshots | 21.11. |
| A1.11 | Oberfläche auf Englisch, einheitliche Begriffe (Listing, Test, Approval, Log, Settings), keine deutschen Reste in sichtbaren Texten (`grep` über `public/`) | Builder 1 | `grep`-Ergebnis leer | 21.11. |
| A1.12 | Telefon-Breite (400 px): keine horizontale Scrollleiste auf Listings/Approvals/Log | Builder 2 | Screenshot | 21.11. |

### A2. Datenweg: woher die Zahlen kommen und wie frisch sie sind

| # | Punkt | Wer | Beleg | Bis |
|---|---|---|---|---|
| A2.1 | Die App liest **nur** `pm.db` (Whitelist des Hubs: Produkt, Kanal, Bild, Traffic). Kein Code greift auf andere Dateien oder APIs zu, außer `export-ebay.mjs` (Admin, lokal) und `ebay-schreiben.mjs` (PROD) | Server-KI | `grep` nach `fetch(`/`Database(` in `app/` mit Liste der Stellen | 19.11. |
| A2.2 | Datenverzug 3 Tage und „letzte Tage nachgeprüft“ sind im Code und in der Kopfzeile dieselbe Zahl (eine Konstante) | Builder 2 | Konstante benannt | 20.11. |
| A2.3 | **Team-Kopie** `daten-team/pm.db` aus der aktuellen Server-`pm.db` erneuern (mit Traffic-Tabellen), damit lokal und im Ausfallplan dieselbe Oberfläche erscheint wie live. Enthält keine Kosten, keine Kunden (Whitelist). | Niko | Commit, Dateigröße, `stand`-Zeile | 20.11. |
| A2.4 | Was passiert, wenn der Hub nachts nicht liefert: App zeigt den alten Stand mit Datum, Admin bekommt eine Telegram-Meldung, wenn der Stand älter als 2 Tage ist (prüfen, ob vorhanden; sonst Issue, kein Muss bis 22.11.) | Server-KI | Testlauf mit verstelltem Datum | 25.11. |

### A3. Sicherheit (eigenes Bewertungskriterium)

Was es gibt, muss als Ganzes **beschrieben und je Punkt mit einem Test belegt** sein. Eine Seite `docs/sicherheit.md`
mit genau dieser Tabelle, jede Zeile verweist auf den Test.

| # | Punkt | Wer | Beleg | Bis |
|---|---|---|---|---|
| A3.1 | `docs/sicherheit.md`: Bedrohungsmodell in zehn Zeilen (wer könnte was wollen: Fremder im Netz, Builder ohne Admin-Recht, verlorener Laptop, geleakter Commit) und die Maßnahme je Fall | Builder 3 | Datei im PR | 21.11. |
| A3.2 | **Jede** der 32 Routen: ohne Login 401, Builder auf Admin-Route 403. Ein Test, der die Routenliste aus `server.mjs` liest und alle durchprobiert, statt einer Handvoll ausgewählter | Builder 3 | Test zählt 32 Routen; schlägt fehl, wenn eine neue Route ungeschützt ist | 21.11. |
| A3.3 | Login: scrypt mit Salz, Sperre nach N Fehlversuchen (N nennen), Mindestlänge 10, Passwortwechsel beendet andere Sitzungen, Logout löscht die Sitzung serverseitig | Niko | Tests in `test.mjs`/`test-http.mjs` genannt | 20.11. |
| A3.4 | Cookies: HttpOnly, SameSite=Strict, Secure nur über HTTPS (lokal bewusst nicht: begründen), Sitzungsdauer begrenzt | Niko | Test genannt, Begründung in `docs/sicherheit.md` | 20.11. |
| A3.5 | CSRF: Origin-Prüfung bei POST (Test vorhanden); Formulare ohne `action` auf fremde Hosts | Builder 3 | Test genannt | 20.11. |
| A3.6 | XSS: alle Daten per `textContent`, kein `innerHTML` mit Daten (Stand: 33× `textContent`, 0× `innerHTML`); CSP-Header; Test, der einen Titel mit `<script>` durchschiebt und prüft, dass er als Text erscheint | Builder 1 | neuer Test | 21.11. |
| A3.7 | Eingaben werden im Modul geprüft (Typ, Länge, Zustand): Titel 80 Zeichen, Angebotsnummer numerisch, Zustände der Freigabe als Zustandsautomat (offen → freigegeben/abgelehnt → geschrieben), unerlaubte Übergänge 409 | Builder 2 | Tests in `test-freigabe.mjs` genannt oder ergänzt | 21.11. |
| A3.8 | Geheimnisse: `.env` und `*.db` in `.gitignore`, `npm run scan` sauber (Stand: 55 Dateien), CI prüft die ganze Historie; keine Tokens im Protokoll oder in Logs (`grep` nach `EBAY_`, `TOKEN` in `daten/*.log` nach einem Durchlauf) | Niko | Scan-Ausgabe, `grep` leer | 20.11. |
| A3.9 | Rollen serverseitig: Builder kann nicht freigeben, Rollen ändern, sichern, eBay-Schalter setzen (Test vorhanden: `test-rollen-http.mjs`); Oberfläche blendet nur aus, der Server entscheidet | Niko | Test genannt | 20.11. |
| A3.10 | Außenzugang: Cloudflare Access vor beiden Umgebungen, App prüft zusätzlich das Access-JWT (Aud, Ablauf, Signatur); Ports nur 127.0.0.1 (Server-Probe 17.11. bestanden) | Server-KI | Probenprotokoll in `docs/server-checkliste.md` | erledigt |
| A3.11 | eBay-Schreibweg: nur mit Keys **und** `EBAY_SCHREIBEN=an`, Lesen-vor-Schreiben (Titel weicht ab → nichts), Obergrenze 50, alles im Protokoll. Ein Test je Riegel | Niko | Tests genannt | 21.11. |
| A3.12 | `npm audit` ohne bekannte Lücken in der einen Abhängigkeit; Node-Version festgelegt (`engines` in `package.json`, `.nvmrc`) | Builder 2 | Ausgabe im PR | 20.11. |
| A3.13 | Keine Kunden- oder Käuferdaten in der App, in `pm.db` oder im Protokoll (`export-ebay.mjs` aggregiert Bestellungen nur zu Zahlen). Satz dazu in `docs/sicherheit.md` | Niko | Satz + `grep` | 20.11. |

### A4. Code-Qualität und Tests

| # | Punkt | Wer | Beleg | Bis |
|---|---|---|---|---|
| A4.1 | Jedes Modul in `app/` hat eine Testdatei oder steht begründet auf einer Ausnahmeliste in `docs/entwicklung.md` (heute ohne eigenen Test: `bewertung.mjs`, `einstellungen.mjs`, `regeln.mjs`, `protokoll.mjs`, `ebay-schreiben.mjs`, `export-ebay.mjs`) | Builder 3 | Tabelle Modul → Testdatei | 21.11. |
| A4.2 | **Ein Ende-zu-Ende-Test** über den ganzen Weg aus A1 gegen den laufenden Server (Login Builder → Vorschlag → Login Admin → Freigabe → Probelauf-Schreiben → Protokoll → Auswertung) | Builder 2 | `app/test-durchlauf.mjs` | 21.11. |
| A4.3 | `npm test` unter 60 Sekunden, keine wackligen Tests (zwei Windows-Aufräumfehler wurden am 17./18.11. behoben: Prozessende abwarten, dann löschen). Regel in `docs/entwicklung.md`: Kindprozesse immer mit `once("exit")` abwarten | Server-KI | Laufzeit im PR, Regel im Doc | 19.11. |
| A4.4 | Konvention `{ ok, wert }` / `{ ok: false, status, fehler }` überall; Stichprobe 10 Funktionen; Abweichungen angleichen | Builder 1 | Liste der 10 | 21.11. |
| A4.5 | CI auch auf **Windows** (`runs-on: [ubuntu-latest, windows-latest]` als Matrix), weil der Server Windows ist und zwei Fehler nur dort auftraten | Server-KI | grüner Lauf auf beiden | 19.11. |
| A4.6 | Kein toter Code: Funktionen, die niemand importiert, entfernen oder begründen (einfaches Skript: jede exportierte Funktion gegen `grep` im Repo) | Builder 1 | Skriptausgabe leer | 21.11. |
| A4.7 | Kommentare sagen das **Warum**, nicht das Was; Kopf jeder Datei nennt Zweck in zwei Sätzen (Stichprobe aller 20 `app/*.mjs`) | alle | im Review abgehakt | 22.11. |
| A4.8 | Keine Zahlen doppelt: Verzug 3 Tage, Obergrenze 50, Marke +20 %, Sperre nach N Fehlversuchen jeweils genau eine Konstante mit Namen, von Tests und Oberfläche gleich benutzt | Builder 2 | `grep` nach den Literalen zeigt je eine Stelle | 21.11. |

### A5. Git-Zusammenarbeit (heute der schwächste Punkt)

Messung 18.11.: 9 gemergte PRs, **kein einziges Review**, keine Issues, zwei Mitglieder ohne Commit. Bewerter sehen das
in einer Minute. Bis zur Abgabe muss das Bild stimmen, und zwar durch echte Arbeit, nicht durch kosmetische Commits.

| # | Punkt | Wer | Beleg | Bis |
|---|---|---|---|---|
| A5.1 | **Alexius76 und giacomogrilli** übernehmen je mindestens zwei Punkte aus A1 bis A4 und liefern sie als eigene PRs (Vorschlag: Builder 1 = Alexius76, Builder 2 = giacomogrilli, Builder 3 = EmbletonNova) | Niko verteilt | PR-Liste je Person | 19.11. (Verteilung), 22.11. (Merge) |
| A5.2 | **Jeder PR ab jetzt hat ein Review** einer anderen Person mit mindestens einem inhaltlichen Kommentar, der Autor merged nie selbst | alle | GitHub-Review sichtbar | ab sofort |
| A5.3 | **Branch-Schutz auf `main`** einschalten: Niko holt das GitHub Student Developer Pack (GitHub Pro kostenlos), dann Regel: PR Pflicht, 1 Review Pflicht, CI Pflicht, kein Force-Push. Bis dahin gilt die Absprache aus `docs/entwicklung.md` | Niko | Screenshot der Regel | 20.11. |
| A5.4 | Issues als Arbeitsliste: jeder Punkt dieser Checkliste, der Code braucht, wird ein Issue mit Nummer, Zuständigem und Termin; PRs schließen Issues („closes #12“) | Niko legt an, alle nutzen | Issue-Liste | 19.11. |
| A5.5 | PR-Vorlage `.github/pull_request_template.md`: Was, Warum, Wie getestet, Checklisten-Nummer, Screenshot bei Oberfläche | Builder 3 | Datei im Repo | 19.11. |
| A5.6 | Alte Branches löschen, wenn gemergt (`admin/*`, `emb/*`, `fix/*`, `server/*`); offen bleiben nur `main`, `vorschau` und aktive Arbeitsbranches | Niko | `git branch -r` zeigt ≤ 5 Branches | 22.11. |
| A5.7 | Commit-Nachrichten sagen das Warum (Stichprobe der letzten 20); Autorennamen stimmen (ein Mitglied taucht heute doppelt auf: `nik1231-alt` und `Niko`; `.mailmap` oder Git-Config vereinheitlichen) | Niko | `git shortlog` zeigt 4 Personen + Server-KI | 20.11. |
| A5.8 | Beitrag der Server-KI ist als solcher gekennzeichnet (Committer „Parture Server-KI“, Co-Authored-By) und in der Präsentation ehrlich benannt: Server-Betrieb, Wächter, Datenexport. Der fachliche Kern (Test-Logik, Freigabe, Auswertung, Oberfläche) ist Arbeit der Gruppe | Niko | Satz in `docs/vorfuehrung.md` | 21.11. |

### A6. Dokumentation (Kriterium „Präsentation und Doku“)

| # | Punkt | Wer | Beleg | Bis |
|---|---|---|---|---|
| A6.1 | `README.md` auf Stand: Abschnitt „Aufbau“ nennt heute nur 5 Routen und die alte Oberfläche; neu: Zweck in drei Sätzen, Seiten, Rollen, Datenweg, Start lokal, Link auf die Docs. Alles, was im README steht, muss beim Nachmachen funktionieren (eine Person macht es blind nach) | Builder 1 schreibt, Builder 2 probiert | Protokoll des Nachmachens | 21.11. |
| A6.2 | `docs/architektur.md` (eine Seite): Bild aus `vorfuehrung.md` plus Datenfluss `pm.db` → App → eBay, und die Tabelle „Entscheidung → Warum → Alternative“ (kein Framework, SQLite, Whitelist-Daten, zwei Umgebungen, Wächter statt Hosting-Dienst, Los-Verfahren statt Vorher/Nachher) | Builder 3 | Datei | 21.11. |
| A6.3 | `docs/sicherheit.md` (siehe A3.1) | Builder 3 | Datei | 21.11. |
| A6.4 | `docs/entwicklung.md` ergänzen: Wächter-Fix 18.11. (App stoppt vor npm ci), Regel „Kindprozesse abwarten“, Hinweis „Wächter-Prozess lädt Code nur beim Start, nach Wächter-Änderungen Aufgabe neu starten“ | Server-KI | Commit | 19.11. |
| A6.5 | Glossar (10 Begriffe, englisch/deutsch): Listing, Impressions, Test group / Control group, Approval, Verdict, Safety metric (sales), Data lag, Preview/Live, Watcher, Append-only log | Builder 2 | Abschnitt im README | 21.11. |
| A6.6 | Screenshots der 8 Demo-Schritte in `docs/belege/` (auch Ausfallplan) | Builder 1 | Dateien | 22.11. |

---

## B. Zwischen Abgabe und Vorführung (23.11. bis 03.12.)

### B1. eBay live: die echte Titeländerung

Reihenfolge ist Pflicht, kein Schritt wird übersprungen. Der Schalter `EBAY_SCHREIBEN` steht außerhalb der Proben
und der Vorführung auf **aus**.

| # | Punkt | Wer | Beleg | Bis |
|---|---|---|---|---|
| B1.1 | Lions Freigabe in der Nachrichtenzentrale des Hubs (#1123): eBay-Zugang für die App, die vier Testangebote, Titeltest mit Revert. Ohne diesen Klick passiert nichts Scharfes | Lion | Antwort an #1123 | so bald wie möglich |
| B1.2 | eBay-Developer-App (Nikos Konto) mit **nur** den nötigen Scopes; Consent auf dem Verkäuferkonto; Keys **von Niko selbst** in `C:\parture\prod\.env` getippt (Editor wird vom Server geöffnet, nichts über Chat oder Repo) | Niko | `.env` zeigt „gesetzt“ (nie den Wert) | nach B1.1 |
| B1.3 | Wächter PROD neu starten (Aufgabe stoppen, App-Prozess beenden, Aufgabe starten); `/api/betrieb` zeigt `zugangsdaten: true`, `schreibenAn: false` | Server-KI | Ausgabe | nach B1.2 |
| B1.4 | Sperrliste aus dem Hub: die 50 Angebote des laufenden Preis-Abstieg-Tests (bis 24.11.) dürfen in keinen Titeltest; Liste in `pm.db` als Tabelle `sperre` (Whitelist-Export erweitern) und vom Los berücksichtigt (A1.3) | Server-KI (Export), Builder 2 (Los) | Test: gesperrtes Angebot wird nie gezogen | 21.11. |
| B1.5 | Shopify-Zwillinge: die vier Testangebote haben Shopify-Gegenstücke; der Hub schreibt Shopify-Titeländerungen binnen 10 Minuten nach eBay. **Während eines Tests Shopify-Titel dieser Produkte nicht anfassen.** Satz in `docs/vorfuehrung.md` und Hinweis in der App auf der Approvals-Seite | Niko (Absprache mit Lion), Builder 1 (Hinweis) | Satz + Screenshot | 24.11. |
| B1.6 | Probelauf auf PROD mit zwei Angeboten bei Schalter aus: Protokoll zeigt „would change“, eBay unverändert | Niko | Protokoll | 24.11. |
| B1.7 | **Mini-Test mit Lion anwesend**: Schalter an, ein Angebot, Vorschlag → Freigabe → bei eBay prüfen → Protokoll → Revert über die App („Rückänderung“) → bei eBay prüfen → Schalter aus | Niko + Lion | 4 Screenshots | 24./25.11. |
| B1.8 | **Echten Test früh starten** (spätestens 25.11., Los aus den vier Angeboten plus Kontrolle), damit am 04.12. mit 3 Tagen Verzug **mindestens 7 Tage echte Daten** im Evaluation-Panel liegen und nicht nur das Beispiel-Urteil | Niko | Teststart im Protokoll | 25.11. |
| B1.9 | Revert-Plan schriftlich: welche Angebote, alter Titel, wer klickt, wann; nach der Vorführung alle Titel zurück oder bewusst behalten (Lion entscheidet) | Niko | `docs/belege/revert-plan.md` | 25.11. |
| B1.10 | eBay-Tageslimit der Analytics-API: Traffic kommt aus dem Hub, die App ruft Analytics nicht selbst (prüfen: `EBAY_TRAFFIC_AUTO` bleibt aus) | Server-KI | `.env` zeigt aus | 24.11. |

### B2. Betrieb und Server

| # | Punkt | Wer | Beleg | Bis |
|---|---|---|---|---|
| B2.1 | Jeder der vier Zugänge einmal auf PROD **und** VORSCHAU angemeldet (Access-PIN + App-Login), Passwort geändert; die Übergabedateien `C:\parture\zugang-*.txt` und `erste-passwoerter-*.txt` danach gelöscht | alle; Server-KI löscht | Meldung „drin“ je Person, `ls` leer | 20.11. |
| B2.2 | Sicherung: tägliche Kopie in `daten/sicherung` und auf `SICHERUNG_ZIEL2` (Google Drive) vorhanden; Rücksicherung einmal auf VORSCHAU geprobt (17.11. erledigt), vor der Vorführung noch einmal | Server-KI | Dateiliste mit Datum | 02.12. |
| B2.3 | Wächter-Logs beider Umgebungen ohne FEHLER/ABGELEHNT in den letzten 7 Tagen vor der Vorführung; `/healthz`-Version = `main` | Server-KI | Log-Auszug | 03.12. |
| B2.4 | Server-Laptop: freier Arbeitsspeicher (am 17.11. nur ca. 500 MB), unnötige Fenster und Sitzungen geschlossen, keine Windows-Updates am 03./04.12. | Niko mit Lion | Messung | 03.12. |
| B2.5 | Nach Neustart des Servers läuft nichts, bis sich jemand anmeldet (keine automatische Anmeldung). Am Vorführungstag ist jemand am Server oder der Server bleibt an | Lion/Niko | Absprache | 03.12. |
| B2.6 | Telegram-Meldung an den Admin bei neuem Vorschlag funktioniert auf PROD (Bot anlegen, `TELEGRAM_*` in `.env`) oder bewusst weglassen und in der Demo nicht behaupten | Niko | Testmeldung oder Satz gestrichen | 25.11. |

### B3. Generalprobe (zweimal, mit Stoppuhr)

| # | Punkt | Wer | Beleg | Bis |
|---|---|---|---|---|
| B3.1 | Ablauf aus `docs/vorfuehrung.md` komplett auf PROD, zweites Fenster mit dem eBay-Angebot, Zeit messen (Ziel 8 Minuten, Grenze 10) | alle | Zeit notiert | 27.11. und 02.12. |
| B3.2 | Sprecherrollen: wer sagt was bei welchem Schritt; jeder spricht mindestens einmal; Übergaben geübt | Niko | Zuteilung im Doc | 27.11. |
| B3.3 | Ausfallplan: Bildschirmvideo der 9 Schritte (ohne Ton oder mit), Screenshots, lokale App mit frischer Team-Kopie auf dem Vorführ-Laptop, offline geprobt (WLAN aus) | Builder 1 | Video + Offline-Probe | 28.11. |
| B3.4 | Fragenliste mit Antworten (siehe B4) laut durchgesprochen | alle | Doc | 02.12. |
| B3.5 | Vorführ-Laptop: Browser mit beiden Access-Sitzungen (gelten 7 Tage: am 28.11. oder später einmal anmelden), eBay-Login im zweiten Fenster, Zoom 125 %, Benachrichtigungen aus | Niko | Checkliste abgehakt | 03.12. |

### B4. Ehrliche Antworten vorbereiten

Aus `docs/vorfuehrung.md` übernommen und ergänzt. Jede Antwort in zwei Sätzen, eine Person zuständig.

1. Warum kein Framework? (4.300 Zeilen, eine Abhängigkeit, alles lesbar, kein Build-Schritt; Kosten: Routing und Sitzungen selbst geschrieben, dafür getestet.)
2. Warum SQLite? (Eine Datei, atomarer Austausch der Nachtlauf-Datei, Trigger für das Protokoll, keine Server-Komponente.)
3. Warum gibt es keine Kosten, keinen Gewinn, keine Kunden in den Daten? (Whitelist-Export, Firmenregel; die Aufgabe wird über Impressionen, Menge und Preis formuliert.)
4. Wie ist sichergestellt, dass ein Builder nichts bei eBay ändert? (Serverseitige Rollen mit Test, Keys nur auf PROD, Schalter, Lesen-vor-Schreiben, Protokoll.)
5. Was, wenn eBay die Änderung ablehnt? (Meldung wird angezeigt, nichts geändert, Protokolleintrag.)
6. Korrelation oder Ursache? (Los mit Kontrollgruppe, Verkäufe als Schutzkennzahl, +20 %-Marke; ein echtes Urteil braucht 30 Tage, wir zeigen den Zwischenstand nach x Tagen plus das Beispiel.)
7. Was hat die KI gemacht, was die Gruppe? (A5.8: Server-Betrieb, Wächter, Export durch die Server-KI; fachlicher Kern durch die Gruppe. Offen sagen.)
8. Was würdet ihr mit einem weiteren Monat tun? (Automatisches Urteil nach 30 Tagen, mehr Kanäle, Titelhilfe mit mehr Daten.)
9. Wie habt ihr zusammengearbeitet? (Branches, PRs mit Review, CI, Vorschau nach 1 Minute, PROD nur über main mit Tests. Zahlen aus `git shortlog` nennen.)
10. Wie schützt ihr Zugangsdaten? (A3.8, A3.10, Geheimnis-Scan über die Historie, Access vor der App.)

---

## C. Der Tag der Vorführung (04.12.)

30 Minuten vorher, Niko hakt ab:

- [ ] `https://app.parture-team.com/healthz` und `https://vorschau.parture-team.com/healthz` antworten, Version von PROD = `main`.
- [ ] Beide Access-Sitzungen auf dem Vorführ-Laptop gültig, App-Login als Builder **und** als Admin funktioniert (zwei Browserprofile oder zwei Browser).
- [ ] eBay-Angebot für Schritt 6 im zweiten Fenster offen, eingeloggt.
- [ ] `EBAY_SCHREIBEN=an` wird **erst unmittelbar vor Schritt 5** gesetzt (Wächter-Neustart vorher geprobt, dauert 30 Sekunden) und direkt nach Schritt 6 wieder auf aus.
- [ ] Revert-Plan (B1.9) liegt ausgedruckt daneben.
- [ ] Ausfallplan griffbereit: Video, Screenshots, lokale App gestartet.
- [ ] Telefon von Niko zeigt die Telegram-Meldung (B2.6) oder der Satz dazu wird weggelassen.
- [ ] Nach der Vorführung: Schalter aus, Protokoll exportieren (Screenshot), Revert nach B1.9, kurze Nachricht an Lion.

---

## D. Nicht bauen (Scope-Schutz)

Ab 22.11. kommt nichts Neues dazu. Ausdrücklich nicht: Amazon oder weitere Marktplätze, Kosten- oder Gewinnzahlen,
Kundendaten, KI-generierte Titel, automatische Freigabe, Preisänderungen, ein zweites Datenformat neben `pm.db`.
Wer eine Idee hat, legt ein Issue mit Label „nach der Vorführung“ an.

## Zuständigkeiten im Überblick (Vorschlag)

| Wer | Schwerpunkt | Punkte |
|---|---|---|
| **Niko** (Admin) | eBay, Lion, Freigabe, Branch-Schutz, Issues, Präsentationsleitung | A1.5, A1.6, A1.8, A2.3, A3.3, A3.4, A3.8, A3.9, A3.11, A3.13, A5.1, A5.3, A5.4, A5.6, A5.7, A5.8, B1.*, B2.4, B2.6, B3.2, B3.5, C |
| **Builder 1** (Vorschlag Alexius76) | Oberfläche, Listings, README, Belege, Ausfallplan | A1.1, A1.2, A1.10, A1.11, A3.6, A4.4, A4.6, A6.1, A6.6, B1.5, B3.3 |
| **Builder 2** (Vorschlag giacomogrilli) | Los, Freigabe-Zustände, Konstanten, Ende-zu-Ende-Test | A1.3, A1.4, A1.12, A2.2, A3.7, A3.12, A4.2, A4.8, A6.5, B1.4 |
| **Builder 3** (Vorschlag EmbletonNova) | Auswertung, Sicherheit, Protokoll, Architektur-Doc, PR-Vorlage | A1.7, A1.8 (Review), A1.9, A3.1, A3.2, A3.5, A4.1, A5.5, A6.2, A6.3 |
| **Server-KI** | Export, Sperrliste, Wächter, CI-Windows, Server-Proben | A2.1, A2.4, A4.3, A4.5, A6.4, B1.3, B1.4, B1.10, B2.1 (Löschen), B2.2, B2.3 |

Nachgetragen wird hier, nicht in Chats: Wer etwas erledigt, setzt das Häkchen im selben PR.
