# Revert-Plan für echte Titeländerungen (Checkliste B1.9)

Gilt für jeden Schritt, bei dem der Schreibschalter `EBAY_SCHREIBEN=an` auf PROD steht: Mini-Test mit Lion (B1.7),
echter Test (B1.8), Vorführung (04.12.). **Vor dem Einschalten ausfüllen, ausgedruckt neben den Rechner legen.**

| Angebot (Nr. / eBay-ID) | alter Titel (wörtlich, aus der App kopiert) | neuer Titel | geändert am | zurück am | wer klickt |
|---|---|---|---|---|---|
| 231-3 / … | … | … | … | … | Niko |
| 2103 / … | … | … | … | … | Niko |
| 104 / … | … | … | … | … | Niko |
| 2096 / … | … | … | … | … | Niko |

## Ablauf Rückänderung

1. Test in der App mit **revert** schließen → für jedes geänderte Angebot entsteht eine Rückänderung auf den alten Titel.
2. Admin gibt die Rückänderungen unter **Approvals** frei (Schalter muss dafür noch an sein).
3. Bei eBay jedes Angebot öffnen und den Titel mit der Spalte „alter Titel“ vergleichen. Screenshot.
4. Schalter aus (`EBAY_SCHREIBEN=` leer), Wächter PROD neu starten, `/api/betrieb` zeigt `schreibenAn: false`.
5. Kurze Nachricht an Lion: welche Angebote, Titel zurück ja/nein.

## Wenn die App nicht zurückändern kann

eBay lehnt ab, App nicht erreichbar oder Titel in der Zwischenzeit von Hand geändert: Lion ändert den Titel im eBay-
Verkäuferportal von Hand auf den alten Titel aus dieser Tabelle. Danach Eintrag in der Tabelle ergänzen.

## Nach der Vorführung

Alle geänderten Titel zurück, oder Lion entscheidet ausdrücklich, einzelne zu behalten (hier vermerken, mit Datum).

**Während eines Tests die Shopify-Titel dieser Produkte nicht anfassen** (B1.5): Der Parture-Hub schreibt jede
Titeländerung im Shopify-Shop binnen 10 Minuten nach eBay und würde den Testtitel damit überschreiben.
