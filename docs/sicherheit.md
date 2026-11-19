# Sicherheit: Bedrohungen, Maßnahmen, Belege

Für Gruppe, Betreuer und Vorführung. Jede Maßnahme verweist auf den Test, der sie beweist (`npm test` führt alle aus).
Zahlen gemessen am 19.11.2026 auf dem Branch `feat/sicherheit`.

**Die App enthält keine Kunden- oder Käuferdaten.** Weder `pm.db` noch `app.db` noch das Protokoll kennen Käufernamen,
Adressen, E-Mails oder einzelne Bestellungen. Der Export (`app/export-ebay.mjs`, Funktion `verkaeufe()`, Zeilen 93 bis 121 mit Kommentar)
liest aus der eBay-Bestellschnittstelle nur Artikelnummer (`legacyItemId`), Menge, Positionspreis und Bestelldatum und
verdichtet sie sofort zu vier Werten je Artikel (Stück gesamt, Stück 90 Tage, Durchschnittspreis, letztes Verkaufsdatum).
Einzelne Bestellungen werden nie gespeichert. Beleg: `app/test.mjs` → *„Keine Kundendaten: pm.db hat keine Spalten für Käufer,
und der Export liest aus Bestellungen nur Artikel, Menge, Preis, Datum"* (prüft die Spalten der Team-Kopie und genau diese
fünf Felder im Export-Code). Im Protokoll stehen nur Team-Benutzernamen, Angebotsnummern und Titel.

## Bedrohungsmodell

| # | Wer / was | Was könnte passieren | Maßnahme | Beleg (Datei → Test) |
|---|---|---|---|---|
| 1 | **Fremder im Internet** | ruft die App auf, liest Daten, probiert Adressen durch | Cloudflare Access (Login per E-Mail-Code) vor PROD und VORSCHAU; die App prüft zusätzlich das Access-JWT (Algorithmus RS256, `aud`, `exp`, Signatur gegen die Cloudflare-Schlüssel) und lehnt bei jedem Zweifel ab; App lauscht nur auf `127.0.0.1`, kein Port ist offen. Dahinter der eigene Login: jede Route außer vier bewusst öffentlichen antwortet ohne Sitzung mit 401 | `test-routen-schutz.mjs` → *„Cloudflare Access: mit gesetzter Aud nur mit gültigem JWT …"*, *„jede nicht öffentliche Route: ohne Anmeldung 401"*, *„statische Dateien: ohne Anmeldung nur die Anmeldeseite, alles andere 401"*; Server-Probe: `docs/server-checkliste.md` (B11, C5 bis C7, F5) |
| 2 | **Builder ohne Admin-Recht** | gibt sich selbst frei, macht sich zum Admin, löst Sicherung oder eBay-Import aus, schaltet das Schreiben ein | Rollen werden **im Server** geprüft (`adminNoetig`), die Oberfläche blendet nur aus. Admin-only: Rollen lesen/setzen, Freigeben, Ablehnen, direkt Starten, Traffic-Import, Sicherung. Der Schreibschalter `EBAY_SCHREIBEN` steht nur in der `.env` des Servers, keine Route und keine Einstellung kann ihn setzen | `test-routen-schutz.mjs` → *„jede Admin-Route: Builder bekommt 403, und danach ist er immer noch Builder"*, *„eBay-Schreibschalter: keine Route und keine Einstellung kann EBAY_SCHREIBEN setzen …"*; `test-rollen-http.mjs` → *„Builder: Rollen, Freigabe, Ablehnen und direktes Starten sind gesperrt (403)"*; `test-freigabe.mjs` → *„Freigabe: ein Builder kann nichts freigeben, und bei eBay passiert nichts"* |
| 3 | **Verlorener Laptop** (eines Builders) | jemand findet Passwörter, Sitzungen oder eBay-Keys | Auf Builder-Rechnern liegen keine Keys (nur PROD hat sie). Passwörter nur als scrypt-Hash mit eigenem Salz, Sitzungs-Tokens nur als SHA-256-Hash in der DB. Sitzung endet nach 12 Stunden; Passwortwechsel beendet alle anderen Sitzungen; Abmelden löscht die Sitzung im Server | `test.mjs` → *„Login: Hash ist scrypt (N=16384, r=8, p=1, 64 Byte) mit eigenem 16-Byte-Salz je Benutzer"*, *„Login: richtige Anmeldung liefert Sitzung, das Token steht nur als Hash in der Datenbank"*, *„Login: Sitzung läuft nach 12 Stunden ab …"*, *„Login: Passwort ändern prüft das alte, verlangt ein neues, beendet andere Sitzungen und gibt eine neue"*; `test-http.mjs` → *„Abmelden beendet die Sitzung serverseitig"* |
| 4 | **Geleakter Commit** | ein eBay-Token, eine `.env` oder eine Datenbank landet auf GitHub | `.env*` und `*.db` stehen in `.gitignore` (Ausnahme: die Team-Kopie ohne Kosten/Kunden). `npm run scan` sucht Token-Muster und verbotene Dateien, die CI prüft bei jedem Push die ganze Historie | `scripts/geheimnis-scan.mjs` (CI: `.github/workflows/pruefung.yml`, Schritt „Geheimnis-Scan"); Stand 19.11.: *„sauber"* |
| 5 | **Bösartiger Angebotstitel** (z. B. `<script>` im eBay-Titel) | Skript läuft im Browser eines Admins und klickt „Approve" | Daten kommen nur per `textContent` in die Seite (0× `innerHTML`); die API liefert JSON mit `nosniff`; CSP `script-src 'self'` blockiert eingeschleuste Skripte zusätzlich. Zu eBay geht der Titel XML-maskiert | `test-xss.mjs` → *„API: ein Titel mit <script> kommt als JSON-Text zurück, unverändert, nie als HTML"*, *„Oberfläche: kein innerHTML, outerHTML, …"*, *„CSP: jede HTML-Antwort erlaubt nur Skripte aus der eigenen App …"*; `test-freigabe.mjs` → *„eBay-Schreiber: Titel werden für XML maskiert …"* |
| 6 | **CSRF von einer fremden Seite** | eine Seite, die ein Admin offen hat, schickt „Freigeben" an die App | Cookie `SameSite=Strict` und `HttpOnly`; jeder POST muss `Content-Type: application/json` haben (415 sonst) und darf keinen fremden `Origin` tragen (403); CSP `form-action 'self'`, `frame-ancestors 'none'` | `test-routen-schutz.mjs` → *„CSRF: jede POST-Route lehnt eine fremde Herkunft (403) und einen falschen Typ (415) ab, auch mit gültiger Admin-Sitzung"*, *„Formulare schicken nirgendwohin außer an die eigene App"*; `test-http.mjs` → *„Schreibaktion mit Anmeldung, aber von fremder Seite oder falschem Typ: abgelehnt"* |
| 7 | **Brute Force auf den Login** | Passwörter durchprobieren oder fremde Konten sperren | Mindestlänge 10 Zeichen; nach **5** Fehlversuchen ist der Name 15 Minuten gesperrt, nach **20** Fehlversuchen über alle Namen die Adresse; gleiche Meldung und gleiche Rechenzeit für falschen Namen und falsches Passwort | `test.mjs` → *„Login: Mindestlänge genau 10 Zeichen, Sperre nach genau 5 Fehlversuchen je Name und 20 je Adresse, 15 Minuten"*, *„Login: nach 5 Fehlversuchen ist der Name gesperrt …"*, *„Login: Sperre je Adresse über alle Namen …"*, *„Login: falsches Passwort, unbekannter Name und seltsame Eingaben werden abgelehnt, mit gleicher Meldung"* |
| 8 | **Jemand pusht schlechten Code auf `main`** | PROD läuft mit kaputtem oder bösartigem Stand | Arbeitsweise: nur per Pull Request mit Review (`docs/entwicklung.md`); CI läuft bei jedem PR. Der Wächter rollt nur aus, wenn `npm test` grün ist, sonst läuft der alte Stand weiter; nur Fast-Forward; Geheimnisse des Wächters kommen nicht in den Testlauf | `test-waechter.mjs` → *„durchgefallene Tests: Rückfall auf den alten Stand …"*, *„kein Fast-Forward (lokaler Commit auf dem Server): PROD blockiert …"*, *„Geheimnisse aus der Umgebung des Wächters kommen nicht in den Testlauf"* (Branch-Schutz auf GitHub ist bis jetzt Absprache, nicht erzwungen) |
| 9 | **eBay lehnt ab oder jemand hat den Titel von Hand geändert** | die App überschreibt etwas Falsches oder verliert den Überblick | Schreiben nur mit allen drei Keys **und** `EBAY_SCHREIBEN=an`; vor jeder Änderung wird der Titel gelesen, weicht er ab, wird nichts geschrieben; höchstens 50 Angebote je Freigabe; jeder Ausgang (geändert, verweigert, Fehler, Probelauf) steht im Protokoll, das nur angehängt werden kann; Freigabe als Zustandsautomat, unerlaubte Übergänge 409 | `test-freigabe.mjs` → *„eBay-Riegel 1 … 4"*, *„Freigabe: wurde der Titel bei eBay inzwischen von Hand geändert, wird nichts überschrieben"*, *„Freigabe: lehnt eBay die Änderung ab …"*, *„Obergrenze: …"* (2 Tests), *„Zustandsautomat: …"* (3 Tests); `test-freigabe.mjs` → *„Protokoll: es wird nur angehängt, Ändern und Löschen schlagen fehl"* |
| 10 | **Hub liefert veraltete oder kaputte Daten** | Entscheidungen auf alten Zahlen, halbe Datei | `pm.db` wird nur ersetzt, wenn der Neubau fertig ist (atomar), sonst bleibt die alte; die App zeigt den Datenstand und warnt ab 2 Tagen Rückstand; ein Hub-Fehler wird als 502 gemeldet statt still alte Daten zu zeigen | `test-betrieb-http.mjs` → *„Datenstand: Soll = heute minus Verzögerung. Pünktlich ist unauffällig, 1 Tag Rückstand auch, ab 2 Tagen veraltet"*; `test-traffic.mjs` → *„Abruf: ein kurzer Fehler wird wiederholt, ein dauerhafter Fehler bricht ab statt einen halben Tag zu liefern"* |

## Die Punkte der Checkliste A3 einzeln

| # | Punkt | Beleg |
|---|---|---|
| A3.2 | Jede Route: ohne Login 401, Builder auf Admin-Route 403 | `test-routen-schutz.mjs` liest `ROUTEN`, `POST_ROUTEN` und die direkt behandelten Adressen aus `app/server.mjs`: **34 Routen** (Methode + Pfad), davon 33 unter `/api` plus `/healthz` (31 verschiedene `/api`-Pfade; `/api/einstellungen` und `/api/experiment` gibt es als GET und POST). 30 brauchen eine Anmeldung, 7 davon nur für Admins (erkannt an `adminNoetig`, Pflichtliste im Test). Öffentlich mit Begründung: `/healthz`, `POST /api/login`, `GET /api/ich`, `POST /api/logout`. Eine neue ungeschützte Route lässt den Test fehlschlagen |
| A3.3 | scrypt mit Salz, Sperre nach 5 (Name) bzw. 20 (Adresse), Mindestlänge 10, Passwortwechsel beendet andere Sitzungen, Logout löscht serverseitig | siehe Zeilen 3 und 7; zusätzlich `test-rollen-http.mjs` → *„Passwort ändern über den Server: … alte Sitzung endet …"* |
| A3.4 | Cookie HttpOnly, SameSite=Strict, Secure nur über HTTPS, Laufzeit 12 Stunden | `test-routen-schutz.mjs` → *„Cookie: HttpOnly und SameSite=Strict immer, Secure nur über HTTPS (hinter Cloudflare), Laufzeit begrenzt"*; `test.mjs` → *„Login: Cookie wird gelesen und ist HttpOnly, SameSite=Strict, bei HTTPS Secure"* |
| A3.5 | Origin-Prüfung bei POST, keine Formulare an fremde Hosts | Zeile 6 |
| A3.6 | XSS | Zeile 5 |
| A3.7 | Eingaben im Modul geprüft: Titel höchstens 80 Zeichen, Artikelnummer nur Ziffern (6 bis 20), Test-Id positive ganze Zahl, Freigabe-Zustände | `test.mjs` → *„Titel eintragen: nur für die Testgruppe, geprüft, überschreibbar"* (81 Zeichen → 400, 80 erlaubt); `test-freigabe.mjs` → *„Eingaben: Test-Id nur als positive ganze Zahl, Art nur titel/zurueck, eBay-Artikelnummer nur aus Ziffern"*, *„Zustandsautomat: abgelehnt ist endgültig …"*, *„… angewendet ist endgültig …"*, *„… verworfen …"*, *„Einreichen: … nicht zweimal einreichen"* |
| A3.8 | Geheimnisse | Zeile 4. `npm run scan` am 19.11.: sauber |
| A3.9 | Rollen serverseitig | Zeile 2 |
| A3.10 | Außenzugang | Zeile 1 |
| A3.11 | eBay-Schreibweg, ein Test je Riegel | `test-freigabe.mjs` → *„eBay-Riegel 1: ohne alle drei Zugangsdaten geht kein Aufruf raus, auch mit EBAY_SCHREIBEN=an"*, *„eBay-Riegel 2: nur genau EBAY_SCHREIBEN=an schaltet das Schreiben ein"*, *„eBay-Schreiber: ohne EBAY_SCHREIBEN=an wird nie geschrieben …"*, *„eBay-Riegel 3: Lesen vor Schreiben mit dem echten Schreiber …"*, *„Obergrenze: …"*, *„eBay-Riegel 4: jeder Ausgang steht im Protokoll …"* |
| A3.12 | Abhängigkeiten und Node-Version | eine direkte Abhängigkeit (`better-sqlite3`, mit 38 indirekten Paketen); `npm audit --omit=dev` am 19.11.: *„found 0 vulnerabilities"*. Node festgelegt: `"engines": { "node": ">=22" }` in `package.json`, `.nvmrc` = `22` (Server: Node 22.22.3, CI: Node 22) |
| A3.13 | Keine Kundendaten | Satz oben |

## Warum das Cookie lokal nicht `Secure` ist

Ein Cookie mit `Secure` schickt der Browser nur über HTTPS zurück. Lokal läuft die App über `http://127.0.0.1:5070`, dort wäre
man nach dem Login sofort wieder abgemeldet. Die App setzt `Secure` deshalb genau dann, wenn die Anfrage über HTTPS kam: auf
dem Server terminiert Cloudflare HTTPS und meldet das mit `X-Forwarded-Proto: https`, also tragen alle Cookies auf PROD und
VORSCHAU `Secure`. Lokal verlässt der Verkehr den Rechner nicht (die App lauscht nur auf `127.0.0.1`), es gibt nichts
mitzulesen. Ein Angreifer, der den Header selbst setzt, macht das Cookie nur strenger, nie schwächer.

## Außenzugang

Beide Umgebungen liegen hinter Cloudflare Access (Login per E-Mail-Code nur für das Team). Ist in der `.env` des Servers
`CF_ACCESS_TEAM_DOMAIN` und `CF_ACCESS_AUD` gesetzt, nimmt die App zusätzlich **nur** Anfragen mit gültigem Access-JWT an
(`accessOk()` in `app/server.mjs`: RS256, `aud` enthält die eigene Anwendung, `exp` nicht abgelaufen, Signatur gegen die
öffentlichen Schlüssel von `https://<team>/cdn-cgi/access/certs`). Das schützt auch dann, wenn jemand einen Hostnamen einmal
ohne Access-Regel anlegt. Die App und ihre Wächter lauschen nur auf `127.0.0.1`; von außen erreichbar ist nur der Cloudflare-Tunnel.
Einrichtung und Probe von außen: `docs/server-checkliste.md` (B11, C1 bis C8, F5) und `docs/server-einrichtung.md` Schritt 6.

## Bekannte Grenzen (ehrlich)

- Die Fehlversuchszähler liegen im Speicher, ein Neustart setzt sie zurück. Für ein Team von fünf Personen hinter Cloudflare Access reicht das.
- Das Protokoll ist innerhalb der App nur anhängbar (Trigger in der DB). Wer direkt an `daten/app.db` kommt, könnte die Trigger entfernen: es ist ein Nachweis, kein manipulationssicherer Beleg.
- Einstellungen (Schwellen der Diagnose, Testgröße) dürfen auch Builder ändern und zurücksetzen. Sie ändern nichts bei eBay, aber die Vorschläge der App.
- Die JWT-Prüfung prüft keinen Aussteller (`iss`); die `aud` ist je Access-Anwendung eindeutig und die Signatur stammt von den Schlüsseln der eigenen Team-Domain.
- Branch-Schutz auf GitHub ist noch nicht erzwungen, nur abgesprochen (`docs/entwicklung.md`).
