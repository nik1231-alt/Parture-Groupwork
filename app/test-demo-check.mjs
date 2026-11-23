// The check before the demo (npm run demo-check): the judgement over the collected facts. No network, no files.
import test from "node:test";
import assert from "node:assert/strict";
import { bewerte, liesEnv } from "./demo-check.mjs";
import { laDatum, HUB_VERZOEGERUNG } from "./traffic.mjs";

const jetzt = new Date("2026-12-04T09:00:00Z");
const vor = (stunden) => new Date(jetzt.getTime() - stunden * 3600e3).toISOString();
const gut = () => ({
  healthz: { ok: true, version: "d989ae9" }, mainSha: "d989ae9406b54b0fcac8ec4e046a392b2535f557",
  waechter: { geprueftAm: vor(0.1), abgelehnt: null }, stand: { traffic_bis: laDatum(jetzt, HUB_VERZOEGERUNG), quelle: "hub" },
  sicherung: vor(5), ebay: { konfiguriert: true, ok: true }, ki: { konfiguriert: true },
});
const rot = (lage) => bewerte(lage, jetzt).zeilen.filter((z) => !z.ok).map((z) => z.name);

test("Everything in order: seven green lines", () => {
  const e = bewerte(gut(), jetzt);
  assert.equal(e.ok, true);
  assert.deepEqual(e.zeilen.map((z) => z.name), ["App", "Version", "Watcher", "Data", "Backup", "eBay", "AI titles"]);
});

test("Each failure turns exactly its own line red", () => {
  assert.deepEqual(rot({ ...gut(), healthz: null }), ["App", "Version"]); // without the app the version is unknown too
  assert.deepEqual(rot({ ...gut(), mainSha: "0000000aaaa" }), ["Version"]);
  assert.deepEqual(rot({ ...gut(), mainSha: null }), ["Version"]); // no network: not silently green
  assert.deepEqual(rot({ ...gut(), waechter: { geprueftAm: vor(2), abgelehnt: null } }), ["Watcher"]);
  assert.deepEqual(rot({ ...gut(), waechter: { geprueftAm: vor(0.1), abgelehnt: "abc1234", abgelehntGrund: "tests failed" } }), ["Watcher"]);
  assert.deepEqual(rot({ ...gut(), stand: { traffic_bis: laDatum(jetzt, HUB_VERZOEGERUNG + 2), quelle: "hub" } }), ["Data"]);
  assert.deepEqual(rot({ ...gut(), stand: null }), ["Data"]);
  assert.deepEqual(rot({ ...gut(), sicherung: vor(30) }), ["Backup"]);
  assert.deepEqual(rot({ ...gut(), ebay: { konfiguriert: true, ok: false, meldung: "token expired" } }), ["eBay"]);
  assert.deepEqual(rot({ ...gut(), ki: { konfiguriert: false } }), ["AI titles"]);
});

test("One day behind is still green, and the texts say what was found", () => {
  const e = bewerte({ ...gut(), stand: { traffic_bis: laDatum(jetzt, HUB_VERZOEGERUNG + 1), quelle: "hub" }, ebay: { konfiguriert: false, ok: false } }, jetzt);
  const text = Object.fromEntries(e.zeilen.map((z) => [z.name, z.text]));
  assert.match(text.Data, /1 day\(s\) behind/);
  assert.match(text.eBay, /no keys/);
  assert.equal(e.ok, false);
});

test(".env: a value keeps its '#' (eBay tokens contain it), comments and empty lines are skipped", () => {
  const e = liesEnv("# a comment\r\nEBAY_REFRESH_TOKEN=v^1.1#i^1#r^1#abc==\n\nPM_PORT = 5070\nnot a line");
  assert.deepEqual(e, { EBAY_REFRESH_TOKEN: "v^1.1#i^1#r^1#abc==", PM_PORT: "5070" });
});
