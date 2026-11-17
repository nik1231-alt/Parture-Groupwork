# Server einrichten: PROD und VORSCHAU

Diese Anleitung bringt die App auf den Server-Laptop (Windows; Hinweise für Mac/Linux am Ende). Sie ist so geschrieben, dass sie ein Mensch oder eine KI Schritt für Schritt abarbeiten kann. Jeder Schritt hat eine **Probe**: erst weiter, wenn sie stimmt.

## Das Zielbild

```
GitHub
  main (geprüft, per Pull Request) ──► PROD     C:\parture\prod       Port 5070   eBay-Keys, Schreiben nach Freigabe, Traffic-Import
  vorschau (Builder pushen)        ──► VORSCHAU C:\parture\vorschau   Port 5071   KEINE Keys, zeigt Änderungen nach 1 bis 2 Minuten

Browser ─► Cloudflare Access (E-Mail-Code) ─► Cloudflare Tunnel ─► 127.0.0.1:5070 / :5071 ─► App-Login (Rolle admin/builder)
```

Drei Sicherheitsregeln, die das ganze Design tragen:

1. **Die eBay-Keys liegen nur in der `.env` von PROD.** VORSCHAU hat keine. Wer Code auf VORSCHAU pushen kann, kann deshalb nie bei eBay etwas ändern oder Keys lesen.
2. **PROD übernimmt nur, was auf `main` steht und die Tests besteht.** `main` bekommt Änderungen nur über Pull Request mit Review. Wer einen Stand auf einer Maschine mit Keys ausführen lässt, könnte die Keys lesen, darum gibt es dort keinen ungeprüften Auto-Deploy.
3. **Nichts ist von außen direkt erreichbar.** Die App lauscht nur auf `127.0.0.1`. Von außen geht es nur über den Cloudflare-Tunnel, und davor steht Cloudflare Access.

## 1. Voraussetzungen (einmalig)

| Was | Probe |
|---|---|
| Node.js 22 oder neuer | `node -v` zeigt v22 oder höher |
| Git | `git --version` |
| Energie: Ruhezustand und Standby aus, nach Stromausfall automatisch starten (BIOS), WLAN bzw. LAN bleibt an | Laptop 10 Minuten nicht anfassen, danach ist er erreichbar |
| Ein Konto auf dem Server, das nur Niko benutzt | |

Der Laptop muss dauerhaft laufen und am Strom hängen. Fällt er aus, ist die App aus. Die Datensicherung und der Wächter fangen Abstürze ab, nicht aber einen ausgeschalteten Rechner.

## 2. Code holen (zwei Ordner)

```powershell
mkdir C:\parture; cd C:\parture
git clone -b main     https://github.com/nik1231-alt/Parture-Groupwork.git prod
git clone -b vorschau https://github.com/nik1231-alt/Parture-Groupwork.git vorschau
cd prod;     npm ci
cd ..\vorschau; npm ci
```

Ist das Repo privat, braucht der Server dafür einen Zugang (am einfachsten `gh auth login` mit Nikos Konto oder ein Deploy-Key **nur lesend**). Probe: `git -C C:\parture\prod pull --ff-only` meldet „Already up to date“.

> Gibt es den Branch `vorschau` noch nicht: Niko legt ihn an (`git push origin main:vorschau`), siehe `docs/entwicklung.md`.

## 3. Die `.env` je Umgebung

```powershell
copy C:\parture\prod\server\env.prod.beispiel C:\parture\prod\.env
copy C:\parture\vorschau\server\env.vorschau.beispiel C:\parture\vorschau\.env
```

Dann ausfüllen (Niko trägt die eBay-Werte selbst ein, sie werden nie in einen Chat, ein Ticket oder das Repo kopiert). Wichtig:

- PROD: `EBAY_SCHREIBEN` bleibt zunächst **leer** (Probelauf). `PM_UMGEBUNG=prod`, Port 5070.
- VORSCHAU: **keine** `EBAY_*`, kein `TELEGRAM_*`. `PM_UMGEBUNG=vorschau`, Port 5071.
- `CF_ACCESS_TEAM_DOMAIN` und `CF_ACCESS_AUD` kommen aus Schritt 6.

Probe: `git -C C:\parture\prod status` zeigt die `.env` **nicht** an (sie ist git-ignoriert). `node scripts\geheimnis-scan.mjs` meldet „sauber“.

## 4. Benutzer, erster Start, Probe

```powershell
cd C:\parture\prod
npm test                                   # alle Tests grün
npm run benutzer -- anlegen niko admin     # Passwort wird verdeckt abgefragt
node app\server.mjs                        # kurz von Hand starten
```

Probe in einem zweiten Fenster: `curl http://127.0.0.1:5070/healthz` liefert `{"ok":true,...}`, und `http://127.0.0.1:5070/` zeigt die Anmeldeseite. Dann mit Strg+C beenden. Dasselbe für `vorschau` (Port 5071) mit eigenen Benutzern. Die Konten der beiden Umgebungen sind getrennt (eigene `daten\app.db`).

Für die anderen drei Personen werden Konten als **Builder** angelegt. Die Passwörter gibt Niko persönlich weiter, nie per Chat in Klartext in einem Kanal, in dem andere mitlesen.

## 5. Wächter als Dauerdienst

```powershell
cd C:\parture\prod;     .\server\windows\installiere.ps1 -Umgebung prod
cd C:\parture\vorschau; .\server\windows\installiere.ps1 -Umgebung vorschau
```

Das legt je eine geplante Aufgabe an (startet beim Hochfahren, auch ohne Anmeldung, startet sich nach Absturz neu) und deaktiviert die alte Aufgabe `Parture PM (5060)`, die ohne Testschranke `main` zog.

Was der Wächter (`app/waechter.mjs`) tut:
- PROD: alle 10 Minuten `git fetch`. Gibt es einen neuen Stand auf `main`: nur Fast-Forward, `npm ci` bei geänderter `package-lock.json`, `npm test` **ohne eBay-Keys**. Bestanden → App neu starten. Durchgefallen → sofort zurück auf den alten Stand, die App läuft unverändert weiter, der Stand wird gemerkt und nicht erneut getestet.
- VORSCHAU: jede Minute, folgt dem Branch `vorschau` auch bei Force-Push.
- Beide: App starten, bei Absturz mit Pause neu starten, bei drei fehlenden `/healthz`-Antworten hart neu starten.

Proben:
- `Get-ScheduledTask 'Parture Waechter*'` zeigt beide Aufgaben `Running`.
- `C:\parture\prod\daten\waechter.log` zeigt „App gestartet“.
- Absturztest: den `node.exe`-Prozess der App im Task-Manager beenden → nach wenigen Sekunden läuft er wieder (Log: „App beendet … Neustart“).
- Neustart des Laptops → nach dem Hochfahren antworten beide Ports ohne Anmeldung.
- Ausroll-Test: siehe `docs/entwicklung.md`, Abschnitt „Probe: ein Test-PR bis auf PROD“.

## 6. Cloudflare: Tunnel und Access

Voraussetzung: eine **Domain**, die bei Cloudflare verwaltet wird (kostenloser Plan reicht). Ohne eigene Domain gibt es nur den vorläufigen Quick-Tunnel (wechselnde Adresse), das ist kein Dauerzustand.

**6a. Tunnel** (auf dem Server, `cloudflared` installieren, z. B. `winget install Cloudflare.cloudflared`):

```powershell
cloudflared tunnel login                          # Browser: Domain wählen
cloudflared tunnel create parture                 # gibt die TUNNEL-ID aus
cloudflared tunnel route dns parture app.DEINE-DOMAIN.de
cloudflared tunnel route dns parture vorschau.DEINE-DOMAIN.de
# Konfiguration nach C:\Users\<name>\.cloudflared\config.yml, Vorlage: server\cloudflare\config.beispiel.yml
cloudflared tunnel ingress validate
cloudflared service install                       # läuft als Windows-Dienst und startet nach Neustart wieder
```

**6b. Access** (Cloudflare Zero Trust, im Browser): *Access → Applications → Add → Self-hosted*, **zwei** Anwendungen, je eine für `app.DEINE-DOMAIN.de` und `vorschau.DEINE-DOMAIN.de`. Anmeldung: *One-time PIN* (E-Mail-Code). Regel *Allow*: **nur** die E-Mail-Adressen der vier Personen. Danach pro Anwendung die **Application Audience (AUD) Tag** kopieren und in die jeweilige `.env` als `CF_ACCESS_AUD` eintragen. `CF_ACCESS_TEAM_DOMAIN` ist `<teamname>.cloudflareaccess.com` (der Teamname steht im Zero-Trust-Dashboard, zum Beispiel unter *Settings → Custom Pages*). Danach den Wächter neu starten (`Stop-ScheduledTask -TaskName 'Parture Waechter (prod)'`, dann `Start-ScheduledTask …`), damit die App die `.env` neu liest.

Proben (alle vier müssen stimmen):
1. `https://app.DEINE-DOMAIN.de` im privaten Fenster → Cloudflare-Anmeldeseite (E-Mail-Code), **nicht** die App.
2. Mit erlaubter E-Mail anmelden → App-Anmeldeseite.
3. Mit nicht erlaubter E-Mail → abgelehnt.
4. `curl https://app.DEINE-DOMAIN.de/api/ich` ohne Access-Cookie → Cloudflare-Seite bzw. 302/403, nie ein App-Inhalt. Und selbst wenn jemand an Cloudflare vorbei den Origin träfe: die App antwortet ohne gültiges Token mit **401** (`CF_ACCESS_*` gesetzt).

Danach den vorläufigen Quick-Tunnel auf Nikos Mac beenden.

## 7. Daten und Traffic

Auf PROD, mit gesetzten Keys:

```powershell
cd C:\parture\prod
npm run export          # baut daten\pm.db: Angebote, Verkäufe, Traffic-Tageswerte
```

- Die eBay-Analytics-API hat ein hartes Abruflimit (HTTP 429). Der 90-Tage-Aufbau läuft deshalb **fortsetzbar** über mehrere Läufe/Tage (Zwischenspeicher `daten\traffic-tage.db`). Bei 429 bricht der Lauf sauber ab und macht beim nächsten Mal weiter. Bis die 90 Tage da sind, nutzt die App Zeitraumsummen.
- Danach läuft der Import **täglich ab 5 Uhr von selbst** (`EBAY_TRAFFIC_AUTO=an`), nur mit fertigen Tagen (3 Tage Verzug), die letzten 3 Tage werden nachgeprüft und gegen die Kontosumme geprüft (unter 80 % Abdeckung bricht ab, die alte Datei bleibt).
- Sichtbar in der App: Tab **Log → Traffic import** und **System**. Ist der Stand mehr als 2 Tage hinter dem Soll, erscheint oben eine gelbe Warnung und (mit Telegram) eine Meldung.

Proben: Tab Log zeigt „Last successful import“ mit heutigem Datum; oben in der App steht „traffic up to <Datum>“, das 3 Tage zurückliegt.

## 8. Sicherung

Läuft automatisch täglich ab 3 Uhr (`SICHERUNG_AUTO` nicht auf `aus`): `daten\sicherung\` (14 Stück), zusätzlich nach `SICHERUNG_ZIEL2`, wenn gesetzt (ein anderes Laufwerk oder eine Cloud-Ablage). `pm.db` wird nicht gesichert, sie lässt sich aus eBay neu bauen.

- Jetzt sichern: `npm run sicherung` oder im Tab Log **Back up now**.
- Liste: `npm run sicherung -- liste`
- **Rücksicherung testen (einmal, vor dem Ernstfall):** App stoppen (Aufgabe stoppen), `npm run sicherung -- wiederherstellen app-JJJJ-MM-TT-HHMM.db`, App starten, anmelden. Die bisherige Datei bleibt daneben als `app.db.vor-wiederherstellung-…` liegen.

## 9. Schreiben bei eBay einschalten (erst nach den Proben)

1. PROD läuft mit `EBAY_SCHREIBEN` leer. Im Tab Approvals ein Test mit 2 Angeboten einreichen und freigeben: im Log steht **Dry run** („would be changed“), bei eBay ändert sich nichts.
2. Niko wählt die 4 Angebote für den ersten echten Test aus (am besten Ladenhüter).
3. Niko setzt `EBAY_SCHREIBEN=an`, Wächter neu starten.
4. Echter Mini-Test: Builder schlägt vor → Niko gibt frei → bei eBay prüfen, dass der Titel geändert ist → Log prüfen (alter und neuer Titel, eBay-Antwort).
5. Test schließen mit „revert“ → Rückänderung freigeben → bei eBay prüfen.
6. Fehlerfälle beobachten und notieren: eBay lehnt ab (Angebote mit Verkäufen), Titel wurde von Hand geändert (die App überschreibt dann nichts), Angebot nicht aktiv.

Eine Freigabe ändert höchstens 50 Angebote auf einmal. Vor jeder Änderung liest die App den aktuellen Titel und schreibt nur, wenn er dem erwarteten entspricht.

## 10. Abschlusstest (Sicherheit)

- Builder-Konto: `/api/freigabe/erteilen`, `/api/rolle`, `/api/sicherung` liefern **403**.
- Ohne Anmeldung liefert jede `/api/…`-Adresse 401 (außer `/healthz` und Login).
- Fünf falsche Passwörter sperren den Namen, 20 falsche je Adresse sperren die Adresse.
- `curl -I https://app.DEINE-DOMAIN.de` (mit Access-Cookie) zeigt `X-Frame-Options: DENY`, `Content-Security-Policy`, und das Cookie ist `HttpOnly; SameSite=Strict; Secure`.
- `node scripts\geheimnis-scan.mjs --historie` meldet „sauber“.
- Auf VORSCHAU: `GET /api/betrieb` zeigt `schreibenAn:false`, `zugangsdaten:false`, `umgebung:"vorschau"`.

## Mac oder Linux statt Windows

Die Schritte 2 bis 4, 6 bis 10 sind gleich (Pfade und Shell anpassen). Statt der geplanten Aufgabe startet man den Wächter als Dienst:
- macOS: LaunchDaemon bzw. LaunchAgent mit `KeepAlive`, Programm `node`, Argumente `app/waechter.mjs --branch main --intervall 600`, WorkingDirectory der PROD-Ordner. (Hinweis aus der Praxis: Hintergrundprozesse mit Zugriff auf `Desktop`/`Documents` scheitern an macOS-Datenschutzfreigaben, den Ordner deshalb außerhalb davon anlegen, z. B. `/Users/<name>/parture`.)
- Linux: systemd-Unit mit `Restart=always`, `ExecStart=/usr/bin/node app/waechter.mjs --branch main --intervall 600`, `WorkingDirectory=…/prod`.

## Wenn etwas schiefgeht

| Beobachtung | Ursache und Lösung |
|---|---|
| App nach Deploy unverändert | Log lesen: `ABGELEHNT …` heißt Tests durchgefallen (Ausgabe steht im Log), `BLOCKIERT …` heißt lokale Änderung oder kein Fast-Forward im PROD-Ordner |
| 401 auf der App | `CF_ACCESS_AUD`/`CF_ACCESS_TEAM_DOMAIN` falsch oder Access-Anwendung gehört zum anderen Hostnamen |
| `Traffic import` bleibt auf Fehler | HTTP 429 = eBay-Limit, morgen weiter; sonst Meldung im Log lesen |
| Chrome zeigt `ERR_UNSAFE_PORT` | Port 5060 ist im Browser gesperrt, deshalb 5070/5071 |
| Daten veraltet-Warnung | Import prüfen (Log), eBay-Keys gültig? Refresh-Token läuft nach ca. 18 Monaten ab |
