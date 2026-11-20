// Tests für die Leiter (leiter.mjs): Aufnahme, Freigabe, Prüfzeit, Auswertung, nächste Stufe, manuelle Prüfung, Sicherungen.
// Datenbank im Speicher, nachgebaute Impressionen und ein nachgebauter eBay-Schreiber; kein Netz, pm.db wird nicht angefasst.
import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { EINSTELLUNGEN } from "./regeln.mjs";
import * as protokoll from "./protokoll.mjs";
import * as leiter from "./leiter.mjs";

// Ohne Kontrollgruppe, damit die Aufnahme in den älteren Tests vorhersagbar bleibt; die Kontrollgruppe hat eigene Tests unten
const E = { ...EINSTELLUNGEN, modus: "fest", festeGrenze: 900, leiterMax: 3, leiterKontrolle: false };
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

test("von Hand aufnehmen (Auswahlliste): nur Admin, nur Kandidaten, auch über die Höchstzahl hinaus, steht im Protokoll", () => {
  const d = neueDb();
  leiter.nimmAuf(d, shop(), E, T0); // A, B, C: die Leiter ist voll
  assert.equal(leiter.nimmVonHandAuf(d, BUILDER, "D", shop(), E, T0).status, 403);
  for (const nr of ["OK", "X", "A", "gibtsnicht"]) assert.equal(leiter.nimmVonHandAuf(d, ADMIN, nr, shop(), E, T0).status, 409, nr);
  assert.equal(leiter.nimmVonHandAuf(d, ADMIN, "D", shop(), E, T0, { gesperrt: new Set(["D"]) }).status, 409, "gesperrt");
  assert.deepEqual(leiter.nimmVonHandAuf(d, ADMIN, "D", shop(), E, T0), { ok: true, wert: { number: "D" } });
  assert.equal(zeile(d, "D").stufe, "titel");
  assert.equal(zeile(d, "D").phase, "vorschlag");
  assert.equal(leiter.aktiveNummern(d).size, 4, "über leiterMax (3) hinaus");
  assert.equal(d.prepare("SELECT COUNT(*) n FROM protokoll WHERE aktion = 'ladder_added' AND benutzer = 'niko'").get().n, 1);
  assert.equal(JSON.parse(d.prepare("SELECT details FROM leiter_verlauf WHERE number = 'D'").get().details).vonHand, true);
});

// ---------- Kontrollgruppe ----------
const EK = { ...E, leiterKontrolle: true, leiterMax: 2 };

test("Kontrollgruppe: der Lauf zieht 2 × frei Kandidaten und lost sie je zur Hälfte auf Leiter und Kontrolle, gleicher seed = gleiche Ziehung", () => {
  const d = neueDb();
  const neu = leiter.nimmAuf(d, shop(), EK, T0, { seed: 42 });
  assert.equal(neu.length, 2, "zwei Plätze frei -> zwei auf die Leiter");
  const kontrolle = d.prepare("SELECT number, phase, stufe_start FROM leiter WHERE stufe = 'kontrolle' ORDER BY number").all();
  assert.equal(kontrolle.length, 2, "und zwei in die Kontrollgruppe");
  assert.ok(kontrolle.every((k) => k.phase === "kontrolle" && k.stufe_start === "2026-11-20"));
  const alle = [...neu, ...kontrolle.map((k) => k.number)].sort();
  assert.deepEqual(alle, ["A", "B", "C", "D"], "die vier mit den meisten Verkäufen; E bleibt frei");
  const d2 = neueDb();
  assert.deepEqual(leiter.nimmAuf(d2, shop(), EK, T0, { seed: 42 }), neu, "derselbe seed ergibt dieselbe Ziehung");
  assert.equal(JSON.parse(d.prepare("SELECT details FROM leiter_verlauf WHERE number = ?").get(neu[0]).details).seed, 42, "der seed steht im Lebenslauf");
  // Kontrollangebote belegen keinen Leiterplatz, sind aber für Tests und eine neue Aufnahme gesperrt
  assert.deepEqual(leiter.nimmAuf(d, shop(), EK, T0, { seed: 1 }), [], "die Leiter ist voll");
  assert.ok(kontrolle.every((k) => leiter.aktiveNummern(d).has(k.number)));
  assert.ok(!leiter.kandidaten(d, shop(), EK, T0).some((p) => kontrolle.some((k) => k.number === p.number)));
});

test("Auswertung mit Kontrollgruppe: steigt der ganze Shop, zeigt der Nettoeffekt 0; steigt nur das Angebot, den echten Effekt", () => {
  for (const [name, nurAngebot, erwartet] of [["Saison", false, 0], ["echter Effekt", true, 1]]) {
    const d = neueDb(), e = { ...EK, leiterMax: 1 };
    const [nr] = leiter.nimmAuf(d, shop(), e, T0, { seed: 7 });
    const ktr = d.prepare("SELECT number FROM leiter WHERE stufe = 'kontrolle'").get().number;
    // vor dem 20.11. 3 Impressionen am Tag, danach 6: beim Saison-Fall für alle, sonst nur für das Angebot auf der Leiter
    const impTag = (n, von) => (von >= "2026-11-20" && (!nurAngebot || n === nr) ? 6 : 3);
    leiter.setzeTitelVorschlag(d, BUILDER, nr, titelVorschlag, T0);
    leiter.starteVonHand(d, ADMIN, nr, { impTag }, T0);
    const [a] = leiter.werteAus(d, { impTag, trafficBis: "2026-12-04", grenze90: 900, einst: e }, tag(15));
    assert.deepEqual(a.kontrolle, { anzahl: 1, vorher90: 270, nachher90: nurAngebot ? 270 : 540 }, name);
    assert.equal(a.netto, erwartet, name);
    const w = leiter.wirkung(d).titel;
    assert.equal(w.ausgewertet, 1); assert.equal(w.mitKontrolle, 1); assert.equal(w.netto, erwartet, name);
    assert.equal(d.prepare("SELECT stufe FROM leiter WHERE number = ?").get(ktr).stufe, "kontrolle", "die Kontrolle läuft weiter");
  }
});

test("Kontrollzeit vorbei (alle drei Prüfzeiten): das Kontrollangebot verlässt die Gruppe und macht 90 Tage Pause", () => {
  const d = neueDb();
  leiter.nimmAuf(d, shop(), { ...EK, leiterMax: 1 }, T0, { seed: 7 });
  const ktr = d.prepare("SELECT number FROM leiter WHERE stufe = 'kontrolle'").get().number;
  assert.equal(leiter.kontrollTage(EK), 49);
  leiter.werteAus(d, daten({}, "2027-01-07", { einst: EK }), tag(50));
  assert.equal(zeile(d, ktr).stufe, "kontrolle", "ein Tag vor Schluss: noch in der Gruppe");
  leiter.werteAus(d, daten({}, "2027-01-08", { einst: EK }), tag(51));
  assert.equal(zeile(d, ktr).stufe, "raus"); assert.equal(zeile(d, ktr).ergebnis, "kontrolle");
  const t = leiter.trichter(d, shop(), EK, tag(51)).liste.find((x) => x.number === ktr);
  assert.equal(t.status, "raus"); assert.equal(t.art, "pause");
});

test("Funnel: jedes Produkt hat genau einen Status und einen Grund, in der Reihenfolge der Aufnahme", () => {
  const d = neueDb();
  leiter.nimmAuf(d, shop(), { ...E, leiterMax: 1 }, T0); // A auf die Leiter
  const produkte = [...shop(), { number: "N", title: "neu", created_at: "2026-11-01T10:00:00Z", units_total: 0, units_90d: 0, impressionen_90d: 5, ebay_aktiv: 1 }];
  const f = leiter.trichter(d, produkte, E, T0, { gesperrt: new Set(["D"]) });
  const s = Object.fromEntries(f.liste.map((x) => [x.number, [x.status, x.art]]));
  assert.deepEqual(s, { A: ["titel", null], B: ["geeignet", null], C: ["geeignet", null], D: ["nicht_geeignet", "gesperrt"], E: ["geeignet", null],
    X: ["nicht_geeignet", "kein_ebay"], OK: ["nicht_geeignet", "genug"], N: ["nicht_geeignet", "neu"] });
  assert.ok(f.liste.every((x) => x.grund && x.grund.length > 10), "jeder Status hat einen lesbaren Grund");
  assert.equal(f.zahl.geeignet, 3); assert.equal(f.zahl.nicht_geeignet, 4); assert.equal(f.kpi.aufLeiter, 1);
  assert.deepEqual(f.gruende, { kein_ebay: 1, gesperrt: 1, im_test: 0, neu: 1, genug: 1 });
  assert.equal(f.kpi.impressionen90, 300 + 301 + 302 + 303 + 304 + 10 + 5000 + 5);
  // "geeignet" im Funnel = genau die Kandidaten des nächsten Laufs
  assert.deepEqual(f.liste.filter((x) => x.status === "geeignet").map((x) => x.number).sort(), leiter.kandidaten(d, produkte, E, T0, { gesperrt: new Set(["D"]) }).map((p) => p.number).sort());
});

test("Freigabe prüft den Titel noch einmal: ein Vorschlag aus der Zeit vor einer schärferen Regel wird nicht geschrieben", async () => {
  const d = neueDb(), s = schreiber();
  leiter.nimmAuf(d, shop(), { ...E, leiterMax: 1 }, T0);
  // so gespeichert, wie es die alte Regel durchgelassen hätte: Marke vor "passend"
  const alt = { titel: "BMW X3 Armlehne Box passend", alt: "Armlehne Box kompatibel mit BMW X3", quelle: "ki", begruendung: "x", pruefung: { ok: true, verstoesse: [], hinweise: [] } };
  d.prepare("UPDATE leiter SET vorschlag = ? WHERE number = 'A'").run(JSON.stringify(alt));
  const r = await leiter.gibFrei(d, ADMIN, "A", { items: ITEMS, schreiber: s, impTag: impVon() }, T0);
  assert.equal(r.status, 409);
  assert.match(r.fehler, /must come after/);
  assert.equal(s.auf.length, 0, "bei eBay wurde nichts geschrieben");
  assert.equal(zeile(d, "A").phase, "vorschlag", "die Stufe bleibt offen");
});

// ---------- Bewegung von Hand (Niko 20.11.: Produkte wandern nur per Knopf) ----------
test("von Hand weiterschieben: nur Admin, nur in laufender Prüfzeit, misst bis heute gegen die Kontrollgruppe", () => {
  const d = neueDb(), e = { ...EK, leiterMax: 1 };
  const [nr] = leiter.nimmAuf(d, shop(), e, T0, { seed: 7 });
  const impTag = (n, von) => (von >= "2026-11-20" && n === nr ? 6 : 3);
  const daten = { impTag, trafficBis: "2026-11-27", grenze90: 900, einst: e };
  assert.equal(leiter.schiebeVonHand(d, ADMIN, nr, "weiter", daten, tag(8)).status, 409, "noch keine laufende Prüfzeit");
  leiter.setzeTitelVorschlag(d, BUILDER, nr, titelVorschlag, T0);
  leiter.starteVonHand(d, ADMIN, nr, { impTag }, T0);
  assert.equal(leiter.schiebeVonHand(d, BUILDER, nr, "weiter", daten, tag(8)).status, 403);
  assert.equal(leiter.schiebeVonHand(d, ADMIN, nr, "irgendwohin", daten, tag(8)).status, 400);
  const r = leiter.schiebeVonHand(d, ADMIN, nr, "weiter", daten, tag(8));
  assert.equal(r.ok, true); assert.equal(r.wert.stufe, "werbung");
  assert.equal(r.wert.messung.gemessenTage, 7, "20.11. bis 27.11. liegen in den Daten");
  assert.equal(r.wert.messung.netto, 1, "Angebot 3 → 6, Kontrolle bleibt 3: +100 %");
  assert.equal(zeile(d, nr).stufe, "werbung"); assert.equal(zeile(d, nr).phase, "vorschlag");
  assert.equal(leiter.wirkung(d).titel.mitKontrolle, 1, "die Messung von Hand zählt in der Wirkung je Phase");
});

test("von Hand als wieder gesehen beenden; der automatische Teil bewertet bei nurKontrolle keine Stufe", () => {
  const d = neueDb(), e = { ...EK, leiterMax: 1 };
  const [nr] = leiter.nimmAuf(d, shop(), e, T0, { seed: 7 });
  leiter.setzeTitelVorschlag(d, BUILDER, nr, titelVorschlag, T0);
  leiter.starteVonHand(d, ADMIN, nr, { impTag: impVon() }, T0);
  // Prüfzeit vorbei, aber Bewegung von Hand: werteAus mit nurKontrolle lässt die Stufe laufen
  assert.deepEqual(leiter.werteAus(d, daten({}, "2026-12-10", { einst: e, nurKontrolle: true }), tag(21)), []);
  assert.equal(zeile(d, nr).phase, "laeuft");
  const r = leiter.schiebeVonHand(d, ADMIN, nr, "erholt", daten({}, "2026-12-10", { einst: e }), tag(21));
  assert.equal(r.ok, true);
  assert.equal(zeile(d, nr).stufe, "raus"); assert.equal(zeile(d, nr).ergebnis, "erholt");
  assert.equal(d.prepare("SELECT COUNT(*) n FROM protokoll WHERE aktion = 'ladder_moved'").get().n, 1);
});

// ---------- Sauberer Start, Losen mit Anzahl, Werbung schon vorhanden (Niko 20.11.) ----------
test("Take off ohne eBay-Änderung: sofort wieder Eligible (keine 90 Tage Pause); mit Änderung bleibt die Pause", async () => {
  const d = neueDb(), s = schreiber();
  leiter.nimmAuf(d, shop(), { ...E, leiterMax: 2 }, T0); // A, B
  assert.equal(leiter.brichAb(d, BUILDER, "A", "x", T0).status, 403);
  const r = leiter.brichAb(d, ADMIN, "A", "falsch gezogen", T0);
  assert.deepEqual(r, { ok: true, wert: { number: "A", pause: false } });
  assert.equal(zeile(d, "A"), undefined, "Zeile weg");
  assert.ok(leiter.kandidaten(d, shop(), E, T0).some((p) => p.number === "A"), "A ist sofort wieder Kandidat");
  // B wird bei eBay geändert und dann abgebrochen: 90 Tage Pause
  leiter.setzeTitelVorschlag(d, BUILDER, "B", titelVorschlag, T0);
  await leiter.gibFrei(d, ADMIN, "B", { items: ITEMS, schreiber: s, impTag: impVon() }, T0);
  assert.equal(leiter.brichAb(d, ADMIN, "B", "läuft aus", T0).wert.pause, true);
  assert.ok(!leiter.kandidaten(d, shop(), E, tag(10)).some((p) => p.number === "B"));
});

test("Start over: alles ohne eBay-Änderung zurück (auch Kontrolle), Angebote mit Änderung bleiben", async () => {
  const d = neueDb(), s = schreiber();
  const [nr] = leiter.nimmAuf(d, shop(), { ...EK, leiterMax: 2 }, T0, { seed: 3 });
  leiter.setzeTitelVorschlag(d, BUILDER, nr, titelVorschlag, T0);
  await leiter.gibFrei(d, ADMIN, nr, { items: ITEMS, schreiber: s, impTag: impVon() }, T0);
  assert.equal(leiter.setzeZurueck(d, BUILDER, "x", T0).status, 403);
  const r = leiter.setzeZurueck(d, ADMIN, "neu ziehen", T0);
  assert.deepEqual(r.wert, { zurueckgesetzt: 3, behalten: 1 });
  assert.equal(d.prepare("SELECT COUNT(*) n FROM leiter").get().n, 1);
  assert.equal(zeile(d, nr).phase, "laeuft");
});

test("Losen von Hand: Anzahl ohne Obergrenze, Kontrollgruppe ja oder nein je Ziehung", () => {
  const d = neueDb();
  assert.equal(leiter.nimmAuf(d, shop(), { ...E, leiterMax: 1 }, T0, { anzahl: 4, kontrolle: false }).length, 4, "4 trotz leiterMax 1");
  assert.equal(d.prepare("SELECT COUNT(*) n FROM leiter WHERE stufe = 'kontrolle'").get().n, 0);
  const d2 = neueDb();
  assert.equal(leiter.nimmAuf(d2, shop(), { ...E, leiterMax: 1 }, T0, { anzahl: 2, kontrolle: true, seed: 9 }).length, 2);
  assert.equal(d2.prepare("SELECT COUNT(*) n FROM leiter WHERE stufe = 'kontrolle'").get().n, 2);
});

test("schon beworben: aus Phase 2 direkt in die Preisstufe, mit Grund im Lebenslauf; nur aus Phase 2", () => {
  const d = neueDb();
  leiter.nimmAuf(d, shop(), { ...E, leiterMax: 1 }, T0); // A in Phase 1
  assert.equal(leiter.springeUeberWerbung(d, "A", { kampagnen: ["K"] }, E, {}, T0).status, 409, "aus Phase 1 nicht");
  leiter.ueberspringe(d, ADMIN, "A", "kein neuer Titel", E, {}, T0); // → Phase 2
  const r = leiter.springeUeberWerbung(d, "A", { kampagnen: ["Kampagne 10.10.2025"] }, E, { fuer: () => ({ kanaele: ITEMS, varianten: [] }) }, T0);
  assert.equal(r.ok, true);
  assert.equal(zeile(d, "A").stufe, "preis");
  const v = d.prepare("SELECT details FROM leiter_verlauf WHERE number = 'A' AND ereignis = 'uebersprungen' ORDER BY id DESC").get();
  assert.match(JSON.parse(v.details).grund, /Already advertised on eBay \(Kampagne 10\.10\.2025\)/);
});

test("nach einer Titeländerung liest die App bei eBay nach und nennt den neuen Titel", async () => {
  const d = neueDb();
  leiter.nimmAuf(d, shop(), { ...E, leiterMax: 1 }, T0);
  leiter.setzeTitelVorschlag(d, BUILDER, "A", titelVorschlag, T0);
  let gelesen = 0;
  const s = { ...schreiber(), lies: async () => (gelesen++ === 0 ? { ok: true, titel: "Halter A", status: "Active", variationen: [] } : { ok: true, titel: "Wandhalter passend für A", status: "Active", variationen: [] }) };
  const r = await leiter.gibFrei(d, ADMIN, "A", { items: ITEMS, schreiber: s, impTag: impVon() }, T0);
  assert.equal(r.wert.ausgang, "angewendet");
  assert.match(r.wert.text, /Now on eBay: “Wandhalter passend für A”/);
});
