// Speicher für eigene Entscheidungen (Aktion + Notiz pro Produkt).
// Liegt bewusst NICHT in pm.db: Die wird nachts überschrieben. Datei: daten/entscheidungen.db (git-ignoriert).
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { AKTIONEN } from "./regeln.mjs";

export const MAX_NOTIZ = 500;
export const MAX_NUMMER = 40;

export function oeffne(pfad) {
  if (pfad !== ":memory:") fs.mkdirSync(path.dirname(pfad), { recursive: true });
  const db = new Database(pfad);
  db.pragma("journal_mode = WAL");
  db.exec(`CREATE TABLE IF NOT EXISTS entscheidung (
    number TEXT PRIMARY KEY,
    aktion TEXT,
    notiz TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL
  )`);
  return db;
}

// Prüft die Eingabe vom Browser. Gibt { ok: true, wert } oder { ok: false, fehler } zurück.
export function pruefe(eingabe) {
  if (!eingabe || typeof eingabe !== "object" || Array.isArray(eingabe)) return { ok: false, fehler: "Invalid request." };
  const { number, aktion, notiz } = eingabe;
  if (typeof number !== "string" || number.trim() === "" || number.length > MAX_NUMMER) return { ok: false, fehler: "Product number is missing or invalid." };
  if (aktion !== null && aktion !== "" && !Object.hasOwn(AKTIONEN, aktion)) return { ok: false, fehler: "Unknown action." };
  if (notiz !== undefined && typeof notiz !== "string") return { ok: false, fehler: "Note must be text." };
  const text = (notiz ?? "").trim();
  if (text.length > MAX_NOTIZ) return { ok: false, fehler: `Note is too long (at most ${MAX_NOTIZ} characters).` };
  return { ok: true, wert: { number: number.trim(), aktion: aktion || null, notiz: text } };
}

export function alle(db) {
  const karte = new Map();
  for (const z of db.prepare("SELECT number, aktion, notiz, updated_at FROM entscheidung").all()) karte.set(z.number, z);
  return karte;
}

// Speichert. Ohne Aktion und ohne Notiz wird die Entscheidung gelöscht (= zurück auf "offen").
export function speichere(db, { number, aktion, notiz }, jetzt = new Date()) {
  if (!aktion && !notiz) {
    db.prepare("DELETE FROM entscheidung WHERE number = ?").run(number);
    return null;
  }
  // Notiz ohne Aktion ist erlaubt: aktion bleibt dann leer (null), es wird nichts untergeschoben.
  const z = { number, aktion: aktion || null, notiz, updated_at: jetzt.toISOString() };
  db.prepare("INSERT INTO entscheidung (number, aktion, notiz, updated_at) VALUES (@number, @aktion, @notiz, @updated_at) ON CONFLICT(number) DO UPDATE SET aktion = @aktion, notiz = @notiz, updated_at = @updated_at").run(z);
  return z;
}
