// Tests für das Dashboard (ergebnisse.mjs): Status je Phase, Nettoeffekt gegen die Kontrollgruppe (gleich wie leiter.werteAus),
// Zwischenstand während der Prüfzeit, Kurve, einzelne Angebote besser/schlechter, Sonderfälle ohne Daten oder ohne Kontrolle.
// Reine Rechnung mit erfundenen Tageswerten; keine Datenbank, kein Netz.
import test from "node:test";
import assert from "node:assert/strict";
import { baueDashboard, benoetigt, BASIS_TAGE } from "./ergebnisse.mjs";
import { EINSTELLUNGEN } from "./regeln.mjs";
import { netto } from "./auswertung.mjs";

const E = { ...EINSTELLUNGEN, leiterTageTitel: 4, leiterTageWerbung: 4, leiterTagePreis: 4 };
const plusTage = (t, n) => new Date(Date.parse(t + "T12:00:00Z") + n * 864e5).toISOString().slice(0, 10);
const START = "2026-11-20";
// Tageswerte: vor dem Start "vorher" Impressionen je Tag, danach "nachher"; Aufrufe und Verkäufe als Anteil
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

test("Phase fertig: Nettoeffekt wie in der Leiter, Status final, alle Zahlen je Angebot und Tag", () => {
  const d = baueDashboard(grund());
  const p = d.phasen.find((x) => x.stufe === "titel");
  assert.equal(p.status, "fertig");
  assert.equal(p.gelaufen, 4); assert.equal(p.angebote, 2); assert.equal(p.kontrolleAnzahl, 2);
  assert.equal(p.test.vorher.imp, 3); assert.equal(p.test.nachher.imp, 6);
  assert.ok(Math.abs(p.kontrolle.nachher.imp - 3.3) < 1e-9);
  // dieselbe Formel wie leiter.werteAus / auswertung.netto: (6/3) / (3.3/3) − 1
  assert.ok(Math.abs(p.netto.imp - netto({ vorher: 3, nachher: 6 }, { vorher: 3, nachher: 3.3 })) < 1e-9);
  assert.ok(Math.abs(p.netto.imp - (2 / 1.1 - 1)) < 1e-9, "+82 %");
  assert.equal(p.besser, 2); assert.equal(p.schlechter, 0); assert.equal(p.gleich, 0);
});

test("Phase läuft: Zwischenstand nur über die Tage mit fertigen Daten, Status preliminary", () => {
  const d = baueDashboard(grund({ trafficBis: plusTage(START, 2) }));
  const p = d.phasen[0];
  assert.equal(p.status, "laeuft");
  assert.equal(p.gelaufen, 2, "Tag 2 von 4");
  assert.equal(p.test.nachher.imp, 6);
  assert.ok(p.netto.imp > 0.2);
});

test("Kurve: 100 = Durchschnitt der 7 Tage vorher, je Angebot an seinem eigenen Starttag ausgerichtet, Starttag fehlt", () => {
  // B startet einen Tag später als A: beide steigen am eigenen Tag 1 auf das Doppelte
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

test("Einzelne Angebote: ab ±10 % besser oder schlechter, dazwischen etwa gleich", () => {
  const g = grund();
  g.starts.push({ number: "C", stufe: "titel", tag: START }, { number: "D", stufe: "titel", tag: START });
  g.tage.set("B", reihe(3, 2)); g.tage.set("C", reihe(3, 3.2)); g.tage.set("D", reihe(0, 1));
  const p = baueDashboard(g).phasen[0];
  assert.deepEqual([p.besser, p.schlechter, p.gleich], [2, 1, 1], "A +100 %, D von 0 auf 1 besser; B −33 % schlechter; C +7 % gleich");
});

test("Klickrate und Verkäufe: je Gruppe, Kontrolle auf gleich viele Angebote umgerechnet", () => {
  const g = grund();
  g.tage.set("A", reihe(3, 6, { aufNachher: 0.05, trans: 1 }));
  g.tage.set("K1", reihe(3, 3.3, { trans: 1 })); // K2 ohne Verkäufe → Durchschnitt 0,5 je Tag und Angebot
  const p = baueDashboard(g).phasen[0];
  assert.ok(Math.abs(p.test.nachher.auf / p.test.nachher.imp - 0.04) < 1e-9, "A 5 %, B 3 % → 4 %");
  assert.equal(p.verkaeufe.test, 4, "A: 1 Verkauf an jedem der 4 Tage");
  assert.equal(p.verkaeufe.kontrolle, 4, "je Phasenangebot der Durchschnitt der Kontrolle (2 × 4 × 0,5)");
  assert.ok(p.netto.auf > p.netto.imp, "Aufrufe stiegen stärker als Impressionen");
});

test("Ohne Kontrollgruppe über dieselben Tage: kein Nettoeffekt, aber die Zahlen der Phase", () => {
  const g = grund({ kontrolle: [{ number: "K1", start: plusTage(START, 1) }] }); // startet nach der Phase: deckt sie nicht ab
  const p = baueDashboard(g).phasen[0];
  assert.equal(p.kontrolle, null); assert.equal(p.netto.imp, null);
  assert.equal(p.ohneKontrolle, 2); assert.equal(p.test.nachher.imp, 6);
});

test("Geplant und wartend: keine Starts → geplant; Start ohne fertige Tage → läuft ohne Zahlen", () => {
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

test("Summen und Neustart: der jüngste Start je Angebot zählt, Starts von Hand sind keine eBay-Änderung", () => {
  const g = grund({ auswertungen: [{ number: "A", stufe: "titel", erholt: true }, { number: "B", stufe: "titel", erholt: false }] });
  g.starts.push({ number: "A", stufe: "titel", tag: plusTage(START, -60), vonHand: true }, { number: "B", stufe: "werbung", tag: plusTage(START, 4), vonHand: true });
  const d = baueDashboard(g);
  assert.equal(d.phasen[0].angebote, 2, "A zählt einmal, mit dem jüngeren Start");
  assert.equal(d.phasen[0].start, START);
  assert.equal(d.phasen[0].erholt, 1);
  assert.deepEqual(d.summe, { aufLeiter: 2, kontrolle: 2, erholt: 1, aenderungenEbay: 2 });
  assert.equal(d.phasen.find((x) => x.stufe === "werbung").status, "laeuft");
});

test("Take off / Start over: ein Start zählt nicht mehr, wenn das Angebot danach abgebrochen oder zurückgesetzt wurde", () => {
  const g = grund();
  g.starts = g.starts.map((s) => ({ ...s, at: s.tag + "T09:00:00Z" }));
  g.abbrueche = [{ number: "B", at: plusTage(START, 2) + "T10:00:00Z" }, { number: "A", at: plusTage(START, -5) + "T10:00:00Z" }];
  const d = baueDashboard(g);
  assert.equal(d.phasen[0].angebote, 1, "B wurde nach dem Start abgebrochen; A nur vor dem Start, zählt also");
  assert.equal(d.summe.aufLeiter, 1);
});

test("Benötigte Daten: alle Angebote der Phasen und der Kontrolle, ab 31 Tage vor dem frühesten Start", () => {
  const b = benoetigt(grund());
  assert.deepEqual(b.nummern.sort(), ["A", "B", "K1", "K2"]);
  assert.equal(b.ab, plusTage(START, -BASIS_TAGE - 1));
  assert.deepEqual(benoetigt({}), { nummern: [], ab: null });
});

test("Keine Kosten, Gebühren oder Umsätze im Ergebnis (nur eBay-Mengen)", () => {
  const text = JSON.stringify(baueDashboard(grund()));
  assert.doesNotMatch(text, /preis_aktuell|umsatz|revenue|kosten|marge|avg_price/i);
});
