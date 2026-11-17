// Login: Benutzer und Sitzungen in der eigenen Datenbank (daten/app.db). Keine Passwörter im Repo.
// Passwörter werden nie gespeichert, nur ein scrypt-Hash mit eigenem Salz. Sitzungs-Tokens liegen nur als SHA-256-Hash in der Datenbank.
// Jede Funktion liefert { ok, wert } oder { ok: false, status, fehler }, genau wie die anderen Module.
import crypto from "node:crypto";

export const SITZUNG_STUNDEN = 12;
export const MAX_FEHLVERSUCHE = 5;
export const SPERRE_MINUTEN = 15;
export const MAX_FEHLVERSUCHE_IP = 20;   // je Adresse über alle Namen, damit niemand der Reihe nach alle Konten sperren oder durchprobieren kann
const NAME_MUSTER = /^[a-z0-9][a-z0-9._-]{2,39}$/;
export const PASSWORT_MIN = 10;
export const PASSWORT_MAX = 200;
export const COOKIE = "sitzung";

export function bereiteVor(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS benutzer (
      name TEXT PRIMARY KEY, salz TEXT NOT NULL, hash TEXT NOT NULL, erstellt_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sitzung (
      token_hash TEXT PRIMARY KEY, name TEXT NOT NULL REFERENCES benutzer(name) ON DELETE CASCADE,
      erstellt_at TEXT NOT NULL, ablauf_at TEXT NOT NULL
    );
  `);
}

const fehler = (status, text) => ({ ok: false, status, fehler: text });
const ok = (wert) => ({ ok: true, wert });
const scrypt = (passwort, salz) => crypto.scryptSync(passwort, salz, 64, { N: 16384, r: 8, p: 1 });
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const normName = (n) => (typeof n === "string" ? n.trim().toLowerCase() : "");

// Fehlversuche werden im Speicher gezählt (pro Benutzername): nach 5 Fehlversuchen ist der Name 15 Minuten gesperrt.
// Ein Neustart des Servers setzt die Zähler zurück. Für ein kleines Team reicht das.
const versuche = new Map();
const versucheIp = new Map();
export function leereVersuche() { versuche.clear(); versucheIp.clear(); }
const ipGesperrt = (ip, jetzt) => !!ip && (versucheIp.get(ip)?.bis ?? 0) > jetzt.getTime();
function merkeFehlversuchIp(ip, jetzt) {
  if (!ip) return;
  const v = versucheIp.get(ip);
  const frisch = !v || (v.bis && v.bis <= jetzt.getTime()) || jetzt.getTime() - v.seit > SPERRE_MINUTEN * 60000;
  const n = frisch ? 1 : v.n + 1;
  versucheIp.set(ip, { n, seit: frisch ? jetzt.getTime() : v.seit, bis: n >= MAX_FEHLVERSUCHE_IP ? jetzt.getTime() + SPERRE_MINUTEN * 60000 : 0 });
  if (versucheIp.size > 5000) versucheIp.clear();
}
function gesperrt(name, jetzt) {
  const v = versuche.get(name);
  return !!v && v.bis > jetzt.getTime();
}
function merkeFehlversuch(name, jetzt) {
  const v = versuche.get(name);
  const frisch = !v || (v.bis && v.bis <= jetzt.getTime());
  const n = frisch ? 1 : v.n + 1;
  versuche.set(name, { n, bis: n >= MAX_FEHLVERSUCHE ? jetzt.getTime() + SPERRE_MINUTEN * 60000 : 0 });
  if (versuche.size > 5000) versuche.clear(); // Speicher begrenzen
}

// Ein Hash für unbekannte Namen: so dauert eine Anmeldung mit falschem Namen genauso lange wie mit falschem Passwort.
const ATTRAPPE = { salz: crypto.randomBytes(16).toString("hex"), hash: null };
ATTRAPPE.hash = scrypt("attrappe", ATTRAPPE.salz).toString("hex");

export function legeBenutzerAn(db, nameRoh, passwort, jetzt = new Date()) {
  const name = normName(nameRoh);
  if (!NAME_MUSTER.test(name)) return fehler(400, "Username: 3 to 40 characters, lowercase letters, digits, dot, dash or underscore.");
  if (typeof passwort !== "string" || passwort.length < PASSWORT_MIN) return fehler(400, `Password: at least ${PASSWORT_MIN} characters.`);
  if (passwort.length > PASSWORT_MAX) return fehler(400, `Password: at most ${PASSWORT_MAX} characters.`);
  if (db.prepare("SELECT 1 FROM benutzer WHERE name = ?").get(name)) return fehler(409, "This username already exists.");
  const salz = crypto.randomBytes(16).toString("hex");
  db.prepare("INSERT INTO benutzer (name, salz, hash, erstellt_at) VALUES (?, ?, ?, ?)").run(name, salz, scrypt(passwort, salz).toString("hex"), jetzt.toISOString());
  return ok({ name });
}

export function setzePasswort(db, nameRoh, passwort) {
  const name = normName(nameRoh);
  if (!db.prepare("SELECT 1 FROM benutzer WHERE name = ?").get(name)) return fehler(404, "Unknown user.");
  if (typeof passwort !== "string" || passwort.length < PASSWORT_MIN || passwort.length > PASSWORT_MAX) return fehler(400, `Password: ${PASSWORT_MIN} to ${PASSWORT_MAX} characters.`);
  const salz = crypto.randomBytes(16).toString("hex");
  db.prepare("UPDATE benutzer SET salz = ?, hash = ? WHERE name = ?").run(salz, scrypt(passwort, salz).toString("hex"), name);
  db.prepare("DELETE FROM sitzung WHERE name = ?").run(name); // alte Sitzungen enden
  versuche.delete(name);
  return ok({ name });
}

// Passwort ändern (jede Person für sich): das alte Passwort muss stimmen, alle anderen Sitzungen dieser Person enden.
// Liefert bei Erfolg eine neue Sitzung, damit die Person nicht rausfliegt.
export function aendernPasswort(db, nameRoh, altes, neues, jetzt = new Date(), ip = "") {
  const name = normName(nameRoh);
  if (typeof altes !== "string" || typeof neues !== "string") return fehler(400, "Invalid request.");
  if (neues.length < PASSWORT_MIN || neues.length > PASSWORT_MAX) return fehler(400, `New password: ${PASSWORT_MIN} to ${PASSWORT_MAX} characters.`);
  if (neues === altes) return fehler(400, "The new password must be different from the current one.");
  const pruefung = anmelden(db, name, altes, jetzt, ip);   // zählt Fehlversuche mit, wie jede Anmeldung
  if (!pruefung.ok) return pruefung.status === 429 ? pruefung : fehler(403, "The current password is wrong.");
  db.prepare("DELETE FROM sitzung WHERE token_hash = ?").run(sha(pruefung.wert.token));   // die Prüf-Sitzung wird nicht gebraucht
  const r = setzePasswort(db, name, neues);
  if (!r.ok) return r;
  return anmelden(db, name, neues, jetzt, ip);
}

export const anzahlBenutzer = (db) => db.prepare("SELECT COUNT(*) n FROM benutzer").get().n;

// Meldet an und liefert ein neues Sitzungs-Token (nur dieses eine Mal im Klartext).
export function anmelden(db, nameRoh, passwort, jetzt = new Date(), ip = "") {
  const allgemein = fehler(401, "Wrong username or password.");
  const name = normName(nameRoh);
  if (typeof passwort !== "string" || passwort.length > PASSWORT_MAX || !name || name.length > 40) return allgemein;
  if (ipGesperrt(ip, jetzt)) return fehler(429, `Too many failed attempts from this address. Try again in ${SPERRE_MINUTEN} minutes.`);
  if (gesperrt(name, jetzt)) return fehler(429, `Too many failed attempts. Try again in ${SPERRE_MINUTEN} minutes.`);
  const b = db.prepare("SELECT salz, hash FROM benutzer WHERE name = ?").get(name);
  const ref = b || ATTRAPPE;
  const gleich = crypto.timingSafeEqual(scrypt(passwort, ref.salz), Buffer.from(ref.hash, "hex"));
  if (!b || !gleich) { merkeFehlversuch(name, jetzt); merkeFehlversuchIp(ip, jetzt); return allgemein; }
  versuche.delete(name);
  const token = crypto.randomBytes(32).toString("base64url");
  const ablauf = new Date(jetzt.getTime() + SITZUNG_STUNDEN * 3600e3);
  db.prepare("DELETE FROM sitzung WHERE ablauf_at < ?").run(jetzt.toISOString()); // Abgelaufenes aufräumen
  db.prepare("INSERT INTO sitzung (token_hash, name, erstellt_at, ablauf_at) VALUES (?, ?, ?, ?)").run(sha(token), name, jetzt.toISOString(), ablauf.toISOString());
  return ok({ name, token, ablauf });
}

export function sitzungFuer(db, token, jetzt = new Date()) {
  if (typeof token !== "string" || token.length < 20 || token.length > 100) return null;
  const s = db.prepare("SELECT name, ablauf_at FROM sitzung WHERE token_hash = ?").get(sha(token));
  if (!s || Date.parse(s.ablauf_at) <= jetzt.getTime()) return null;
  return { name: s.name };
}

export function abmelden(db, token) {
  if (typeof token === "string") db.prepare("DELETE FROM sitzung WHERE token_hash = ?").run(sha(token));
  return ok({});
}

export function tokenAusCookie(kopfzeile) {
  for (const teil of String(kopfzeile || "").split(";")) {
    const i = teil.indexOf("=");
    if (i > 0 && teil.slice(0, i).trim() === COOKIE) return teil.slice(i + 1).trim();
  }
  return null;
}

// Cookie: HttpOnly (kein Zugriff durch Skripte), SameSite=Strict (nicht von fremden Seiten mitgeschickt), Secure sobald HTTPS genutzt wird.
export function cookie(token, sicher, maxAlterSekunden = SITZUNG_STUNDEN * 3600) {
  return `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAlterSekunden}${sicher ? "; Secure" : ""}`;
}
