// Backup of the app data (daten/app.db: users, tests, approvals, log; daten/traffic-tage.db: daily traffic).
// pm.db is not backed up: it can be rebuilt from eBay at any time (npm run export).
//
//   npm run sicherung                 back up now (also into a second folder if SICHERUNG_ZIEL2 is set)
//   npm run sicherung -- liste        vorhandene Sicherungen
//   npm run sicherung -- wiederherstellen <file>   restore a backup (stop the app first!)
//
// The backup uses SQLite's online backup: during operation, without half-written files. Every backup is afterwards
// checked for integrity; a broken file does not count as a backup. The last 14 days are kept (SICHERUNG_BEHALTEN).
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

// Backs up all existing sources to ziel. quellen: [{ name, pfad }]. Returns { gesichert: [{name, datei, bytes}], fehler: [..] }.
export async function sichere({ quellen, ziel, ziel2 = "", behalte = 14, jetzt = new Date() }) {
  const gesichert = []; const fehler = [];
  fs.mkdirSync(ziel, { recursive: true });
  for (const q of quellen) {
    if (!fs.existsSync(q.pfad)) continue;           // e.g. no traffic cache yet
    const datei = path.join(ziel, dateiName(q.name, jetzt));
    let db;
    try {
      db = new Database(q.pfad, { readonly: true, fileMustExist: true });
      await db.backup(datei);
      db.close(); db = null;
      // Otherwise the copy keeps the WAL mode of the source and creates side files (-wal, -shm) when opened: back to a single file
      { const k = new Database(datei); try { k.pragma("journal_mode = DELETE"); } finally { k.close(); } }
      if (!istHeil(datei)) { fs.rmSync(datei, { force: true }); throw new Error("The backup copy failed the integrity check"); }
      if (ziel2) { fs.mkdirSync(ziel2, { recursive: true }); fs.copyFileSync(datei, path.join(ziel2, path.basename(datei))); }
      gesichert.push({ name: q.name, datei, bytes: fs.statSync(datei).size });
    } catch (e) { fehler.push(`${q.name}: ${e.message}`); try { db?.close(); } catch { /* schon zu */ } }
  }
  for (const ordner of [ziel, ziel2].filter(Boolean)) aufraeumen(ordner, quellen.map((q) => q.name), behalte);
  return { gesichert, fehler };
}

// Per source keep only the newest "behalte" files (the names sort by time)
function aufraeumen(ordner, namen, behalte) {
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

// Restores a backup. The previous file is not deleted but put aside next to it.
export function stelleWiederHer(sicherung, zielDatei, jetzt = new Date()) {
  if (!fs.existsSync(sicherung)) throw new Error("Backup not found: " + sicherung);
  if (!istHeil(sicherung)) throw new Error("This backup failed the integrity check, it is not restored.");
  let alt = null;
  if (fs.existsSync(zielDatei)) { alt = `${zielDatei}.vor-wiederherstellung-${stempel(jetzt)}`; fs.renameSync(zielDatei, alt); }
  for (const e of ["-wal", "-shm"]) fs.rmSync(zielDatei + e, { force: true });   // Reste der alten Datei dürfen nicht an der neuen hängen
  fs.mkdirSync(path.dirname(zielDatei), { recursive: true });
  fs.copyFileSync(sicherung, zielDatei);
  if (!istHeil(zielDatei)) throw new Error("The restored file failed the integrity check" + (alt ? "; the previous file is at " + alt : ""));
  return { alt };
}

// From the environment (.env or process): paths of the sources and of the backup folder
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
    if (!quelle) { console.error("The file name does not match any source (app-… or traffic-tage-…)."); process.exit(2); }
    const r = stelleWiederHer(pfad, quelle.pfad);
    console.log(`Restored to ${quelle.pfad}.` + (r.alt ? ` The previous file is at ${r.alt}.` : "") + " Now restart the app.");
    return;
  }
  const r = await sichere(k);
  for (const g of r.gesichert) console.log(`gesichert: ${g.datei} (${(g.bytes / 1024).toFixed(0)} KB)`);
  for (const f of r.fehler) console.error("FEHLER " + f);
  if (r.fehler.length || !r.gesichert.length) process.exit(1);
}
const istHauptprogramm = () => { try { return !!process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href; } catch { return false; } };
if (istHauptprogramm()) haupt();
