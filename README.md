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

```bash
npm install
cp .env.beispiel .env        # Windows: copy .env.beispiel .env
# fertig: ohne daten/pm.db nutzt die App die Team-Kopie daten-team/pm.db
npm start                    # http://127.0.0.1:5060
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

## Server

Auf dem Parture-Server läuft die App unter `C:\parture-pm` auf Port 5060 (nur lokal, noch kein Hostname).
`ensure_pm_running.ps1` hält sie am Leben (Aufgabe anlegen: `aufgabe_anlegen.ps1`), Logs in `pm.log`.
Sobald ein Hostname davor liegt, prüft die App das Cloudflare-Access-Token (`CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD` in der
Server-.env). Ohne gültiges Token antwortet sie 401, egal wie der Hostname konfiguriert ist.
- Stand Server: automatisches Ausrollen alle 10 Minuten aus origin/main (ensure_pm_running.ps1).

## Login

Die App ist nur nach Anmeldung benutzbar. Benutzer und Sitzungen liegen in `daten/app.db` (nicht im Repo), Passwörter nur als scrypt-Hash.

Benutzer anlegen (das Passwort wird verdeckt abgefragt, mindestens 10 Zeichen):

```bash
npm run benutzer -- anlegen <name>
npm run benutzer -- passwort <name>
npm run benutzer -- liste
```

Sitzungen laufen nach 12 Stunden ab. Nach 5 falschen Passwörtern ist der Benutzername 15 Minuten gesperrt. Das Cookie ist `HttpOnly` und `SameSite=Strict` (hinter HTTPS zusätzlich `Secure`).
