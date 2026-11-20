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
  for (let i = 0; i < 900; i++) { try { if ((await fetch(basis + "/healthz")).ok) return; } catch { /* noch nicht bereit */ } await new Promise((r) => setTimeout(r, 100)); }
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

test("without login: data and write actions are blocked (401)", async () => {
  for (const p of ["/api/bewertung", "/api/produkte", "/api/stand", "/api/einstellungen", "/api/experimente", "/api/live", "/index.html", "/app.js"]) assert.equal((await fetch(basis + p)).status, 401, p);
  for (const p of ["/api/einstellungen", "/api/einstellungen/zuruecksetzen", "/api/experiment", "/api/experiment/start", "/api/experiment/abschluss", "/api/experiment/titel"]) assert.equal((await post(p, {})).status, 401, p);
});

test("without login: only the login page is visible", async () => {
  const wurzel = await fetch(basis + "/");
  assert.equal(wurzel.status, 200);
  assert.match(await wurzel.text(), /Sign in/);
  assert.equal((await fetch(basis + "/login.js")).status, 200);
  assert.equal((await fetch(basis + "/healthz")).status, 200);
  const ich = await (await fetch(basis + "/api/ich")).json();
  assert.equal(ich.daten.angemeldet, false);
});

test("a wrong cookie opens nothing", async () => {
  const r = await fetch(basis + "/api/bewertung", { headers: { Cookie: "sitzung=" + "a".repeat(43) } });
  assert.equal(r.status, 401);
});

test("wrong login: 401, no cookie; invalid input: an error instead of a crash", async () => {
  const r = await post("/api/login", { name: "anna", passwort: "falsch-falsch" });
  assert.equal(r.status, 401); assert.equal(r.headers.get("set-cookie"), null);
  assert.equal((await post("/api/login", {})).status, 401);
  assert.equal((await post("/api/login", { name: { $ne: 1 }, passwort: [1] })).status, 401);
  const kaputt = await fetch(basis + "/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{kein json" });
  assert.equal(kaputt.status, 400);
  const fremd = await post("/api/login", { name: "anna", passwort: "ein-langes-passwort" }, { Origin: "http://boese.example" });
  assert.equal(fremd.status, 403, "Anmeldung von einer fremden Seite wird abgelehnt");
});

test("with login: cookie is HttpOnly and SameSite=Strict, pages and data are reachable", async () => {
  const r = await post("/api/login", { name: "anna", passwort: "ein-langes-passwort" });
  const c = r.headers.get("set-cookie");
  assert.match(c, /HttpOnly/); assert.match(c, /SameSite=Strict/);
  const cookie = c.split(";")[0];
  const seite = await fetch(basis + "/", { headers: { Cookie: cookie } });
  assert.match(await seite.text(), /Listings/);
  // Nach einem Ausrollen muss sofort die neue Oberfläche kommen (Cloudflare hielt sonst bis zu 2 h das alte app.js)
  for (const p of ["/", "/app.js", "/app.css"]) assert.equal((await fetch(basis + p, { headers: { Cookie: cookie } })).headers.get("cache-control"), "no-cache", p);
  // Die Versionsangabe der Skripte ist der laufende Stand, nicht der feste Wert aus der Datei (sonst blieb nach #43 das alte app.js)
  const html = await (await fetch(basis + "/", { headers: { Cookie: cookie } })).text();
  assert.match(html, /\/app\.js\?v=[\w.-]+"/); assert.doesNotMatch(html, /\?v=2026-11-20/);
  assert.equal((await fetch(basis + "/api/einstellungen", { headers: { Cookie: cookie } })).status, 200);
  // Seite Results: beide Teile (je Lauf aus #47, Tag für Tag aus #48) antworten auch ohne Traffic-Daten, das Skript wird ausgeliefert
  for (const p of ["/api/ergebnisse", "/api/ergebnisse/beispiel", "/api/dashboard", "/dashboard.js"]) assert.equal((await fetch(basis + p, { headers: { Cookie: cookie } })).status, 200, p);
  const ich = await (await fetch(basis + "/api/ich", { headers: { Cookie: cookie } })).json();
  assert.deepEqual([ich.daten.angemeldet, ich.daten.name], [true, "anna"]);
});

test("Write action with login, but from a foreign site or with the wrong type: rejected", async () => {
  const cookie = await anmelden();
  assert.equal((await post("/api/einstellungen/zuruecksetzen", {}, { Cookie: cookie, Origin: "http://boese.example" })).status, 403);
  const text = await fetch(basis + "/api/einstellungen/zuruecksetzen", { method: "POST", headers: { Cookie: cookie, "Content-Type": "text/plain" }, body: "{}" });
  assert.equal(text.status, 415);
  assert.equal((await post("/api/einstellungen/zuruecksetzen", {}, { Cookie: cookie })).status, 200);
});

test("Logging out ends the session on the server", async () => {
  const cookie = await anmelden();
  assert.equal((await fetch(basis + "/api/stand", { headers: { Cookie: cookie } })).status !== 401, true);
  assert.equal((await post("/api/logout", {}, { Cookie: cookie })).status, 200);
  assert.equal((await fetch(basis + "/api/stand", { headers: { Cookie: cookie } })).status, 401);
});

test("Protective headers are set", async () => {
  const r = await fetch(basis + "/");
  assert.match(r.headers.get("content-security-policy"), /script-src 'self'/);
  assert.equal(r.headers.get("x-frame-options"), "DENY");
  assert.equal(r.headers.get("x-content-type-options"), "nosniff");
});

test("Paths outside public/ are not readable even when logged in", async () => {
  const cookie = await anmelden();
  for (const p of ["/../package.json", "/..%2fpackage.json", "/%2e%2e/app/server.mjs", "/..\\package.json"]) {
    const r = await fetch(basis + p, { headers: { Cookie: cookie } });
    assert.notEqual(r.status, 200, p);
  }
});
