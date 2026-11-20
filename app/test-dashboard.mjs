// Tests for the dashboard (ergebnisse.mjs): status per phase, net effect against the control group (same as leiter.werteAus),
// interim state during the waiting time, curve, single listings better/worse, special cases without data or without a control.
// Pure calculation with invented daily values; no database, no network.
import test from "node:test";
import assert from "node:assert/strict";
import { baueDashboard, benoetigt, BASIS_TAGE } from "./dashboard.mjs";
import { EINSTELLUNGEN } from "./regeln.mjs";
import { netto } from "./auswertung.mjs";

const E = { ...EINSTELLUNGEN, leiterTageTitel: 4, leiterTageWerbung: 4, leiterTagePreis: 4 };
const plusTage = (t, n) => new Date(Date.parse(t + "T12:00:00Z") + n * 864e5).toISOString().slice(0, 10);
const START = "2026-11-20";
// Daily values: before the start "vorher" impressions per day, afterwards "nachher"; views and sales as a share
function reihe(vorher, nachher, { aufVorher = 0.03, aufNachher = 0.03, trans = 0, start = START, von = -40, bis = 10 } = {}) {
  const m = new Map();
  for (let i = von; i <= bis; i++) { const imp = i <= 0 ? vorher : nachher; m.set(plusTage(start, i), { imp, auf: imp * (i <= 0 ? aufVorher : aufNachher), trans: i > 0 ? trans : 0 }); }
  return m;
}
const grund = (extra = {}) => ({
  starts: [{ number: "A", stufe: "titel", tag: START, vonHand: false }, { number: "B", stufe: "titel", tag: START, vonHand: false }],
  auswertungen: [],
  kontrolle: [{ number: "K1", start: START }, { number: "K2", start: START }],
  tage: new Map([["A", reihe(3, 6, { aufNachher: 0.05 })], ["B", reihe(3, 6)], ["K1", reihe(3, 3.3)], ["K2", reihe(3, 3.3)]]),
  trafficBis: plusTage(START, 4), einst: E, ...extra,
});

test("Finished phase: net effect as in the ladder, final status, all figures per listing and day", () => {
  const d = baueDashboard(grund());
  const p = d.phasen.find((x) => x.stufe === "titel");
  assert.equal(p.status, "fertig");
  assert.equal(p.gelaufen, 4); assert.equal(p.angebote, 2); assert.equal(p.kontrolleAnzahl, 2);
  assert.equal(p.test.vorher.imp, 3); assert.equal(p.test.nachher.imp, 6);
  assert.ok(Math.abs(p.kontrolle.nachher.imp - 3.3) < 1e-9);
  // the same formula as leiter.werteAus / auswertung.netto: (6/3) / (3.3/3) − 1
  assert.ok(Math.abs(p.netto.imp - netto({ vorher: 3, nachher: 6 }, { vorher: 3, nachher: 3.3 })) < 1e-9);
  assert.ok(Math.abs(p.netto.imp - (2 / 1.1 - 1)) < 1e-9, "+82 %");
  assert.equal(p.besser, 2); assert.equal(p.schlechter, 0); assert.equal(p.gleich, 0);
});

test("Running phase: interim figures only over days with finished data, status preliminary", () => {
  const d = baueDashboard(grund({ trafficBis: plusTage(START, 2) }));
  const p = d.phasen[0];
  assert.equal(p.status, "laeuft");
  assert.equal(p.gelaufen, 2, "Tag 2 von 4");
  assert.equal(p.test.nachher.imp, 6);
  assert.ok(p.netto.imp > 0.2);
});

test("Curve: 100 = average of the 7 days before, aligned per listing at its own start day, missing start day", () => {
  // B starts one day later than A: both double on their own day 1
  const g = grund();
  g.starts[1] = { number: "B", stufe: "titel", tag: plusTage(START, 1), vonHand: false };
  g.tage.set("B", reihe(3, 6, { start: plusTage(START, 1) }));
  g.trafficBis = plusTage(START, 5);
  const p = baueDashboard(g).phasen[0];
  const tage = p.kurve.map((k) => k.tag);
  assert.deepEqual(tage, [-7, -6, -5, -4, -3, -2, -1, 1, 2, 3, 4], "kein Tag 0, höchstens so viele Tage wie die Prüfzeit");
  assert.equal(p.kurve.find((k) => k.tag === -3).test, 100);
  assert.equal(p.kurve.find((k) => k.tag === 1).test, 200, "beide Angebote am eigenen Tag 1 verdoppelt");
  assert.ok(Math.abs(p.kurve.find((k) => k.tag === 1).kontrolle - 110) < 1e-9);
});

test("Single listings: better or worse from ±10 %, roughly equal in between", () => {
  const g = grund();
  g.starts.push({ number: "C", stufe: "titel", tag: START }, { number: "D", stufe: "titel", tag: START });
  g.tage.set("B", reihe(3, 2)); g.tage.set("C", reihe(3, 3.2)); g.tage.set("D", reihe(0, 1));
  const p = baueDashboard(g).phasen[0];
  assert.deepEqual([p.besser, p.schlechter, p.gleich], [2, 1, 1], "A +100 %, D von 0 auf 1 besser; B −33 % schlechter; C +7 % gleich");
});

test("Click rate and sales: per group, control converted to the same number of listings", () => {
  const g = grund();
  g.tage.set("A", reihe(3, 6, { aufNachher: 0.05, trans: 1 }));
  g.tage.set("K1", reihe(3, 3.3, { trans: 1 })); // K2 ohne Verkäufe → Durchschnitt 0,5 je Tag und Angebot
  const p = baueDashboard(g).phasen[0];
  assert.ok(Math.abs(p.test.nachher.auf / p.test.nachher.imp - 0.04) < 1e-9, "A 5 %, B 3 % → 4 %");
  assert.equal(p.verkaeufe.test, 4, "A: 1 Verkauf an jedem der 4 Tage");
  assert.equal(p.verkaeufe.kontrolle, 4, "je Phasenangebot der Durchschnitt der Kontrolle (2 × 4 × 0,5)");
  assert.ok(p.netto.auf > p.netto.imp, "Aufrufe stiegen stärker als Impressionen");
});

test("Without a control group over the same days: no net effect, but the phase's figures", () => {
  const g = grund({ kontrolle: [{ number: "K1", start: plusTage(START, 1) }] }); // startet nach der Phase: deckt sie nicht ab
  const p = baueDashboard(g).phasen[0];
  assert.equal(p.kontrolle, null); assert.equal(p.netto.imp, null);
  assert.equal(p.ohneKontrolle, 2); assert.equal(p.test.nachher.imp, 6);
});

test("Planned and waiting: no starts → planned; start without finished days → running without figures", () => {
  const d = baueDashboard(grund());
  assert.equal(d.phasen.find((x) => x.stufe === "werbung").status, "geplant");
  assert.equal(d.phasen.find((x) => x.stufe === "preis").status, "geplant");
  const w = baueDashboard(grund({ trafficBis: START })).phasen[0];
  assert.equal(w.status, "laeuft"); assert.equal(w.mitDaten, 0); assert.equal(w.gelaufen, 0);
  const ohne = baueDashboard(grund({ trafficBis: null })).phasen[0];
  assert.equal(ohne.status, "laeuft"); assert.equal(ohne.mitDaten, 0);
  const leer = baueDashboard();
  assert.deepEqual(leer.phasen.map((p) => p.status), ["geplant", "geplant", "geplant"]);
  assert.deepEqual(leer.summe, { aufLeiter: 0, kontrolle: 0, erholt: 0, aenderungenEbay: 0 });
});

test("Totals and restart: the latest start per listing counts, manual starts are no eBay change", () => {
  const g = grund({ auswertungen: [{ number: "A", stufe: "titel", erholt: true }, { number: "B", stufe: "titel", erholt: false }] });
  g.starts.push({ number: "A", stufe: "titel", tag: plusTage(START, -60), vonHand: true }, { number: "B", stufe: "werbung", tag: plusTage(START, 4), vonHand: true });
  const d = baueDashboard(g);
  assert.equal(d.phasen[0].angebote, 2, "A zählt einmal, mit dem jüngeren Start");
  assert.equal(d.phasen[0].start, START);
  assert.equal(d.phasen[0].erholt, 1);
  assert.deepEqual(d.summe, { aufLeiter: 2, kontrolle: 2, erholt: 1, aenderungenEbay: 2 });
  assert.equal(d.phasen.find((x) => x.stufe === "werbung").status, "laeuft");
});

test("Take off / Start over: a start no longer counts if the listing was cancelled or reset afterwards", () => {
  const g = grund();
  g.starts = g.starts.map((s) => ({ ...s, at: s.tag + "T09:00:00Z" }));
  g.abbrueche = [{ number: "B", at: plusTage(START, 2) + "T10:00:00Z" }, { number: "A", at: plusTage(START, -5) + "T10:00:00Z" }];
  const d = baueDashboard(g);
  assert.equal(d.phasen[0].angebote, 1, "B wurde nach dem Start abgebrochen; A nur vor dem Start, zählt also");
  assert.equal(d.summe.aufLeiter, 1);
});

test("Data needed: all listings of the phases and of the control, from 31 days before the earliest start", () => {
  const b = benoetigt(grund());
  assert.deepEqual(b.nummern.sort(), ["A", "B", "K1", "K2"]);
  assert.equal(b.ab, plusTage(START, -BASIS_TAGE - 1));
  assert.deepEqual(benoetigt({}), { nummern: [], ab: null });
});

test("No costs, fees or revenue in the result (only eBay quantities)", () => {
  const text = JSON.stringify(baueDashboard(grund()));
  assert.doesNotMatch(text, /preis_aktuell|umsatz|revenue|kosten|marge|avg_price/i);
});
