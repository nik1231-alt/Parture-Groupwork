// Tests for the ladder (leiter.mjs): intake, approval, waiting time, evaluation, next step, manual check, safeguards.
// Database in memory, rebuilt impressions and a rebuilt eBay writer; no network, pm.db is not touched.
import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { EINSTELLUNGEN } from "./regeln.mjs";
import * as protokoll from "./protokoll.mjs";
import * as leiter from "./leiter.mjs";

// Without a control group, so that the intake in the older tests stays predictable; the control group has its own tests below
// Waiting times pinned to 14 / 14 / 21 days: the dates in these tests are built on them (the defaults are 4 / 4 / 4 since 21.11.)
const E = { ...EINSTELLUNGEN, modus: "fest", festeGrenze: 900, leiterMax: 3, leiterKontrolle: false, leiterNurOhneVerkauf: "nein", leiterTageTitel: 14, leiterTageWerbung: 14, leiterTagePreis: 21 };
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
  assert.deepEqual(leiter.nimmAuf(d, shop(), E, T0), [], "the ladder is full");
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
  assert.equal((await leiter.gibFrei(d, BUILDER, "A", { items: ITEMS, schreiber: s, impTag: impVon() }, T0)).status, 403, "only an admin approves");
  const f = await leiter.gibFrei(d, ADMIN, "A", { items: ITEMS, schreiber: s, impTag: impVon() }, T0);
  assert.equal(f.wert.ausgang, "angewendet");
  assert.deepEqual(s.auf[0], ["titel", "123456789012", "Wandhalter passend für A"]);
  assert.equal(zeile(d, "A").phase, "laeuft");
  // before the end of the waiting time (14 days) no verdict is given
  assert.equal(leiter.werteAus(d, daten({}, "2026-12-03"), tag(13)).length, 0);
  // afterwards: still 3 a day = 270 in 90 days < 900 -> step 2 with a suggestion from the settings
  const a = leiter.werteAus(d, daten({}, "2026-12-04"), tag(15));
  assert.equal(a.length, 1); assert.equal(a[0].erholt, false); assert.equal(a[0].nachher90, 270);
  assert.equal(a[0].datenBis, "2026-12-04", "the automatic evaluation stores the end of its window as the data day (F1)");
  assert.equal(zeile(d, "A").stufe, "werbung");
  assert.deepEqual(JSON.parse(zeile(d, "A").vorschlag), { satz: 0.1 });
  await leiter.gibFrei(d, ADMIN, "A", { items: ITEMS, schreiber: s, impTag: impVon() }, tag(15));
  assert.deepEqual(s.auf[1], ["werbung", "123456789012", 0.1]);
  leiter.werteAus(d, daten({}, "2026-12-20", { fuer: () => ({ kanaele: ITEMS, varianten: [] }) }), tag(30));
  assert.equal(zeile(d, "A").stufe, "preis");
  assert.deepEqual(JSON.parse(zeile(d, "A").vorschlag), { alt: 9.99, neu: 8.99, schritt: 0.1, minimum: 2.99 });
  await leiter.gibFrei(d, ADMIN, "A", { items: ITEMS, schreiber: s, impTag: impVon() }, tag(30));
  assert.deepEqual(s.auf[2], ["preis", "123456789012", 8.99]);
  leiter.werteAus(d, daten({}, "2027-01-15"), tag(56));
  assert.equal(zeile(d, "A").stufe, "pruefung"); assert.equal(zeile(d, "A").phase, "offen");
  assert.equal(leiter.entscheide(d, ADMIN, "A", "offline", "").status, 400, "no decision without a reason");
  assert.equal(leiter.entscheide(d, ADMIN, "A", "offline", "Passt seit dem Modellwechsel nicht mehr.").ok, true);
  assert.equal(zeile(d, "A").ergebnis, "offline");
  const ereignisse = d.prepare("SELECT ereignis FROM leiter_verlauf WHERE number = 'A' ORDER BY id").all().map((r) => r.ereignis);
  // "stand" after the title and the price change: what eBay should show from then on (F6); the ad changes neither
  assert.deepEqual(ereignisse, ["aufgenommen", "vorschlag", "freigegeben", "stand", "gestartet", "ausgewertet", "vorschlag", "titel_zurueck", "stand", "freigegeben", "gestartet", "ausgewertet", "vorschlag", "freigegeben", "stand", "gestartet", "ausgewertet", "pruefung", "entschieden"]);
});

test("Recovery: enough impressions again after the waiting time -> leaves the ladder, room for the next listing", async () => {
  const d = neueDb();
  leiter.nimmAuf(d, shop(), { ...E, leiterMax: 1 }, T0);
  leiter.setzeTitelVorschlag(d, ADMIN, "A", titelVorschlag, T0);
  await leiter.gibFrei(d, ADMIN, "A", { items: ITEMS, schreiber: schreiber(), impTag: impVon() }, T0);
  // 3 a day before the start (270 in 90 days), 12 a day after it (1,080 >= 900); "before" is read from the data (F11)
  const a = leiter.werteAus(d, { ...daten({}, "2026-12-04"), impTag: (nr, von) => (von >= "2026-11-20" ? 12 : 3) }, tag(15));
  assert.equal(a[0].erholt, true); assert.equal(a[0].vorher90, 270);
  assert.equal(zeile(d, "A").stufe, "raus"); assert.equal(zeile(d, "A").ergebnis, "erholt");
  assert.deepEqual(leiter.nimmAuf(d, shop(), { ...E, leiterMax: 1 }, tag(15)), ["B"], "A may not come back in for 90 days, B moves up");
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

test("Price suggestion: variants with different prices each go down by the same percentage", () => {
  const v = leiter.baueVorschlag("preis", E, { kanaele: [{ preis_aktuell: 7.99 }], varianten: [{ price: 14.99 }, { price: 7.99 }, { price: 9.99 }] });
  assert.deepEqual(v, { alt: 7.99, neu: 7.19, schritt: 0.1, minimum: E.preisMinimum, staffel: [{ alt: 7.99, neu: 7.19 }, { alt: 9.99, neu: 8.99 }, { alt: 14.99, neu: 13.49 }] });
  // the floor counts for the lowest variant: 3.19 − 10 % = 2.87 < 2.99 → the whole step is not possible
  assert.match(leiter.baueVorschlag("preis", E, { kanaele: [{ preis_aktuell: 3.19 }], varianten: [{ price: 3.19 }, { price: 9.99 }] }).nichtMoeglich, /lowest price the app may set/);
  assert.deepEqual(leiter.baueVorschlag("preis", E, { kanaele: [{ preis_aktuell: 4.99 }], varianten: [{ price: 4.99 }] }), { alt: 4.99, neu: 4.49, schritt: 0.1, minimum: E.preisMinimum });
});

test("Price floor (F3): the step never goes below the lowest price, and an approval below it is refused even for an older suggestion", async () => {
  // 3.29 − 10 % = 2.96 < 2.99 → not possible, skip to the manual check
  const v = leiter.baueVorschlag("preis", E, { kanaele: [{ preis_aktuell: 3.29 }], varianten: [] });
  assert.match(v.nichtMoeglich, /lowest price the app may set \(2\.99 €/); assert.equal(v.neu, 2.96);
  assert.equal(leiter.baueVorschlag("preis", E, { kanaele: [{ preis_aktuell: 3.33 }], varianten: [] }).neu, 2.99, "exactly on the floor is allowed");
  assert.equal(leiter.baueVorschlag("preis", { ...E, preisMinimum: 0 }, { kanaele: [{ preis_aktuell: 1 }], varianten: [] }).neu, 0.9, "0 switches the floor off");
  // Suggestion made at 9.99 → 8.99, then the floor is raised to 9.50: the approval is refused and nothing is written
  const d = neueDb(), s = schreiber();
  leiter.nimmAuf(d, shop(), { ...E, leiterMax: 1 }, T0);
  leiter.ueberspringe(d, ADMIN, "A", "", E, {}, T0); leiter.ueberspringe(d, ADMIN, "A", "", E, { fuer: () => ({ kanaele: ITEMS, varianten: [] }) }, T0);
  assert.equal(JSON.parse(zeile(d, "A").vorschlag).neu, 8.99);
  const f = await leiter.gibFrei(d, ADMIN, "A", { items: ITEMS, schreiber: s, impTag: impVon(), einst: { ...E, preisMinimum: 9.5 } }, T0);
  assert.equal(f.status, 409); assert.match(f.fehler, /below the lowest price/); assert.equal(s.auf.length, 0, "nothing was written to eBay");
  assert.equal(zeile(d, "A").phase, "vorschlag", "the step stays open");
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
  assert.equal(leiter.aktiveNummern(d).size, 4, "beyond leiterMax (3)");
  assert.equal(d.prepare("SELECT COUNT(*) n FROM protokoll WHERE aktion = 'ladder_added' AND benutzer = 'niko'").get().n, 1);
  assert.equal(JSON.parse(d.prepare("SELECT details FROM leiter_verlauf WHERE number = 'D'").get().details).vonHand, true);
});

// ---------- Control group ----------
const EK = { ...E, leiterKontrolle: true, leiterMax: 2 };

test("Control group: the run draws 2 × free candidates and splits them half and half onto the ladder and control, same seed = same draw", () => {
  const d = neueDb();
  const neu = leiter.nimmAuf(d, shop(), EK, T0, { seed: 42 });
  assert.equal(neu.length, 2, "two places free -> two onto the ladder");
  const kontrolle = d.prepare("SELECT number, phase, stufe_start FROM leiter WHERE stufe = 'kontrolle' ORDER BY number").all();
  assert.equal(kontrolle.length, 2, "and two into the control group");
  assert.ok(kontrolle.every((k) => k.phase === "kontrolle" && k.stufe_start === "2026-11-20"));
  const alle = [...neu, ...kontrolle.map((k) => k.number)].sort();
  assert.deepEqual(alle, ["A", "B", "C", "D"], "the four with the most sales; E stays free");
  const d2 = neueDb();
  assert.deepEqual(leiter.nimmAuf(d2, shop(), EK, T0, { seed: 42 }), neu, "the same seed gives the same draw");
  assert.equal(JSON.parse(d.prepare("SELECT details FROM leiter_verlauf WHERE number = ?").get(neu[0]).details).seed, 42, "the seed is in the history");
  // Control listings take up no ladder place, but are blocked for tests and a new intake
  assert.deepEqual(leiter.nimmAuf(d, shop(), EK, T0, { seed: 1 }), [], "the ladder is full");
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
    assert.equal(d.prepare("SELECT stufe FROM leiter WHERE number = ?").get(ktr).stufe, "kontrolle", "the control keeps running");
  }
});

test("Control time over (all three waiting times plus the buffer): the control listing leaves the group and pauses for 90 days", () => {
  const d = neueDb();
  leiter.nimmAuf(d, shop(), { ...EK, leiterMax: 1 }, T0, { seed: 7 });
  const ktr = d.prepare("SELECT number FROM leiter WHERE stufe = 'kontrolle'").get().number;
  assert.equal(leiter.kontrollTage(EK), 14 + 14 + 21 + leiter.KONTROLLE_PUFFER);
  leiter.werteAus(d, daten({}, "2027-01-14", { einst: EK }), tag(57));
  assert.equal(zeile(d, ktr).stufe, "kontrolle", "one day before the end: still in the group");
  leiter.werteAus(d, daten({}, "2027-01-15", { einst: EK }), tag(58));
  assert.equal(zeile(d, ktr).stufe, "raus"); assert.equal(zeile(d, ktr).ergebnis, "kontrolle");
  const t = leiter.trichter(d, shop(), EK, tag(58)).liste.find((x) => x.number === ktr);
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
  assert.ok(f.liste.every((x) => x.grund && x.grund.length > 10), "every status has a readable reason");
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
  assert.equal(s.auf.length, 0, "nothing was written on eBay");
  assert.equal(zeile(d, "A").phase, "vorschlag", "the step stays open");
});

// ---------- Movement by hand (Niko, 20 Nov: products move only by button) ----------
test("Move on by hand: admin only, only during a running waiting time, measures up to today against the control group", () => {
  const d = neueDb(), e = { ...EK, leiterMax: 1 };
  const [nr] = leiter.nimmAuf(d, shop(), e, T0, { seed: 7 });
  const impTag = (n, von) => (von >= "2026-11-20" && n === nr ? 6 : 3);
  const daten = { impTag, trafficBis: "2026-11-27", grenze90: 900, einst: e };
  assert.equal(leiter.schiebeVonHand(d, ADMIN, nr, "weiter", daten, tag(8)).status, 409, "no running waiting time yet");
  leiter.setzeTitelVorschlag(d, BUILDER, nr, titelVorschlag, T0);
  leiter.starteVonHand(d, ADMIN, nr, { impTag }, T0);
  assert.equal(leiter.schiebeVonHand(d, BUILDER, nr, "weiter", daten, tag(8)).status, 403);
  assert.equal(leiter.schiebeVonHand(d, ADMIN, nr, "irgendwohin", daten, tag(8)).status, 400);
  const frueh = leiter.schiebeVonHand(d, ADMIN, nr, "weiter", daten, tag(8));
  assert.equal(frueh.status, 409, "7 of 14 days: ending early needs a confirmation (F2)"); assert.match(frueh.fehler, /7 of 14 data days/);
  assert.equal(zeile(d, nr).stufe, "titel", "without the confirmation nothing moved");
  const r = leiter.schiebeVonHand(d, ADMIN, nr, "weiter", daten, tag(8), { vorzeitigBestaetigt: true });
  assert.equal(r.ok, true); assert.equal(r.wert.stufe, "werbung");
  assert.equal(r.wert.messung.vorzeitig, true); assert.equal(r.wert.messung.geplantesEnde, "2026-12-04");
  assert.equal(JSON.parse(d.prepare("SELECT details FROM protokoll WHERE aktion = 'ladder_moved'").get().details).vorzeitig, true, "the protocol says it too");
  assert.equal(r.wert.messung.gemessenTage, 7, "20 Nov to 27 Nov are in the data");
  assert.equal(r.wert.messung.netto, 1, "listing 3 → 6, control stays 3: +100 %");
  assert.equal(r.wert.messung.datenBis, "2026-11-27", "the evaluation stores the last data day it used (F1)");
  assert.equal(zeile(d, nr).stufe, "werbung"); assert.equal(zeile(d, nr).phase, "vorschlag");
  assert.equal(leiter.wirkung(d).titel.mitKontrolle, 1, "the measurement by hand counts in the effect per phase");
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
  assert.equal(r.ok, true); assert.equal(r.wert.messung.vorzeitig, false, "after the full waiting time no confirmation is needed and nothing is marked");
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
  assert.equal(zeile(d, "A"), undefined, "row gone");
  assert.ok(leiter.kandidaten(d, shop(), E, T0).some((p) => p.number === "A"), "A is a candidate again at once");
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
  assert.equal(leiter.springeUeberWerbung(d, "A", { kampagnen: ["K"] }, E, {}, T0).status, 409, "not from phase 1");
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
  assert.deepEqual(leiter.kandidaten(d, produkte, en, T0).map((p) => p.number), ["N0"], "A–E have sold, only N0 stays");
  const f = leiter.trichter(d, produkte, en, T0);
  assert.equal(f.gruende.verkauft, 5);
  assert.match(f.liste.find((x) => x.number === "A").grund, /Already sold on eBay \(10 in total\)/);
  assert.equal(leiter.nimmVonHandAuf(d, ADMIN, "A", produkte, en, T0).status, 409, "not by hand either");
  assert.equal(leiter.kandidaten(d, produkte, { ...en, leiterNurOhneVerkauf: "nein" }, T0).length, 6, "switched off: all with low impressions");
});

// Niko, 20 Nov: the listings drawn before the rule that have already sold come off again, unless something was already changed on eBay
test("raeumeVerkaufteAb: sold ones without eBay change go down (no pause), changed ones stay, never-sold ones stay", () => {
  const d = neueDb();
  assert.deepEqual(leiter.nimmAuf(d, shop(), E, T0), ["A", "B", "C"]);  // E: Regel aus, wie vor #49
  d.prepare("INSERT INTO leiter_verlauf (number, stufe, ereignis, details, benutzer, at) VALUES ('B', 'titel', 'freigegeben', '{}', 'anna', ?)").run(new Date(T0.getTime() + 1000).toISOString());
  const en = { ...E, leiterNurOhneVerkauf: "ja" };
  assert.deepEqual(leiter.raeumeVerkaufteAb(d, shop(), en, T0).sort(), ["A", "C"]);
  assert.deepEqual(d.prepare("SELECT number FROM leiter").all().map((r) => r.number), ["B"], "B was changed on eBay and stays");
  assert.match(d.prepare("SELECT details FROM leiter_verlauf WHERE number = 'A' AND ereignis = 'zurueckgesetzt'").get().details, /Already sold on eBay/);
  assert.deepEqual(leiter.raeumeVerkaufteAb(d, shop(), en, T0), [], "second run: nothing left to do");
  assert.deepEqual(leiter.raeumeVerkaufteAb(d, shop(), E, T0), [], "rule off: nothing");
});

// ---------- F6: changes made outside the app ----------
test("Outside changes (F6): first check notes the state; a control changed from outside is marked once and drops out of the control group", () => {
  const d = neueDb(), e = { ...EK, leiterMax: 1 };
  const [nr] = leiter.nimmAuf(d, shop(), e, T0, { seed: 7 });
  const ktr = d.prepare("SELECT number FROM leiter WHERE stufe = 'kontrolle'").get().number;
  const katalog = new Map([[nr, { titel: "Halter " + nr, preis: 9.99 }], [ktr, { titel: "Halter " + ktr, preis: 7.5 }]]);
  assert.deepEqual(leiter.pruefeFremdaenderungen(d, katalog, tag(1)), [], "first check: only notes the state");
  assert.equal(d.prepare("SELECT COUNT(*) n FROM leiter_verlauf WHERE ereignis = 'stand'").get().n, 2);
  assert.deepEqual(leiter.pruefeFremdaenderungen(d, katalog, tag(2)), [], "nothing changed: nothing marked");
  // Someone lowers the price of the control listing on eBay
  katalog.set(ktr, { titel: "Halter " + ktr, preis: 6.99 });
  assert.deepEqual(leiter.pruefeFremdaenderungen(d, katalog, tag(3)), [ktr]);
  assert.deepEqual(leiter.pruefeFremdaenderungen(d, katalog, tag(4)), [], "marked only once while eBay shows the same");
  assert.ok(leiter.fremdSeit(d, ktr)); assert.equal(leiter.fremdSeit(d, nr), null);
  const f = JSON.parse(d.prepare("SELECT details FROM leiter_verlauf WHERE number = ? AND ereignis = 'fremd'").get(ktr).details);
  assert.deepEqual(f.abweichungen, [{ feld: "preis", erwartet: 7.5, ebay: 6.99 }]);
  assert.equal(d.prepare("SELECT COUNT(*) n FROM protokoll WHERE aktion = 'ladder_outside_change'").get().n, 1);
  // The test listing runs; its interim has no control group any more, because the only control was changed from outside
  leiter.setzeTitelVorschlag(d, BUILDER, nr, titelVorschlag, T0);
  leiter.starteVonHand(d, ADMIN, nr, { impTag: impVon() }, T0);
  const u = leiter.uebersicht(d, shop(), daten({}, "2026-11-27", { einst: e }), tag(7));
  assert.equal(u.angebote.find((a) => a.number === nr).stand.kontrolle, null, "the changed control listing dropped out");
  assert.ok(u.angebote.find((a) => a.number === ktr).fremdSeit, "the overview carries the mark");
});

test("Outside changes (F6): after an app change the old value counts for 2 days, a third value or a later old value is marked", async () => {
  const d = neueDb(), s = schreiber();
  leiter.nimmAuf(d, shop(), { ...E, leiterMax: 1 }, T0);
  leiter.setzeTitelVorschlag(d, ADMIN, "A", titelVorschlag, T0);
  const r = await leiter.gibFrei(d, ADMIN, "A", { items: ITEMS, schreiber: s, impTag: impVon() }, T0);
  assert.equal(r.wert.ausgang, "angewendet");
  const stand = JSON.parse(d.prepare("SELECT details FROM leiter_verlauf WHERE number = 'A' AND ereignis = 'stand'").get().details);
  assert.equal(stand.titel, "Wandhalter passend für A"); assert.equal(stand.vorher.titel, "Halter A"); assert.equal(stand.preis, 9.99);
  // The catalogue still shows the old title the next day: not an outside change
  assert.deepEqual(leiter.pruefeFremdaenderungen(d, new Map([["A", { titel: "Halter A", preis: 9.99 }]]), tag(1)), []);
  // Now it shows the new title: fine
  assert.deepEqual(leiter.pruefeFremdaenderungen(d, new Map([["A", { titel: "Wandhalter passend für A", preis: 9.99 }]]), tag(1)), []);
  // Three days later it shows the old title again: someone undid it on eBay
  assert.deepEqual(leiter.pruefeFremdaenderungen(d, new Map([["A", { titel: "Halter A", preis: 9.99 }]]), tag(3)), ["A"]);
  // A completely different title right away is marked too
  const d2 = neueDb();
  leiter.nimmAuf(d2, shop(), { ...E, leiterMax: 1 }, T0);
  leiter.setzeTitelVorschlag(d2, ADMIN, "A", titelVorschlag, T0);
  await leiter.gibFrei(d2, ADMIN, "A", { items: ITEMS, schreiber: schreiber(), impTag: impVon() }, T0);
  assert.deepEqual(leiter.pruefeFremdaenderungen(d2, new Map([["A", { titel: "Ganz anderer Titel", preis: 9.99 }]]), tag(1)), ["A"]);
  // The evaluation of that listing notes it
  const m = leiter.schiebeVonHand(d2, ADMIN, "A", "weiter", daten({}, "2026-11-27", { einst: E }), tag(8), { vorzeitigBestaetigt: true });
  assert.ok(m.wert.messung.fremdSeit, "the evaluation carries fremdSeit");
});

test("Before figure (F11): computed with the data of now, like the control group, not the value stored at the start", () => {
  const d = neueDb(), e = { ...EK, leiterMax: 1 };
  const [nr] = leiter.nimmAuf(d, shop(), e, T0, { seed: 7 });
  leiter.setzeTitelVorschlag(d, BUILDER, nr, titelVorschlag, T0);
  // At the start the last days were missing: 2 a day were known; later the complete data shows 3 a day for everyone
  leiter.starteVonHand(d, ADMIN, nr, { impTag: () => 2 }, T0);
  assert.equal(Math.round(zeile(d, nr).basis_imp_tag * 90), 180, "what was known at the start stays stored");
  const r = leiter.schiebeVonHand(d, ADMIN, nr, "weiter", { ...daten({}, "2026-11-24", { einst: { ...e, leiterTageTitel: 4 } }), impTag: () => 3 }, tag(5));
  assert.equal(r.wert.messung.vorher90, 270, "before = the same 30 days, with the data of now");
  assert.equal(r.wert.messung.netto, 0, "listing and control both stayed at 3 a day: no effect (the stored 180 would have shown +50 %)");
});

test("Outside changes (F6): a step done by hand on eBay notes the new state from the catalogue after 2 days instead of raising an alarm", () => {
  const d = neueDb();
  leiter.nimmAuf(d, shop(), { ...E, leiterMax: 1 }, T0);
  leiter.setzeTitelVorschlag(d, ADMIN, "A", titelVorschlag, T0);
  leiter.starteVonHand(d, ADMIN, "A", { impTag: impVon() }, T0);
  const k = new Map([["A", { titel: "Von Hand neu", preis: 9.99 }]]);
  assert.deepEqual(leiter.pruefeFremdaenderungen(d, k, tag(1)), [], "within 2 days: waits for the catalogue");
  assert.deepEqual(leiter.pruefeFremdaenderungen(d, k, tag(3)), [], "then notes it as the new expected state");
  assert.equal(JSON.parse(d.prepare("SELECT details FROM leiter_verlauf WHERE number = 'A' AND ereignis = 'stand' ORDER BY id DESC LIMIT 1").get().details).titel, "Von Hand neu");
  assert.deepEqual(leiter.pruefeFremdaenderungen(d, new Map([["A", { titel: "Noch mal anders", preis: 9.99 }]]), tag(4)), ["A"], "a change after that is marked");
});

// ---------- F7: undo on eBay ----------
test("Undo on eBay (F7): price, ad and title go back in reverse order; the listing leaves the ladder and pauses", async () => {
  const d = neueDb(), s = schreiber();
  leiter.nimmAuf(d, shop(), { ...E, leiterMax: 1 }, T0);
  leiter.setzeTitelVorschlag(d, ADMIN, "A", titelVorschlag, T0);
  await leiter.gibFrei(d, ADMIN, "A", { items: ITEMS, schreiber: s, impTag: impVon() }, T0);                      // title
  leiter.werteAus(d, daten({}, "2026-12-04", { fuer: () => ({ kanaele: ITEMS, varianten: [] }) }), tag(15));    // → ads
  await leiter.gibFrei(d, ADMIN, "A", { items: ITEMS, schreiber: s, impTag: impVon() }, tag(15));                 // ad
  assert.deepEqual(leiter.aenderungenDerApp(d, zeile(d, "A")).map((x) => x.stufe), ["titel", "werbung"]);
  assert.equal((await leiter.macheRueckgaengig(d, BUILDER, "A", { items: ITEMS, schreiber: s })).status, 403);
  // The title went back with the approval of the ad (it did not help), so eBay shows the old title and only the ad is left
  assert.equal(leiter.titelZurueckOffen(d, zeile(d, "A")), null);
  s.entferneWerbung = async (id) => { s.auf.push(["werbung_weg", id]); return { ok: true, meldung: "" }; };
  const vorher = s.auf.length;
  const r = await leiter.macheRueckgaengig(d, ADMIN, "A", { items: ITEMS, schreiber: s }, tag(16));
  assert.equal(r.ok, true); assert.equal(r.wert.ausgang, "rueckgaengig");
  assert.deepEqual(s.auf.slice(vorher), [["werbung_weg", "123456789012"]], "the ad is removed; the title is already back and is not written again");
  assert.equal(zeile(d, "A").stufe, "raus"); assert.equal(zeile(d, "A").ergebnis, "rueckgaengig");
  assert.equal(d.prepare("SELECT COUNT(*) n FROM protokoll WHERE aktion = 'ladder_undone'").get().n, 1);
  const t = leiter.trichter(d, shop(), E, tag(16)).liste.find((x) => x.number === "A");
  assert.equal(t.status, "raus"); assert.match(t.grund, /Undone on eBay/);
  assert.equal((await leiter.macheRueckgaengig(d, ADMIN, "A", { items: ITEMS, schreiber: s })).status, 404, "off the ladder: nothing more to undo");
});

test("Undo on eBay (F7): read before write — a title changed on eBay in between is left alone; nothing changed = refused; dry run without switches", async () => {
  const d = neueDb(), s = schreiber();
  leiter.nimmAuf(d, shop(), { ...E, leiterMax: 1 }, T0);
  assert.equal((await leiter.macheRueckgaengig(d, ADMIN, "A", { items: ITEMS, schreiber: s })).status, 409, "the app changed nothing yet");
  leiter.setzeTitelVorschlag(d, ADMIN, "A", titelVorschlag, T0);
  await leiter.gibFrei(d, ADMIN, "A", { items: ITEMS, schreiber: s, impTag: impVon() }, T0);
  // Writing switched off: dry run, nothing written, the listing stays
  const aus = schreiber({ schreiben: false }); aus.lies = s.lies;
  const p = await leiter.macheRueckgaengig(d, ADMIN, "A", { items: ITEMS, schreiber: aus });
  assert.equal(p.wert.ausgang, "probelauf"); assert.match(p.wert.text, /set the title back to “Halter A”/); assert.equal(aus.auf.length, 0); assert.equal(zeile(d, "A").stufe, "titel");
  // Someone changed the title on eBay by hand: the app does not overwrite it
  s.lies = async () => ({ ok: true, titel: "Von Hand geändert", status: "Active", verkauft: 3, preis: 9.99, variationen: [] });
  const vorher = s.auf.length;
  const f = await leiter.macheRueckgaengig(d, ADMIN, "A", { items: ITEMS, schreiber: s });
  assert.equal(f.wert.ausgang, "fehlgeschlagen"); assert.match(f.wert.text, /Title not undone: eBay shows “Von Hand geändert”/);
  assert.equal(s.auf.length, vorher, "nothing written"); assert.equal(zeile(d, "A").stufe, "titel", "the listing stays on the ladder");
});

test("Undo on eBay (F7): a lowered price goes back to the old price, only if eBay still shows the app's price", async () => {
  const d = neueDb(), s = schreiber();
  leiter.nimmAuf(d, shop(), { ...E, leiterMax: 1 }, T0);
  leiter.ueberspringe(d, ADMIN, "A", "", E, {}, T0); leiter.ueberspringe(d, ADMIN, "A", "", E, { fuer: () => ({ kanaele: ITEMS, varianten: [] }) }, T0);
  const g = await leiter.gibFrei(d, ADMIN, "A", { items: ITEMS, schreiber: s, impTag: impVon() }, T0);
  assert.equal(g.wert.ausgang, "angewendet"); assert.deepEqual(s.auf.at(-1), ["preis", "123456789012", 8.99]);
  s.lies = async () => ({ ok: true, titel: "Halter A", status: "Active", verkauft: 3, preis: 8.99, variationen: [] });
  const r = await leiter.macheRueckgaengig(d, ADMIN, "A", { items: ITEMS, schreiber: s }, tag(2));
  assert.equal(r.wert.ausgang, "rueckgaengig"); assert.deepEqual(s.auf.at(-1), ["preis", "123456789012", 9.99]);
});

// ---------- Title back when it did not help (Niko, 23 Nov 2026) ----------
// An eBay stand-in that remembers title, ad and price, so the tests see what a buyer would see after each click.
const merkEbay = (schalter = {}) => {
  const ebay = { titel: "Halter A", preis: 9.99, werbung: null }, auf = [];
  return { ebay, auf, konfiguriert: () => schalter.konfiguriert ?? true, schreibenAn: () => schalter.schreiben ?? true, werbungAn: () => true, preisAn: () => true,
    lies: async () => (schalter.lesenKaputt?.() ? { ok: false, meldung: "eBay is down" } : { ok: true, titel: ebay.titel, status: "Active", verkauft: 0, preis: ebay.preis, variationen: [] }),
    setzeTitel: async (id, t) => { auf.push(["titel", t]); ebay.titel = t; return { ok: true, meldung: "" }; },
    setzeWerbung: async (id, satz) => { auf.push(["werbung", satz]); ebay.werbung = satz; return { ok: true, meldung: "" }; },
    entferneWerbung: async () => { auf.push(["werbung_weg"]); ebay.werbung = null; return { ok: true, meldung: "" }; },
    setzePreis: async (id, skus, p) => { auf.push(["preis", p]); ebay.preis = p; return { ok: true, meldung: "" }; } };
};
// Title live, waiting time over without recovery: the listing waits at the ads step
async function bisWerbung(s) {
  const d = neueDb();
  leiter.nimmAuf(d, shop(), { ...E, leiterMax: 1 }, T0);
  leiter.setzeTitelVorschlag(d, ADMIN, "A", titelVorschlag, T0);
  await leiter.gibFrei(d, ADMIN, "A", { items: ITEMS, schreiber: s, impTag: impVon() }, T0);
  leiter.werteAus(d, daten({}, "2026-12-04", { fuer: () => ({ kanaele: ITEMS, varianten: [] }) }), tag(15));
  return d;
}

test("Title back: after a title step without recovery the old title returns with the next admin click; ad and price stay", async () => {
  const s = merkEbay(), d = await bisWerbung(s);
  assert.equal(s.ebay.titel, "Wandhalter passend für A", "the daily run alone changes nothing on eBay");
  assert.equal(leiter.titelZurueckOffen(d, zeile(d, "A")).alt, "Halter A");
  assert.equal((await leiter.setzeTitelZurueck(d, BUILDER, "A", { items: ITEMS, schreiber: s })).status, 403, "only an admin");
  const r = await leiter.setzeTitelZurueck(d, ADMIN, "A", { items: ITEMS, schreiber: s }, tag(15));  // what "Next phase →" does right away
  assert.equal(r.wert.ausgang, "zurueckgesetzt"); assert.match(r.wert.text, /set back to “Halter A”/);
  assert.equal(s.ebay.titel, "Halter A");
  assert.equal(d.prepare("SELECT COUNT(*) n FROM protokoll WHERE aktion = 'ladder_title_reverted'").get().n, 1);
  assert.equal((await leiter.setzeTitelZurueck(d, ADMIN, "A", { items: ITEMS, schreiber: s }, tag(15))).wert.ausgang, "nichts", "not twice");
  // ads, then price: the ad stays when the price goes down, the title stays the old one
  await leiter.gibFrei(d, ADMIN, "A", { items: ITEMS, schreiber: s, impTag: impVon() }, tag(15));
  leiter.werteAus(d, daten({}, "2026-12-20", { fuer: () => ({ kanaele: ITEMS, varianten: [] }) }), tag(30));
  await leiter.gibFrei(d, ADMIN, "A", { items: ITEMS, schreiber: s, impTag: impVon() }, tag(30));
  assert.deepEqual(s.ebay, { titel: "Halter A", preis: 8.99, werbung: 0.1 });
  assert.deepEqual(s.auf, [["titel", "Wandhalter passend für A"], ["titel", "Halter A"], ["werbung", 0.1], ["preis", 8.99]]);
  // the expected state for the outside-change check is the old title again: the catalogue showing it is no outside change
  assert.deepEqual(leiter.pruefeFremdaenderungen(d, new Map([["A", { titel: "Halter A", preis: 8.99 }]]), tag(40)), []);
});

test("Title back: if nobody clicked in between, the approval of the ads step sets the title back first", async () => {
  const s = merkEbay(), d = await bisWerbung(s);
  const r = await leiter.gibFrei(d, ADMIN, "A", { items: ITEMS, schreiber: s, impTag: impVon() }, tag(15));
  assert.equal(r.wert.ausgang, "angewendet"); assert.match(r.wert.text, /set back to “Halter A”.*changed on eBay/);
  assert.deepEqual(s.ebay, { titel: "Halter A", preis: 9.99, werbung: 0.1 });
});

test("Title back: a title that worked stays (Seen again), and a title somebody else changed is left alone", async () => {
  const s = merkEbay(), d = neueDb();
  leiter.nimmAuf(d, shop(), { ...E, leiterMax: 1 }, T0);
  leiter.setzeTitelVorschlag(d, ADMIN, "A", titelVorschlag, T0);
  await leiter.gibFrei(d, ADMIN, "A", { items: ITEMS, schreiber: s, impTag: impVon() }, T0);
  leiter.schiebeVonHand(d, ADMIN, "A", "erholt", daten({}, "2026-12-04"), tag(15));
  assert.equal((await leiter.setzeTitelZurueck(d, ADMIN, "A", { items: ITEMS, schreiber: s }, tag(15))).wert.ausgang, "nichts");
  assert.equal(s.ebay.titel, "Wandhalter passend für A", "seen again: the new title did its job and stays");

  const s2 = merkEbay(), d2 = await bisWerbung(s2);
  s2.ebay.titel = "Von jemand anderem geändert";
  const r = await leiter.setzeTitelZurueck(d2, ADMIN, "A", { items: ITEMS, schreiber: s2 }, tag(15));
  assert.match(r.wert.text, /left alone: eBay shows “Von jemand anderem geändert”/);
  assert.equal(s2.ebay.titel, "Von jemand anderem geändert", "nothing is overwritten");
  assert.equal(leiter.titelZurueckOffen(d2, zeile(d2, "A")), null, "and it is not tried again and again");
});

test("Title back: without writing it is a dry run that records nothing; if eBay cannot be read the next step does not start", async () => {
  let aus = true;
  const s = merkEbay({ schreiben: false }), d = neueDb();
  // the title was written while writing was on (a row in the history says so), now writing is off
  leiter.nimmAuf(d, shop(), { ...E, leiterMax: 1 }, T0);
  leiter.setzeTitelVorschlag(d, ADMIN, "A", titelVorschlag, T0);
  await leiter.gibFrei(d, ADMIN, "A", { items: ITEMS, schreiber: merkEbay(), impTag: impVon() }, T0);
  leiter.werteAus(d, daten({}, "2026-12-04", { fuer: () => ({ kanaele: ITEMS, varianten: [] }) }), tag(15));
  const p = await leiter.setzeTitelZurueck(d, ADMIN, "A", { items: ITEMS, schreiber: s }, tag(15));
  assert.equal(p.wert.ausgang, "probelauf"); assert.match(p.wert.text, /would be set back to “Halter A”/);
  assert.ok(leiter.titelZurueckOffen(d, zeile(d, "A")), "still open: it is done with the next click when writing is on");

  const kaputt = merkEbay({ lesenKaputt: () => aus }); kaputt.ebay.titel = "Wandhalter passend für A";
  const f = await leiter.gibFrei(d, ADMIN, "A", { items: ITEMS, schreiber: kaputt, impTag: impVon() }, tag(15));
  assert.equal(f.status, 409); assert.match(f.fehler, /title was not set back.*Nothing was changed/);
  assert.equal(zeile(d, "A").phase, "vorschlag", "the ads step did not start"); assert.deepEqual(kaputt.auf, []);
  aus = false;
  assert.equal((await leiter.gibFrei(d, ADMIN, "A", { items: ITEMS, schreiber: kaputt, impTag: impVon() }, tag(15))).wert.ausgang, "angewendet");
  assert.deepEqual(kaputt.ebay, { titel: "Halter A", preis: 9.99, werbung: 0.1 });
});

// ---------- Prices of listings with variants (Niko, 23 Nov 2026) ----------
// eBay stand-in with three variants; setzeVariantenPreise gets every variant with its new price, as the real writer does.
const variantenEbay = (preise) => {
  const ebay = { titel: "Halter A", variationen: preise.map((p, i) => ({ sku: "A-" + i, skuRoh: "A-" + i, preis: p, spezifika: [{ name: "Farbe", werte: ["F" + i] }] })) }, auf = [];
  return { ebay, auf, konfiguriert: () => true, schreibenAn: () => true, werbungAn: () => true, preisAn: () => true,
    lies: async () => ({ ok: true, titel: ebay.titel, status: "Active", verkauft: 0, preis: null, variationen: ebay.variationen.map((x) => ({ ...x })) }),
    setzeTitel: async (id, t) => { ebay.titel = t; return { ok: true, meldung: "" }; },
    setzePreis: async () => { auf.push("setzePreis"); return { ok: false, meldung: "wrong call for a listing with variants" }; },
    setzeVariantenPreise: async (id, vs) => { auf.push(vs.map((x) => x.preis)); assert.ok(vs.every((x) => x.spezifika.length && x.skuRoh), "every variant keeps its properties and SKU"); ebay.variationen = vs.map((x) => ({ ...x })); return { ok: true, meldung: "" }; } };
};
// a listing waiting at the price step with the given suggestion
function amPreis(preise) {
  const d = neueDb();
  leiter.nimmAuf(d, shop(), { ...E, leiterMax: 1 }, T0);
  const v = leiter.baueVorschlag("preis", E, { kanaele: ITEMS.map((k) => ({ ...k, preis_aktuell: preise[0] })), varianten: preise.map((p) => ({ price: p })) });
  d.prepare("UPDATE leiter SET stufe = 'preis', phase = 'vorschlag', vorschlag = ? WHERE number = 'A'").run(JSON.stringify(v));
  return d;
}

test("Variants: different prices go down by the same percentage each, and Undo puts every price back", async () => {
  const s = variantenEbay([7.99, 9.99, 14.99]), d = amPreis([7.99, 9.99, 14.99]);
  const r = await leiter.gibFrei(d, ADMIN, "A", { items: ITEMS, schreiber: s, impTag: impVon(), einst: E }, T0);
  assert.equal(r.wert.ausgang, "angewendet"); assert.match(r.wert.text, /Now on eBay: 7\.19 \/ 8\.99 \/ 13\.49 €/);
  assert.deepEqual(s.auf, [[7.19, 8.99, 13.49]], "one call with all variants, never the call for listings without variants");
  const stand = JSON.parse(d.prepare("SELECT details FROM leiter_verlauf WHERE number = 'A' AND ereignis = 'stand' ORDER BY id DESC LIMIT 1").get().details);
  assert.equal(stand.preis, null, "with several prices no single price is expected from the catalogue");
  const u = await leiter.macheRueckgaengig(d, ADMIN, "A", { items: ITEMS, schreiber: s }, tag(1));
  assert.equal(u.wert.ausgang, "rueckgaengig"); assert.match(u.wert.text, /set the price back to 7\.99 \/ 9\.99 \/ 14\.99 €|price back to 7\.99/);
  assert.deepEqual(s.ebay.variationen.map((x) => x.preis), [7.99, 9.99, 14.99]);
});

test("Variants: one price for all variants goes through the same call (the listing that eBay refused before)", async () => {
  const s = variantenEbay([14.99, 14.99, 14.99]), d = amPreis([14.99]);
  assert.equal((await leiter.gibFrei(d, ADMIN, "A", { items: ITEMS, schreiber: s, impTag: impVon(), einst: E }, T0)).wert.ausgang, "angewendet");
  assert.deepEqual(s.auf, [[13.49, 13.49, 13.49]]);
});

test("Variants: a price on eBay that the suggestion does not know stops everything, nothing is written", async () => {
  const s = variantenEbay([7.99, 9.99, 12.5]), d = amPreis([7.99, 9.99, 14.99]);
  const r = await leiter.gibFrei(d, ADMIN, "A", { items: ITEMS, schreiber: s, impTag: impVon(), einst: E }, T0);
  assert.equal(r.wert.ausgang, "fehlgeschlagen"); assert.match(r.wert.text, /price on eBay \(7\.99 \/ 9\.99 \/ 12\.50 €\) is not the expected 7\.99 \/ 9\.99 \/ 14\.99 €/);
  assert.deepEqual(s.auf, []); assert.equal(zeile(d, "A").phase, "vorschlag");
});

test("Price suggestions that were 'not possible' under older rules are built again; one that is still not possible stays", () => {
  const d = neueDb();
  leiter.nimmAuf(d, shop(), { ...E, leiterMax: 2 }, T0);
  d.prepare("UPDATE leiter SET stufe = 'preis', phase = 'vorschlag', vorschlag = ?").run(JSON.stringify({ nichtMoeglich: "The variants have different prices (7.99 / 9.99 €)." }));
  const fuer = (nr) => (nr === "A" ? { kanaele: [{ preis_aktuell: 7.99 }], varianten: [{ price: 7.99 }, { price: 9.99 }] } : { kanaele: [{ preis_aktuell: 3.19 }], varianten: [] });
  assert.deepEqual(leiter.erneuerePreisVorschlaege(d, E, fuer, T0), ["A"]);
  assert.deepEqual(JSON.parse(zeile(d, "A").vorschlag).staffel, [{ alt: 7.99, neu: 7.19 }, { alt: 9.99, neu: 8.99 }]);
  assert.match(JSON.parse(zeile(d, "B").vorschlag).nichtMoeglich, /different prices/, "B would go below the floor: its old note stays");
  assert.deepEqual(leiter.erneuerePreisVorschlaege(d, E, fuer, T0), [], "nothing left to renew");
});
