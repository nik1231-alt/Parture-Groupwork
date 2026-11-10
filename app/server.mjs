// Parture Groupwork — Produktmanagement-App (Startpunkt).
// Liest ausschließlich pm.db (Whitelist-Kopie: Katalog, Kanäle, Mengen, Preise, Bilder). Keine Kosten, keine Kunden.
// Konfiguration über .env (siehe .env.beispiel). Ohne Abhängigkeiten außer better-sqlite3.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const WURZEL = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
ladeEnv(path.join(WURZEL, ".env"));
const PORT = Number(process.env.PM_PORT || 5060);
const DB_PFAD = path.resolve(WURZEL, process.env.PM_DB || "daten/pm.db");
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
  "/api/produkte": (q) => mitDb((db) => {
    const suche = q.get("q") ? "%" + q.get("q").toLowerCase() + "%" : null;
    const sql = "SELECT number, title, image_url, status, grams, print_s, ship_method, units_total, units_90d, avg_price, last_sold_at FROM produkt"
      + (suche ? " WHERE lower(title) LIKE ? OR number LIKE ?" : "") + " ORDER BY units_90d DESC, units_total DESC LIMIT 500";
    return suche ? db.prepare(sql).all(suche, suche) : db.prepare(sql).all();
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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const json = (code, body) => { res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }); res.end(JSON.stringify(body)); };
  try {
    if (url.pathname === "/healthz") return json(200, { ok: true });
    if (!(await accessOk(req))) return json(401, { ok: false, error: "kein gültiger Zugang (Cloudflare Access)" });
    const route = ROUTEN[url.pathname];
    if (route) return json(200, { ok: true, daten: await route(url.searchParams) });
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
