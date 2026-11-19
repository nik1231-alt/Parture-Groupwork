# Vorführung und Architektur (eine Seite)

## Die Idee in drei Sätzen

Wir verbessern die **Sichtbarkeit (Impressionen)** von eBay-Angeboten des Shops `partureshop` über **Titeltests**: Die App zieht per Los Test- und Kontrollgruppe, ein Builder trägt neue Titel ein, **Niko gibt frei**, erst dann ändert die App die Titel bei eBay. Nach der Prüfzeit vergleicht sie beide Gruppen und sagt „besser“, „kein Unterschied belegt“ oder „schlechter“, wobei die Verkäufe als Schutzkennzahl dienen. Alles ist im Protokoll nachvollziehbar.

## Architektur

```
Builder (3) und Admin (Niko)
        │  Browser
        ▼
Cloudflare Access (E-Mail-Code) ──► Cloudflare Tunnel ──► Server-Laptop
                                                          ├─ PROD      (main, mit eBay-Keys)  ──► eBay APIs (Trading, Analytics, Fulfillment)
                                                          └─ VORSCHAU  (vorschau, ohne Keys)
GitHub ──► Wächter ──► nur nach bestandenen Tests ──► PROD  /  Branch vorschau ──► VORSCHAU
```

Warum so:
- **Zwei Rollen, serverseitig erzwungen:** Builder schlagen vor, nur der Admin gibt frei. Die Keys liegen nur auf PROD.
- **Nichts Ungeprüftes auf PROD:** Pull Request, Review, automatische Tests, dann erst Auto-Deploy.
- **Nichts überschrieben:** Vor jeder Änderung liest die App den aktuellen Titel; weicht er ab, passiert nichts. Obergrenze 50 Änderungen je Freigabe. Probelauf, solange der Schreibschalter aus ist.
- **Lückenloses Protokoll:** nur anhängen, die Datenbank verbietet Ändern und Löschen.
- **Saubere Daten:** Traffic nur aus fertigen Tagen (3 Tage Verzug), letzte Tage nachgeprüft, Kontrolle gegen die Kontosumme, Warnung bei Rückstand.
- **Betrieb:** tägliche Sicherung mit getesteter Rücksicherung, Wächter startet die App nach Absturz neu, Meldung an Niko per Telegram.

## Ablauf der Vorführung (ca. 8 Minuten)

| # | Zeigen | Satz dazu |
|---|---|---|
| 1 | Seite *Listings*, Filter „Low impressions“ | „Von rund 740 Angeboten sehen Käufer viele kaum. Die App zeigt welche und warum.“ |
| 2 | Kopfzeile: **LIVE**, Datenstand, „traffic up to“ | „Die Zahlen kommen täglich automatisch aus der eBay-API, immer mit 3 Tagen Verzug, damit sie endgültig sind.“ |
| 3 | *Tests* → „Draw a new test“ | „Per Los: eine Hälfte bekommt neue Titel, die andere bleibt als Vergleich. So sehen wir, ob es am Titel liegt und nicht am Monat.“ |
| 4 | Als **Builder** anmelden, Titel eintragen (Titelhilfe zeigen), „Send for approval“ | „Der Builder kann nichts bei eBay ändern, nur vorschlagen.“ Niko bekommt eine Telegram-Meldung. |
| 5 | Als **Admin** → *Approvals*, alter und neuer Titel nebeneinander, „Approve“ | „Erst jetzt schreibt die App bei eBay. Sie prüft vorher, dass der Titel noch der erwartete ist.“ |
| 6 | Bei eBay: der Titel ist geändert (im zweiten Fenster) | „Echte Änderung, mit Niko‘s Zugang, nur nach Freigabe.“ |
| 7 | *Log* | „Wer hat was wann vorgeschlagen, freigegeben, geändert: nicht nachträglich änderbar.“ |
| 8 | *Tests* → „Show an example verdict“ | „Ein echtes Urteil braucht 30 Tage plus Datenverzug. So sieht es aus: besser, kein Unterschied, schlechter, mit Schutzkennzahl Verkäufe.“ |
| 9 | Kurz: VORSCHAU öffnen (Badge **PREVIEW**), `docs/entwicklung.md` | „Alle bauen weiter: Push auf `vorschau`, nach 1 bis 2 Minuten sichtbar, per Pull Request und Tests nach PROD.“ |

Ausfallplan, falls Netz oder Server streiken: Screenshots der Schritte 1 bis 8 und ein Bildschirmvideo vorher aufnehmen; lokal läuft die App auch ohne Internet mit der Team-Kopie der Daten (`npm start`).

## Ehrlich benennen (kommt bei Fragen)

- Ein echtes Test-Urteil liegt innerhalb der Projektzeit nicht vor (Prüfzeit plus Datenverzug), deshalb das Beispiel-Urteil mit erfundenen Zahlen, klar so gekennzeichnet.
- eBay kann Titeländerungen bei Angeboten mit Verkäufen ablehnen; die App zeigt dann eBays Meldung und ändert nichts.
- Die Titelhilfe liefert nur belegte Hinweise aus den eigenen Daten und nur, wenn ein Muster klar erkennbar ist. Sie erfindet keine Titel.
- Korrelation ist kein Beweis: genau dafür gibt es den Gruppenvergleich.

## Vor und während eines echten Tests

- **Shopify-Titel der Testprodukte nicht anfassen** (B1.5): Der Parture-Hub überträgt jede Titeländerung im Shopify-Shop binnen 10 Minuten nach eBay und würde den Testtitel überschreiben. Lion ist informiert.
- Gesperrte Angebote (Tabelle `sperre` in `pm.db`, heute die 50 Angebote des Preis-Abstieg-Tests bis 01.12.) kommen in kein Los.
- Revert-Plan ausfüllen, bevor der Schalter an geht: [`belege/revert-plan.md`](belege/revert-plan.md).

## Wer hat was gebaut (A5.8, offen sagen)

- **Gruppe:** Idee und fachlicher Kern: Diagnose-Regeln, Test mit Kontrollgruppe, Freigabe-Ablauf, Login und Rollen, Auswertung mit Diagrammen, Oberfläche.
- **Server-KI** (Claude, im Git als „Parture Server-KI“ und mit `Co-Authored-By` erkennbar): Server-Betrieb (zwei Umgebungen, Cloudflare, Wächter, Sicherung), der nächtliche Datenexport aus dem Hub und, zur Abgabe am 22.11., ein Teil der Tests (Routenschutz, Ende-zu-Ende-Durchlauf), der Sicherheits- und Architektur-Doku sowie der Aufräumarbeiten aus der Checkliste.
- Die genauen Anteile zeigt `git shortlog -sn` (mit `.mailmap`, ein Name je Person). **Diese Liste vor der Vorführung von der Gruppe prüfen und anpassen**: Was hier steht, muss stimmen.

## Fragen und Antworten (B4, je zwei Sätze, eine Person zuständig)

| # | Frage | Antwort | Wer |
|---|---|---|---|
| 1 | Warum kein Framework? | Rund 4.300 Zeilen mit einer einzigen Abhängigkeit, ohne Build-Schritt, jede Zeile lesbar. Der Preis: Routing und Sitzungen haben wir selbst geschrieben, dafür sind sie getestet. | … |
| 2 | Warum SQLite? | Eine Datei, die nachts atomar ausgetauscht wird, Trigger für das Protokoll, kein Datenbankserver zu betreiben. Bei fünf Nutzern braucht es nichts Größeres. | … |
| 3 | Warum keine Kosten, kein Gewinn, keine Kunden? | Der Export des Shops gibt nur eine Whitelist öffentlicher Felder heraus, das ist Firmenregel. Deshalb formulieren wir die Aufgabe über Impressionen, Menge und Preis. | … |
| 4 | Wie ist sichergestellt, dass ein Builder nichts bei eBay ändert? | Die Rolle prüft der Server bei jeder Anfrage, mit Test für jede Route; die Keys liegen nur auf PROD, und geschrieben wird nur mit Schalter. Vor jeder Änderung liest die App den Titel, alles steht im Protokoll. | … |
| 5 | Was, wenn eBay ablehnt? | Die App zeigt eBays Meldung am Vorschlag und im Protokoll. Geändert ist dann nichts. | … |
| 6 | Korrelation oder Ursache? | Das Los mit Kontrollgruppe trennt den Titel-Effekt von Saison und eBay-Schwankungen; Verkäufe sind Schutzkennzahl, die Marke liegt bei +20 %. Ein echtes Urteil braucht 30 Tage, wir zeigen den Zwischenstand nach x Tagen und das Beispiel-Urteil. | … |
| 7 | Was hat die KI gemacht, was die Gruppe? | Siehe Abschnitt oben, offen und mit Git-Zahlen. | Niko |
| 8 | Was mit einem weiteren Monat? | Automatisches Urteil nach 30 Tagen, Titelhilfe mit mehr Daten, weitere Kanäle. | … |
| 9 | Wie habt ihr zusammengearbeitet? | Branch je Aufgabe, Pull Request mit Review, CI mit Tests und Geheimnis-Scan, Vorschau nach einer Minute, PROD nur über `main`. Zahlen aus `git shortlog -sn` nennen. | … |
| 10 | Wie schützt ihr Zugangsdaten? | `.env` und Datenbanken sind git-ignoriert, der Geheimnis-Scan prüft jede Datei und die ganze Historie, die Keys liegen nur auf PROD. Davor sitzt Cloudflare Access, die App prüft dessen Token zusätzlich. | … |

## Sprecherrollen (B3.2, von der Gruppe auszufüllen)

| Schritt | Wer spricht |
|---|---|
| 1–2 Listings, Datenstand | … |
| 3–4 Test ziehen, Titel als Builder | … |
| 5–7 Freigabe, eBay, Log (Admin) | Niko |
| 8–9 Urteil, Zusammenarbeit | … |
