// Parture Groupwork — Produktmanagement-App (Startpunkt).
// Liest ausschließlich pm.db (Whitelist-Kopie: Katalog, Kanäle, Mengen, Preise, Bilder). Keine Kosten, keine Kunden.
// Konfiguration über .env (siehe .env.beispiel). Ohne Abhängigkeiten außer better-sqlite3.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { ladeProdukte, ladeSperre, baueBewertung } from "./bewertung.mjs";
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
  return (_appDb = d);
}
const einst = () => einstellungen.effektiv(appDb());
const produkteLaden = () => mitDb((db) => ladeProdukte(db));
// Produktnummern, die gerade in keinen Test dürfen (Sperrliste vom Hub, siehe bewertung.ladeSperre); ohne Tabelle leer
const sperreLaden = () => experimente.gesperrteNummern(mitDb((db) => ladeSperre(db)), new Date());
const HUB_URL = process.env.HUB_URL || "";
// Schreibzugriff auf eBay: nur mit Zugangsdaten in der .env dieses Rechners und nur, wenn EBAY_SCHREIBEN=an gesetzt ist.
const schreiber = ebaySchreiben.erzeuge();
const kanaeleFuer = (nummer) => mitDb((db) => db.prepare("SELECT external_id, title FROM kanal WHERE number = ? AND channel = 'ebay'").all(nummer));
const adminNoetig = (ctx) => { if (ctx?.rolle !== "admin") throw Object.assign(new Error("Only an admin can do this."), { status: 403 }); };
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
  return { umgebung: UMGEBUNG, version: versionKurz(), schreibenAn: schreiber.schreibenAn(), zugangsdaten: schreiber.konfiguriert(), benachrichtigung: melder.konfiguriert(), sicherung: sicherungStatus(), traffic: trafficStatus(), daten: datenStand(), regeln: regelZahlen() };
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
    const suche = q.get("q") ? "%" + q.get("q").toLowerCase() + "%" : null;
    // Traffic-Tabelle ist optional (eine pm.db vom Server hat sie evtl. nicht): dann bleiben die Felder leer.
    const hatTraffic = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='traffic'").get();
    const tr = (spalte, tage) => hatTraffic ? `(SELECT SUM(${spalte}) FROM traffic t WHERE t.number = produkt.number AND t.tage = ${tage})` : "NULL";
    const sql = "SELECT number, title, image_url, status, grams, print_s, ship_method, units_total, units_90d, avg_price, last_sold_at, "
      + `${tr("impressionen", 30)} impressionen_30d, ${tr("aufrufe", 30)} aufrufe_30d, ${tr("transaktionen", 30)} transaktionen_30d, ${tr("impressionen", 90)} impressionen_90d, ${tr("aufrufe", 90)} aufrufe_90d `
      + "FROM produkt" + (suche ? " WHERE lower(title) LIKE ? OR number LIKE ?" : "") + " ORDER BY units_90d DESC, units_total DESC LIMIT 500";
    return suche ? db.prepare(sql).all(suche, suche) : db.prepare(sql).all();
  }),
  "/api/traffic": () => mitDb((db) => {
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='traffic'").get()) return [];
    return db.prepare("SELECT tage, SUM(impressionen) impressionen, SUM(aufrufe) aufrufe, SUM(transaktionen) transaktionen FROM traffic GROUP BY tage ORDER BY tage").all();
  }),
  "/api/produkt": (q) => mitDb((db) => {
    const nr = q.get("nr");
    const p = db.prepare("SELECT * FROM produkt WHERE number = ?").get(nr);
    if (!p) throw Object.assign(new Error("Product " + String(nr).slice(0, 40) + " not found."), { status: 404 });
    p.kanaele = db.prepare("SELECT channel, listed, external_id, preis_aktuell, kanal_status, units_total, units_90d, last_sold_at FROM kanal WHERE number = ?").all(nr);
    p.bilder = db.prepare("SELECT url, position, kind FROM bild WHERE number = ? ORDER BY position").all(nr);
    return p;
  }),
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
  "/api/einstellungen": async (req) => antwort(einstellungen.speichere(appDb(), (await leseJson(req))?.werte)),
  "/api/einstellungen/zuruecksetzen": async (req) => { await leseJson(req); return antwort(einstellungen.zuruecksetzen(appDb())); },
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
      res.writeHead(200, { "Content-Type": MIME[path.extname(datei)] || "application/octet-stream" });
      return fs.createReadStream(datei).pipe(res);
    }
    json(404, { ok: false, error: "Not found." });
  } catch (e) { json(e.status || 500, { ok: false, error: e.message }); }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Parture Groupwork läuft: http://127.0.0.1:${PORT}  (DB: ${dbPfad()})`);
  if (SICH_AUTO) { setTimeout(pruefeSicherung, 45e3).unref(); setInterval(pruefeSicherung, 15 * 60e3).unref(); }
  if (TRAFFIC_AUTO) { console.log(`Automatischer Traffic-Import: täglich ab ${TRAFFIC_UHR}:00 Uhr (Verzögerung ${verzoegerungTage()} Tage).`); setTimeout(pruefeTrafficImport, 30e3).unref(); setInterval(pruefeTrafficImport, 15 * 60e3).unref(); }
});
