// Parture Groupwork — Produktmanagement-App (Startpunkt).
// Reads only pm.db (whitelist copy: catalogue, channels, quantities, prices, images). No costs, no customers.
// Configuration through .env (see .env.beispiel). No dependencies except better-sqlite3.
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
import { baueErgebnisse, zwischenstand } from "./ergebnisse.mjs";
import { baueDemoErgebnisse } from "./ergebnisse-demo.mjs";
import { baueDemo } from "./demo.mjs";
import * as titelhilfe from "./titelhilfe.mjs";
import * as sicherung from "./sicherung.mjs";
import * as benachrichtigung from "./benachrichtigung.mjs";
import { laDatum, verzoegerungTage, verzoegerungFuer, NACHPRUEFEN_TAGE } from "./traffic.mjs";
import * as leiter from "./leiter.mjs";
import * as problem from "./problem.mjs";
import * as dashboard from "./dashboard.mjs";
import * as kiTitel from "./ki-titel.mjs";
import { pruefeTitel } from "./titel-regeln.mjs";
import { spawn } from "node:child_process";

const WURZEL = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
// PM_OHNE_ENV=1: do not read the .env (the tests start the server this way so that they never inherit real eBay keys or switches)
if (!process.env.PM_OHNE_ENV) ladeEnv(path.join(WURZEL, ".env"));
const PORT = Number(process.env.PM_PORT || 5060);
// Order: PM_DB from the .env, otherwise daten/pm.db (server night run / own export), otherwise the team copy from the repository.
const dbPfad = () => path.resolve(WURZEL, process.env.PM_DB || (fs.existsSync(path.join(WURZEL, "daten/pm.db")) ? "daten/pm.db" : "daten-team/pm.db"));
// The app's own data (settings and tests) lives apart from pm.db, because pm.db is overwritten at night.
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
// Product numbers that must not go into any test right now (block list from the hub, see bewertung.ladeSperre); empty without the table
const sperreHub = () => experimente.gesperrteNummern(mitDb((db) => ladeSperre(db)), new Date());
// Additionally blocked for title tests: everything that is on the ladder right now (otherwise a test measures two changes at once)
const sperreLaden = () => new Set([...sperreHub(), ...leiter.aktiveNummern(appDb())]);
const HUB_URL = process.env.HUB_URL || "";
// Write access to eBay: only with credentials in the .env of this computer and only if EBAY_SCHREIBEN=an is set.
const schreiber = ebaySchreiben.erzeuge();
// Only active eBay listings with a number: the copy from the hub also holds ended ones (listed = 0, without external_id), e.g. for 12 products on 19 Nov.
const kanaeleFuer = (nummer) => mitDb((db) => db.prepare("SELECT external_id, title FROM kanal WHERE number = ? AND channel = 'ebay' AND listed = 1 AND external_id IS NOT NULL").all(nummer));
const adminNoetig = (ctx) => { if (ctx?.rolle !== "admin") throw Object.assign(new Error("Only an admin can do this."), { status: 403 }); };

// ---- Ladder (see leiter.mjs): title by AI, then ads, then price, then manual check ----
const ki = kiTitel.erzeuge();
const tabelleDa = (db, t) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t);
// Impressions per day of a product for the days after "von" up to and including "bis" (YYYY-MM-DD), from the daily values in pm.db
const impTag = (nummer, von, bis) => mitDb((db) => ladeImpressionenProTag(db, nummer, von, bis));
const trafficBis = () => { try { return mitDb((db) => db.prepare("SELECT traffic_bis FROM stand").get()?.traffic_bis ?? null); } catch { return null; } };
// Price and variants of a product for the price suggestion of step 3
const leiterKontext = (nummer) => mitDb((db) => {
  const kanaele = db.prepare("SELECT external_id, title, skus, preis_aktuell FROM kanal WHERE number = ? AND channel = 'ebay' AND listed = 1 AND external_id IS NOT NULL").all(nummer);
  let varianten = []; try { varianten = JSON.parse(db.prepare("SELECT variant_meta FROM produkt WHERE number = ?").get(nummer)?.variant_meta || "null")?.values || []; } catch { /* ohne Varianten */ }
  return { kanaele, varianten };
});
// ---- Already advertised? (Niko, 20 Nov: listings that are already advertised are not eligible for phase 2 → price step) ----
// werbungStand: all advertised eBay listings from the running campaigns, with the campaign name per product number. For display;
// before every step in phase 2 istBeworben asks about the single listing once more, live.
let werbungStand = { at: 0, nummern: {}, fehler: null, laeuft: false };
async function aktualisiereWerbung() {
  if (werbungStand.laeuft) return;
  werbungStand.laeuft = true;
  try {
    const r = await schreiber.beworbeneAngebote();
    if (!r.ok) { werbungStand = { ...werbungStand, at: Date.now(), fehler: r.meldung }; return; }
    const nummern = {};
    for (const k of mitDb((db) => db.prepare("SELECT number, external_id FROM kanal WHERE channel = 'ebay' AND external_id IS NOT NULL").all())) if (r.angebote[k.external_id]) nummern[k.number] = r.angebote[k.external_id];
    werbungStand = { at: Date.now(), nummern, fehler: null };
    await werbungSpruenge();
  } catch (e) { werbungStand = { ...werbungStand, at: Date.now(), fehler: e.message }; } finally { werbungStand.laeuft = false; }
}
// Every listing that waits for a suggestion in phase 2 and is already advertised according to eBay jumps to the price step.
async function werbungSpruenge(nummern = null) {
  const db = appDb(), ergebnis = [];
  const offen = nummern || db.prepare("SELECT number FROM leiter WHERE stufe = 'werbung' AND phase = 'vorschlag'").all().map((z) => z.number);
  for (const nr of offen) {
    const items = leiterKontext(nr).kanaele;
    for (const it of items) {
      const b = await schreiber.istBeworben(it.external_id);
      if (b.ok && b.beworben) { const r = leiter.springeUeberWerbung(db, nr, b, einst(), { fuer: leiterKontext }); if (r.ok) ergebnis.push({ number: nr, kampagnen: b.kampagnen }); break; }
    }
  }
  return ergebnis;
}
// Approval of a ladder step. Phase 2 only if eBay confirms that the listing is not advertised yet; otherwise it jumps to
// the price step. If this cannot be checked (no access, eBay error), nothing is approved.
async function freigeben(ctx, nr) {
  const z = appDb().prepare("SELECT stufe, phase FROM leiter WHERE number = ?").get(nr);
  if (z?.stufe === "werbung" && z.phase === "vorschlag") {
    for (const it of leiterKontext(nr).kanaele) {
      const b = await schreiber.istBeworben(it.external_id);
      if (!b.ok) throw Object.assign(new Error(b.meldung + " Nothing was changed."), { status: 409 });
      if (b.beworben) {
        leiter.springeUeberWerbung(appDb(), nr, b, einst(), { fuer: leiterKontext });
        return { number: nr, ausgang: "uebersprungen", text: `Already advertised (${b.kampagnen.join(", ")}): the listing skipped the ads phase and is now at the price step.` };
      }
    }
  }
  return antwort(await leiter.gibFrei(appDb(), ctx, nr, { items: leiterKontext(nr).kanaele, schreiber, impTag, einst: einst() }));
}
const leiterDaten = (produkte = produkteLaden()) => ({ impTag, trafficBis: trafficBis(), grenze90: leiteSchwellenAb(produkte, einst(), new Date()).wenigImpressionen90d, einst: einst(), fuer: leiterKontext });
// AI title suggestion for a product in step 1 (goes through the rule checker, see ki-titel.mjs)
async function titelVorschlag(nummer, produkte, wer) {
  const p = produkte.find((x) => x.number === nummer);
  const alt = kanaeleFuer(nummer)[0]?.title || p?.title || "";
  const h = titelhilfe.hinweiseFuer(produkte, nummer);
  const r = await ki.vorschlag({ alt, hinweisWoerter: h.ok ? h.hinweise.map((x) => x.wort) : [] });
  if (!r.ok) { leiter.merkeFehlschlag(appDb(), nummer, r.fehler, r.verworfen); return r; }
  return leiter.setzeTitelVorschlag(appDb(), { name: wer }, nummer, { ...r.wert, alt });
}
// Page Dashboard (ergebnisse.mjs): starts and evaluations of the ladder, the control group and the daily values of these listings
const leseDetails = (s) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };
function dashboardDaten() {
  const db = appDb();
  const starts = db.prepare("SELECT number, stufe, at, details FROM leiter_verlauf WHERE ereignis = 'gestartet'").all()
    .map((v) => ({ number: v.number, stufe: v.stufe, tag: v.at.slice(0, 10), at: v.at, vonHand: !!leseDetails(v.details)?.vonHand }));
  const abbrueche = db.prepare("SELECT number, at FROM leiter_verlauf WHERE ereignis IN ('abgebrochen', 'zurueckgesetzt')").all();
  const auswertungen = db.prepare("SELECT number, stufe, details FROM leiter_verlauf WHERE ereignis = 'ausgewertet'").all()
    .map((v) => ({ number: v.number, stufe: v.stufe, erholt: !!leseDetails(v.details)?.erholt }));
  const kontrolle = db.prepare("SELECT number, stufe_start FROM leiter WHERE (stufe = 'kontrolle' OR ergebnis = 'kontrolle') AND stufe_start IS NOT NULL").all()
    .map((z) => ({ number: z.number, start: z.stufe_start }));
  const { nummern, ab } = dashboard.benoetigt({ starts, kontrolle });
  const tage = new Map();
  if (ab && nummern.length) mitDb((pm) => {
    if (!tabelleDa(pm, "traffic_tag")) return;
    const zeilen = pm.prepare("SELECT number, datum, SUM(impressionen) imp, SUM(aufrufe) auf, SUM(transaktionen) trans FROM traffic_tag WHERE datum > ? AND number IN (SELECT value FROM json_each(?)) GROUP BY number, datum").all(ab, JSON.stringify(nummern));
    for (const z of zeilen) { if (!tage.has(z.number)) tage.set(z.number, new Map()); tage.get(z.number).set(z.datum, { imp: z.imp || 0, auf: z.auf || 0, trans: z.trans || 0 }); }
  });
  return dashboard.baueDashboard({ starts, abbrueche, auswertungen, kontrolle, tage, trafficBis: trafficBis(), einst: einst() });
}
let leiterLaeuft = false;
// One run: evaluate waiting times, take in new listings, suggest titles for step 1. Changes nothing on eBay.
// Movement "hand" (default since 20 Nov): the daily run only fetches AI titles; taking in only by the button "Draw listings by lot"
// (art "ziehen"), pushing on only by the button on the card (leiter.schiebeVonHand).
// ziehen: { anzahl, kontrolle } from the button (number without upper limit, control group yes/no per draw).
async function leiterLauf(wer, art = "tag", ziehen = {}) {
  if (leiterLaeuft) return null;
  leiterLaeuft = true;
  try {
    const produkte = produkteLaden(), daten = leiterDaten(produkte);
    const entfernt = leiter.raeumeVerkaufteAb(appDb(), produkte, daten.einst); // before drawing: already sold on eBay ones go down
    const automatisch = daten.einst.leiterBewegung === "automatisch";
    const bewerten = automatisch && art !== "ziehen", aufnehmen = automatisch || art === "ziehen";
    const ausgewertet = bewerten || aufnehmen ? leiter.werteAus(appDb(), { ...daten, nurKontrolle: !bewerten }) : [];
    const kontrolleVorher = leiter.anzahlKontrolle(appDb());
    const neu = aufnehmen ? leiter.nimmAuf(appDb(), produkte, daten.einst, new Date(), { imTest: experimente.imTest(appDb()), gesperrt: sperreHub(), ...(art === "ziehen" ? ziehen : {}) }) : [];
    if (bewerten) await werbungSpruenge(); // continue automatically to phase 2: already advertised ones jump straight to the price step
    let vorschlaege = 0, ohne = 0;
    for (const n of leiter.ohneTitelVorschlag(appDb())) { const r = await titelVorschlag(n, produkte, "system"); if (r.ok) vorschlaege++; else ohne++; }
    const details = { ausgewertet: ausgewertet.length, erholt: ausgewertet.filter((a) => a.erholt).length, aufgenommen: neu.length, verkaufteEntfernt: entfernt.length, kontrolle: leiter.anzahlKontrolle(appDb()) - kontrolleVorher, bewegung: automatisch ? "automatisch" : "hand", art, titelVorschlaege: vorschlaege, ohneVorschlag: ohne, ki: ki.konfiguriert() };
    protokoll.schreibe(appDb(), { benutzer: wer, rolle: wer === "system" ? null : "admin", aktion: "ladder_run", objekt: "ladder", details });
    return details;
  } catch (e) {
    try { protokoll.schreibe(appDb(), { benutzer: wer, rolle: wer === "system" ? null : "admin", aktion: "ladder_run", objekt: "ladder", details: { fehler: e.message }, ergebnis: "error" }); } catch { /* Protokoll nicht erreichbar */ }
    throw e;
  } finally { leiterLaeuft = false; }
}
const PM_TOKEN = process.env.PM_TOKEN || "";
// Which environment is this? prod | vorschau | lokal (empty = local). Shown at the top of the app so that nobody mistakes PREVIEW for PROD.
const UMGEBUNG = ["prod", "vorschau"].includes(String(process.env.PM_UMGEBUNG || "").toLowerCase()) ? String(process.env.PM_UMGEBUNG).toLowerCase() : "lokal";
const melder = benachrichtigung.erzeuge();
const APP_URL = /^https:\/\/[\w.-]+(:\d+)?\/?$/.test(process.env.APP_URL || "") ? process.env.APP_URL.replace(/\/$/, "") : "";
// Access from outside (server): Cloudflare Access puts a signed JWT in front of every request (Cf-Access-Jwt-Assertion).
// If CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD are set, the app accepts ONLY requests with a valid token —
// even if somebody creates the host name once without an Access rule. Locally (both empty) everything is open.
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

// Open the database fresh on every request: pm.db is replaced atomically at night, an open connection
// would otherwise stay on the old file.
function mitDb(fn) {
  const DB_PFAD = dbPfad();
  // The message goes to the interface: English and without a server path (that appears only in the console)
  if (!fs.existsSync(DB_PFAD)) {
    console.warn("pm.db fehlt unter " + DB_PFAD);
    throw Object.assign(new Error("The product data (pm.db) is not available yet. On the server it arrives with the nightly export; locally, the team copy daten-team/pm.db is used. Please try again later."), { status: 503 });
  }
  const db = new Database(DB_PFAD, { readonly: true, fileMustExist: true });
  try { return fn(db); } finally { db.close(); }
}


// ---- Automatic traffic import: once a day, finished days only (delay see traffic.mjs, verzoegerungTage) ----
// Runs only on the computer with the eBay credentials and only with EBAY_TRAFFIC_AUTO=an. The import is the export (export-ebay.mjs):
// it rebuilds daten/pm.db and replaces the file only at the end; on an error the old one stays unchanged.
const TRAFFIC_AUTO = String(process.env.EBAY_TRAFFIC_AUTO || "").trim().toLowerCase() === "an";
const TRAFFIC_UHR = Math.min(23, Math.max(0, Number(process.env.TRAFFIC_UHRZEIT) || 5)); // at the earliest at this time of day (local time)
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
  if (ok && jetzt - Date.parse(ok) < 20 * STUNDE) return;      // already successful today
  if (fehler && jetzt - Date.parse(fehler) < 2 * STUNDE && (!ok || Date.parse(fehler) > Date.parse(ok))) return; // after an error only again in 2 hours
  starteTrafficImport("system");
}

// Rolled-out version (written by the watcher, see waechter.mjs); empty locally without a watcher
const versionKurz = () => { try { return JSON.parse(fs.readFileSync(path.join(WURZEL, "daten", "waechter-status.json"), "utf8")).commit?.slice(0, 7) || null; } catch { return null; } };
// Version for scripts and styles: the rolled-out commit, without a watcher (local) the start time of the server
const VERSION_ASSETS = versionKurz() || Date.now().toString(36);

// ---- Daily backup of app.db and traffic-tage.db (see sicherung.mjs) ----
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
// How old is the traffic data compared with the target? Target: today minus the delay of the data source (LA time):
// 1 day for the hub export, the import's own delay otherwise (traffic.mjs, verzoegerungFuer). 2 days or more behind = outdated.
function datenStand() {
  let bis = null, quelle = null;
  try { const s = mitDb((db) => db.prepare("SELECT * FROM stand").get()); bis = s?.traffic_bis ?? null; quelle = s?.quelle ?? null; } catch { /* keine pm.db */ }
  const verzoegerung = verzoegerungFuer(quelle), hub = /hub/i.test(String(quelle ?? ""));
  if (!bis || !/^\d{4}-\d{2}-\d{2}$/.test(bis)) return { trafficBis: null, rueckstandTage: null, veraltet: false, verzoegerung, hub };
  const soll = laDatum(new Date(), verzoegerung);
  const rueckstand = Math.round((Date.parse(soll) - Date.parse(bis)) / 864e5);
  return { trafficBis: bis, soll, rueckstandTage: rueckstand, veraltet: rueckstand >= 2, verzoegerung, hub };
}
// The app's fixed numbers, each from exactly one constant: the interface shows them from here instead of keeping its own copies
const regelZahlen = () => ({ titelMaxZeichen: TITEL_MAX_ZEICHEN, maxAenderungen: freigabe.MAX_AENDERUNGEN, zielmarke: einst().besserAb, maxFehlversuche: login.MAX_FEHLVERSUCHE, sperreMinuten: login.SPERRE_MINUTEN, verzoegerungTage: verzoegerungTage(), nachpruefenTage: NACHPRUEFEN_TAGE });
function betriebStatus() {
  return { umgebung: UMGEBUNG, version: versionKurz(), schreibenAn: schreiber.schreibenAn(), zugangsdaten: schreiber.konfiguriert(), benachrichtigung: melder.konfiguriert(), sicherung: sicherungStatus(), traffic: trafficStatus(), daten: datenStand(), regeln: regelZahlen(), leiter: leiterStatus() };
}

// ---- Daily run of the ladder (from LEITER_UHRZEIT, default 6 a.m., after the traffic import). LEITER_AUTO=aus switches it off. ----
// The run changes nothing on eBay: it evaluates, takes in and suggests titles. Changes happen only after an approval.
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
  // Catching up: if the last run ran without an AI key and it is there now, run again at once instead of waiting a day
  // (20 Nov: key entered at noon, all 20 cards showed "no AI key" until the next morning).
  const ohneKiGelaufen = (() => { try { return JSON.parse(l?.details || "{}").ki === false; } catch { return false; } })();
  if (l && Date.now() - Date.parse(l.zeit) < (l.ergebnis === "error" ? 2 : 20) * STUNDE && !(ohneKiGelaufen && ki.konfiguriert())) return;
  leiterLauf("system").catch((e) => { console.log("Leiter-Lauf fehlgeschlagen: " + e.message); melder.fehler("Leiter-Lauf", e.message); });
}

const ROUTEN = {
  "/api/stand": () => mitDb((db) => db.prepare("SELECT * FROM stand").get()),
  // Approvals (suggestions for title changes on eBay), log and roles
  "/api/freigaben": () => ({ schreibenAn: schreiber.schreibenAn(), zugangsdaten: schreiber.konfiguriert(), maxAenderungen: freigabe.MAX_AENDERUNGEN, offen: freigabe.zaehleOffen(appDb()), aenderungen: freigabe.liste(appDb()) }),
  "/api/protokoll": () => protokoll.liste(appDb(), 300),
  "/api/traffic/status": () => trafficStatus(),
  "/api/betrieb": () => betriebStatus(),
  "/api/demo": () => baueDemo(einst()),
  // Hints for new titles from the own data (no invented titles, see titelhilfe.mjs)
  "/api/titelhilfe": (q) => titelhilfe.hinweiseFuer(produkteLaden(), String(q.get("nr") || "").slice(0, 40)),
  "/api/rollen": (q, ctx) => { adminNoetig(ctx); return { benutzer: rollen.liste(appDb()), admins: rollen.anzahlAdmins(appDb()) }; },
  // All listings with area, recommendation and reason (see regeln.mjs), plus whether they are in a test.
  "/api/bewertung": () => baueBewertung(produkteLaden(), einst(), new Date(), experimente.imTest(appDb())),
  // Settings: form description, current values, default values and the limit calculated from the data.
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
  // Ladder: every step with its listings, interim states and histories, plus switches and the last run
  "/api/leiter": () => {
    const produkte = produkteLaden(), daten = leiterDaten(produkte);
    const optionen = { imTest: experimente.imTest(appDb()), gesperrt: sperreHub() };
    const k = leiter.kandidaten(appDb(), produkte, daten.einst, new Date(), optionen);
    if (Date.now() - werbungStand.at > 6 * 3600e3) aktualisiereWerbung().catch(() => {}); // at most every 6 h, in the background
    const beworben = (nr) => werbungStand.nummern[nr] || null;
    const ue = leiter.uebersicht(appDb(), produkte, daten), tr = leiter.trichter(appDb(), produkte, daten.einst, new Date(), optionen);
    for (const a of ue.angebote) a.beworben = beworben(a.number);
    for (const x of tr.liste) x.beworben = beworben(x.number);
    // eBay listing number per product for the link "Open on eBay"
    const ebayNr = Object.fromEntries(mitDb((db) => db.prepare("SELECT number, external_id FROM kanal WHERE channel = 'ebay' AND listed = 1 AND external_id IS NOT NULL").all()).map((r) => [r.number, r.external_id]));
    for (const a of ue.angebote) a.ebay_id = ebayNr[a.number] || null;
    return { ...ue, kandidaten: k.length, status: leiterStatus(),
      kandidatenListe: k.map((p) => ({ number: p.number, title: p.title ?? null, impressionen_90d: p.impressionen_90d ?? null, units_90d: p.units_90d ?? null, beworben: beworben(p.number) })),
      // live interim of every running phase against the control group (the funnel tree shows it at the phase)
      zwischen: Object.fromEntries(["titel", "werbung", "preis"].map((s) => [s, zwischenstand(ue.angebote.filter((a) => a.phase === "laeuft" && a.stufe === s))])),
      trichter: tr, werbung: { stand: werbungStand.at ? new Date(werbungStand.at).toISOString() : null, anzahl: Object.keys(werbungStand.nummern).length, fehler: werbungStand.fehler },
      schreiben: { titel: schreiber.konfiguriert() && schreiber.schreibenAn(), werbung: schreiber.konfiguriert() && schreiber.schreibenAn() && schreiber.werbungAn(), preis: schreiber.konfiguriert() && schreiber.schreibenAn() && schreiber.preisAn() } };
  },
  // Everything that has happened to a product: state on the ladder, history and the log entries (for the page Products)
  "/api/produkt/verlauf": (q) => {
    const nr = String(q.get("nr") ?? "").slice(0, 40), db = appDb();
    const zeile = db.prepare("SELECT stufe, phase, ergebnis, eingestiegen_at, stufe_start FROM leiter WHERE number = ?").get(nr) || null;
    const verlauf = db.prepare("SELECT stufe, ereignis, details, benutzer, at FROM leiter_verlauf WHERE number = ? ORDER BY id").all(nr).map((v) => ({ ...v, details: v.details ? JSON.parse(v.details) : null }));
    const eintraege = db.prepare("SELECT zeit, benutzer, aktion, details, ergebnis FROM protokoll WHERE objekt = ? ORDER BY id DESC LIMIT 50").all("product " + nr);
    return { number: nr, leiter: zeile, verlauf, protokoll: eintraege };
  },
  // Page Problem: how unevenly visibility and sales are spread (problem.mjs), live from the same product list
  "/api/problem": () => { const produkte = produkteLaden(), e = einst(); return { ...problem.auswerten(produkte, leiteSchwellenAb(produkte, e, new Date()).wenigImpressionen90d), werbesatz: e.werbesatz, preisSchritt: e.preisSchritt }; },
  // Page Results, section "Day by day": effect of each phase against the control group, with a daily curve (dashboard.mjs)
  "/api/dashboard": () => dashboardDaten(),
  // Page Results: effect of each phase of the ladder on the impressions, per run and in total (ergebnisse.mjs); the example has invented figures
  "/api/ergebnisse": () => {
    const produkte = produkteLaden(), daten = leiterDaten(produkte);
    return baueErgebnisse(leiter.uebersicht(appDb(), produkte, daten), { besserAb: daten.einst.besserAb });
  },
  "/api/ergebnisse/beispiel": () => baueDemoErgebnisse(einst()),
  "/api/kanaele": () => mitDb((db) => db.prepare("SELECT channel, COUNT(*) produkte, SUM(listed) gelistet, SUM(units_90d) stueck_90d FROM kanal WHERE channel = 'ebay' GROUP BY channel ORDER BY produkte DESC").all()),
  // Live state from the hub (only on the server, locally HUB_URL is missing): the same whitelist, but the state of now instead of 04:30.
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
    // Protection against foreign websites: an Origin header must match the own host.
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

// Every function checks its input itself (types, limits, state) and returns { ok, wert } or { ok: false, status, fehler }.
const antwort = (r) => { if (!r.ok) throw Object.assign(new Error(r.fehler), { status: r.status || 400 }); return r.wert; };
const POST_ROUTEN = {
  "/api/einstellungen": async (req, ctx) => { adminNoetig(ctx); return antwort(einstellungen.speichere(appDb(), (await leseJson(req))?.werte)); },
  "/api/einstellungen/zuruecksetzen": async (req, ctx) => { adminNoetig(ctx); await leseJson(req); return antwort(einstellungen.zuruecksetzen(appDb())); },
  "/api/experiment": async (req, ctx) => {
    const r = antwort(experimente.legeAn(appDb(), await leseJson(req), produkteLaden(), einst(), new Date(), undefined, sperreLaden()));
    // The seed is in the log: with it the draw can be recalculated later with the same candidates
    protokoll.schreibe(appDb(), { benutzer: ctx.name, rolle: ctx.rolle, aktion: "test_created", objekt: "test " + r.id, details: { seed: r.seed, test: r.test, kontrolle: r.kontrolle, gesperrt: r.gesperrt } });
    return r;
  },
  "/api/experiment/titel": async (req) => antwort(experimente.setzeTitel(appDb(), await leseJson(req))),
  // Builder and admin: send a suggestion for approval. Only an admin lets the titles be changed on eBay.
  "/api/experiment/freigabe": async (req, ctx) => {
    const b = await leseJson(req);
    const r = antwort(freigabe.reicheEin(appDb(), ctx, b, kanaeleFuer));
    const name = appDb().prepare("SELECT name FROM experiment WHERE id = ?").get(r.id)?.name || "test " + r.id;
    melder.vorschlag(ctx.name, r.aenderungen, name, APP_URL ? APP_URL + "/#approvals" : "");   // ohne await: eine Meldung darf die Antwort nie aufhalten
    return r;
  },
  // Start directly, without the app changing anything on eBay (the admin changed the titles himself).
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
  // ---- Ladder ----
  "/api/leiter/lauf": async (req, ctx) => { adminNoetig(ctx); await leseJson(req); const r = await leiterLauf(ctx.name); if (!r) throw Object.assign(new Error("The ladder is already running."), { status: 409 }); return r; },
  "/api/leiter/freigabe": async (req, ctx) => {
    adminNoetig(ctx);
    const nr = String((await leseJson(req))?.number ?? "").slice(0, 40);
    return freigeben(ctx, nr);
  },
  // Approve several titles at once (ticks in the work list): every listing on its own, with the same checks
  "/api/leiter/freigabe-mehrere": async (req, ctx) => {
    adminNoetig(ctx);
    const b = await leseJson(req);
    const nummern = Array.isArray(b?.numbers) ? [...new Set(b.numbers.map((n) => String(n).slice(0, 40)))].slice(0, 100) : [];
    if (!nummern.length) throw Object.assign(new Error("Please tick at least one listing."), { status: 400 });
    const ergebnisse = [];
    for (const nr of nummern) { try { ergebnisse.push({ number: nr, ok: true, ...(await freigeben(ctx, nr)) }); } catch (e) { ergebnisse.push({ number: nr, ok: false, text: e.message }); } }
    return { ergebnisse, angewendet: ergebnisse.filter((e) => e.ausgang === "angewendet").length, probelauf: ergebnisse.filter((e) => e.ausgang === "probelauf").length, fehler: ergebnisse.filter((e) => !e.ok || e.ausgang === "fehlgeschlagen").length };
  },
  // "Start over": everything without an eBay change goes back to Eligible
  "/api/leiter/neustart": async (req, ctx) => { adminNoetig(ctx); const b = await leseJson(req); return antwort(leiter.setzeZurueck(appDb(), ctx, b?.grund)); },
  // An admin puts a listing from the selection list onto the ladder; the AI title suggestion is fetched along at once (changes nothing on eBay)
  "/api/leiter/aufnehmen": async (req, ctx) => {
    adminNoetig(ctx);
    const nr = String((await leseJson(req))?.number ?? "").slice(0, 40), produkte = produkteLaden();
    const r = leiter.nimmVonHandAuf(appDb(), ctx, nr, produkte, einst(), new Date(), { imTest: experimente.imTest(appDb()), gesperrt: sperreHub() });
    if (!r.ok) return antwort(r);
    const v = await titelVorschlag(nr, produkte, ctx.name);
    return { number: nr, vorschlag: v.ok, hinweis: v.ok ? null : v.fehler };
  },
  // Movement by button: take in new listings by lot (with a control group) and push a listing on or end it as seen again
  "/api/leiter/ziehen": async (req, ctx) => {
    adminNoetig(ctx);
    const b = await leseJson(req);
    const anzahl = Number(b?.anzahl);
    if (!Number.isInteger(anzahl) || anzahl < 1 || anzahl > 1000) throw Object.assign(new Error("Please choose how many listings to draw (a whole number from 1)."), { status: 400 });
    if (typeof b?.kontrolle !== "boolean") throw Object.assign(new Error("Please choose whether to draw a control group."), { status: 400 });
    const r = await leiterLauf(ctx.name, "ziehen", { anzahl, kontrolle: b.kontrolle });
    if (!r) throw Object.assign(new Error("The ladder is already running."), { status: 409 });
    return r;
  },
  "/api/leiter/schieben": async (req, ctx) => {
    adminNoetig(ctx);
    const b = await leseJson(req), nr = String(b?.number ?? "").slice(0, 40);
    const r = antwort(leiter.schiebeVonHand(appDb(), ctx, nr, b?.ziel, leiterDaten(produkteLaden()), undefined, { vorzeitigBestaetigt: b?.vorzeitig === true }));
    const sprung = r.stufe === "werbung" ? await werbungSpruenge([nr]) : [];
    return { ...r, stufe: sprung.length ? "preis" : r.stufe, werbungUebersprungen: sprung[0]?.kampagnen || null };
  },
  "/api/leiter/vonhand": async (req, ctx) => { adminNoetig(ctx); const b = await leseJson(req); return antwort(leiter.starteVonHand(appDb(), ctx, String(b?.number ?? "").slice(0, 40), { impTag })); },
  "/api/leiter/ueberspringen": async (req, ctx) => {
    adminNoetig(ctx);
    const b = await leseJson(req), nr = String(b?.number ?? "").slice(0, 40);
    const r = antwort(leiter.ueberspringe(appDb(), ctx, nr, b?.grund, einst(), { fuer: leiterKontext }));
    const sprung = r.stufe === "werbung" ? await werbungSpruenge([nr]) : [];
    return { ...r, stufe: sprung.length ? "preis" : r.stufe, werbungUebersprungen: sprung[0]?.kampagnen || null };
  },
  "/api/leiter/entscheidung": async (req, ctx) => { adminNoetig(ctx); const b = await leseJson(req); return antwort(leiter.entscheide(appDb(), ctx, String(b?.number ?? "").slice(0, 40), b?.entscheidung, b?.notiz)); },
  "/api/leiter/abbrechen": async (req, ctx) => { adminNoetig(ctx); const b = await leseJson(req); return antwort(leiter.brichAb(appDb(), ctx, String(b?.number ?? "").slice(0, 40), b?.grund)); },
  // Builder and admin: enter a title by hand (it must pass the rule checker) or ask the AI again
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
  // Protective headers for every response: no embedding in foreign pages, no guessing of the file type, scripts only from the app itself.
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Content-Security-Policy", "default-src 'self'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'");
  try {
    if (url.pathname === "/healthz") return json(200, { ok: true, version: versionKurz() });
    if (!(await accessOk(req))) return json(401, { ok: false, error: "No valid access (Cloudflare Access)." });
    // ---- Login: without a login only the login page, its files and /api/login are reachable ----
    const sicher = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim() === "https";
    const token = login.tokenAusCookie(req.headers.cookie);
    const benutzer = login.sitzungFuer(appDb(), token);
    // Address for the lock on failed attempts: behind Cloudflare (Access is then mandatory) the real address from the Cloudflare header, otherwise the connection
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
    // The same address may read (GET) and write (POST): the method decides
    if (req.method === "POST" && Object.hasOwn(POST_ROUTEN, url.pathname)) return json(200, { ok: true, daten: await POST_ROUTEN[url.pathname](req, ctx) });
    const route = Object.hasOwn(ROUTEN, url.pathname) ? ROUTEN[url.pathname] : null;
    if (route && (req.method === "GET" || req.method === "HEAD")) return json(200, { ok: true, daten: await route(url.searchParams, ctx) });
    if (route) return json(405, { ok: false, error: "GET only." });
    if (Object.hasOwn(POST_ROUTEN, url.pathname)) return json(405, { ok: false, error: "POST only." });
    // static files from public/
    const rel = url.pathname === "/" ? "/index.html" : url.pathname;
    const datei = path.join(WURZEL, "public", path.normalize(rel).replace(/^(\.\.[/\\])+/, ""));
    if (datei.startsWith(path.join(WURZEL, "public")) && fs.existsSync(datei) && fs.statSync(datei).isFile()) {
      // no-cache: the browser (and Cloudflare) asks on every load whether there is a new version. Without this setting
      // Cloudflare delivered the old app.js for up to 2 hours after a rollout (20 Nov: old card "no AI key" despite the new version).
      res.writeHead(200, { "Content-Type": MIME[path.extname(datei)] || "application/octet-stream", "Cache-Control": "no-cache" });
      // HTML pages: the version number of the scripts and styles (?v=…) is the rolled-out version. With a fixed value
      // a browser received, after the rollout of #43, the new page with the menu item Problem but the old app.js without the page.
      if (path.extname(datei) === ".html") return res.end(fs.readFileSync(datei, "utf8").replace(/(\/[\w.-]+\.(?:js|css))\?v=[\w.-]+/g, `$1?v=${VERSION_ASSETS}`));
      return fs.createReadStream(datei).pipe(res);
    }
    json(404, { ok: false, error: "Not found." });
  } catch (e) { json(e.status || 500, { ok: false, error: e.message }); }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Parture Groupwork running: http://127.0.0.1:${PORT}  (DB: ${dbPfad()})`);
  if (SICH_AUTO) { setTimeout(pruefeSicherung, 45e3).unref(); setInterval(pruefeSicherung, 15 * 60e3).unref(); }
  if (LEITER_AUTO) { setTimeout(pruefeLeiter, 60e3).unref(); setInterval(pruefeLeiter, 15 * 60e3).unref(); }
  // List of the advertised eBay listings (phase 2 only for non-advertised ones): at start and every 6 hours
  // After every rollout once: listings already sold on eBay without an eBay change come off the ladder (leiter.raeumeVerkaufteAb)
  setTimeout(() => { try { const p = produkteLaden(); leiter.raeumeVerkaufteAb(appDb(), p, leiterDaten(p).einst); } catch (e) { console.error("Ladder clean-up:", e.message); } }, 20e3).unref();
  if (schreiber.konfiguriert()) { setTimeout(() => aktualisiereWerbung().catch(() => {}), 30e3).unref(); setInterval(() => aktualisiereWerbung().catch(() => {}), 6 * 3600e3).unref(); }
  if (TRAFFIC_AUTO) { console.log(`Automatic traffic import: daily from ${TRAFFIC_UHR}:00 (delay ${verzoegerungTage()} days).`); setTimeout(pruefeTrafficImport, 30e3).unref(); setInterval(pruefeTrafficImport, 15 * 60e3).unref(); }
});
