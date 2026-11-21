// Tests: npm test  (Node's own test runner, no additional packages)
import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { bewerte, conversion, klickrate, leiteSchwellenAb, EINSTELLUNGEN, GRUPPEN, TITEL_MAX_ZEICHEN } from "./regeln.mjs";
import * as einst from "./einstellungen.mjs";
import * as ex from "./experimente.mjs";
import { baueBewertung } from "./bewertung.mjs";

const JETZT = new Date("2026-11-10T12:00:00Z");
const alt = "2025-12-01T10:00:00.000Z"; // deutlich älter als 90 Tage
const TAGE = (d) => new Date(JETZT.getTime() + d * 86400000);
// Default: listing with enough impressions
const p = (o) => ({ created_at: alt, title: "Wandhalter passend für Test", units_90d: 5, units_total: 20, aufrufe_90d: 200, impressionen_90d: 10000, ...o });
const bereich = (o, e = EINSTELLUNGEN) => bewerte(p(o), e, JETZT).gruppe;
const db = () => { const d = new Database(":memory:"); einst.bereiteVor(d); ex.bereiteVor(d); return d; };

// ---------- Diagnose: drei Bereiche ----------
test("Diagnosis: there are exactly three areas with a clear recommendation", () => {
  assert.deepEqual(Object.keys(GRUPPEN), ["sichtbarkeit", "ok", "warten"]);
  for (const g of Object.values(GRUPPEN)) assert.ok(g.label && g.empfehlung && g.regel);
});

test("Diagnosis: low impressions, limit at exactly 2,000 (fallback value)", () => {
  assert.equal(bereich({ impressionen_90d: 1999 }), "sichtbarkeit");
  assert.equal(bereich({ impressionen_90d: 2000 }), "ok");
  assert.equal(bewerte(p({ impressionen_90d: 100 }), EINSTELLUNGEN, JETZT).empfehlung, "Improve the title");
});

test("Diagnosis: selling listings with low impressions belong too, with a note", () => {
  const r = bewerte(p({ units_90d: 5, impressionen_90d: 1500 }), EINSTELLUNGEN, JETZT);
  assert.equal(r.gruppe, "sichtbarkeit");
  assert.match(r.begruendung, /already sells \(5 sales/);
  assert.match(bewerte(p({ units_90d: 1, impressionen_90d: 1500 }), EINSTELLUNGEN, JETZT).begruendung, /\(1 sale in 90 days\)/);
  assert.match(bewerte(p({ units_90d: 0, impressionen_90d: 1500 }), EINSTELLUNGEN, JETZT).begruendung, /Too few buyers see this listing/);
});

test("Diagnosis: new listings and listings without figures get 'Wait', never a downgrade", () => {
  assert.equal(bereich({ created_at: "2026-10-20T10:00:00.000Z", impressionen_90d: 5 }), "warten");
  assert.equal(bereich({ impressionen_90d: null }), "warten");
  const grenze = new Date(JETZT.getTime() - 90 * 86400000).toISOString();
  assert.notEqual(bereich({ created_at: grenze, impressionen_90d: 5 }), "warten"); // genau an der Grenze nicht mehr neu
  assert.equal(bereich({ created_at: "kein Datum", impressionen_90d: 5 }), "sichtbarkeit"); // kaputtes Datum stürzt nicht ab
});

test("Diagnosis: zero impressions does not divide by 0 and stays Low impressions", () => {
  assert.equal(bereich({ impressionen_90d: 0, aufrufe_90d: 0, units_90d: 0 }), "sichtbarkeit");
  assert.equal(conversion({ units_90d: 3, aufrufe_90d: 0 }), null);
  assert.equal(klickrate({ aufrufe_90d: 5, impressionen_90d: 0 }), null);
  assert.equal(klickrate({ aufrufe_90d: 5, impressionen_90d: 1000 }), 0.005);
});

test("Limit: the lowest quarter is calculated from the shop, new listings do not count", () => {
  const viele = Array.from({ length: 100 }, (_, i) => ({ created_at: alt, impressionen_90d: (i + 1) * 100 }));
  const neu = Array.from({ length: 50 }, () => ({ created_at: "2026-11-01T00:00:00.000Z", impressionen_90d: 1 }));
  assert.equal(leiteSchwellenAb([...viele, ...neu], EINSTELLUNGEN, JETZT).wenigImpressionen90d, 2500);
  assert.equal(leiteSchwellenAb([...viele, ...neu], { ...EINSTELLUNGEN, anteilUnten: 0.1 }, JETZT).wenigImpressionen90d, 1000);
});

test("Limit: mode 'fixed number' takes the number from the settings, too little data keeps the fallback value", () => {
  const viele = Array.from({ length: 100 }, (_, i) => ({ created_at: alt, impressionen_90d: (i + 1) * 100 }));
  assert.equal(leiteSchwellenAb(viele, { ...EINSTELLUNGEN, modus: "fest", festeGrenze: 777 }, JETZT).wenigImpressionen90d, 777);
  assert.equal(leiteSchwellenAb([{ created_at: alt, impressionen_90d: 5 }], EINSTELLUNGEN, JETZT).wenigImpressionen90d, EINSTELLUNGEN.wenigImpressionen90d);
  // the reason names the yardstick of the chosen setting
  assert.match(bewerte(p({ impressionen_90d: 10 }), { ...EINSTELLUNGEN, modus: "fest", festeGrenze: 777, wenigImpressionen90d: 777 }, JETZT).begruendung, /your limit: under 777/);
  assert.match(bewerte(p({ impressionen_90d: 10 }), EINSTELLUNGEN, JETZT).begruendung, /lowest 25 % of the shop/);
});

test("Evaluation: the overview counts all listings exactly once and marks listings in tests", () => {
  const ps = [{ number: "1", ...p({ impressionen_90d: 10000 }) }, { number: "2", ...p({ impressionen_90d: 10 }) }, { number: "3", ...p({ created_at: "2026-11-01T00:00:00.000Z" }) }];
  const b = baueBewertung(ps, EINSTELLUNGEN, JETZT, new Map([["2", { id: 7, gruppe: "test", status: "laeuft" }]]));
  assert.equal(Object.values(b.uebersicht).reduce((a, c) => a + c, 0), 3);
  assert.deepEqual(b.uebersicht, { sichtbarkeit: 1, ok: 1, warten: 1 });
  assert.equal(b.produkte.find((x) => x.number === "2").imTest.id, 7);
  assert.equal(b.produkte.find((x) => x.number === "1").imTest, null);
});

// ---------- Einstellungen ----------
test("Settings: defaults, saving, overriding, resetting", () => {
  const d = db();
  assert.equal(einst.effektiv(d).anteilUnten, 0.25);
  assert.equal(einst.speichere(d, { anteilUnten: 0.1, schonfristTage: 60 }).ok, true);
  assert.equal(einst.effektiv(d).anteilUnten, 0.1);
  assert.equal(einst.effektiv(d).schonfristTage, 60);
  assert.equal(einst.effektiv(d).testGroesse, 40); // untouched
  einst.speichere(d, { anteilUnten: 0.3 });
  assert.equal(einst.effektiv(d).anteilUnten, 0.3);   // overwritten, not doubled
  assert.equal(d.prepare("SELECT COUNT(*) c FROM einstellung WHERE key = 'anteilUnten'").get().c, 1);
  einst.zuruecksetzen(d);
  assert.equal(einst.effektiv(d).anteilUnten, 0.25);
  assert.equal(d.prepare("SELECT COUNT(*) c FROM einstellung").get().c, 0);
});

test("Settings: invalid values are rejected and nothing is saved", () => {
  const d = db();
  const abgelehnt = (e, muster) => { const r = einst.speichere(d, e); assert.equal(r.ok, false); assert.equal(r.status, 400); assert.match(r.fehler, muster); };
  abgelehnt({ anteilUnten: 0.9 }, /between 5 and 50/);        // too large
  abgelehnt({ anteilUnten: 0.01 }, /between 5 and 50/);       // too small
  abgelehnt({ anteilUnten: "25" }, /enter a number/);         // falscher Typ
  abgelehnt({ anteilUnten: NaN }, /enter a number/);
  abgelehnt({ anteilUnten: Infinity }, /enter a number/);
  abgelehnt({ schonfristTage: 1.5 }, /whole number/);
  abgelehnt({ schonfristTage: -1 }, /between 0 and 365/);
  abgelehnt({ testGroesse: 41 }, /even number/);
  abgelehnt({ preisMinimum: 0.1 }, /between/);                // F3: the price floor has limits too
  abgelehnt({ preisMinimum: "3" }, /enter a number/);
  abgelehnt({ testGroesse: 2 }, /between 4 and 200/);
  abgelehnt({ modus: "egal" }, /choose one of the options/);
  abgelehnt({ modus: "toString" }, /choose one of the options/);
  abgelehnt({ gibtEsNicht: 1 }, /Unknown setting/);
  abgelehnt({ constructor: 1 }, /Unknown setting/);
  abgelehnt({ toString: 1 }, /Unknown setting/);
  abgelehnt({}, /Nothing to save/);
  assert.equal(einst.speichere(d, null).ok, false);
  assert.equal(einst.speichere(d, [1]).ok, false);
  // an error in one field prevents saving the other fields of the same request
  assert.equal(einst.speichere(d, { schonfristTage: 30, anteilUnten: 5 }).ok, false);
  assert.equal(einst.effektiv(d).schonfristTage, 90);
  assert.equal(d.prepare("SELECT COUNT(*) c FROM einstellung").get().c, 0);
});

test("Settings: limit values are allowed, percentages with rounding errors too", () => {
  const d = db();
  assert.equal(einst.speichere(d, { anteilUnten: 0.05 }).ok, true);
  assert.equal(einst.speichere(d, { anteilUnten: 0.5 }).ok, true);
  assert.equal(einst.speichere(d, { anteilUnten: 0.07 }).ok, true);
  assert.equal(einst.speichere(d, { testGroesse: 4 }).ok, true);
  assert.equal(einst.speichere(d, { modus: "fest", festeGrenze: 1 }).ok, true);
});

test("Settings: broken or outdated saved entries are ignored", () => {
  const d = db();
  d.prepare("INSERT INTO einstellung VALUES ('anteilUnten', '99')").run();      // ungültig
  d.prepare("INSERT INTO einstellung VALUES ('schonfristTage', 'kaputt{')").run(); // kein JSON
  d.prepare("INSERT INTO einstellung VALUES ('alteRegel', '5')").run();         // unbekannt
  d.prepare("INSERT INTO einstellung VALUES ('testGroesse', '20')").run();      // gültig
  const e = einst.effektiv(d);
  assert.equal(e.anteilUnten, 0.25); assert.equal(e.schonfristTage, 90); assert.equal(e.testGroesse, 20);
  assert.equal(Object.hasOwn(e, "alteRegel"), false);
});

test("Settings: every schema field has a label, an explanation, a valid default and a section", () => {
  const abschnitte = new Set(einst.ABSCHNITTE.map((a) => a.id));
  for (const f of einst.SCHEMA) {
    assert.ok(f.label && f.hilfe, `Feld ${f.key} ohne Text`);
    assert.ok(abschnitte.has(f.abschnitt));
    assert.equal(einst.pruefeWert(f, einst.STANDARD[f.key]), null, `Startwert von ${f.key} ist ungültig`);
  }
});

test("Settings: the mode controls the diagnosis limit", () => {
  const d = db();
  einst.speichere(d, { modus: "fest", festeGrenze: 5000 });
  const e = leiteSchwellenAb([], einst.effektiv(d), JETZT);
  assert.equal(bereich({ impressionen_90d: 4999 }, e), "sichtbarkeit");
  assert.equal(bereich({ impressionen_90d: 5000 }, e), "ok");
});

// ---------- Tests (experiments) ----------
// 60 listings with low impressions, 20 with many, 5 new
const shop = () => [
  ...Array.from({ length: 60 }, (_, i) => ({ number: "L" + String(i).padStart(2, "0"), title: "Niedrig " + i, ...p({ impressionen_90d: 100 + i, impressionen_30d: 30, aufrufe_30d: 3, transaktionen_30d: 1, image_url: "https://x/" + i + ".jpg", avg_price: 5 }) })),
  ...Array.from({ length: 20 }, (_, i) => ({ number: "H" + i, title: "Hoch " + i, ...p({ impressionen_90d: 50000, impressionen_30d: 10000 }) })),
  ...Array.from({ length: 5 }, (_, i) => ({ number: "N" + i, title: "Neu " + i, ...p({ created_at: "2026-11-01T00:00:00.000Z", impressionen_90d: 5 }) })),
];
// fixed limit, so that all 60 "Low" listings qualify (by default the lowest quarter of the shop applies)
const E = { ...EINSTELLUNGEN, testGroesse: 40, modus: "fest", festeGrenze: 1000 };

test("Draw: the same random value gives the same draw, another gives a different one", () => {
  const k = shop().filter((x) => x.number.startsWith("L"));
  const a = ex.ziehe(k, 20, 42), b = ex.ziehe(k, 20, 42), c = ex.ziehe(k, 20, 43);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a.test.map((x) => x.number), c.test.map((x) => x.number));
});

test("Draw: half test and half control, without overlap and without duplicates", () => {
  const k = shop().filter((x) => x.number.startsWith("L"));
  for (const seed of [1, 2, 3, 99, 12345]) {
    const { test: t, kontrolle: c } = ex.ziehe(k, 40, seed);
    assert.equal(t.length, 20); assert.equal(c.length, 20);
    assert.equal(new Set([...t, ...c].map((x) => x.number)).size, 40);
  }
});

test("Draw: it is really randomly distributed (no listing is always sorted into the same group)", () => {
  const k = shop().filter((x) => x.number.startsWith("L"));
  let ersteInTest = 0;
  for (let seed = 1; seed <= 200; seed++) if (ex.ziehe(k, 40, seed).test.some((x) => x.number === "L00")) ersteInTest++;
  assert.ok(ersteInTest > 40 && ersteInTest < 160, `L00 war ${ersteInTest} von 200 Mal in der Testgruppe`); // erwartet etwa 33 %
});

test("Create test: draws only from 'Low impressions', never new or well-seen listings", () => {
  const d = db();
  const r = ex.legeAn(d, {}, shop(), E, JETZT, 7);
  assert.equal(r.ok, true);
  const z = d.prepare("SELECT number, gruppe FROM experiment_angebot WHERE experiment_id = ?").all(r.wert.id);
  assert.equal(z.length, 40);
  assert.ok(z.every((x) => x.number.startsWith("L")));
  assert.equal(z.filter((x) => x.gruppe === "test").length, 20);
  assert.equal(d.prepare("SELECT status FROM experiment").get().status, "vorbereitet");
  assert.equal(d.prepare("SELECT seed FROM experiment").get().seed, 7); // das Los ist nachvollziehbar
});

test("Create test: too few matching listings gives an understandable refusal", () => {
  const d = db();
  const r = ex.legeAn(d, {}, shop().slice(0, 30), E, JETZT, 1);
  assert.equal(r.ok, false); assert.equal(r.status, 409);
  assert.match(r.fehler, /Not enough listings for a test: 30 available, 40 needed/);
  assert.equal(d.prepare("SELECT COUNT(*) c FROM experiment").get().c, 0);
});

test("Create test: a listing is always in only one test", () => {
  const d = db();
  assert.equal(ex.legeAn(d, {}, shop(), { ...E, testGroesse: 40 }, JETZT, 1).ok, true);      // 40 of 60 taken
  const zweiter = ex.legeAn(d, {}, shop(), { ...E, testGroesse: 40 }, JETZT, 2);             // only 20 free any more
  assert.equal(zweiter.ok, false); assert.equal(zweiter.status, 409);
  assert.equal(ex.legeAn(d, {}, shop(), { ...E, testGroesse: 20 }, JETZT, 3).ok, true);      // 20 still fit
  const nummern = d.prepare("SELECT number FROM experiment_angebot").all().map((r) => r.number);
  assert.equal(new Set(nummern).size, nummern.length);                                        // no listing twice
  assert.equal(ex.imTest(d).size, 60);
  // after closing, the listings are free again
  ex.schliesse(d, { id: 1, abschluss: "zurueck" }, JETZT);
  assert.equal(ex.imTest(d).size, 20);
  assert.equal(ex.kandidaten(d, shop(), E, JETZT).length, 40);
});

test("Create test: the name is checked, without a name there is a default name", () => {
  const d = db();
  assert.equal(ex.legeAn(d, { name: "x".repeat(61) }, shop(), E, JETZT, 1).status, 400);
  assert.equal(ex.legeAn(d, { name: 5 }, shop(), E, JETZT, 1).status, 400);
  assert.equal(ex.legeAn(d, [1], shop(), E, JETZT, 1).status, 400);
  assert.equal(d.prepare("SELECT COUNT(*) c FROM experiment").get().c, 0);
  const r = ex.legeAn(d, { name: "  Mein Test  " }, shop(), { ...E, testGroesse: 20 }, JETZT, 1);
  assert.equal(d.prepare("SELECT name FROM experiment WHERE id = ?").get(r.wert.id).name, "Mein Test");
  const r2 = ex.legeAn(d, null, shop(), { ...E, testGroesse: 20 }, JETZT, 2);
  assert.equal(d.prepare("SELECT name FROM experiment WHERE id = ?").get(r2.wert.id).name, `Title test #${r2.wert.id}`);
});

// prepared test with 40 listings
function vorbereitet(e = E) {
  const d = db(); const ps = shop();
  const id = ex.legeAn(d, {}, ps, e, JETZT, 5).wert.id;
  const nummern = (g) => d.prepare("SELECT number FROM experiment_angebot WHERE experiment_id = ? AND gruppe = ? ORDER BY number").all(id, g).map((r) => r.number);
  return { d, ps, id, testNr: nummern("test"), kontrolleNr: nummern("kontrolle") };
}
const alleTitel = (v) => v.testNr.forEach((nr, i) => assert.equal(ex.setzeTitel(v.d, { id: v.id, number: nr, neu: `Besserer Titel ${i}` }, E).ok, true));

test("Enter title: only for the test group, checked, overwritable", () => {
  const v = vorbereitet();
  const t = v.testNr[0];
  assert.deepEqual(ex.setzeTitel(v.d, { id: v.id, number: t, neu: "  Neuer   Titel  " }, E).wert, { id: v.id, number: t, neu: "Neuer Titel" }); // Leerzeichen bereinigt
  assert.equal(ex.setzeTitel(v.d, { id: v.id, number: t, neu: "Noch ein Titel" }, E).ok, true);
  assert.equal(v.d.prepare("SELECT neu FROM experiment_angebot WHERE number = ?").get(t).neu, "Noch ein Titel");
  const f = (e) => ex.setzeTitel(v.d, { id: v.id, number: t, ...e }, E);
  assert.equal(f({ neu: "" }).status, 400);
  assert.equal(f({ neu: "   " }).status, 400);
  assert.equal(f({ neu: "x".repeat(TITEL_MAX_ZEICHEN + 1) }).status, 400);
  assert.match(f({ neu: "x".repeat(TITEL_MAX_ZEICHEN + 1) }).fehler, new RegExp(`at most ${TITEL_MAX_ZEICHEN} characters`));
  assert.equal(f({ neu: "x".repeat(TITEL_MAX_ZEICHEN) }).ok, true);          // genau TITEL_MAX_ZEICHEN (80) sind erlaubt
  assert.equal(f({ neu: "Titel\u0000mit Steuerzeichen" }).status, 400);
  assert.equal(f({ neu: 5 }).status, 400);
  assert.equal(f({ neu: v.d.prepare("SELECT alt FROM experiment_angebot WHERE number = ?").get(t).alt }).status, 400); // unverändert
  assert.equal(ex.setzeTitel(v.d, { id: v.id, number: v.kontrolleNr[0], neu: "Neuer Titel" }, E).status, 409);          // Kontrolle bleibt unverändert
  assert.equal(ex.setzeTitel(v.d, { id: v.id, number: "GIBTESNICHT", neu: "Neu" }, E).status, 404);
  assert.equal(ex.setzeTitel(v.d, { id: 999, number: t, neu: "Neu" }, E).status, 404);
  assert.equal(ex.setzeTitel(v.d, { id: "1", number: t, neu: "Neu" }, E).status, 400);
  assert.equal(ex.setzeTitel(v.d, null, E).status, 400);
});

test("Start: only when all test listings have a new title, then the starting figures of both groups are recorded", () => {
  const v = vorbereitet();
  v.testNr.slice(0, 19).forEach((nr) => ex.setzeTitel(v.d, { id: v.id, number: nr, neu: "Neu " + nr }, E));
  const zuFrueh = ex.starte(v.d, { id: v.id }, v.ps, JETZT);
  assert.equal(zuFrueh.ok, false); assert.equal(zuFrueh.status, 409);
  assert.match(zuFrueh.fehler, /1 of 20 test listings still need a new title/);
  assert.equal(v.d.prepare("SELECT status FROM experiment").get().status, "vorbereitet");
  ex.setzeTitel(v.d, { id: v.id, number: v.testNr[19], neu: "Neu letzter" }, E);
  assert.equal(ex.starte(v.d, { id: v.id }, v.ps, JETZT).ok, true);
  const e = v.d.prepare("SELECT status, gestartet_at FROM experiment").get();
  assert.equal(e.status, "laeuft"); assert.equal(e.gestartet_at, JETZT.toISOString());
  const zeilen = v.d.prepare("SELECT * FROM experiment_angebot").all();
  assert.ok(zeilen.every((z) => z.imp30 === 30 && z.auf30 === 3 && z.trans30 === 1)); // beide Gruppen
  assert.equal(ex.starte(v.d, { id: v.id }, v.ps, JETZT).status, 409);                   // do not start twice
  assert.equal(ex.setzeTitel(v.d, { id: v.id, number: v.testNr[0], neu: "Spät" }, E).status, 409); // nach dem Start keine Titeländerung
});

test("Start: vanished listings and unknown tests are rejected", () => {
  const v = vorbereitet(); alleTitel(v);
  const r = ex.starte(v.d, { id: v.id }, v.ps.filter((x) => x.number !== v.kontrolleNr[0]), JETZT);
  assert.equal(r.status, 409); assert.match(r.fehler, /no longer in the data/);
  assert.equal(ex.starte(v.d, { id: 99 }, v.ps, JETZT).status, 404);
  assert.equal(ex.starte(v.d, { id: 0 }, v.ps, JETZT).status, 400);
  assert.equal(ex.starte(v.d, null, v.ps, JETZT).status, 400);
});

// Gruppenurteil (reine Funktion)
const G = (vorher, nachher) => ({ vorher, nachher });
const S = (imp, auf = 0, trans = 0) => ({ imp, auf, trans });

test("Verdict: the test group doubles, control stays the same -> better", () => {
  const r = ex.urteile(G(S(1000, 50, 10), S(2000, 100, 10)), G(S(1000, 50, 10), S(1000, 50, 10)), E);
  assert.equal(r.urteil, "better"); assert.equal(r.empfehlung, "keep");
  assert.ok(Math.abs(r.primaer.netto - 1) < 1e-9);
});

test("Verdict: if the control group grows just as much, there is no difference (season and chance drop out)", () => {
  const r = ex.urteile(G(S(1000, 50, 10), S(2000, 100, 20)), G(S(1000, 50, 10), S(2000, 100, 20)), E);
  assert.equal(r.urteil, "no_difference"); assert.equal(r.empfehlung, "revert"); // zählt wie "nicht besser"
});

test("Verdict: limit at exactly the target mark (besserAb, default +20 %), just below it is no difference", () => {
  const k = G(S(1000, 50, 10), S(1000, 50, 10));
  const marke = Math.round(1000 * (1 + EINSTELLUNGEN.besserAb));   // 1200 at +20 %
  assert.equal(ex.urteile(G(S(1000, 0, 10), S(marke, 0, 10)), k, E).urteil, "better");
  assert.equal(ex.urteile(G(S(1000, 0, 10), S(marke - 1, 0, 10)), k, E).urteil, "no_difference");
});

test("Verdict: fewer impressions or too much fewer sales -> worse (protective figure)", () => {
  const k = G(S(1000, 50, 10), S(1000, 50, 10));
  assert.equal(ex.urteile(G(S(1000, 50, 10), S(500, 25, 5)), k, E).urteil, "worse");
  const r = ex.urteile(G(S(1000, 50, 100), S(3000, 150, 20)), k, E); // three times as many impressions, but sales fell by 80 %
  assert.equal(r.urteil, "worse"); assert.equal(r.schutz.ok, false);
});

test("Verdict: too few impressions in the test group -> no verdict is given", () => {
  const k = G(S(10, 1, 0), S(10, 1, 0));
  assert.equal(ex.urteile(G(S(10, 1, 0), S(149, 5, 0)), k, E).urteil, "not_enough_data");
  assert.notEqual(ex.urteile(G(S(10, 1, 0), S(150, 5, 0)), k, E).urteil, "not_enough_data");
});

test("Verdict: starting value 0 and empty control do not divide by 0, the result is JSON-safe", () => {
  const r = ex.urteile(G(S(0), S(500)), G(S(0), S(0)), E);
  assert.equal(r.urteil, "better");
  assert.equal(r.primaer.netto, null);
  assert.doesNotThrow(() => JSON.stringify(r));
});

test("Verdict: the thresholds come from the settings", () => {
  const k = G(S(1000, 0, 10), S(1000, 0, 10)); const t = G(S(1000, 0, 10), S(1300, 0, 10));
  assert.equal(ex.urteile(t, k, { ...E, besserAb: 0.2 }).urteil, "better");
  assert.equal(ex.urteile(t, k, { ...E, besserAb: 0.5 }).urteil, "no_difference");
  assert.equal(ex.urteile(G(S(1000, 0, 10), S(1300, 0, 5)), k, { ...E, schutzGrenze: 0.6 }).urteil, "better");
  assert.equal(ex.urteile(G(S(1000, 0, 10), S(1300, 0, 5)), k, { ...E, schutzGrenze: 0.2 }).urteil, "worse");
});

test("Run: runs, is ready after 30 days, verdict over the whole group, closing", () => {
  const v = vorbereitet(); alleTitel(v);
  ex.starte(v.d, { id: v.id }, v.ps, JETZT);
  const liste = (jetzt, ps = v.ps) => ex.liste(v.d, ps, jetzt, E)[0];
  assert.equal(liste(TAGE(10)).status, "running");
  assert.equal(liste(TAGE(10)).tage, 10);
  assert.equal(liste(TAGE(29)).status, "running");
  // after 31 days: the test group has twice as many impressions, all others stay the same
  const spaeter = v.ps.map((x) => (v.testNr.includes(x.number) ? { ...x, impressionen_30d: 60 } : x));
  const k = liste(TAGE(31), spaeter);
  assert.equal(k.status, "ready"); assert.equal(k.bereit_am, TAGE(30).toISOString().slice(0, 10));
  assert.equal(k.urteil.urteil, "better");
  assert.equal(k.urteil.test.vorher.imp, 20 * 30); assert.equal(k.urteil.test.nachher.imp, 20 * 60);
  assert.equal(k.urteil.kontrolle.vorher.imp, 20 * 30); assert.equal(k.urteil.kontrolle.nachher.imp, 20 * 30);
  // the list does not contain the single listings, the detail view does
  assert.equal(k.angebote, undefined);
  const dt = ex.detail(v.d, v.id, spaeter, TAGE(31), E).wert;
  assert.equal(dt.angebote.length, 40);
  assert.ok(dt.angebote.filter((a) => a.gruppe === "test").every((a) => a.neu && a.alt && a.vorher && a.nachher));
  assert.ok(dt.angebote.filter((a) => a.gruppe === "kontrolle").every((a) => !a.neu));
  assert.equal(ex.schliesse(v.d, { id: v.id, abschluss: "behalten" }, TAGE(32)).ok, true);
  assert.equal(liste(TAGE(33), spaeter).status, "closed");
  assert.equal(liste(TAGE(33), spaeter).abschluss, "behalten");
});

test("Run: if the whole shop grows along, there is no difference (the control group works)", () => {
  const v = vorbereitet(); alleTitel(v);
  ex.starte(v.d, { id: v.id }, v.ps, JETZT);
  const sommer = v.ps.map((x) => ({ ...x, impressionen_30d: x.impressionen_30d * 2 }));
  assert.equal(ex.liste(v.d, sommer, TAGE(31), E)[0].urteil.urteil, "no_difference");
});

test("Run: discard a test, close twice, invalid input", () => {
  const v = vorbereitet();
  assert.equal(ex.schliesse(v.d, { id: v.id, abschluss: "zurueck" }, JETZT).ok, true);       // vorbereiteten Test verwerfen
  assert.equal(ex.liste(v.d, v.ps, JETZT, E)[0].urteil, null);                                 // never started: no verdict
  assert.equal(ex.schliesse(v.d, { id: v.id, abschluss: "behalten" }, JETZT).status, 409);
  assert.equal(ex.schliesse(v.d, { id: 99, abschluss: "behalten" }, JETZT).status, 404);
  assert.equal(ex.schliesse(v.d, { id: v.id, abschluss: "löschen" }, JETZT).status, 400);
  assert.equal(ex.schliesse(v.d, { id: v.id, abschluss: "toString" }, JETZT).status, 400);
  assert.equal(ex.schliesse(v.d, { id: "1", abschluss: "behalten" }, JETZT).status, 400);
  assert.equal(ex.schliesse(v.d, null, JETZT).status, 400);
  assert.equal(ex.detail(v.d, 99, v.ps, JETZT, E).status, 404);
  assert.equal(ex.detail(v.d, NaN, v.ps, JETZT, E).status, 400);
});

test("Run: vanished listings do not cause a crash, the verdict uses the rest", () => {
  const v = vorbereitet(); alleTitel(v);
  ex.starte(v.d, { id: v.id }, v.ps, JETZT);
  const ohne = v.ps.filter((x) => x.number !== v.testNr[0]);
  const k = ex.liste(v.d, ohne, TAGE(31), E)[0];
  assert.equal(k.status, "ready");
  assert.equal(k.urteil.test.vorher.imp, 19 * 30);
  assert.doesNotThrow(() => JSON.stringify(ex.detail(v.d, v.id, ohne, TAGE(31), E)));
});

test("Run: the test duration from the settings applies", () => {
  const v = vorbereitet(); alleTitel(v);
  ex.starte(v.d, { id: v.id }, v.ps, JETZT);
  assert.equal(ex.liste(v.d, v.ps, TAGE(10), { ...E, pruefungNachTagen: 7 })[0].status, "ready");
  assert.equal(ex.liste(v.d, v.ps, TAGE(10), { ...E, pruefungNachTagen: 14 })[0].status, "running");
});

// ---------- Login ----------
import * as lg from "./login.mjs";
const ldb = () => { const d = new Database(":memory:"); lg.bereiteVor(d); lg.leereVersuche(); return d; };
const PW = "ein-langes-passwort";

test("Login: creating a user checks name and password", () => {
  const d = ldb();
  for (const n of ["ab", "Ab c", "../x", "", null, 5, "x".repeat(41), "-abc"]) assert.equal(lg.legeBenutzerAn(d, n, PW).ok, false, String(n));
  assert.equal(lg.legeBenutzerAn(d, "anna", "kurz").ok, false);
  assert.equal(lg.legeBenutzerAn(d, "anna", "x".repeat(201)).ok, false);
  assert.equal(lg.legeBenutzerAn(d, "anna", 12345678901).ok, false);
  assert.equal(lg.legeBenutzerAn(d, "Anna", PW).ok, true, "capitalisation is unified");
  assert.equal(lg.legeBenutzerAn(d, "anna", PW).status, 409, "doppelter Name");
  assert.equal(lg.anzahlBenutzer(d), 1);
});

test("Login: the password is never in plain text in the database", () => {
  const d = ldb(); lg.legeBenutzerAn(d, "anna", PW);
  const b = d.prepare("SELECT * FROM benutzer").get();
  assert.ok(!JSON.stringify(b).includes(PW));
  assert.equal(b.hash.length, 128);
  lg.legeBenutzerAn(d, "ben", PW);
  const hashes = d.prepare("SELECT hash FROM benutzer").all().map((x) => x.hash);
  assert.notEqual(hashes[0], hashes[1], "gleiches Passwort, anderes Salz, anderer Hash");
});

test("Login: a correct login returns a session, the token is only in the database as a hash", () => {
  const d = ldb(); lg.legeBenutzerAn(d, "anna", PW);
  const r = lg.anmelden(d, " ANNA ", PW, JETZT);
  assert.equal(r.ok, true);
  assert.deepEqual(lg.sitzungFuer(d, r.wert.token, JETZT), { name: "anna" });
  assert.ok(!JSON.stringify(d.prepare("SELECT * FROM sitzung").all()).includes(r.wert.token));
});

test("Login: wrong password, unknown name and odd inputs are rejected, with the same message", () => {
  const d = ldb(); lg.legeBenutzerAn(d, "anna", PW);
  const a = lg.anmelden(d, "anna", "falsch-falsch", JETZT), b = lg.anmelden(d, "niemand", PW, JETZT);
  assert.equal(a.status, 401); assert.equal(b.status, 401); assert.equal(a.fehler, b.fehler);
  for (const [n, p] of [[null, PW], ["anna", null], ["anna", ""], ["anna", {}], [["anna"], PW], ["", ""], ["anna", "x".repeat(500)]]) assert.equal(lg.anmelden(d, n, p, JETZT).ok, false);
  assert.equal(d.prepare("SELECT COUNT(*) n FROM sitzung").get().n, 0);
});

test("Login: after MAX_FEHLVERSUCHE (5) failed attempts the name is locked for SPERRE_MINUTEN (15), even with the right password, then free again", () => {
  const d = ldb(); lg.legeBenutzerAn(d, "anna", PW);
  for (let i = 0; i < lg.MAX_FEHLVERSUCHE; i++) assert.equal(lg.anmelden(d, "anna", "falsch-falsch", JETZT).status, 401);
  const gesperrt = lg.anmelden(d, "anna", PW, JETZT);
  assert.equal(gesperrt.status, 429); assert.match(gesperrt.fehler, new RegExp(`${lg.SPERRE_MINUTEN} minutes`));
  assert.equal(lg.anmelden(d, "anna", PW, new Date(JETZT.getTime() + (lg.SPERRE_MINUTEN - 1) * 60000)).status, 429);
  assert.equal(lg.anmelden(d, "anna", PW, new Date(JETZT.getTime() + (lg.SPERRE_MINUTEN + 1) * 60000)).ok, true);
});

test("Login: a successful attempt resets the failure counter", () => {
  const d = ldb(); lg.legeBenutzerAn(d, "anna", PW);
  for (let i = 0; i < lg.MAX_FEHLVERSUCHE - 1; i++) lg.anmelden(d, "anna", "falsch-falsch", JETZT);
  assert.equal(lg.anmelden(d, "anna", PW, JETZT).ok, true);
  for (let i = 0; i < lg.MAX_FEHLVERSUCHE - 1; i++) assert.equal(lg.anmelden(d, "anna", "falsch-falsch", JETZT).status, 401);
});

test("Login: a session expires after 12 hours, logging out ends it at once, an invented token is not valid", () => {
  const d = ldb(); lg.legeBenutzerAn(d, "anna", PW);
  const t = lg.anmelden(d, "anna", PW, JETZT).wert.token;
  assert.ok(lg.sitzungFuer(d, t, new Date(JETZT.getTime() + 11 * 3600e3)));
  assert.equal(lg.sitzungFuer(d, t, new Date(JETZT.getTime() + 12 * 3600e3)), null);
  for (const x of [null, undefined, "", "abc", {}, "x".repeat(200), t + "x"]) assert.equal(lg.sitzungFuer(d, x, JETZT), null);
  const t2 = lg.anmelden(d, "anna", PW, JETZT).wert.token;
  lg.abmelden(d, t2);
  assert.equal(lg.sitzungFuer(d, t2, JETZT), null);
  assert.doesNotThrow(() => lg.abmelden(d, null));
});

test("Login: a new password ends old sessions, the old password no longer works", () => {
  const d = ldb(); lg.legeBenutzerAn(d, "anna", PW);
  const t = lg.anmelden(d, "anna", PW, JETZT).wert.token;
  assert.equal(lg.setzePasswort(d, "anna", "kurz").ok, false);
  assert.equal(lg.setzePasswort(d, "niemand", "ein-neues-passwort").status, 404);
  assert.equal(lg.setzePasswort(d, "anna", "ein-neues-passwort").ok, true);
  assert.equal(lg.sitzungFuer(d, t, JETZT), null);
  assert.equal(lg.anmelden(d, "anna", PW, JETZT).status, 401);
  assert.equal(lg.anmelden(d, "anna", "ein-neues-passwort", JETZT).ok, true);
});

test("Login: the cookie is read and is HttpOnly, SameSite=Strict, Secure over HTTPS", () => {
  assert.equal(lg.tokenAusCookie("a=1; sitzung=abc123; b=2"), "abc123");
  assert.equal(lg.tokenAusCookie("xsitzung=zzz"), null);
  assert.equal(lg.tokenAusCookie(undefined), null);
  const c = lg.cookie("tok", false); assert.match(c, /HttpOnly/); assert.match(c, /SameSite=Strict/); assert.doesNotMatch(c, /Secure/);
  assert.match(lg.cookie("tok", true), /; Secure/);
  assert.match(lg.cookie("", true, 0), /Max-Age=0/);
});

// ---------- Lock per address and change password ----------
test("Login: lock per address across all names, other addresses and the right name stay untouched", () => {
  const d = ldb(); lg.legeBenutzerAn(d, "anna", PW);
  for (let i = 0; i < lg.MAX_FEHLVERSUCHE_IP; i++) assert.equal(lg.anmelden(d, "name" + i, "falsch-falsch", JETZT, "1.2.3.4").status, 401, "every name wrong only once: no name lock");
  assert.equal(lg.anmelden(d, "anna", PW, JETZT, "1.2.3.4").status, 429, "the address is locked, even with the right password");
  assert.equal(lg.anmelden(d, "anna", PW, JETZT, "5.6.7.8").ok, true, "another address can log in");
  assert.equal(lg.anmelden(d, "anna", PW, new Date(JETZT.getTime() + (lg.SPERRE_MINUTEN + 1) * 60000), "1.2.3.4").ok, true, "free again after the lock time");
});

test("Login: changing the password checks the old one, requires a new one, ends other sessions and issues a new one", () => {
  const d = ldb(); lg.legeBenutzerAn(d, "anna", PW);
  const alt = lg.anmelden(d, "anna", PW, JETZT).wert.token;
  assert.equal(lg.aendernPasswort(d, "anna", "falsch-falsch", "ein-neues-passwort", JETZT).status, 403);
  assert.equal(lg.aendernPasswort(d, "anna", PW, "kurz", JETZT).status, 400);
  assert.equal(lg.aendernPasswort(d, "anna", PW, PW, JETZT).status, 400, "the same password is no change");
  assert.equal(lg.aendernPasswort(d, "anna", 5, "ein-neues-passwort", JETZT).status, 400);
  assert.ok(lg.sitzungFuer(d, alt, JETZT), "after errors the session is still there");
  const r = lg.aendernPasswort(d, "anna", PW, "ein-neues-passwort", JETZT);
  assert.equal(r.ok, true);
  assert.equal(lg.sitzungFuer(d, alt, JETZT), null, "alte Sitzung beendet");
  assert.ok(lg.sitzungFuer(d, r.wert.token, JETZT), "the new session is valid");
  assert.equal(lg.anmelden(d, "anna", PW, JETZT).status, 401, "the old password no longer works");
  assert.equal(lg.anmelden(d, "anna", "ein-neues-passwort", JETZT).ok, true);
  assert.equal(d.prepare("SELECT COUNT(*) n FROM sitzung").get().n, 2, "no leftover check sessions (the new one + one from the test login)");
});

test("Login: wrong old passwords when changing count as failed attempts and eventually lock", () => {
  const d = ldb(); lg.legeBenutzerAn(d, "anna", PW);
  for (let i = 0; i < lg.MAX_FEHLVERSUCHE; i++) lg.aendernPasswort(d, "anna", "falsch-falsch", "ein-neues-passwort", JETZT);
  assert.equal(lg.aendernPasswort(d, "anna", PW, "ein-neues-passwort", JETZT).status, 429);
});

// ---------- Security: password hash, limits, no customer data (checklist A3.3, A3.13) ----------
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

test("Login: the hash is scrypt (N=16384, r=8, p=1, 64 bytes) with its own 16-byte salt per user", () => {
  const d = ldb(); lg.legeBenutzerAn(d, "anna", PW);
  const b = d.prepare("SELECT salz, hash FROM benutzer WHERE name = 'anna'").get();
  assert.match(b.salz, /^[0-9a-f]{32}$/, "16 Byte Zufallssalz, hex");
  assert.equal(b.hash, crypto.scryptSync(PW, b.salz, 64, { N: 16384, r: 8, p: 1 }).toString("hex"), "the hash can be recalculated only with the salt and scrypt");
  assert.notEqual(b.hash, crypto.createHash("sha256").update(PW).digest("hex"));
});

test("Login: minimum length exactly 10 characters, lock after exactly 5 failed attempts per name and 20 per address, 15 minutes", () => {
  assert.deepEqual([lg.PASSWORT_MIN, lg.MAX_FEHLVERSUCHE, lg.MAX_FEHLVERSUCHE_IP, lg.SPERRE_MINUTEN, lg.SITZUNG_STUNDEN], [10, 5, 20, 15, 12]);
  const d = ldb();
  assert.equal(lg.legeBenutzerAn(d, "anna", "x".repeat(9)).status, 400, "9 characters are too short");
  assert.equal(lg.legeBenutzerAn(d, "anna", "x".repeat(10)).ok, true, "10 Zeichen reichen");
  assert.equal(lg.setzePasswort(d, "anna", "y".repeat(9)).status, 400);
  assert.equal(lg.aendernPasswort(d, "anna", "x".repeat(10), "y".repeat(9), JETZT).status, 400);
  for (let i = 0; i < 4; i++) assert.equal(lg.anmelden(d, "anna", "falsch-falsch", JETZT).status, 401);
  assert.equal(lg.anmelden(d, "anna", "falsch-falsch", JETZT).status, 401, "the 5th failed attempt still counts normally");
  assert.equal(lg.anmelden(d, "anna", "x".repeat(10), JETZT).status, 429, "ab jetzt gesperrt");
});

test("No customer data: pm.db has no columns for buyers, and the export reads only item, quantity, price, date from orders", () => {
  const wurzel = path.join(import.meta.dirname, "..");
  const pm = new Database(path.join(wurzel, "daten-team", "pm.db"), { readonly: true });
  const spalten = pm.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()
    .flatMap((t) => pm.prepare(`PRAGMA table_info(${t.name})`).all().map((c) => `${t.name}.${c.name}`));
  pm.close();
  assert.ok(spalten.length > 10);
  const verdaechtig = /buyer|kaeufer|käufer|kunde|customer|e?mail|adress|address|strasse|street|phone|telefon|plz|zip|order|bestell|user|name/i;
  assert.deepEqual(spalten.filter((s) => verdaechtig.test(s.split(".")[1])), [], "no column with a reference to persons or orders");
  // export-ebay.mjs: in verkaeufe() only these fields are read from an order (o) and its items (li)
  const q = fs.readFileSync(path.join(wurzel, "app", "export-ebay.mjs"), "utf8");
  const fn = q.slice(q.indexOf("async function verkaeufe("), q.indexOf("\n}", q.indexOf("async function verkaeufe(")));
  const felder = [...new Set([...fn.matchAll(/\b(o|li)\.(\w+)/g)].map((m) => `${m[1]}.${m[2]}`))].sort();
  assert.deepEqual(felder, ["li.legacyItemId", "li.lineItemCost", "li.quantity", "o.creationDate", "o.lineItems"]);
  const code = q.split(/\r?\n/).filter((z) => !/^\s*\/\//.test(z)).join("\n");
  assert.doesNotMatch(code, /buyer|shippingAddress|fulfillmentStartInstructions|contactAddress|email/i, "no buyer fields in the export code");
});

// Whoever follows the README copies .env.beispiel to .env. If a value is in there it applies: on 20 Nov PM_DB=daten/pm.db pointed to a
// file that does not exist in a fresh clone, and the app stayed empty instead of taking the team copy (README blind test, #20).
test(".env.beispiel: after copying, the app starts with the team copy, without credentials and without a write switch", async () => {
  const fs = await import("node:fs");
  const werte = Object.fromEntries(fs.readFileSync(new URL("../.env.beispiel", import.meta.url), "utf8").split(/\r?\n/)
    .map((z) => z.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].trim()]));
  assert.equal(werte.PM_DB, "", "PM_DB empty, otherwise the team copy is not used");
  for (const k of Object.keys(werte).filter((k) => /KEY|TOKEN|SECRET|CERT|APP_ID|DEV_ID|AUD/.test(k))) assert.equal(werte[k], "", k + " muss leer sein");
  for (const k of ["EBAY_SCHREIBEN", "EBAY_WERBUNG", "EBAY_PREIS"]) assert.notEqual(werte[k], "an", k + " darf in der Vorlage nicht an sein");
  assert.ok(fs.existsSync(new URL("../daten-team/pm.db", import.meta.url)), "the team copy is in the repo");
});
