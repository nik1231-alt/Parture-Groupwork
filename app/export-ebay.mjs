// Baut daten/pm.db selbst aus der eBay-API (Konto partureshop). Nur Lesezugriffe.
// Aufruf: npm run export   (braucht EBAY_APP_ID, EBAY_CERT_ID, EBAY_REFRESH_TOKEN in der .env)
//
// Whitelist wie in der README: Katalog, Kanal, Menge, Preis, Bilder. NICHT übernommen werden
// Käufer, Adressen, Gebühren, Kosten, Umsatz in Euro. Bestellungen werden nur zu Stückzahl,
// Durchschnittspreis und letztem Verkaufsdatum pro Artikel zusammengezählt, einzelne Bestellungen werden nicht gespeichert.
//
// Aus eBay nicht ableitbar (bleiben leer): grams, print_s, ship_method, variant_meta.
// Nur der Kanal "ebay" wird befüllt (Amazon, Etsy, Shop, TikTok brauchen eigene Quellen).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const WURZEL = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
ladeEnv(path.join(WURZEL, ".env"));
const { EBAY_APP_ID, EBAY_CERT_ID, EBAY_REFRESH_TOKEN } = process.env;
const DB_PFAD = path.resolve(WURZEL, process.env.PM_DB || "daten/pm.db");
const SITE_DE = "77";
const TAGE_HISTORIE = 360; // so weit zurück werden Bestellungen gelesen (für last_sold_at)

function ladeEnv(p) {
  if (!fs.existsSync(p)) return;
  for (const z of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = z.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

async function accessToken() {
  if (!EBAY_APP_ID || !EBAY_CERT_ID || !EBAY_REFRESH_TOKEN) throw new Error("EBAY_APP_ID, EBAY_CERT_ID und EBAY_REFRESH_TOKEN fehlen in der .env");
  const r = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: "Basic " + Buffer.from(`${EBAY_APP_ID}:${EBAY_CERT_ID}`).toString("base64") },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: EBAY_REFRESH_TOKEN }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error("eBay-Token nicht erhalten: " + (j.error_description || j.error || r.status));
  return j.access_token;
}

// ---- kleine XML-Helfer (die Trading-API liefert XML) -------------------------------------------
const tag = (x, t) => { const m = x.match(new RegExp(`<${t}(?:\\s[^>]*)?>([\\s\\S]*?)</${t}>`)); return m ? m[1].trim() : null; };
const alle = (x, t) => [...x.matchAll(new RegExp(`<${t}(?:\\s[^>]*)?>([\\s\\S]*?)</${t}>`, "g"))].map((m) => m[1]);
const entities = (s) => (s == null ? s : s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&"));

async function aktiveListings(token) {
  const items = [];
  for (let seite = 1; ; seite++) {
    const body = `<?xml version="1.0" encoding="utf-8"?><GetMyeBaySellingRequest xmlns="urn:ebay:apis:eBLBaseComponents"><ActiveList><Include>true</Include><Pagination><EntriesPerPage>200</EntriesPerPage><PageNumber>${seite}</PageNumber></Pagination></ActiveList></GetMyeBaySellingRequest>`;
    const r = await fetch("https://api.ebay.com/ws/api.dll", {
      method: "POST",
      headers: { "X-EBAY-API-COMPATIBILITY-LEVEL": "1193", "X-EBAY-API-CALL-NAME": "GetMyeBaySelling", "X-EBAY-API-SITEID": SITE_DE, "X-EBAY-API-IAF-TOKEN": token },
      body,
    });
    const x = await r.text();
    if (tag(x, "Ack") === "Failure") throw new Error("GetMyeBaySelling: " + entities(tag(x, "ShortMessage")));
    const liste = tag(x, "ActiveList") || "";
    for (const it of alle(liste, "Item")) {
      const varStueck = tag(it, "Variations");
      const ohneVar = varStueck ? it.replace(varStueck, "") : it;
      const varianten = varStueck ? alle(varStueck, "Variation").map((v) => ({ sku: entities(tag(v, "SKU")), verkauft: Number(tag(tag(v, "SellingStatus") || "", "QuantitySold") || 0) })) : [];
      const preis = tag(tag(ohneVar, "SellingStatus") || "", "CurrentPrice") ?? tag(ohneVar, "BuyItNowPrice");
      items.push({
        itemId: tag(ohneVar, "ItemID"),
        title: entities(tag(ohneVar, "Title")),
        sku: entities(tag(ohneVar, "SKU")),
        verkauft: Number(tag(tag(ohneVar, "SellingStatus") || "", "QuantitySold") || 0),
        preis: preis == null ? null : Number(preis),
        start: tag(tag(ohneVar, "ListingDetails") || "", "StartTime"),
        bild: entities(tag(tag(ohneVar, "PictureDetails") || "", "GalleryURL")),
        varianten,
      });
    }
    const gesamtSeiten = Number(tag(tag(liste, "PaginationResult") || "", "TotalNumberOfPages") || 1);
    if (seite >= gesamtSeiten) break;
  }
  return items;
}

// Bestellungen nur zu Zählern je Artikel verdichten (keine Käuferdaten, keine einzelnen Bestellungen speichern).
async function verkaeufe(token) {
  const je = new Map(); // itemId -> { stk, stk90, summe, letzte }
  const grenze90 = Date.now() - 90 * 864e5;
  const fenster = 90 * 864e5;
  for (let ende = Date.now(); ende > Date.now() - TAGE_HISTORIE * 864e5; ende -= fenster) {
    const von = new Date(ende - fenster).toISOString(), bis = new Date(ende).toISOString();
    for (let offset = 0; ; offset += 200) {
      const url = `https://api.ebay.com/sell/fulfillment/v1/order?filter=${encodeURIComponent(`creationdate:[${von}..${bis}]`)}&limit=200&offset=${offset}`;
      const r = await fetch(url, { headers: { Authorization: "Bearer " + token } });
      if (!r.ok) { console.warn(`  Bestellungen ${von.slice(0, 10)}..${bis.slice(0, 10)}: HTTP ${r.status} (übersprungen)`); break; }
      const j = await r.json();
      for (const o of j.orders || []) {
        const t = Date.parse(o.creationDate);
        for (const li of o.lineItems || []) {
          const id = String(li.legacyItemId);
          const e = je.get(id) || { stk: 0, stk90: 0, summe: 0, letzte: 0 };
          const q = Number(li.quantity || 1);
          e.stk += q; e.summe += Number(li.lineItemCost?.value || 0);
          if (t >= grenze90) e.stk90 += q;
          if (t > e.letzte) e.letzte = t;
          je.set(id, e);
        }
      }
      if (offset + 200 >= (j.total || 0)) break;
    }
  }
  return je;
}

// Artikelnummer = führende Ziffern der SKU ("234 -  -" -> 234, "1254_Gr" -> 1254). Variantenlistings: erste Varianten-SKU.
function artikelnummer(it) {
  for (const s of [it.sku, ...it.varianten.map((v) => v.sku)]) { const m = s && s.match(/^\s*(\d{1,6})/); if (m) return m[1]; }
  return null;
}

function schreibe(items, vk) {
  const produkte = new Map();
  for (const it of items) {
    const nr = artikelnummer(it) ?? "ID" + it.itemId;
    const p = produkte.get(nr) || { number: nr, titel: it.title, bild: it.bild, start: it.start, stk: 0, stk90: 0, summe: 0, stkPreis: 0, letzte: 0, preise: [], varianten: [], kanaele: [] };
    const v = vk.get(it.itemId) || { stk: 0, stk90: 0, summe: 0, letzte: 0 };
    p.stk += Math.max(it.verkauft, 0); p.stk90 += v.stk90; p.summe += v.summe; p.stkPreis += v.stk; p.letzte = Math.max(p.letzte, v.letzte);
    if (it.preis != null) p.preise.push(it.preis);
    if (it.start && (!p.start || it.start < p.start)) p.start = it.start;
    p.varianten.push(...it.varianten.map((x) => x.sku).filter(Boolean));
    p.kanaele.push({ it, v });
    if (it.verkauft > (p.besterVerkauf ?? -1)) { p.besterVerkauf = it.verkauft; p.titel = it.title; p.bild = it.bild || p.bild; }
    produkte.set(nr, p);
  }

  fs.mkdirSync(path.dirname(DB_PFAD), { recursive: true });
  const neu = DB_PFAD + ".neu";
  for (const f of [neu, neu + "-journal"]) if (fs.existsSync(f)) fs.rmSync(f);
  const db = new Database(neu);
  db.exec(`
    CREATE TABLE produkt (number TEXT PRIMARY KEY, title TEXT, image_url TEXT, variants TEXT, variant_meta TEXT, grams REAL, print_s REAL, ship_method TEXT, status TEXT, created_at TEXT, units_total INTEGER, units_90d INTEGER, avg_price REAL, last_sold_at TEXT);
    CREATE TABLE kanal (number TEXT, channel TEXT, listed INTEGER, external_id TEXT, title TEXT, skus TEXT, preis_aktuell REAL, kanal_status TEXT, geplant_ab TEXT, units_total INTEGER, units_90d INTEGER, avg_price REAL, last_sold_at TEXT);
    CREATE TABLE bild (number TEXT, url TEXT, position INTEGER, kind TEXT);
    CREATE TABLE stand (exportiert_at TEXT, quelle TEXT, produkte INTEGER, kanaele INTEGER, bilder INTEGER);
    CREATE INDEX kanal_nr ON kanal(number); CREATE INDEX bild_nr ON bild(number);
  `);
  const iso = (t) => (t ? new Date(t).toISOString() : null);
  const insP = db.prepare("INSERT INTO produkt VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
  const insK = db.prepare("INSERT INTO kanal VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)");
  const insB = db.prepare("INSERT INTO bild VALUES (?,?,?,?)");
  let nK = 0, nB = 0;
  db.transaction(() => {
    for (const p of produkte.values()) {
      const mittel = p.stkPreis ? p.summe / p.stkPreis : p.preise.length ? p.preise.reduce((a, b) => a + b, 0) / p.preise.length : null;
      insP.run(p.number, p.titel, p.bild, p.varianten.length ? JSON.stringify([...new Set(p.varianten)]) : null, null, null, null, null, "aktiv", p.start, p.stk, p.stk90, mittel && Math.round(mittel * 100) / 100, iso(p.letzte || null));
      for (const { it, v } of p.kanaele) {
        const k = v.stk ? v.summe / v.stk : it.preis;
        insK.run(p.number, "ebay", 1, it.itemId, it.title, JSON.stringify([it.sku, ...it.varianten.map((x) => x.sku)].filter(Boolean)), it.preis, "aktiv", null, Math.max(it.verkauft, 0), v.stk90, k && Math.round(k * 100) / 100, iso(v.letzte || null));
        nK++;
      }
      if (p.bild) { insB.run(p.number, p.bild, 0, "galerie"); nB++; }
    }
    db.prepare("INSERT INTO stand VALUES (?,?,?,?,?)").run(new Date().toISOString(), "eBay-API (partureshop), lokal gebaut", produkte.size, nK, nB);
  })();
  db.close();
  fs.renameSync(neu, DB_PFAD);
  return { produkte, nK, nB };
}

const t0 = Date.now();
const token = await accessToken();
console.log("Token ok. Lese aktive Listings …");
const items = await aktiveListings(token);
console.log(`  ${items.length} aktive Listings`);
console.log("Lese Bestellungen (nur zählen) …");
const vk = await verkaeufe(token);
console.log(`  ${vk.size} Artikel mit Verkäufen in ${TAGE_HISTORIE} Tagen`);
const { produkte, nK, nB } = schreibe(items, vk);
const ohneNr = [...produkte.keys()].filter((k) => k.startsWith("ID")).length;
console.log(`Fertig in ${Math.round((Date.now() - t0) / 1000)} s: ${produkte.size} Produkte, ${nK} Kanal-Zeilen, ${nB} Bilder -> ${DB_PFAD}`);
if (ohneNr) console.log(`Hinweis: ${ohneNr} Listings ohne erkennbare Artikelnummer in der SKU (als "ID<ItemID>" angelegt).`);
