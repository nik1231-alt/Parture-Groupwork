// Tests für die Telegram-Benachrichtigung: ohne Zugangsdaten passiert nichts, Fehler stören nie, der Token landet in keiner Ausgabe.
import test from "node:test";
import assert from "node:assert/strict";
import { erzeuge } from "./benachrichtigung.mjs";

// Erfundener Token, zur Laufzeit zusammengesetzt (sonst schlägt der Geheimnis-Scan an)
const ENV = { TELEGRAM_BOT_TOKEN: ["123456789", "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi"].join(":"), TELEGRAM_CHAT_ID: "42" };

test("ohne Token und Chat-ID: nicht konfiguriert, kein Netzaufruf", async () => {
  let n = 0; const b = erzeuge({ env: {}, fetchFn: async () => { n++; return { ok: true }; } });
  assert.equal(b.konfiguriert(), false);
  assert.equal(await b.sende("hallo"), false); assert.equal(n, 0);
});

test("Vorschlag: Nachricht mit Name, Anzahl und Testname geht an die richtige Chat-ID", async () => {
  let url, body; const b = erzeuge({ env: ENV, fetchFn: async (u, o) => { url = u; body = JSON.parse(o.body); return { ok: true }; } });
  assert.equal(await b.vorschlag("anna", 4, "Staender"), true);
  assert.match(url, /^https:\/\/api\.telegram\.org\/bot123456789:/);
  assert.equal(body.chat_id, "42");
  assert.match(body.text, /anna schlägt 4 Titeländerungen vor.*Staender/);
  assert.equal((await erzeuge({ env: ENV, fetchFn: async (u, o) => { body = JSON.parse(o.body); return { ok: true }; } }).vorschlag("ben", 1, "X")), true);
  assert.match(body.text, /1 Titeländerung vor/);
});

test("Netzfehler und HTTP-Fehler werfen nie, der Token steht in keiner Logzeile", async () => {
  const zeilen = [];
  const a = erzeuge({ env: ENV, log: (m) => zeilen.push(m), fetchFn: async () => { throw new Error("connect ECONNREFUSED https://api.telegram.org/bot" + ENV.TELEGRAM_BOT_TOKEN + "/sendMessage"); } });
  assert.equal(await a.sende("x"), false);
  const b = erzeuge({ env: ENV, log: (m) => zeilen.push(m), fetchFn: async () => ({ ok: false, status: 401 }) });
  assert.equal(await b.sende("x"), false);
  assert.equal(zeilen.length, 2);
  assert.ok(zeilen.every((z) => !z.includes(ENV.TELEGRAM_BOT_TOKEN)), zeilen.join("|"));
});

test("lange Nachrichten werden gekürzt", async () => {
  let body; const b = erzeuge({ env: ENV, fetchFn: async (u, o) => { body = JSON.parse(o.body); return { ok: true }; } });
  await b.fehler("Import", "x".repeat(5000));
  assert.ok(body.text.length <= 900);
});
