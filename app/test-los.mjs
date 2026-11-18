// Tests für das Los (Checkliste A1.3 und B1.4): reproduzierbar, gleich große Gruppen, kein Angebot doppelt, Sperrliste wirkt.
// Reine Modultests mit Datenbanken im Speicher; pm.db wird nicht angefasst.
import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { EINSTELLUNGEN } from "./regeln.mjs";
import * as ex from "./experimente.mjs";
import { ladeSperre } from "./bewertung.mjs";

const JETZT = new Date("2026-11-19T12:00:00Z");
const E = { ...EINSTELLUNGEN, modus: "fest", festeGrenze: 1000, testGroesse: 20 };
// 30 Angebote mit wenig Impressionen (alle Kandidaten), alle älter als die Schonfrist
const shop = (anzahl = 30) => Array.from({ length: anzahl }, (_, i) => ({ number: "P" + String(i).padStart(2, "0"), title: "Holder " + i, created_at: "2025-12-01T10:00:00.000Z",
  units_90d: 1, units_total: 3, impressionen_90d: 100 + i, aufrufe_90d: 5, impressionen_30d: 30, aufrufe_30d: 2, transaktionen_30d: 0 }));
const appDb = () => { const d = new Database(":memory:"); ex.bereiteVor(d); return d; };
const gruppen = (d, id) => {
  const z = d.prepare("SELECT number, gruppe FROM experiment_angebot WHERE experiment_id = ? ORDER BY number").all(id);
  return { test: z.filter((r) => r.gruppe === "test").map((r) => r.number), kontrolle: z.filter((r) => r.gruppe === "kontrolle").map((r) => r.number) };
};
// pm.db im Speicher: kanal immer, sperre nur auf Wunsch (die Tabelle ist optional)
function pmDb(sperren) {
  const d = new Database(":memory:");
  d.exec("CREATE TABLE kanal (number TEXT, channel TEXT, external_id TEXT, title TEXT)");
  const k = d.prepare("INSERT INTO kanal VALUES (?, ?, ?, ?)");
  for (let i = 0; i < 30; i++) k.run("P" + String(i).padStart(2, "0"), "ebay", String(100000000000 + i), "Holder " + i);
  k.run("P05", "shop", "999", "Holder 5");   // ein anderer Kanal mit derselben Nummer zählt nicht als eBay-Angebot
  if (sperren) {
    d.exec("CREATE TABLE sperre (external_id TEXT PRIMARY KEY, number TEXT, grund TEXT, bis TEXT)");
    const s = d.prepare("INSERT INTO sperre VALUES (?, ?, ?, ?)");
    for (const z of sperren) s.run(z.external_id ?? null, z.number ?? null, z.grund ?? "price test", z.bis ?? null);
  }
  return d;
}

// ---------- 1. reproduzierbar ----------
test("Los reproduzierbar: der seed steht in der Datenbank und in der Antwort, derselbe seed ergibt dieselben Gruppen", () => {
  const a = appDb(), b = appDb();
  const ra = ex.legeAn(a, {}, shop(), E, JETZT, 4711), rb = ex.legeAn(b, {}, shop(), E, JETZT, 4711);
  assert.equal(ra.ok, true); assert.equal(ra.wert.seed, 4711);
  assert.equal(a.prepare("SELECT seed FROM experiment WHERE id = ?").get(ra.wert.id).seed, 4711);
  assert.deepEqual(gruppen(a, ra.wert.id), gruppen(b, rb.wert.id));
  // Nachrechnen aus dem gespeicherten seed: dieselben Kandidaten, derselbe seed -> genau die gespeicherten Gruppen
  const nach = ex.ziehe(shop(), E.testGroesse, a.prepare("SELECT seed FROM experiment").get().seed);
  assert.deepEqual({ test: nach.test.map((p) => p.number).sort(), kontrolle: nach.kontrolle.map((p) => p.number).sort() }, gruppen(a, ra.wert.id));
  // die Reihenfolge der Eingabe spielt keine Rolle (feste Ausgangsreihenfolge vor dem Mischen)
  assert.deepEqual(ex.ziehe([...shop()].reverse(), 20, 4711), ex.ziehe(shop(), 20, 4711));
  const c = appDb(); const rc = ex.legeAn(c, {}, shop(), E, JETZT, 4712);
  assert.notDeepEqual(gruppen(c, rc.wert.id), gruppen(a, ra.wert.id), "ein anderer seed ergibt eine andere Ziehung");
});

test("Los reproduzierbar: ohne vorgegebenen seed wird einer gezogen, gespeichert und zurückgegeben", () => {
  const d = appDb();
  const r = ex.legeAn(d, {}, shop(), E, JETZT);
  assert.ok(Number.isInteger(r.wert.seed) && r.wert.seed >= 1);
  assert.equal(d.prepare("SELECT seed FROM experiment").get().seed, r.wert.seed);
});

// ---------- 2. gleich große Gruppen ----------
test("Los: Gruppen gleich groß, bei ungerader Anzahl höchstens 1 Unterschied", () => {
  for (const n of [4, 10, 20, 30]) for (const seed of [1, 2, 99]) {
    const { test: t, kontrolle: k } = ex.ziehe(shop(), n, seed);
    assert.equal(t.length, n / 2); assert.equal(k.length, n / 2);
  }
  for (const n of [3, 7, 21, 29]) {
    const { test: t, kontrolle: k } = ex.ziehe(shop(), n, 5);
    assert.equal(t.length + k.length, n); assert.ok(Math.abs(t.length - k.length) <= 1, `n = ${n}: ${t.length} gegen ${k.length}`);
  }
  const d = appDb(); const r = ex.legeAn(d, {}, shop(), { ...E, testGroesse: 11 }, JETZT, 3);   // die Settings erlauben nur gerade Zahlen, das Modul bleibt trotzdem fair
  const g = gruppen(d, r.wert.id);
  assert.deepEqual([g.test.length, g.kontrolle.length], [5, 6]);
  assert.deepEqual([r.wert.test, r.wert.kontrolle], [5, 6]);
});

// ---------- 3. kein Angebot doppelt ----------
test("Los: kein Angebot doppelt, weder innerhalb eines Tests (auch bei doppelten Kandidaten) noch über zwei Tests", () => {
  const doppelt = [...shop(), ...shop().slice(0, 10)];
  for (const seed of [1, 7, 123, 99999]) {
    const { test: t, kontrolle: k } = ex.ziehe(doppelt, 30, seed);
    const alle = [...t, ...k].map((p) => p.number);
    assert.equal(alle.length, 30); assert.equal(new Set(alle).size, 30);
  }
  const d = appDb();
  assert.equal(ex.legeAn(d, {}, shop(), { ...E, testGroesse: 14 }, JETZT, 1).ok, true);
  assert.equal(ex.legeAn(d, {}, shop(), { ...E, testGroesse: 16 }, JETZT, 2).ok, true);
  const nummern = d.prepare("SELECT number FROM experiment_angebot").all().map((z) => z.number);
  assert.equal(nummern.length, 30); assert.equal(new Set(nummern).size, 30);
  assert.equal(ex.legeAn(d, {}, shop(), { ...E, testGroesse: 2 }, JETZT, 3).status, 409, "alle Angebote stecken schon in Tests");
});

// ---------- 4. Sperrliste ----------
test("Sperrliste: fehlt die Tabelle sperre in pm.db, ist nichts gesperrt", () => {
  const pm = pmDb(null);
  assert.deepEqual(ladeSperre(pm), []);
  assert.equal(ex.gesperrteNummern(ladeSperre(pm), JETZT).size, 0);
  assert.equal(ex.kandidaten(appDb(), shop(), E, JETZT, ex.gesperrteNummern(ladeSperre(pm), JETZT)).length, 30);
});

test("Sperrliste: gesperrt über Produktnummer oder eBay-Artikelnummer; abgelaufen (bis vor heute) zählt nicht, heute noch gesperrt", () => {
  const pm = pmDb([
    { number: "P01", external_id: "x-1", bis: "2026-11-24" },                    // über die Produktnummer
    { external_id: String(100000000000 + 2), bis: "2026-11-24" },               // über die eBay-Artikelnummer (kanal -> P02)
    { external_id: String(100000000000 + 3), bis: "2026-11-19" },               // bis heute: noch gesperrt
    { external_id: String(100000000000 + 4), bis: "2026-11-18" },               // gestern abgelaufen
    { number: "P06", external_id: "x-6", bis: null },                            // unbefristet
    { number: "P07", external_id: "x-7", bis: "irgendwann" },                    // unlesbar: sicherheitshalber gesperrt
    { external_id: "999", bis: "2026-12-31" },                                    // nur ein Shop-Kanal hat 999: kein eBay-Angebot, sperrt nichts
  ]);
  const gesperrt = ex.gesperrteNummern(ladeSperre(pm), JETZT);
  assert.deepEqual([...gesperrt].sort(), ["P01", "P02", "P03", "P06", "P07"]);
  const frei = ex.kandidaten(appDb(), shop(), E, JETZT, gesperrt).map((p) => p.number);
  assert.equal(frei.length, 25); assert.ok(frei.includes("P04"), "abgelaufene Sperre gibt das Angebot frei"); assert.ok(frei.includes("P05"));
  assert.equal(ex.gesperrteNummern(ladeSperre(pm), new Date("2026-11-25T12:00:00Z")).has("P01"), false, "nach dem bis-Datum wieder frei");
});

test("Sperrliste: ein gesperrtes Angebot wird nie gezogen (200 Lose), und reicht es ohne Gesperrte nicht, gibt es eine Absage statt eines gesperrten Angebots", () => {
  const gesperrt = new Set(["P00", "P03", "P10", "P29"]);
  for (let seed = 1; seed <= 200; seed++) {
    const d = appDb();
    const r = ex.legeAn(d, {}, shop(), { ...E, testGroesse: 26 }, JETZT, seed, gesperrt);   // 26 von 26 freien: jedes freie Angebot wird gezogen
    assert.equal(r.ok, true); assert.equal(r.wert.gesperrt, 4);
    const nummern = d.prepare("SELECT number FROM experiment_angebot").all().map((z) => z.number);
    assert.ok(!nummern.some((n) => gesperrt.has(n)), `seed ${seed}`);
  }
  const zuViel = ex.legeAn(appDb(), {}, shop(), { ...E, testGroesse: 28 }, JETZT, 1, gesperrt);
  assert.equal(zuViel.status, 409); assert.match(zuViel.fehler, /26 available, 28 needed/);
});

// ---------- 4. nur Angebote, deren Titel sich ändern lässt ----------
test("Los: ein Produkt ohne laufendes eBay-Angebot (ebay_aktiv 0) wird nie gezogen, unbekannt (null) zählt mit", () => {
  const p = shop(); p[0].ebay_aktiv = 0; p[1].ebay_aktiv = null; p[2].ebay_aktiv = 1;
  const k = ex.kandidaten(appDb(), p, E, JETZT).map((x) => x.number);
  assert.ok(!k.includes("P00"), "beendetes Angebot kein Kandidat");
  assert.ok(k.includes("P01") && k.includes("P02"));
});

test("ladeProdukte: ebay_aktiv aus kanal (laufend mit Nummer = 1, beendet ohne Nummer = 0)", async () => {
  const { ladeProdukte } = await import("./bewertung.mjs");
  const d = new Database(":memory:");
  d.exec("CREATE TABLE produkt (number TEXT, title TEXT, image_url TEXT, avg_price REAL, units_total INTEGER, units_90d INTEGER, created_at TEXT, last_sold_at TEXT); CREATE TABLE kanal (number TEXT, channel TEXT, listed INTEGER, external_id TEXT, title TEXT)");
  d.exec("INSERT INTO produkt (number, title) VALUES ('A', 'a'), ('B', 'b'); INSERT INTO kanal VALUES ('A', 'ebay', 1, '406000000001', 'a'), ('B', 'ebay', 0, NULL, 'b'), ('B', 'shopify', 1, 'x', 'b')");
  const m = Object.fromEntries(ladeProdukte(d).map((r) => [r.number, r.ebay_aktiv]));
  assert.deepEqual(m, { A: 1, B: 0 });
});
