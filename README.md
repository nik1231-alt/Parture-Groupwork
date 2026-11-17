# Parture Groupwork — Produktmanagement

Gruppenarbeit Programmierung. Wir bauen ein Produktmanagement für den 3D-Druck-Shop **Parture**
(ca. 750 Produkte auf eBay, Amazon, Etsy, eigenem Shop und TikTok): Welche Produkte laufen, welche
nicht, was gehört saniert, ausgelistet oder beworben.

## Daten

Die App arbeitet auf **`daten/pm.db`** (SQLite, ~1,3 MB). Das ist eine Kopie mit genau diesen Feldern:

| Tabelle | Spalten |
|---|---|
| `produkt` | `number`, `title`, `image_url`, `variants`, `variant_meta`, `grams`, `print_s`, `ship_method`, `status`, `created_at`, `units_total`, `units_90d`, `avg_price`, `last_sold_at` |
| `kanal` | `number`, `channel`, `listed`, `external_id`, `title`, `skus`, `preis_aktuell`, `kanal_status`, `geplant_ab`, `units_total`, `units_90d`, `avg_price`, `last_sold_at` |
| `bild` | `number`, `url`, `position`, `kind` |
| `stand` | wann exportiert, wie viele Zeilen |

**Nicht enthalten, bewusst:** Einkaufs- und Herstellkosten, Gebühren, Deckungsbeitrag, Umsatz in Euro,
Kunden, Bestellungen, Adressen. Preise und Stückzahlen sind öffentlich (stehen so bei eBay), Kosten nicht.
Aufgaben werden deshalb über **Menge, Preis und Rangfolge** formuliert, nicht über Gewinn.

Die **Team-Kopie** liegt im Repo unter `daten-team/pm.db` (Stand: eBay-API, Konto partureshop, nur Katalog, Menge, Preis, Traffic, Bilder).
Sie ist bewusst eingecheckt, damit alle ohne Zugangsdaten arbeiten können. Die App nutzt sie, wenn es keine `daten/pm.db` gibt.
`daten/` ist git-ignoriert: dort liegt auf dem Server die Nachtlauf-Datei (04:30), lokal ein eigener Export.
**Nur der Admin** aktualisiert die Team-Kopie mit `npm run export:team` (braucht die eBay-Keys) und committet sie. Keys, `.env` und alles mit Kosten oder Kundendaten gehören nie ins Repo.

## Lokal starten

> Wichtig für Chrome: Port 5060 ist im Browser gesperrt (`ERR_UNSAFE_PORT`, SIP). Deshalb nutzt die Vorlage `.env.beispiel` jetzt 5070.
> Hast du eine ältere `.env` mit `PM_PORT=5060`, ändere sie auf 5070.

```bash
npm install
cp .env.beispiel .env        # Windows: copy .env.beispiel .env
# fertig: ohne daten/pm.db nutzt die App die Team-Kopie daten-team/pm.db
npm start                    # http://127.0.0.1:5070
```

`npm run dev` startet mit Neuladen bei Dateiänderungen.

## Aufbau

```
app/server.mjs     HTTP-Server ohne Framework: /api/stand, /api/produkte?q=, /api/produkt?nr=, /api/kanaele, /api/live
public/index.html  Oberfläche (Suche, Kanal-Kacheln, Produktliste)
daten-team/pm.db   Team-Kopie der Daten (im Repo, vom Admin aktualisiert)
daten/pm.db        eigener Export bzw. Server-Nachtlauf (nicht im Repo)
app/export-ebay.mjs  baut pm.db aus der eBay-API (nur Admin, braucht Keys)
```

`/api/live` funktioniert nur auf dem Server (holt den aktuellen Stand vom Hub über einen eigenen Token).
Lokal liefert sie 503, das ist richtig so.

## Zusammenarbeit

- **Nie direkt auf `main` pushen.** Branch je Aufgabe (`git switch -c thema/kurzname`), Pull Request gegen `main`, eine
  andere Person schaut drüber und merged. GitHub erzwingt das auf einem privaten Gratis-Repo nicht (Branch-Schutz braucht
  GitHub Pro, gibt es für Studierende kostenlos im GitHub Student Developer Pack), also gilt es als Absprache.
- Kein `node_modules`, keine `.env`, keine `.db` im Commit außer `daten-team/pm.db` (die `.gitignore` fängt das ab).
- Schema-Wünsche an `pm.db` (neue Spalte, neue Tabelle) als Issue beschreiben; der Export auf dem Server
  wird dann angepasst. Direkt in `pm.db` schreiben bringt nichts, sie wird nachts überschrieben.

## eBay-Zugangsdaten (nur Admin)

Die eBay-API-Keys (`EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET`, `EBAY_REFRESH_TOKEN`) liegen **nur beim Admin**, in dessen lokaler
`.env` und in der `.env` auf dem Server. Sie gehören nie ins Repo, auch nicht in Issues, Pull Requests oder Chats.
Wer die Keys braucht, fragt den Admin. Einmal committete Keys bleiben im Git-Verlauf und müssten bei eBay neu ausgestellt werden.

## Server und Zusammenarbeit

Die App läuft auf dem Parture-Server in zwei Umgebungen: **PROD** (Branch `main`, mit eBay-Keys, Freigabe, Traffic-Import) und **VORSCHAU** (Branch `vorschau`, ohne Keys, zeigt Änderungen nach 1 bis 2 Minuten). Zugang nur über Cloudflare Access mit E-Mail-Code und danach den App-Login.
Ein Wächter (`app/waechter.mjs`) rollt neue Stände nur nach bestandenen Tests aus und hält die App am Leben.

- Einrichtung Schritt für Schritt (mit Proben): [`docs/server-einrichtung.md`](docs/server-einrichtung.md)
- So arbeitet die Gruppe (Branches, Vorschau, Pull Request, Review): [`docs/entwicklung.md`](docs/entwicklung.md)
- Fortschritt der Einrichtung: [`docs/server-checkliste.md`](docs/server-checkliste.md)
- Übergabe an die KI auf dem Server-Laptop: [`docs/uebergabe-server-ki.md`](docs/uebergabe-server-ki.md)

## Login

Die App ist nur nach Anmeldung benutzbar. Benutzer und Sitzungen liegen in `daten/app.db` (nicht im Repo), Passwörter nur als scrypt-Hash.

Benutzer anlegen (das Passwort wird verdeckt abgefragt, mindestens 10 Zeichen):

```bash
npm run benutzer -- anlegen <name>
npm run benutzer -- passwort <name>
npm run benutzer -- liste
```

Sitzungen laufen nach 12 Stunden ab. Nach 5 falschen Passwörtern ist der Benutzername 15 Minuten gesperrt, nach 20 falschen Versuchen von einer Adresse (über alle Namen) die Adresse. Jede Person ändert ihr Passwort selbst unter *Account*. Das Cookie ist `HttpOnly` und `SameSite=Strict` (hinter HTTPS zusätzlich `Secure`).

## Rollen: Admin und Builder

- **Builder** bauen: Tests anlegen, neue Titel eintragen, Tests **zur Freigabe senden**. Sie ändern nichts bei eBay.
- **Admin** gibt Vorschläge frei (Tab **Approvals**), vergibt Rollen (Tab **Team**) und sieht alles. Es gibt immer mindestens einen Admin.
- Neue Benutzer sind Builder. Der erste Benutzer wird automatisch Admin. Auf dem Rechner, auf dem die App läuft:

```bash
npm run benutzer -- anlegen <name> [admin|builder]
npm run benutzer -- rolle <name> <admin|builder>
npm run benutzer -- liste
```

## Änderungen bei eBay: Vorschlag, Freigabe, Protokoll

1. Builder trägt im Test die neuen Titel ein und klickt **Send for approval**. Es wird noch nichts bei eBay geändert.
2. Ein Admin prüft im Tab **Approvals** (alter und neuer Titel nebeneinander) und gibt frei. Erst dann ändert die App die Titel bei eBay.
3. Vor jeder Änderung liest die App den aktuellen Titel bei eBay. Weicht er vom erwarteten ab (z. B. von Hand geändert), wird **nichts überschrieben**.
4. Sind alle Titel geändert, startet der Test, und die Ausgangszahlen werden in diesem Moment festgehalten.
5. Schließt man einen Test mit **revert**, entstehen Rückänderungen auf die alten Titel. Auch die muss ein Admin freigeben.
6. Jede Aktion steht im Tab **Log**: Vorschlag, Freigabe, Ablehnung, jede einzelne eBay-Änderung mit altem und neuem Titel und eBay-Antwort, Rollenwechsel, Traffic-Import. Das Protokoll wird nur ergänzt, nie geändert.

**Schreibschalter:** Bei eBay wird nur geschrieben, wenn auf dem Admin-Rechner in der `.env` `EBAY_SCHREIBEN=an` steht und dort die eBay-Keys liegen.
Ohne den Schalter ist die Freigabe ein **Probelauf** (die Angebote werden gelesen und geprüft, nichts wird geändert).
eBay kann Titeländerungen ablehnen (zum Beispiel bei Angeboten mit Verkäufen). Die Meldung von eBay steht dann am Vorschlag und im Log.

Wichtig: Alle arbeiten nur dann am **gleichen** Stand, wenn sie dieselbe laufende App benutzen. Die Daten der App (Benutzer, Tests, Vorschläge, Log) liegen in `daten/app.db`
des Rechners, auf dem sie läuft, und nicht im Repo.

## Traffic: täglich automatisch, mit Verzögerung

Der Traffic kommt als **Tageswerte je Listing** (Tabelle `traffic_tag`). Daraus werden die 30- und 90-Tage-Summen gebildet, jeweils bis zum **Stichtag = heute minus 3 Tage**.
Nur Tage, die so alt sind, gelten als fertig. Die letzten 3 Tage vor dem Stichtag werden bei jedem Lauf noch einmal geholt und mit den gespeicherten verglichen (Abweichungen werden überschrieben und gezählt).
Zur Kontrolle wird je Tag die Summe aller Listings mit der Kontosumme von eBay verglichen. Liegt der Anteil im Mittel unter 80 %, gilt der Lauf als fehlerhaft und die alte Datei bleibt.

- Automatisch: auf dem Rechner mit den eBay-Keys `EBAY_TRAFFIC_AUTO=an` in die `.env` und die App laufen lassen. Sie importiert einmal täglich ab 5 Uhr (`TRAFFIC_UHRZEIT`).
- Von Hand: `npm run export` oder im Tab **Log** den Knopf **Import now** (nur Admin).
- Team-Kopie für alle: `npm run export:team` schreibt zusätzlich `daten-team/pm.db` (ohne die Tagesdaten). Diese Datei checkt der Admin ein.


## Betrieb: Sicherung, Meldungen, Status

- **Sicherung:** täglich ab 3 Uhr von `app.db` (Benutzer, Tests, Freigaben, Protokoll) und `traffic-tage.db`, 14 Stück in `daten/sicherung`, optional zusätzlich in `SICHERUNG_ZIEL2`. `npm run sicherung` (jetzt), `-- liste`, `-- wiederherstellen <datei>`.
- **Meldung an den Admin** (Telegram, optional): neuer Vorschlag wartet, Traffic-Import oder Sicherung fehlgeschlagen. Nur mit `TELEGRAM_BOT_TOKEN` und `TELEGRAM_CHAT_ID`.
- **Status:** Tab *Log* zeigt Umgebung, Version, Schreibschalter, Sicherung und Traffic-Import. Ist der Traffic mehr als 2 Tage hinter dem Soll, warnt die App oben.
- **Obergrenze:** eine Freigabe ändert höchstens 50 Angebote.
- **Titelhilfe:** im Test zeigt die App unter jedem Titelfeld Wörter, die in den am besten gesehenen eigenen Angeboten oft vorkommen und hier fehlen (Klick hängt sie an). Sie schreibt keine Titel.
- **Beispiel-Urteil:** im Tab *Tests* zeigt ein aufklappbarer Bereich drei Beispiel-Urteile mit erfundenen Zahlen, berechnet mit den echten Regeln.
- **Geheimnis-Scan:** `npm run scan` (und `-- --historie`), läuft auch bei jedem Pull Request.
