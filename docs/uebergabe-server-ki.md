# Übergabeprotokoll: Parture-Tool auf den Server bringen

Dieses Dokument ist für die KI (Claude Code o. Ä.), die auf dem **Server-Laptop** läuft und dort Zugriff auf Cloudflare (Tunnel, Access) hat. Es ist so geschrieben, dass du ohne Vorwissen weiterarbeiten kannst. Die KI auf Nikos Mac hat das Tool gebaut und getestet. Du richtest es auf dem Server ein, schaltest es nach Proben scharf und übergibst es der Gruppe.

**Niko gibt dir als ersten Satz nur das:** „Lies `docs/uebergabe-server-ki.md` im Repo `Parture-Groupwork` vollständig und arbeite es von oben nach unten ab. Frag mich nur bei den Punkten, die dort als ‚Frag Niko‘ stehen.“

---

## 1. Auftrag in einem Satz

Das Repo `nik1231-alt/Parture-Groupwork` (privates GitHub-Repo, Uni-Gruppenprojekt, Frist ca. **23.11.2026**) ist ein **Produktmanagement-Tool für den eBay-Shop `partureshop`** (Fokus: mehr Impressionen durch Titeltests). Es soll **robust und vorzeigbar** auf dem Server laufen, für alle vier Gruppenmitglieder per Login erreichbar, mit täglich automatisch eintreffenden Traffic-Daten, und Titeländerungen bei eBay sollen nur nach **Freigabe durch Niko** (Admin) und mit seinem eBay-Zugang geschehen und lückenlos protokolliert werden.

Niko will ausdrücklich **„keine halbgaren Sachen, sondern ein robustes System, das man vorstellen und präsentieren kann“**. Lieber weniger Funktionen, die zuverlässig laufen, als viele, die nur meistens laufen.

## 2. Spielregeln für dich (verbindlich)

1. **Geheimnisse:** eBay-Keys, Refresh-Token, Cloudflare-Tokens, Telegram-Token, Passwörter, `.env`-Inhalte und Tunnel-Zugangsdaten werden **nie** in den Chat, in Commits, Issues, Logs, Tool-Ausgaben oder Dokumente geschrieben. Niko trägt Werte **selbst** in die `.env` ein (er öffnet die Datei im Editor). Du gibst die Datei nicht aus (`cat .env` ist tabu) und zeigst bei Prüfungen nur „gesetzt / nicht gesetzt“. Nikos Wunsch: Passwörter nicht im Chat posten.
2. **Nichts Außenwirksames ohne Nikos Ja:** kein Push auf `main`, kein Merge, kein Schließen von Pull Requests, keine Änderung an GitHub-Einstellungen, kein Einschalten von `EBAY_SCHREIBEN=an`, keine echte Titeländerung bei eBay, keine Freigabe von Cloudflare-Access-Personen ohne seine Liste. Vorbereiten und vorschlagen ja, ausführen erst nach „ja“.
3. **Keine ungeprüften Stände auf der Maschine mit den Keys.** PROD folgt nur `main` und nur nach bestandenen Tests. Du richtest keinen Mechanismus ein, der Code von einem Branch zieht, den jemand ohne Review beschreiben kann, auf eine Maschine mit eBay-Keys. (Grund: Wer dort Code ausführen lässt, kann die Keys lesen.)
4. **Ein Befehl, der Prozesse beendet, trifft nur dein Ziel.** Kein `pkill node`, kein `taskkill /im node.exe` (das hat schon einmal den laufenden Server von Niko mit beendet). Immer über PID oder die Aufgabe.
5. **Antworte auf Deutsch**, kurz und ehrlich. Wenn etwas nicht geklappt hat oder nicht getestet ist, sag es so. Hake in `docs/server-checkliste.md` nur ab, was du selbst mit der angegebenen **Probe** geprüft hast.
6. Arbeite auf einem eigenen Branch (`server/<thema>`), öffne Pull Requests, schreibe **nie direkt auf `main`**.

## 3. Was schon fertig ist (gebaut und mit 116 automatischen Tests geprüft)

| Bereich | Stand |
|---|---|
| Login | Benutzer/Sitzungen (scrypt, HttpOnly/SameSite/Secure-Cookie), Sperre je Name (5 Fehlversuche) und je Adresse (20), Passwort ändern unter *Account*, Schutz-Header/CSP |
| Rollen | `admin` (Niko) und `builder` (Alexius76, giacomogrilli, EmbletonNova). Der Server prüft Rechte, nicht nur die Oberfläche. Immer mindestens ein Admin |
| Freigabe | Builder: „Send for approval“. Admin gibt frei → App liest aktuellen Titel bei eBay, überschreibt **nichts**, wenn er vom erwarteten abweicht, schreibt nur mit `EBAY_SCHREIBEN=an`, sonst **Dry run**. Obergrenze 50 Angebote je Freigabe. Rückänderung („revert“) braucht wieder Freigabe |
| Protokoll | Tab *Log*, nur anhängen (SQLite-Trigger verbieten Ändern/Löschen) |
| Traffic | Tageswerte je Listing aus der eBay-Analytics-API, Stichtag = heute − 3 Tage, die letzten 3 Tage werden nachgeprüft, Kontrolle gegen Kontosumme (< 80 % bricht ab), fortsetzbar bei HTTP 429, täglich ab 5 Uhr automatisch (`EBAY_TRAFFIC_AUTO=an`), Warnbanner bei Rückstand ≥ 2 Tage |
| Betrieb | Wächter `app/waechter.mjs` (Auto-Deploy mit Testschranke, Neustart bei Absturz/Hänger), tägliche Sicherung mit Rücksicherung, Telegram-Meldung (optional), Statusseite (Tab Log → System), Umgebungs-Badge PREVIEW/LIVE |
| Qualität | CI-Workflow (`.github/workflows/pruefung.yml`), Geheimnis-Scan über Dateien **und gesamte Git-Historie** (sauber, Stand 17.11.), Entwicklerleitfaden, Einrichtungsanleitung |
| Hilfen | Titelhilfe (Wort-Hinweise aus eigenen Daten, erfindet keine Titel), Beispiel-Urteile mit erfundenen Zahlen (Tab Tests) |

**Nicht** getestet: eine echte Titeländerung bei eBay (nur gegen einen Ersatz-Schreiber), und die neue Oberfläche wurde nur per API und Syntaxprüfung, nicht visuell im Browser abgenommen. Das gehört in deine Proben (Abschnitt 6).

## 4. Wo der Code gerade liegt (zuerst prüfen!)

Alles liegt auf **Branches**, nichts davon war beim Schreiben dieses Dokuments auf `main`:

- `emb/login` (Login von EmbletonNova)
- `admin/rollen-freigabe` (PR #4: Rollen, Freigabe, Protokoll, Traffic-Import; Basis noch `emb/login`)
- `admin/server-betrieb` (Wächter, Sicherung, Telegram, Statusseite, Passwort ändern, Titelhilfe, Demo, CI, Doku, dieses Dokument)

**Erste Handlung:** `git fetch` und prüfen, was auf `origin/main` ist (`git log --oneline origin/main -5`, `git branch -r --contains <commit>`). Fehlen die drei Branches noch, **frag Niko**, sie in der richtigen Reihenfolge zu mergen (Login → PR #4 → Betrieb). Du mergst nicht selbst. Bis dahin kannst du alles vorbereiten (Ordner, Tunnel, Access) und die Proben aus einem Klon des Branches `admin/server-betrieb` fahren.

Außerdem braucht es den Branch **`vorschau`**. Existiert er nicht: Niko legt ihn an oder erlaubt dir `git push origin main:vorschau` (sonst nichts).

## 5. Architektur, die du herstellst

```
GitHub
  main    ──► PROD     C:\parture\prod       Port 5070   eBay-Keys, Freigabe, Traffic-Import, Wächter (nur Fast-Forward + Tests)
  vorschau──► VORSCHAU C:\parture\vorschau   Port 5071   KEINE Keys, Wächter folgt hart, jede Minute

Browser ─► Cloudflare Access (E-Mail-Code, nur die 4 Adressen) ─► Cloudflare Tunnel (Dienst) ─► 127.0.0.1:5070 / :5071 ─► App-Login
```

- Die App lauscht ausschließlich auf `127.0.0.1`. Keine eingehenden Firewall-Ports öffnen.
- Mit gesetzten `CF_ACCESS_TEAM_DOMAIN` und `CF_ACCESS_AUD` nimmt die App **nur** Anfragen mit gültigem Cloudflare-Access-Token an (sonst 401). Zwei Access-Anwendungen, zwei verschiedene AUD (je eine pro Hostname).
- Chrome sperrt Port 5060 (`ERR_UNSAFE_PORT`): deshalb 5070/5071, nicht 5060.

## 6. Dein Arbeitsplan (von oben nach unten)

Die ausführlichen Befehle und Proben stehen in **`docs/server-einrichtung.md`** (gleiche Nummerierung der Schritte). Hake in **`docs/server-checkliste.md`** ab (Kennungen B1 … H6). Eigenes Branch/PR für die Abhakungen.

**Phase 1: Server vorbereiten (B)**
1. Zustand der Maschine prüfen: Betriebssystem, Node ≥ 22, Git, Ruhezustand aus, Netz stabil, welche alten Aufgaben/Prozesse laufen (`Get-ScheduledTask`, Port 5060/5070/5071 belegt?). Es existiert evtl. noch **`C:\parture-pm`** mit der alten Aufgabe „Parture PM (5060)“ (zieht `main` ohne Tests): `installiere.ps1` deaktiviert sie. Daten dort (`daten\app.db`, `.env`) **nicht löschen**, erst sichten und mit Niko klären (**Frag Niko**, ob sie übernommen werden sollen).
2. Zwei Klone `C:\parture\prod` (`main`) und `C:\parture\vorschau` (`vorschau`), `npm ci`, `npm test` in beiden grün.
3. `.env` je Umgebung aus `server\env.prod.beispiel` / `env.vorschau.beispiel` anlegen. **Niko trägt die eBay-Werte selbst ein.** `EBAY_SCHREIBEN` bleibt **leer**.
4. Benutzer anlegen (`npm run benutzer -- anlegen …`), Passwörter verdeckt abfragen lassen, **nicht** ausgeben. Niko = admin, die drei = builder; beide Umgebungen.
5. Wächter als Aufgabe: `.\server\windows\installiere.ps1 -Umgebung prod|vorschau`. Proben: Absturztest, Neustart des Laptops, `daten\waechter.log`.

**Phase 2: Zugang von außen (C)** (du hast die Cloudflare-Rechte)
6. Named Tunnel `parture` mit zwei Hostnamen (`app.<domain>`, `vorschau.<domain>`), als Dienst installiert; Konfig aus `server\cloudflare\config.beispiel.yml`. **Frag Niko** nach der Domain (muss bei Cloudflare verwaltet sein) und dem Teamnamen.
7. Zwei Access-Anwendungen (Self-hosted), Anmeldung *One-time PIN*, Regel *Allow* nur für die vier E-Mail-Adressen (**Frag Niko** nach den Adressen). AUD-Tags in die `.env` eintragen (AUD ist kein Passwort, aber behandle sie trotzdem sparsam), Wächter neu starten.
8. Proben aus `server-einrichtung.md` Schritt 6 (vier Stück). Erst wenn alle stimmen: Quick-Tunnel und App auf Nikos Mac beenden lassen (**Niko** macht das, es ist sein Mac; die Gruppe nutzt aktuell die temporäre Adresse dorthin).

**Phase 3: Daten und Sicherung (D)**
9. Erster `npm run export` auf PROD. **Bekannt:** Die eBay-Analytics-API hat ein hartes Abruflimit (HTTP 429). Der 90-Tage-Aufbau läuft deshalb über mehrere Läufe/Tage von selbst weiter (Zwischenspeicher). Bei 429 nicht wiederholt hämmern, sondern am nächsten Tag weiter. Fortschritt und Abdeckung im Tab *Log* prüfen; Abdeckung (Summe der Listings gegen Kontosumme) sollte nahe 100 % sein, unter 80 % ist ein Fehler. Daten dürfen erst als „fertig“ gelten, wenn die letzten 3 Tage nachgeprüft sind.
10. `EBAY_TRAFFIC_AUTO=an`: am nächsten Tag prüfen, dass der Import um/nach 5 Uhr von selbst lief (Log: „Last successful import“ mit heutigem Datum).
11. Sicherung: `npm run sicherung`, **Rücksicherung einmal wirklich testen** (Schritt 8 in `server-einrichtung.md`), `SICHERUNG_ZIEL2` auf ein anderes Laufwerk oder eine Cloud-Ablage (**Frag Niko**, wohin).
12. Optional: `PM_DB` der Vorschau auf die `pm.db` von PROD zeigen lassen (nur lesend), damit dort dieselben Zahlen stehen.

**Phase 4: Schreiben nach Freigabe (E)**
13. Dry-run-Probe auf PROD (Schalter leer): zwei Angebote einreichen, freigeben, im Log steht **Dry run**, bei eBay ändert sich nichts.
14. **Frag Niko:** Welche **4 Angebote** darf der erste echte Test ändern (Ladenhüter, kaum Verkäufe)? Erst danach `EBAY_SCHREIBEN=an` (Niko setzt es selbst), Wächter neu starten.
15. Echter Mini-Test mit Niko vor Ort: Builder-Konto schlägt vor → Niko gibt frei → **bei eBay nachsehen**, dass der Titel geändert ist → Log prüfen → Test schließen mit „revert“ → Rückänderung freigeben → bei eBay nachsehen. Notiere, was eBay ablehnt (**erwartet:** eBay kann Titeländerungen bei Angeboten mit Verkäufen ablehnen; die App zeigt dann eBays Meldung, ändert nichts und protokolliert es).
16. Telegram: Niko legt einen Bot an und trägt `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID` selbst in die PROD-`.env` ein. Probe: Ein Builder reicht einen Vorschlag ein → Nachricht kommt bei Niko an.

**Phase 5: Sicherheit und Übergabe an die Gruppe (F, G)**
17. Niko ändert sein Passwort unter *Account* und löscht auf dem Mac die Datei `daten/erstes-passwort.txt` (**Niko**).
18. `server-einrichtung.md` Schritt 10 komplett durchlaufen (Builder bekommt 403 auf Admin-Routen, Header, Cookie-Flags, Geheimnis-Scan, `/api/betrieb` der Vorschau zeigt `schreibenAn:false`).
19. Probe „Test-PR bis auf PROD“ aus `docs/entwicklung.md` gemeinsam mit einem Builder. Alle drei melden sich an VORSCHAU und PROD an.

**Phase 6: Präsentation (H)**
20. Mit Niko die Vorführung durchspielen: Diagnose → Test ziehen → Titel (mit Titelhilfe) → Freigabe → eBay → Protokoll → Beispiel-Urteil. Ausfallplan: Screenshots oder kurzes Video, falls das Netz fehlt. Funktionsstopp einen Tag vor Abgabe.

## 7. Bekannte Stolpersteine

- **Echtes Urteil gibt es in 6 Tagen nicht:** ein Test braucht mindestens die Prüfzeit (Standard 30 Tage, in *Settings* einstellbar) plus 3 Tage Datenverzug. Deshalb gibt es die Beispiel-Urteile. Nicht versprechen, dass ein echtes Ergebnis vorliegt.
- **Chrome/Port:** 5060 gesperrt. Auch `ERR_UNSAFE_PORT` nicht mit „Server kaputt“ verwechseln.
- **eBay Analytics:** Daten in LA-Zeit; `traffic_report` mit `listing_ids` in Paketen zu 200 (ein `offset` wird ignoriert); Limit 429.
- **eBay Refresh-Token** läuft nach ca. 18 Monaten ab; bei Auth-Fehlern im Import zuerst das prüfen.
- **macOS-Besonderheit** (falls der Server ein Mac ist): Hintergrunddienste scheitern an Datenschutzfreigaben für `Desktop`/`Documents`; Ordner außerhalb anlegen (z. B. `~/parture`). Symlinks wie `/tmp` → `/private/tmp` sind im Wächter berücksichtigt.
- **`vorschau` wird hart überschrieben:** Was bleiben soll, gehört in einen Pull Request auf `main`.
- **GitHub-Branch-Schutz** gibt es für ein privates Gratis-Repo nicht (GitHub Pro nötig, gratis im Student Developer Pack). Bis Niko das aktiviert hat, gilt „nie direkt auf `main`“ nur als Absprache. Das ist ein bekanntes Restrisiko, weise Niko darauf hin.
- Die CI läuft erst, wenn die Workflow-Datei auf einem gepushten Branch liegt.

## 8. Fertig ist es, wenn

- [ ] `https://app.<domain>` und `https://vorschau.<domain>` sind nur mit Access (E-Mail-Code) und App-Login erreichbar; Probe 1 bis 4 bestanden.
- [ ] Nach Neustart des Laptops laufen beide Umgebungen und der Tunnel ohne Zutun.
- [ ] Ein Push auf `vorschau` ist nach spätestens 2 Minuten sichtbar; ein gemergter PR ist nach spätestens 10 Minuten auf PROD; ein PR mit roten Tests wird **nicht** ausgerollt (Log: ABGELEHNT).
- [ ] Traffic kommt täglich von selbst; Abdeckung plausibel; Warnbanner erscheint bei Rückstand.
- [ ] Sicherung läuft täglich, Rücksicherung wurde einmal getestet, zweiter Ort gesetzt.
- [ ] Ein echter eBay-Mini-Test (Vorschlag → Freigabe → Titel bei eBay geändert → Log → Revert) ist durchgespielt und im Log nachvollziehbar.
- [ ] Builder haben auf PROD keinen Weg zu eBay (403, keine Keys auf VORSCHAU).
- [ ] Niko hat sein Passwort geändert, die Passwortdatei ist gelöscht, `node scripts/geheimnis-scan.mjs --historie` ist sauber.
- [ ] `docs/server-checkliste.md` ist ehrlich abgehakt, offene Punkte stehen mit Grund drin.

## 9. Was du von Niko brauchst („Frag Niko“)

1. Domain bei Cloudflare, Teamname des Zero-Trust-Kontos.
2. Die vier E-Mail-Adressen für Access.
3. Ob Daten/Benutzer aus einer alten Installation (`C:\parture-pm`) übernommen werden sollen.
4. Wohin die zweite Sicherungskopie gehen soll.
5. Die 4 Angebote für den ersten echten Test und seinen Termin zum gemeinsamen Mini-Test.
6. Telegram-Bot (er legt ihn an und trägt die Werte selbst ein).
7. Abgabeformat und genauer Abgabetermin.

## 10. Kurzreferenz

```
npm test                          alle Tests (müssen grün sein)
npm run scan [-- --historie]      Geheimnis-Scan
npm run benutzer -- anlegen <name> [admin|builder] | passwort <name> | rolle <name> <rolle> | liste
npm run export                    pm.db aus eBay bauen (PROD, mit Keys)
npm run sicherung [-- liste | -- wiederherstellen <datei>]
node app/waechter.mjs --branch main --intervall 600          PROD-Wächter (läuft als Aufgabe)
node app/waechter.mjs --branch vorschau --hart --intervall 60   VORSCHAU-Wächter
GET /healthz            Lebenszeichen mit Version (ohne Anmeldung)
GET /api/betrieb        Status: Umgebung, Version, Schreibschalter, Sicherung, Traffic (angemeldet)
Logs: daten\waechter.log (Wächter), daten\app.log (App), Tab "Log" in der App (fachliches Protokoll)
```

Repo: `https://github.com/nik1231-alt/Parture-Groupwork` · eBay-Konto: `partureshop` (nur eBay, nur dieses Konto) · Rollen: Niko = admin, Alexius76 / giacomogrilli / EmbletonNova = builder.
