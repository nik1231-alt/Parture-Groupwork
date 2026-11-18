# Architektur auf einer Seite

## Bild

```
 Builder (3), Admin (Niko)
        │ Browser
        ▼
 Cloudflare Access (E-Mail-Code, 4 Adressen) ──► Cloudflare Tunnel ──► Server-Laptop (Windows), Ports nur 127.0.0.1
                                                                        │
                        ┌───────────────────────────────────────────────┴──────────────────────┐
                        ▼                                                                      ▼
              PROD  app/server.mjs :5070  (Branch main)                          VORSCHAU :5071 (Branch vorschau, ohne eBay-Keys)
                │ liest                     │ schreibt                 │ nach Freigabe, Schalter an
                ▼                           ▼                          ▼
             pm.db  ◄── 04:30 Hub-Export   app.db                    eBay Trading-API (nur Titel)
             (Whitelist, nur lesen)        (Benutzer, Sitzungen,
                                            Tests, Freigaben, Protokoll)

 GitHub (Pull Request + CI) ──► Wächter app/waechter.mjs ──► npm ci, npm test ──► nur bei Grün: App neu starten
```

## Datenfluss

1. **Nachts (04:30)** schreibt der Parture-Hub `pm.db`: nur Whitelist-Spalten (Katalog, Kanäle, Mengen, Preise, Bilder,
   Traffic-Zähler, Sperrliste). Die Datei wird fertig geschrieben und erst dann atomar ausgetauscht. Kosten und Kunden
   kommen nie hinein, der Export prüft Spaltennamen und Texte vor dem Austausch.
2. **Die App öffnet `pm.db` bei jeder Anfrage neu und nur lesend** (`mitDb` in `app/server.mjs`), damit sie nach dem
   nächtlichen Austausch nicht auf der alten Datei hängt.
3. **`app.db`** gehört der App: Benutzer, Sitzungen, Einstellungen, Tests, Freigaben, Protokoll. Sie wird täglich gesichert.
4. **Zu eBay** geht nur ein Weg: Freigabe durch einen Admin → `app/freigabe.mjs` → `app/ebay-schreiben.mjs`. Vorher wird der
   aktuelle Titel gelesen; weicht er ab, passiert nichts. Ohne Keys oder ohne `EBAY_SCHREIBEN=an` ist es ein Probelauf.
5. **Auswertung:** Ausgangszahlen werden beim Teststart festgehalten, danach vergleicht `app/experimente.mjs` und
   `app/auswertung.mjs` Test- gegen Kontrollgruppe über die Prüfzeit, mit 3 Tagen Datenverzug.

## Entscheidungen

| Entscheidung | Warum | Verworfene Alternative |
|---|---|---|
| **Kein Framework**, `node:http` und reines JavaScript im Browser | ca. 4.300 Zeilen, eine Abhängigkeit (`better-sqlite3`), kein Build-Schritt, jede Zeile lesbar und testbar | Express/React: schneller am Anfang, aber Build, viele Abhängigkeiten, Magie, die in der Vorführung niemand erklären kann. Preis: Routing und Sitzungen selbst geschrieben, dafür mit Tests |
| **SQLite** für Daten und App-Zustand | eine Datei, atomarer Austausch von `pm.db`, Trigger für das Protokoll, kein Datenbankserver zu betreiben | PostgreSQL: Mehrbenutzer-Stärke, die bei 5 Personen niemand braucht, dafür ein Dienst mehr |
| **Whitelist-Daten** statt Zugriff auf die Firmendatenbank | die Gruppe sieht nur, was ohnehin öffentlich ist; Firmenregel: keine Kosten, keine Kunden | geschwärzte Kopie: eine neue Spalte im Original wäre still mitgekommen |
| **Zwei Umgebungen** (PROD mit Keys, VORSCHAU ohne) | alle sehen Änderungen nach 1 bis 2 Minuten, ohne dass Ungeprüftes bei eBay schreiben kann | nur lokal: niemand arbeitet am gleichen Stand; nur PROD: jeder Versuch wäre live |
| **Wächter** auf dem Server statt Hosting-Dienst | Daten und Keys bleiben auf dem Firmenrechner; Ausrollen nur nach grünen Tests, Neustart bei Absturz oder Hängen, Sicherung | Render/Fly/Vercel: Keys und Daten bei Dritten, Kosten, und `pm.db` käme nicht hin |
| **Los mit Kontrollgruppe** statt Vorher/Nachher | Impressionen schwanken mit Saison und eBay; nur der Vergleich zur gleichzeitig unveränderten Gruppe zeigt den Titel-Effekt | Vorher/Nachher: ein Dezember sieht immer besser aus als ein Oktober |
| **Freigabe durch einen Menschen** vor jeder eBay-Änderung | echte Angebote eines echten Shops; Fehler kosten Geld | automatische Änderung: schneller, aber kein Schutz gegen Tippfehler oder falsche Gruppe |
| **Protokoll nur anhängen** (Datenbank-Trigger) | Nachweis, wer was wann getan hat, auch gegen Fehler der App selbst | normale Tabelle: ein Programmfehler könnte Einträge überschreiben |
| **Titelhilfe zeigt nur Wörter**, erfindet keine Titel | Vorgabe aus dem Briefing; ein Mensch entscheidet, jede Zahl ist belegt | KI-generierte Titel: nicht nachvollziehbar, und genau das soll der Test ja erst zeigen |

## Was die App bewusst nicht macht

Amazon und andere Marktplätze, Kosten oder Gewinn, Kundendaten, Preisänderungen, automatische Freigabe, KI-Titel.
Begründung jeweils oben oder in [`checkliste-tool.md`](checkliste-tool.md), Abschnitt D.
