// Sicherung der App-Daten (daten/app.db: Benutzer, Tests, Freigaben, Protokoll; daten/traffic-tage.db: Tages-Traffic).
// pm.db wird nicht gesichert: sie lässt sich jederzeit aus eBay neu bauen (npm run export).
//
//   npm run sicherung                 jetzt sichern (auch in einen zweiten Ordner, wenn SICHERUNG_ZIEL2 gesetzt ist)
//   npm run sicherung -- liste        vorhandene Sicherungen
//   npm run sicherung -- wiederherstellen <datei>   Sicherung zurückspielen (App vorher stoppen!)
//
// Gesichert wird mit dem Online-Backup von SQLite: mitten im Betrieb, ohne halb geschriebene Dateien. Jede Sicherung wird danach
// auf Unversehrtheit geprüft; eine kaputte Datei zählt nicht als Sicherung. Behalten werden die letzten 14 Tage (SICHERUNG_BEHALTEN).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import Database from "better-sqlite3";

const WURZEL = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
export const QUELLEN = [{ name: "app", env: "PM_APPDB", standard: "daten/app.db" }, { name: "traffic-tage", env: "TRAFFIC_CACHE", standard: "daten/traffic-tage.db" }];

const stempel = (d) => d.toISOString().slice(0, 16).replace("T", "-").replace(":", "");   // 2026-11-17-0300 (UTC)
export const dateiName = (name, d) => `${name}-${stempel(d)}.db`;

export function istHeil(pfad) {
  let db;
  try { db = new Database(pfad, { readonly: true, fileMustExist: true }); return db.pragma("integrity_check", { simple: true }) === "ok"; }
  catch { return false; } finally { try { db?.close(); } catch { /* schon zu */ } }
}

// Sichert alle vorhandenen Quellen nach ziel. quellen: [{ name, pfad }]. Liefert { gesichert: [{name, datei, bytes}], fehler: [..] }.
export async function sichere({ quellen, ziel, ziel2 = "", behalte = 14, jetzt = new Date() }) {
  const gesichert = []; const fehler = [];
  fs.mkdirSync(ziel, { recursive: true });
  for (const q of quellen) {
    if (!fs.existsSync(q.pfad)) continue;           // z. B. noch kein Traffic-Cache
    const datei = path.join(ziel, dateiName(q.name, jetzt));
    let db;
    try {
      db = new Database(q.pfad, { readonly: true, fileMustExist: true });
      await db.backup(datei);
      db.close(); db = null;
      // Die Kopie behält sonst den WAL-Modus der Quelle und legt beim Öffnen Nebendateien (-wal, -shm) an: zurück auf eine einzelne Datei
      { const k = new Database(datei); try { k.pragma("journal_mode = DELETE"); } finally { k.close(); } }
      if (!istHeil(datei)) { fs.rmSync(datei, { force: true }); throw new Error("Sicherung ist nicht unversehrt"); }
      if (ziel2) { fs.mkdirSync(ziel2, { recursive: true }); fs.copyFileSync(datei, path.join(ziel2, path.basename(datei))); }
      gesichert.push({ name: q.name, datei, bytes: fs.statSync(datei).size });
    } catch (e) { fehler.push(`${q.name}: ${e.message}`); try { db?.close(); } catch { /* schon zu */ } }
  }
  for (const ordner of [ziel, ziel2].filter(Boolean)) aufraeumen(ordner, quellen.map((q) => q.name), behalte);
  return { gesichert, fehler };
}

// Pro Quelle nur die neuesten "behalte" Dateien lassen (die Namen sortieren nach Zeit)
export function aufraeumen(ordner, namen, behalte) {
  for (const n of namen) {
    const dateien = fs.readdirSync(ordner).filter((f) => new RegExp(`^${n}-\\d{4}-\\d{2}-\\d{2}-\\d{4}\\.db$`).test(f)).sort();
    for (const alt of dateien.slice(0, Math.max(0, dateien.length - behalte))) fs.rmSync(path.join(ordner, alt), { force: true });
  }
}

export function liste(ordner) {
  if (!fs.existsSync(ordner)) return [];
  return fs.readdirSync(ordner).filter((f) => /^[a-z-]+-\d{4}-\d{2}-\d{2}-\d{4}\.db$/.test(f)).sort().reverse()
    .map((f) => { const s = fs.statSync(path.join(ordner, f)); return { datei: f, bytes: s.size, geaendert: s.mtime.toISOString() }; });
}

// Spielt eine Sicherung zurück. Die bisherige Datei wird nicht gelöscht, sondern daneben abgelegt.
export function stelleWiederHer(sicherung, zielDatei, jetzt = new Date()) {
  if (!fs.existsSync(sicherung)) throw new Error("Sicherung nicht gefunden: " + sicherung);
  if (!istHeil(sicherung)) throw new Error("Diese Sicherung ist nicht unversehrt, sie wird nicht zurückgespielt.");
  let alt = null;
  if (fs.existsSync(zielDatei)) { alt = `${zielDatei}.vor-wiederherstellung-${stempel(jetzt)}`; fs.renameSync(zielDatei, alt); }
  for (const e of ["-wal", "-shm"]) fs.rmSync(zielDatei + e, { force: true });   // Reste der alten Datei dürfen nicht an der neuen hängen
  fs.mkdirSync(path.dirname(zielDatei), { recursive: true });
  fs.copyFileSync(sicherung, zielDatei);
  if (!istHeil(zielDatei)) throw new Error("Zurückgespielte Datei ist nicht unversehrt" + (alt ? "; die alte liegt unter " + alt : ""));
  return { alt };
}

// Aus der Umgebung (.env bzw. Prozess): Pfade der Quellen und des Sicherungsordners
export function konfiguration(env = process.env, wurzel = WURZEL) {
  return {
    quellen: QUELLEN.map((q) => ({ name: q.name, pfad: path.resolve(wurzel, env[q.env] || q.standard) })),
    ziel: path.resolve(wurzel, env.SICHERUNG_ORDNER || "daten/sicherung"),
    ziel2: env.SICHERUNG_ZIEL2 ? path.resolve(wurzel, env.SICHERUNG_ZIEL2) : "",
    behalte: Math.max(1, Number(env.SICHERUNG_BEHALTEN) || 14),
  };
}

// ---- Befehlszeile ----
async function haupt() {
  const env = path.join(WURZEL, ".env");
  if (fs.existsSync(env)) for (const z of fs.readFileSync(env, "utf8").split(/\r?\n/)) { const m = z.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i); if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2]; }
  const k = konfiguration();
  const befehl = process.argv[2] || "sichern";
  if (befehl === "liste") { for (const e of liste(k.ziel)) console.log(`${e.datei}  ${(e.bytes / 1024).toFixed(0)} KB  ${e.geaendert}`); return; }
  if (befehl === "wiederherstellen") {
    const datei = process.argv[3]; if (!datei) { console.error("Aufruf: npm run sicherung -- wiederherstellen <datei aus daten/sicherung>"); process.exit(2); }
    const pfad = path.isAbsolute(datei) ? datei : fs.existsSync(path.resolve(datei)) ? path.resolve(datei) : path.join(k.ziel, datei);
    const quelle = k.quellen.find((q) => path.basename(pfad).startsWith(q.name + "-"));
    if (!quelle) { console.error("Der Dateiname passt zu keiner Quelle (app-… oder traffic-tage-…)."); process.exit(2); }
    const r = stelleWiederHer(pfad, quelle.pfad);
    console.log(`Zurückgespielt nach ${quelle.pfad}.` + (r.alt ? ` Die bisherige Datei liegt unter ${r.alt}.` : "") + " Jetzt die App neu starten.");
    return;
  }
  const r = await sichere(k);
  for (const g of r.gesichert) console.log(`gesichert: ${g.datei} (${(g.bytes / 1024).toFixed(0)} KB)`);
  for (const f of r.fehler) console.error("FEHLER " + f);
  if (r.fehler.length || !r.gesichert.length) process.exit(1);
}
const istHauptprogramm = () => { try { return !!process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href; } catch { return false; } };
if (istHauptprogramm()) haupt();
