// Tests for the page Problem (problem.mjs): concentration (how many products bring 80 %), distribution into bands with the
// diagnosis limit as an edge, and the four fields seen × sold. Pure calculation, small example data.
import test from "node:test";
import assert from "node:assert/strict";
import { konzentration, stufen, auswerten } from "./problem.mjs";

test("Concentration: 80 % of the sum comes from the fewest products needed for it", () => {
  // 10 products: one brings 80, the rest 2 each + 2 zeros → sum 80 + 7×2 + 0 = 94
  const k = konzentration([80, 2, 2, 2, 2, 2, 2, 2, 0, 0]);
  assert.equal(k.summe, 94);
  assert.equal(k.null, 2);
  assert.deepEqual(k.fuer80, { anzahl: 1, anteil: 0.1 }, "80 of 94 = 85 % already with one product");
  assert.deepEqual(k.fuer90, { anzahl: 4, anteil: 0.4 }, "90 % of 94 = 84.6: three products bring 84, only four (86) are enough");
  assert.equal(k.top10, 80 / 94);
});

test("Concentration: edge cases (all equal, nothing, empty list)", () => {
  const gleich = konzentration([5, 5, 5, 5]);
  assert.deepEqual(gleich.fuer80, { anzahl: 4, anteil: 1 }, "equal distribution: 3 of 4 bring only 75 %, for 80 % all are needed");
  assert.equal(gleich.top20 > 0, true);
  const nichts = konzentration([0, 0, 0]);
  assert.equal(nichts.fuer80, null); assert.equal(nichts.top10, null);
  assert.equal(konzentration([]).anzahl, 0);
  assert.equal(nichts.kurve.length, 101);
});

test("Bands: the diagnosis limit is its own edge, every impression lands in exactly one band", () => {
  const s = stufen([0, 0, 5, 440, 441, 999, 1000, 4999, 5000, 80000], 441);
  assert.deepEqual(s.map((x) => [x.von, x.bis, x.anzahl, x.unterGrenze]), [[0, 0, 2, true], [1, 440, 2, true], [441, 999, 2, false], [1000, 4999, 2, false], [5000, null, 2, false]]);
  assert.equal(s.reduce((a, x) => a + x.anzahl, 0), 10);
});

test("Evaluation: the fields seen × sold count only active eBay listings, sums are correct", () => {
  const p = (imp, units, ebay = 1) => ({ impressionen_90d: imp, units_90d: units, ebay_aktiv: ebay });
  const a = auswerten([p(5000, 9), p(800, 0), p(100, 2), p(0, 0), p(10, 0), p(9999, 50, 0)], 441);
  assert.equal(a.produkte, 6); assert.equal(a.ebayAktiv, 5);
  assert.deepEqual(a.felder, { gesehenVerkauft: 1, gesehenNichtVerkauft: 1, kaumGesehenVerkauft: 1, kaumGesehenNichtVerkauft: 2 });
  assert.equal(a.kaumGesehen, 3); assert.equal(a.ohneImpressionen, 1);
  assert.equal(a.ohneVerkauf, 3, "only active eBay listings");
  assert.equal(a.verkaeufe.summe, 11, "scope eBay only: the product without an eBay listing (50 sales) does not count");
  assert.equal(a.verkaeufe.anzahl, 5);
});

test("Three groups without overlap: sold / shown, not bought / hardly shown; together all active eBay listings", () => {
  const p = (imp, units, ebay = 1) => ({ impressionen_90d: imp, units_90d: units, ebay_aktiv: ebay });
  const a = auswerten([p(5000, 9), p(800, 0), p(100, 2), p(0, 0), p(10, 0), p(0, 1), p(9999, 50, 0)], 441);
  assert.deepEqual(a.gruppen, { verkauft: 3, gezeigtNichtGekauft: 1, kaumGezeigt: 2, kaumGezeigtNie: 1 });
  assert.equal(a.gruppen.verkauft + a.gruppen.gezeigtNichtGekauft + a.gruppen.kaumGezeigt, a.ebayAktiv);
  assert.equal(a.gruppen.kaumGezeigtNie, 1, "only listings without a sale and with 0 impressions; the sold one with 0 impressions does not count");
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
