// Benutzer anlegen oder Passwort ändern (auf dem Rechner, auf dem der Server läuft):
//   npm run benutzer -- anlegen <name> [admin|builder]   (der erste Benutzer wird automatisch Admin, sonst Builder)
//   npm run benutzer -- passwort <name>
//   npm run benutzer -- rolle <name> <admin|builder>
//   npm run benutzer -- liste
// Das Passwort wird verdeckt abgefragt und steht nie in der Befehlszeile, in einer Datei oder im Verlauf.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import * as login from "./login.mjs";
import * as rollen from "./rollen.mjs";

const WURZEL = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const env = path.join(WURZEL, ".env");
if (fs.existsSync(env)) for (const z of fs.readFileSync(env, "utf8").split(/\r?\n/)) { const m = z.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i); if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2]; }
const pfad = path.resolve(WURZEL, process.env.PM_APPDB || "daten/app.db");
fs.mkdirSync(path.dirname(pfad), { recursive: true });
const db = new Database(pfad);
db.pragma("journal_mode = WAL");
login.bereiteVor(db);
rollen.bereiteVor(db);

// Ohne Terminal (Eingabe per Pipe): alle Zeilen einmal einlesen und der Reihe nach verteilen
let zeilen = null;
const leseZeilen = (ein) => new Promise((resolve) => { let s = ""; ein.setEncoding("utf8"); ein.on("data", (c) => { s += c; }); ein.on("end", () => resolve(s.split(/\r?\n/))); });

function frageVerdeckt(frage) {
  return new Promise((resolve) => {
    process.stdout.write(frage);
    const ein = process.stdin; let s = "";
    if (!ein.isTTY) { zeilen ??= leseZeilen(ein); zeilen.then((z) => { process.stdout.write("\n"); resolve(z.shift() ?? ""); }); return; }
    ein.setRawMode(true); ein.resume(); ein.setEncoding("utf8");
    ein.on("data", function lies(c) {
      for (const z of c) {
        if (z === "\r" || z === "\n" || z === "\u0004") { ein.setRawMode(false); ein.pause(); ein.off("data", lies); process.stdout.write("\n"); return resolve(s); }
        if (z === "\u0003") { process.stdout.write("\n"); process.exit(1); }
        if (z === "\u007f") s = s.slice(0, -1); else s += z;
      }
    });
  });
}

const [befehl, name, drittes] = process.argv.slice(2);
if (befehl === "liste") {
  for (const b of rollen.liste(db)) console.log(b.name, `[${b.rolle}]`, "(created", b.erstellt_at + ")");
  console.log(login.anzahlBenutzer(db) + " users");
} else if ((befehl === "anlegen" || befehl === "passwort") && name) {
  const pw = await frageVerdeckt("Password (at least " + login.PASSWORT_MIN + " characters): ");
  const pw2 = await frageVerdeckt("Repeat the password: ");
  if (pw !== pw2) { console.error("The passwords do not match."); process.exit(1); }
  const r = befehl === "anlegen" ? login.legeBenutzerAn(db, name, pw) : login.setzePasswort(db, name, pw);
  if (!r.ok) { console.error(r.fehler); process.exit(1); }
  if (befehl === "anlegen") {
    const rolle = drittes ?? (login.anzahlBenutzer(db) === 1 ? "admin" : "builder");
    const rr = rollen.legeFest(db, r.wert.name, rolle);
    if (!rr.ok) { console.error(rr.fehler); process.exit(1); }
    console.log("User created: " + r.wert.name + " (role: " + rolle + ")");
  } else console.log("Password changed for: " + r.wert.name);
} else if (befehl === "rolle" && name && drittes) {
  const r = rollen.legeFest(db, name, drittes);
  if (!r.ok) { console.error(r.fehler); process.exit(1); }
  console.log("Role of " + name + ": " + drittes);
} else {
  console.error("Usage: npm run benutzer -- anlegen <name> [admin|builder] | passwort <name> | rolle <name> <admin|builder> | liste");
  process.exit(1);
}
