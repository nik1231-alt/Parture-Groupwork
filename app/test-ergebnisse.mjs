// Tests for the page Results (ergebnisse.mjs, ergebnisse-demo.mjs): evaluate runs separately, verdict "clear increase / decrease / not distinguishable from chance
// / too early", the figures agree with the page Funnel (leiter.wirkung), edge cases and the example view with invented figures.
import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { urteil, schaetze, tKritisch, baueErgebnisse, fluss, ausgleich, MIN_AUSGEWERTET, PHASEN, ALLE } from "./ergebnisse.mjs";
import { baueDemoErgebnisse } from "./ergebnisse-demo.mjs";
import * as leiter from "./leiter.mjs";
import { EINSTELLUNGEN } from "./regeln.mjs";

const nahe = (a, b, msg, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${msg ?? ""} ${a} != ${b}`);
const K = (v, n) => ({ anzahl: 20, vorher90: v, nachher90: n });
// A listing with one evaluation in a phase (details as in leiter.werteAus); tag = day on which it came onto the ladder
const angebot = (number, stufe, vorher90, nachher90, kontrolle, tag = "2026-10-01", erholt = false) => ({
  number, title: "Listing " + number, stufe: "pruefung", phase: "fertig", ergebnis: null, eingestiegen_at: tag + "T06:00:00.000Z",
  verlauf: [{ stufe, ereignis: "ausgewertet", at: "2026-10-20T06:00:00.000Z", details: { vorher90, nachher90, erholt, kontrolle, netto: kontrolle ? (nachher90 / vorher90) / (kontrolle.nachher90 / kontrolle.vorher90) - 1 : null } }],
});
const kontrolleAngebot = (nr) => ({ number: nr, stufe: "kontrolle", phase: "laeuft", ergebnis: null, eingestiegen_at: "2026-10-01T06:00:00.000Z", verlauf: [] });
const uebersicht = (angebote) => ({ angebote, tage: { titel: 14, werbung: 14, preis: 21 }, trafficBis: "2026-11-10" });
const viele = (prefix, stufe, n, vorher, nachher, tag) => Array.from({ length: n }, (_, i) => angebot(prefix + i, stufe, vorher, nachher, K(1000, 1000), tag));

test("95 % range: known case with three listings, too few values, equal values", () => {
  // Logarithms 0.1 / 0.2 / 0.3: mean 0.2, spread 0.1, standard error 0.0577, t(2) = 4.303 → distance 0.2484
  const s = schaetze([Math.exp(0.1) - 1, Math.exp(0.2) - 1, Math.exp(0.3) - 1]);
  nahe(s.effekt, Math.exp(0.2) - 1); nahe(s.von, Math.exp(0.2 - 0.2484) - 1, "von", 1e-3); nahe(s.bis, Math.exp(0.2 + 0.2484) - 1, "bis", 1e-3); assert.equal(s.n, 3);
  assert.equal(schaetze([0.3]), null, "a single listing says nothing about the spread");
  assert.equal(schaetze([]), null);
  const gleich = schaetze([0.2, 0.2, 0.2, 0.2, 0.2]);
  nahe(gleich.von, 0.2); nahe(gleich.bis, 0.2);
  assert.equal(tKritisch(0), null); assert.equal(tKritisch(1), 12.706); assert.equal(tKritisch(30), 2.042); assert.equal(tKritisch(500), 1.96);
});

test("The more listings, the narrower the range (same spread)", () => {
  const mix = (n) => Array.from({ length: n }, (_, i) => (i % 2 ? 0.1 : 0.3));
  const a = schaetze(mix(6)), b = schaetze(mix(60));
  assert.ok(b.bis - b.von < a.bis - a.von);
});

test("A listing with 0 impressions afterwards (−100 %) does not break the calculation", () => {
  const s = schaetze([-1, 0.2, 0.1, 0.3, 0.2]);
  for (const v of [s.effekt, s.von, s.bis]) assert.ok(Number.isFinite(v));
});

test("Verdict: whole range above zero = clear increase, below = clear decrease, otherwise not distinguishable from chance, too few = too early", () => {
  const sch = (von, bis) => ({ effekt: (von + bis) / 2, von, bis, n: 10 });
  assert.equal(urteil(sch(0.05, 0.3), 10), "up");
  assert.equal(urteil(sch(-0.3, -0.05), 10), "down");
  assert.equal(urteil(sch(-0.02, 0.3), 10), "unclear", "the range reaches across zero");
  assert.equal(urteil(sch(0.0, 0.3), 10), "unclear", "exactly zero does not count as clear yet");
  assert.equal(urteil(sch(0.05, 0.3), MIN_AUSGEWERTET - 1), "too_few", "a nice value from too few listings is not judged");
  assert.equal(urteil(null, 50), "too_few");
});

test("Nothing evaluated: empty, only 'all runs', three phases without figures", () => {
  const e = baueErgebnisse(uebersicht([]));
  assert.equal(e.leer, true);
  assert.deepEqual(e.laeufe.map((l) => l.schluessel), [ALLE]);
  assert.deepEqual(e.laeufe[0].phasen.map((p) => p.schluessel), PHASEN.map(([s]) => s));
  for (const p of e.laeufe[0].phasen) { assert.equal(p.ausgewertet, 0); assert.equal(p.schaetzung, null); assert.equal(p.urteil, "too_few"); }
});

test("Runs: one run per start day, newest first, each evaluates only its own listings, the control group belongs to no run", () => {
  const alt = viele("A", "werbung", 6, 100, 150, "2026-10-01"), neu = viele("N", "werbung", 5, 100, 80, "2026-10-08");
  const e = baueErgebnisse(uebersicht([...alt, ...neu, kontrolleAngebot("K1"), kontrolleAngebot("K2")]));
  assert.deepEqual(e.laeufe.map((l) => l.schluessel), [ALLE, "2026-10-08", "2026-10-01"]);
  assert.deepEqual(e.laeufe.map((l) => l.angebote), [11, 5, 6], "counted without the control group");
  assert.equal(e.kontrollgruppe, 2);
  const w = (i) => e.laeufe[i].phasen.find((p) => p.schluessel === "werbung");
  assert.equal(w(1).ausgewertet, 5); nahe(w(1).netto, -0.2); assert.equal(w(1).urteil, "down", "only the bad listings");
  assert.equal(w(2).ausgewertet, 6); nahe(w(2).netto, 0.5); assert.equal(w(2).urteil, "up", "only the good listings");
  assert.equal(w(0).ausgewertet, 11, "all together");
});

test("Net effect and sums per phase: listings against control group; without a control group a listing counts as checked but not in the effect", () => {
  const mitK = viele("A", "titel", 5, 100, 130), ohne = angebot("Z", "titel", 100, 500, null);
  const p = baueErgebnisse(uebersicht([...mitK, ohne])).laeufe[0].phasen[0];
  assert.equal(p.ausgewertet, 6); assert.equal(p.mitKontrolle, 5);
  assert.equal(p.vorher90, 500); assert.equal(p.nachher90, 650);
  nahe(p.aenderung, 0.3); nahe(p.kontrolleAenderung, 0); nahe(p.netto, 0.3);
  assert.equal(p.urteil, "up", "all five +30 %, spread 0: the range collapses to one point above zero");
});

test("The figures on Results and on the Funnel page (leiter.wirkung) never differ", () => {
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
  assert.equal(e.laeufe.length, 2, "all listings came on the same day: one run plus 'all'");
  db.close();
});

test("Funnel overview: how many reached each phase and what became of them", () => {
  const ev = (stufe, ereignis, details = null) => ({ stufe, ereignis, details });
  const aus = (stufe, erholt) => ev(stufe, "ausgewertet", { erholt });
  const a = (stufe, phase, ergebnis, verlauf) => ({ stufe, phase, ergebnis, verlauf });
  const f = fluss([
    a("raus", "fertig", "erholt", [ev("titel", "aufgenommen"), ev("titel", "gestartet"), aus("titel", true)]),                                   // Titel: wieder gesehen
    a("werbung", "laeuft", null, [ev("titel", "aufgenommen"), aus("titel", false), ev("werbung", "vorschlag"), ev("werbung", "gestartet")]),    // Titel weiter, Werbung läuft
    a("preis", "vorschlag", null, [ev("titel", "aufgenommen"), aus("titel", false), ev("werbung", "uebersprungen"), ev("preis", "vorschlag")]), // Werbung übersprungen, Preis wartet
    a("pruefung", "offen", null, [ev("titel", "aufgenommen"), aus("titel", false), aus("werbung", false), aus("preis", false), ev("pruefung", "pruefung")]), // alles durch, wartet auf Entscheidung
    a("raus", "fertig", "behalten", [ev("titel", "aufgenommen"), aus("titel", false), aus("werbung", false), aus("preis", false), ev("pruefung", "pruefung"), ev("pruefung", "entschieden", { entscheidung: "behalten" })]),
    a("werbung", "vorschlag", null, [ev("titel", "aufgenommen"), aus("titel", false), ev("werbung", "vorschlag")]),                             // Werbung wartet auf Freigabe
  ]);
  const [titel, werbung, preis] = f.stufen;
  assert.deepEqual([titel.erreicht, titel.erholt, titel.weiter], [6, 1, 5], "all six were in phase 1, one was seen again");
  assert.deepEqual([werbung.erreicht, werbung.weiter, werbung.laeuft, werbung.wartet, werbung.uebersprungen], [5, 2, 1, 1, 1], "ads: two passed on, one running, one waiting, one skipped");
  assert.deepEqual([preis.erreicht, preis.weiter, preis.wartet], [3, 2, 1]);
  assert.deepEqual(f.pruefung, { erreicht: 2, offen: 1, behalten: 1, ueberarbeiten: 0, offline: 0 });
  for (const z of f.stufen) assert.equal(z.erholt + z.weiter + z.laeuft + z.wartet + z.uebersprungen + z.entfernt, z.erreicht, z.schluessel + ": jedes Angebot landet in genau einer Spalte");
});

test("Funnel overview per run: counts only its own listings, the control group does not count", () => {
  const e = baueErgebnisse(uebersicht([...viele("A", "titel", 3, 100, 110, "2026-10-01"), ...viele("B", "titel", 2, 100, 110, "2026-10-08"), kontrolleAngebot("K1")]));
  assert.equal(e.laeufe[0].fluss.stufen[0].erreicht, 5, "all runs");
  assert.equal(e.laeufe[1].fluss.stufen[0].erreicht, 2, "newer run");
  assert.equal(e.laeufe[2].fluss.stufen[0].erreicht, 3, "older run");
});

test("Running listings: are counted, the first end date is named, they are no result yet", () => {
  const laeuft = (nr, ende) => ({ number: nr, stufe: "werbung", phase: "laeuft", eingestiegen_at: "2026-10-01T06:00:00.000Z", verlauf: [], stand: { ende } });
  const e = baueErgebnisse(uebersicht([laeuft("L1", "2026-11-30"), laeuft("L2", "2026-11-25")]));
  assert.equal(e.leer, true);
  assert.equal(e.laeufe[0].phasen[1].laeuft, 2); assert.equal(e.laeufe[0].phasen[1].naechstesEnde, "2026-11-25");
});

test("Example view: invented figures, always the same, two runs plus all, ads clearly better, title not distinguishable from chance, everything finite", () => {
  const a = baueDemoErgebnisse(EINSTELLUNGEN), b = baueDemoErgebnisse(EINSTELLUNGEN);
  assert.equal(a.beispiel, true);
  assert.equal(JSON.stringify(a), JSON.stringify(b), "fixed start values: every call the same");
  assert.equal(a.laeufe.length, 3); assert.equal(a.laeufe[0].angebote, 24); assert.equal(a.leer, false);
  assert.deepEqual(a.laeufe[0].phasen.map((p) => p.urteil), ["unclear", "up", "unclear"]);
  for (const l of a.laeufe) {
    assert.equal(l.phasen[1].urteil, "up", "ads are a clear increase in every run");
    for (const p of l.phasen) for (const v of [p.netto, p.aenderung, p.kontrolleAenderung]) assert.ok(Number.isFinite(v), p.schluessel);
  }
  assert.ok(a.laeufe.some((l) => l.phasen.some((p) => p.urteil === "too_few")), "one run also shows 'too early'");
  const w = a.laeufe[0].fluss.stufen[1];
  assert.deepEqual([w.laeuft, w.wartet], [2, 1], "the example also shows running and waiting listings");
});

test("Balance at the draw (F5): impressions of test and control over the 30 days before their draw day, per run", () => {
  const laeuft = (nr, tag, kontrolle = false) => ({ number: nr, stufe: kontrolle ? "kontrolle" : "titel", phase: kontrolle ? "kontrolle" : "laeuft", eingestiegen_at: tag + "T16:00:00.000Z", verlauf: [] });
  const fenster = [];
  const impTag = (nr, von, bis) => { fenster.push([nr, von, bis]); return { T1: 2, T2: 4, K1: 3, K2: 3, T3: 10, K3: 10 }[nr]; };
  const e = baueErgebnisse(uebersicht([laeuft("T1", "2026-11-20"), laeuft("T2", "2026-11-20"), laeuft("K1", "2026-11-20", true), laeuft("K2", "2026-11-20", true),
    laeuft("T3", "2026-11-22"), laeuft("K3", "2026-11-22", true)]), { impTag });
  assert.deepEqual(e.laeufe[0].ausgleich, { test: 1440, kontrolle: 1440, nTest: 3, nKontrolle: 3 }, "all runs: (2+4+10)×90 against (3+3+10)×90");
  const r20 = e.laeufe.find((l) => l.schluessel === "2026-11-20");
  assert.deepEqual(r20.ausgleich, { test: 540, kontrolle: 540, nTest: 2, nKontrolle: 2 }, "the run counts only the controls drawn the same day");
  assert.ok(fenster.some(([nr, von, bis]) => nr === "T1" && von === "2026-10-20" && bis === "2026-11-19"), "30 days before the draw day");
  assert.equal(baueErgebnisse(uebersicht([laeuft("T1", "2026-11-20")])).laeufe[0].ausgleich, null, "without impTag or without controls: nothing");
  assert.equal(ausgleich([], [], impTag), null);
});

test("Ended early (F2): a phase counts its early evaluations and the shortest measurement", () => {
  const früh = (nr, tage) => { const a = angebot(nr, "titel", 100, 150, K(1000, 1000)); Object.assign(a.verlauf[0].details, { vorzeitig: true, gemessenTage: tage, tage: 14 }); return a; };
  const p = baueErgebnisse(uebersicht([früh("E1", 4), früh("E2", 6), angebot("V1", "titel", 100, 150, K(1000, 1000))])).laeufe[0].phasen[0];
  assert.equal(p.vorzeitig, 2); assert.equal(p.kuerzesteTage, 4);
  const ohne = baueErgebnisse(uebersicht([angebot("V2", "titel", 100, 150, K(1000, 1000))])).laeufe[0].phasen[0];
  assert.equal(ohne.vorzeitig, 0); assert.equal(ohne.kuerzesteTage, null);
});

test("Live interim: before the first day only the real 'before' figures, no verdict; with days in the data the same net-effect rule as a finished phase", () => {
  const K2 = (v, n) => ({ anzahl: 10, vorher90: v, nachher90: n });
  const laeuft = (nr, stand) => ({ number: nr, stufe: "titel", phase: "laeuft", eingestiegen_at: "2026-11-20T16:43:00.000Z", verlauf: [], stand });
  // Start day = last data day: gelaufen 0, nothing after the start yet
  const frisch = baueErgebnisse(uebersicht([1, 2, 3].map((i) => laeuft("F" + i, { tage: 14, gelaufen: 0, ende: "2026-12-04", jetzt90: null, vorher90: 300, kontrolle: null, netto: null }))));
  assert.equal(frisch.leer, true, "nothing finished"); assert.equal(frisch.live, true, "but a phase runs: the page shows real figures, not the example");
  const z0 = frisch.laeufe[0].phasen[0].zwischenstand;
  assert.deepEqual([z0.anzahl, z0.mitDaten, z0.gelaufen, z0.tage, z0.vorher90, z0.nachher90, z0.urteil], [3, 0, 0, 14, 900, null, "too_few"]);
  assert.equal(frisch.laeufe[0].phasen[1].zwischenstand, null, "a phase without running listings has no interim");
  // Day 4 of 14: six listings, all doubled while the control group stayed flat → +100 % per listing, a clear increase (interim)
  const sechs = Array.from({ length: 6 }, (_, i) => laeuft("D" + i, { tage: 14, gelaufen: 4, ende: "2026-12-04", jetzt90: 600, vorher90: 300, kontrolle: K2(1000, 1000), netto: 1 }));
  const z = baueErgebnisse(uebersicht(sechs)).laeufe[0].phasen[0].zwischenstand;
  assert.deepEqual([z.mitDaten, z.mitKontrolle, z.gelaufen, z.vorher90, z.nachher90], [6, 6, 4, 1800, 3600]);
  nahe(z.aenderung, 1); nahe(z.kontrolleAenderung, 0); nahe(z.netto, 1); nahe(z.schaetzung.effekt, 1);
  assert.equal(z.urteil, "up");
  // Fewer than the minimum: the figures are there, the verdict waits
  const zwei = baueErgebnisse(uebersicht(sechs.slice(0, 2))).laeufe[0].phasen[0].zwischenstand;
  assert.equal(zwei.urteil, "too_few"); nahe(zwei.netto, 1);
});
