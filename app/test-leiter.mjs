// Tests for the ladder (leiter.mjs): intake, approval, waiting time, evaluation, next step, manual check, safeguards.
// Database in memory, rebuilt impressions and a rebuilt eBay writer; no network, pm.db is not touched.
import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { EINSTELLUNGEN } from "./regeln.mjs";
import * as protokoll from "./protokoll.mjs";
import * as leiter from "./leiter.mjs";

// Without a control group, so that the intake in the older tests stays predictable; the control group has its own tests below
const E = { ...EINSTELLUNGEN, modus: "fest", festeGrenze: 900, leiterMax: 3, leiterKontrolle: false, leiterNurOhneVerkauf: "nein" };
const ADMIN = { name: "niko", rolle: "admin" }, BUILDER = { name: "anna", rolle: "builder" };
const T0 = new Date("2026-11-20T09:00:00Z");
const tag = (n) => new Date(T0.getTime() + n * 864e5);
// 5 listings with low impressions (below 900 in 90 days), one without a running eBay listing, one with enough impressions
const shop = () => [
  ...["A", "B", "C", "D", "E"].map((n, i) => ({ number: n, title: "Halter " + n, created_at: "2025-12-01T10:00:00Z", units_total: 10 - i, units_90d: 0, impressionen_90d: 300 + i, ebay_aktiv: 1 })),
  { number: "X", title: "beendet", created_at: "2025-12-01T10:00:00Z", units_total: 50, units_90d: 0, impressionen_90d: 10, ebay_aktiv: 0 },
  { number: "OK", title: "läuft gut", created_at: "2025-12-01T10:00:00Z", units_total: 5, units_90d: 4, impressionen_90d: 5000, ebay_aktiv: 1 },
];
const neueDb = () => { const d = new Database(":memory:"); protokoll.bereiteVor(d); leiter.bereiteVor(d); return d; };
// Impressions per day: given per product, otherwise 3 a day (= 270 in 90 days, so "low")
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

test("Intake: only low impressions with a running eBay listing, proven ones first, at most leiterMax", () => {
  const d = neueDb();
  assert.deepEqual(leiter.nimmAuf(d, shop(), E, T0), ["A", "B", "C"]);
  assert.deepEqual(leiter.nimmAuf(d, shop(), E, T0), [], "die Leiter ist voll");
  assert.deepEqual([...leiter.aktiveNummern(d)].sort(), ["A", "B", "C"]);
  assert.ok(!leiter.kandidaten(d, shop(), { ...E, leiterMax: 99 }, T0).some((p) => p.number === "X" || p.number === "OK"));
  // in a title test or blocked: do not take in
  const d2 = neueDb();
  assert.deepEqual(leiter.nimmAuf(d2, shop(), E, T0, { imTest: new Map([["A", {}]]), gesperrt: new Set(["B"]) }), ["C", "D", "E"]);
});

test("Whole path without recovery: title -> ads -> price -> manual review -> decision", async () => {
  const d = neueDb(), s = schreiber();
  leiter.nimmAuf(d, shop(), { ...E, leiterMax: 1 }, T0);
  assert.equal(leiter.setzeTitelVorschlag(d, BUILDER, "A", titelVorschlag, T0).ok, true);
  assert.equal((await leiter.gibFrei(d, BUILDER, "A", { items: ITEMS, schreiber: s, impTag: impVon() }, T0)).status, 403, "nur Admin gibt frei");
  const f = await leiter.gibFrei(d, ADMIN, "A", { items: ITEMS, schreiber: s, impTag: impVon() }, T0);
  assert.equal(f.wert.ausgang, "angewendet");
  assert.deepEqual(s.auf[0], ["titel", "123456789012", "Wandhalter passend für A"]);
  assert.equal(zeile(d, "A").phase, "laeuft");
  // before the end of the waiting time (14 days) no verdict is given
  assert.equal(leiter.werteAus(d, daten({}, "2026-12-03"), tag(13)).length, 0);
  // afterwards: still 3 a day = 270 in 90 days < 900 -> step 2 with a suggestion from the settings
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

test("Recovery: enough impressions again after the waiting time -> leaves the ladder, room for the next listing", async () => {
  const d = neueDb();
  leiter.nimmAuf(d, shop(), { ...E, leiterMax: 1 }, T0);
  leiter.setzeTitelVorschlag(d, ADMIN, "A", titelVorschlag, T0);
  await leiter.gibFrei(d, ADMIN, "A", { items: ITEMS, schreiber: schreiber(), impTag: impVon() }, T0);
  const a = leiter.werteAus(d, daten({ A: 12 }, "2026-12-04"), tag(15));   // 12 am Tag = 1.080 in 90 Tagen >= 900
  assert.equal(a[0].erholt, true); assert.equal(a[0].vorher90, 270);
  assert.equal(zeile(d, "A").stufe, "raus"); assert.equal(zeile(d, "A").ergebnis, "erholt");
  assert.deepEqual(leiter.nimmAuf(d, shop(), { ...E, leiterMax: 1 }, tag(15)), ["B"], "A darf 90 Tage nicht wieder hinein, B rückt nach");
});

test("Dry run: without the write switch the step stays open and eBay untouched; an admin can start by hand", async () => {
  const d = neueDb(), s = schreiber({ schreiben: false });
  leiter.nimmAuf(d, shop(), { ...E, leiterMax: 1 }, T0);
  leiter.setzeTitelVorschlag(d, ADMIN, "A", titelVorschlag, T0);
  const f = await leiter.gibFrei(d, ADMIN, "A", { items: ITEMS, schreiber: s, impTag: impVon() }, T0);
  assert.equal(f.wert.ausgang, "probelauf"); assert.equal(s.auf.length, 0); assert.equal(zeile(d, "A").phase, "vorschlag");
  assert.equal(leiter.starteVonHand(d, BUILDER, "A", { impTag: impVon() }, T0).status, 403);
  assert.equal(leiter.starteVonHand(d, ADMIN, "A", { impTag: impVon() }, T0).ok, true);
  assert.equal(zeile(d, "A").phase, "laeuft");
  // Ads need their own switch, even if EBAY_SCHREIBEN is on
  const d2 = neueDb(), s2 = schreiber({ werbung: false });
  leiter.nimmAuf(d2, shop(), { ...E, leiterMax: 1 }, T0);
  leiter.ueberspringe(d2, ADMIN, "A", "kein neuer Titel", E, {}, T0);
  const w = await leiter.gibFrei(d2, ADMIN, "A", { items: ITEMS, schreiber: s2, impTag: impVon() }, T0);
  assert.equal(w.wert.ausgang, "probelauf"); assert.equal(s2.auf.length, 0);
});

test("Do not overwrite: different title or price on eBay -> failed, nothing changed", async () => {
  const d = neueDb(), s = schreiber();
  s.lies = async () => ({ ok: true, titel: "Von Hand geändert", status: "Active", verkauft: 0, preis: 7.5, variationen: [] });
  leiter.nimmAuf(d, shop(), { ...E, leiterMax: 1 }, T0);
  leiter.setzeTitelVorschlag(d, ADMIN, "A", titelVorschlag, T0);
  const f = await leiter.gibFrei(d, ADMIN, "A", { items: ITEMS, schreiber: s, impTag: impVon() }, T0);
  assert.equal(f.wert.ausgang, "fehlgeschlagen"); assert.match(f.wert.text, /not the expected/); assert.equal(s.auf.length, 0);
  // Price step: the eBay price differs from the suggestion
  leiter.ueberspringe(d, ADMIN, "A", "", E, {}, T0); leiter.ueberspringe(d, ADMIN, "A", "", E, { fuer: () => ({ kanaele: ITEMS, varianten: [] }) }, T0);
  const p = await leiter.gibFrei(d, ADMIN, "A", { items: ITEMS, schreiber: s, impTag: impVon() }, T0);
  assert.equal(p.wert.ausgang, "fehlgeschlagen"); assert.match(p.wert.text, /7\.50/); assert.equal(s.auf.length, 0);
});

test("Price suggestion: variants with different prices are not lowered", () => {
  const v = leiter.baueVorschlag("preis", E, { kanaele: [{ preis_aktuell: 8 }], varianten: [{ price: 8 }, { price: 14 }] });
  assert.match(v.nichtMoeglich, /different prices/);
  assert.deepEqual(leiter.baueVorschlag("preis", E, { kanaele: [{ preis_aktuell: 4.99 }], varianten: [{ price: 4.99 }] }), { alt: 4.99, neu: 4.49, schritt: 0.1 });
});

test("A title that failed the rule checker cannot go to approval", () => {
  const d = neueDb();
  leiter.nimmAuf(d, shop(), { ...E, leiterMax: 1 }, T0);
  const r = leiter.setzeTitelVorschlag(d, BUILDER, "A", { ...titelVorschlag, pruefung: { ok: false, verstoesse: [{ text: "Original" }] } }, T0);
  assert.equal(r.status, 400);
});

test("Overview: count per step, interim state of the waiting time and history", async () => {
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

test("Take in by hand (selection list): admin only, candidates only, also beyond the maximum, is in the log", () => {
  const d = neueDb();
  leiter.nimmAuf(d, shop(), E, T0); // A, B, C: the ladder is full
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

// ---------- Control group ----------
const EK = { ...E, leiterKontrolle: true, leiterMax: 2 };

test("Control group: the run draws 2 × free candidates and splits them half and half onto the ladder and control, same seed = same draw", () => {
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
  // Control listings take up no ladder place, but are blocked for tests and a new intake
  assert.deepEqual(leiter.nimmAuf(d, shop(), EK, T0, { seed: 1 }), [], "die Leiter ist voll");
  assert.ok(kontrolle.every((k) => leiter.aktiveNummern(d).has(k.number)));
  assert.ok(!leiter.kandidaten(d, shop(), EK, T0).some((p) => kontrolle.some((k) => k.number === p.number)));
});

test("Evaluation with control group: if the whole shop rises the net effect shows 0; if only the listing rises, the real effect", () => {
  for (const [name, nurAngebot, erwartet] of [["Saison", false, 0], ["echter Effekt", true, 1]]) {
    const d = neueDb(), e = { ...EK, leiterMax: 1 };
    const [nr] = leiter.nimmAuf(d, shop(), e, T0, { seed: 7 });
    const ktr = d.prepare("SELECT number FROM leiter WHERE stufe = 'kontrolle'").get().number;
    // before 20 Nov 3 impressions a day, afterwards 6: in the season case for all, otherwise only for the listing on the ladder
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

test("Control time over (all three waiting times): the control listing leaves the group and pauses for 90 days", () => {
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

test("Funnel: every product has exactly one status and one reason, in the order of intake", () => {
  const d = neueDb();
  leiter.nimmAuf(d, shop(), { ...E, leiterMax: 1 }, T0); // A onto the ladder
  const produkte = [...shop(), { number: "N", title: "neu", created_at: "2026-11-01T10:00:00Z", units_total: 0, units_90d: 0, impressionen_90d: 5, ebay_aktiv: 1 }];
  const f = leiter.trichter(d, produkte, E, T0, { gesperrt: new Set(["D"]) });
  const s = Object.fromEntries(f.liste.map((x) => [x.number, [x.status, x.art]]));
  assert.deepEqual(s, { A: ["titel", null], B: ["geeignet", null], C: ["geeignet", null], D: ["nicht_geeignet", "gesperrt"], E: ["geeignet", null],
    X: ["nicht_geeignet", "kein_ebay"], OK: ["nicht_geeignet", "genug"], N: ["nicht_geeignet", "neu"] });
  assert.ok(f.liste.every((x) => x.grund && x.grund.length > 10), "jeder Status hat einen lesbaren Grund");
  assert.equal(f.zahl.geeignet, 3); assert.equal(f.zahl.nicht_geeignet, 4); assert.equal(f.kpi.aufLeiter, 1);
  assert.deepEqual(f.gruende, { kein_ebay: 1, gesperrt: 1, im_test: 0, neu: 1, genug: 1, verkauft: 0 });
  assert.equal(f.kpi.impressionen90, 300 + 301 + 302 + 303 + 304 + 10 + 5000 + 5);
  // "eligible" in the funnel = exactly the candidates of the next run
  assert.deepEqual(f.liste.filter((x) => x.status === "geeignet").map((x) => x.number).sort(), leiter.kandidaten(d, produkte, E, T0, { gesperrt: new Set(["D"]) }).map((p) => p.number).sort());
});

test("Approval checks the title once more: a suggestion from before a stricter rule is not written", async () => {
  const d = neueDb(), s = schreiber();
  leiter.nimmAuf(d, shop(), { ...E, leiterMax: 1 }, T0);
  // saved as the old rule would have let it through: brand before "passend"
  const alt = { titel: "BMW X3 Armlehne Box passend", alt: "Armlehne Box kompatibel mit BMW X3", quelle: "ki", begruendung: "x", pruefung: { ok: true, verstoesse: [], hinweise: [] } };
  d.prepare("UPDATE leiter SET vorschlag = ? WHERE number = 'A'").run(JSON.stringify(alt));
  const r = await leiter.gibFrei(d, ADMIN, "A", { items: ITEMS, schreiber: s, impTag: impVon() }, T0);
  assert.equal(r.status, 409);
  assert.match(r.fehler, /must come after/);
  assert.equal(s.auf.length, 0, "bei eBay wurde nichts geschrieben");
  assert.equal(zeile(d, "A").phase, "vorschlag", "die Stufe bleibt offen");
});

// ---------- Movement by hand (Niko, 20 Nov: products move only by button) ----------
test("Move on by hand: admin only, only during a running waiting time, measures up to today against the control group", () => {
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

test("End as seen again by hand; the automatic part evaluates no step when only the control is evaluated", () => {
  const d = neueDb(), e = { ...EK, leiterMax: 1 };
  const [nr] = leiter.nimmAuf(d, shop(), e, T0, { seed: 7 });
  leiter.setzeTitelVorschlag(d, BUILDER, nr, titelVorschlag, T0);
  leiter.starteVonHand(d, ADMIN, nr, { impTag: impVon() }, T0);
  // Waiting time over, but movement by hand: werteAus with nurKontrolle lets the step run
  assert.deepEqual(leiter.werteAus(d, daten({}, "2026-12-10", { einst: e, nurKontrolle: true }), tag(21)), []);
  assert.equal(zeile(d, nr).phase, "laeuft");
  const r = leiter.schiebeVonHand(d, ADMIN, nr, "erholt", daten({}, "2026-12-10", { einst: e }), tag(21));
  assert.equal(r.ok, true);
  assert.equal(zeile(d, nr).stufe, "raus"); assert.equal(zeile(d, nr).ergebnis, "erholt");
  assert.equal(d.prepare("SELECT COUNT(*) n FROM protokoll WHERE aktion = 'ladder_moved'").get().n, 1);
});

// ---------- Clean start, drawing with a number, ads already present (Niko, 20 Nov) ----------
test("Take off without eBay change: immediately eligible again (no 90-day pause); with a change the pause stays", async () => {
  const d = neueDb(), s = schreiber();
  leiter.nimmAuf(d, shop(), { ...E, leiterMax: 2 }, T0); // A, B
  assert.equal(leiter.brichAb(d, BUILDER, "A", "x", T0).status, 403);
  const r = leiter.brichAb(d, ADMIN, "A", "falsch gezogen", T0);
  assert.deepEqual(r, { ok: true, wert: { number: "A", pause: false } });
  assert.equal(zeile(d, "A"), undefined, "Zeile weg");
  assert.ok(leiter.kandidaten(d, shop(), E, T0).some((p) => p.number === "A"), "A ist sofort wieder Kandidat");
  // B is changed on eBay and then cancelled: 90 days pause
  leiter.setzeTitelVorschlag(d, BUILDER, "B", titelVorschlag, T0);
  await leiter.gibFrei(d, ADMIN, "B", { items: ITEMS, schreiber: s, impTag: impVon() }, T0);
  assert.equal(leiter.brichAb(d, ADMIN, "B", "läuft aus", T0).wert.pause, true);
  assert.ok(!leiter.kandidaten(d, shop(), E, tag(10)).some((p) => p.number === "B"));
});

test("Start over: everything without an eBay change goes back (control too), listings with a change stay", async () => {
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

test("Draw by hand: number without upper limit, control group yes or no per draw", () => {
  const d = neueDb();
  assert.equal(leiter.nimmAuf(d, shop(), { ...E, leiterMax: 1 }, T0, { anzahl: 4, kontrolle: false }).length, 4, "4 trotz leiterMax 1");
  assert.equal(d.prepare("SELECT COUNT(*) n FROM leiter WHERE stufe = 'kontrolle'").get().n, 0);
  const d2 = neueDb();
  assert.equal(leiter.nimmAuf(d2, shop(), { ...E, leiterMax: 1 }, T0, { anzahl: 2, kontrolle: true, seed: 9 }).length, 2);
  assert.equal(d2.prepare("SELECT COUNT(*) n FROM leiter WHERE stufe = 'kontrolle'").get().n, 2);
});

test("already advertised: from phase 2 straight to the price step, with the reason in the history; only from phase 2", () => {
  const d = neueDb();
  leiter.nimmAuf(d, shop(), { ...E, leiterMax: 1 }, T0); // A in phase 1
  assert.equal(leiter.springeUeberWerbung(d, "A", { kampagnen: ["K"] }, E, {}, T0).status, 409, "aus Phase 1 nicht");
  leiter.ueberspringe(d, ADMIN, "A", "kein neuer Titel", E, {}, T0); // → Phase 2
  const r = leiter.springeUeberWerbung(d, "A", { kampagnen: ["Kampagne 10.10.2025"] }, E, { fuer: () => ({ kanaele: ITEMS, varianten: [] }) }, T0);
  assert.equal(r.ok, true);
  assert.equal(zeile(d, "A").stufe, "preis");
  const v = d.prepare("SELECT details FROM leiter_verlauf WHERE number = 'A' AND ereignis = 'uebersprungen' ORDER BY id DESC").get();
  assert.match(JSON.parse(v.details).grund, /Already advertised on eBay \(Kampagne 10\.10\.2025\)/);
});

test("After a title change the app reads back from eBay and reports the new title", async () => {
  const d = neueDb();
  leiter.nimmAuf(d, shop(), { ...E, leiterMax: 1 }, T0);
  leiter.setzeTitelVorschlag(d, BUILDER, "A", titelVorschlag, T0);
  let gelesen = 0;
  const s = { ...schreiber(), lies: async () => (gelesen++ === 0 ? { ok: true, titel: "Halter A", status: "Active", variationen: [] } : { ok: true, titel: "Wandhalter passend für A", status: "Active", variationen: [] }) };
  const r = await leiter.gibFrei(d, ADMIN, "A", { items: ITEMS, schreiber: s, impTag: impVon() }, T0);
  assert.equal(r.wert.ausgang, "angewendet");
  assert.match(r.wert.text, /Now on eBay: “Wandhalter passend für A”/);
});

// Niko, 20 Nov: listings that have already sold on eBay are not touched (default), "nein" switches that off
test("already sold on eBay: not eligible (own reason), never-sold ones stay; can be switched off", () => {
  const d = neueDb(), en = { ...E, leiterNurOhneVerkauf: "ja" };
  const produkte = [...shop(), { number: "N0", title: "nie verkauft", created_at: "2025-12-01T10:00:00Z", units_total: 0, units_90d: 0, impressionen_90d: 200, ebay_aktiv: 1 }];
  assert.deepEqual(leiter.kandidaten(d, produkte, en, T0).map((p) => p.number), ["N0"], "A–E haben verkauft, nur N0 bleibt");
  const f = leiter.trichter(d, produkte, en, T0);
  assert.equal(f.gruende.verkauft, 5);
  assert.match(f.liste.find((x) => x.number === "A").grund, /Already sold on eBay \(10 in total\)/);
  assert.equal(leiter.nimmVonHandAuf(d, ADMIN, "A", produkte, en, T0).status, 409, "auch von Hand nicht");
  assert.equal(leiter.kandidaten(d, produkte, { ...en, leiterNurOhneVerkauf: "nein" }, T0).length, 6, "abgeschaltet: alle mit wenig Impressionen");
});

// Niko, 20 Nov: the listings drawn before the rule that have already sold come off again, unless something was already changed on eBay
test("raeumeVerkaufteAb: sold ones without eBay change go down (no pause), changed ones stay, never-sold ones stay", () => {
  const d = neueDb();
  assert.deepEqual(leiter.nimmAuf(d, shop(), E, T0), ["A", "B", "C"]);  // E: Regel aus, wie vor #49
  d.prepare("INSERT INTO leiter_verlauf (number, stufe, ereignis, details, benutzer, at) VALUES ('B', 'titel', 'freigegeben', '{}', 'anna', ?)").run(new Date(T0.getTime() + 1000).toISOString());
  const en = { ...E, leiterNurOhneVerkauf: "ja" };
  assert.deepEqual(leiter.raeumeVerkaufteAb(d, shop(), en, T0).sort(), ["A", "C"]);
  assert.deepEqual(d.prepare("SELECT number FROM leiter").all().map((r) => r.number), ["B"], "B wurde bei eBay geändert und bleibt");
  assert.match(d.prepare("SELECT details FROM leiter_verlauf WHERE number = 'A' AND ereignis = 'zurueckgesetzt'").get().details, /Already sold on eBay/);
  assert.deepEqual(leiter.raeumeVerkaufteAb(d, shop(), en, T0), [], "zweiter Lauf: nichts mehr zu tun");
  assert.deepEqual(leiter.raeumeVerkaufteAb(d, shop(), E, T0), [], "Regel aus: nichts");
});
