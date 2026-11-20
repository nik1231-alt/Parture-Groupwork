// Tests für die Seite Problem (problem.mjs): Konzentration (wie viele Produkte bringen 80 %), Verteilung in Stufen mit der
// Grenze der Diagnose als Kante und die vier Felder gesehen × verkauft. Reine Rechnung, kleine Beispieldaten.
import test from "node:test";
import assert from "node:assert/strict";
import { konzentration, stufen, auswerten } from "./problem.mjs";

test("Konzentration: 80 % der Summe kommen von den wenigsten Produkten, die man dafür braucht", () => {
  // 10 Produkte: eines bringt 80, der Rest je 2 + 2 Nullen → Summe 80 + 7×2 + 0 = 94
  const k = konzentration([80, 2, 2, 2, 2, 2, 2, 2, 0, 0]);
  assert.equal(k.summe, 94);
  assert.equal(k.null, 2);
  assert.deepEqual(k.fuer80, { anzahl: 1, anteil: 0.1 }, "80 von 94 = 85 % schon mit einem Produkt");
  assert.deepEqual(k.fuer90, { anzahl: 4, anteil: 0.4 }, "90 % von 94 = 84,6: drei Produkte bringen 84, erst vier (86) reichen");
  assert.equal(k.top10, 80 / 94);
});

test("Konzentration: Randfälle (alles gleich, nichts, leere Liste)", () => {
  const gleich = konzentration([5, 5, 5, 5]);
  assert.deepEqual(gleich.fuer80, { anzahl: 4, anteil: 1 }, "Gleichverteilung: 3 von 4 bringen nur 75 %, für 80 % braucht es alle");
  assert.equal(gleich.top20 > 0, true);
  const nichts = konzentration([0, 0, 0]);
  assert.equal(nichts.fuer80, null); assert.equal(nichts.top10, null);
  assert.equal(konzentration([]).anzahl, 0);
  assert.equal(nichts.kurve.length, 101);
});

test("Stufen: die Grenze der Diagnose ist eine eigene Kante, jede Impression landet in genau einer Stufe", () => {
  const s = stufen([0, 0, 5, 440, 441, 999, 1000, 4999, 5000, 80000], 441);
  assert.deepEqual(s.map((x) => [x.von, x.bis, x.anzahl, x.unterGrenze]), [[0, 0, 2, true], [1, 440, 2, true], [441, 999, 2, false], [1000, 4999, 2, false], [5000, null, 2, false]]);
  assert.equal(s.reduce((a, x) => a + x.anzahl, 0), 10);
});

test("Auswertung: Felder gesehen × verkauft zählen nur aktive eBay-Angebote, Summen stimmen", () => {
  const p = (imp, units, ebay = 1) => ({ impressionen_90d: imp, units_90d: units, ebay_aktiv: ebay });
  const a = auswerten([p(5000, 9), p(800, 0), p(100, 2), p(0, 0), p(10, 0), p(9999, 50, 0)], 441);
  assert.equal(a.produkte, 6); assert.equal(a.ebayAktiv, 5);
  assert.deepEqual(a.felder, { gesehenVerkauft: 1, gesehenNichtVerkauft: 1, kaumGesehenVerkauft: 1, kaumGesehenNichtVerkauft: 2 });
  assert.equal(a.kaumGesehen, 3); assert.equal(a.ohneImpressionen, 1);
  assert.equal(a.ohneVerkauf, 3, "nur aktive eBay-Angebote");
  assert.equal(a.verkaeufe.summe, 11, "Scope nur eBay: das Produkt ohne eBay-Angebot (50 Verkäufe) zählt nicht mit");
  assert.equal(a.verkaeufe.anzahl, 5);
});

test("Drei Gruppen ohne Überschneidung: verkauft / gezeigt, nicht gekauft / kaum gezeigt; zusammen alle aktiven eBay-Angebote", () => {
  const p = (imp, units, ebay = 1) => ({ impressionen_90d: imp, units_90d: units, ebay_aktiv: ebay });
  const a = auswerten([p(5000, 9), p(800, 0), p(100, 2), p(0, 0), p(10, 0), p(0, 1), p(9999, 50, 0)], 441);
  assert.deepEqual(a.gruppen, { verkauft: 3, gezeigtNichtGekauft: 1, kaumGezeigt: 2, kaumGezeigtNie: 1 });
  assert.equal(a.gruppen.verkauft + a.gruppen.gezeigtNichtGekauft + a.gruppen.kaumGezeigt, a.ebayAktiv);
  assert.equal(a.gruppen.kaumGezeigtNie, 1, "nur Angebote ohne Verkauf mit 0 Impressionen; das verkaufte mit 0 Impressionen zählt nicht");
});

test("Verkaufschance und typische Impressionen: kaum gezeigt gegen oft gezeigt, Median je Gruppe", () => {
  const p = (imp, units) => ({ impressionen_90d: imp, units_90d: units, ebay_aktiv: 1 });
  // kaum gezeigt (unter 441): 4 Angebote, 1 verkauft → 25 %; oft gezeigt (ab 1000): 4 Angebote, 3 verkauft → 75 %
  const a = auswerten([p(0, 0), p(100, 0), p(200, 1), p(300, 0), p(600, 0), p(1000, 1), p(2000, 1), p(3000, 0), p(4000, 2)], 441);
  assert.equal(a.chance.kaum, 0.25); assert.equal(a.chance.oft, 0.75); assert.equal(a.chance.oftAb, 1000);
  assert.equal(a.typisch.kaum, 150, "Median von 0, 100, 200, 300");
  assert.equal(a.typisch.verkauft, 1500, "Median der verkauften: 200, 1000, 2000, 4000 → (1000 + 2000) / 2");
});

test("Verkaufschance ohne Angebote in einer Gruppe: null statt Division durch null", () => {
  const a = auswerten([{ impressionen_90d: 5000, units_90d: 1, ebay_aktiv: 1 }], 441);
  assert.equal(a.chance.kaum, null); assert.equal(a.chance.oft, 1); assert.equal(a.typisch.kaum, null);
});
