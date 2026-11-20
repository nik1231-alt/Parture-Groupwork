// Parture Groupwork — Produktmanagement-App (Startpunkt).
// Liest ausschließlich pm.db (Whitelist-Kopie: Katalog, Kanäle, Mengen, Preise, Bilder). Keine Kosten, keine Kunden.
// Konfiguration über .env (siehe .env.beispiel). Ohne Abhängigkeiten außer better-sqlite3.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { ladeProdukte, ladeSperre, baueBewertung, ebayTrafficFilter, ladeImpressionenProTag } from "./bewertung.mjs";
import { leiteSchwellenAb, TITEL_MAX_ZEICHEN } from "./regeln.mjs";
import * as einstellungen from "./einstellungen.mjs";
import * as experimente from "./experimente.mjs";
import * as login from "./login.mjs";
import * as rollen from "./rollen.mjs";
import * as protokoll from "./protokoll.mjs";
import * as freigabe from "./freigabe.mjs";
import * as ebaySchreiben from "./ebay-schreiben.mjs";
import { baueDemo } from "./demo.mjs";
import * as titelhilfe from "./titelhilfe.mjs";
import * as sicherung from "./sicherung.mjs";
import * as benachrichtigung from "./benachrichtigung.mjs";
import { laDatum, verzoegerungTage, NACHPRUEFEN_TAGE } from "./traffic.mjs";
import * as leiter from "./leiter.mjs";
import * as kiTitel from "./ki-titel.mjs";
import { pruefeTitel } from "./titel-regeln.mjs";
import { spawn } from "node:child_process";

const WURZEL = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
// PM_OHNE_ENV=1: .env nicht lesen (die Tests starten den Server so, damit sie nie echte eBay-Keys oder Schalter erben)
if (!process.env.PM_OHNE_ENV) ladeEnv(path.join(WURZEL, ".env"));
const PORT = Number(process.env.PM_PORT || 5060);
// Reihenfolge: PM_DB aus der .env, sonst daten/pm.db (Server-Nachtlauf / eigener Export), sonst die Team-Kopie aus dem Repo.
const dbPfad = () => path.resolve(WURZEL, process.env.PM_DB || (fs.existsSync(path.join(WURZEL, "daten/pm.db")) ? "daten/pm.db" : "daten-team/pm.db"));
// Eigene Daten der App (Einstellungen und Tests) liegen getrennt von pm.db, weil pm.db nachts überschrieben wird.
const APPDB_PFAD = path.resolve(WURZEL, process.env.PM_APPDB || "daten/app.db");
let _appDb = null;
function appDb() {
  if (_appDb) return _appDb;
  fs.mkdirSync(path.dirname(APPDB_PFAD), { recursive: true });
  const d = new Database(APPDB_PFAD);
  d.pragma("journal_mode = WAL");
  einstellungen.bereiteVor(d);
  experimente.bereiteVor(d);
  login.bereiteVor(d);
  rollen.bereiteVor(d);
  protokoll.bereiteVor(d);
  freigabe.bereiteVor(d);
  leiter.bereiteVor(d);
  return (_appDb = d);
}
const einst = () => einstellungen.effektiv(appDb());
const produkteLaden = () => mitDb((db) => ladeProdukte(db));
// Produktnummern, die gerade in keinen Test dürfen (Sperrliste vom Hub, siehe bewertung.ladeSperre); ohne Tabelle leer
const sperreHub = () => experimente.gesperrteNummern(mitDb((db) => ladeSperre(db)), new Date());
// Für Titeltests zusätzlich gesperrt: alles, was gerade auf der Leiter steht (sonst misst ein Test zwei Änderungen auf einmal)
const sperreLaden = () => new Set([...sperreHub(), ...leiter.aktiveNummern(appDb())]);
const HUB_URL = process.env.HUB_URL || "";
// Schreibzugriff auf eBay: nur mit Zugangsdaten in der .env dieses Rechners und nur, wenn EBAY_SCHREIBEN=an gesetzt ist.
const schreiber = ebaySchreiben.erzeuge();
// Nur aktive eBay-Angebote mit Nummer: die Kopie vom Hub führt auch beendete (listed = 0, ohne external_id), z. B. bei 12 Produkten am 19.11.
const kanaeleFuer = (nummer) => mitDb((db) => db.prepare("SELECT external_id, title FROM kanal WHERE number = ? AND channel = 'ebay' AND listed = 1 AND external_id IS NOT NULL").all(nummer));
const adminNoetig = (ctx) => { if (ctx?.rolle !== "admin") throw Object.assign(new Error("Only an admin can do this."), { status: 403 }); };

// ---- Leiter (siehe leiter.mjs): Titel per KI, dann Werbung, dann Preis, dann manuelle Prüfung ----
const ki = kiTitel.erzeuge();
const tabelleDa = (db, t) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t);
// Impressionen je Tag eines Produkts für die Tage nach "von" bis einschließlich "bis" (JJJJ-MM-TT), aus den Tageswerten in pm.db
const impTag = (nummer, von, bis) => mitDb((db) => ladeImpressionenProTag(db, nummer, von, bis));
const trafficBis = () => { try { return mitDb((db) => db.prepare("SELECT traffic_bis FROM stand").get()?.traffic_bis ?? null); } catch { return null; } };
// Preis und Varianten eines Produkts für den Preisvorschlag der Stufe 3
const leiterKontext = (nummer) => mitDb((db) => {
  const kanaele = db.prepare("SELECT external_id, title, skus, preis_aktuell FROM kanal WHERE number = ? AND channel = 'ebay' AND listed = 1 AND external_id IS NOT NULL").all(nummer);
  let varianten = []; try { varianten = JSON.parse(db.prepare("SELECT variant_meta FROM produkt WHERE number = ?").get(nummer)?.variant_meta || "null")?.values || []; } catch { /* ohne Varianten */ }
  return { kanaele, varianten };
});
const leiterDaten = (produkte = produkteLaden()) => ({ impTag, trafficBis: trafficBis(), grenze90: leiteSchwellenAb(produkte, einst(), new Date()).wenigImpressionen90d, einst: einst(), fuer: leiterKontext });
// KI-Titelvorschlag für ein Produkt auf Stufe 1 (geht durch den Regelprüfer, siehe ki-titel.mjs)
async function titelVorschlag(nummer, produkte, wer) {
  const p = produkte.find((x) => x.number === nummer);
  const alt = kanaeleFuer(nummer)[0]?.title || p?.title || "";
  const h = titelhilfe.hinweiseFuer(produkte, nummer);
  const r = await ki.vorschlag({ alt, hinweisWoerter: h.ok ? h.hinweise.map((x) => x.wort) : [] });
  if (!r.ok) { leiter.merkeFehlschlag(appDb(), nummer, r.fehler, r.verworfen); return r; }
  return leiter.setzeTitelVorschlag(appDb(), { name: wer }, nummer, { ...r.wert, alt });
}
let leiterLaeuft = false;
// Ein Lauf: Prüfzeiten auswerten, neue Angebote aufnehmen, für Stufe 1 Titel vorschlagen. Ändert nichts bei eBay.
async function leiterLauf(wer) {
  if (leiterLaeuft) return null;
  leiterLaeuft = true;
  try {
    const produkte = produkteLaden(), daten = leiterDaten(produkte);
    const ausgewertet = leiter.werteAus(appDb(), daten);
    const kontrolleVorher = leiter.anzahlKontrolle(appDb());
    const neu = leiter.nimmAuf(appDb(), produkte, daten.einst, new Date(), { imTest: experimente.imTest(appDb()), gesperrt: sperreHub() });
    let vorschlaege = 0, ohne = 0;
    for (const n of leiter.ohneTitelVorschlag(appDb())) { const r = await titelVorschlag(n, produkte, "system"); if (r.ok) vorschlaege++; else ohne++; }
    const details = { ausgewertet: ausgewertet.length, erholt: ausgewertet.filter((a) => a.erholt).length, aufgenommen: neu.length, kontrolle: leiter.anzahlKontrolle(appDb()) - kontrolleVorher, titelVorschlaege: vorschlaege, ohneVorschlag: ohne, ki: ki.konfiguriert() };
    protokoll.schreibe(appDb(), { benutzer: wer, rolle: wer === "system" ? null : "admin", aktion: "ladder_run", objekt: "ladder", details });
    return details;
  } catch (e) {
    try { protokoll.schreibe(appDb(), { benutzer: wer, rolle: wer === "system" ? null : "admin", aktion: "ladder_run", objekt: "ladder", details: { fehler: e.message }, ergebnis: "error" }); } catch { /* Protokoll nicht erreichbar */ }
    throw e;
  } finally { leiterLaeuft = false; }
}
const PM_TOKEN = process.env.PM_TOKEN || "";
// Welche Umgebung ist das? prod | vorschau | lokal (leer = lokal). Wird oben in der App angezeigt, damit niemand VORSCHAU mit PROD verwechselt.
const UMGEBUNG = ["prod", "vorschau"].includes(String(process.env.PM_UMGEBUNG || "").toLowerCase()) ? String(process.env.PM_UMGEBUNG).toLowerCase() : "lokal";
const melder = benachrichtigung.erzeuge();
const APP_URL = /^https:\/\/[\w.-]+(:\d+)?\/?$/.test(process.env.APP_URL || "") ? process.env.APP_URL.replace(/\/$/, "") : "";
// Außenzugang (Server): Cloudflare Access stellt vor jede Anfrage ein signiertes JWT (Cf-Access-Jwt-Assertion).
// Sind CF_ACCESS_TEAM_DOMAIN und CF_ACCESS_AUD gesetzt, nimmt die App NUR Anfragen mit gültigem Token an —
// auch dann, wenn jemand den Hostname einmal ohne Access-Regel anlegt. Lokal (beide leer) ist alles offen.
const CF_TEAM = process.env.CF_ACCESS_TEAM_DOMAIN || "";
const CF_AUD = process.env.CF_ACCESS_AUD || "";

function ladeEnv(p) {
  if (!fs.existsSync(p)) return;
  for (const z of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = z.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

let _jwks = { at: 0, keys: [] };
async function accessOk(req) {
  if (!CF_TEAM || !CF_AUD) return true;
  const tok = String(req.headers["cf-access-jwt-assertion"] || "");
  if (!tok) return false;
  try {
    const [h, p, sig] = tok.split(".");
    const kopf = JSON.parse(Buffer.from(h, "base64url")); const last = JSON.parse(Buffer.from(p, "base64url"));
    if (kopf.alg !== "RS256" || !(Array.isArray(last.aud) ? last.aud : [last.aud]).includes(CF_AUD) || last.exp * 1000 < Date.now()) return false;
    if (Date.now() - _jwks.at > 3600e3) { const r = await fetch(`https://${CF_TEAM}/cdn-cgi/access/certs`); _jwks = { at: Date.now(), keys: (await r.json()).keys || [] }; }
    const jwk = _jwks.keys.find((k) => k.kid === kopf.kid); if (!jwk) return false;
    const { createPublicKey, verify } = await import("node:crypto");
    return verify("RSA-SHA256", Buffer.from(h + "." + p), createPublicKey({ key: jwk, format: "jwk" }), Buffer.from(sig, "base64url"));
  } catch { return false; }
}

// Datenbank bei jeder Anfrage frisch öffnen: pm.db wird nachts atomar ersetzt, eine offene Verbindung
// würde sonst auf der alten Datei hängen.
function mitDb(fn) {
  const DB_PFAD = dbPfad();
  // Die Meldung geht an die Oberfläche: englisch und ohne Serverpfad (der steht nur in der Konsole)
  if (!fs.existsSync(DB_PFAD)) {
    console.warn("pm.db fehlt unter " + DB_PFAD);
    throw Object.assign(new Error("The product data (pm.db) is not available yet. On the server it arrives with the nightly export; locally, the team copy daten-team/pm.db is used. Please try again later."), { status: 503 });
  }
  const db = new Database(DB_PFAD, { readonly: true, fileMustExist: true });
  try { return fn(db); } finally { db.close(); }
}


// ---- Automatischer Traffic-Import: einmal täglich, nur fertige Tage (Verzögerung siehe traffic.mjs, verzoegerungTage) ----
// Läuft nur auf dem Rechner mit den eBay-Zugangsdaten und nur mit EBAY_TRAFFIC_AUTO=an. Der Import ist der Export (export-ebay.mjs):
// er baut daten/pm.db neu und ersetzt die Datei erst am Ende, bei einem Fehler bleibt die alte unverändert.
const TRAFFIC_AUTO = String(process.env.EBAY_TRAFFIC_AUTO || "").trim().toLowerCase() === "an";
const TRAFFIC_UHR = Math.min(23, Math.max(0, Number(process.env.TRAFFIC_UHRZEIT) || 5)); // frühestens um diese Uhrzeit (Ortszeit)
const STUNDE = 3600e3;
let importLaeuft = false;
const letzterImport = (ergebnis) => appDb().prepare("SELECT zeit FROM protokoll WHERE aktion = 'traffic_sync' AND ergebnis = ? ORDER BY id DESC LIMIT 1").get(ergebnis)?.zeit ?? null;
function trafficStatus() {
  return { automatisch: TRAFFIC_AUTO, zugangsdaten: schreiber.konfiguriert(), laeuft: importLaeuft, uhrzeit: TRAFFIC_UHR, verzoegerungTage: verzoegerungTage(), nachpruefenTage: NACHPRUEFEN_TAGE, letzterErfolg: letzterImport("ok"), letzterFehler: letzterImport("error") };
}
function starteTrafficImport(wer) {
  if (importLaeuft) return false;
  if (!schreiber.konfiguriert()) return false;
  importLaeuft = true;
  const kind = spawn(process.execPath, [path.join(WURZEL, "app", "export-ebay.mjs")], { cwd: WURZEL, env: process.env });
  let ausgabe = "";
  const sammle = (c) => { ausgabe = (ausgabe + c).slice(-20000); };
  kind.stdout.on("data", sammle); kind.stderr.on("data", sammle);
  const ende = (code, grund) => {
    if (!importLaeuft) return; importLaeuft = false;
    const zeilen = ausgabe.split(/\r?\n/).filter(Boolean);
    const treffer = zeilen.find((z) => z.startsWith("RESULT "));
    let details = null; try { details = treffer ? JSON.parse(treffer.slice(7)) : null; } catch { /* Ergebniszeile unlesbar */ }
    const gut = code === 0 && !!details;
    try { protokoll.schreibe(appDb(), { benutzer: wer, rolle: wer === "system" ? null : "admin", aktion: "traffic_sync", objekt: "pm.db", details: gut ? details : { fehler: grund || zeilen.slice(-4).join(" | ").slice(0, 500) }, ergebnis: gut ? "ok" : "error" }); } catch { /* Protokoll nicht erreichbar */ }
    console.log(gut ? `Traffic-Import fertig (Daten bis ${details.trafficBis}).` : "Traffic-Import fehlgeschlagen: " + (grund || zeilen.slice(-2).join(" | ")));
    if (!gut) melder.fehler("Traffic-Import", grund || zeilen.slice(-1).join(" "));
  };
  kind.on("error", (e) => ende(1, e.message));
  kind.on("close", (code) => ende(code));
  return true;
}
function pruefeTrafficImport() {
  if (!TRAFFIC_AUTO || importLaeuft || !schreiber.konfiguriert()) return;
  const jetzt = Date.now();
  if (new Date().getHours() < TRAFFIC_UHR) return;
  const ok = letzterImport("ok"), fehler = letzterImport("error");
  if (ok && jetzt - Date.parse(ok) < 20 * STUNDE) return;      // heute schon erfolgreich
  if (fehler && jetzt - Date.parse(fehler) < 2 * STUNDE && (!ok || Date.parse(fehler) > Date.parse(ok))) return; // nach einem Fehler erst in 2 Stunden wieder
  starteTrafficImport("system");
}

// Ausgerollter Stand (schreibt der Wächter, siehe waechter.mjs); lokal ohne Wächter leer
const versionKurz = () => { try { return JSON.parse(fs.readFileSync(path.join(WURZEL, "daten", "waechter-status.json"), "utf8")).commit?.slice(0, 7) || null; } catch { return null; } };

// ---- Tägliche Sicherung von app.db und traffic-tage.db (siehe sicherung.mjs) ----
const SICH_AUTO = String(process.env.SICHERUNG_AUTO || "an").trim().toLowerCase() !== "aus";
const SICH_UHR = Math.min(23, Math.max(0, Number(process.env.SICHERUNG_UHRZEIT ?? 3) || 0));
let sicherungLaeuft = false, letzterSicherungsFehler = 0;
async function fuehreSicherungAus(wer) {
  if (sicherungLaeuft) return null;
  sicherungLaeuft = true;
  try {
    const r = await sicherung.sichere(sicherung.konfiguration());
    const gut = !r.fehler.length && r.gesichert.length > 0;
    if (!gut) letzterSicherungsFehler = Date.now();
    try { protokoll.schreibe(appDb(), { benutzer: wer, rolle: wer === "system" ? null : "admin", aktion: "backup", objekt: "app.db, traffic-tage.db", details: { dateien: r.gesichert.map((g) => path.basename(g.datei)), fehler: r.fehler }, ergebnis: gut ? "ok" : "error" }); } catch { /* Protokoll nicht erreichbar */ }
    if (!gut) melder.fehler("Datensicherung", r.fehler.join("; ") || "keine Daten gefunden");
    console.log(gut ? `Sicherung fertig (${r.gesichert.length} Dateien).` : "Sicherung fehlgeschlagen: " + r.fehler.join("; "));
    return { gut, dateien: r.gesichert.length, fehler: r.fehler };
  } catch (e) { letzterSicherungsFehler = Date.now(); console.log("Sicherung fehlgeschlagen: " + e.message); return { gut: false, dateien: 0, fehler: [e.message] }; }
  finally { sicherungLaeuft = false; }
}
function pruefeSicherung() {
  if (!SICH_AUTO || sicherungLaeuft || new Date().getHours() < SICH_UHR) return;
  if (Date.now() - letzterSicherungsFehler < 2 * STUNDE) return;
  const neueste = sicherung.liste(sicherung.konfiguration().ziel)[0];
  if (neueste && Date.now() - Date.parse(neueste.geaendert) < 20 * STUNDE) return;
  fuehreSicherungAus("system");
}
function sicherungStatus() {
  const k = sicherung.konfiguration(); const alle = sicherung.liste(k.ziel);
  return { automatisch: SICH_AUTO, uhrzeit: SICH_UHR, letzte: alle[0]?.geaendert ?? null, anzahl: alle.length, zweiterOrt: !!k.ziel2, laeuft: sicherungLaeuft };
}
// Wie alt sind die Traffic-Daten im Vergleich zum Soll? Soll: heute minus Verzögerung (LA-Zeit). 2 Tage und mehr dahinter = veraltet.
function datenStand() {
  let bis = null; try { bis = mitDb((db) => db.prepare("SELECT traffic_bis FROM stand").get()?.traffic_bis ?? null); } catch { /* keine pm.db */ }
  if (!bis || !/^\d{4}-\d{2}-\d{2}$/.test(bis)) return { trafficBis: null, rueckstandTage: null, veraltet: false };
  const soll = laDatum(new Date(), verzoegerungTage());
  const rueckstand = Math.round((Date.parse(soll) - Date.parse(bis)) / 864e5);
  return { trafficBis: bis, soll, rueckstandTage: rueckstand, veraltet: rueckstand >= 2 };
}
// Die festen Zahlen der App, je aus genau einer Konstante: die Oberfläche zeigt sie von hier statt eigene Kopien zu führen
const regelZahlen = () => ({ titelMaxZeichen: TITEL_MAX_ZEICHEN, maxAenderungen: freigabe.MAX_AENDERUNGEN, zielmarke: einst().besserAb, maxFehlversuche: login.MAX_FEHLVERSUCHE, sperreMinuten: login.SPERRE_MINUTEN, verzoegerungTage: verzoegerungTage(), nachpruefenTage: NACHPRUEFEN_TAGE });
function betriebStatus() {
  return { umgebung: UMGEBUNG, version: versionKurz(), schreibenAn: schreiber.schreibenAn(), zugangsdaten: schreiber.konfiguriert(), benachrichtigung: melder.konfiguriert(), sicherung: sicherungStatus(), traffic: trafficStatus(), daten: datenStand(), regeln: regelZahlen(), leiter: leiterStatus() };
}

// ---- Täglicher Lauf der Leiter (ab LEITER_UHRZEIT, Standard 6 Uhr, nach dem Traffic-Import). LEITER_AUTO=aus schaltet ihn ab. ----
// Der Lauf ändert nichts bei eBay: er wertet aus, nimmt auf und schlägt Titel vor. Geändert wird erst nach einer Freigabe.
const LEITER_AUTO = String(process.env.LEITER_AUTO || "an").trim().toLowerCase() !== "aus";
const LEITER_UHR = Math.min(23, Math.max(0, Number(process.env.LEITER_UHRZEIT ?? 6) || 0));
const letzterLeiterLauf = () => appDb().prepare("SELECT zeit, ergebnis, details FROM protokoll WHERE aktion = 'ladder_run' ORDER BY id DESC LIMIT 1").get() || null;
function leiterStatus() {
  const l = letzterLeiterLauf();
  return { automatisch: LEITER_AUTO, uhrzeit: LEITER_UHR, laeuft: leiterLaeuft, letzterLauf: l?.zeit ?? null, letzterFehler: l?.ergebnis === "error", ki: ki.konfiguriert(), kiModell: ki.konfiguriert() ? ki.modell() : null, werbungAn: schreiber.schreibenAn() && schreiber.werbungAn(), preisAn: schreiber.schreibenAn() && schreiber.preisAn() };
}
function pruefeLeiter() {
  if (!LEITER_AUTO || leiterLaeuft || new Date().getHours() < LEITER_UHR) return;
  const l = letzterLeiterLauf();
  // Nachholen: lief der letzte Lauf ohne KI-Schlüssel und ist er jetzt da, sofort noch einmal laufen, statt einen Tag zu warten
  // (20.11.: Schlüssel mittags eingetragen, alle 20 Karten zeigten bis zum nächsten Morgen "no AI key").
  const ohneKiGelaufen = (() => { try { return JSON.parse(l?.details || "{}").ki === false; } catch { return false; } })();
  if (l && Date.now() - Date.parse(l.zeit) < (l.ergebnis === "error" ? 2 : 20) * STUNDE && !(ohneKiGelaufen && ki.konfiguriert())) return;
  leiterLauf("system").catch((e) => { console.log("Leiter-Lauf fehlgeschlagen: " + e.message); melder.fehler("Leiter-Lauf", e.message); });
}

const ROUTEN = {
  "/api/stand": () => mitDb((db) => db.prepare("SELECT * FROM stand").get()),
  // Freigaben (Vorschläge für Titeländerungen bei eBay), Protokoll und Rollen
  "/api/freigaben": () => ({ schreibenAn: schreiber.schreibenAn(), zugangsdaten: schreiber.konfiguriert(), maxAenderungen: freigabe.MAX_AENDERUNGEN, offen: freigabe.zaehleOffen(appDb()), aenderungen: freigabe.liste(appDb()) }),
  "/api/protokoll": () => protokoll.liste(appDb(), 300),
  "/api/traffic/status": () => trafficStatus(),
  "/api/betrieb": () => betriebStatus(),
  "/api/demo": () => baueDemo(einst()),
  // Hinweise für neue Titel aus den eigenen Daten (keine erfundenen Titel, siehe titelhilfe.mjs)
  "/api/titelhilfe": (q) => titelhilfe.hinweiseFuer(produkteLaden(), String(q.get("nr") || "").slice(0, 40)),
  "/api/rollen": (q, ctx) => { adminNoetig(ctx); return { benutzer: rollen.liste(appDb()), admins: rollen.anzahlAdmins(appDb()) }; },
  // Alle Angebote mit Bereich, Empfehlung und Begründung (siehe regeln.mjs), dazu ob sie in einem Test stecken.
  "/api/bewertung": () => baueBewertung(produkteLaden(), einst(), new Date(), experimente.imTest(appDb())),
  // Einstellungen: Formularbeschreibung, aktuelle Werte, Startwerte und die aus den Daten berechnete Grenze.
  "/api/einstellungen": () => {
    const e = einst();
    return { abschnitte: einstellungen.ABSCHNITTE, schema: einstellungen.SCHEMA, werte: Object.fromEntries(einstellungen.SCHEMA.map((f) => [f.key, e[f.key]])), standard: einstellungen.STANDARD,
      abgeleitet: { wenigImpressionen90d: leiteSchwellenAb(produkteLaden(), e, new Date()).wenigImpressionen90d } };
  },
  // Tests
  "/api/experimente": () => {
    const produkte = produkteLaden(), gesperrt = sperreLaden();
    return { tests: experimente.liste(appDb(), produkte, new Date(), einst()), moeglich: experimente.kandidaten(appDb(), produkte, einst(), new Date(), gesperrt).length, gesperrt: gesperrt.size, testGroesse: einst().testGroesse, titelMaxZeichen: TITEL_MAX_ZEICHEN };
  },
  "/api/experiment": (q) => {
    const r = experimente.detail(appDb(), Number(q.get("id")), produkteLaden(), new Date(), einst());
    if (!r.ok) throw Object.assign(new Error(r.fehler), { status: r.status });
    return r.wert;
  },
  "/api/produkte": (q) => mitDb((db) => {
    const suche = (q.get("q") || "").toLowerCase();
    return ladeProdukte(db).filter((p) => !suche || String(p.title || "").toLowerCase().includes(suche) || p.number.includes(suche))
      .sort((a, b) => (b.units_90d || 0) - (a.units_90d || 0) || (b.units_total || 0) - (a.units_total || 0)).slice(0, 500);
  }),
  "/api/traffic": () => mitDb((db) => {
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='traffic'").get()) return [];
    return db.prepare("SELECT tage, SUM(impressionen) impressionen, SUM(aufrufe) aufrufe, SUM(transaktionen) transaktionen FROM traffic t WHERE " + ebayTrafficFilter(db) + " GROUP BY tage ORDER BY tage").all();
  }),
  "/api/produkt": (q) => mitDb((db) => {
    const nr = q.get("nr");
    const p = db.prepare("SELECT * FROM produkt WHERE number = ?").get(nr);
    if (!p) throw Object.assign(new Error("Product " + String(nr).slice(0, 40) + " not found."), { status: 404 });
    const analyse = ladeProdukte(db).find((x) => x.number === nr);
    if (!analyse) throw Object.assign(new Error("No eBay listing for this product."), { status: 404 });
    Object.assign(p, analyse);
    p.kanaele = db.prepare("SELECT channel, listed, external_id, preis_aktuell, kanal_status, units_total, units_90d, last_sold_at FROM kanal WHERE number = ?").all(nr);
    p.bilder = db.prepare("SELECT url, position, kind FROM bild WHERE number = ? ORDER BY position").all(nr);
    return p;
  }),
  // Leiter: jede Stufe mit ihren Angeboten, Zwischenständen und Lebensläufen, dazu Schalter und letzter Lauf
  "/api/leiter": () => {
    const produkte = produkteLaden(), daten = leiterDaten(produkte);
    const optionen = { imTest: experimente.imTest(appDb()), gesperrt: sperreHub() };
    const k = leiter.kandidaten(appDb(), produkte, daten.einst, new Date(), optionen);
    return { ...leiter.uebersicht(appDb(), produkte, daten), kandidaten: k.length, status: leiterStatus(),
      kandidatenListe: k.map((p) => ({ number: p.number, title: p.title ?? null, impressionen_90d: p.impressionen_90d ?? null, units_90d: p.units_90d ?? null })),
      trichter: leiter.trichter(appDb(), produkte, daten.einst, new Date(), optionen) };
  },
  // Alles, was mit einem Produkt geschehen ist: Stand auf der Leiter, Lebenslauf und die Protokolleinträge (für die Seite Products)
  "/api/produkt/verlauf": (q) => {
    const nr = String(q.get("nr") ?? "").slice(0, 40), db = appDb();
    const zeile = db.prepare("SELECT stufe, phase, ergebnis, eingestiegen_at, stufe_start FROM leiter WHERE number = ?").get(nr) || null;
    const verlauf = db.prepare("SELECT stufe, ereignis, details, benutzer, at FROM leiter_verlauf WHERE number = ? ORDER BY id").all(nr).map((v) => ({ ...v, details: v.details ? JSON.parse(v.details) : null }));
    const eintraege = db.prepare("SELECT zeit, benutzer, aktion, details, ergebnis FROM protokoll WHERE objekt = ? ORDER BY id DESC LIMIT 50").all("product " + nr);
    return { number: nr, leiter: zeile, verlauf, protokoll: eintraege };
  },
  "/api/kanaele": () => mitDb((db) => db.prepare("SELECT channel, COUNT(*) produkte, SUM(listed) gelistet, SUM(units_90d) stueck_90d FROM kanal GROUP BY channel ORDER BY produkte DESC").all()),
  // Live-Stand vom Hub (nur auf dem Server, lokal fehlt HUB_URL): dieselbe Whitelist, aber Stand jetzt statt 04:30.
  "/api/live": async () => {
    if (!HUB_URL || !PM_TOKEN) throw Object.assign(new Error("Live data is only available on the server (HUB_URL/PM_TOKEN)."), { status: 503 });
    const r = await fetch(HUB_URL + "/api/pm/katalog", { headers: { "x-pm-token": PM_TOKEN } });
    if (!r.ok) throw Object.assign(new Error("The hub answered with HTTP " + r.status + "."), { status: 502 });
    return r.json();
  },
};

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png" };

const MAX_BODY = 10 * 1024;
function leseJson(req) {
  return new Promise((resolve, reject) => {
    const fehler = (status, msg) => reject(Object.assign(new Error(msg), { status }));
    if (!String(req.headers["content-type"] || "").startsWith("application/json")) return fehler(415, "Expected application/json.");
    // Schutz vor fremden Webseiten: ein Origin-Header muss zum eigenen Host passen.
    const origin = req.headers.origin;
    let herkunft = null;
    try { herkunft = origin ? new URL(origin).host : null; } catch { return fehler(403, "Request from a foreign origin rejected."); }
    if (herkunft && herkunft !== req.headers.host) return fehler(403, "Request from a foreign origin rejected.");
    let n = 0; const teile = [];
    req.on("data", (c) => { n += c.length; if (n > MAX_BODY) fehler(413, "Request too large."); else teile.push(c); });
    req.on("end", () => { try { resolve(JSON.parse(Buffer.concat(teile).toString("utf8"))); } catch { fehler(400, "Not valid JSON."); } });
    req.on("error", () => fehler(400, "Request aborted."));
  });
}

// Jede Funktion prüft die Eingabe selbst (Typen, Grenzen, Zustand) und liefert { ok, wert } oder { ok: false, status, fehler }.
const antwort = (r) => { if (!r.ok) throw Object.assign(new Error(r.fehler), { status: r.status || 400 }); return r.wert; };
const POST_ROUTEN = {
  "/api/einstellungen": async (req, ctx) => { adminNoetig(ctx); return antwort(einstellungen.speichere(appDb(), (await leseJson(req))?.werte)); },
  "/api/einstellungen/zuruecksetzen": async (req, ctx) => { adminNoetig(ctx); await leseJson(req); return antwort(einstellungen.zuruecksetzen(appDb())); },
  "/api/experiment": async (req, ctx) => {
    const r = antwort(experimente.legeAn(appDb(), await leseJson(req), produkteLaden(), einst(), new Date(), undefined, sperreLaden()));
    // Der seed steht im Protokoll: damit lässt sich das Los später mit denselben Kandidaten nachrechnen
    protokoll.schreibe(appDb(), { benutzer: ctx.name, rolle: ctx.rolle, aktion: "test_created", objekt: "test " + r.id, details: { seed: r.seed, test: r.test, kontrolle: r.kontrolle, gesperrt: r.gesperrt } });
    return r;
  },
  "/api/experiment/titel": async (req) => antwort(experimente.setzeTitel(appDb(), await leseJson(req))),
  // Builder und Admin: Vorschlag zur Freigabe senden. Erst ein Admin lässt die Titel bei eBay ändern.
  "/api/experiment/freigabe": async (req, ctx) => {
    const b = await leseJson(req);
    const r = antwort(freigabe.reicheEin(appDb(), ctx, b, kanaeleFuer));
    const name = appDb().prepare("SELECT name FROM experiment WHERE id = ?").get(r.id)?.name || "test " + r.id;
    melder.vorschlag(ctx.name, r.aenderungen, name, APP_URL ? APP_URL + "/#approvals" : "");   // ohne await: eine Meldung darf die Antwort nie aufhalten
    return r;
  },
  // Direkt starten, ohne dass die App bei eBay etwas ändert (der Admin hat die Titel selbst geändert).
  "/api/experiment/start": async (req, ctx) => {
    adminNoetig(ctx);
    const b = await leseJson(req);
    const r = antwort(experimente.starte(appDb(), b, produkteLaden()));
    protokoll.schreibe(appDb(), { benutzer: ctx.name, rolle: ctx.rolle, aktion: "test_started_manually", objekt: "test " + r.id, details: { hinweis: "Started without changing eBay through the app" } });
    return r;
  },
  "/api/experiment/abschluss": async (req, ctx) => {
    const b = await leseJson(req);
    const r = antwort(experimente.schliesse(appDb(), b));
    freigabe.beimAbschluss(appDb(), ctx, r.id, r.abschluss);
    protokoll.schreibe(appDb(), { benutzer: ctx.name, rolle: ctx.rolle, aktion: "test_closed", objekt: "test " + r.id, details: { abschluss: r.abschluss } });
    return r;
  },
  "/api/freigabe/erteilen": async (req, ctx) => { adminNoetig(ctx); return antwort(await freigabe.erteile(appDb(), ctx, await leseJson(req), schreiber, produkteLaden())); },
  "/api/freigabe/ablehnen": async (req, ctx) => { adminNoetig(ctx); return antwort(freigabe.lehneAb(appDb(), ctx, await leseJson(req))); },
  "/api/traffic/import": async (req, ctx) => {
    adminNoetig(ctx); await leseJson(req);
    if (!schreiber.konfiguriert()) throw Object.assign(new Error("This computer has no eBay credentials."), { status: 409 });
    if (!starteTrafficImport(ctx.name)) throw Object.assign(new Error("An import is already running."), { status: 409 });
    return { gestartet: true };
  },
  "/api/sicherung": async (req, ctx) => { adminNoetig(ctx); await leseJson(req); const r = await fuehreSicherungAus(ctx.name); if (!r) throw Object.assign(new Error("A backup is already running."), { status: 409 }); if (!r.gut) throw Object.assign(new Error("Backup failed: " + r.fehler.join("; ")), { status: 500 }); return r; },
  "/api/rolle": async (req, ctx) => { adminNoetig(ctx); const b = await leseJson(req); return antwort(rollen.setzeRolle(appDb(), ctx, b?.name, b?.rolle)); },
  // ---- Leiter ----
  "/api/leiter/lauf": async (req, ctx) => { adminNoetig(ctx); await leseJson(req); const r = await leiterLauf(ctx.name); if (!r) throw Object.assign(new Error("The ladder is already running."), { status: 409 }); return r; },
  "/api/leiter/freigabe": async (req, ctx) => {
    adminNoetig(ctx);
    const nr = String((await leseJson(req))?.number ?? "").slice(0, 40);
    return antwort(await leiter.gibFrei(appDb(), ctx, nr, { items: leiterKontext(nr).kanaele, schreiber, impTag }));
  },
  // Admin setzt ein Angebot aus der Auswahlliste auf die Leiter; der KI-Titelvorschlag wird gleich mitgeholt (ändert nichts bei eBay)
  "/api/leiter/aufnehmen": async (req, ctx) => {
    adminNoetig(ctx);
    const nr = String((await leseJson(req))?.number ?? "").slice(0, 40), produkte = produkteLaden();
    const r = leiter.nimmVonHandAuf(appDb(), ctx, nr, produkte, einst(), new Date(), { imTest: experimente.imTest(appDb()), gesperrt: sperreHub() });
    if (!r.ok) return antwort(r);
    const v = await titelVorschlag(nr, produkte, ctx.name);
    return { number: nr, vorschlag: v.ok, hinweis: v.ok ? null : v.fehler };
  },
  "/api/leiter/vonhand": async (req, ctx) => { adminNoetig(ctx); const b = await leseJson(req); return antwort(leiter.starteVonHand(appDb(), ctx, String(b?.number ?? "").slice(0, 40), { impTag })); },
  "/api/leiter/ueberspringen": async (req, ctx) => { adminNoetig(ctx); const b = await leseJson(req); return antwort(leiter.ueberspringe(appDb(), ctx, String(b?.number ?? "").slice(0, 40), b?.grund, einst(), { fuer: leiterKontext })); },
  "/api/leiter/entscheidung": async (req, ctx) => { adminNoetig(ctx); const b = await leseJson(req); return antwort(leiter.entscheide(appDb(), ctx, String(b?.number ?? "").slice(0, 40), b?.entscheidung, b?.notiz)); },
  "/api/leiter/abbrechen": async (req, ctx) => { adminNoetig(ctx); const b = await leseJson(req); return antwort(leiter.brichAb(appDb(), ctx, String(b?.number ?? "").slice(0, 40), b?.grund)); },
  // Builder und Admin: einen Titel von Hand eintragen (muss den Regelprüfer bestehen) oder die KI erneut fragen
  "/api/leiter/titel": async (req, ctx) => {
    const b = await leseJson(req);
    const nr = String(b?.number ?? "").slice(0, 40), titel = typeof b?.titel === "string" ? b.titel.replace(/\s+/g, " ").trim().slice(0, 200) : "";
    const alt = kanaeleFuer(nr)[0]?.title || "";
    const pruefung = pruefeTitel(titel, alt);
    if (!pruefung.ok) throw Object.assign(new Error("The title breaks a rule: " + pruefung.verstoesse.map((v) => v.text).join(" ")), { status: 400 });
    return antwort(leiter.setzeTitelVorschlag(appDb(), ctx, nr, { titel, alt, begruendung: "Entered by hand.", quelle: "hand", pruefung }));
  },
  "/api/leiter/neuvorschlag": async (req, ctx) => {
    const nr = String((await leseJson(req))?.number ?? "").slice(0, 40);
    const r = await titelVorschlag(nr, produkteLaden(), ctx.name);
    return antwort(r);
  },
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const json = (code, body) => { res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }); res.end(JSON.stringify(body)); };
  // Schutz-Header für jede Antwort: kein Einbetten in fremde Seiten, kein Raten des Dateityps, Skripte nur aus der eigenen App.
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Content-Security-Policy", "default-src 'self'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'");
  try {
    if (url.pathname === "/healthz") return json(200, { ok: true, version: versionKurz() });
    if (!(await accessOk(req))) return json(401, { ok: false, error: "No valid access (Cloudflare Access)." });
    // ---- Login: ohne Anmeldung sind nur die Anmeldeseite, ihre Dateien und /api/login erreichbar ----
    const sicher = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim() === "https";
    const token = login.tokenAusCookie(req.headers.cookie);
    const benutzer = login.sitzungFuer(appDb(), token);
    // Adresse für die Sperre bei Fehlversuchen: hinter Cloudflare (Access ist dann Pflicht) die echte Adresse aus dem Cloudflare-Header, sonst die Verbindung
    const ip = (CF_TEAM && CF_AUD && String(req.headers["cf-connecting-ip"] || "").slice(0, 64)) || req.socket.remoteAddress || "";
    if (req.method === "POST" && url.pathname === "/api/login") {
      const b = await leseJson(req);
      const r = login.anmelden(appDb(), b?.name, b?.passwort, new Date(), ip);
      if (!r.ok) return json(r.status, { ok: false, error: r.fehler });
      res.setHeader("Set-Cookie", login.cookie(r.wert.token, sicher));
      return json(200, { ok: true, daten: { name: r.wert.name } });
    }
    if (req.method === "POST" && url.pathname === "/api/passwort") {
      if (!benutzer) return json(401, { ok: false, error: "Please sign in." });
      const b = await leseJson(req);
      const r = login.aendernPasswort(appDb(), benutzer.name, b?.altes, b?.neues, new Date(), ip);
      if (!r.ok) return json(r.status, { ok: false, error: r.fehler });
      try { protokoll.schreibe(appDb(), { benutzer: benutzer.name, rolle: rollen.rolleVon(appDb(), benutzer.name) ?? "builder", aktion: "password_changed", objekt: "user " + benutzer.name }); } catch { /* Protokoll nicht erreichbar */ }
      res.setHeader("Set-Cookie", login.cookie(r.wert.token, sicher));
      return json(200, { ok: true, daten: {} });
    }
    if (req.method === "POST" && url.pathname === "/api/logout") {
      await leseJson(req);
      login.abmelden(appDb(), token);
      res.setHeader("Set-Cookie", login.cookie("", sicher, 0));
      return json(200, { ok: true, daten: {} });
    }
    if (url.pathname === "/api/ich" && (req.method === "GET" || req.method === "HEAD")) return json(200, { ok: true, daten: { angemeldet: !!benutzer, name: benutzer?.name || null, rolle: benutzer ? rollen.rolleVon(appDb(), benutzer.name) ?? "builder" : null, keineBenutzer: benutzer ? false : login.anzahlBenutzer(appDb()) === 0 } });
    if (!benutzer) {
      const offen = ["/login.html", "/login.js", "/app.css"];
      if ((req.method === "GET" || req.method === "HEAD") && (url.pathname === "/" || offen.includes(url.pathname))) url.pathname = url.pathname === "/" ? "/login.html" : url.pathname;
      else return json(401, { ok: false, error: "Please sign in." });
    }
    const ctx = benutzer ? { name: benutzer.name, rolle: rollen.rolleVon(appDb(), benutzer.name) ?? "builder" } : null;
    // Dieselbe Adresse darf lesen (GET) und schreiben (POST): die Methode entscheidet
    if (req.method === "POST" && Object.hasOwn(POST_ROUTEN, url.pathname)) return json(200, { ok: true, daten: await POST_ROUTEN[url.pathname](req, ctx) });
    const route = Object.hasOwn(ROUTEN, url.pathname) ? ROUTEN[url.pathname] : null;
    if (route && (req.method === "GET" || req.method === "HEAD")) return json(200, { ok: true, daten: await route(url.searchParams, ctx) });
    if (route) return json(405, { ok: false, error: "GET only." });
    if (Object.hasOwn(POST_ROUTEN, url.pathname)) return json(405, { ok: false, error: "POST only." });
    // statische Dateien aus public/
    const rel = url.pathname === "/" ? "/index.html" : url.pathname;
    const datei = path.join(WURZEL, "public", path.normalize(rel).replace(/^(\.\.[/\\])+/, ""));
    if (datei.startsWith(path.join(WURZEL, "public")) && fs.existsSync(datei) && fs.statSync(datei).isFile()) {
      // no-cache: der Browser (und Cloudflare) fragt bei jedem Laden nach, ob es eine neue Version gibt. Ohne die Angabe lieferte
      // Cloudflare nach einem Ausrollen bis zu 2 Stunden das alte app.js aus (20.11.: alte Karte "no AI key" trotz neuem Stand).
      res.writeHead(200, { "Content-Type": MIME[path.extname(datei)] || "application/octet-stream", "Cache-Control": "no-cache" });
      return fs.createReadStream(datei).pipe(res);
    }
    json(404, { ok: false, error: "Not found." });
  } catch (e) { json(e.status || 500, { ok: false, error: e.message }); }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Parture Groupwork läuft: http://127.0.0.1:${PORT}  (DB: ${dbPfad()})`);
  if (SICH_AUTO) { setTimeout(pruefeSicherung, 45e3).unref(); setInterval(pruefeSicherung, 15 * 60e3).unref(); }
  if (LEITER_AUTO) { setTimeout(pruefeLeiter, 60e3).unref(); setInterval(pruefeLeiter, 15 * 60e3).unref(); }
  if (TRAFFIC_AUTO) { console.log(`Automatischer Traffic-Import: täglich ab ${TRAFFIC_UHR}:00 Uhr (Verzögerung ${verzoegerungTage()} Tage).`); setTimeout(pruefeTrafficImport, 30e3).unref(); setInterval(pruefeTrafficImport, 15 * 60e3).unref(); }
});
