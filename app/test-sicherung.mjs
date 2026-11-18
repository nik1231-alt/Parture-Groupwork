// Tests für die Sicherung (app/sicherung.mjs): Online-Backup, Prüfung, Aufräumen, zweiter Ort, Zurückspielen.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { sichere, istHeil, liste, stelleWiederHer, konfiguration, dateiName } from "./sicherung.mjs";

const wurzel = fs.mkdtempSync(path.join(os.tmpdir(), "parture-sicherung-"));
const appPfad = path.join(wurzel, "daten", "app.db");
fs.mkdirSync(path.dirname(appPfad), { recursive: true });
const app = new Database(appPfad);
app.pragma("journal_mode = WAL");
app.exec("CREATE TABLE benutzer (name TEXT); INSERT INTO benutzer VALUES ('niko'), ('alex');");
const quellen = [{ name: "app", pfad: appPfad }, { name: "traffic-tage", pfad: path.join(wurzel, "daten", "gibt-es-nicht.db") }];
const ziel = path.join(wurzel, "sicherung");
const lese = (p) => { const d = new Database(p, { readonly: true }); try { return d.prepare("SELECT name FROM benutzer ORDER BY name").all().map((r) => r.name); } finally { d.close(); } };

test("Sicherung im laufenden Betrieb (WAL, offene Verbindung) enthält alle Daten, fehlende Quellen werden übersprungen", async () => {
  const r = await sichere({ quellen, ziel, jetzt: new Date("2026-11-17T03:00:00Z") });
  assert.deepEqual(r.fehler, []);
  assert.equal(r.gesichert.length, 1);
  assert.equal(path.basename(r.gesichert[0].datei), "app-2026-11-17-0300.db");
  assert.deepEqual(lese(r.gesichert[0].datei), ["alex", "niko"]);
  assert.deepEqual(fs.readdirSync(ziel).filter((f) => /-(wal|shm)$/.test(f)), [], "keine Nebendateien neben der Sicherung");
});

test("zweiter Ort bekommt dieselbe Sicherung", async () => {
  const ziel2 = path.join(wurzel, "zweiter-ort");
  await sichere({ quellen, ziel, ziel2, jetzt: new Date("2026-11-17T04:00:00Z") });
  assert.deepEqual(lese(path.join(ziel2, "app-2026-11-17-0400.db")), ["alex", "niko"]);
});

test("Aufräumen: nur die neuesten N Sicherungen bleiben", async () => {
  for (const tag of ["18", "19", "20", "21"]) await sichere({ quellen, ziel, behalte: 3, jetzt: new Date(`2026-11-${tag}T03:00:00Z`) });
  const namen = liste(ziel).map((e) => e.datei);
  assert.equal(namen.length, 3);
  assert.equal(namen[0], "app-2026-11-21-0300.db", "neueste zuerst");
  assert.ok(!namen.includes("app-2026-11-17-0300.db"));
});

test("Prüfung: eine kaputte Datei gilt nicht als heil und wird nicht zurückgespielt", () => {
  const kaputt = path.join(wurzel, "app-2026-11-30-0300.db");
  fs.writeFileSync(kaputt, "das ist keine Datenbank, nur genug Text um länger als ein Header zu sein ".repeat(50));
  assert.equal(istHeil(kaputt), false);
  assert.equal(istHeil(path.join(wurzel, "gibt-es-nicht.db")), false);
  assert.throws(() => stelleWiederHer(kaputt, appPfad), /failed the integrity check/);
  assert.deepEqual(lese(appPfad), ["alex", "niko"], "die echte Datei blieb unberührt");
});

test("Zurückspielen: die bisherige Datei wird daneben abgelegt, danach stimmen die alten Daten", async () => {
  const r = await sichere({ quellen, ziel, jetzt: new Date("2026-11-22T03:00:00Z") });
  app.exec("INSERT INTO benutzer VALUES ('zuviel'); DELETE FROM benutzer WHERE name = 'niko';");   // "Unfall" nach der Sicherung
  app.close();
  const e = stelleWiederHer(r.gesichert[0].datei, appPfad, new Date("2026-11-22T05:00:00Z"));
  assert.deepEqual(lese(appPfad), ["alex", "niko"], "Stand der Sicherung");
  assert.ok(e.alt && fs.existsSync(e.alt), "die alte Datei liegt noch daneben");
  assert.deepEqual(lese(e.alt), ["alex", "zuviel"], "Stand vor der Wiederherstellung bleibt nachvollziehbar");
});

test("Konfiguration: Standardpfade und Überschreibung per Umgebung", () => {
  const k = konfiguration({}, "/x");
  assert.equal(k.ziel, path.resolve("/x", "daten/sicherung"));
  assert.equal(k.behalte, 14);
  assert.equal(k.ziel2, "");
  const k2 = konfiguration({ SICHERUNG_ORDNER: "/y", SICHERUNG_ZIEL2: "/z", SICHERUNG_BEHALTEN: "5", PM_APPDB: "/a.db" }, "/x");
  // path.resolve, nicht der rohe String: auf Windows wird "/y" zu "C:\y" (Serverprobe 17.11.2026)
  assert.equal(k2.ziel, path.resolve("/y")); assert.equal(k2.ziel2, path.resolve("/z")); assert.equal(k2.behalte, 5); assert.equal(k2.quellen[0].pfad, path.resolve("/a.db"));
  assert.equal(dateiName("app", new Date("2026-01-02T03:04:00Z")), "app-2026-01-02-0304.db");
});

test.after(() => fs.rmSync(wurzel, { recursive: true, force: true }));
