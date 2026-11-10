// Tests: npm test  (Node-eigener Test-Runner, keine zusätzlichen Pakete)
import test from "node:test";
import assert from "node:assert/strict";
import { bewerte, conversion, klickrate, leiteSchwellenAb, EINSTELLUNGEN, GRUPPEN, AKTIONEN } from "./regeln.mjs";
import { lerneTitelWoerter, schlageVor, neuerTitel, zerlegeTitel } from "./vorschlaege.mjs";
import * as prot from "./protokoll.mjs";
import * as ent from "./entscheidungen.mjs";
import { baueBewertung } from "./bewertung.mjs";

const JETZT = new Date("2026-11-10T12:00:00Z");
const alt = "2025-12-01T10:00:00.000Z"; // deutlich älter als 90 Tage
// Standard: gut laufendes Produkt (5 Verkäufe, 200 Aufrufe = 2,5 %, 10.000 Impressionen)
const p = (o) => ({ created_at: alt, title: "Wandhalter passend für Test", units_90d: 5, units_total: 20, aufrufe_90d: 200, impressionen_90d: 10000, ...o });
const gruppe = (o) => bewerte(p(o), EINSTELLUNGEN, JETZT).gruppe;

// ---------- Baum: oberste Stufen ----------
test("Baum: neues Produkt wird nie als schlecht eingestuft", () => {
  const r = bewerte(p({ created_at: "2026-10-20T10:00:00.000Z", units_90d: 0, units_total: 0, aufrufe_90d: 0, impressionen_90d: 0 }), EINSTELLUNGEN, JETZT);
  assert.equal(r.gruppe, "neu");
  assert.equal(r.empfehlung, "beobachten");
});

test("Baum: genau an der Schonfrist-Grenze ist ein Produkt nicht mehr neu", () => {
  const grenze = new Date(JETZT.getTime() - 90 * 86400000).toISOString();
  assert.notEqual(gruppe({ created_at: grenze, units_90d: 0, units_total: 0, aufrufe_90d: 0 }), "neu");
});

test("Baum: Top ab 30 Verkäufen, 29 sind nicht Top", () => {
  assert.equal(gruppe({ units_90d: 30, aufrufe_90d: 400 }), "top");
  assert.equal(gruppe({ units_90d: 29, aufrufe_90d: 400 }), "normal");
});

test("Baum: fehlende Impressionen oder Aufrufe führen nicht zu einer Abwertung", () => {
  assert.equal(gruppe({ units_90d: 0, units_total: 0, impressionen_90d: null }), "ohne_daten");
  assert.equal(gruppe({ units_90d: 0, units_total: 0, aufrufe_90d: null }), "ohne_daten");
});

// ---------- Baum: verkaufende Produkte ----------
test("Baum: Steady seller bei genau 2 % Conversion, knapp darunter geht es in den Trichter", () => {
  assert.equal(gruppe({ units_90d: 1, aufrufe_90d: 50 }), "normal");
  assert.notEqual(gruppe({ units_90d: 1, aufrufe_90d: 51 }), "normal");
});

test("Baum: Verkäufe ohne erfasste Aufrufe stürzen nicht ab (keine Division durch 0)", () => {
  const r = bewerte(p({ units_90d: 3, aufrufe_90d: 0 }), EINSTELLUNGEN, JETZT);
  assert.equal(r.gruppe, "normal");
  assert.match(r.begruendung, /no view numbers recorded/);
});

test("Baum: Steady sellers nennen die echten Zahlen", () => {
  assert.equal(bewerte(p({ units_90d: 12, aufrufe_90d: 300 }), EINSTELLUNGEN, JETZT).begruendung, "12 sales from 300 views (4.0 %).");
});

// ---------- Baum: Trichterstufen ----------
test("Stufe 1: wenige Impressionen -> Titel und Suchbegriffe, Grenze bei 2.000", () => {
  const r = bewerte(p({ units_90d: 0, impressionen_90d: 1999, aufrufe_90d: 5 }), EINSTELLUNGEN, JETZT);
  assert.equal(r.gruppe, "sichtbarkeit");
  assert.equal(r.empfehlung, "titel");
  assert.notEqual(gruppe({ units_90d: 0, impressionen_90d: 2000, aufrufe_90d: 5 }), "sichtbarkeit");
});

test("Stufe 1: null Impressionen ist Stufe 1 und teilt nicht durch 0", () => {
  assert.equal(gruppe({ units_90d: 0, impressionen_90d: 0, aufrufe_90d: 0 }), "sichtbarkeit");
});

test("Stufe 2: genug Impressionen, aber niedrige Klickrate -> erstes Bild, Grenze bei 0,25 %", () => {
  const r = bewerte(p({ units_90d: 0, impressionen_90d: 10000, aufrufe_90d: 24 }), EINSTELLUNGEN, JETZT);
  assert.equal(r.gruppe, "klicks");
  assert.equal(r.empfehlung, "bild");
  assert.notEqual(gruppe({ units_90d: 0, impressionen_90d: 10000, aufrufe_90d: 25 }), "klicks");
});

test("Stufe 3: gesehen und geklickt, aber nicht gekauft -> Beschreibung, Maße, Versand", () => {
  const r = bewerte(p({ units_90d: 0, impressionen_90d: 10000, aufrufe_90d: 100 }), EINSTELLUNGEN, JETZT);
  assert.equal(r.gruppe, "kaufentscheidung");
  assert.equal(r.empfehlung, "angebot");
});

test("Stufe 3: bei sehr wenigen Aufrufen steht ein Hinweis auf ein schwaches Signal", () => {
  assert.match(bewerte(p({ units_90d: 0, impressionen_90d: 10000, aufrufe_90d: 29 }), EINSTELLUNGEN, JETZT).begruendung, /weak signal/);
  assert.doesNotMatch(bewerte(p({ units_90d: 0, impressionen_90d: 10000, aufrufe_90d: 100 }), EINSTELLUNGEN, JETZT).begruendung, /weak signal/);
});

test("Baum: Auslisten wird nie automatisch empfohlen", () => {
  for (const g of Object.values(GRUPPEN)) assert.notEqual(g.empfehlung, "auslisten");
  assert.ok(Object.hasOwn(AKTIONEN, "auslisten")); // bleibt aber als manuelle Wahl möglich
});

test("Baum: jede Gruppe hat eine gültige Empfehlung und Beschriftung", () => {
  for (const g of Object.values(GRUPPEN)) { assert.ok(Object.hasOwn(AKTIONEN, g.empfehlung)); assert.ok(g.label && g.regel); }
});

test("Baum: kaputte oder fehlende Werte stürzen nicht ab", () => {
  const r = bewerte({ created_at: "kein Datum", units_90d: null, aufrufe_90d: 50, impressionen_90d: 5000 }, EINSTELLUNGEN, JETZT);
  assert.ok(GRUPPEN[r.gruppe]);
  assert.equal(conversion({ units_90d: 3, aufrufe_90d: 0 }), null);
  assert.equal(conversion({ units_90d: 3, aufrufe_90d: 100 }), 0.03);
  assert.equal(klickrate({ aufrufe_90d: 5, impressionen_90d: 0 }), null);
  assert.equal(klickrate({ aufrufe_90d: 5, impressionen_90d: 1000 }), 0.005);
});

// ---------- Schwellen aus den Daten ----------
test("Schwellen: unteres Viertel wird aus dem Shop berechnet, neue Produkte zählen nicht mit", () => {
  const viele = Array.from({ length: 100 }, (_, i) => ({ created_at: alt, impressionen_90d: (i + 1) * 100, aufrufe_90d: (i + 1) * 1 }));
  const neu = Array.from({ length: 50 }, () => ({ created_at: "2026-11-01T00:00:00.000Z", impressionen_90d: 1, aufrufe_90d: 0 }));
  const e = leiteSchwellenAb([...viele, ...neu], EINSTELLUNGEN, JETZT);
  assert.equal(e.wenigImpressionen90d, 2500);          // 25. Perzentil von 100..10000 (ohne die neuen)
  assert.ok(Math.abs(e.schwacheKlickrate - 0.01) < 1e-9); // Klickrate ist überall 1 %
});

test("Schwellen: bei zu wenig Daten bleiben die Rückfallwerte", () => {
  const e = leiteSchwellenAb([{ created_at: alt, impressionen_90d: 5, aufrufe_90d: 1 }], EINSTELLUNGEN, JETZT);
  assert.equal(e.wenigImpressionen90d, EINSTELLUNGEN.wenigImpressionen90d);
});

// ---------- Vorschläge (fertige Anweisungen) ----------
function shop() {
  // 220 reife Produkte: Titel mit "ersatz"/"parture" verkaufen sich immer, Titel mit "kompatibel" nie, "passend" teils.
  // Wörter gelten erst ab 30 (stark) bzw. 100 Titeln (schwach/allgemein) als aussagekräftig.
  const l = [];
  for (let i = 0; i < 40; i++) l.push({ created_at: alt, title: `Ersatz Halter passend Parture ${i}`, units_90d: 3 });
  for (let i = 0; i < 110; i++) l.push({ created_at: alt, title: `Halter kompatibel ${i}`, units_90d: 0 });
  for (let i = 0; i < 70; i++) l.push({ created_at: alt, title: `Halter passend ${i}`, units_90d: i % 2 });
  return l;
}
const STAT = () => lerneTitelWoerter(shop(), EINSTELLUNGEN, JETZT);

test("Vorschläge: Titel-Statistik findet starke und schwache Wörter", () => {
  const stat = STAT();
  assert.ok(stat.basis > 0 && stat.basis < 1);
  assert.ok(stat.stark.some((z) => z.wort === "ersatz") && stat.stark.some((z) => z.wort === "parture"));
  assert.ok(stat.schwach.some((z) => z.wort === "kompatibel"));
});

test("Neuer Titel: 'kompatibel mit' wird 'passend für', die Marke wird angehängt, Zahlen stehen im Grund", () => {
  const r = neuerTitel("Halter kompatibel mit Bosch GSR", STAT(), EINSTELLUNGEN);
  assert.equal(r.neu, "Halter passend für Bosch GSR von Parture");
  assert.ok(r.neu.length <= 80);
  assert.match(r.gruende.join(" "), /"kompatibel" replaced by "passend für"/);
  assert.match(r.gruende.join(" "), /"von Parture" added/);
});

test("Neuer Titel: steht 'passend' schon im Titel, entsteht kein doppeltes 'passend für'", () => {
  const r = neuerTitel("Überkopf Halterung passend für iPad kompatibel mit VW T5 California", STAT(), EINSTELLUNGEN);
  assert.doesNotMatch(r.neu ?? "", /passend für.*passend für/i);
  assert.doesNotMatch((r.gruende || []).join(" "), /replaced by "passend/);
});

test("Neuer Titel: ohne belegte Änderung gibt es keinen Titel (nichts wird erfunden)", () => {
  assert.equal(neuerTitel("Halter passend für Bosch GSR Parture", STAT(), EINSTELLUNGEN).neu, null); // Marke schon da, nichts zu tauschen
  assert.equal(neuerTitel("Halter passend für Bosch", lerneTitelWoerter([], EINSTELLUNGEN, JETZT), EINSTELLUNGEN).neu, null); // keine Daten
});

test("Neuer Titel: nie länger als 80 Zeichen", () => {
  const langOhneMarke = "Halter passend für Bosch GSR Akkuschrauber Ladegerät Zubehör Set 18V".padEnd(75, "x");
  assert.equal(neuerTitel(langOhneMarke, STAT(), EINSTELLUNGEN).neu, null);           // Marke würde nicht mehr passen
  const t = "Halter kompatibel mit Bosch GSR Akkuschrauber Ladegerät Zubehör Set 18V ab";
  const r = neuerTitel(t, STAT(), EINSTELLUNGEN);
  assert.ok(r.neu === null || r.neu.length <= 80);
});

test("Neuer Titel: doppelte Wörter hintereinander werden entfernt", () => {
  assert.equal(neuerTitel("Halter Halter Bosch Parture", STAT(), EINSTELLUNGEN).neu, "Halter Bosch Parture");
});

test("Titel zerlegen: Produkt und Zielgerät, ohne Menge und eigene Marke", () => {
  assert.deepEqual(zerlegeTitel("2x Wandhalterung passend für Velux Integra KLI 310 von Parture"), { produkt: "Wandhalterung", ziel: "Velux Integra KLI 310" });
  assert.deepEqual(zerlegeTitel("Ständer kompatibel mit Dyson Haartrockner, Halterung für Föhn"), { produkt: "Ständer", ziel: "Dyson Haartrockner, Halterung für Föhn" });
  assert.deepEqual(zerlegeTitel("Kanisterschlüssel für Wasserkanister"), { produkt: "Kanisterschlüssel für Wasserkanister", ziel: null });
  assert.deepEqual(zerlegeTitel(null), { produkt: "", ziel: null });
});

test("Vorschläge: Stufe 1 liefert einen fertigen Titel, sonst eine ehrliche Absage", () => {
  const v = schlageVor({ gruppe: "sichtbarkeit", title: "Halter kompatibel mit Bosch GSR" }, STAT(), EINSTELLUNGEN);
  assert.equal(v.hebel, "titel");
  assert.equal(v.alt, "Halter kompatibel mit Bosch GSR");
  assert.equal(v.neu, "Halter passend für Bosch GSR von Parture");
  assert.equal(v.laenge, v.neu.length);
  assert.match(v.hinweis, /only this one thing/);
  const keiner = schlageVor({ gruppe: "sichtbarkeit", title: "Halter passend für Bosch Parture" }, STAT(), EINSTELLUNGEN);
  assert.equal(keiner.neu, null);
  assert.match(keiner.anweisung, /No safe automatic title/);
  assert.match(keiner.schritte.join(" "), /of 80 characters/);
});

test("Vorschläge: Stufe 2 nennt das Produkt und das Zielgerät, Stufe 3 liefert Text mit Platzhaltern", () => {
  const b = schlageVor({ gruppe: "klicks", title: "Wandhalterung passend für Velux Integra" }, STAT(), EINSTELLUNGEN);
  assert.equal(b.hebel, "bild");
  assert.match(b.schritte[0], /"Wandhalterung"/);
  assert.match(b.schritte[1], /"Velux Integra"/);
  const a = schlageVor({ gruppe: "kaufentscheidung", title: "Wandhalterung passend für Velux Integra" }, STAT(), EINSTELLUNGEN);
  assert.equal(a.hebel, "angebot");
  assert.match(a.neu, /Passend für: Velux Integra/);
  assert.match(a.neu, /\[Länge x Breite x Höhe in mm eintragen\]/); // unbekannte Fakten bleiben Platzhalter
});

test("Vorschläge: je Stufe genau ein Hebel, bei guten Produkten keiner", () => {
  for (const g of ["top", "normal", "neu", "ohne_daten"]) assert.equal(schlageVor({ gruppe: g, title: "a" }, STAT()), null);
});

test("Vorschläge: nie Preis oder Werbung (bräuchten Deckungsbeitrag bzw. Budget)", () => {
  for (const g of ["sichtbarkeit", "klicks", "kaufentscheidung"]) {
    const text = JSON.stringify(schlageVor({ gruppe: g, title: "Halter kompatibel mit Bosch GSR" }, STAT(), EINSTELLUNGEN));
    assert.doesNotMatch(text, /\b(price|prices|pricing|ads?|advert\w*|budget|promot\w*|discount\w*|cheaper)\b/i);
  }
  for (const g of Object.values(GRUPPEN)) assert.doesNotMatch(g.regel + g.label, /\b(price|ads?|advert\w*|budget|promot\w*)\b/i);
  assert.deepEqual(Object.keys(AKTIONEN), ["behalten", "beobachten", "titel", "bild", "angebot", "auslisten"]);
});

// ---------- Protokoll und Prüfung ----------
const prod = (nr, imp, auf, trans, extra = {}) => ({ number: nr, title: "Titel " + nr, image_url: "https://x/" + nr + ".jpg", created_at: alt, impressionen_30d: imp, aufrufe_30d: auf, transaktionen_30d: trans, ...extra });
const wuerfel = (n = 40) => Array.from({ length: n }, (_, i) => prod("P" + i, 400, 20, 4)); // gleichmäßiger Shop
const TAGE = (d) => new Date(JETZT.getTime() + d * 86400000);
const profDb = () => { const db = ent.oeffne(":memory:"); prot.bereiteVor(db); return db; };

test("Urteil: Verdopplung gegen eine gleich gebliebene Vergleichsgruppe ist besser", () => {
  const r = prot.urteile("titel", { imp: 200, auf: 10, trans: 2 }, { imp: 400, auf: 20, trans: 4 }, { vorher: { imp: 8000, auf: 400, trans: 80 }, nachher: { imp: 8000, auf: 400, trans: 80 } });
  assert.equal(r.urteil, "better");
  assert.equal(r.empfehlung, "keep");
  assert.ok(Math.abs(r.primaer.netto - 1) < 1e-9);
});

test("Urteil: wächst die Vergleichsgruppe genauso, ist es kein Unterschied (Saison fällt heraus)", () => {
  const r = prot.urteile("titel", { imp: 200, auf: 10, trans: 2 }, { imp: 400, auf: 20, trans: 4 }, { vorher: { imp: 8000, auf: 400, trans: 80 }, nachher: { imp: 16000, auf: 800, trans: 160 } });
  assert.equal(r.urteil, "no_difference");
  assert.equal(r.empfehlung, "revert"); // "kein Unterschied belegt" zählt wie "nicht besser"
});

test("Urteil: Schutzkennzahl, mehr Impressionen aber deutlich weniger Verkäufe ist nicht besser", () => {
  const r = prot.urteile("titel", { imp: 200, auf: 10, trans: 10 }, { imp: 600, auf: 30, trans: 2 }, null);
  assert.equal(r.urteil, "worse");
  assert.equal(r.schutz.ok, false);
});

test("Urteil: zu wenig Impressionen im Fenster, es wird nicht geurteilt", () => {
  assert.equal(prot.urteile("titel", { imp: 50, auf: 2, trans: 0 }, { imp: 149, auf: 6, trans: 0 }, null).urteil, "not_enough_data");
  assert.notEqual(prot.urteile("titel", { imp: 50, auf: 2, trans: 0 }, { imp: 150, auf: 6, trans: 0 }, null).urteil, "not_enough_data");
});

test("Urteil: Ausgangswert 0 teilt nicht durch 0 und bleibt JSON-tauglich", () => {
  const r = prot.urteile("titel", { imp: 0, auf: 0, trans: 0 }, { imp: 500, auf: 20, trans: 2 }, null);
  assert.equal(r.urteil, "better");
  assert.equal(r.primaer.netto, null); // unendlich wird zu null, damit JSON.stringify nicht kaputtgeht
  assert.doesNotThrow(() => JSON.stringify(r));
});

test("Urteil: je Hebel andere Kennzahlen (Bild = Klickrate, Angebot = Conversion)", () => {
  const bild = prot.urteile("bild", { imp: 1000, auf: 10, trans: 1 }, { imp: 1000, auf: 30, trans: 1 }, null);
  assert.equal(bild.primaer.name, "click rate");
  assert.equal(bild.urteil, "better");
  const angebot = prot.urteile("angebot", { imp: 1000, auf: 100, trans: 1 }, { imp: 1000, auf: 100, trans: 5 }, null);
  assert.equal(angebot.primaer.name, "conversion");
  assert.equal(angebot.urteil, "better");
});

test("Protokoll: Änderung anlegen speichert alt, neu und Ausgangszahlen sowie die Momentaufnahme aller Produkte", () => {
  const db = profDb(); const ps = wuerfel();
  const r = prot.legeAn(db, { number: "P1", hebel: "titel", neu: "  Neuer Titel  " }, ps, JETZT);
  assert.equal(r.ok, true);
  assert.equal(r.wert.alt, "Titel P1"); assert.equal(r.wert.neu, "Neuer Titel");
  assert.equal(r.wert.imp30, 400); assert.equal(r.wert.trans30, 4);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM momentaufnahme").get().c, 40);
  assert.equal(prot.laufende(db).get("P1").hebel, "titel");
});

test("Protokoll: ein Angebot steckt immer nur in einem Test", () => {
  const db = profDb(); const ps = wuerfel();
  assert.equal(prot.legeAn(db, { number: "P1", hebel: "titel", neu: "A" }, ps, JETZT).ok, true);
  const zweite = prot.legeAn(db, { number: "P1", hebel: "bild", neu: "B" }, ps, JETZT);
  assert.equal(zweite.ok, false); assert.equal(zweite.status, 409);
  assert.equal(prot.schliesse(db, { id: 1, abschluss: "zurueck" }, JETZT).ok, true);
  assert.equal(prot.legeAn(db, { number: "P1", hebel: "bild", neu: "B" }, ps, JETZT).ok, true); // nach dem Abschluss wieder frei
});

test("Protokoll: ungültige Eingaben werden abgelehnt", () => {
  const db = profDb(); const ps = wuerfel();
  const f = (e) => prot.legeAn(db, e, ps, JETZT);
  assert.equal(f(null).status, 400);
  assert.equal(f({ number: "P1", hebel: "preis", neu: "x" }).status, 400);            // Preis ist kein Hebel
  assert.equal(f({ number: "P1", hebel: "werbung", neu: "x" }).status, 400);          // Werbung auch nicht
  assert.equal(f({ number: "P1", hebel: "titel", neu: "   " }).status, 400);
  assert.equal(f({ number: "P1", hebel: "titel", neu: "x".repeat(81) }).status, 400); // Titel höchstens 80
  assert.equal(f({ number: "P1", hebel: "angebot", neu: "x".repeat(2001) }).status, 400);
  assert.equal(f({ number: 5, hebel: "titel", neu: "x" }).status, 400);
  assert.equal(f({ number: "P1", hebel: "toString", neu: "x" }).status, 400);
  assert.equal(f({ number: "NIX", hebel: "titel", neu: "x" }).status, 404);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM aenderung").get().c, 0);           // nichts wurde gespeichert
  assert.equal(prot.schliesse(db, { id: 99, abschluss: "behalten" }).status, 404);
  assert.equal(prot.schliesse(db, { id: 1, abschluss: "löschen" }).status, 400);
  assert.equal(prot.schliesse(db, { id: "1", abschluss: "behalten" }).status, 400);
});

test("Protokoll: Status läuft, dann bereit mit Urteil, dann abgeschlossen", () => {
  const db = profDb(); const ps = wuerfel();
  prot.legeAn(db, { number: "P1", hebel: "titel", neu: "Neu" }, ps, JETZT);
  assert.equal(prot.liste(db, ps, TAGE(10))[0].status, "running");
  assert.equal(prot.liste(db, ps, TAGE(10))[0].tage, 10);
  // nach 31 Tagen: P1 hat doppelt so viele Impressionen, alle anderen blieben gleich
  const spaeter = ps.map((p) => (p.number === "P1" ? { ...p, impressionen_30d: 800 } : p));
  const e = prot.liste(db, spaeter, TAGE(31))[0];
  assert.equal(e.status, "ready");
  assert.equal(e.pruefung.urteil, "better");
  assert.equal(e.pruefung.vergleichsgruppe, 39); // alle anderen, ohne das veränderte Angebot selbst
  prot.schliesse(db, { id: 1, abschluss: "behalten" }, TAGE(31));
  assert.equal(prot.liste(db, spaeter, TAGE(32))[0].status, "closed");
});

test("Protokoll: wächst der ganze Shop mit, ist die Änderung nicht besser (Vergleichsgruppe wirkt)", () => {
  const db = profDb(); const ps = wuerfel();
  prot.legeAn(db, { number: "P1", hebel: "titel", neu: "Neu" }, ps, JETZT);
  const sommer = ps.map((p) => ({ ...p, impressionen_30d: p.impressionen_30d * 2 })); // alle verdoppeln
  assert.equal(prot.liste(db, sommer, TAGE(31))[0].pruefung.urteil, "no_difference");
});

test("Protokoll: veränderte und neue Produkte gehören nicht zur Vergleichsgruppe, zu kleine Gruppe zählt nicht", () => {
  const db = profDb();
  const klein = wuerfel(10); // nur 9 mögliche Vergleichsprodukte (< 20)
  prot.legeAn(db, { number: "P1", hebel: "titel", neu: "Neu" }, klein, JETZT);
  const e = prot.liste(db, klein.map((p) => (p.number === "P1" ? { ...p, impressionen_30d: 800 } : p)), TAGE(31))[0];
  assert.equal(e.pruefung.mitKontrolle, false);
  // Mit 40 Produkten, aber 25 davon neu: bleiben 14 Vergleichsprodukte, also ebenfalls keine Kontrolle
  const db2 = profDb();
  const gemischt = wuerfel(40).map((p, i) => (i >= 15 ? { ...p, created_at: "2026-11-01T00:00:00.000Z" } : p));
  prot.legeAn(db2, { number: "P1", hebel: "titel", neu: "Neu" }, gemischt, JETZT);
  assert.equal(prot.liste(db2, gemischt, TAGE(31))[0].pruefung.mitKontrolle, false);
});

test("Protokoll: verschwundenes Produkt führt nicht zum Absturz", () => {
  const db = profDb(); const ps = wuerfel();
  prot.legeAn(db, { number: "P1", hebel: "titel", neu: "Neu" }, ps, JETZT);
  const e = prot.liste(db, ps.filter((p) => p.number !== "P1"), TAGE(31))[0];
  assert.equal(e.status, "ready"); assert.equal(e.pruefung, null);
});

// ---------- Eingabe und Speicher ----------
test("Eingabe: gültige und ungültige Entscheidungen", () => {
  assert.equal(ent.pruefe({ number: "12", aktion: "titel", notiz: " Titel ändern " }).wert.notiz, "Titel ändern");
  assert.equal(ent.pruefe({ number: "12", aktion: null }).ok, true);
  assert.equal(ent.pruefe({ number: "12", aktion: "loeschen" }).ok, false);        // unbekannte Aktion
  assert.equal(ent.pruefe({ number: "12", aktion: "bewerben" }).ok, false);        // Werbung gibt es nicht mehr
  assert.equal(ent.pruefe({ number: "", aktion: "behalten" }).ok, false);          // leere Nummer
  assert.equal(ent.pruefe({ number: 12, aktion: "behalten" }).ok, false);          // falscher Typ
  assert.equal(ent.pruefe({ number: "12", aktion: "behalten", notiz: 5 }).ok, false);
  assert.equal(ent.pruefe({ number: "12", aktion: "behalten", notiz: "x".repeat(501) }).ok, false);
  assert.equal(ent.pruefe({ number: "x".repeat(41), aktion: "behalten" }).ok, false);
  assert.equal(ent.pruefe(null).ok, false);
  assert.equal(ent.pruefe([]).ok, false);
  assert.equal(ent.pruefe({ number: "12", aktion: "toString" }).ok, false);        // kein Treffer über Object-Eigenschaften
});

test("Speicher: speichern, überschreiben, löschen", () => {
  const db = ent.oeffne(":memory:");
  ent.speichere(db, { number: "7", aktion: "titel", notiz: "Titel" }, JETZT);
  assert.equal(ent.alle(db).get("7").aktion, "titel");
  ent.speichere(db, { number: "7", aktion: "auslisten", notiz: "" }, JETZT);
  assert.equal(ent.alle(db).size, 1);
  assert.equal(ent.alle(db).get("7").aktion, "auslisten");
  assert.equal(ent.speichere(db, { number: "7", aktion: null, notiz: "" }), null);
  assert.equal(ent.alle(db).size, 0);
});

test("Speicher: Notiz ohne Aktion lässt die Aktion leer", () => {
  const db = ent.oeffne(":memory:");
  ent.speichere(db, { number: "8", aktion: null, notiz: "nur Notiz" }, JETZT);
  assert.equal(ent.alle(db).get("8").aktion, null);
});

test("Speicher: Sonderzeichen und SQL-Text bleiben harmloser Text", () => {
  const db = ent.oeffne(":memory:");
  const boese = "'); DROP TABLE entscheidung; -- <script>alert(1)</script>";
  ent.speichere(db, { number: "9", aktion: "behalten", notiz: boese }, JETZT);
  assert.equal(ent.alle(db).get("9").notiz, boese);
});

// ---------- Zusammenspiel ----------
test("Auswertung: Übersicht zählt alle Produkte genau einmal, Vorschlag nur bei Handlungsbedarf", () => {
  const produkte = [
    { number: "1", ...p({ units_90d: 40 }) },
    { number: "2", ...p({ units_90d: 0, units_total: 0, aufrufe_90d: 0, impressionen_90d: 100 }) },
    { number: "3", ...p({ created_at: "2026-11-01T00:00:00.000Z", units_90d: 0 }) },
  ];
  const db = ent.oeffne(":memory:");
  ent.speichere(db, { number: "2", aktion: "titel", notiz: "" }, JETZT);
  const b = baueBewertung(produkte, ent.alle(db), JETZT);
  assert.equal(Object.values(b.uebersicht).reduce((a, c) => a + c, 0), 3);
  assert.equal(b.summe.entschieden, 1);
  assert.equal(b.produkte.find((x) => x.number === "2").entscheidung.aktion, "titel");
  assert.equal(b.produkte.find((x) => x.number === "1").entscheidung, null);
  assert.equal(b.produkte.find((x) => x.number === "1").vorschlag, null);
  assert.equal(b.produkte.find((x) => x.number === "2").vorschlag.hebel, "titel");
});
