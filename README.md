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

`daten/` ist git-ignoriert. Die Datei kommt vom Server (dort wird sie jede Nacht 04:30 neu gebaut) oder
als Kopie aus dem Team. Daten gehen nie über Git.

## Lokal starten

```bash
npm install
cp .env.beispiel .env        # Windows: copy .env.beispiel .env
# daten/pm.db aus dem Team holen
npm start                    # http://127.0.0.1:5060
```

`npm run dev` startet mit Neuladen bei Dateiänderungen.

## Aufbau

```
app/server.mjs     HTTP-Server ohne Framework: /api/stand, /api/produkte?q=, /api/produkt?nr=, /api/kanaele, /api/live
public/index.html  Oberfläche (Suche, Kanal-Kacheln, Produktliste)
daten/pm.db        die Daten (nicht im Repo)
```

`/api/live` funktioniert nur auf dem Server (holt den aktuellen Stand vom Hub über einen eigenen Token).
Lokal liefert sie 503, das ist richtig so.

## Zusammenarbeit

- **Nie direkt auf `main` pushen.** Branch je Aufgabe (`git switch -c thema/kurzname`), Pull Request gegen `main`, eine
  andere Person schaut drüber und merged. GitHub erzwingt das auf einem privaten Gratis-Repo nicht (Branch-Schutz braucht
  GitHub Pro, gibt es für Studierende kostenlos im GitHub Student Developer Pack), also gilt es als Absprache.
- Kein `node_modules`, keine `.env`, keine `.db` im Commit (die `.gitignore` fängt das ab).
- Schema-Wünsche an `pm.db` (neue Spalte, neue Tabelle) als Issue beschreiben; der Export auf dem Server
  wird dann angepasst. Direkt in `pm.db` schreiben bringt nichts, sie wird nachts überschrieben.

## Server

Auf dem Parture-Server läuft die App unter `C:\parture-pm` auf Port 5060 (nur lokal, noch kein Hostname).
`ensure_pm_running.ps1` hält sie am Leben (Aufgabe anlegen: `aufgabe_anlegen.ps1`), Logs in `pm.log`.
Sobald ein Hostname davor liegt, prüft die App das Cloudflare-Access-Token (`CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD` in der
Server-.env). Ohne gültiges Token antwortet sie 401, egal wie der Hostname konfiguriert ist.
- Stand Server: automatisches Ausrollen alle 10 Minuten aus origin/main (ensure_pm_running.ps1).
