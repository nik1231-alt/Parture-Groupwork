// Tests of the evaluation for the charts (auswertung.mjs) and its connection to the test detail and the demo.
import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { baueAuswertung, median, netto } from "./auswertung.mjs";
import { urteile } from "./experimente.mjs";
import * as ex from "./experimente.mjs";
import * as einstellungen from "./einstellungen.mjs";
import { baueDemo } from "./demo.mjs";
import { EINSTELLUNGEN as E } from "./regeln.mjs";

const g = (imp, auf = 0, trans = 0) => ({ imp, auf, trans });
const z = (number, gruppe, vorher, nachher) => ({ number, gruppe, vorher, nachher });

test("Median: odd, even, empty, with unusable values", () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
  assert.equal(median([]), null);
  assert.equal(median([NaN, Infinity, 5]), 5);
  assert.equal(median([-1]), -1);
});

test("Sums and change per group are correct, also with an outlier", () => {
  const a = baueAuswertung([
    z("a", "test", g(100, 10, 1), g(110, 11, 1)), z("b", "test", g(100, 10, 1), g(90, 9, 0)), z("c", "test", g(100, 10, 1), g(1000, 100, 9)),
    z("d", "kontrolle", g(100), g(100)), z("e", "kontrolle", g(200), g(220)),
  ], E);
  assert.deepEqual(a.test.vorher, g(300, 30, 3)); assert.deepEqual(a.test.nachher, g(1200, 120, 10));
  assert.equal(a.test.aenderung.imp, 3);
  assert.ok(Math.abs(a.test.median - 0.1) < 1e-12, "der Median zeigt: das typische Angebot gewann nur 10 %, ein Ausreißer treibt die Summe");
  assert.equal(a.test.anteilBesser, 2 / 3);
  assert.equal(a.kontrolle.anzahl, 2);
  assert.ok(Math.abs(a.kontrolle.aenderung.imp - 20 / 300) < 1e-12);
});

test("Net effect equals exactly the verdict from experimente.urteile", () => {
  for (const [t, k] of [[[1200, 2100], [1250, 1300]], [[1180, 1290], [1200, 1280]], [[500, 100], [500, 800]], [[0, 50], [100, 100]], [[100, 100], [0, 0]], [[0, 0], [0, 0]]]) {
    const u = urteile({ vorher: g(t[0], 0, 4), nachher: g(t[1], 0, 3) }, { vorher: g(k[0], 0, 4), nachher: g(k[1], 0, 4) }, E);
    assert.equal(netto({ vorher: t[0], nachher: t[1] }, { vorher: k[0], nachher: k[1] }), u.primaer.netto, JSON.stringify([t, k]));
  }
});

test("Edge cases: empty groups, starting value 0, missing figures do not divide by 0 and stay JSON-safe", () => {
  const a = baueAuswertung([], E);
  assert.equal(a.test.anzahl, 0); assert.equal(a.test.median, null); assert.equal(a.test.anteilBesser, null); assert.equal(a.netto.imp, 0, "leere Gruppen: weder Gewinn noch Verlust");
  const b = baueAuswertung([z("a", "test", g(0), g(50)), z("b", "kontrolle", g(0), g(0))], E);
  assert.equal(b.test.punkte[0].aenderung, null, "Ausgangswert 0: keine Prozentzahl, kein Infinity");
  assert.equal(b.test.median, null);
  assert.doesNotThrow(() => JSON.stringify(b));
  for (const wert of [Infinity, NaN]) assert.equal(JSON.stringify(baueAuswertung([z("a", "test", g(10), g(wert))], E)).includes("Infinity"), false);
});

test("Listings without starting figures or without current figures are not counted and are reported", () => {
  const a = baueAuswertung([z("a", "test", g(100), g(200)), z("b", "test", null, g(5)), z("c", "test", g(100), null), z("d", "kontrolle", g(100), g(100))], E);
  assert.equal(a.test.anzahl, 1); assert.equal(a.test.ausgelassen, 2); assert.equal(a.kontrolle.ausgelassen, 0);
  assert.equal(a.test.vorher.imp, 100);
});

test("The scale carries the limits from the settings", () => {
  const a = baueAuswertung([], { ...E, besserAb: 0.35, schutzGrenze: 0.1, mindestImpressionen30: 99 });
  assert.deepEqual(a.skala, { besserAb: 0.35, schutzGrenze: 0.1, mindestImpressionen: 99 });
});

test("Demo: single listings add up exactly to the example's sums, verdict and chart agree", () => {
  const d = baueDemo(E);
  for (const f of d.faelle) {
    assert.equal(f.auswertung.test.anzahl, 20); assert.equal(f.auswertung.kontrolle.anzahl, 20);
    assert.deepEqual(f.auswertung.test.vorher, f.urteil.test.vorher); assert.deepEqual(f.auswertung.test.nachher, f.urteil.test.nachher);
    assert.deepEqual(f.auswertung.kontrolle.nachher, f.urteil.kontrolle.nachher);
    assert.equal(f.auswertung.netto.imp, f.urteil.primaer.netto);
    assert.equal(f.auswertung.netto.trans, f.urteil.schutz.netto);
  }
  assert.deepEqual(baueDemo(E).faelle[0].auswertung, d.faelle[0].auswertung, "gleiche Beispiele bei jedem Aufruf");
});

// ---- Connection to the test detail ----
const JETZT = new Date("2026-11-10T12:00:00Z");
const TAGE = (n) => new Date(JETZT.getTime() + n * 86400000);
const shop = (faktor = 1) => Array.from({ length: 40 }, (_, i) => ({ number: "L" + String(i).padStart(2, "0"), title: "Niedrig " + i, created_at: "2025-12-01T10:00:00.000Z", units_90d: 1, units_total: 3, aufrufe_90d: 30, impressionen_90d: 100 + i, impressionen_30d: Math.round((30 + i) * faktor), aufrufe_30d: 3, transaktionen_30d: 1, image_url: null, avg_price: 5 }));
const EINST = { ...E, testGroesse: 40, modus: "fest", festeGrenze: 1000 };

function gestarteterTest() {
  const d = new Database(":memory:"); einstellungen.bereiteVor(d); ex.bereiteVor(d);
  const ps = shop();
  const id = ex.legeAn(d, {}, ps, EINST, JETZT, 5).wert.id;
  for (const r of d.prepare("SELECT number FROM experiment_angebot WHERE gruppe = 'test'").all()) ex.setzeTitel(d, { id, number: r.number, neu: "Neuer Titel " + r.number }, EINST);
  assert.equal(ex.starte(d, { id }, ps, JETZT).ok, true);
  return { d, id, ps };
}

test("Test detail: no evaluation before the start, one afterwards, the list stays slim", () => {
  const d = new Database(":memory:"); einstellungen.bereiteVor(d); ex.bereiteVor(d);
  const id = ex.legeAn(d, {}, shop(), EINST, JETZT, 5).wert.id;
  assert.equal(ex.detail(d, id, shop(), JETZT, EINST).wert.auswertung, null);
  const v = gestarteterTest();
  const a = ex.detail(v.d, v.id, shop(2), TAGE(31), EINST).wert.auswertung;
  assert.equal(a.test.anzahl, 20); assert.equal(a.kontrolle.anzahl, 20);
  assert.equal(a.test.aenderung.imp, 1, "heute doppelt so viele Impressionen wie beim Start");
  assert.ok(Math.abs(a.netto.imp) < 1e-12, "Kontrolle verdoppelte sich ebenso, also kein Nettoeffekt");
  assert.equal("auswertung" in ex.liste(v.d, shop(2), TAGE(31), EINST)[0], false);
  assert.doesNotThrow(() => JSON.stringify(ex.detail(v.d, v.id, shop(2), TAGE(31), EINST)));
});

test("Test detail: vanished listings are left out instead of causing trouble", () => {
  const v = gestarteterTest();
  const a = ex.detail(v.d, v.id, shop(2).slice(0, 30), TAGE(31), EINST).wert.auswertung;
  assert.equal(a.test.anzahl + a.kontrolle.anzahl, 30);
  assert.equal(a.test.ausgelassen + a.kontrolle.ausgelassen, 10);
});
