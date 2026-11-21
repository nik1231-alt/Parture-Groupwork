// Test of the real server: what may a builder do, what only an admin? Nothing is ever written to eBay (no credentials, EBAY_SCHREIBEN off).
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { bereiteVor, legeBenutzerAn } from "./login.mjs";
import * as rollen from "./rollen.mjs";

const PORT = 3800 + Math.floor(Math.random() * 90);
const verz = fs.mkdtempSync(path.join(os.tmpdir(), "parture-rollen-"));
const appdb = path.join(verz, "app.db");
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
  server = spawn(process.execPath, [path.join(import.meta.dirname, "server.mjs")], { env: { ...process.env, PM_OHNE_ENV: "1", PM_PORT: String(PORT), PM_APPDB: appdb, PM_DB: "", CF_ACCESS_TEAM_DOMAIN: "", CF_ACCESS_AUD: "", EBAY_SCHREIBEN: "", EBAY_APP_ID: "", EBAY_CERT_ID: "", EBAY_REFRESH_TOKEN: "", SICHERUNG_ORDNER: path.join(verz, "sicherung"), SICHERUNG_AUTO: "aus", TRAFFIC_CACHE: path.join(verz, "kein-cache.db") }, stdio: "ignore" });
  for (let i = 0; i < 900; i++) { try { if ((await fetch(basis + "/healthz")).ok) return; } catch { /* noch nicht bereit */ } await new Promise((r) => setTimeout(r, 100)); }
  throw new Error("Server startet nicht");
});
// First wait for the end of the server, then delete: on Windows the running process keeps app.db open (EBUSY)
test.after(async () => {
  if (server && server.exitCode === null) { const weg = new Promise((r) => server.once("exit", r)); server.kill(); await weg; }
  fs.rmSync(verz, { recursive: true, force: true });
});

const post = (p, body, cookie) => fetch(basis + p, { method: "POST", headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
const get = (p, cookie) => fetch(basis + p, { headers: cookie ? { Cookie: cookie } : {} });
async function anmelden(name) { const r = await post("/api/login", { name, passwort: "ein-langes-passwort" }); assert.equal(r.status, 200); return r.headers.get("set-cookie").split(";")[0]; }

test("/api/ich reports the role", async () => {
  assert.equal((await (await get("/api/ich", await anmelden("niko"))).json()).daten.rolle, "admin");
  assert.equal((await (await get("/api/ich", await anmelden("anna"))).json()).daten.rolle, "builder");
});

test("Builder: roles, approval, rejecting and starting directly are blocked (403)", async () => {
  const c = await anmelden("anna");
  assert.equal((await get("/api/rollen", c)).status, 403);
  assert.equal((await post("/api/rolle", { name: "anna", rolle: "admin" }, c)).status, 403, "a builder does not make themself admin");
  assert.equal((await post("/api/freigabe/erteilen", { id: 1, art: "titel" }, c)).status, 403);
  assert.equal((await post("/api/freigabe/ablehnen", { id: 1, art: "titel" }, c)).status, 403);
  assert.equal((await post("/api/experiment/start", { id: 1 }, c)).status, 403);
  assert.equal((await post("/api/leiter/rueckgaengig", { number: "A" }, c)).status, 403, "F7: only an admin can undo changes on eBay");
  assert.equal((await post("/api/leiter/schieben", { number: "A", ziel: "weiter" }, c)).status, 403);
  const ich = await (await get("/api/ich", c)).json();
  assert.equal(ich.daten.rolle, "builder", "even after the attempts anna is still a builder");
});

test("Builder may read: approvals and log are visible, submitting is allowed (the test just does not exist)", async () => {
  const c = await anmelden("anna");
  const f = await (await get("/api/freigaben", c)).json();
  assert.equal(f.ok, true); assert.equal(f.daten.schreibenAn, false);
  assert.equal((await get("/api/protokoll", c)).status, 200);
  assert.equal((await post("/api/experiment/freigabe", { id: 999 }, c)).status, 404, "not 403: a builder may also submit");
});

test("without login the new addresses are blocked", async () => {
  for (const p of ["/api/freigaben", "/api/protokoll", "/api/rollen"]) assert.equal((await get(p)).status, 401, p);
  for (const p of ["/api/rolle", "/api/freigabe/erteilen", "/api/freigabe/ablehnen", "/api/experiment/freigabe"]) assert.equal((await post(p, {})).status, 401, p);
});

test("Admin: sees the roles, assigns roles, and the change is in the log", async () => {
  const c = await anmelden("niko");
  const t = await (await get("/api/rollen", c)).json();
  assert.deepEqual(t.daten.benutzer.map((b) => [b.name, b.rolle]), [["niko", "admin"], ["anna", "builder"]]);
  assert.equal((await post("/api/rolle", { name: "niko", rolle: "builder" }, c)).status, 409, "the only admin cannot give up the role");
  assert.equal((await post("/api/rolle", { name: "anna", rolle: "admin" }, c)).status, 200);
  assert.equal((await (await get("/api/ich", await anmelden("anna"))).json()).daten.rolle, "admin", "the change applies at once");
  const l = await (await get("/api/protokoll", c)).json();
  assert.ok(l.daten.some((z) => z.aktion === "role_changed" && z.objekt === "user anna" && z.benutzer === "niko"));
  assert.equal((await post("/api/rolle", { name: "anna", rolle: "builder" }, c)).status, 200);
});

test("Admin: approval without a proposal returns 409, never a crash, and without credentials nothing is written", async () => {
  const c = await anmelden("niko");
  assert.equal((await post("/api/freigabe/erteilen", { id: 1, art: "titel" }, c)).status, 409);
  assert.equal((await post("/api/freigabe/erteilen", { id: "x", art: "titel" }, c)).status, 400);
  assert.equal((await post("/api/freigabe/erteilen", { id: 1, art: "loeschen" }, c)).status, 400);
});

test("Operating status: visible to logged-in users, blocked without login, no write rights without credentials and switch", async () => {
  assert.equal((await get("/api/betrieb")).status, 401);
  const b = (await (await get("/api/betrieb", await anmelden("anna"))).json()).daten;
  assert.equal(b.umgebung, "lokal");
  assert.equal(b.schreibenAn, false); assert.equal(b.zugangsdaten, false); assert.equal(b.benachrichtigung, false);
  assert.equal(typeof b.sicherung.automatisch, "boolean");
  assert.ok("trafficBis" in b.daten && "veraltet" in b.daten);
  assert.ok(!JSON.stringify(b).includes(verz), "no server paths in the answer");
});

test("Backup by button: builder 403, admin backs up, the log records it, the backup is readable", async () => {
  assert.equal((await post("/api/sicherung", {}, await anmelden("anna"))).status, 403);
  const c = await anmelden("niko");
  const r = await post("/api/sicherung", {}, c);
  assert.equal(r.status, 200, await r.clone().text());
  const l = (await (await get("/api/protokoll", c)).json()).daten;
  assert.ok(l.some((z) => z.aktion === "backup" && z.ergebnis === "ok" && z.benutzer === "niko"));
  const dateien = fs.readdirSync(path.join(verz, "sicherung")).filter((f) => f.startsWith("app-"));
  assert.equal(dateien.length, 1);
  const d = new Database(path.join(verz, "sicherung", dateien[0]), { readonly: true });
  assert.ok(d.prepare("SELECT COUNT(*) n FROM benutzer").get().n >= 2); d.close();
  assert.equal((await (await get("/api/betrieb", c)).json()).daten.sicherung.anzahl, 1);
});

test("Changing the password through the server: only with login, old password needed, old session ends, new one works, log without passwords", async () => {
  assert.equal((await post("/api/passwort", { altes: "x", neues: "y" })).status, 401);
  const c = await anmelden("anna");
  assert.equal((await post("/api/passwort", { altes: "falsch-falsch", neues: "ein-ganz-neues-passwort" }, c)).status, 403);
  const r = await post("/api/passwort", { altes: "ein-langes-passwort", neues: "ein-ganz-neues-passwort" }, c);
  assert.equal(r.status, 200);
  const neuesCookie = r.headers.get("set-cookie").split(";")[0];
  assert.equal((await get("/api/ich", c)).status === 200 && (await (await get("/api/ich", c)).json()).daten.angemeldet, false, "the old session has ended");
  assert.equal((await (await get("/api/ich", neuesCookie)).json()).daten.angemeldet, true);
  const l = JSON.stringify((await (await get("/api/protokoll", await anmelden("niko"))).json()).daten);
  assert.match(l, /password_changed/);
  assert.ok(!l.includes("ein-ganz-neues-passwort") && !l.includes("ein-langes-passwort"));
  assert.equal((await post("/api/login", { name: "anna", passwort: "ein-langes-passwort" })).status, 401);
});
