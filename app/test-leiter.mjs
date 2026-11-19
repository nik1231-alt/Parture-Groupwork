// Tests für die Leiter (leiter.mjs): Aufnahme, Freigabe, Prüfzeit, Auswertung, nächste Stufe, manuelle Prüfung, Sicherungen.
// Datenbank im Speicher, nachgebaute Impressionen und ein nachgebauter eBay-Schreiber; kein Netz, pm.db wird nicht angefasst.
import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { EINSTELLUNGEN } from "./regeln.mjs";
import * as protokoll from "./protokoll.mjs";
import * as leiter from "./leiter.mjs";

const E = { ...EINSTELLUNGEN, modus: "fest", festeGrenze: 900, leiterMax: 3 };
const ADMIN = { name: "niko", rolle: "admin" }, BUILDER = { name: "anna", rolle: "builder" };
const T0 = new Date("2026-11-20T09:00:00Z");
const tag = (n) => new Date(T0.getTime() + n * 864e5);
// 5 Angebote mit wenig Impressionen (unter 900 in 90 Tagen), eines ohne laufendes eBay-Angebot, eines mit genug Impressionen
const shop = () => [
  ...["A", "B", "C", "D", "E"].map((n, i) => ({ number: n, title: "Halter " + n, created_at: "2025-12-01T10:00:00Z", units_total: 10 - i, units_90d: 0, impressionen_90d: 300 + i, ebay_aktiv: 1 })),
  { number: "X", title: "beendet", created_at: "2025-12-01T10:00:00Z", units_total: 50, units_90d: 0, impressionen_90d: 10, ebay_aktiv: 0 },
  { number: "OK", title: "läuft gut", created_at: "2025-12-01T10:00:00Z", units_total: 5, units_90d: 4, impressionen_90d: 5000, ebay_aktiv: 1 },
];
const neueDb = () => { const d = new Database(":memory:"); protokoll.bereiteVor(d); leiter.bereiteVor(d); return d; };
// Impressionen je Tag: vorgegeben je Produkt, sonst 3 am Tag (= 270 in 90 Tagen, also "wenig")
const impVon = (je = {}) => (nr) => je[nr] ?? 3;
const daten = (je, trafficBis, extra = {}) => ({ impTag: impVon(je), trafficBis, grenze90: 900, einst: E, ...extra });
const schreiber = (schalter = {}) => {
  const auf = [];
  return { auf, konfiguriert: () => true, schreibenAn: () => schalter.schreiben ?? true, werbungAn: () => schalter.werbung ?? true, preisAn: () => schalter.preis ?? true,
    lies: async () => ({ ok: true, titel: "Halter A", status: "Active", verkauft: 3, preis: 9.99, variationen: [] }),
    setzeTitel: async (id, t) => { auf.push(["titel", id, t]); return { ok: true, ack: "Success", meldung: "" }; },
    setzeWerbung: async (id, s) => { auf.push(["werbung", id, s]); return { ok: true, meldung: "" }; },
    setzePreis: async (id, skus, p) => { auf.push(["preis", id, p]); return { ok: true, meldung: "" }; } };
};
const ITEMS = [{ external_id: "123456789012", title: "Halter A", skus: '["A"]', preis_aktuell: 9.99 }];
const titelVorschlag = { titel: "Wandhalter passend für A", alt: "Halter A", quelle: "ki", begruendung: "x", pruefung: { ok: true, verstoesse: [], hinweise: [] } };
const zeile = (d, n) => d.prepare("SELECT * FROM leiter WHERE number = ?").get(n);

test("Aufnahme: nur wenig Impressionen mit laufendem eBay-Angebot, bewährte zuerst, höchstens leiterMax", () => {
  const d = neueDb();
  assert.deepEqual(leiter.nimmAuf(d, shop(), E, T0), ["A", "B", "C"]);
  assert.deepEqual(leiter.nimmAuf(d, shop(), E, T0), [], "die Leiter ist voll");
  assert.deepEqual([...leiter.aktiveNummern(d)].sort(), ["A", "B", "C"]);
  assert.ok(!leiter.kandidaten(d, shop(), { ...E, leiterMax: 99 }, T0).some((p) => p.number === "X" || p.number === "OK"));
  // in einem Titeltest oder gesperrt: nicht aufnehmen
  const d2 = neueDb();
  assert.deepEqual(leiter.nimmAuf(d2, shop(), E, T0, { imTest: new Map([["A", {}]]), gesperrt: new Set(["B"]) }), ["C", "D", "E"]);
});

test("ganzer Weg ohne Erholung: Titel -> Werbung -> Preis -> manuelle Prüfung -> Entscheidung", async () => {
  const d = neueDb(), s = schreiber();
  leiter.nimmAuf(d, shop(), { ...E, leiterMax: 1 }, T0);
  assert.equal(leiter.setzeTitelVorschlag(d, BUILDER, "A", titelVorschlag, T0).ok, true);
  assert.equal((await leiter.gibFrei(d, BUILDER, "A", { items: ITEMS, schreiber: s, impTag: impVon() }, T0)).status, 403, "nur Admin gibt frei");
  const f = await leiter.gibFrei(d, ADMIN, "A", { items: ITEMS, schreiber: s, impTag: impVon() }, T0);
  assert.equal(f.wert.ausgang, "angewendet");
  assert.deepEqual(s.auf[0], ["titel", "123456789012", "Wandhalter passend für A"]);
  assert.equal(zeile(d, "A").phase, "laeuft");
  // vor dem Ende der Prüfzeit (14 Tage) wird nicht geurteilt
  assert.equal(leiter.werteAus(d, daten({}, "2026-12-03"), tag(13)).length, 0);
  // danach: weiterhin 3 am Tag = 270 in 90 Tagen < 900 -> Stufe 2 mit Vorschlag aus den Einstellungen
  const a = leiter.werteAus(d, daten({}, "2026-12-04"), tag(15));
  assert.equal(a.length, 1); assert.equal(a[0].erholt, false); assert.equal(a[0].nachher90, 270);
  assert.equal(zeile(d, "A").stufe, "werbung");
  assert.deepEqual(JSON.parse(zeile(d, "A").vorschlag), { satz: 0.1 });
  await leiter.gibFrei(d, ADMIN, "A", { items: ITEMS, schreiber: s, impTag: impVon() }, tag(15));
  assert.deepEqual(s.auf[1], ["werbung", "123456789012", 0.1]);
  leiter.werteAus(d, daten({}, "2026-12-20", { fuer: () => ({ kanaele: ITEMS, varianten: [] }) }), tag(30));
  assert.equal(zeile(d, "A").stufe, "preis");
  assert.deepEqual(JSON.parse(zeile(d, "A").vorschlag), { alt: 9.99, neu: 8.99, schritt: 0.1 });
  await leiter.gibFrei(d, ADMIN, "A", { items: ITEMS, schreiber: s, impTag: impVon() }, tag(30));
  assert.deepEqual(s.auf[2], ["preis", "123456789012", 8.99]);
  leiter.werteAus(d, daten({}, "2027-01-15"), tag(56));
  assert.equal(zeile(d, "A").stufe, "pruefung"); assert.equal(zeile(d, "A").phase, "offen");
  assert.equal(leiter.entscheide(d, ADMIN, "A", "offline", "").status, 400, "ohne Begründung keine Entscheidung");
  assert.equal(leiter.entscheide(d, ADMIN, "A", "offline", "Passt seit dem Modellwechsel nicht mehr.").ok, true);
  assert.equal(zeile(d, "A").ergebnis, "offline");
  const ereignisse = d.prepare("SELECT ereignis FROM leiter_verlauf WHERE number = 'A' ORDER BY id").all().map((r) => r.ereignis);
  assert.deepEqual(ereignisse, ["aufgenommen", "vorschlag", "freigegeben", "gestartet", "ausgewertet", "vorschlag", "freigegeben", "gestartet", "ausgewertet", "vorschlag", "freigegeben", "gestartet", "ausgewertet", "pruefung", "entschieden"]);
});

test("Erholung: wieder genug Impressionen nach der Prüfzeit -> raus aus der Leiter, Platz für das nächste Angebot", async () => {
  const d = neueDb();
  leiter.nimmAuf(d, shop(), { ...E, leiterMax: 1 }, T0);
  leiter.setzeTitelVorschlag(d, ADMIN, "A", titelVorschlag, T0);
  await leiter.gibFrei(d, ADMIN, "A", { items: ITEMS, schreiber: schreiber(), impTag: impVon() }, T0);
  const a = leiter.werteAus(d, daten({ A: 12 }, "2026-12-04"), tag(15));   // 12 am Tag = 1.080 in 90 Tagen >= 900
  assert.equal(a[0].erholt, true); assert.equal(a[0].vorher90, 270);
  assert.equal(zeile(d, "A").stufe, "raus"); assert.equal(zeile(d, "A").ergebnis, "erholt");
  assert.deepEqual(leiter.nimmAuf(d, shop(), { ...E, leiterMax: 1 }, tag(15)), ["B"], "A darf 90 Tage nicht wieder hinein, B rückt nach");
});

test("Probelauf: ohne Schreibschalter bleibt die Stufe offen und eBay unberührt; Admin kann von Hand starten", async () => {
  const d = neueDb(), s = schreiber({ schreiben: false });
  leiter.nimmAuf(d, shop(), { ...E, leiterMax: 1 }, T0);
  leiter.setzeTitelVorschlag(d, ADMIN, "A", titelVorschlag, T0);
  const f = await leiter.gibFrei(d, ADMIN, "A", { items: ITEMS, schreiber: s, impTag: impVon() }, T0);
  assert.equal(f.wert.ausgang, "probelauf"); assert.equal(s.auf.length, 0); assert.equal(zeile(d, "A").phase, "vorschlag");
  assert.equal(leiter.starteVonHand(d, BUILDER, "A", { impTag: impVon() }, T0).status, 403);
  assert.equal(leiter.starteVonHand(d, ADMIN, "A", { impTag: impVon() }, T0).ok, true);
  assert.equal(zeile(d, "A").phase, "laeuft");
  // Werbung braucht ihren eigenen Schalter, auch wenn EBAY_SCHREIBEN an ist
  const d2 = neueDb(), s2 = schreiber({ werbung: false });
  leiter.nimmAuf(d2, shop(), { ...E, leiterMax: 1 }, T0);
  leiter.ueberspringe(d2, ADMIN, "A", "kein neuer Titel", E, {}, T0);
  const w = await leiter.gibFrei(d2, ADMIN, "A", { items: ITEMS, schreiber: s2, impTag: impVon() }, T0);
  assert.equal(w.wert.ausgang, "probelauf"); assert.equal(s2.auf.length, 0);
});

test("nichts überschreiben: anderer Titel oder anderer Preis bei eBay -> fehlgeschlagen, nichts geändert", async () => {
  const d = neueDb(), s = schreiber();
  s.lies = async () => ({ ok: true, titel: "Von Hand geändert", status: "Active", verkauft: 0, preis: 7.5, variationen: [] });
  leiter.nimmAuf(d, shop(), { ...E, leiterMax: 1 }, T0);
  leiter.setzeTitelVorschlag(d, ADMIN, "A", titelVorschlag, T0);
  const f = await leiter.gibFrei(d, ADMIN, "A", { items: ITEMS, schreiber: s, impTag: impVon() }, T0);
  assert.equal(f.wert.ausgang, "fehlgeschlagen"); assert.match(f.wert.text, /not the expected/); assert.equal(s.auf.length, 0);
  // Preisstufe: eBay-Preis weicht vom Vorschlag ab
  leiter.ueberspringe(d, ADMIN, "A", "", E, {}, T0); leiter.ueberspringe(d, ADMIN, "A", "", E, { fuer: () => ({ kanaele: ITEMS, varianten: [] }) }, T0);
  const p = await leiter.gibFrei(d, ADMIN, "A", { items: ITEMS, schreiber: s, impTag: impVon() }, T0);
  assert.equal(p.wert.ausgang, "fehlgeschlagen"); assert.match(p.wert.text, /7\.50/); assert.equal(s.auf.length, 0);
});

test("Preisvorschlag: Varianten mit verschiedenen Preisen werden nicht gesenkt", () => {
  const v = leiter.baueVorschlag("preis", E, { kanaele: [{ preis_aktuell: 8 }], varianten: [{ price: 8 }, { price: 14 }] });
  assert.match(v.nichtMoeglich, /different prices/);
  assert.deepEqual(leiter.baueVorschlag("preis", E, { kanaele: [{ preis_aktuell: 4.99 }], varianten: [{ price: 4.99 }] }), { alt: 4.99, neu: 4.49, schritt: 0.1 });
});

test("ein Titel, der den Regelprüfer nicht bestanden hat, kann nicht zur Freigabe", () => {
  const d = neueDb();
  leiter.nimmAuf(d, shop(), { ...E, leiterMax: 1 }, T0);
  const r = leiter.setzeTitelVorschlag(d, BUILDER, "A", { ...titelVorschlag, pruefung: { ok: false, verstoesse: [{ text: "Original" }] } }, T0);
  assert.equal(r.status, 400);
});

test("Übersicht: Zahl je Stufe, Zwischenstand der Prüfzeit und Lebenslauf", async () => {
  const d = neueDb();
  leiter.nimmAuf(d, shop(), E, T0);
  leiter.setzeTitelVorschlag(d, ADMIN, "A", titelVorschlag, T0);
  await leiter.gibFrei(d, ADMIN, "A", { items: ITEMS, schreiber: schreiber(), impTag: impVon() }, T0);
  const u = leiter.uebersicht(d, shop(), daten({ A: 6 }, "2026-11-27"), tag(8));
  assert.equal(u.zahl.titel, 3);
  const a = u.angebote.find((x) => x.number === "A");
  assert.equal(a.stand.gelaufen, 7); assert.equal(a.stand.tage, 14); assert.equal(a.stand.jetzt90, 540);
  assert.ok(a.verlauf.length >= 3);
});
