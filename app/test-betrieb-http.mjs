// Test of the real server: warning on outdated traffic data, version in /healthz, environment badge.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { bereiteVor, legeBenutzerAn } from "./login.mjs";
import { laDatum, VERZOEGERUNG_STANDARD } from "./traffic.mjs";

const PORT = 4000 + Math.floor(Math.random() * 90);
const verz = fs.mkdtempSync(path.join(os.tmpdir(), "parture-betrieb-"));
const appdb = path.join(verz, "app.db"), pmdb = path.join(verz, "pm.db");
{ const d = new Database(appdb); bereiteVor(d); legeBenutzerAn(d, "anna", "ein-langes-passwort"); d.close(); }
const setzeStand = (bis) => { fs.rmSync(pmdb, { force: true }); const d = new Database(pmdb); d.exec("CREATE TABLE stand (exportiert_at TEXT, traffic_bis TEXT)"); d.prepare("INSERT INTO stand VALUES (?, ?)").run(new Date().toISOString(), bis); d.close(); };
fs.mkdirSync(path.join(verz, "daten"), { recursive: true });
// Start time of the test server: up to 90 s (900 × 100 ms). 5 s was not enough on 19 Nov, 30 s on 20 Nov was not either, when PROD and PREVIEW
// tested at the same time with tight memory (5cebbb9 rejected). A healthy start takes under 1 s, so the limit costs nothing.
const basis = `http://127.0.0.1:${PORT}`;
let server;
test.before(async () => {
  server = spawn(process.execPath, [path.join(import.meta.dirname, "server.mjs")], { env: { ...process.env, PM_OHNE_ENV: "1", PM_PORT: String(PORT), PM_APPDB: appdb, PM_DB: pmdb, PM_UMGEBUNG: "vorschau", TRAFFIC_VERZOEGERUNG_TAGE: String(VERZOEGERUNG_STANDARD), SICHERUNG_AUTO: "aus", SICHERUNG_ORDNER: path.join(verz, "s"), CF_ACCESS_TEAM_DOMAIN: "", CF_ACCESS_AUD: "" }, stdio: "ignore" });
  for (let i = 0; i < 900; i++) { try { if ((await fetch(basis + "/healthz")).ok) return; } catch { /* noch nicht bereit */ } await new Promise((r) => setTimeout(r, 100)); }
  throw new Error("Server startet nicht");
});
// First wait until the server process has really ended: on Windows it otherwise still keeps app.db open and rmSync fails with EBUSY (server probe 17 Nov 2026).
test.after(async () => {
  if (server && server.exitCode === null) { const weg = new Promise((r) => server.once("exit", r)); server.kill(); await weg; }
  fs.rmSync(verz, { recursive: true, force: true });
});

async function cookie() { const r = await fetch(basis + "/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "anna", passwort: "ein-langes-passwort" }) }); return r.headers.get("set-cookie").split(";")[0]; }
const betrieb = async (c) => (await (await fetch(basis + "/api/betrieb", { headers: { Cookie: c } })).json()).daten;

test("Data age: expected = today minus delay. On time is fine, 1 day behind too, from 2 days it is outdated", async () => {
  const c = await cookie();
  for (const [rueck, veraltet] of [[0, false], [1, false], [2, true], [6, true]]) {
    setzeStand(laDatum(new Date(), VERZOEGERUNG_STANDARD + rueck));
    const d = (await betrieb(c)).daten;
    assert.equal(d.rueckstandTage, rueck); assert.equal(d.veraltet, veraltet, `Rückstand ${rueck}`);
  }
});

test("Data age: without a traffic date or with an unreadable value there is no warning and no crash", async () => {
  const c = await cookie();
  for (const bis of [null, "gestern", "2026-13-99x"]) { setzeStand(bis); const d = (await betrieb(c)).daten; assert.equal(d.veraltet, false); assert.equal(d.rueckstandTage, null); }
});

test("The environment is in the status, and /healthz shows the version from the watcher status without login", async () => {
  assert.equal((await betrieb(await cookie())).umgebung, "vorschau");
  // On the server this test runs INSIDE the watcher folder, where daten/waechter-status.json with the rolled-out commit lies.
  // Expecting a fixed "null" made the watcher reject every second version (server probe 17 Nov 2026: b86458b REJECTED).
  let erwartet = null;
  try { erwartet = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "..", "daten", "waechter-status.json"), "utf8")).commit?.slice(0, 7) || null; } catch { /* ohne Wächter keine Version */ }
  assert.equal((await (await fetch(basis + "/healthz")).json()).version, erwartet, "version from daten/waechter-status.json, otherwise null");
});
