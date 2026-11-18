// Tests: npm test  (Node-eigener Test-Runner, keine zusätzlichen Pakete)
import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { bewerte, conversion, klickrate, leiteSchwellenAb, EINSTELLUNGEN, GRUPPEN } from "./regeln.mjs";
import * as einst from "./einstellungen.mjs";
import * as ex from "./experimente.mjs";
import { baueBewertung } from "./bewertung.mjs";

const JETZT = new Date("2026-11-10T12:00:00Z");
const alt = "2025-12-01T10:00:00.000Z"; // deutlich älter als 90 Tage
const TAGE = (d) => new Date(JETZT.getTime() + d * 86400000);
// Standard: Angebot mit genug Impressionen
const p = (o) => ({ created_at: alt, title: "Wandhalter passend für Test", units_90d: 5, units_total: 20, aufrufe_90d: 200, impressionen_90d: 10000, ...o });
const bereich = (o, e = EINSTELLUNGEN) => bewerte(p(o), e, JETZT).gruppe;
const db = () => { const d = new Database(":memory:"); einst.bereiteVor(d); ex.bereiteVor(d); return d; };

// ---------- Diagnose: drei Bereiche ----------
test("Diagnose: es gibt genau drei Bereiche mit klarer Empfehlung", () => {
  assert.deepEqual(Object.keys(GRUPPEN), ["sichtbarkeit", "ok", "warten"]);
  for (const g of Object.values(GRUPPEN)) assert.ok(g.label && g.empfehlung && g.regel);
});

test("Diagnose: wenig Impressionen, Grenze bei genau 2.000 (Rückfallwert)", () => {
  assert.equal(bereich({ impressionen_90d: 1999 }), "sichtbarkeit");
  assert.equal(bereich({ impressionen_90d: 2000 }), "ok");
  assert.equal(bewerte(p({ impressionen_90d: 100 }), EINSTELLUNGEN, JETZT).empfehlung, "Improve the title");
});

test("Diagnose: auch verkaufende Angebote mit wenig Impressionen gehören dazu, mit Hinweis", () => {
  const r = bewerte(p({ units_90d: 5, impressionen_90d: 1500 }), EINSTELLUNGEN, JETZT);
  assert.equal(r.gruppe, "sichtbarkeit");
  assert.match(r.begruendung, /already sells \(5 sales/);
  assert.match(bewerte(p({ units_90d: 1, impressionen_90d: 1500 }), EINSTELLUNGEN, JETZT).begruendung, /\(1 sale in 90 days\)/);
  assert.match(bewerte(p({ units_90d: 0, impressionen_90d: 1500 }), EINSTELLUNGEN, JETZT).begruendung, /Too few buyers see this listing/);
});

test("Diagnose: neue Angebote und Angebote ohne Zahlen bekommen 'Wait', nie eine Abwertung", () => {
  assert.equal(bereich({ created_at: "2026-10-20T10:00:00.000Z", impressionen_90d: 5 }), "warten");
  assert.equal(bereich({ impressionen_90d: null }), "warten");
  const grenze = new Date(JETZT.getTime() - 90 * 86400000).toISOString();
  assert.notEqual(bereich({ created_at: grenze, impressionen_90d: 5 }), "warten"); // genau an der Grenze nicht mehr neu
  assert.equal(bereich({ created_at: "kein Datum", impressionen_90d: 5 }), "sichtbarkeit"); // kaputtes Datum stürzt nicht ab
});

test("Diagnose: null Impressionen teilt nicht durch 0 und bleibt Low impressions", () => {
  assert.equal(bereich({ impressionen_90d: 0, aufrufe_90d: 0, units_90d: 0 }), "sichtbarkeit");
  assert.equal(conversion({ units_90d: 3, aufrufe_90d: 0 }), null);
  assert.equal(klickrate({ aufrufe_90d: 5, impressionen_90d: 0 }), null);
  assert.equal(klickrate({ aufrufe_90d: 5, impressionen_90d: 1000 }), 0.005);
});

test("Grenze: unteres Viertel wird aus dem Shop berechnet, neue Angebote zählen nicht mit", () => {
  const viele = Array.from({ length: 100 }, (_, i) => ({ created_at: alt, impressionen_90d: (i + 1) * 100 }));
  const neu = Array.from({ length: 50 }, () => ({ created_at: "2026-11-01T00:00:00.000Z", impressionen_90d: 1 }));
  assert.equal(leiteSchwellenAb([...viele, ...neu], EINSTELLUNGEN, JETZT).wenigImpressionen90d, 2500);
  assert.equal(leiteSchwellenAb([...viele, ...neu], { ...EINSTELLUNGEN, anteilUnten: 0.1 }, JETZT).wenigImpressionen90d, 1000);
});

test("Grenze: Modus 'feste Zahl' nimmt die Zahl aus den Einstellungen, zu wenig Daten behalten den Rückfallwert", () => {
  const viele = Array.from({ length: 100 }, (_, i) => ({ created_at: alt, impressionen_90d: (i + 1) * 100 }));
  assert.equal(leiteSchwellenAb(viele, { ...EINSTELLUNGEN, modus: "fest", festeGrenze: 777 }, JETZT).wenigImpressionen90d, 777);
  assert.equal(leiteSchwellenAb([{ created_at: alt, impressionen_90d: 5 }], EINSTELLUNGEN, JETZT).wenigImpressionen90d, EINSTELLUNGEN.wenigImpressionen90d);
  // die Begründung nennt den Maßstab der gewählten Einstellung
  assert.match(bewerte(p({ impressionen_90d: 10 }), { ...EINSTELLUNGEN, modus: "fest", festeGrenze: 777, wenigImpressionen90d: 777 }, JETZT).begruendung, /your limit: under 777/);
  assert.match(bewerte(p({ impressionen_90d: 10 }), EINSTELLUNGEN, JETZT).begruendung, /lowest 25 % of the shop/);
});

test("Auswertung: Übersicht zählt alle Angebote genau einmal und kennzeichnet Angebote in Tests", () => {
  const ps = [{ number: "1", ...p({ impressionen_90d: 10000 }) }, { number: "2", ...p({ impressionen_90d: 10 }) }, { number: "3", ...p({ created_at: "2026-11-01T00:00:00.000Z" }) }];
  const b = baueBewertung(ps, EINSTELLUNGEN, JETZT, new Map([["2", { id: 7, gruppe: "test", status: "laeuft" }]]));
  assert.equal(Object.values(b.uebersicht).reduce((a, c) => a + c, 0), 3);
  assert.deepEqual(b.uebersicht, { sichtbarkeit: 1, ok: 1, warten: 1 });
  assert.equal(b.produkte.find((x) => x.number === "2").imTest.id, 7);
  assert.equal(b.produkte.find((x) => x.number === "1").imTest, null);
});

// ---------- Einstellungen ----------
test("Einstellungen: Startwerte, Speichern, Überschreiben, Zurücksetzen", () => {
  const d = db();
  assert.equal(einst.effektiv(d).anteilUnten, 0.25);
  assert.equal(einst.speichere(d, { anteilUnten: 0.1, schonfristTage: 60 }).ok, true);
  assert.equal(einst.effektiv(d).anteilUnten, 0.1);
  assert.equal(einst.effektiv(d).schonfristTage, 60);
  assert.equal(einst.effektiv(d).testGroesse, 40); // unberührt
  einst.speichere(d, { anteilUnten: 0.3 });
  assert.equal(einst.effektiv(d).anteilUnten, 0.3);   // überschrieben, nicht doppelt
  assert.equal(d.prepare("SELECT COUNT(*) c FROM einstellung WHERE key = 'anteilUnten'").get().c, 1);
  einst.zuruecksetzen(d);
  assert.equal(einst.effektiv(d).anteilUnten, 0.25);
  assert.equal(d.prepare("SELECT COUNT(*) c FROM einstellung").get().c, 0);
});

test("Einstellungen: ungültige Werte werden abgelehnt und nichts wird gespeichert", () => {
  const d = db();
  const abgelehnt = (e, muster) => { const r = einst.speichere(d, e); assert.equal(r.ok, false); assert.match(r.fehler, muster); };
  abgelehnt({ anteilUnten: 0.9 }, /between 5 and 50/);        // zu groß
  abgelehnt({ anteilUnten: 0.01 }, /between 5 and 50/);       // zu klein
  abgelehnt({ anteilUnten: "25" }, /enter a number/);         // falscher Typ
  abgelehnt({ anteilUnten: NaN }, /enter a number/);
  abgelehnt({ anteilUnten: Infinity }, /enter a number/);
  abgelehnt({ schonfristTage: 1.5 }, /whole number/);
  abgelehnt({ schonfristTage: -1 }, /between 0 and 365/);
  abgelehnt({ testGroesse: 41 }, /even number/);
  abgelehnt({ testGroesse: 2 }, /between 4 and 200/);
  abgelehnt({ modus: "egal" }, /choose one of the options/);
  abgelehnt({ modus: "toString" }, /choose one of the options/);
  abgelehnt({ gibtEsNicht: 1 }, /Unknown setting/);
  abgelehnt({ constructor: 1 }, /Unknown setting/);
  abgelehnt({ toString: 1 }, /Unknown setting/);
  abgelehnt({}, /Nothing to save/);
  assert.equal(einst.speichere(d, null).ok, false);
  assert.equal(einst.speichere(d, [1]).ok, false);
  // ein Fehler in einem Feld verhindert das Speichern der anderen Felder derselben Anfrage
  assert.equal(einst.speichere(d, { schonfristTage: 30, anteilUnten: 5 }).ok, false);
  assert.equal(einst.effektiv(d).schonfristTage, 90);
  assert.equal(d.prepare("SELECT COUNT(*) c FROM einstellung").get().c, 0);
});

test("Einstellungen: Grenzwerte sind erlaubt, Prozentwerte mit Rundungsfehlern auch", () => {
  const d = db();
  assert.equal(einst.speichere(d, { anteilUnten: 0.05 }).ok, true);
  assert.equal(einst.speichere(d, { anteilUnten: 0.5 }).ok, true);
  assert.equal(einst.speichere(d, { anteilUnten: 0.07 }).ok, true);
  assert.equal(einst.speichere(d, { testGroesse: 4 }).ok, true);
  assert.equal(einst.speichere(d, { modus: "fest", festeGrenze: 1 }).ok, true);
});

test("Einstellungen: kaputte oder veraltete gespeicherte Einträge werden ignoriert", () => {
  const d = db();
  d.prepare("INSERT INTO einstellung VALUES ('anteilUnten', '99')").run();      // ungültig
  d.prepare("INSERT INTO einstellung VALUES ('schonfristTage', 'kaputt{')").run(); // kein JSON
  d.prepare("INSERT INTO einstellung VALUES ('alteRegel', '5')").run();         // unbekannt
  d.prepare("INSERT INTO einstellung VALUES ('testGroesse', '20')").run();      // gültig
  const e = einst.effektiv(d);
  assert.equal(e.anteilUnten, 0.25); assert.equal(e.schonfristTage, 90); assert.equal(e.testGroesse, 20);
  assert.equal(Object.hasOwn(e, "alteRegel"), false);
});

test("Einstellungen: jedes Schema-Feld hat Beschriftung, Erklärung, einen gültigen Startwert und einen Abschnitt", () => {
  const abschnitte = new Set(einst.ABSCHNITTE.map((a) => a.id));
  for (const f of einst.SCHEMA) {
    assert.ok(f.label && f.hilfe, `Feld ${f.key} ohne Text`);
    assert.ok(abschnitte.has(f.abschnitt));
    assert.equal(einst.pruefeWert(f, einst.STANDARD[f.key]), null, `Startwert von ${f.key} ist ungültig`);
  }
});

test("Einstellungen: der Modus steuert die Grenze der Diagnose", () => {
  const d = db();
  einst.speichere(d, { modus: "fest", festeGrenze: 5000 });
  const e = leiteSchwellenAb([], einst.effektiv(d), JETZT);
  assert.equal(bereich({ impressionen_90d: 4999 }, e), "sichtbarkeit");
  assert.equal(bereich({ impressionen_90d: 5000 }, e), "ok");
});

// ---------- Tests (Experimente) ----------
// 60 Angebote mit wenig Impressionen, 20 mit vielen, 5 neue
const shop = () => [
  ...Array.from({ length: 60 }, (_, i) => ({ number: "L" + String(i).padStart(2, "0"), title: "Niedrig " + i, ...p({ impressionen_90d: 100 + i, impressionen_30d: 30, aufrufe_30d: 3, transaktionen_30d: 1, image_url: "https://x/" + i + ".jpg", avg_price: 5 }) })),
  ...Array.from({ length: 20 }, (_, i) => ({ number: "H" + i, title: "Hoch " + i, ...p({ impressionen_90d: 50000, impressionen_30d: 10000 }) })),
  ...Array.from({ length: 5 }, (_, i) => ({ number: "N" + i, title: "Neu " + i, ...p({ created_at: "2026-11-01T00:00:00.000Z", impressionen_90d: 5 }) })),
];
// feste Grenze, damit alle 60 "Niedrig"-Angebote in Frage kommen (im Standard gilt das untere Viertel des Shops)
const E = { ...EINSTELLUNGEN, testGroesse: 40, modus: "fest", festeGrenze: 1000 };

test("Los: gleicher Zufallswert gibt dieselbe Ziehung, ein anderer eine andere", () => {
  const k = shop().filter((x) => x.number.startsWith("L"));
  const a = ex.ziehe(k, 20, 42), b = ex.ziehe(k, 20, 42), c = ex.ziehe(k, 20, 43);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a.test.map((x) => x.number), c.test.map((x) => x.number));
});

test("Los: je zur Hälfte Test und Kontrolle, ohne Überschneidung und ohne Doppelte", () => {
  const k = shop().filter((x) => x.number.startsWith("L"));
  for (const seed of [1, 2, 3, 99, 12345]) {
    const { test: t, kontrolle: c } = ex.ziehe(k, 40, seed);
    assert.equal(t.length, 20); assert.equal(c.length, 20);
    assert.equal(new Set([...t, ...c].map((x) => x.number)).size, 40);
  }
});

test("Los: es ist wirklich zufällig verteilt (kein Angebot wird immer in dieselbe Gruppe sortiert)", () => {
  const k = shop().filter((x) => x.number.startsWith("L"));
  let ersteInTest = 0;
  for (let seed = 1; seed <= 200; seed++) if (ex.ziehe(k, 40, seed).test.some((x) => x.number === "L00")) ersteInTest++;
  assert.ok(ersteInTest > 40 && ersteInTest < 160, `L00 war ${ersteInTest} von 200 Mal in der Testgruppe`); // erwartet etwa 33 %
});

test("Test anlegen: zieht nur aus 'Low impressions', nie neue oder gut sichtbare Angebote", () => {
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

test("Test anlegen: zu wenig passende Angebote ergibt eine verständliche Absage", () => {
  const d = db();
  const r = ex.legeAn(d, {}, shop().slice(0, 30), E, JETZT, 1);
  assert.equal(r.ok, false); assert.equal(r.status, 409);
  assert.match(r.fehler, /Not enough listings for a test: 30 available, 40 needed/);
  assert.equal(d.prepare("SELECT COUNT(*) c FROM experiment").get().c, 0);
});

test("Test anlegen: ein Angebot steckt immer nur in einem Test", () => {
  const d = db();
  assert.equal(ex.legeAn(d, {}, shop(), { ...E, testGroesse: 40 }, JETZT, 1).ok, true);      // 40 von 60 belegt
  const zweiter = ex.legeAn(d, {}, shop(), { ...E, testGroesse: 40 }, JETZT, 2);             // nur noch 20 frei
  assert.equal(zweiter.ok, false); assert.equal(zweiter.status, 409);
  assert.equal(ex.legeAn(d, {}, shop(), { ...E, testGroesse: 20 }, JETZT, 3).ok, true);      // 20 passen noch
  const nummern = d.prepare("SELECT number FROM experiment_angebot").all().map((r) => r.number);
  assert.equal(new Set(nummern).size, nummern.length);                                        // kein Angebot doppelt
  assert.equal(ex.imTest(d).size, 60);
  // nach dem Abschluss sind die Angebote wieder frei
  ex.schliesse(d, { id: 1, abschluss: "zurueck" }, JETZT);
  assert.equal(ex.imTest(d).size, 20);
  assert.equal(ex.kandidaten(d, shop(), E, JETZT).length, 40);
});

test("Test anlegen: Name wird geprüft, ohne Name gibt es einen Standardnamen", () => {
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

// vorbereiteter Test mit 40 Angeboten
function vorbereitet(e = E) {
  const d = db(); const ps = shop();
  const id = ex.legeAn(d, {}, ps, e, JETZT, 5).wert.id;
  const nummern = (g) => d.prepare("SELECT number FROM experiment_angebot WHERE experiment_id = ? AND gruppe = ? ORDER BY number").all(id, g).map((r) => r.number);
  return { d, ps, id, testNr: nummern("test"), kontrolleNr: nummern("kontrolle") };
}
const alleTitel = (v) => v.testNr.forEach((nr, i) => assert.equal(ex.setzeTitel(v.d, { id: v.id, number: nr, neu: `Besserer Titel ${i}` }, E).ok, true));

test("Titel eintragen: nur für die Testgruppe, geprüft, überschreibbar", () => {
  const v = vorbereitet();
  const t = v.testNr[0];
  assert.deepEqual(ex.setzeTitel(v.d, { id: v.id, number: t, neu: "  Neuer   Titel  " }, E).wert, { id: v.id, number: t, neu: "Neuer Titel" }); // Leerzeichen bereinigt
  assert.equal(ex.setzeTitel(v.d, { id: v.id, number: t, neu: "Noch ein Titel" }, E).ok, true);
  assert.equal(v.d.prepare("SELECT neu FROM experiment_angebot WHERE number = ?").get(t).neu, "Noch ein Titel");
  const f = (e) => ex.setzeTitel(v.d, { id: v.id, number: t, ...e }, E);
  assert.equal(f({ neu: "" }).status, 400);
  assert.equal(f({ neu: "   " }).status, 400);
  assert.equal(f({ neu: "x".repeat(81) }).status, 400);
  assert.equal(f({ neu: "x".repeat(80) }).ok, true);                         // genau 80 sind erlaubt
  assert.equal(f({ neu: "Titel\u0000mit Steuerzeichen" }).status, 400);
  assert.equal(f({ neu: 5 }).status, 400);
  assert.equal(f({ neu: v.d.prepare("SELECT alt FROM experiment_angebot WHERE number = ?").get(t).alt }).status, 400); // unverändert
  assert.equal(ex.setzeTitel(v.d, { id: v.id, number: v.kontrolleNr[0], neu: "Neuer Titel" }, E).status, 409);          // Kontrolle bleibt unverändert
  assert.equal(ex.setzeTitel(v.d, { id: v.id, number: "GIBTESNICHT", neu: "Neu" }, E).status, 404);
  assert.equal(ex.setzeTitel(v.d, { id: 999, number: t, neu: "Neu" }, E).status, 404);
  assert.equal(ex.setzeTitel(v.d, { id: "1", number: t, neu: "Neu" }, E).status, 400);
  assert.equal(ex.setzeTitel(v.d, null, E).status, 400);
});

test("Starten: erst wenn alle Testangebote einen neuen Titel haben, dann werden die Ausgangszahlen beider Gruppen festgehalten", () => {
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
  assert.equal(ex.starte(v.d, { id: v.id }, v.ps, JETZT).status, 409);                   // nicht doppelt starten
  assert.equal(ex.setzeTitel(v.d, { id: v.id, number: v.testNr[0], neu: "Spät" }, E).status, 409); // nach dem Start keine Titeländerung
});

test("Starten: verschwundene Angebote und unbekannte Tests werden abgelehnt", () => {
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

test("Urteil: Testgruppe verdoppelt sich, Kontrolle bleibt gleich -> besser", () => {
  const r = ex.urteile(G(S(1000, 50, 10), S(2000, 100, 10)), G(S(1000, 50, 10), S(1000, 50, 10)), E);
  assert.equal(r.urteil, "better"); assert.equal(r.empfehlung, "keep");
  assert.ok(Math.abs(r.primaer.netto - 1) < 1e-9);
});

test("Urteil: wächst die Kontrollgruppe genauso, ist es kein Unterschied (Saison und Zufall fallen heraus)", () => {
  const r = ex.urteile(G(S(1000, 50, 10), S(2000, 100, 20)), G(S(1000, 50, 10), S(2000, 100, 20)), E);
  assert.equal(r.urteil, "no_difference"); assert.equal(r.empfehlung, "revert"); // zählt wie "nicht besser"
});

test("Urteil: Grenze bei genau 20 % Mehr, knapp darunter ist es kein Unterschied", () => {
  const k = G(S(1000, 50, 10), S(1000, 50, 10));
  assert.equal(ex.urteile(G(S(1000, 0, 10), S(1200, 0, 10)), k, E).urteil, "better");
  assert.equal(ex.urteile(G(S(1000, 0, 10), S(1199, 0, 10)), k, E).urteil, "no_difference");
});

test("Urteil: weniger Impressionen oder zu viel weniger Verkäufe -> schlechter (Schutzkennzahl)", () => {
  const k = G(S(1000, 50, 10), S(1000, 50, 10));
  assert.equal(ex.urteile(G(S(1000, 50, 10), S(500, 25, 5)), k, E).urteil, "worse");
  const r = ex.urteile(G(S(1000, 50, 100), S(3000, 150, 20)), k, E); // dreimal so viele Impressionen, aber Verkäufe um 80 % gefallen
  assert.equal(r.urteil, "worse"); assert.equal(r.schutz.ok, false);
});

test("Urteil: zu wenig Impressionen in der Testgruppe -> es wird nicht geurteilt", () => {
  const k = G(S(10, 1, 0), S(10, 1, 0));
  assert.equal(ex.urteile(G(S(10, 1, 0), S(149, 5, 0)), k, E).urteil, "not_enough_data");
  assert.notEqual(ex.urteile(G(S(10, 1, 0), S(150, 5, 0)), k, E).urteil, "not_enough_data");
});

test("Urteil: Ausgangswert 0 und leere Kontrolle teilen nicht durch 0, das Ergebnis ist JSON-tauglich", () => {
  const r = ex.urteile(G(S(0), S(500)), G(S(0), S(0)), E);
  assert.equal(r.urteil, "better");
  assert.equal(r.primaer.netto, null);
  assert.doesNotThrow(() => JSON.stringify(r));
});

test("Urteil: die Schwellen kommen aus den Einstellungen", () => {
  const k = G(S(1000, 0, 10), S(1000, 0, 10)); const t = G(S(1000, 0, 10), S(1300, 0, 10));
  assert.equal(ex.urteile(t, k, { ...E, besserAb: 0.2 }).urteil, "better");
  assert.equal(ex.urteile(t, k, { ...E, besserAb: 0.5 }).urteil, "no_difference");
  assert.equal(ex.urteile(G(S(1000, 0, 10), S(1300, 0, 5)), k, { ...E, schutzGrenze: 0.6 }).urteil, "better");
  assert.equal(ex.urteile(G(S(1000, 0, 10), S(1300, 0, 5)), k, { ...E, schutzGrenze: 0.2 }).urteil, "worse");
});

test("Ablauf: läuft, ist nach 30 Tagen bereit, Urteil über die ganze Gruppe, Abschluss", () => {
  const v = vorbereitet(); alleTitel(v);
  ex.starte(v.d, { id: v.id }, v.ps, JETZT);
  const liste = (jetzt, ps = v.ps) => ex.liste(v.d, ps, jetzt, E)[0];
  assert.equal(liste(TAGE(10)).status, "running");
  assert.equal(liste(TAGE(10)).tage, 10);
  assert.equal(liste(TAGE(29)).status, "running");
  // nach 31 Tagen: die Testgruppe hat doppelt so viele Impressionen, alle anderen bleiben gleich
  const spaeter = v.ps.map((x) => (v.testNr.includes(x.number) ? { ...x, impressionen_30d: 60 } : x));
  const k = liste(TAGE(31), spaeter);
  assert.equal(k.status, "ready"); assert.equal(k.bereit_am, TAGE(30).toISOString().slice(0, 10));
  assert.equal(k.urteil.urteil, "better");
  assert.equal(k.urteil.test.vorher.imp, 20 * 30); assert.equal(k.urteil.test.nachher.imp, 20 * 60);
  assert.equal(k.urteil.kontrolle.vorher.imp, 20 * 30); assert.equal(k.urteil.kontrolle.nachher.imp, 20 * 30);
  // die Liste enthält nicht die einzelnen Angebote, die Detailansicht schon
  assert.equal(k.angebote, undefined);
  const dt = ex.detail(v.d, v.id, spaeter, TAGE(31), E).wert;
  assert.equal(dt.angebote.length, 40);
  assert.ok(dt.angebote.filter((a) => a.gruppe === "test").every((a) => a.neu && a.alt && a.vorher && a.nachher));
  assert.ok(dt.angebote.filter((a) => a.gruppe === "kontrolle").every((a) => !a.neu));
  assert.equal(ex.schliesse(v.d, { id: v.id, abschluss: "behalten" }, TAGE(32)).ok, true);
  assert.equal(liste(TAGE(33), spaeter).status, "closed");
  assert.equal(liste(TAGE(33), spaeter).abschluss, "behalten");
});

test("Ablauf: wächst der ganze Shop mit, ist es kein Unterschied (die Kontrollgruppe wirkt)", () => {
  const v = vorbereitet(); alleTitel(v);
  ex.starte(v.d, { id: v.id }, v.ps, JETZT);
  const sommer = v.ps.map((x) => ({ ...x, impressionen_30d: x.impressionen_30d * 2 }));
  assert.equal(ex.liste(v.d, sommer, TAGE(31), E)[0].urteil.urteil, "no_difference");
});

test("Ablauf: Test verwerfen, doppelt abschließen, ungültige Eingaben", () => {
  const v = vorbereitet();
  assert.equal(ex.schliesse(v.d, { id: v.id, abschluss: "zurueck" }, JETZT).ok, true);       // vorbereiteten Test verwerfen
  assert.equal(ex.liste(v.d, v.ps, JETZT, E)[0].urteil, null);                                 // nie gestartet: kein Urteil
  assert.equal(ex.schliesse(v.d, { id: v.id, abschluss: "behalten" }, JETZT).status, 409);
  assert.equal(ex.schliesse(v.d, { id: 99, abschluss: "behalten" }, JETZT).status, 404);
  assert.equal(ex.schliesse(v.d, { id: v.id, abschluss: "löschen" }, JETZT).status, 400);
  assert.equal(ex.schliesse(v.d, { id: v.id, abschluss: "toString" }, JETZT).status, 400);
  assert.equal(ex.schliesse(v.d, { id: "1", abschluss: "behalten" }, JETZT).status, 400);
  assert.equal(ex.schliesse(v.d, null, JETZT).status, 400);
  assert.equal(ex.detail(v.d, 99, v.ps, JETZT, E).status, 404);
  assert.equal(ex.detail(v.d, NaN, v.ps, JETZT, E).status, 400);
});

test("Ablauf: verschwundene Angebote führen nicht zum Absturz, das Urteil rechnet mit den übrigen", () => {
  const v = vorbereitet(); alleTitel(v);
  ex.starte(v.d, { id: v.id }, v.ps, JETZT);
  const ohne = v.ps.filter((x) => x.number !== v.testNr[0]);
  const k = ex.liste(v.d, ohne, TAGE(31), E)[0];
  assert.equal(k.status, "ready");
  assert.equal(k.urteil.test.vorher.imp, 19 * 30);
  assert.doesNotThrow(() => JSON.stringify(ex.detail(v.d, v.id, ohne, TAGE(31), E)));
});

test("Ablauf: die Testdauer aus den Einstellungen gilt", () => {
  const v = vorbereitet(); alleTitel(v);
  ex.starte(v.d, { id: v.id }, v.ps, JETZT);
  assert.equal(ex.liste(v.d, v.ps, TAGE(10), { ...E, pruefungNachTagen: 7 })[0].status, "ready");
  assert.equal(ex.liste(v.d, v.ps, TAGE(10), { ...E, pruefungNachTagen: 14 })[0].status, "running");
});

// ---------- Login ----------
import * as lg from "./login.mjs";
const ldb = () => { const d = new Database(":memory:"); lg.bereiteVor(d); lg.leereVersuche(); return d; };
const PW = "ein-langes-passwort";

test("Login: Benutzer anlegen prüft Name und Passwort", () => {
  const d = ldb();
  for (const n of ["ab", "Ab c", "../x", "", null, 5, "x".repeat(41), "-abc"]) assert.equal(lg.legeBenutzerAn(d, n, PW).ok, false, String(n));
  assert.equal(lg.legeBenutzerAn(d, "anna", "kurz").ok, false);
  assert.equal(lg.legeBenutzerAn(d, "anna", "x".repeat(201)).ok, false);
  assert.equal(lg.legeBenutzerAn(d, "anna", 12345678901).ok, false);
  assert.equal(lg.legeBenutzerAn(d, "Anna", PW).ok, true, "Großschreibung wird vereinheitlicht");
  assert.equal(lg.legeBenutzerAn(d, "anna", PW).status, 409, "doppelter Name");
  assert.equal(lg.anzahlBenutzer(d), 1);
});

test("Login: das Passwort steht nie im Klartext in der Datenbank", () => {
  const d = ldb(); lg.legeBenutzerAn(d, "anna", PW);
  const b = d.prepare("SELECT * FROM benutzer").get();
  assert.ok(!JSON.stringify(b).includes(PW));
  assert.equal(b.hash.length, 128);
  lg.legeBenutzerAn(d, "ben", PW);
  const hashes = d.prepare("SELECT hash FROM benutzer").all().map((x) => x.hash);
  assert.notEqual(hashes[0], hashes[1], "gleiches Passwort, anderes Salz, anderer Hash");
});

test("Login: richtige Anmeldung liefert Sitzung, das Token steht nur als Hash in der Datenbank", () => {
  const d = ldb(); lg.legeBenutzerAn(d, "anna", PW);
  const r = lg.anmelden(d, " ANNA ", PW, JETZT);
  assert.equal(r.ok, true);
  assert.deepEqual(lg.sitzungFuer(d, r.wert.token, JETZT), { name: "anna" });
  assert.ok(!JSON.stringify(d.prepare("SELECT * FROM sitzung").all()).includes(r.wert.token));
});

test("Login: falsches Passwort, unbekannter Name und seltsame Eingaben werden abgelehnt, mit gleicher Meldung", () => {
  const d = ldb(); lg.legeBenutzerAn(d, "anna", PW);
  const a = lg.anmelden(d, "anna", "falsch-falsch", JETZT), b = lg.anmelden(d, "niemand", PW, JETZT);
  assert.equal(a.status, 401); assert.equal(b.status, 401); assert.equal(a.fehler, b.fehler);
  for (const [n, p] of [[null, PW], ["anna", null], ["anna", ""], ["anna", {}], [["anna"], PW], ["", ""], ["anna", "x".repeat(500)]]) assert.equal(lg.anmelden(d, n, p, JETZT).ok, false);
  assert.equal(d.prepare("SELECT COUNT(*) n FROM sitzung").get().n, 0);
});

test("Login: nach 5 Fehlversuchen ist der Name gesperrt, auch mit richtigem Passwort, dann wieder frei", () => {
  const d = ldb(); lg.legeBenutzerAn(d, "anna", PW);
  for (let i = 0; i < 5; i++) assert.equal(lg.anmelden(d, "anna", "falsch-falsch", JETZT).status, 401);
  assert.equal(lg.anmelden(d, "anna", PW, JETZT).status, 429);
  assert.equal(lg.anmelden(d, "anna", PW, new Date(JETZT.getTime() + 14 * 60000)).status, 429);
  assert.equal(lg.anmelden(d, "anna", PW, new Date(JETZT.getTime() + 16 * 60000)).ok, true);
});

test("Login: ein erfolgreicher Versuch setzt den Fehlerzähler zurück", () => {
  const d = ldb(); lg.legeBenutzerAn(d, "anna", PW);
  for (let i = 0; i < 4; i++) lg.anmelden(d, "anna", "falsch-falsch", JETZT);
  assert.equal(lg.anmelden(d, "anna", PW, JETZT).ok, true);
  for (let i = 0; i < 4; i++) assert.equal(lg.anmelden(d, "anna", "falsch-falsch", JETZT).status, 401);
});

test("Login: Sitzung läuft nach 12 Stunden ab, Abmelden beendet sie sofort, ein erfundenes Token gilt nicht", () => {
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

test("Login: neues Passwort beendet alte Sitzungen, das alte Passwort gilt nicht mehr", () => {
  const d = ldb(); lg.legeBenutzerAn(d, "anna", PW);
  const t = lg.anmelden(d, "anna", PW, JETZT).wert.token;
  assert.equal(lg.setzePasswort(d, "anna", "kurz").ok, false);
  assert.equal(lg.setzePasswort(d, "niemand", "ein-neues-passwort").status, 404);
  assert.equal(lg.setzePasswort(d, "anna", "ein-neues-passwort").ok, true);
  assert.equal(lg.sitzungFuer(d, t, JETZT), null);
  assert.equal(lg.anmelden(d, "anna", PW, JETZT).status, 401);
  assert.equal(lg.anmelden(d, "anna", "ein-neues-passwort", JETZT).ok, true);
});

test("Login: Cookie wird gelesen und ist HttpOnly, SameSite=Strict, bei HTTPS Secure", () => {
  assert.equal(lg.tokenAusCookie("a=1; sitzung=abc123; b=2"), "abc123");
  assert.equal(lg.tokenAusCookie("xsitzung=zzz"), null);
  assert.equal(lg.tokenAusCookie(undefined), null);
  const c = lg.cookie("tok", false); assert.match(c, /HttpOnly/); assert.match(c, /SameSite=Strict/); assert.doesNotMatch(c, /Secure/);
  assert.match(lg.cookie("tok", true), /; Secure/);
  assert.match(lg.cookie("", true, 0), /Max-Age=0/);
});

// ---------- Sperre je Adresse und Passwort ändern ----------
test("Login: Sperre je Adresse über alle Namen, andere Adressen und der richtige Name bleiben unberührt", () => {
  const d = ldb(); lg.legeBenutzerAn(d, "anna", PW);
  for (let i = 0; i < lg.MAX_FEHLVERSUCHE_IP; i++) assert.equal(lg.anmelden(d, "name" + i, "falsch-falsch", JETZT, "1.2.3.4").status, 401, "jeder Name nur einmal falsch: keine Namenssperre");
  assert.equal(lg.anmelden(d, "anna", PW, JETZT, "1.2.3.4").status, 429, "die Adresse ist gesperrt, auch mit richtigem Passwort");
  assert.equal(lg.anmelden(d, "anna", PW, JETZT, "5.6.7.8").ok, true, "eine andere Adresse kann sich anmelden");
  assert.equal(lg.anmelden(d, "anna", PW, new Date(JETZT.getTime() + 16 * 60000), "1.2.3.4").ok, true, "nach der Sperrzeit wieder frei");
});

test("Login: Passwort ändern prüft das alte, verlangt ein neues, beendet andere Sitzungen und gibt eine neue", () => {
  const d = ldb(); lg.legeBenutzerAn(d, "anna", PW);
  const alt = lg.anmelden(d, "anna", PW, JETZT).wert.token;
  assert.equal(lg.aendernPasswort(d, "anna", "falsch-falsch", "ein-neues-passwort", JETZT).status, 403);
  assert.equal(lg.aendernPasswort(d, "anna", PW, "kurz", JETZT).status, 400);
  assert.equal(lg.aendernPasswort(d, "anna", PW, PW, JETZT).status, 400, "dasselbe Passwort ist keine Änderung");
  assert.equal(lg.aendernPasswort(d, "anna", 5, "ein-neues-passwort", JETZT).status, 400);
  assert.ok(lg.sitzungFuer(d, alt, JETZT), "nach Fehlern ist die Sitzung noch da");
  const r = lg.aendernPasswort(d, "anna", PW, "ein-neues-passwort", JETZT);
  assert.equal(r.ok, true);
  assert.equal(lg.sitzungFuer(d, alt, JETZT), null, "alte Sitzung beendet");
  assert.ok(lg.sitzungFuer(d, r.wert.token, JETZT), "neue Sitzung gilt");
  assert.equal(lg.anmelden(d, "anna", PW, JETZT).status, 401, "altes Passwort gilt nicht mehr");
  assert.equal(lg.anmelden(d, "anna", "ein-neues-passwort", JETZT).ok, true);
  assert.equal(d.prepare("SELECT COUNT(*) n FROM sitzung").get().n, 2, "keine liegengebliebenen Prüf-Sitzungen (neue + eine vom Test-Login)");
});

test("Login: falsche alte Passwörter beim Ändern zählen als Fehlversuche und sperren irgendwann", () => {
  const d = ldb(); lg.legeBenutzerAn(d, "anna", PW);
  for (let i = 0; i < 5; i++) lg.aendernPasswort(d, "anna", "falsch-falsch", "ein-neues-passwort", JETZT);
  assert.equal(lg.aendernPasswort(d, "anna", PW, "ein-neues-passwort", JETZT).status, 429);
});

// ---------- Sicherheit: Passwort-Hash, Grenzen, keine Kundendaten (Checkliste A3.3, A3.13) ----------
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

test("Login: Hash ist scrypt (N=16384, r=8, p=1, 64 Byte) mit eigenem 16-Byte-Salz je Benutzer", () => {
  const d = ldb(); lg.legeBenutzerAn(d, "anna", PW);
  const b = d.prepare("SELECT salz, hash FROM benutzer WHERE name = 'anna'").get();
  assert.match(b.salz, /^[0-9a-f]{32}$/, "16 Byte Zufallssalz, hex");
  assert.equal(b.hash, crypto.scryptSync(PW, b.salz, 64, { N: 16384, r: 8, p: 1 }).toString("hex"), "Hash lässt sich nur mit Salz und scrypt nachrechnen");
  assert.notEqual(b.hash, crypto.createHash("sha256").update(PW).digest("hex"));
});

test("Login: Mindestlänge genau 10 Zeichen, Sperre nach genau 5 Fehlversuchen je Name und 20 je Adresse, 15 Minuten", () => {
  assert.deepEqual([lg.PASSWORT_MIN, lg.MAX_FEHLVERSUCHE, lg.MAX_FEHLVERSUCHE_IP, lg.SPERRE_MINUTEN, lg.SITZUNG_STUNDEN], [10, 5, 20, 15, 12]);
  const d = ldb();
  assert.equal(lg.legeBenutzerAn(d, "anna", "x".repeat(9)).status, 400, "9 Zeichen sind zu kurz");
  assert.equal(lg.legeBenutzerAn(d, "anna", "x".repeat(10)).ok, true, "10 Zeichen reichen");
  assert.equal(lg.setzePasswort(d, "anna", "y".repeat(9)).status, 400);
  assert.equal(lg.aendernPasswort(d, "anna", "x".repeat(10), "y".repeat(9), JETZT).status, 400);
  for (let i = 0; i < 4; i++) assert.equal(lg.anmelden(d, "anna", "falsch-falsch", JETZT).status, 401);
  assert.equal(lg.anmelden(d, "anna", "falsch-falsch", JETZT).status, 401, "der 5. Fehlversuch zählt noch normal");
  assert.equal(lg.anmelden(d, "anna", "x".repeat(10), JETZT).status, 429, "ab jetzt gesperrt");
});

test("Keine Kundendaten: pm.db hat keine Spalten für Käufer, und der Export liest aus Bestellungen nur Artikel, Menge, Preis, Datum", () => {
  const wurzel = path.join(import.meta.dirname, "..");
  const pm = new Database(path.join(wurzel, "daten-team", "pm.db"), { readonly: true });
  const spalten = pm.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()
    .flatMap((t) => pm.prepare(`PRAGMA table_info(${t.name})`).all().map((c) => `${t.name}.${c.name}`));
  pm.close();
  assert.ok(spalten.length > 10);
  const verdaechtig = /buyer|kaeufer|käufer|kunde|customer|e?mail|adress|address|strasse|street|phone|telefon|plz|zip|order|bestell|user|name/i;
  assert.deepEqual(spalten.filter((s) => verdaechtig.test(s.split(".")[1])), [], "keine Spalte mit Personen- oder Bestellbezug");
  // export-ebay.mjs: in verkaeufe() werden von einer Bestellung (o) und ihren Positionen (li) nur diese Felder gelesen
  const q = fs.readFileSync(path.join(wurzel, "app", "export-ebay.mjs"), "utf8");
  const fn = q.slice(q.indexOf("async function verkaeufe("), q.indexOf("\n}", q.indexOf("async function verkaeufe(")));
  const felder = [...new Set([...fn.matchAll(/\b(o|li)\.(\w+)/g)].map((m) => `${m[1]}.${m[2]}`))].sort();
  assert.deepEqual(felder, ["li.legacyItemId", "li.lineItemCost", "li.quantity", "o.creationDate", "o.lineItems"]);
  const code = q.split(/\r?\n/).filter((z) => !/^\s*\/\//.test(z)).join("\n");
  assert.doesNotMatch(code, /buyer|shippingAddress|fulfillmentStartInstructions|contactAddress|email/i, "keine Käuferfelder im Export-Code");
});
