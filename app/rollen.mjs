// Roles: "admin" may approve changes (and thereby have eBay changed) and assign roles.
// "builder" builds and suggests (create tests, enter new titles, send for approval), but changes nothing on eBay.
// The role is in the table "benutzer" (users, see login.mjs). New users are builders.
import * as protokoll from "./protokoll.mjs";

export const ROLLEN = ["admin", "builder"];
const fehler = (status, text) => ({ ok: false, status, fehler: text });

// Must run after login.bereiteVor. Adds the column "rolle". If there were already users when adding it, the oldest becomes admin,
// because until now only people with access to the computer could create users.
export function bereiteVor(db) {
  const spalten = db.prepare("PRAGMA table_info(benutzer)").all();
  if (!spalten.length || spalten.some((c) => c.name === "rolle")) return;
  db.exec("ALTER TABLE benutzer ADD COLUMN rolle TEXT NOT NULL DEFAULT 'builder'");
  const aeltester = db.prepare("SELECT name FROM benutzer ORDER BY erstellt_at, name LIMIT 1").get();
  if (aeltester) db.prepare("UPDATE benutzer SET rolle = 'admin' WHERE name = ?").run(aeltester.name);
}

export const rolleVon = (db, name) => db.prepare("SELECT rolle FROM benutzer WHERE name = ?").get(name)?.rolle ?? null;
export const anzahlAdmins = (db) => db.prepare("SELECT COUNT(*) n FROM benutzer WHERE rolle = 'admin'").get().n;
export const liste = (db) => db.prepare("SELECT name, rolle, erstellt_at FROM benutzer ORDER BY CASE rolle WHEN 'admin' THEN 0 ELSE 1 END, name").all();

// Without a rights check: only for the command line on the server computer (npm run benutzer -- rolle ...).
export function legeFest(db, name, rolle) {
  if (!ROLLEN.includes(rolle)) return fehler(400, "Unknown role. Use admin or builder.");
  const r = db.prepare("UPDATE benutzer SET rolle = ? WHERE name = ?").run(rolle, String(name).trim().toLowerCase());
  return r.changes ? { ok: true, wert: { name, rolle } } : fehler(404, "Unknown user.");
}

// From the interface: only an admin, and at least one admin always remains.
export function setzeRolle(db, akteur, name, rolle, jetzt = new Date()) {
  if (akteur?.rolle !== "admin") return fehler(403, "Only an admin can change roles.");
  if (typeof name !== "string" || typeof rolle !== "string" || !ROLLEN.includes(rolle)) return fehler(400, "Unknown user or role.");
  const ziel = db.prepare("SELECT name, rolle FROM benutzer WHERE name = ?").get(name);
  if (!ziel) return fehler(404, "Unknown user.");
  if (ziel.rolle === rolle) return { ok: true, wert: { name, rolle } };
  if (ziel.rolle === "admin" && anzahlAdmins(db) <= 1) return fehler(409, "There must always be at least one admin. Make someone else admin first.");
  db.prepare("UPDATE benutzer SET rolle = ? WHERE name = ?").run(rolle, name);
  protokoll.schreibe(db, { benutzer: akteur.name, rolle: akteur.rolle, aktion: "role_changed", objekt: "user " + name, details: { von: ziel.rolle, zu: rolle } }, jetzt);
  return { ok: true, wert: { name, rolle } };
}
