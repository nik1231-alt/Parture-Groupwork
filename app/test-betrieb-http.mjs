// Test des echten Servers: Warnung bei veralteten Traffic-Daten, Version im /healthz, Umgebungs-Kennzeichen.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { bereiteVor, legeBenutzerAn } from "./login.mjs";
import { laDatum } from "./traffic.mjs";

const PORT = 4000 + Math.floor(Math.random() * 90);
const verz = fs.mkdtempSync(path.join(os.tmpdir(), "parture-betrieb-"));
const appdb = path.join(verz, "app.db"), pmdb = path.join(verz, "pm.db");
{ const d = new Database(appdb); bereiteVor(d); legeBenutzerAn(d, "anna", "ein-langes-passwort"); d.close(); }
const setzeStand = (bis) => { fs.rmSync(pmdb, { force: true }); const d = new Database(pmdb); d.exec("CREATE TABLE stand (exportiert_at TEXT, traffic_bis TEXT)"); d.prepare("INSERT INTO stand VALUES (?, ?)").run(new Date().toISOString(), bis); d.close(); };
fs.mkdirSync(path.join(verz, "daten"), { recursive: true });
const basis = `http://127.0.0.1:${PORT}`;
let server;
test.before(async () => {
  server = spawn(process.execPath, [path.join(import.meta.dirname, "server.mjs")], { env: { ...process.env, PM_OHNE_ENV: "1", PM_PORT: String(PORT), PM_APPDB: appdb, PM_DB: pmdb, PM_UMGEBUNG: "vorschau", TRAFFIC_VERZOEGERUNG_TAGE: "3", SICHERUNG_AUTO: "aus", SICHERUNG_ORDNER: path.join(verz, "s"), CF_ACCESS_TEAM_DOMAIN: "", CF_ACCESS_AUD: "" }, stdio: "ignore" });
  for (let i = 0; i < 50; i++) { try { if ((await fetch(basis + "/healthz")).ok) return; } catch { /* noch nicht bereit */ } await new Promise((r) => setTimeout(r, 100)); }
  throw new Error("Server startet nicht");
});
// Erst warten, bis der Server-Prozess wirklich beendet ist: auf Windows hält er app.db sonst noch offen und rmSync scheitert mit EBUSY (Serverprobe 17.11.2026).
test.after(async () => {
  if (server && server.exitCode === null) { const weg = new Promise((r) => server.once("exit", r)); server.kill(); await weg; }
  fs.rmSync(verz, { recursive: true, force: true });
});

async function cookie() { const r = await fetch(basis + "/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "anna", passwort: "ein-langes-passwort" }) }); return r.headers.get("set-cookie").split(";")[0]; }
const betrieb = async (c) => (await (await fetch(basis + "/api/betrieb", { headers: { Cookie: c } })).json()).daten;

test("Datenstand: Soll = heute minus Verzögerung. Pünktlich ist unauffällig, 1 Tag Rückstand auch, ab 2 Tagen veraltet", async () => {
  const c = await cookie();
  for (const [rueck, veraltet] of [[0, false], [1, false], [2, true], [6, true]]) {
    setzeStand(laDatum(new Date(), 3 + rueck));
    const d = (await betrieb(c)).daten;
    assert.equal(d.rueckstandTage, rueck); assert.equal(d.veraltet, veraltet, `Rückstand ${rueck}`);
  }
});

test("Datenstand: ohne Traffic-Datum oder mit unlesbarem Wert keine Warnung und kein Absturz", async () => {
  const c = await cookie();
  for (const bis of [null, "gestern", "2026-13-99x"]) { setzeStand(bis); const d = (await betrieb(c)).daten; assert.equal(d.veraltet, false); assert.equal(d.rueckstandTage, null); }
});

test("Umgebung steht im Status, und /healthz zeigt die Version aus dem Wächter-Status ohne Anmeldung", async () => {
  assert.equal((await betrieb(await cookie())).umgebung, "vorschau");
  // Auf dem Server läuft dieser Test IM Wächter-Ordner, dort liegt daten/waechter-status.json mit dem ausgerollten Commit.
  // Fest „null“ zu erwarten ließ den Wächter jeden zweiten Stand ablehnen (Serverprobe 17.11.2026: b86458b ABGELEHNT).
  let erwartet = null;
  try { erwartet = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "..", "daten", "waechter-status.json"), "utf8")).commit?.slice(0, 7) || null; } catch { /* ohne Wächter keine Version */ }
  assert.equal((await (await fetch(basis + "/healthz")).json()).version, erwartet, "Version aus daten/waechter-status.json, sonst null");
});
