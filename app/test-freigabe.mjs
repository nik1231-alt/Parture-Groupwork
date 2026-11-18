// Tests für Rollen, Freigabe und Protokoll. Es wird nie bei eBay geschrieben: der Schreiber ist hier ein Ersatz im Speicher.
import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { EINSTELLUNGEN } from "./regeln.mjs";
import * as einstModul from "./einstellungen.mjs";
import * as ex from "./experimente.mjs";
import * as login from "./login.mjs";
import * as rollen from "./rollen.mjs";
import * as protokoll from "./protokoll.mjs";
import * as fg from "./freigabe.mjs";
import { erzeuge } from "./ebay-schreiben.mjs";

const JETZT = new Date("2026-11-10T12:00:00Z");
const EINST = { ...EINSTELLUNGEN, modus: "fest", festeGrenze: 2000, testGroesse: 4 };
const ADMIN = { name: "niko", rolle: "admin" };
const BUILDER = { name: "anna", rolle: "builder" };

const baseDb = () => {
  const d = new Database(":memory:");
  einstModul.bereiteVor(d); ex.bereiteVor(d); login.bereiteVor(d); rollen.bereiteVor(d); protokoll.bereiteVor(d); fg.bereiteVor(d);
  return d;
};
const produkte = () => Array.from({ length: 8 }, (_, i) => ({ number: String(100 + i), title: `Holder for device ${i}`, image_url: null, avg_price: 4.99, units_total: 20, units_90d: 5, created_at: "2025-12-01T10:00:00.000Z",
  impressionen_90d: 500, aufrufe_90d: 10, impressionen_30d: 200, aufrufe_30d: 4, transaktionen_30d: 1 }));
const kanaele = (nummer) => [{ external_id: "9000" + nummer + "00", title: `Holder for device ${Number(nummer) - 100}` }];

// Ein Test mit allen Titeln, bereit zum Einreichen. Gibt { db, id, ebay } zurück (ebay = was bei "eBay" gerade steht).
function vorbereitet() {
  const db = baseDb();
  const p = produkte();
  const { wert: { id } } = ex.legeAn(db, { name: "T" }, p, EINST, JETZT, 7);
  for (const a of db.prepare("SELECT number, alt FROM experiment_angebot WHERE experiment_id = ? AND gruppe = 'test'").all(id)) ex.setzeTitel(db, { id, number: a.number, neu: a.alt + " NEW" }, EINST);
  const ebay = new Map();
  for (const a of db.prepare("SELECT number, alt FROM experiment_angebot WHERE experiment_id = ?").all(id)) ebay.set("9000" + a.number + "00", a.alt);
  return { db, id, p, ebay };
}
// Ersatz für ebay-schreiben.mjs
function ersatzSchreiber(ebay, { an = true, ablehnen = null, langsam = false } = {}) {
  const aufrufe = { lies: 0, schreibe: [] };
  return { aufrufe, schreibenAn: () => an, konfiguriert: () => true,
    async lies(id) { aufrufe.lies++; if (langsam) await new Promise((r) => setTimeout(r, 40)); return ebay.has(id) ? { ok: true, titel: ebay.get(id), status: "Active", verkauft: 3 } : { ok: false, meldung: "not found" }; },
    async setzeTitel(id, titel) { if (ablehnen) return { ok: false, ack: "Failure", meldung: ablehnen }; aufrufe.schreibe.push([id, titel]); ebay.set(id, titel); return { ok: true, ack: "Success", meldung: "" }; } };
}
const status = (db, id) => db.prepare("SELECT status FROM experiment WHERE id = ?").get(id).status;
const zaehle = (db, sql, ...a) => db.prepare(sql).get(...a).n;

// ---------- Rollen ----------
test("Rollen: neue Benutzer sind Builder, beim Nachrüsten wird der älteste Benutzer Admin", () => {
  const d = new Database(":memory:"); login.bereiteVor(d);
  login.legeBenutzerAn(d, "niko", "ein-langes-passwort", new Date("2026-11-01T10:00:00Z"));
  login.legeBenutzerAn(d, "anna", "ein-langes-passwort", new Date("2026-11-02T10:00:00Z"));
  rollen.bereiteVor(d);
  assert.equal(rollen.rolleVon(d, "niko"), "admin");
  assert.equal(rollen.rolleVon(d, "anna"), "builder");
  login.legeBenutzerAn(d, "ben", "ein-langes-passwort");
  assert.equal(rollen.rolleVon(d, "ben"), "builder");
  rollen.bereiteVor(d); // zweiter Lauf ändert nichts
  assert.equal(rollen.anzahlAdmins(d), 1);
});

test("Rollen: nur ein Admin vergibt Rollen, es bleibt immer ein Admin, jede Änderung wird protokolliert", () => {
  const d = baseDb(); login.legeBenutzerAn(d, "niko", "ein-langes-passwort"); login.legeBenutzerAn(d, "anna", "ein-langes-passwort");
  rollen.legeFest(d, "niko", "admin");
  assert.equal(rollen.setzeRolle(d, BUILDER, "anna", "admin").status, 403, "ein Builder darf keine Rollen vergeben");
  assert.equal(rollen.rolleVon(d, "anna"), "builder");
  assert.equal(rollen.setzeRolle(d, ADMIN, "anna", "chef").status, 400);
  assert.equal(rollen.setzeRolle(d, ADMIN, "gibtesnicht", "admin").status, 404);
  assert.equal(rollen.setzeRolle(d, ADMIN, "niko", "builder").status, 409, "der letzte Admin kann sich nicht selbst abgeben");
  assert.equal(rollen.setzeRolle(d, ADMIN, "anna", "admin").ok, true);
  assert.equal(rollen.setzeRolle(d, ADMIN, "niko", "builder").ok, true, "mit einem zweiten Admin ist es erlaubt");
  const l = protokoll.liste(d);
  assert.deepEqual(l.map((z) => z.aktion), ["role_changed", "role_changed"]);
  assert.deepEqual(l[1].details, { von: "builder", zu: "admin" });
  assert.equal(l[1].benutzer, "niko");
});

test("Protokoll: es wird nur angehängt, Ändern und Löschen schlagen fehl", () => {
  const d = baseDb();
  protokoll.schreibe(d, { benutzer: "niko", rolle: "admin", aktion: "x", ergebnis: "ok" });
  assert.throws(() => d.prepare("UPDATE protokoll SET benutzer = 'anna'").run(), /append-only/);
  assert.throws(() => d.prepare("DELETE FROM protokoll").run(), /append-only/);
  assert.equal(zaehle(d, "SELECT COUNT(*) n FROM protokoll"), 1);
});

// ---------- Einreichen ----------
test("Einreichen: ohne alle Titel geht es nicht, mit allen Titeln wird der Test zur Freigabe vorgemerkt", () => {
  const db = baseDb(); const { wert: { id } } = ex.legeAn(db, {}, produkte(), EINST, JETZT, 3);
  assert.equal(fg.reicheEin(db, BUILDER, { id }, kanaele).status, 409);
  const v = vorbereitet();
  const r = fg.reicheEin(v.db, BUILDER, { id: v.id }, kanaele, JETZT);
  assert.equal(r.ok, true); assert.equal(r.wert.aenderungen, 2);
  assert.equal(status(v.db, v.id), "freigabe");
  assert.equal(ex.detail(v.db, v.id, v.p, JETZT, EINST).wert.status, "approval");
  assert.equal(fg.reicheEin(v.db, BUILDER, { id: v.id }, kanaele).status, 409, "nicht zweimal einreichen");
  assert.equal(zaehle(v.db, "SELECT COUNT(*) n FROM protokoll WHERE aktion = 'change_proposed'"), 2);
  assert.equal(ex.setzeTitel(v.db, { id: v.id, number: "100", neu: "Anderer Titel" }, EINST).status, 409, "Titel sind während der Freigabe gesperrt");
});

test("Einreichen: ein Angebot, das keinem eBay-Artikel eindeutig zugeordnet werden kann, stoppt alles", () => {
  const v = vorbereitet();
  const r = fg.reicheEin(v.db, BUILDER, { id: v.id }, (n) => [{ external_id: "1", title: "A" }, { external_id: "2", title: "B" }]);
  assert.equal(r.status, 409); assert.match(r.fehler, /Cannot match/);
  assert.equal(status(v.db, v.id), "vorbereitet");
  assert.equal(zaehle(v.db, "SELECT COUNT(*) n FROM aenderung"), 0);
});

// ---------- Freigeben ----------
test("Freigabe: ein Builder kann nichts freigeben, und bei eBay passiert nichts", async () => {
  const v = vorbereitet(); fg.reicheEin(v.db, BUILDER, { id: v.id }, kanaele, JETZT);
  const s = ersatzSchreiber(v.ebay);
  const r = await fg.erteile(v.db, BUILDER, { id: v.id, art: "titel" }, s, v.p, JETZT);
  assert.equal(r.status, 403);
  assert.equal(fg.lehneAb(v.db, BUILDER, { id: v.id, art: "titel" }).status, 403);
  assert.deepEqual(s.aufrufe, { lies: 0, schreibe: [] });
});

test("Freigabe: der Admin gibt frei, eBay wird geändert, jede Änderung steht mit altem und neuem Titel im Protokoll, der Test startet", async () => {
  const v = vorbereitet(); fg.reicheEin(v.db, BUILDER, { id: v.id }, kanaele, JETZT);
  const s = ersatzSchreiber(v.ebay);
  const r = await fg.erteile(v.db, ADMIN, { id: v.id, art: "titel" }, s, v.p, JETZT);
  assert.equal(r.ok, true);
  assert.deepEqual([r.wert.angewendet, r.wert.fehlgeschlagen, r.wert.gestartet], [2, 0, true]);
  assert.equal(s.aufrufe.schreibe.length, 2);
  for (const [id, titel] of s.aufrufe.schreibe) assert.match(titel, / NEW$/), assert.match(v.ebay.get(id), / NEW$/);
  assert.equal(status(v.db, v.id), "laeuft");
  const log = protokoll.liste(v.db, 100).filter((z) => z.aktion === "ebay_changed");
  assert.equal(log.length, 2);
  for (const z of log) { assert.equal(z.benutzer, "niko"); assert.equal(z.ergebnis, "ok"); assert.match(z.details.neu, / NEW$/); assert.ok(z.details.alt && !z.details.alt.endsWith("NEW")); assert.equal(z.details.ack, "Success"); }
  assert.ok(protokoll.liste(v.db, 100).some((z) => z.aktion === "change_approved"));
  assert.equal((await fg.erteile(v.db, ADMIN, { id: v.id, art: "titel" }, s, v.p, JETZT)).status, 409, "ein zweites Mal gibt es nichts mehr freizugeben");
});

test("Freigabe: ohne EBAY_SCHREIBEN=an ist es nur ein Probelauf, nichts wird geschrieben und der Test startet nicht", async () => {
  const v = vorbereitet(); fg.reicheEin(v.db, BUILDER, { id: v.id }, kanaele, JETZT);
  const s = ersatzSchreiber(v.ebay, { an: false });
  const r = await fg.erteile(v.db, ADMIN, { id: v.id, art: "titel" }, s, v.p, JETZT);
  assert.deepEqual([r.wert.probelauf, r.wert.angewendet, r.wert.gestartet], [2, 0, false]);
  assert.equal(s.aufrufe.schreibe.length, 0);
  assert.equal(status(v.db, v.id), "freigabe");
  assert.equal(zaehle(v.db, "SELECT COUNT(*) n FROM aenderung WHERE status = 'offen'"), 2);
  assert.equal(zaehle(v.db, "SELECT COUNT(*) n FROM protokoll WHERE aktion = 'ebay_dry_run' AND ergebnis = 'dry_run'"), 2);
});

test("Freigabe: wurde der Titel bei eBay inzwischen von Hand geändert, wird nichts überschrieben", async () => {
  const v = vorbereitet(); fg.reicheEin(v.db, BUILDER, { id: v.id }, kanaele, JETZT);
  const erster = v.db.prepare("SELECT item_id FROM aenderung ORDER BY id").get().item_id;
  v.ebay.set(erster, "Von Hand geänderter Titel");
  const s = ersatzSchreiber(v.ebay);
  const r = await fg.erteile(v.db, ADMIN, { id: v.id, art: "titel" }, s, v.p, JETZT);
  assert.deepEqual([r.wert.angewendet, r.wert.fehlgeschlagen, r.wert.gestartet], [1, 1, false]);
  assert.equal(v.ebay.get(erster), "Von Hand geänderter Titel");
  assert.equal(status(v.db, v.id), "freigabe", "der Test startet erst, wenn alle Titel geändert sind");
  assert.equal(protokoll.liste(v.db, 100).filter((z) => z.aktion === "ebay_refused")[0].ergebnis, "refused");
  // Der Admin stellt den erwarteten Titel wieder her und versucht es erneut: nur die fehlgeschlagene Änderung läuft noch einmal.
  v.ebay.set(erster, v.db.prepare("SELECT alt FROM aenderung WHERE item_id = ?").get(erster).alt);
  const r2 = await fg.erteile(v.db, ADMIN, { id: v.id, art: "titel" }, s, v.p, JETZT);
  assert.deepEqual([r2.wert.angewendet, r2.wert.gestartet], [1, true]);
  assert.equal(s.aufrufe.schreibe.length, 2, "die erste Änderung wurde nicht noch einmal geschrieben");
});

test("Freigabe: lehnt eBay die Änderung ab, wird die Meldung festgehalten und der Test bleibt in der Freigabe", async () => {
  const v = vorbereitet(); fg.reicheEin(v.db, BUILDER, { id: v.id }, kanaele, JETZT);
  const r = await fg.erteile(v.db, ADMIN, { id: v.id, art: "titel" }, ersatzSchreiber(v.ebay, { ablehnen: "[21916] Title cannot be changed" }), v.p, JETZT);
  assert.deepEqual([r.wert.angewendet, r.wert.fehlgeschlagen, r.wert.gestartet], [0, 2, false]);
  const z = v.db.prepare("SELECT status, ergebnis FROM aenderung").get();
  assert.equal(z.status, "fehlgeschlagen"); assert.match(z.ergebnis, /Title cannot be changed/);
  assert.equal(status(v.db, v.id), "freigabe");
});

test("Freigabe: dieselbe Freigabe läuft nie zweimal gleichzeitig", async () => {
  const v = vorbereitet(); fg.reicheEin(v.db, BUILDER, { id: v.id }, kanaele, JETZT);
  const s = ersatzSchreiber(v.ebay, { langsam: true });
  const [a, b] = await Promise.all([fg.erteile(v.db, ADMIN, { id: v.id, art: "titel" }, s, v.p, JETZT), fg.erteile(v.db, ADMIN, { id: v.id, art: "titel" }, s, v.p, JETZT)]);
  assert.deepEqual([a.ok, b.ok].sort(), [false, true]);
  assert.equal(s.aufrufe.schreibe.length, 2, "jeder Titel wurde genau einmal geschrieben");
});

// ---------- Ablehnen ----------
test("Ablehnen: nichts wird bei eBay geändert, der Test geht zurück zu \"vorbereitet\" und die Titel sind wieder bearbeitbar", () => {
  const v = vorbereitet(); fg.reicheEin(v.db, BUILDER, { id: v.id }, kanaele, JETZT);
  const r = fg.lehneAb(v.db, ADMIN, { id: v.id, art: "titel", grund: "Titles too long" }, JETZT);
  assert.equal(r.ok, true);
  assert.equal(status(v.db, v.id), "vorbereitet");
  assert.equal(zaehle(v.db, "SELECT COUNT(*) n FROM aenderung WHERE status = 'abgelehnt'"), 2);
  assert.equal(protokoll.liste(v.db, 20).find((z) => z.aktion === "change_rejected").details.grund, "Titles too long");
  assert.equal(ex.setzeTitel(v.db, { id: v.id, number: v.db.prepare("SELECT number FROM experiment_angebot WHERE gruppe = 'test'").get().number, neu: "Neuer Versuch" }, EINST).ok, true);
});

// ---------- Zurück auf die alten Titel ----------
test("Revert: ein geschlossener Test erzeugt Rückänderungen, die wieder ein Admin freigeben muss", async () => {
  const v = vorbereitet(); fg.reicheEin(v.db, BUILDER, { id: v.id }, kanaele, JETZT);
  const s = ersatzSchreiber(v.ebay);
  await fg.erteile(v.db, ADMIN, { id: v.id, art: "titel" }, s, v.p, JETZT);
  const vorher = new Map(v.db.prepare("SELECT item_id, alt FROM aenderung WHERE art = 'titel'").all().map((z) => [z.item_id, z.alt]));
  ex.schliesse(v.db, { id: v.id, abschluss: "zurueck" }, JETZT);
  fg.beimAbschluss(v.db, BUILDER, v.id, "zurueck", JETZT);
  assert.equal(zaehle(v.db, "SELECT COUNT(*) n FROM aenderung WHERE art = 'zurueck' AND status = 'offen'"), 2);
  for (const id of vorher.keys()) assert.match(v.ebay.get(id), / NEW$/, "ohne Freigabe bleibt der neue Titel bei eBay stehen");
  const r = await fg.erteile(v.db, ADMIN, { id: v.id, art: "zurueck" }, s, v.p, JETZT);
  assert.equal(r.wert.angewendet, 2);
  for (const [id, alt] of vorher) assert.equal(v.ebay.get(id), alt, "der alte Titel steht wieder bei eBay");
  assert.equal(protokoll.liste(v.db, 100).filter((z) => z.aktion === "ebay_changed" && z.details.art === "zurueck").length, 2);
});

test("Revert: wird ein Test in der Freigabe verworfen, entstehen keine Rückänderungen, die offenen Vorschläge sind verworfen", () => {
  const v = vorbereitet(); fg.reicheEin(v.db, BUILDER, { id: v.id }, kanaele, JETZT);
  ex.schliesse(v.db, { id: v.id, abschluss: "zurueck" }, JETZT);
  fg.beimAbschluss(v.db, BUILDER, v.id, "zurueck", JETZT);
  assert.equal(zaehle(v.db, "SELECT COUNT(*) n FROM aenderung WHERE art = 'zurueck'"), 0);
  assert.equal(zaehle(v.db, "SELECT COUNT(*) n FROM aenderung WHERE status = 'verworfen'"), 2);
});

// ---------- eBay-Schreiber ----------
test("eBay-Schreiber: ohne EBAY_SCHREIBEN=an wird nie geschrieben, auch nicht aus Versehen", async () => {
  let aufrufe = 0;
  const s = erzeuge({ env: { EBAY_APP_ID: "a", EBAY_CERT_ID: "b", EBAY_REFRESH_TOKEN: "c" }, fetchFn: async () => { aufrufe++; throw new Error("kein Netz erwartet"); } });
  const r = await s.setzeTitel("123456789012", "Titel");
  assert.equal(r.ok, false); assert.match(r.meldung, /switched off/);
  assert.equal(aufrufe, 0);
});

test("eBay-Schreiber: Titel werden für XML maskiert, und eBay-Fehler kommen als Meldung zurück", async () => {
  const gesendet = [];
  const antwort = (text, status = 200) => ({ status, ok: status === 200, json: async () => JSON.parse(text), text: async () => text });
  const fetchFn = async (url, o) => {
    if (String(url).includes("oauth2/token")) return antwort(JSON.stringify({ access_token: "t", expires_in: 7200 }));
    gesendet.push(o.body);
    return antwort(`<Ack>Failure</Ack><Errors><ErrorCode>21916</ErrorCode><SeverityCode>Error</SeverityCode><LongMessage>Title cannot be changed &amp; more</LongMessage></Errors>`);
  };
  const s = erzeuge({ env: { EBAY_APP_ID: "a", EBAY_CERT_ID: "b", EBAY_REFRESH_TOKEN: "c", EBAY_SCHREIBEN: "an" }, fetchFn });
  const r = await s.setzeTitel("123456789012", "A & B <neu>");
  assert.match(gesendet[0], /<Title>A &amp; B &lt;neu&gt;<\/Title>/);
  assert.equal(r.ok, false); assert.match(r.meldung, /21916.*Title cannot be changed & more/);
});

// ---------- Obergrenze pro Freigabe ----------
test("Obergrenze: mehr als MAX_AENDERUNGEN (50) Änderungen auf einmal werden schon beim Einreichen abgelehnt, nichts wird angelegt", () => {
  const { db, id } = vorbereitet();
  const viele = (nummer) => Array.from({ length: fg.MAX_AENDERUNGEN + 1 }, (_, i) => ({ external_id: "9" + String(i).padStart(8, "0"), title: `Holder for device ${Number(nummer) - 100}` }));
  const r = fg.reicheEin(db, BUILDER, { id }, (n) => viele(n), JETZT);
  assert.equal(r.ok, false); assert.equal(r.status, 409); assert.match(r.fehler, new RegExp(`at most ${fg.MAX_AENDERUNGEN} `));
  assert.equal(zaehle(db, "SELECT COUNT(*) n FROM aenderung"), 0);
  assert.equal(status(db, id), "vorbereitet");
});

test("Obergrenze: auch beim Freigeben, falls doch zu viele offen sind (z. B. von Hand eingetragen), wird nichts bei eBay geändert", async () => {
  const { db, id, p, ebay } = vorbereitet();
  const ins = db.prepare("INSERT INTO aenderung (experiment_id, number, item_id, art, alt, neu, status, vorgeschlagen_von, vorgeschlagen_at) VALUES (?, '100', ?, 'titel', 'a', 'b', 'offen', 'anna', ?)");
  for (let i = 0; i < fg.MAX_AENDERUNGEN + 1; i++) ins.run(id, "9" + String(i).padStart(8, "0"), JETZT.toISOString());
  const s = ersatzSchreiber(ebay);
  const r = await fg.erteile(db, ADMIN, { id, art: "titel" }, s, p, JETZT);
  assert.equal(r.ok, false); assert.equal(r.status, 409);
  assert.equal(s.aufrufe.lies, 0); assert.equal(s.aufrufe.schreibe.length, 0);
});

// ---------- Zustandsautomat der Freigabe (Checkliste A3.7) ----------
// offen/fehlgeschlagen → angewendet | abgelehnt | verworfen. Aus einem Endzustand führt kein Weg zurück: unerlaubte Übergänge liefern 409.
const zustaende = (db) => db.prepare("SELECT status FROM aenderung ORDER BY id").all().map((z) => z.status);

test("Zustandsautomat: abgelehnt ist endgültig, erneut ablehnen oder freigeben liefert 409, bei eBay passiert nichts", async () => {
  const v = vorbereitet(); fg.reicheEin(v.db, BUILDER, { id: v.id }, kanaele, JETZT);
  assert.equal(fg.lehneAb(v.db, ADMIN, { id: v.id, art: "titel" }, JETZT).ok, true);
  assert.deepEqual(zustaende(v.db), ["abgelehnt", "abgelehnt"]);
  assert.equal(fg.lehneAb(v.db, ADMIN, { id: v.id, art: "titel" }, JETZT).status, 409, "nicht zweimal ablehnen");
  const s = ersatzSchreiber(v.ebay);
  assert.equal((await fg.erteile(v.db, ADMIN, { id: v.id, art: "titel" }, s, v.p, JETZT)).status, 409, "Abgelehntes kann nicht nachträglich freigegeben werden");
  assert.deepEqual(s.aufrufe, { lies: 0, schreibe: [] });
  assert.deepEqual(zustaende(v.db), ["abgelehnt", "abgelehnt"]);
});

test("Zustandsautomat: angewendet ist endgültig, freigeben 409, ablehnen 409, auch wenn erst ein Teil live ist", async () => {
  const v = vorbereitet(); fg.reicheEin(v.db, BUILDER, { id: v.id }, kanaele, JETZT);
  const erster = v.db.prepare("SELECT item_id FROM aenderung ORDER BY id").get().item_id;
  v.ebay.set(erster, "Von Hand geändert");   // der erste wird verweigert, der zweite geht live
  const s = ersatzSchreiber(v.ebay);
  await fg.erteile(v.db, ADMIN, { id: v.id, art: "titel" }, s, v.p, JETZT);
  assert.deepEqual(zustaende(v.db), ["fehlgeschlagen", "angewendet"]);
  const r = fg.lehneAb(v.db, ADMIN, { id: v.id, art: "titel" }, JETZT);
  assert.equal(r.status, 409, "teilweise live: Ablehnen würde eBay und App auseinanderlaufen lassen"); assert.match(r.fehler, /already live/);
  assert.deepEqual(zustaende(v.db), ["fehlgeschlagen", "angewendet"], "nichts verändert");
  v.ebay.set(erster, v.db.prepare("SELECT alt FROM aenderung WHERE item_id = ?").get(erster).alt);
  await fg.erteile(v.db, ADMIN, { id: v.id, art: "titel" }, s, v.p, JETZT);
  assert.deepEqual(zustaende(v.db), ["angewendet", "angewendet"]);
  assert.equal((await fg.erteile(v.db, ADMIN, { id: v.id, art: "titel" }, s, v.p, JETZT)).status, 409);
  assert.equal(fg.lehneAb(v.db, ADMIN, { id: v.id, art: "titel" }, JETZT).status, 409, "Angewendetes kann nicht mehr abgelehnt werden");
  assert.equal(s.aufrufe.schreibe.length, 2, "jeder Titel genau einmal geschrieben");
});

test("Zustandsautomat: verworfen (Test vor der Freigabe geschlossen) ist endgültig, freigeben und ablehnen liefern 409", async () => {
  const v = vorbereitet(); fg.reicheEin(v.db, BUILDER, { id: v.id }, kanaele, JETZT);
  ex.schliesse(v.db, { id: v.id, abschluss: "behalten" }, JETZT); fg.beimAbschluss(v.db, ADMIN, v.id, "behalten", JETZT);
  assert.deepEqual(zustaende(v.db), ["verworfen", "verworfen"]);
  const s = ersatzSchreiber(v.ebay);
  assert.equal((await fg.erteile(v.db, ADMIN, { id: v.id, art: "titel" }, s, v.p, JETZT)).status, 409);
  assert.equal(fg.lehneAb(v.db, ADMIN, { id: v.id, art: "titel" }, JETZT).status, 409);
  assert.equal(s.aufrufe.lies, 0);
});

test("Eingaben: Test-Id nur als positive ganze Zahl, Art nur titel/zurueck, eBay-Artikelnummer nur aus Ziffern", async () => {
  const v = vorbereitet();
  for (const id of ["1", 0, -1, 1.5, null, [1]]) {
    assert.equal(fg.reicheEin(v.db, BUILDER, { id }, kanaele).status, 400, String(id));
    assert.equal((await fg.erteile(v.db, ADMIN, { id, art: "titel" }, ersatzSchreiber(v.ebay), v.p)).status, 400, String(id));
    assert.equal(fg.lehneAb(v.db, ADMIN, { id, art: "titel" }).status, 400, String(id));
  }
  for (const art of ["loeschen", "", null, "TITEL"]) assert.equal(fg.lehneAb(v.db, ADMIN, { id: v.id, art }).status, 400, String(art));
  for (const e of [null, [], "x", 5]) assert.equal(fg.reicheEin(v.db, BUILDER, e, kanaele).status, 400);
  for (const nr of ["12345abc", "123", "1".repeat(21), "123456789012; DROP", "-123456789"]) {
    const r = fg.reicheEin(v.db, BUILDER, { id: v.id }, (n) => [{ external_id: nr, title: `Holder for device ${Number(n) - 100}` }], JETZT);
    assert.equal(r.status, 409, nr); assert.match(r.fehler, /invalid eBay item number/);
  }
  assert.equal(zaehle(v.db, "SELECT COUNT(*) n FROM aenderung"), 0, "nichts angelegt");
  assert.equal(status(v.db, v.id), "vorbereitet");
});

// ---------- eBay-Schreibweg: ein Test je Riegel (Checkliste A3.11) ----------
test("eBay-Riegel 1: ohne alle drei Zugangsdaten geht kein Aufruf raus, auch mit EBAY_SCHREIBEN=an", async () => {
  let aufrufe = 0;
  const fetchFn = async () => { aufrufe++; throw new Error("kein Netz erwartet"); };
  for (const env of [{}, { EBAY_APP_ID: "a", EBAY_CERT_ID: "b" }, { EBAY_APP_ID: "a", EBAY_REFRESH_TOKEN: "c" }, { EBAY_CERT_ID: "b", EBAY_REFRESH_TOKEN: "c" }]) {
    const s = erzeuge({ env: { ...env, EBAY_SCHREIBEN: "an" }, fetchFn });
    assert.equal(s.konfiguriert(), false, JSON.stringify(env));
    await assert.rejects(s.setzeTitel("123456789012", "Titel"), /credentials/);
    await assert.rejects(s.lies("123456789012"), /credentials/);
  }
  assert.equal(aufrufe, 0);
});

test("eBay-Riegel 2: nur genau EBAY_SCHREIBEN=an schaltet das Schreiben ein", () => {
  const an = (w) => erzeuge({ env: { EBAY_SCHREIBEN: w } }).schreibenAn();
  for (const w of [undefined, "", "aus", "ja", "true", "1", "on", "an!", "ann"]) assert.equal(an(w), false, String(w));
  for (const w of ["an", " AN ", "An"]) assert.equal(an(w), true, w);
});

test("eBay-Riegel 3: Lesen vor Schreiben mit dem echten Schreiber — weicht der Titel bei eBay ab, geht kein ReviseFixedPriceItem raus", async () => {
  const v = vorbereitet(); fg.reicheEin(v.db, BUILDER, { id: v.id }, kanaele, JETZT);
  const items = v.db.prepare("SELECT item_id, alt FROM aenderung ORDER BY id").all();
  const aufrufe = [];
  const antwort = (text) => ({ status: 200, ok: true, json: async () => JSON.parse(text), text: async () => text });
  const titelBeiEbay = new Map([[items[0].item_id, "Von Hand geändert"], [items[1].item_id, items[1].alt]]);
  const fetchFn = async (url, o) => {
    if (String(url).includes("oauth2/token")) { aufrufe.push("token"); return antwort(JSON.stringify({ access_token: "t", expires_in: 7200 })); }
    const call = o.headers["X-EBAY-API-CALL-NAME"]; const id = o.body.match(/<ItemID>(\d+)<\/ItemID>/)[1];
    aufrufe.push(call + " " + id);
    if (call === "GetItem") return antwort(`<Ack>Success</Ack><Item><Title>${titelBeiEbay.get(id)}</Title><SellingStatus><QuantitySold>3</QuantitySold><ListingStatus>Active</ListingStatus></SellingStatus></Item>`);
    return antwort("<Ack>Success</Ack>");
  };
  const s = erzeuge({ env: { EBAY_APP_ID: "a", EBAY_CERT_ID: "b", EBAY_REFRESH_TOKEN: "c", EBAY_SCHREIBEN: "an" }, fetchFn });
  const r = await fg.erteile(v.db, ADMIN, { id: v.id, art: "titel" }, s, v.p, JETZT);
  assert.deepEqual([r.wert.angewendet, r.wert.fehlgeschlagen], [1, 1]);
  assert.deepEqual(aufrufe, ["token", `GetItem ${items[0].item_id}`, `GetItem ${items[1].item_id}`, `ReviseFixedPriceItem ${items[1].item_id}`],
    "erst lesen, dann nur das Angebot mit dem erwarteten Titel schreiben");
});

test("eBay-Riegel 4: jeder Ausgang steht im Protokoll — freigegeben, verweigert, Lesefehler, Probelauf, geändert", async () => {
  const v = vorbereitet(); fg.reicheEin(v.db, BUILDER, { id: v.id }, kanaele, JETZT);
  const [a, b] = v.db.prepare("SELECT item_id, alt FROM aenderung ORDER BY id").all();
  v.ebay.set(a.item_id, "Von Hand geändert"); v.ebay.delete(b.item_id);
  await fg.erteile(v.db, ADMIN, { id: v.id, art: "titel" }, ersatzSchreiber(v.ebay), v.p, JETZT);
  v.ebay.set(a.item_id, a.alt); v.ebay.set(b.item_id, b.alt);
  await fg.erteile(v.db, ADMIN, { id: v.id, art: "titel" }, ersatzSchreiber(v.ebay, { an: false }), v.p, JETZT);
  await fg.erteile(v.db, ADMIN, { id: v.id, art: "titel" }, ersatzSchreiber(v.ebay), v.p, JETZT);
  const log = protokoll.liste(v.db, 100).reverse().filter((z) => z.aktion.startsWith("ebay_") || z.aktion === "change_approved");
  assert.deepEqual(log.map((z) => [z.aktion, z.objekt, z.ergebnis]), [
    ["change_approved", `test ${v.id} (titel)`, "ok"], ["ebay_refused", "item " + a.item_id, "refused"], ["ebay_failed", "item " + b.item_id, "error"],
    ["change_approved", `test ${v.id} (titel)`, "ok"], ["ebay_dry_run", "item " + a.item_id, "dry_run"], ["ebay_dry_run", "item " + b.item_id, "dry_run"],
    ["change_approved", `test ${v.id} (titel)`, "ok"], ["ebay_changed", "item " + a.item_id, "ok"], ["ebay_changed", "item " + b.item_id, "ok"],
  ]);
  assert.ok(log.every((z) => z.benutzer === "niko" && z.rolle === "admin"), "wer es ausgelöst hat, steht dabei");
  assert.equal(log.find((z) => z.aktion === "ebay_refused").details.aktuell_bei_ebay, "Von Hand geändert");
});
