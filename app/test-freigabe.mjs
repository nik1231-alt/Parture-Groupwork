// Tests for roles, approval and log. Nothing is ever written to eBay: the writer here is a substitute in memory.
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

// A test with all titles, ready to submit. Returns { db, id, ebay } (ebay = what is currently "on eBay").
function vorbereitet() {
  const db = baseDb();
  const p = produkte();
  const { wert: { id } } = ex.legeAn(db, { name: "T" }, p, EINST, JETZT, 7);
  for (const a of db.prepare("SELECT number, alt FROM experiment_angebot WHERE experiment_id = ? AND gruppe = 'test'").all(id)) ex.setzeTitel(db, { id, number: a.number, neu: a.alt + " NEW" }, EINST);
  const ebay = new Map();
  for (const a of db.prepare("SELECT number, alt FROM experiment_angebot WHERE experiment_id = ?").all(id)) ebay.set("9000" + a.number + "00", a.alt);
  return { db, id, p, ebay };
}
// Substitute for ebay-schreiben.mjs
function ersatzSchreiber(ebay, { an = true, ablehnen = null, langsam = false } = {}) {
  const aufrufe = { lies: 0, schreibe: [] };
  return { aufrufe, schreibenAn: () => an, konfiguriert: () => true,
    async lies(id) { aufrufe.lies++; if (langsam) await new Promise((r) => setTimeout(r, 40)); return ebay.has(id) ? { ok: true, titel: ebay.get(id), status: "Active", verkauft: 3 } : { ok: false, meldung: "not found" }; },
    async setzeTitel(id, titel) { if (ablehnen) return { ok: false, ack: "Failure", meldung: ablehnen }; aufrufe.schreibe.push([id, titel]); ebay.set(id, titel); return { ok: true, ack: "Success", meldung: "" }; } };
}
const status = (db, id) => db.prepare("SELECT status FROM experiment WHERE id = ?").get(id).status;
const zaehle = (db, sql, ...a) => db.prepare(sql).get(...a).n;

// ---------- Rollen ----------
test("Roles: new users are builders, when retrofitting the oldest user becomes admin", () => {
  const d = new Database(":memory:"); login.bereiteVor(d);
  login.legeBenutzerAn(d, "niko", "ein-langes-passwort", new Date("2026-11-01T10:00:00Z"));
  login.legeBenutzerAn(d, "anna", "ein-langes-passwort", new Date("2026-11-02T10:00:00Z"));
  rollen.bereiteVor(d);
  assert.equal(rollen.rolleVon(d, "niko"), "admin");
  assert.equal(rollen.rolleVon(d, "anna"), "builder");
  login.legeBenutzerAn(d, "ben", "ein-langes-passwort");
  assert.equal(rollen.rolleVon(d, "ben"), "builder");
  rollen.bereiteVor(d); // a second run changes nothing
  assert.equal(rollen.anzahlAdmins(d), 1);
});

test("Roles: only an admin assigns roles, there is always one admin, every change is logged", () => {
  const d = baseDb(); login.legeBenutzerAn(d, "niko", "ein-langes-passwort"); login.legeBenutzerAn(d, "anna", "ein-langes-passwort");
  rollen.legeFest(d, "niko", "admin");
  assert.equal(rollen.setzeRolle(d, BUILDER, "anna", "admin").status, 403, "a builder may not assign roles");
  assert.equal(rollen.rolleVon(d, "anna"), "builder");
  assert.equal(rollen.setzeRolle(d, ADMIN, "anna", "chef").status, 400);
  assert.equal(rollen.setzeRolle(d, ADMIN, "gibtesnicht", "admin").status, 404);
  assert.equal(rollen.setzeRolle(d, ADMIN, "niko", "builder").status, 409, "the last admin cannot give up the role");
  assert.equal(rollen.setzeRolle(d, ADMIN, "anna", "admin").ok, true);
  assert.equal(rollen.setzeRolle(d, ADMIN, "niko", "builder").ok, true, "with a second admin it is allowed");
  const l = protokoll.liste(d);
  assert.deepEqual(l.map((z) => z.aktion), ["role_changed", "role_changed"]);
  assert.deepEqual(l[1].details, { von: "builder", zu: "admin" });
  assert.equal(l[1].benutzer, "niko");
});

test("Log: it is append-only, changing and deleting fail", () => {
  const d = baseDb();
  protokoll.schreibe(d, { benutzer: "niko", rolle: "admin", aktion: "x", ergebnis: "ok" });
  assert.throws(() => d.prepare("UPDATE protokoll SET benutzer = 'anna'").run(), /append-only/);
  assert.throws(() => d.prepare("DELETE FROM protokoll").run(), /append-only/);
  assert.equal(zaehle(d, "SELECT COUNT(*) n FROM protokoll"), 1);
});

// ---------- Einreichen ----------
test("Submit: not possible without all titles, with all titles the test is marked for approval", () => {
  const db = baseDb(); const { wert: { id } } = ex.legeAn(db, {}, produkte(), EINST, JETZT, 3);
  assert.equal(fg.reicheEin(db, BUILDER, { id }, kanaele).status, 409);
  const v = vorbereitet();
  const r = fg.reicheEin(v.db, BUILDER, { id: v.id }, kanaele, JETZT);
  assert.equal(r.ok, true); assert.equal(r.wert.aenderungen, 2);
  assert.equal(status(v.db, v.id), "freigabe");
  assert.equal(ex.detail(v.db, v.id, v.p, JETZT, EINST).wert.status, "approval");
  assert.equal(fg.reicheEin(v.db, BUILDER, { id: v.id }, kanaele).status, 409, "do not submit twice");
  assert.equal(zaehle(v.db, "SELECT COUNT(*) n FROM protokoll WHERE aktion = 'change_proposed'"), 2);
  assert.equal(ex.setzeTitel(v.db, { id: v.id, number: "100", neu: "Anderer Titel" }, EINST).status, 409, "titles are locked during the approval");
});

test("Submit: a listing that cannot be assigned to one eBay item stops everything", () => {
  const v = vorbereitet();
  const r = fg.reicheEin(v.db, BUILDER, { id: v.id }, (n) => [{ external_id: "1", title: "A" }, { external_id: "2", title: "B" }]);
  assert.equal(r.status, 409); assert.match(r.fehler, /Cannot match/);
  assert.equal(status(v.db, v.id), "vorbereitet");
  assert.equal(zaehle(v.db, "SELECT COUNT(*) n FROM aenderung"), 0);
});

// ---------- Freigeben ----------
test("Approval: a builder cannot approve anything, and nothing happens on eBay", async () => {
  const v = vorbereitet(); fg.reicheEin(v.db, BUILDER, { id: v.id }, kanaele, JETZT);
  const s = ersatzSchreiber(v.ebay);
  const r = await fg.erteile(v.db, BUILDER, { id: v.id, art: "titel" }, s, v.p, JETZT);
  assert.equal(r.status, 403);
  assert.equal(fg.lehneAb(v.db, BUILDER, { id: v.id, art: "titel" }).status, 403);
  assert.deepEqual(s.aufrufe, { lies: 0, schreibe: [] });
});

test("Approval: the admin approves, eBay is changed, every change is in the log with old and new title, the test starts", async () => {
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
  assert.equal((await fg.erteile(v.db, ADMIN, { id: v.id, art: "titel" }, s, v.p, JETZT)).status, 409, "the second time there is nothing left to approve");
});

test("Approval: without EBAY_SCHREIBEN=an it is only a dry run, nothing is written and the test does not start", async () => {
  const v = vorbereitet(); fg.reicheEin(v.db, BUILDER, { id: v.id }, kanaele, JETZT);
  const s = ersatzSchreiber(v.ebay, { an: false });
  const r = await fg.erteile(v.db, ADMIN, { id: v.id, art: "titel" }, s, v.p, JETZT);
  assert.deepEqual([r.wert.probelauf, r.wert.angewendet, r.wert.gestartet], [2, 0, false]);
  assert.equal(s.aufrufe.schreibe.length, 0);
  assert.equal(status(v.db, v.id), "freigabe");
  assert.equal(zaehle(v.db, "SELECT COUNT(*) n FROM aenderung WHERE status = 'offen'"), 2);
  assert.equal(zaehle(v.db, "SELECT COUNT(*) n FROM protokoll WHERE aktion = 'ebay_dry_run' AND ergebnis = 'dry_run'"), 2);
});

test("Approval: if the title was changed by hand on eBay in the meantime, nothing is overwritten", async () => {
  const v = vorbereitet(); fg.reicheEin(v.db, BUILDER, { id: v.id }, kanaele, JETZT);
  const erster = v.db.prepare("SELECT item_id FROM aenderung ORDER BY id").get().item_id;
  v.ebay.set(erster, "Von Hand geänderter Titel");
  const s = ersatzSchreiber(v.ebay);
  const r = await fg.erteile(v.db, ADMIN, { id: v.id, art: "titel" }, s, v.p, JETZT);
  assert.deepEqual([r.wert.angewendet, r.wert.fehlgeschlagen, r.wert.gestartet], [1, 1, false]);
  assert.equal(v.ebay.get(erster), "Von Hand geänderter Titel");
  assert.equal(status(v.db, v.id), "freigabe", "the test starts only when all titles are changed");
  assert.equal(protokoll.liste(v.db, 100).filter((z) => z.aktion === "ebay_refused")[0].ergebnis, "refused");
  // The admin restores the expected title and tries again: only the failed change runs once more.
  v.ebay.set(erster, v.db.prepare("SELECT alt FROM aenderung WHERE item_id = ?").get(erster).alt);
  const r2 = await fg.erteile(v.db, ADMIN, { id: v.id, art: "titel" }, s, v.p, JETZT);
  assert.deepEqual([r2.wert.angewendet, r2.wert.gestartet], [1, true]);
  assert.equal(s.aufrufe.schreibe.length, 2, "the first change was not written again");
});

test("Approval: if eBay rejects the change, the message is kept and the test stays in approval", async () => {
  const v = vorbereitet(); fg.reicheEin(v.db, BUILDER, { id: v.id }, kanaele, JETZT);
  const r = await fg.erteile(v.db, ADMIN, { id: v.id, art: "titel" }, ersatzSchreiber(v.ebay, { ablehnen: "[21916] Title cannot be changed" }), v.p, JETZT);
  assert.deepEqual([r.wert.angewendet, r.wert.fehlgeschlagen, r.wert.gestartet], [0, 2, false]);
  const z = v.db.prepare("SELECT status, ergebnis FROM aenderung").get();
  assert.equal(z.status, "fehlgeschlagen"); assert.match(z.ergebnis, /Title cannot be changed/);
  assert.equal(status(v.db, v.id), "freigabe");
});

test("Approval: the same approval never runs twice at the same time", async () => {
  const v = vorbereitet(); fg.reicheEin(v.db, BUILDER, { id: v.id }, kanaele, JETZT);
  const s = ersatzSchreiber(v.ebay, { langsam: true });
  const [a, b] = await Promise.all([fg.erteile(v.db, ADMIN, { id: v.id, art: "titel" }, s, v.p, JETZT), fg.erteile(v.db, ADMIN, { id: v.id, art: "titel" }, s, v.p, JETZT)]);
  assert.deepEqual([a.ok, b.ok].sort(), [false, true]);
  assert.equal(s.aufrufe.schreibe.length, 2, "every title was written exactly once");
});

// ---------- Ablehnen ----------
test("Reject: nothing is changed on eBay, the test goes back to \"prepared\" and the titles are editable again", () => {
  const v = vorbereitet(); fg.reicheEin(v.db, BUILDER, { id: v.id }, kanaele, JETZT);
  const r = fg.lehneAb(v.db, ADMIN, { id: v.id, art: "titel", grund: "Titles too long" }, JETZT);
  assert.equal(r.ok, true);
  assert.equal(status(v.db, v.id), "vorbereitet");
  assert.equal(zaehle(v.db, "SELECT COUNT(*) n FROM aenderung WHERE status = 'abgelehnt'"), 2);
  assert.equal(protokoll.liste(v.db, 20).find((z) => z.aktion === "change_rejected").details.grund, "Titles too long");
  assert.equal(ex.setzeTitel(v.db, { id: v.id, number: v.db.prepare("SELECT number FROM experiment_angebot WHERE gruppe = 'test'").get().number, neu: "Neuer Versuch" }, EINST).ok, true);
});

// ---------- Back to the old titles ----------
test("Revert: a closed test creates reverting changes that an admin must approve again", async () => {
  const v = vorbereitet(); fg.reicheEin(v.db, BUILDER, { id: v.id }, kanaele, JETZT);
  const s = ersatzSchreiber(v.ebay);
  await fg.erteile(v.db, ADMIN, { id: v.id, art: "titel" }, s, v.p, JETZT);
  const vorher = new Map(v.db.prepare("SELECT item_id, alt FROM aenderung WHERE art = 'titel'").all().map((z) => [z.item_id, z.alt]));
  ex.schliesse(v.db, { id: v.id, abschluss: "zurueck" }, JETZT);
  fg.beimAbschluss(v.db, BUILDER, v.id, "zurueck", JETZT);
  assert.equal(zaehle(v.db, "SELECT COUNT(*) n FROM aenderung WHERE art = 'zurueck' AND status = 'offen'"), 2);
  for (const id of vorher.keys()) assert.match(v.ebay.get(id), / NEW$/, "without an approval the new title stays on eBay");
  const r = await fg.erteile(v.db, ADMIN, { id: v.id, art: "zurueck" }, s, v.p, JETZT);
  assert.equal(r.wert.angewendet, 2);
  for (const [id, alt] of vorher) assert.equal(v.ebay.get(id), alt, "the old title is back on eBay");
  assert.equal(protokoll.liste(v.db, 100).filter((z) => z.aktion === "ebay_changed" && z.details.art === "zurueck").length, 2);
});

test("Revert: if a test is discarded during approval, no reverting changes are created, the open proposals are discarded", () => {
  const v = vorbereitet(); fg.reicheEin(v.db, BUILDER, { id: v.id }, kanaele, JETZT);
  ex.schliesse(v.db, { id: v.id, abschluss: "zurueck" }, JETZT);
  fg.beimAbschluss(v.db, BUILDER, v.id, "zurueck", JETZT);
  assert.equal(zaehle(v.db, "SELECT COUNT(*) n FROM aenderung WHERE art = 'zurueck'"), 0);
  assert.equal(zaehle(v.db, "SELECT COUNT(*) n FROM aenderung WHERE status = 'verworfen'"), 2);
});

// ---------- eBay-Schreiber ----------
test("eBay writer: without EBAY_SCHREIBEN=an nothing is ever written, not even by accident", async () => {
  let aufrufe = 0;
  const s = erzeuge({ env: { EBAY_APP_ID: "a", EBAY_CERT_ID: "b", EBAY_REFRESH_TOKEN: "c" }, fetchFn: async () => { aufrufe++; throw new Error("kein Netz erwartet"); } });
  const r = await s.setzeTitel("123456789012", "Titel");
  assert.equal(r.ok, false); assert.match(r.meldung, /switched off/);
  assert.equal(aufrufe, 0);
});

test("eBay writer: titles are escaped for XML, and eBay errors come back as a message", async () => {
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
test("Limit: more than MAX_AENDERUNGEN (50) changes at once are rejected on submitting, nothing is created", () => {
  const { db, id } = vorbereitet();
  const viele = (nummer) => Array.from({ length: fg.MAX_AENDERUNGEN + 1 }, (_, i) => ({ external_id: "9" + String(i).padStart(8, "0"), title: `Holder for device ${Number(nummer) - 100}` }));
  const r = fg.reicheEin(db, BUILDER, { id }, (n) => viele(n), JETZT);
  assert.equal(r.ok, false); assert.equal(r.status, 409); assert.match(r.fehler, new RegExp(`at most ${fg.MAX_AENDERUNGEN} `));
  assert.equal(zaehle(db, "SELECT COUNT(*) n FROM aenderung"), 0);
  assert.equal(status(db, id), "vorbereitet");
});

test("Limit: also when approving, in case too many are open (e.g. entered by hand), nothing is changed on eBay", async () => {
  const { db, id, p, ebay } = vorbereitet();
  const ins = db.prepare("INSERT INTO aenderung (experiment_id, number, item_id, art, alt, neu, status, vorgeschlagen_von, vorgeschlagen_at) VALUES (?, '100', ?, 'titel', 'a', 'b', 'offen', 'anna', ?)");
  for (let i = 0; i < fg.MAX_AENDERUNGEN + 1; i++) ins.run(id, "9" + String(i).padStart(8, "0"), JETZT.toISOString());
  const s = ersatzSchreiber(ebay);
  const r = await fg.erteile(db, ADMIN, { id, art: "titel" }, s, p, JETZT);
  assert.equal(r.ok, false); assert.equal(r.status, 409);
  assert.equal(s.aufrufe.lies, 0); assert.equal(s.aufrufe.schreibe.length, 0);
});

// ---------- State machine of the approval (checklist A3.7) ----------
// open/failed → applied | rejected | discarded. From a final state there is no way back: illegal transitions return 409.
const zustaende = (db) => db.prepare("SELECT status FROM aenderung ORDER BY id").all().map((z) => z.status);

test("State machine: rejected is final, rejecting or approving again returns 409, nothing happens on eBay", async () => {
  const v = vorbereitet(); fg.reicheEin(v.db, BUILDER, { id: v.id }, kanaele, JETZT);
  assert.equal(fg.lehneAb(v.db, ADMIN, { id: v.id, art: "titel" }, JETZT).ok, true);
  assert.deepEqual(zustaende(v.db), ["abgelehnt", "abgelehnt"]);
  assert.equal(fg.lehneAb(v.db, ADMIN, { id: v.id, art: "titel" }, JETZT).status, 409, "do not reject twice");
  const s = ersatzSchreiber(v.ebay);
  assert.equal((await fg.erteile(v.db, ADMIN, { id: v.id, art: "titel" }, s, v.p, JETZT)).status, 409, "something rejected cannot be approved afterwards");
  assert.deepEqual(s.aufrufe, { lies: 0, schreibe: [] });
  assert.deepEqual(zustaende(v.db), ["abgelehnt", "abgelehnt"]);
});

test("State machine: applied is final, approving 409, rejecting 409, even if only part is live", async () => {
  const v = vorbereitet(); fg.reicheEin(v.db, BUILDER, { id: v.id }, kanaele, JETZT);
  const erster = v.db.prepare("SELECT item_id FROM aenderung ORDER BY id").get().item_id;
  v.ebay.set(erster, "Von Hand geändert");   // der erste wird verweigert, der zweite geht live
  const s = ersatzSchreiber(v.ebay);
  await fg.erteile(v.db, ADMIN, { id: v.id, art: "titel" }, s, v.p, JETZT);
  assert.deepEqual(zustaende(v.db), ["fehlgeschlagen", "angewendet"]);
  const r = fg.lehneAb(v.db, ADMIN, { id: v.id, art: "titel" }, JETZT);
  assert.equal(r.status, 409, "partly live: rejecting would let eBay and the app drift apart"); assert.match(r.fehler, /already live/);
  assert.deepEqual(zustaende(v.db), ["fehlgeschlagen", "angewendet"], "nothing changed");
  v.ebay.set(erster, v.db.prepare("SELECT alt FROM aenderung WHERE item_id = ?").get(erster).alt);
  await fg.erteile(v.db, ADMIN, { id: v.id, art: "titel" }, s, v.p, JETZT);
  assert.deepEqual(zustaende(v.db), ["angewendet", "angewendet"]);
  assert.equal((await fg.erteile(v.db, ADMIN, { id: v.id, art: "titel" }, s, v.p, JETZT)).status, 409);
  assert.equal(fg.lehneAb(v.db, ADMIN, { id: v.id, art: "titel" }, JETZT).status, 409, "something applied can no longer be rejected");
  assert.equal(s.aufrufe.schreibe.length, 2, "every title written exactly once");
});

test("State machine: discarded (test closed before approval) is final, approving and rejecting return 409", async () => {
  const v = vorbereitet(); fg.reicheEin(v.db, BUILDER, { id: v.id }, kanaele, JETZT);
  ex.schliesse(v.db, { id: v.id, abschluss: "behalten" }, JETZT); fg.beimAbschluss(v.db, ADMIN, v.id, "behalten", JETZT);
  assert.deepEqual(zustaende(v.db), ["verworfen", "verworfen"]);
  const s = ersatzSchreiber(v.ebay);
  assert.equal((await fg.erteile(v.db, ADMIN, { id: v.id, art: "titel" }, s, v.p, JETZT)).status, 409);
  assert.equal(fg.lehneAb(v.db, ADMIN, { id: v.id, art: "titel" }, JETZT).status, 409);
  assert.equal(s.aufrufe.lies, 0);
});

test("Input: test id only as a positive whole number, kind only titel/zurueck, eBay item number only digits", async () => {
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

// ---------- eBay write path: one test per latch (checklist A3.11) ----------
test("eBay latch 1: without all three credentials no call goes out, even with EBAY_SCHREIBEN=an", async () => {
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

test("eBay latch 2: only exactly EBAY_SCHREIBEN=an switches writing on", () => {
  const an = (w) => erzeuge({ env: { EBAY_SCHREIBEN: w } }).schreibenAn();
  for (const w of [undefined, "", "aus", "ja", "true", "1", "on", "an!", "ann"]) assert.equal(an(w), false, String(w));
  for (const w of ["an", " AN ", "An"]) assert.equal(an(w), true, w);
});

test("eBay latch 3: read before write with the real writer — if the title differs on eBay, no ReviseFixedPriceItem goes out", async () => {
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

test("eBay latch 4: every outcome is in the log — approved, refused, read error, dry run, changed", async () => {
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
  assert.ok(log.every((z) => z.benutzer === "niko" && z.rolle === "admin"), "who triggered it is recorded");
  assert.equal(log.find((z) => z.aktion === "ebay_refused").details.aktuell_bei_ebay, "Von Hand geändert");
});
