// Tests für die Seite Results (ergebnisse.mjs, ergebnisse-demo.mjs): Urteil je Phase, Nettoeffekt gleich wie auf der Seite Funnel,
// Randfälle (keine Kontrollgruppe, zu wenige Angebote, nichts ausgewertet), Verlauf als Index und die Beispielansicht mit erfundenen Zahlen.
// Reine Rechnung, dazu eine Datenbank im Speicher, damit die Zahlen gegen leiter.wirkung (Seite Funnel) geprüft werden können.
import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { urteil, baueErgebnisse, baueVerlauf, MIN_AUSGEWERTET, PHASEN } from "./ergebnisse.mjs";
import { baueDemoErgebnisse } from "./ergebnisse-demo.mjs";
import * as leiter from "./leiter.mjs";
import { EINSTELLUNGEN } from "./regeln.mjs";

const nahe = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg ?? ""} ${a} != ${b}`);
const K = (v, n) => ({ anzahl: 20, vorher90: v, nachher90: n });
// Ein Angebot mit einer Auswertung in einer Phase (details wie in leiter.werteAus)
const angebot = (number, stufe, vorher90, nachher90, kontrolle, erholt = false) => ({
  number, title: "Listing " + number, stufe: "pruefung", phase: "fertig", ergebnis: null,
  verlauf: [{ stufe, ereignis: "ausgewertet", at: "2026-10-20T06:00:00.000Z", details: { vorher90, nachher90, erholt, kontrolle, netto: kontrolle ? (nachher90 / vorher90) / (kontrolle.nachher90 / kontrolle.vorher90) - 1 : null } }],
});
const uebersicht = (angebote) => ({ angebote, tage: { titel: 14, werbung: 14, preis: 21 }, trafficBis: "2026-11-10" });

test("Urteil je Phase: ab +20 % besser, ab −20 % schlechter, dazwischen nichts bewiesen, zu wenige Angebote oder keine Kontrolle = zu früh", () => {
  assert.equal(urteil(0.2, 10, 0.2), "better", "genau auf der Grenze zählt");
  assert.equal(urteil(0.1999, 10, 0.2), "no_difference");
  assert.equal(urteil(-0.2, 10, 0.2), "worse");
  assert.equal(urteil(0, 10, 0.2), "no_difference");
  assert.equal(urteil(0.9, MIN_AUSGEWERTET - 1, 0.2), "too_few", "ein großer Effekt aus wenigen Angeboten wird nicht beurteilt");
  assert.equal(urteil(null, 50, 0.2), "too_few", "ohne Kontrollgruppe kein Nettoeffekt");
});

test("Nichts ausgewertet: leer, drei Phasen ohne Zahlen, kein Gesamteffekt, keine Fehler", () => {
  const e = baueErgebnisse(uebersicht([]), null);
  assert.equal(e.leer, true);
  assert.deepEqual(e.phasen.map((p) => p.schluessel), PHASEN.map(([s]) => s));
  for (const p of e.phasen) { assert.equal(p.ausgewertet, 0); assert.equal(p.netto, null); assert.equal(p.urteil, "too_few"); assert.equal(p.verlauf, null); }
  assert.equal(e.kombiniert, null);
});

test("Nettoeffekt: Summe vorher/nachher der Angebote gegen die Kontrollgruppe, wie auf der Seite Funnel", () => {
  const angebote = Array.from({ length: 6 }, (_, i) => angebot("A" + i, "werbung", 100, 150, K(1000, 1000)));
  const e = baueErgebnisse(uebersicht(angebote), null);
  const w = e.phasen.find((p) => p.schluessel === "werbung");
  assert.equal(w.ausgewertet, 6); assert.equal(w.vorher90, 600); assert.equal(w.nachher90, 900);
  nahe(w.netto, 0.5); nahe(w.aenderung, 0.5); nahe(w.kontrolleAenderung, 0);
  assert.equal(w.urteil, "better");
  nahe(w.median, 0.5); assert.equal(w.anteilBesser, 1);
  assert.equal(e.leer, false);
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
  const e = baueErgebnisse(u, null);
  const w = leiter.wirkung(db);
  for (const p of e.phasen) {
    const x = w[p.schluessel];
    assert.equal(p.ausgewertet, x.ausgewertet, p.schluessel + " ausgewertet");
    assert.equal(p.erholt, x.erholt, p.schluessel + " erholt");
    assert.equal(p.mitKontrolle, x.mitKontrolle, p.schluessel + " mit Kontrolle");
    assert.equal(p.vorher90, x.vorher90); assert.equal(p.nachher90, x.nachher90);
    assert.equal(p.kontrolleVorher90, x.kontrolleVorher90); assert.equal(p.kontrolleNachher90, x.kontrolleNachher90);
    if (x.netto == null) assert.equal(p.netto, null, p.schluessel); else nahe(p.netto, x.netto, p.schluessel + " netto");
  }
  const titel = e.phasen[0];
  assert.equal(titel.ausgewertet, 3, "drei Auswertungen in der Phase Titel");
  assert.equal(titel.mitKontrolle, 2, "eine davon ohne Kontrollgruppe: zählt als geprüft, aber nicht im Nettoeffekt");
  assert.equal(titel.punkte.find((q) => q.number === "c").netto, null, "ohne Kontrollgruppe gibt es für dieses Angebot keinen Nettoeffekt");
  db.close();
});

test("Zu wenige Angebote: Phase bekommt kein Urteil und zählt nicht in den Gesamteffekt; mit genug Angeboten vervielfachen sich die Phasen", () => {
  const wenig = Array.from({ length: MIN_AUSGEWERTET - 1 }, (_, i) => angebot("T" + i, "titel", 100, 300, K(1000, 1000)));
  assert.equal(baueErgebnisse(uebersicht(wenig), null).kombiniert, null);
  const titel = Array.from({ length: 6 }, (_, i) => angebot("T" + i, "titel", 100, 120, K(1000, 1000)));
  const werbung = Array.from({ length: 6 }, (_, i) => angebot("W" + i, "werbung", 100, 150, K(1000, 1000)));
  const e = baueErgebnisse(uebersicht([...titel, ...werbung]), null);
  nahe(e.kombiniert, 1.2 * 1.5 - 1, "+20 % und +50 % ergeben +80 %");
  assert.equal(e.phasen[2].urteil, "too_few", "die Phase Preis hat noch nichts");
});

test("Ein Angebot mit 0 Impressionen vorher bricht nichts: Änderung ist leer, die Summe zählt weiter", () => {
  const angebote = [...Array.from({ length: 5 }, (_, i) => angebot("N" + i, "titel", 100, 110, K(1000, 1000))), angebot("Z", "titel", 0, 40, K(1000, 1000))];
  const p = baueErgebnisse(uebersicht(angebote), null).phasen[0];
  assert.equal(p.punkte.find((q) => q.number === "Z").aenderung, null);
  for (const v of [p.netto, p.aenderung, p.median]) assert.ok(Number.isFinite(v));
});

test("Laufende Angebote: werden gezählt, das erste Ende wird genannt, sie sind noch kein Ergebnis", () => {
  const laeuft = (nr, ende) => ({ number: nr, stufe: "werbung", phase: "laeuft", verlauf: [], stand: { ende } });
  const e = baueErgebnisse(uebersicht([laeuft("L1", "2026-11-30"), laeuft("L2", "2026-11-25")]), null);
  assert.equal(e.laeuft, 2); assert.equal(e.leer, true);
  assert.equal(e.phasen[1].naechstesEnde, "2026-11-25");
});

// Tageswerte mit festem Muster: Angebote 10 am Tag, ab Start 20; Kontrollgruppe immer 10
const tw = (start) => (nr, von, bis) => { const aus = {}; for (let t = Date.parse(von); t <= Date.parse(bis); t += 864e5) { const d = new Date(t).toISOString().slice(0, 10); aus[d] = nr.startsWith("K") ? 10 : d >= start ? 20 : 10; } return aus; };

test("Verlauf: Index 100 vor dem Start, danach steigt nur die Linie der Angebote; Tage ohne Daten bleiben leer", () => {
  const start = "2026-10-01";
  const v = baueVerlauf([{ number: "A", start }, { number: "B", start }], ["K1", "K2"], 14, tw(start), { bis: "2026-10-10" });
  assert.equal(v.angebote, 2); assert.equal(v.tage[0], -30); assert.equal(v.tage.at(-1), 14);
  const i = (tag) => v.tage.indexOf(tag);
  nahe(v.test[i(-1)], 100); nahe(v.kontrolle[i(5)], 100);
  assert.ok(v.test[i(9)] > 150, "nach der Einschwingzeit deutlich über 100: " + v.test[i(9)]);
  nahe(v.kontrolle[i(9)], 100, "Kontrollgruppe bleibt flach");
  assert.equal(v.test[i(10)], null, "nach dem letzten vollständigen Tag (10.10. = Tag 9) gibt es nichts");
});

test("Verlauf: ohne Kontrollgruppe, ohne Angebote oder ohne Datenstand gibt es keinen Verlauf statt falscher Linien", () => {
  const start = "2026-10-01", f = tw(start), a = [{ number: "A", start }];
  assert.equal(baueVerlauf(a, [], 14, f, { bis: "2026-10-20" }), null);
  assert.equal(baueVerlauf([], ["K1"], 14, f, { bis: "2026-10-20" }), null);
  assert.equal(baueVerlauf(a, ["K1"], 14, f, { bis: null }), null);
  assert.equal(baueVerlauf(a, ["K1"], 14, () => ({}), { bis: "2026-10-20" }), null, "Basis 0: kein Index");
});

test("Beispielansicht: erfundene Zahlen, immer dieselben, alle drei Phasen mit Urteil, Werbung klar besser, alles endlich", () => {
  const a = baueDemoErgebnisse(EINSTELLUNGEN), b = baueDemoErgebnisse(EINSTELLUNGEN);
  assert.equal(a.beispiel, true);
  assert.deepEqual(JSON.stringify(a), JSON.stringify(b), "feste Startwerte: jeder Aufruf gleich");
  assert.deepEqual(a.phasen.map((p) => p.urteil), ["no_difference", "better", "no_difference"]);
  for (const p of a.phasen) {
    assert.ok(p.ausgewertet >= MIN_AUSGEWERTET && p.verlauf, p.schluessel);
    for (const v of [p.netto, p.aenderung, p.kontrolleAenderung, p.median]) assert.ok(Number.isFinite(v), p.schluessel);
    assert.ok(p.verlauf.test.some((x) => x != null) && p.verlauf.test.every((x) => x == null || Number.isFinite(x)));
  }
  assert.ok(Number.isFinite(a.kombiniert) && a.kombiniert > 0);
  assert.equal(a.leer, false);
});
