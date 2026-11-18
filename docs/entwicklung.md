# Entwicklerleitfaden: so arbeitet die Gruppe am Tool

Für alle drei Builder und Niko. Ziel: jede Änderung ist nach 1 bis 2 Minuten für alle sichtbar, und nichts Ungeprüftes landet auf dem Live-System.

## Die Umgebungen

| Umgebung | Adresse | Was dort läuft | Wer ändert es |
|---|---|---|---|
| **lokal** | `http://127.0.0.1:5070` | dein eigener Rechner, eigene Daten | du |
| **VORSCHAU** | `https://vorschau.<domain>` | Branch `vorschau`, **ohne eBay-Keys** (kann nichts bei eBay ändern) | jeder per Push auf `vorschau` |
| **PROD** (live) | `https://app.<domain>` | Branch `main`, mit eBay-Keys und Freigabe | nur über Pull Request, den jemand anders prüft |

Oben in der App steht ein Hinweis: **PREVIEW** oder **LIVE**. Wer die Vorschau mit dem Live-System verwechselt, sieht es sofort.

## Einmal einrichten (lokal)

```bash
git clone https://github.com/nik1231-alt/Parture-Groupwork.git
cd Parture-Groupwork
npm install
cp .env.beispiel .env              # Windows: copy .env.beispiel .env  (nichts eintragen, keine eBay-Keys)
npm run benutzer -- anlegen <dein-name> admin     # lokal darfst du Admin sein, das ist nur dein Rechner
npm start                          # http://127.0.0.1:5070
```

Ohne `daten/pm.db` nutzt die App die Team-Kopie `daten-team/pm.db` (Katalog, Verkäufe, Traffic-Summen). Du brauchst **keine** Zugangsdaten. `npm run dev` startet mit Neuladen bei Änderungen.

`npm test` muss grün sein, bevor du etwas teilst (läuft in rund 30 Sekunden). `npm run scan` prüft, dass kein Geheimnis im Repo steht.

## Der Ablauf für eine Änderung

```
1. git switch -c thema/kurzname              eigener Branch (von main)
2. ändern, lokal ausprobieren, npm test
3. git push origin thema/kurzname:vorschau   zeigen: nach 1 bis 2 Minuten live auf der VORSCHAU
   (oder gleich auf vorschau mergen, siehe unten)
4. Pull Request gegen main öffnen            Beschreibung: was, warum, wie getestet
5. eine andere Person prüft und merged       nie die eigene Änderung selbst mergen
6. PROD übernimmt main nach spätestens 10 Minuten, aber nur, wenn die Tests dort bestehen
```

Regeln:
- **Nie direkt auf `main` pushen.** (GitHub erzwingt das erst mit Branch-Schutz, bis dahin gilt es als Absprache.)
- **`vorschau` ist ein Spielplatz.** Sie wird bei Bedarf hart überschrieben (Force-Push). Zwei Leute, die gleichzeitig dorthin pushen, überschreiben sich: kurz absprechen („ich habe die Vorschau gerade“). Was bleiben soll, gehört in einen Pull Request auf `main`.
- Eine Änderung pro Pull Request, mit Test, wenn sie Logik ändert (Tests liegen in `app/test*.mjs`, `node:test`).
- Keine `.env`, keine `.db` (außer `daten-team/pm.db`), kein `node_modules`, keine Passwörter, Tokens oder eBay-Daten in Commits, Issues, Pull Requests oder Chats.
- Schema-Wünsche an `pm.db` als Issue beschreiben: der Export wird dann angepasst. In `pm.db` direkt zu schreiben bringt nichts, sie wird überschrieben.

## Was bei jedem Pull Request automatisch passiert

GitHub Actions (`.github/workflows/pruefung.yml`) führt aus: `npm ci`, den **Geheimnis-Scan** (Dateien und gesamte Historie) und **alle Tests**. Ein roter Haken heißt: nicht mergen.

Auf PROD wird ein neuer `main`-Stand zusätzlich erst nach bestandenen Tests ausgerollt. Fallen sie dort durch, bleibt der alte Stand live, und das Log (`daten/waechter.log`) nennt den Grund.

## Probe: ein Test-PR bis auf PROD

Einmal nach der Einrichtung zusammen durchspielen:
1. Branch `test/probe`, eine harmlose sichtbare Änderung (z. B. ein Wort im Text der Seite *Settings*).
2. `git push origin test/probe:vorschau` → nach 1 bis 2 Minuten auf `https://vorschau.<domain>` sichtbar.
3. Pull Request gegen `main`, die CI wird grün, eine andere Person merged.
4. Nach höchstens 10 Minuten ist die Änderung auf `https://app.<domain>`. Im Tab **Log → System** steht die neue Version.
5. Änderung wieder zurücknehmen (zweiter Pull Request).

## Wie die App aufgebaut ist

```
app/server.mjs        HTTP-Server (kein Framework), Routen, Login, Rollen, Zeitplaner (Traffic-Import, Sicherung)
app/login.mjs         Benutzer, Sitzungen, Sperre bei Fehlversuchen, Passwort ändern
app/rollen.mjs        Admin / Builder
app/freigabe.mjs      Vorschläge, Freigabe, Ablehnen, Rückänderung (Obergrenze 50 je Freigabe)
app/ebay-schreiben.mjs  Titel bei eBay lesen und ändern (nur mit Keys und EBAY_SCHREIBEN=an)
app/protokoll.mjs     Protokoll, nur anhängen (Datenbank-Trigger verbieten Ändern und Löschen)
app/experimente.mjs   Tests: Los, Titel, Start, Urteil
app/titelhilfe.mjs    Wort-Hinweise aus den eigenen Daten (erfindet keine Titel)
app/demo.mjs          drei Beispiel-Urteile mit erfundenen Zahlen
app/traffic.mjs, export-ebay.mjs   Traffic-Import und Datenaufbau aus der eBay-API
app/sicherung.mjs     tägliche Sicherung, Rücksicherung
app/benachrichtigung.mjs  Telegram-Meldung an den Admin
app/waechter.mjs      Auto-Deploy mit Testschranke, App-Überwachung (nur auf dem Server)
public/               Oberfläche (reines JavaScript, Texte nur per textContent)
scripts/geheimnis-scan.mjs   Geheimnis-Scan
server/               Vorlagen für den Server (.env, Cloudflare, Windows-Aufgabe)
docs/                 diese Dokumente
```

Konventionen: Module liefern `{ ok, wert }` oder `{ ok: false, status, fehler }`. Texte aus Daten (z. B. eBay-Titel) werden nie als HTML eingesetzt. Sichtbare Texte der Oberfläche sind Englisch, Code und Kommentare Deutsch. Eingaben werden im Modul geprüft (Typ, Länge, Zustand), nicht erst in der Oberfläche.

## Was Builder nicht können (und nicht sollen)

- Bei eBay schreiben: die Keys liegen nur bei Niko auf PROD.
- Freigeben oder Rollen ändern: nur Admin (der Server prüft das, nicht nur die Oberfläche).
- Ungeprüften Code auf PROD bringen: dafür muss er über `main`, Review und Tests.

## Drei Regeln aus dem Serverbetrieb (17./18.11.2026)

- **Kindprozesse in Tests immer zu Ende warten, erst dann aufräumen.** `kill()` beendet einen Prozess nicht sofort; unter Windows hält er Dateien wie `app.db` noch offen und `rmSync` scheitert mit `EBUSY`. Muster:
  ```js
  if (server && server.exitCode === null) { const weg = new Promise((r) => server.once("exit", r)); server.kill(); await weg; }
  fs.rmSync(verz, { recursive: true, force: true });
  ```
  Startet ein Prozess selbst Kinder (der Wächter startet die App), beendet `kill()` auf den Elternprozess unter Windows das Kind **nicht** mit: die PID des Kindes merken und es selbst beenden (`app/test-waechter.mjs`).
- **Vor `npm ci` stoppt der Wächter die App** (Haken `vorInstallation`, seit PR #9). Windows sperrt die geladene `better_sqlite3.node`; ein `npm ci` bei laufender App scheitert mit `EPERM` und hinterlässt ein fast leeres `node_modules`. Wer `package.json` ändert, löst diesen Weg aus.
- **Der Wächter lädt seinen eigenen Code nur beim Start.** Eine Änderung an `app/waechter.mjs` wirkt erst, wenn die Aufgabe neu gestartet ist: Aufgabe stoppen, den alten `node …\app\server.mjs` per PID beenden (er überlebt `Stop-ScheduledTask` und hält den Port), Aufgabe starten. Das macht Niko oder die Server-KI, nicht der Wächter selbst.

Die CI prüft seit dem 19.11. auf Ubuntu **und** Windows (`.github/workflows/pruefung.yml`, Matrix), weil die beiden Fehler oben nur unter Windows auftraten. `npm test` dauert lokal rund 35 Sekunden; über 60 Sekunden gilt als Fehler, der behoben wird.
