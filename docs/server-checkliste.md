# Checkliste: Parture-Tool auf dem Server, mit Zugang, Coden, Live-Traffic und Freigabe

Stand: 17.11.2026 · Frist: ca. 23.11.2026 · Legende: ☐ offen · ☑ erledigt · **[C]** macht Claude · **[N]** macht Niko · **[G]** macht die Gruppe

## Zielbild

```
GitHub ── main (geprüft) ─────────► PROD   (Server, mit eBay-Keys, Schreiben nach Freigabe, Traffic-Import täglich)
   └──── vorschau (Builder pushen) ► VORSCHAU (Server, OHNE Keys, zeigt Änderungen sofort, kann nichts bei eBay ändern)
Alle Zugriffe: Browser → Cloudflare (Login per E-Mail-Code) → Tunnel → App (nur 127.0.0.1) → eigener Login mit Rolle
```

- **PROD** übernimmt nur Code, der per Pull Request geprüft und auf `main` gemergt wurde.
- **VORSCHAU** übernimmt jeden Push auf den Branch `vorschau` innerhalb von 1 bis 2 Minuten. Dort liegen keine Keys.
- „Schreibbefehle nach Approval kommen zu mir“ heißt: Ein Builder sendet einen Vorschlag, Niko (Admin) gibt frei, die PROD-App ändert dann mit **Nikos** eBay-Zugang den Titel und protokolliert es. Niko bekommt eine Benachrichtigung, sobald ein Vorschlag wartet (Block E).

---

## A. Code und Zusammenarbeit auf GitHub

- ☐ A1 **[C]** Pull Request für den Login (`emb/login` → `main`) öffnen
- ☐ A2 **[N]** Login-PR prüfen und mergen (mit EmbletonNova abstimmen)
- ☐ A3 **[N]** PR #4 (Rollen, Freigabe, Protokoll, Import) prüfen und mergen (wechselt dann automatisch auf `main`)
- ☐ A4 **[N]** `main` schützen: nur über Pull Request, mindestens 1 Review (GitHub Pro über das Student Developer Pack)
- ☐ A5 **[C]** Branch `vorschau` anlegen und festlegen: Builder arbeiten auf `vorschau` oder eigenen Branches und mergen dorthin
- ☐ A6 **[C]** Automatische Tests auf GitHub (`npm test` bei jedem PR, ohne Keys) einrichten
- ☐ A7 **[C]** Geheimnis-Scan in der Pipeline (kein Key, Token oder Passwort im Code)
- ☐ A8 **[C]** README: Entwicklerleitfaden (klonen, lokal starten, Benutzer anlegen, Branch, PR, Review, Merge)

## B. Server vorbereiten (einmalig)

- ☐ B1 **[N]** Server festlegen: Betriebssystem, Zugriff (Remote), läuft er dauerhaft, Strom und Netz stabil
- ☐ B2 **[N]** Energieoptionen: Ruhezustand und Standby aus, nach Stromausfall automatisch starten
- ☐ B3 **[N]** Node 22 oder neuer und Git installieren, `node -v` und `git -v` prüfen
- ☐ B4 **[C]** Einrichtungsanleitung für den Server schreiben (Schritt für Schritt, für Windows und Mac)
- ☐ B5 **[N]** Repo zweimal klonen: Ordner `prod` (Branch `main`) und `vorschau` (Branch `vorschau`)
- ☐ B6 **[C]** Vorlagen `.env` für PROD und VORSCHAU (eigene Ports, eigene Datenbanken, VORSCHAU ohne Keys und ohne Schreibschalter)
- ☐ B7 **[N]** `.env` auf dem Server ausfüllen (PROD: eBay-Keys, `EBAY_SCHREIBEN`, `EBAY_TRAFFIC_AUTO`)
- ☐ B8 **[C]** Start-Skripte, die die App nach Neustart und Absturz selbst wieder hochfahren (Aufgabenplanung bzw. Dienst)
- ☐ B9 **[C]** Auto-Deploy: PROD holt nur `main` (nur Fast-Forward), baut, startet neu. VORSCHAU holt `vorschau` jede Minute
- ☐ B10 **[C]** Deploy bricht ab, wenn `npm test` fehlschlägt, die alte Version läuft weiter
- ☐ B11 **[N]** Prüfen: App lauscht nur auf `127.0.0.1`, keine eingehenden Ports in der Firewall geöffnet

## C. Zugang von außen (Cloudflare)

- ☐ C1 **[N]** Cloudflare-Konto anlegen
- ☐ C2 **[N]** Domain bei Cloudflare einrichten (vorhandene verbinden oder neue kaufen)
- ☐ C3 **[N]** Named Tunnel auf dem Server als Dienst installieren (läuft nach Neustart wieder)
- ☐ C4 **[C]** Konfigurationsvorlage und Schritte für zwei Adressen: `app.<domain>` (PROD) und `vorschau.<domain>`
- ☐ C5 **[N]** Cloudflare Access: Anmeldung per E-Mail-Code für die vier Adressen (Niko und die drei)
- ☐ C6 **[N]** `CF_ACCESS_TEAM_DOMAIN` und `CF_ACCESS_AUD` in beide `.env` eintragen
- ☐ C7 **[C]** Test von außen: ohne Access → 401, mit Access → Anmeldeseite, mit Login → App
- ☐ C8 **[C]** Mac-Quick-Tunnel beenden, Mac-App stoppen, sobald PROD läuft

## D. Daten und Live-Traffic

- ☐ D1 **[N]** Entscheiden: Benutzer und Tests vom Mac (`daten/app.db`) auf den Server mitnehmen oder neu anfangen
- ☐ D2 **[C]** Wenn mitnehmen: Datei sicher übertragen, Rollen prüfen
- ☐ D3 **[N]** Erster Export auf dem Server (`npm run export`), Stand der Daten prüfen
- ☐ D4 **[C]** 90-Tage-Nachladen läuft über mehrere Tage, bis eBay das Limit freigibt (Fortschritt im Log kontrollieren)
- ☐ D5 **[C]** Täglicher Import ab 5 Uhr automatisch, 3 Tage Verzögerung, Kontrolle gegen die Kontosumme
- ☐ D6 **[C]** Status in der App: zuletzt erfolgreich, letzter Fehler, Alter der Daten. Warnhinweis, wenn Daten älter als 2 Tage sind
- ☐ D7 **[C]** Tägliche Sicherung von `app.db` und `traffic-tage.db` an einen zweiten Ort, Rücksicherung einmal getestet
- ☐ D8 **[C]** Team-Kopie `daten-team/pm.db` regelmäßig aus PROD erneuern (für lokale Entwicklung der Builder)

## E. Schreiben nach Freigabe

- ☐ E1 **[N]** eBay-Keys nur auf PROD, nirgends sonst. VORSCHAU ohne Keys bestätigen
- ☐ E2 **[C]** Probelauf auf PROD (Schreibschalter aus): Angebote werden gefunden, Titel erkannt
- ☐ E3 **[N]** Festlegen, welche 4 Angebote der erste echte Test ändern darf
- ☐ E4 **[C]** Echter Mini-Test: vorschlagen → freigeben → bei eBay prüfen → Protokoll prüfen
- ☐ E5 **[C]** Rückänderung (Revert) einmal komplett durchspielen
- ☐ E6 **[C]** Fehlerfälle dokumentieren (eBay lehnt ab, Titel von Hand geändert, Angebot inaktiv)
- ☐ E7 **[C]** Obergrenze pro Freigabe (z. B. höchstens 50 Titel auf einmal)
- ☐ E8 **[C]** Benachrichtigung an Niko, wenn ein Vorschlag wartet (Telegram oder E-Mail)
- ☐ E9 **[C]** Prüfen: Builder bekommen auf PROD bei Freigabe und Rollen 403

## F. Sicherheit

- ☐ F1 **[N]** Adminpasswort ändern, Datei `erstes-passwort.txt` löschen
- ☐ F2 **[C]** Passwort in der App selbst ändern (jede Person für sich)
- ☐ F3 **[C]** Sperre pro Adresse bei Fehlversuchen
- ☐ F4 **[C]** Konten auf PROD und VORSCHAU anlegen, Zugangsdaten sicher an die drei verteilen
- ☐ F5 **[C]** Schutz-Header, Cookie-Flags und Rechte von außen prüfen (Abschlusstest)
- ☐ F6 **[N]** Prüfen, wer auf dem Server Zugriff hat (nur Niko)

## G. Zugang und Coden für die Gruppe

- ☐ G1 **[N]** GitHub-Zugriff der drei bestätigen (haben sie, Schreibrecht)
- ☐ G2 **[G]** Jede Person klont das Repo, `npm install`, lokalen Benutzer anlegen, `npm start`: Änderungen sofort sichtbar
- ☐ G3 **[G]** Arbeitsweise: eigener Branch → Push auf `vorschau` zum Zeigen → PR gegen `main` → Review → Merge
- ☐ G4 **[C]** Probe: Test-Push auf `vorschau`, nach 1 bis 2 Minuten sichtbar
- ☐ G5 **[C]** Probe: Test-PR gegen `main`, CI läuft, nach Merge ist die Änderung auf PROD
- ☐ G6 **[G]** Alle drei melden sich bei VORSCHAU und PROD an und sehen Tests und Freigaben

## H. Präsentation und Abnahme

- ☐ H1 **[C]** Demo-Modus mit Beispiel-Urteil (ein echtes Urteil gibt es in 6 Tagen nicht)
- ☐ H2 **[C]** Titelvorschläge pro Angebot (Builder prüft und übernimmt)
- ☐ H3 **[C]** Ablaufplan der Vorführung (Diagnose → Test ziehen → Titel → Freigabe → eBay → Protokoll → Ergebnis)
- ☐ H4 **[C]** Architekturübersicht (eine Seite) und aufgeräumte README
- ☐ H5 **[G]** Generalprobe der Vorführung, Ausfallplan (Screenshots/Video, falls das Netz fehlt)
- ☐ H6 **[N]** Funktionsstopp einen Tag vor der Abgabe, danach nur Fehlerbehebung

---

## Zeitplan

| Tag | Blöcke |
|---|---|
| 1 | A (alles außer A4), B1 bis B3, C1 und C2 starten |
| 2 | B4 bis B11, C3 bis C6, F1 |
| 3 | D, E1 bis E5, F2 bis F4 |
| 4 | E6 bis E9, G, H1 und H2 |
| 5 | F5, H3 bis H5 (Generalprobe), Funktionsstopp |
| 6 | Puffer, Abgabe |

## Abhängigkeiten, die den Plan bestimmen

- Alles unter B bis G hängt an B1 (Server) und C2 (Domain). Ohne beides bleiben nur A, F2, F3, E8 und H.
- E4 (echter Test) braucht E3 (deine Auswahl) und einen laufenden PROD (B, C).
- D4 hängt am eBay-Limit und läuft über mehrere Tage von selbst.
