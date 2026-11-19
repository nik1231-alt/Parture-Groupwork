# Parture Groupwork: Titeltests für eBay-Angebote

Gruppenarbeit Programmierung. Der 3D-Druck-Shop **Parture** (`partureshop`, rund 740 eBay-Angebote) hat viele Angebote,
die Käufer kaum zu sehen bekommen. Diese App findet sie, testet neue Titel im **Gruppenvergleich mit Kontrollgruppe**
und sagt nach der Prüfzeit, ob die neuen Titel mehr **Impressionen** bringen, ohne dass die Verkäufe leiden.
Bei eBay geändert wird nur, was ein Admin freigegeben hat, und jede Aktion steht in einem Protokoll, das sich nicht ändern lässt.

## Die Seiten

| Seite | Wer | Was |
|---|---|---|
| **Listings** | alle | alle Angebote mit Bereich („Low impressions“ …), Empfehlung, Begründung, Traffic 30/90 Tage |
| **Tests** | alle | Test per Los ziehen, neue Titel eintragen (mit Titelhilfe), zur Freigabe senden, Auswertung mit Diagrammen, Beispiel-Urteil |
| **Ladder** | alle (Freigabe: Admin) | die Leiter für Angebote mit wenig Impressionen: KI-Titel → Werbung → Preis → manuelle Prüfung, mit Prüfzeit und Lebenslauf je Angebot |
| **Approvals** | Admin | alter und neuer Titel nebeneinander, Approve / Reject, höchstens 50 Angebote je Freigabe |
| **Team** | Admin | Rollen vergeben |
| **Log** | alle | Protokoll (nur anhängen) und Betriebsstatus: Umgebung, Version, Schreibschalter, Sicherung, Datenstand |
| **Settings** | alle | Regelwerte (Testgröße, Prüfzeit, Zielmarke +20 %, Schutzgrenze Verkäufe) |
| **Account** | alle | eigenes Passwort ändern |

## Rollen

- **Builder** ziehen Tests, tragen Titel ein und senden sie zur Freigabe. Sie können bei eBay nichts ändern.
- **Admin** gibt frei oder lehnt ab, vergibt Rollen, startet Sicherung und Traffic-Import. Es gibt immer mindestens einen Admin; der erste Benutzer wird Admin, alle weiteren sind Builder.
- Der **Server** prüft die Rolle bei jeder Anfrage, die Oberfläche blendet nur aus (Test: `app/test-rollen-http.mjs`).

## Datenweg

```
Parture-Hub (Firmendaten)  ──04:30 nachts, nur Whitelist──►  pm.db  ──nur lesen──►  App  ──nach Freigabe──►  eBay (Titel)
                                                                                      │
                                                                                      └──►  app.db (Benutzer, Tests, Freigaben, Protokoll)
```

- **`pm.db`** (SQLite) enthält nur öffentliche oder technische Felder: `produkt`, `kanal`, `bild`, `traffic` (30/90-Tage-Summen),
  `traffic_tag` (Tageswerte je Angebot), `sperre` (Angebote eines laufenden Shop-Versuchs, die in keinen Titeltest dürfen) und `stand`.
- **Nicht enthalten, bewusst:** Kosten, Gebühren, Deckungsbeitrag, Umsatz in Euro, Kunden, Bestellungen, Adressen.
  Aufgaben werden deshalb über Impressionen, Menge und Preis formuliert, nicht über Gewinn.
- **Datenverzug 3 Tage:** eBay korrigiert die letzten Tage nachträglich, deshalb zählen nur fertige Tage. Liegt der Datenstand mehr als 2 Tage hinter dem Soll, warnt die App oben.
- Reihenfolge, welche Datei die App nimmt: `PM_DB` aus der `.env`, sonst `daten/pm.db` (Server-Nachtlauf), sonst die **Team-Kopie** `daten-team/pm.db` aus dem Repo.
- Die eigenen Daten der App liegen in `daten/app.db` des Rechners, auf dem sie läuft, nicht im Repo. Gleicher Stand für alle heißt: dieselbe laufende App (VORSCHAU oder PROD).

## Lokal starten

Voraussetzung: Node.js 22 (`.nvmrc`). Keine Zugangsdaten nötig.

```bash
git clone https://github.com/nik1231-alt/Parture-Groupwork.git
cd Parture-Groupwork
npm install
cp .env.beispiel .env                         # Windows: copy .env.beispiel .env   (nichts eintragen)
npm run benutzer -- anlegen <dein-name>       # Passwort wird verdeckt abgefragt, mindestens 10 Zeichen; der erste Benutzer wird Admin
npm start                                     # http://127.0.0.1:5070
```

Port 5060 sperrt Chrome (`ERR_UNSAFE_PORT`), deshalb 5070. `npm run dev` startet mit Neuladen bei Änderungen.

| Befehl | Was |
|---|---|
| `npm test` | alle Tests (Node-eigener Test-Runner), rund 35 Sekunden; muss vor jedem Pull Request grün sein |
| `npm run scan` | Geheimnis-Scan über alle Dateien (`-- --historie`: auch über den Git-Verlauf) |
| `npm run benutzer -- liste` / `passwort <name>` / `rolle <name> <admin\|builder>` | Benutzer verwalten |
| `npm run sicherung` / `-- liste` / `-- wiederherstellen <datei>` | Sicherung von `app.db` |
| `npm run export` | `pm.db` selbst aus der eBay-API bauen (nur Admin, braucht Keys) |

## Änderungen bei eBay

1. Builder trägt im Test die neuen Titel ein (höchstens 80 Zeichen) und klickt **Send for approval**. Danach ist der Vorschlag gesperrt.
2. Admin prüft unter **Approvals** und gibt frei. Erst jetzt schreibt die App, und nur, wenn auf diesem Rechner eBay-Keys liegen **und** `EBAY_SCHREIBEN=an` gesetzt ist. Sonst ist die Freigabe ein **Probelauf**: alles wird geprüft und protokolliert, nichts geändert.
3. Vor jeder Änderung liest die App den aktuellen Titel. Weicht er vom erwarteten ab, wird nichts überschrieben.
4. Lehnt eBay ab, steht eBays Meldung am Vorschlag und im Log; geändert ist dann nichts.
5. Ein Test, der mit **revert** geschlossen wird, erzeugt Rückänderungen auf die alten Titel. Auch die gibt ein Admin frei.

## Leiter

Angebote mit der Diagnose **Low impressions** steigen Stufe für Stufe, bis Käufer sie wieder sehen (`app/leiter.mjs`):

```
Low impressions ─► 1 neuer Titel (KI) ─14 Tage─► wieder gesehen? ja ─► raus („Seen again“)
                                                              nein
                   2 Werbung 10 %     ─14 Tage─► wieder gesehen? ja ─► raus
                                                              nein
                   3 Preis −10 %      ─21 Tage─► wieder gesehen? ja ─► raus
                                                              nein
                   4 manuelle Prüfung: Admin entscheidet überarbeiten / offline nehmen / behalten (mit Begründung)
```

- **Wieder gesehen** heißt: Impressionen je Tag während der Prüfzeit, hochgerechnet auf 90 Tage, liegen nicht mehr unter der Grenze der Diagnose (unteres Viertel des Shops). Die Grenze wandert mit dem ganzen Shop, eine ruhige Saison lässt ein Angebot also nicht fälschlich scheitern.
- **Täglicher Lauf** ab 6 Uhr (oder Knopf *Run the ladder now*): Prüfzeiten auswerten, neue Angebote aufnehmen (höchstens 20 gleichzeitig, bewährte zuerst, nichts aus Titeltests oder der Sperrliste), Titel vorschlagen. Der Lauf ändert nichts bei eBay.
- **KI-Titel:** Google Gemini (wie auf dem Parture-Server) schlägt drei Titel vor, der **Regelprüfer** (`app/titel-regeln.mjs`) lässt nur abmahnsichere durch: keine Superlative, Prüfsiegel, Umwelt- oder Preisversprechen, nie „Original“; Marken nur als „passend für …“ und nur, wenn sie schon im alten Titel standen; keine neuen Zahlen, Maße oder Farben; keine Schlagwortlisten. Geprüft gegen alle 745 echten Titel. Ohne `GOOGLE_API_KEY` kommt der Vorschlag aus der Titelhilfe oder wird von Hand eingetragen; auch der muss durch den Regelprüfer.
- **Freigabe** jeder Stufe nur durch einen Admin. Vor jeder Änderung liest die App den Stand bei eBay (Titel, Preis); weicht er ab, passiert nichts. Werbung und Preis haben je einen eigenen Schalter (`EBAY_WERBUNG=an`, `EBAY_PREIS=an`) zusätzlich zu `EBAY_SCHREIBEN`, weil sie Geld kosten. Ohne Schalter: Probelauf, oder *Done by hand*, wenn der Admin es selbst bei eBay gemacht hat.
- **Preis:** ein Schritt nach unten. Haben die Varianten verschiedene Preise, senkt die App nicht (Preisstaffel), sondern schickt das Angebot zur manuellen Prüfung. Die App kennt keine Kosten: Der Admin prüft den neuen Preis vor der Freigabe.
- Prüfzeiten, Höchstzahl, Werbesatz und Preisschritt stehen unter **Settings → Ladder**. Jeder Schritt steht im Lebenslauf des Angebots und im Log.

## Server

Die App läuft auf dem Parture-Server zweimal, beide hinter Cloudflare Access (E-Mail-Code) und danach dem App-Login:

| Umgebung | Adresse | Branch | eBay |
|---|---|---|---|
| **PROD** | `https://app.parture-team.com` | `main` | mit Keys, Schreibschalter außerhalb von Probe und Vorführung aus |
| **VORSCHAU** | `https://vorschau.parture-team.com` | `vorschau` | ohne Keys |

Ein Wächter (`app/waechter.mjs`) rollt neue Stände nur nach bestandenen Tests aus, startet die App nach Absturz oder Hängen neu und sichert täglich.

## Weiterlesen

- [`docs/entwicklung.md`](docs/entwicklung.md): so arbeitet die Gruppe (Branches, Vorschau, Pull Request, Review, Testregeln)
- [`docs/architektur.md`](docs/architektur.md): Aufbau auf einer Seite, Entscheidungen und ihre Alternativen
- [`docs/sicherheit.md`](docs/sicherheit.md): Bedrohungen, Maßnahmen und der Test, der jede belegt
- [`docs/vorfuehrung.md`](docs/vorfuehrung.md): Ablauf der Vorführung, Fragen und Antworten
- [`docs/checkliste-tool.md`](docs/checkliste-tool.md): was bis zur Abgabe und Vorführung zu tun ist, mit Belegen
- [`docs/server-einrichtung.md`](docs/server-einrichtung.md), [`docs/server-checkliste.md`](docs/server-checkliste.md): Server

## Glossar

| Englisch (in der App) | Deutsch | Bedeutung |
|---|---|---|
| Listing | Angebot | ein eBay-Angebot des Shops, erkennbar an der Angebotsnummer (`external_id`) |
| Impressions | Impressionen | wie oft eBay das Angebot in Suchergebnissen oder Empfehlungen gezeigt hat |
| Test group / Control group | Testgruppe / Kontrollgruppe | per Los geteilt; nur die Testgruppe bekommt neue Titel, die Kontrollgruppe zeigt, was ohne Änderung passiert wäre |
| Approval | Freigabe | Entscheidung eines Admins, ob vorgeschlagene Titel bei eBay geändert werden |
| Verdict | Urteil | Ergebnis nach der Prüfzeit: besser, kein Unterschied belegt, schlechter |
| Safety metric (sales) | Schutzkennzahl (Verkäufe) | ein Test gilt nicht als besser, wenn die Verkäufe der Testgruppe um mehr als 20 % fallen |
| Data lag | Datenverzug | Traffic zählt erst 3 Tage später, weil eBay die letzten Tage noch korrigiert |
| Preview / Live | VORSCHAU / PROD | Spielwiese ohne eBay-Keys / echtes System mit Keys |
| Watcher | Wächter | Programm auf dem Server, das ausrollt, überwacht und neu startet |
| Append-only log | Protokoll, nur anhängen | Einträge lassen sich weder ändern noch löschen (Datenbank-Trigger) |
