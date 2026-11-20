// Tests für die Seite Results (ergebnisse.mjs, ergebnisse-demo.mjs): Läufe getrennt auswerten, Urteil "klarer Anstieg / Rückgang / nicht von Zufall
// zu unterscheiden / zu früh", die Zahlen stimmen mit der Seite Funnel (leiter.wirkung) überein, Randfälle und die Beispielansicht mit erfundenen Zahlen.
import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { urteil, schaetze, tKritisch, baueErgebnisse, MIN_AUSGEWERTET, PHASEN, ALLE } from "./ergebnisse.mjs";
import { baueDemoErgebnisse } from "./ergebnisse-demo.mjs";
import * as leiter from "./leiter.mjs";
import { EINSTELLUNGEN } from "./regeln.mjs";

const nahe = (a, b, msg, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${msg ?? ""} ${a} != ${b}`);
const K = (v, n) => ({ anzahl: 20, vorher90: v, nachher90: n });
// Ein Angebot mit einer Auswertung in einer Phase (details wie in leiter.werteAus); tag = Tag, an dem es auf die Leiter kam
const angebot = (number, stufe, vorher90, nachher90, kontrolle, tag = "2026-10-01", erholt = false) => ({
  number, title: "Listing " + number, stufe: "pruefung", phase: "fertig", ergebnis: null, eingestiegen_at: tag + "T06:00:00.000Z",
  verlauf: [{ stufe, ereignis: "ausgewertet", at: "2026-10-20T06:00:00.000Z", details: { vorher90, nachher90, erholt, kontrolle, netto: kontrolle ? (nachher90 / vorher90) / (kontrolle.nachher90 / kontrolle.vorher90) - 1 : null } }],
});
const kontrolleAngebot = (nr) => ({ number: nr, stufe: "kontrolle", phase: "laeuft", ergebnis: null, eingestiegen_at: "2026-10-01T06:00:00.000Z", verlauf: [] });
const uebersicht = (angebote) => ({ angebote, tage: { titel: 14, werbung: 14, preis: 21 }, trafficBis: "2026-11-10" });
const viele = (prefix, stufe, n, vorher, nachher, tag) => Array.from({ length: n }, (_, i) => angebot(prefix + i, stufe, vorher, nachher, K(1000, 1000), tag));

test("95-%-Bereich: bekannter Fall mit drei Angeboten, zu wenige Werte, gleiche Werte", () => {
  // Logarithmen 0,1 / 0,2 / 0,3: Mittel 0,2, Streuung 0,1, Standardfehler 0,0577, t(2) = 4,303 → Abstand 0,2484
  const s = schaetze([Math.exp(0.1) - 1, Math.exp(0.2) - 1, Math.exp(0.3) - 1]);
  nahe(s.effekt, Math.exp(0.2) - 1); nahe(s.von, Math.exp(0.2 - 0.2484) - 1, "von", 1e-3); nahe(s.bis, Math.exp(0.2 + 0.2484) - 1, "bis", 1e-3); assert.equal(s.n, 3);
  assert.equal(schaetze([0.3]), null, "ein einzelnes Angebot sagt nichts über die Streuung");
  assert.equal(schaetze([]), null);
  const gleich = schaetze([0.2, 0.2, 0.2, 0.2, 0.2]);
  nahe(gleich.von, 0.2); nahe(gleich.bis, 0.2);
  assert.equal(tKritisch(0), null); assert.equal(tKritisch(1), 12.706); assert.equal(tKritisch(30), 2.042); assert.equal(tKritisch(500), 1.96);
});

test("Je mehr Angebote, desto enger der Bereich (gleiche Streuung)", () => {
  const mix = (n) => Array.from({ length: n }, (_, i) => (i % 2 ? 0.1 : 0.3));
  const a = schaetze(mix(6)), b = schaetze(mix(60));
  assert.ok(b.bis - b.von < a.bis - a.von);
});

test("Ein Angebot mit 0 Impressionen nachher (−100 %) bricht die Rechnung nicht", () => {
  const s = schaetze([-1, 0.2, 0.1, 0.3, 0.2]);
  for (const v of [s.effekt, s.von, s.bis]) assert.ok(Number.isFinite(v));
});

test("Urteil: der ganze Bereich über null = klarer Anstieg, darunter = klarer Rückgang, sonst nicht von Zufall zu unterscheiden, zu wenige = zu früh", () => {
  const sch = (von, bis) => ({ effekt: (von + bis) / 2, von, bis, n: 10 });
  assert.equal(urteil(sch(0.05, 0.3), 10), "up");
  assert.equal(urteil(sch(-0.3, -0.05), 10), "down");
  assert.equal(urteil(sch(-0.02, 0.3), 10), "unclear", "der Bereich reicht über null");
  assert.equal(urteil(sch(0.0, 0.3), 10), "unclear", "genau null zählt noch nicht als klar");
  assert.equal(urteil(sch(0.05, 0.3), MIN_AUSGEWERTET - 1), "too_few", "ein schöner Wert aus zu wenigen Angeboten wird nicht beurteilt");
  assert.equal(urteil(null, 50), "too_few");
});

test("Nichts ausgewertet: leer, nur 'alle Läufe', drei Phasen ohne Zahlen", () => {
  const e = baueErgebnisse(uebersicht([]));
  assert.equal(e.leer, true);
  assert.deepEqual(e.laeufe.map((l) => l.schluessel), [ALLE]);
  assert.deepEqual(e.laeufe[0].phasen.map((p) => p.schluessel), PHASEN.map(([s]) => s));
  for (const p of e.laeufe[0].phasen) { assert.equal(p.ausgewertet, 0); assert.equal(p.schaetzung, null); assert.equal(p.urteil, "too_few"); }
});

test("Läufe: ein Lauf je Starttag, neuester zuerst, jeder wertet nur seine eigenen Angebote aus, die Kontrollgruppe gehört zu keinem Lauf", () => {
  const alt = viele("A", "werbung", 6, 100, 150, "2026-10-01"), neu = viele("N", "werbung", 5, 100, 80, "2026-10-08");
  const e = baueErgebnisse(uebersicht([...alt, ...neu, kontrolleAngebot("K1"), kontrolleAngebot("K2")]));
  assert.deepEqual(e.laeufe.map((l) => l.schluessel), [ALLE, "2026-10-08", "2026-10-01"]);
  assert.deepEqual(e.laeufe.map((l) => l.angebote), [11, 5, 6], "ohne Kontrollgruppe gezählt");
  assert.equal(e.kontrollgruppe, 2);
  const w = (i) => e.laeufe[i].phasen.find((p) => p.schluessel === "werbung");
  assert.equal(w(1).ausgewertet, 5); nahe(w(1).netto, -0.2); assert.equal(w(1).urteil, "down", "nur die schlechten Angebote");
  assert.equal(w(2).ausgewertet, 6); nahe(w(2).netto, 0.5); assert.equal(w(2).urteil, "up", "nur die guten Angebote");
  assert.equal(w(0).ausgewertet, 11, "alle zusammen");
});

test("Nettoeffekt und Summen je Phase: Angebote gegen Kontrollgruppe, ohne Kontrollgruppe zählt ein Angebot als geprüft, aber nicht im Effekt", () => {
  const mitK = viele("A", "titel", 5, 100, 130), ohne = angebot("Z", "titel", 100, 500, null);
  const p = baueErgebnisse(uebersicht([...mitK, ohne])).laeufe[0].phasen[0];
  assert.equal(p.ausgewertet, 6); assert.equal(p.mitKontrolle, 5);
  assert.equal(p.vorher90, 500); assert.equal(p.nachher90, 650);
  nahe(p.aenderung, 0.3); nahe(p.kontrolleAenderung, 0); nahe(p.netto, 0.3);
  assert.equal(p.urteil, "up", "alle fünf +30 %, Streuung 0: Bereich fällt auf einen Punkt über null");
});

test("Die Zahlen auf Results und auf der Seite Funnel (leiter.wirkung) weichen nie voneinander ab", () => {
  const db = new Database(":memory:");
  leiter.bereiteVor(db);
  const ein = db.prepare("INSERT INTO leiter (number, stufe, phase, eingestiegen_at, aktualisiert_at) VALUES (?, 'pruefung', 'offen', '2026-09-01', '2026-10-20')");
  const ver = db.prepare("INSERT INTO leiter_verlauf (number, stufe, ereignis, details, benutzer, at) VALUES (?, ?, 'ausgewertet', ?, 'system', '2026-10-20T06:00:00.000Z')");
  const faelle = [["a", "titel", 100, 130, K(900, 950)], ["b", "titel", 80, 70, K(900, 950)], ["c", "titel", 120, 200, null], ["d", "werbung", 90, 150, K(800, 780)], ["e", "preis", 50, 49, K(700, 720)]];
  for (const [nr, stufe, v, n, k] of faelle) {
    if (!db.prepare("SELECT 1 FROM leiter WHERE number = ?").get(nr)) ein.run(nr);
    ver.run(nr, stufe, JSON.stringify({ tage: 14, vorher90: v, nachher90: n, grenze90: 170, erholt: n >= 170, kontrolle: k, netto: k ? (n / v) / (k.nachher90 / k.vorher90) - 1 : null }));
  }
  const u = leiter.uebersicht(db, [], { impTag: () => 0, trafficBis: "2026-11-10", grenze90: 170, einst: EINSTELLUNGEN });
  const e = baueErgebnisse(u), w = leiter.wirkung(db);
  for (const p of e.laeufe[0].phasen) {
    const x = w[p.schluessel];
    assert.equal(p.ausgewertet, x.ausgewertet, p.schluessel); assert.equal(p.erholt, x.erholt, p.schluessel); assert.equal(p.mitKontrolle, x.mitKontrolle, p.schluessel);
    assert.equal(p.vorher90, x.vorher90); assert.equal(p.nachher90, x.nachher90);
    if (x.netto == null) assert.equal(p.netto, null, p.schluessel); else nahe(p.netto, x.netto, p.schluessel);
  }
  assert.equal(e.laeufe.length, 2, "alle Angebote kamen am selben Tag: ein Lauf plus 'alle'");
  db.close();
});

test("Laufende Angebote: werden gezählt, das erste Ende wird genannt, sie sind noch kein Ergebnis", () => {
  const laeuft = (nr, ende) => ({ number: nr, stufe: "werbung", phase: "laeuft", eingestiegen_at: "2026-10-01T06:00:00.000Z", verlauf: [], stand: { ende } });
  const e = baueErgebnisse(uebersicht([laeuft("L1", "2026-11-30"), laeuft("L2", "2026-11-25")]));
  assert.equal(e.leer, true);
  assert.equal(e.laeufe[0].phasen[1].laeuft, 2); assert.equal(e.laeufe[0].phasen[1].naechstesEnde, "2026-11-25");
});

test("Beispielansicht: erfundene Zahlen, immer dieselben, zwei Läufe plus alle, Werbung klar besser, Titel nicht von Zufall zu unterscheiden, alles endlich", () => {
  const a = baueDemoErgebnisse(EINSTELLUNGEN), b = baueDemoErgebnisse(EINSTELLUNGEN);
  assert.equal(a.beispiel, true);
  assert.equal(JSON.stringify(a), JSON.stringify(b), "feste Startwerte: jeder Aufruf gleich");
  assert.equal(a.laeufe.length, 3); assert.equal(a.laeufe[0].angebote, 24); assert.equal(a.leer, false);
  assert.deepEqual(a.laeufe[0].phasen.map((p) => p.urteil), ["unclear", "up", "unclear"]);
  for (const l of a.laeufe) {
    assert.equal(l.phasen[1].urteil, "up", "Werbung ist in jedem Lauf ein klarer Anstieg");
    for (const p of l.phasen) for (const v of [p.netto, p.aenderung, p.kontrolleAenderung]) assert.ok(Number.isFinite(v), p.schluessel);
  }
  assert.ok(a.laeufe.some((l) => l.phasen.some((p) => p.urteil === "too_few")), "ein Lauf zeigt auch 'zu früh'");
});
