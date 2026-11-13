// Parture Groupwork — Produktmanagement-App (Startpunkt).
// Liest ausschließlich pm.db (Whitelist-Kopie: Katalog, Kanäle, Mengen, Preise, Bilder). Keine Kosten, keine Kunden.
// Konfiguration über .env (siehe .env.beispiel). Ohne Abhängigkeiten außer better-sqlite3.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { ladeProdukte, baueBewertung } from "./bewertung.mjs";
import { leiteSchwellenAb } from "./regeln.mjs";
import * as einstellungen from "./einstellungen.mjs";
import * as experimente from "./experimente.mjs";

const WURZEL = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
ladeEnv(path.join(WURZEL, ".env"));
const PORT = Number(process.env.PM_PORT || 5060);
// Reihenfolge: PM_DB aus der .env, sonst daten/pm.db (Server-Nachtlauf / eigener Export), sonst die Team-Kopie aus dem Repo.
const DB_PFAD = path.resolve(WURZEL, process.env.PM_DB || (fs.existsSync(path.join(WURZEL, "daten/pm.db")) ? "daten/pm.db" : "daten-team/pm.db"));
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
  return (_appDb = d);
}
const einst = () => einstellungen.effektiv(appDb());
const produkteLaden = () => mitDb((db) => ladeProdukte(db));
const HUB_URL = process.env.HUB_URL || "";
const PM_TOKEN = process.env.PM_TOKEN || "";
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
  if (!fs.existsSync(DB_PFAD)) throw Object.assign(new Error("pm.db fehlt unter " + DB_PFAD + " — auf dem Server kommt sie nachts, lokal: Kopie aus dem Team holen"), { status: 503 });
  const db = new Database(DB_PFAD, { readonly: true, fileMustExist: true });
  try { return fn(db); } finally { db.close(); }
}

const ROUTEN = {
  "/api/stand": () => mitDb((db) => db.prepare("SELECT * FROM stand").get()),
  // Alle Angebote mit Bereich, Empfehlung und Begründung (siehe regeln.mjs), dazu ob sie in einem Test stecken.
  "/api/bewertung": () => baueBewertung(produkteLaden(), einst(), new Date(), experimente.imTest(appDb())),
  // Einstellungen: Formularbeschreibung, aktuelle Werte, Startwerte und die aus den Daten berechnete Grenze.
  "/api/einstellungen": () => {
    const e = einst();
    return { abschnitte: einstellungen.ABSCHNITTE, schema: einstellungen.SCHEMA, werte: Object.fromEntries(einstellungen.SCHEMA.map((f) => [f.key, e[f.key]])), standard: einstellungen.STANDARD,
      abgeleitet: { wenigImpressionen90d: leiteSchwellenAb(produkteLaden(), e, new Date()).wenigImpressionen90d } };
  },
  // Tests
  "/api/experimente": () => ({ tests: experimente.liste(appDb(), produkteLaden(), new Date(), einst()), moeglich: experimente.kandidaten(appDb(), produkteLaden(), einst(), new Date()).length, testGroesse: einst().testGroesse }),
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
    if (!p) throw Object.assign(new Error("Produkt " + nr + " nicht gefunden"), { status: 404 });
    p.kanaele = db.prepare("SELECT channel, listed, external_id, preis_aktuell, kanal_status, units_total, units_90d, last_sold_at FROM kanal WHERE number = ?").all(nr);
    p.bilder = db.prepare("SELECT url, position, kind FROM bild WHERE number = ? ORDER BY position").all(nr);
    return p;
  }),
  "/api/kanaele": () => mitDb((db) => db.prepare("SELECT channel, COUNT(*) produkte, SUM(listed) gelistet, SUM(units_90d) stueck_90d FROM kanal GROUP BY channel ORDER BY produkte DESC").all()),
  // Live-Stand vom Hub (nur auf dem Server, lokal fehlt HUB_URL): dieselbe Whitelist, aber Stand jetzt statt 04:30.
  "/api/live": async () => {
    if (!HUB_URL || !PM_TOKEN) throw Object.assign(new Error("Live-Anbindung nur auf dem Server (HUB_URL/PM_TOKEN)"), { status: 503 });
    const r = await fetch(HUB_URL + "/api/pm/katalog", { headers: { "x-pm-token": PM_TOKEN } });
    if (!r.ok) throw Object.assign(new Error("Hub antwortet " + r.status), { status: 502 });
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
  "/api/experiment": async (req) => antwort(experimente.legeAn(appDb(), await leseJson(req), produkteLaden(), einst())),
  "/api/experiment/titel": async (req) => antwort(experimente.setzeTitel(appDb(), await leseJson(req), einst())),
  "/api/experiment/start": async (req) => antwort(experimente.starte(appDb(), await leseJson(req), produkteLaden())),
  "/api/experiment/abschluss": async (req) => antwort(experimente.schliesse(appDb(), await leseJson(req))),
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const json = (code, body) => { res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }); res.end(JSON.stringify(body)); };
  try {
    if (url.pathname === "/healthz") return json(200, { ok: true });
    if (!(await accessOk(req))) return json(401, { ok: false, error: "kein gültiger Zugang (Cloudflare Access)" });
    // Dieselbe Adresse darf lesen (GET) und schreiben (POST): die Methode entscheidet
    if (req.method === "POST" && Object.hasOwn(POST_ROUTEN, url.pathname)) return json(200, { ok: true, daten: await POST_ROUTEN[url.pathname](req) });
    const route = Object.hasOwn(ROUTEN, url.pathname) ? ROUTEN[url.pathname] : null;
    if (route && (req.method === "GET" || req.method === "HEAD")) return json(200, { ok: true, daten: await route(url.searchParams) });
    if (route) return json(405, { ok: false, error: "GET only." });
    if (Object.hasOwn(POST_ROUTEN, url.pathname)) return json(405, { ok: false, error: "POST only." });
    // statische Dateien aus public/
    const rel = url.pathname === "/" ? "/index.html" : url.pathname;
    const datei = path.join(WURZEL, "public", path.normalize(rel).replace(/^(\.\.[/\\])+/, ""));
    if (datei.startsWith(path.join(WURZEL, "public")) && fs.existsSync(datei) && fs.statSync(datei).isFile()) {
      res.writeHead(200, { "Content-Type": MIME[path.extname(datei)] || "application/octet-stream" });
      return fs.createReadStream(datei).pipe(res);
    }
    json(404, { ok: false, error: "nicht gefunden" });
  } catch (e) { json(e.status || 500, { ok: false, error: e.message }); }
});

server.listen(PORT, "127.0.0.1", () => console.log(`Parture Groupwork läuft: http://127.0.0.1:${PORT}  (DB: ${DB_PFAD})`));
