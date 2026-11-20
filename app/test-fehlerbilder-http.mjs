// Fehlerbilder gegen den echten Server (Checkliste A1.10): pm.db fehlt -> 503 mit verständlichem englischem Text;
// Sitzung abgelaufen -> 401, die Anmeldeseite ist erreichbar. (eBay lehnt ab: siehe test-freigabe.mjs, "lehnt eBay die Änderung ab".)
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { bereiteVor, legeBenutzerAn, COOKIE } from "./login.mjs";

const PORT = 4200 + Math.floor(Math.random() * 90);
const verz = fs.mkdtempSync(path.join(os.tmpdir(), "parture-fehler-"));
const appdb = path.join(verz, "app.db");
const fehltPm = path.join(verz, "gibt-es-nicht", "pm.db");
const abgelaufen = crypto.randomBytes(32).toString("base64url");
{
  const d = new Database(appdb); bereiteVor(d); legeBenutzerAn(d, "anna", "ein-langes-passwort");
  // eine Sitzung, die vor einer Stunde abgelaufen ist (so sieht eine Sitzung nach 12 Stunden aus)
  d.prepare("INSERT INTO sitzung (token_hash, name, erstellt_at, ablauf_at) VALUES (?, 'anna', ?, ?)").run(crypto.createHash("sha256").update(abgelaufen).digest("hex"), new Date(Date.now() - 13 * 3600e3).toISOString(), new Date(Date.now() - 3600e3).toISOString());
  d.close();
}
const basis = `http://127.0.0.1:${PORT}`;
let server;
test.before(async () => {
  server = spawn(process.execPath, [path.join(import.meta.dirname, "server.mjs")], { env: { ...process.env, PM_OHNE_ENV: "1", PM_PORT: String(PORT), PM_APPDB: appdb, PM_DB: fehltPm, CF_ACCESS_TEAM_DOMAIN: "", CF_ACCESS_AUD: "", SICHERUNG_AUTO: "aus", EBAY_TRAFFIC_AUTO: "", TELEGRAM_BOT_TOKEN: "", TELEGRAM_CHAT_ID: "" }, stdio: "ignore" });
  for (let i = 0; i < 900; i++) { try { if ((await fetch(basis + "/healthz")).ok) return; } catch { /* noch nicht bereit */ } await new Promise((r) => setTimeout(r, 100)); }
  throw new Error("Server startet nicht");
});
test.after(async () => {
  if (server && server.exitCode === null) { const weg = new Promise((r) => server.once("exit", r)); server.kill(); await weg; }
  fs.rmSync(verz, { recursive: true, force: true });
});

async function anmelden() {
  const r = await fetch(basis + "/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "anna", passwort: "ein-langes-passwort" }) });
  assert.equal(r.status, 200); return r.headers.get("set-cookie").split(";")[0];
}

test("pm.db missing: 503 with an understandable English text, without a server path; the app itself keeps running", async () => {
  const c = await anmelden();
  for (const p of ["/api/bewertung", "/api/stand", "/api/experimente", "/api/produkte"]) {
    const r = await fetch(basis + p, { headers: { Cookie: c } });
    assert.equal(r.status, 503, p);
    const j = await r.json();
    assert.equal(j.ok, false);
    assert.match(j.error, /product data \(pm\.db\) is not available/);
    assert.ok(!/[äöüÄÖÜß]/.test(j.error), "englisch");
    assert.ok(!j.error.includes(verz) && !j.error.includes("gibt-es-nicht"), "kein Serverpfad in der Meldung");
  }
  // Was nicht von pm.db abhängt, geht weiter (Anmeldung, Protokoll, Betriebsstatus mit leerem Datenstand)
  assert.equal((await fetch(basis + "/api/protokoll", { headers: { Cookie: c } })).status, 200);
  const b = await (await fetch(basis + "/api/betrieb", { headers: { Cookie: c } })).json();
  assert.equal(b.ok, true); assert.equal(b.daten.daten.trafficBis, null);
});

test("Session expired: data answers 401 (the interface then loads the login page), the cookie opens nothing any more", async () => {
  const cookie = `${COOKIE}=${abgelaufen}`;
  const r = await fetch(basis + "/api/experimente", { headers: { Cookie: cookie } });
  assert.equal(r.status, 401);
  assert.equal((await r.json()).error, "Please sign in.");
  const seite = await fetch(basis + "/", { headers: { Cookie: cookie } });
  assert.equal(seite.status, 200); assert.match(await seite.text(), /Sign in/, "statt der App kommt die Anmeldeseite");
  assert.equal((await (await fetch(basis + "/api/ich", { headers: { Cookie: cookie } })).json()).daten.angemeldet, false);
});
