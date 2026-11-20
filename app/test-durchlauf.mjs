// End-to-end test (checklist A4.2): the whole path against the real server, the way builders and admins walk it in the interface.
//   A builder logs in -> draws a test -> enters titles -> sends for approval
//   An admin logs in   -> approves (dry run: EBAY_SCHREIBEN off, no credentials) -> log -> test view
// Data: the team copy daten-team/pm.db, read only. Own data (users, tests, log) in a throw-away app.db.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { bereiteVor, legeBenutzerAn } from "./login.mjs";
import * as rollen from "./rollen.mjs";
import { TITEL_MAX_ZEICHEN } from "./regeln.mjs";

const PORT = 4100 + Math.floor(Math.random() * 90);
const verz = fs.mkdtempSync(path.join(os.tmpdir(), "parture-durchlauf-"));
const appdb = path.join(verz, "app.db");
const pmdb = path.join(import.meta.dirname, "..", "daten-team", "pm.db");
{
  const d = new Database(appdb); bereiteVor(d);
  legeBenutzerAn(d, "niko", "ein-langes-passwort", new Date("2026-11-01T10:00:00Z"));
  legeBenutzerAn(d, "anna", "ein-langes-passwort", new Date("2026-11-02T10:00:00Z"));
  rollen.bereiteVor(d); // the oldest user (niko) becomes admin, anna is a builder
  d.close();
}
const basis = `http://127.0.0.1:${PORT}`;
let server;
test.before(async () => {
  // Everything that could talk to the outside or write is empty: no eBay keys, switch off, no Telegram message, no hub
  const env = { ...process.env, PM_OHNE_ENV: "1", PM_PORT: String(PORT), PM_APPDB: appdb, PM_DB: pmdb, PM_UMGEBUNG: "", CF_ACCESS_TEAM_DOMAIN: "", CF_ACCESS_AUD: "",
    EBAY_SCHREIBEN: "", EBAY_APP_ID: "", EBAY_CERT_ID: "", EBAY_REFRESH_TOKEN: "", EBAY_TRAFFIC_AUTO: "", TELEGRAM_BOT_TOKEN: "", TELEGRAM_CHAT_ID: "", HUB_URL: "", PM_TOKEN: "",
    SICHERUNG_AUTO: "aus", SICHERUNG_ORDNER: path.join(verz, "sicherung"), TRAFFIC_CACHE: path.join(verz, "kein-cache.db") };
  server = spawn(process.execPath, [path.join(import.meta.dirname, "server.mjs")], { env, stdio: "ignore" });
  for (let i = 0; i < 900; i++) { try { if ((await fetch(basis + "/healthz")).ok) return; } catch { /* noch nicht bereit */ } await new Promise((r) => setTimeout(r, 100)); }
  throw new Error("Server startet nicht");
});
// First wait for the end of the server, then delete: on Windows the running process keeps app.db open (EBUSY on rmSync)
test.after(async () => {
  if (server && server.exitCode === null) { const weg = new Promise((r) => server.once("exit", r)); server.kill(); await weg; }
  fs.rmSync(verz, { recursive: true, force: true });
});

async function anfrage(methode, p, cookie, body) {
  const r = await fetch(basis + p, { method: methode, headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => null), cookie: r.headers.get("set-cookie") };
}
const get = (p, c) => anfrage("GET", p, c);
const post = (p, c, body = {}) => anfrage("POST", p, c, body);
async function anmelden(name) { const r = await post("/api/login", null, { name, passwort: "ein-langes-passwort" }); assert.equal(r.status, 200, name); return r.cookie.split(";")[0]; }
const daten = (r, status = 200) => { assert.equal(r.status, status, JSON.stringify(r.json)); return r.json.daten; };

test("Full run: builder draws a test, proposes titles, admin approves as a dry run, log and test view are correct", async () => {
  // ---- Builder ----
  const anna = await anmelden("anna");
  assert.equal(daten(await get("/api/ich", anna)).rolle, "builder");
  // Only an admin changes rules: the builder gets 403, the admin sets a small test size (so that the run stays fast)
  assert.equal((await post("/api/einstellungen", anna, { werte: { testGroesse: 4 } })).status, 403);
  daten(await post("/api/einstellungen", await anmelden("niko"), { werte: { testGroesse: 4 } }));
  const uebersicht = daten(await get("/api/experimente", anna));
  assert.equal(uebersicht.titelMaxZeichen, TITEL_MAX_ZEICHEN, "die Oberfläche bekommt die Titellänge vom Server");
  assert.ok(uebersicht.moeglich >= 4, `genug Kandidaten in der Team-Kopie (${uebersicht.moeglich})`);
  const neu = daten(await post("/api/experiment", anna, { name: "End-to-end" }));
  assert.ok(Number.isInteger(neu.id) && Number.isInteger(neu.seed));
  assert.deepEqual([neu.test, neu.kontrolle], [2, 2]);

  let detail = daten(await get("/api/experiment?id=" + neu.id, anna));
  assert.equal(detail.status, "prepared"); assert.equal(detail.seed, neu.seed);
  const testAngebote = detail.angebote.filter((a) => a.gruppe === "test");
  assert.equal(testAngebote.length, 2);
  // Title rule: too long is rejected (400), afterwards one valid new title per test listing
  const zuLang = await post("/api/experiment/titel", anna, { id: neu.id, number: testAngebote[0].number, neu: "x".repeat(TITEL_MAX_ZEICHEN + 1) });
  assert.equal(zuLang.status, 400); assert.match(zuLang.json.error, /too long/);
  const titel = new Map();
  for (const a of testAngebote) {
    const t = ("New " + a.alt).slice(0, TITEL_MAX_ZEICHEN);
    assert.equal(daten(await post("/api/experiment/titel", anna, { id: neu.id, number: a.number, neu: t })).neu, t.replace(/\s+/g, " ").trim());
    titel.set(a.number, { alt: a.alt, neu: t.replace(/\s+/g, " ").trim() });
  }
  const eingereicht = daten(await post("/api/experiment/freigabe", anna, { id: neu.id }));
  assert.ok(eingereicht.aenderungen >= 2, "mindestens ein eBay-Angebot je Testangebot");
  // After "Send for approval" the suggestion is locked, and a builder cannot approve
  assert.equal((await post("/api/experiment/titel", anna, { id: neu.id, number: testAngebote[0].number, neu: "Changed after submit" })).status, 409);
  assert.equal((await post("/api/freigabe/erteilen", anna, { id: neu.id, art: "titel" })).status, 403);
  assert.equal(daten(await get("/api/experiment?id=" + neu.id, anna)).status, "approval");

  // ---- Admin ----
  const niko = await anmelden("niko");
  const offen = daten(await get("/api/freigaben", niko));
  assert.equal(offen.schreibenAn, false); assert.equal(offen.zugangsdaten, false);
  assert.equal(offen.offen, eingereicht.aenderungen);
  const ergebnis = daten(await post("/api/freigabe/erteilen", niko, { id: neu.id, art: "titel" }));
  assert.deepEqual({ probelauf: ergebnis.probelauf, angewendet: ergebnis.angewendet, fehlgeschlagen: ergebnis.fehlgeschlagen, gestartet: ergebnis.gestartet, schreibenAn: ergebnis.schreibenAn },
    { probelauf: eingereicht.aenderungen, angewendet: 0, fehlgeschlagen: 0, gestartet: false, schreibenAn: false }, "Probelauf: nichts geändert, Test nicht gestartet");

  // ---- Log: every step with person, old and new, the dry run as dry_run ----
  const log = daten(await get("/api/protokoll", niko));
  const erstellt = log.find((z) => z.aktion === "test_created" && z.objekt === "test " + neu.id);
  assert.equal(erstellt.benutzer, "anna"); assert.equal(erstellt.details.seed, neu.seed, "der seed des Loses steht im Protokoll");
  const vorgeschlagen = log.filter((z) => z.aktion === "change_proposed" && z.details?.test === neu.id);
  assert.equal(vorgeschlagen.length, eingereicht.aenderungen);
  for (const z of vorgeschlagen) { assert.equal(z.benutzer, "anna"); assert.equal(z.rolle, "builder"); assert.deepEqual({ alt: z.details.alt, neu: z.details.neu }, titel.get(z.details.number)); }
  assert.ok(log.some((z) => z.aktion === "change_approved" && z.benutzer === "niko" && z.rolle === "admin" && z.details.schreibenAn === false));
  const probe = log.filter((z) => z.aktion === "ebay_dry_run");
  assert.equal(probe.length, eingereicht.aenderungen);
  for (const z of probe) {
    assert.equal(z.ergebnis, "dry_run"); assert.equal(z.benutzer, "niko");
    assert.deepEqual({ alt: z.details.alt, neu: z.details.neu }, titel.get(z.details.number));
  }
  assert.ok(!log.some((z) => z.aktion === "ebay_changed" || z.aktion === "ebay_failed"), "nichts bei eBay geändert, kein Fehler");

  // ---- Approvals stay open (the dry run changes nothing), test view and evaluation answer ----
  const danach = daten(await get("/api/freigaben", niko));
  assert.ok(danach.aenderungen.filter((a) => a.experiment_id === neu.id).every((a) => a.status === "offen" && /Dry run/.test(a.ergebnis)));
  detail = daten(await get("/api/experiment?id=" + neu.id, niko));
  assert.equal(detail.status, "approval"); assert.equal(detail.anzahl.titel, 2);
  assert.equal(detail.auswertung, null, "vor dem Start gibt es noch keine Auswertung");
  assert.ok(daten(await get("/api/experimente", niko)).tests.some((t) => t.id === neu.id && t.status === "approval"));
});
