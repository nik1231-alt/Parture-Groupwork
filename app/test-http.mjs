// Test des echten Servers: startet ihn mit einer Wegwerf-Datenbank und prüft, was ohne und mit Anmeldung möglich ist.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { bereiteVor, legeBenutzerAn } from "./login.mjs";

const PORT = 3900 + Math.floor(Math.random() * 90);
const verz = fs.mkdtempSync(path.join(os.tmpdir(), "parture-"));
const appdb = path.join(verz, "app.db");
{ const d = new Database(appdb); bereiteVor(d); legeBenutzerAn(d, "anna", "ein-langes-passwort"); d.close(); }
const basis = `http://127.0.0.1:${PORT}`;
let server;

test.before(async () => {
  server = spawn(process.execPath, [path.join(import.meta.dirname, "server.mjs")], { env: { ...process.env, PM_OHNE_ENV: "1", PM_PORT: String(PORT), PM_APPDB: appdb, PM_DB: "", CF_ACCESS_TEAM_DOMAIN: "", CF_ACCESS_AUD: "" }, stdio: "ignore" });
  for (let i = 0; i < 50; i++) { try { if ((await fetch(basis + "/healthz")).ok) return; } catch { /* noch nicht bereit */ } await new Promise((r) => setTimeout(r, 100)); }
  throw new Error("Server startet nicht");
});
// Erst auf das Ende des Servers warten, dann löschen: unter Windows hält der laufende Prozess app.db offen (EBUSY beim rmSync,
// Parture-Server 18.11.2026) — dieselbe Falle wie in test-betrieb-http.mjs.
test.after(async () => {
  if (server && server.exitCode === null) { const weg = new Promise((r) => server.once("exit", r)); server.kill(); await weg; }
  fs.rmSync(verz, { recursive: true, force: true });
});

const post = (p, body, kopf = {}) => fetch(basis + p, { method: "POST", headers: { "Content-Type": "application/json", ...kopf }, body: JSON.stringify(body) });
async function anmelden() {
  const r = await post("/api/login", { name: "anna", passwort: "ein-langes-passwort" });
  assert.equal(r.status, 200);
  return r.headers.get("set-cookie").split(";")[0];
}

test("ohne Anmeldung: Daten und Schreibaktionen sind gesperrt (401)", async () => {
  for (const p of ["/api/bewertung", "/api/produkte", "/api/stand", "/api/einstellungen", "/api/experimente", "/api/live", "/index.html", "/app.js"]) assert.equal((await fetch(basis + p)).status, 401, p);
  for (const p of ["/api/einstellungen", "/api/einstellungen/zuruecksetzen", "/api/experiment", "/api/experiment/start", "/api/experiment/abschluss", "/api/experiment/titel"]) assert.equal((await post(p, {})).status, 401, p);
});

test("ohne Anmeldung: nur die Anmeldeseite ist sichtbar", async () => {
  const wurzel = await fetch(basis + "/");
  assert.equal(wurzel.status, 200);
  assert.match(await wurzel.text(), /Sign in/);
  assert.equal((await fetch(basis + "/login.js")).status, 200);
  assert.equal((await fetch(basis + "/healthz")).status, 200);
  const ich = await (await fetch(basis + "/api/ich")).json();
  assert.equal(ich.daten.angemeldet, false);
});

test("ein falsches Cookie öffnet nichts", async () => {
  const r = await fetch(basis + "/api/bewertung", { headers: { Cookie: "sitzung=" + "a".repeat(43) } });
  assert.equal(r.status, 401);
});

test("falsche Anmeldung: 401, kein Cookie; ungültige Eingaben: Fehler statt Absturz", async () => {
  const r = await post("/api/login", { name: "anna", passwort: "falsch-falsch" });
  assert.equal(r.status, 401); assert.equal(r.headers.get("set-cookie"), null);
  assert.equal((await post("/api/login", {})).status, 401);
  assert.equal((await post("/api/login", { name: { $ne: 1 }, passwort: [1] })).status, 401);
  const kaputt = await fetch(basis + "/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{kein json" });
  assert.equal(kaputt.status, 400);
  const fremd = await post("/api/login", { name: "anna", passwort: "ein-langes-passwort" }, { Origin: "http://boese.example" });
  assert.equal(fremd.status, 403, "Anmeldung von einer fremden Seite wird abgelehnt");
});

test("mit Anmeldung: Cookie ist HttpOnly und SameSite=Strict, Seiten und Daten sind erreichbar", async () => {
  const r = await post("/api/login", { name: "anna", passwort: "ein-langes-passwort" });
  const c = r.headers.get("set-cookie");
  assert.match(c, /HttpOnly/); assert.match(c, /SameSite=Strict/);
  const cookie = c.split(";")[0];
  const seite = await fetch(basis + "/", { headers: { Cookie: cookie } });
  assert.match(await seite.text(), /Listings/);
  assert.equal((await fetch(basis + "/api/einstellungen", { headers: { Cookie: cookie } })).status, 200);
  const ich = await (await fetch(basis + "/api/ich", { headers: { Cookie: cookie } })).json();
  assert.deepEqual([ich.daten.angemeldet, ich.daten.name], [true, "anna"]);
});

test("Schreibaktion mit Anmeldung, aber von fremder Seite oder falschem Typ: abgelehnt", async () => {
  const cookie = await anmelden();
  assert.equal((await post("/api/einstellungen/zuruecksetzen", {}, { Cookie: cookie, Origin: "http://boese.example" })).status, 403);
  const text = await fetch(basis + "/api/einstellungen/zuruecksetzen", { method: "POST", headers: { Cookie: cookie, "Content-Type": "text/plain" }, body: "{}" });
  assert.equal(text.status, 415);
  assert.equal((await post("/api/einstellungen/zuruecksetzen", {}, { Cookie: cookie })).status, 200);
});

test("Abmelden beendet die Sitzung serverseitig", async () => {
  const cookie = await anmelden();
  assert.equal((await fetch(basis + "/api/stand", { headers: { Cookie: cookie } })).status !== 401, true);
  assert.equal((await post("/api/logout", {}, { Cookie: cookie })).status, 200);
  assert.equal((await fetch(basis + "/api/stand", { headers: { Cookie: cookie } })).status, 401);
});

test("Schutz-Header sind gesetzt", async () => {
  const r = await fetch(basis + "/");
  assert.match(r.headers.get("content-security-policy"), /script-src 'self'/);
  assert.equal(r.headers.get("x-frame-options"), "DENY");
  assert.equal(r.headers.get("x-content-type-options"), "nosniff");
});

test("Pfade außerhalb von public/ sind auch angemeldet nicht lesbar", async () => {
  const cookie = await anmelden();
  for (const p of ["/../package.json", "/..%2fpackage.json", "/%2e%2e/app/server.mjs", "/..\\package.json"]) {
    const r = await fetch(basis + p, { headers: { Cookie: cookie } });
    assert.notEqual(r.status, 200, p);
  }
});
