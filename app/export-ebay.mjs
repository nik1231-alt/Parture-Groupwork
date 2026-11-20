// Builds daten/pm.db itself from the eBay API (account partureshop). Read access only.
// Call: npm run export   (needs EBAY_APP_ID, EBAY_CERT_ID, EBAY_REFRESH_TOKEN in the .env)
//       npm run export:team   (as above, also writes the team copy daten-team/pm.db without daily values)
// Also runs automatically once a day in the server (EBAY_TRAFFIC_AUTO=an), see server.mjs.
//
// Traffic: daily values per listing are fetched (table traffic_tag) and the 30- and 90-day sums (table traffic) are formed
// from them, each up to the cut-off day = today minus 3 days (TRAFFIC_VERZOEGERUNG_TAGE). See traffic.mjs.
//
// Whitelist as in the README: catalogue, channel, quantity, price, images. NOT taken over are
// buyers, addresses, fees, costs, revenue in euros. Orders are added up only into quantity,
// average price and last sale date per item; single orders are not stored.
//
// Not derivable from eBay (stay empty): grams, print_s, ship_method, variant_meta.
// Only the channel "ebay" is filled (Amazon, Etsy, shop, TikTok need their own sources).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { laDatum, tageListe, planeTage, zaehleAbweichungen, fensterSummen, abdeckung, holeTag, holeZeitraum, holeKontrolle, FENSTER_TAGE, NACHPRUEFEN_TAGE, verzoegerungTage, LimitFehler } from "./traffic.mjs";

const WURZEL = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
ladeEnv(path.join(WURZEL, ".env"));
const { EBAY_APP_ID, EBAY_CERT_ID, EBAY_REFRESH_TOKEN } = process.env;
const TEAM = process.argv.includes("--team");
const DB_PFAD = path.resolve(WURZEL, process.env.PM_DB || "daten/pm.db");
const TEAM_PFAD = path.resolve(WURZEL, "daten-team/pm.db");
// Cache of the daily values: stays when a run aborts (e.g. eBay limit), the next run continues there.
const CACHE_PFAD = path.resolve(WURZEL, process.env.PM_TRAFFIC_CACHE || "daten/traffic-tage.db");
const VERZOEGERUNG = verzoegerungTage();
const MIN_ABDECKUNG = Number(process.env.TRAFFIC_MIN_ABDECKUNG) || 0.8; // below this the run counts as faulty and the old file stays
const SITE_DE = "77";
const TAGE_HISTORIE = 360; // orders are read this far back (for last_sold_at)

function ladeEnv(p) {
  if (!fs.existsSync(p)) return;
  for (const z of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = z.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

async function accessToken() {
  if (!EBAY_APP_ID || !EBAY_CERT_ID || !EBAY_REFRESH_TOKEN) throw new Error("EBAY_APP_ID, EBAY_CERT_ID and EBAY_REFRESH_TOKEN are missing in the .env");
  const r = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: "Basic " + Buffer.from(`${EBAY_APP_ID}:${EBAY_CERT_ID}`).toString("base64") },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: EBAY_REFRESH_TOKEN }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error("eBay did not issue an access token: " + (j.error_description || j.error || r.status));
  return j.access_token;
}

// ---- small XML helpers (the Trading API returns XML) -------------------------------------------
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

// Condense orders only into counters per item (store no buyer data, no single orders).
async function verkaeufe(token) {
  const je = new Map(); // itemId -> { stk, stk90, summe, letzte }
  const grenze90 = Date.now() - 90 * 864e5;
  const fenster = 90 * 864e5;
  for (let ende = Date.now(); ende > Date.now() - TAGE_HISTORIE * 864e5; ende -= fenster) {
    const von = new Date(ende - fenster).toISOString(), bis = new Date(ende).toISOString();
    for (let offset = 0; ; offset += 200) {
      const url = `https://api.ebay.com/sell/fulfillment/v1/order?filter=${encodeURIComponent(`creationdate:[${von}..${bis}]`)}&limit=200&offset=${offset}`;
      const r = await fetch(url, { headers: { Authorization: "Bearer " + token } });
      if (!r.ok) { console.warn(`  Orders ${von.slice(0, 10)}..${bis.slice(0, 10)}: HTTP ${r.status} (skipped)`); break; }
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

// Cache of the daily values (a file of its own, not touched when pm.db is rebuilt).
function oeffneCache() {
  fs.mkdirSync(path.dirname(CACHE_PFAD), { recursive: true });
  const c = new Database(CACHE_PFAD);
  c.exec("CREATE TABLE IF NOT EXISTS tag (datum TEXT PRIMARY KEY, geholt_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS zeile (datum TEXT NOT NULL, item_id TEXT NOT NULL, imp INTEGER, auf INTEGER, trans INTEGER, PRIMARY KEY (datum, item_id));");
  return c;
}
function leseCache(c, ersterTag) {
  const aus = new Map();
  for (const t of c.prepare("SELECT datum FROM tag WHERE datum >= ?").all(ersterTag)) aus.set(t.datum, new Map());
  for (const z of c.prepare("SELECT datum, item_id, imp, auf, trans FROM zeile WHERE datum >= ?").iterate(ersterTag)) aus.get(z.datum)?.set(z.item_id, { imp: z.imp, auf: z.auf, trans: z.trans });
  return aus;
}
function speichereTag(c, datum, m) {
  c.transaction(() => {
    c.prepare("DELETE FROM zeile WHERE datum = ?").run(datum);
    const ins = c.prepare("INSERT INTO zeile VALUES (?,?,?,?,?)");
    for (const [id, w] of m) ins.run(datum, id, w.imp, w.auf, w.trans);
    c.prepare("INSERT OR REPLACE INTO tag VALUES (?, ?)").run(datum, new Date().toISOString());
  })();
}

// Item number = leading digits of the SKU ("234 -  -" -> 234, "1254_Gr" -> 1254). Variant listings: the first variant SKU.
function artikelnummer(it) {
  for (const s of [it.sku, ...it.varianten.map((v) => v.sku)]) { const m = s && s.match(/^\s*(\d{1,6})/); if (m) return m[1]; }
  return null;
}

function schreibe(items, vk, tage, stichtag, meta) {
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
    CREATE TABLE traffic (item_id TEXT, number TEXT, tage INTEGER, impressionen INTEGER, aufrufe INTEGER, klickrate REAL, conversion REAL, transaktionen INTEGER);
    CREATE TABLE traffic_tag (datum TEXT, item_id TEXT, number TEXT, impressionen INTEGER, aufrufe INTEGER, transaktionen INTEGER);
    CREATE TABLE stand (exportiert_at TEXT, quelle TEXT, produkte INTEGER, kanaele INTEGER, bilder INTEGER, traffic_bis TEXT, traffic_tage INTEGER, traffic_abdeckung REAL);
    CREATE INDEX kanal_nr ON kanal(number); CREATE INDEX traffic_nr ON traffic(number); CREATE INDEX traffic_tag_datum ON traffic_tag(datum); CREATE INDEX bild_nr ON bild(number);
  `);
  const iso = (t) => (t ? new Date(t).toISOString() : null);
  const insP = db.prepare("INSERT INTO produkt VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
  const insK = db.prepare("INSERT INTO kanal VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)");
  const insB = db.prepare("INSERT INTO bild VALUES (?,?,?,?)");
  const insT = db.prepare("INSERT INTO traffic VALUES (?,?,?,?,?,?,?,?)");
  const insTag = db.prepare("INSERT INTO traffic_tag VALUES (?,?,?,?,?,?)");
  const bekannt = new Set(items.map((i) => i.itemId));
  const fenster = meta.fenster ?? { 30: fensterSummen(tage, stichtag, 30, bekannt), 90: fensterSummen(tage, stichtag, 90, bekannt) };
  const nummerVon = new Map();
  let nK = 0, nB = 0, nT = 0;
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
      for (const { it } of p.kanaele) {
        nummerVon.set(it.itemId, p.number);
        for (const tg of [30, 90]) { const t = fenster[tg].get(it.itemId); if (t) { insT.run(it.itemId, p.number, tg, t.imp, t.auf, t.imp ? t.auf / t.imp : 0, t.auf ? t.trans / t.auf : 0, t.trans); nT++; } }
      }
    }
    for (const [datum, ids] of tage) for (const [id, w] of ids) if (nummerVon.has(id) && (w.imp || w.auf || w.trans)) insTag.run(datum, id, nummerVon.get(id), w.imp, w.auf, w.trans);
    db.prepare("INSERT INTO stand VALUES (?,?,?,?,?,?,?,?)").run(new Date().toISOString(), "eBay-API (partureshop), lokal gebaut", produkte.size, nK, nB, stichtag, tage.size, meta.abdeckung?.mittel ?? null);
  })();
  db.close();
  fs.renameSync(neu, DB_PFAD);
  return { produkte, nK, nB, nT };
}

const t0 = Date.now();
const token = await accessToken();
console.log("Token ok. Lese aktive Listings …");
const items = await aktiveListings(token);
console.log(`  ${items.length} aktive Listings`);
console.log("Reading orders (counting only) …");
const vk = await verkaeufe(token);
console.log(`  ${vk.size} items with sales in ${TAGE_HISTORIE} days`);

// ---- Traffic: finished days only (today minus VERZOEGERUNG), catch up missing days, re-check the last days ----
const stichtag = laDatum(new Date(), VERZOEGERUNG);
const alleTage = tageListe(stichtag, FENSTER_TAGE);
const cache = oeffneCache();
const alt = leseCache(cache, alleTage[0]);
const nachpruef = new Set(alleTage.slice(-NACHPRUEFEN_TAGE));
// Order: first the re-check of the last days, then the missing days from the newest to the oldest
const holen = planeTage([...alt.keys()], alleTage).sort((a, b) => (nachpruef.has(b) - nachpruef.has(a)) || (a < b ? 1 : -1));
console.log(`Traffic up to ${stichtag} (delay ${VERZOEGERUNG} days): ${alt.size} of ${alleTage.length} days in the cache, fetching ${holen.length} (${holen.filter((d) => alt.has(d)).length} of them to re-check) …`);
const ids = items.map((i) => i.itemId);
let abweichungen = 0, nachgeprueft = 0, geholt = 0, limit = null;
const tage = new Map(alt);
for (const d of holen) {
  let m;
  try { m = await holeTag(token, d, ids, { drosselMs: 300 }); }
  catch (e) { if (e instanceof LimitFehler) { limit = e.message; break; } throw e; }
  if (nachpruef.has(d) && alt.has(d)) { nachgeprueft++; abweichungen += zaehleAbweichungen(alt.get(d), m); }
  speichereTag(cache, d, m); tage.set(d, m); geholt++;
}
const vollstaendig = alleTage.every((d) => tage.has(d));
if (limit) console.log(`  eBay limit reached after ${geholt} days: ${limit}. Progress is saved, the next run continues.`);
console.log(`  ${tage.size} of ${alleTage.length} days available${vollstaendig ? " (complete)" : ""}.`);
if (nachgeprueft) console.log(`  Re-check: ${nachgeprueft} days read again, eBay changed ${abweichungen} rows afterwards (overwritten).`);

// As long as the 90 days are not complete, the sums come directly from eBay (period queries, few calls).
let fenster = null;
if (!vollstaendig) {
  console.log("  Daily values still incomplete: the 30- and 90-day sums come as period sums directly from eBay.");
  try {
    fenster = {};
    for (const n of [30, 90]) fenster[n] = await holeZeitraum(token, tageListe(stichtag, n)[0], stichtag, ids, { drosselMs: 300 });
  } catch (e) {
    cache.close();
    throw new Error("Could not fetch traffic (" + e.message + "). The old pm.db stays unchanged, the cache holds " + tage.size + " days.");
  }
}
cache.close();
const kontrolle = await holeKontrolle(token, alleTage[0], stichtag);
const ab = abdeckung(tage, kontrolle, alleTage);
if (ab) console.log(`  Check against the account total: on average ${(100 * ab.mittel).toFixed(1)} %, weakest day ${ab.schlechtester} with ${(100 * ab.min).toFixed(1)} % (${ab.tage} days checked)`);
else console.log("  The check against the account total was not possible.");
if (ab && ab.mittel < MIN_ABDECKUNG) throw new Error(`Traffic check failed: the listings explain only ${(100 * ab.mittel).toFixed(1)} % of the account total on average (limit ${(100 * MIN_ABDECKUNG).toFixed(0)} %). The old file stays unchanged.`);

const { produkte, nK, nB, nT } = schreibe(items, vk, tage, stichtag, { abdeckung: ab, fenster });
const ohneNr = [...produkte.keys()].filter((k) => k.startsWith("ID")).length;
console.log(`Fertig in ${Math.round((Date.now() - t0) / 1000)} s: ${produkte.size} Produkte, ${nK} Kanal-Zeilen, ${nB} Bilder, ${nT} Traffic-Summen, Tagesdaten bis ${stichtag} -> ${DB_PFAD}`);
if (ohneNr) console.log(`Note: ${ohneNr} listings without a recognisable item number in the SKU (created as "ID<ItemID>").`);

// Team copy: the same data without the daily data (keep it small, the app needs only the sums there)
if (TEAM) {
  fs.mkdirSync(path.dirname(TEAM_PFAD), { recursive: true });
  const tmp = TEAM_PFAD + ".neu";
  fs.copyFileSync(DB_PFAD, tmp);
  const d = new Database(tmp); d.exec("DROP TABLE traffic_tag; VACUUM;"); d.close();
  fs.renameSync(tmp, TEAM_PFAD);
  console.log("Team-Kopie geschrieben: " + TEAM_PFAD);
}
console.log("RESULT " + JSON.stringify({ produkte: produkte.size, kanaele: nK, trafficBis: stichtag, tageGeholt: geholt, tageVorhanden: tage.size, vollstaendig, limitErreicht: !!limit, nachgeprueft, abweichungen, abdeckungMittel: ab?.mittel ?? null, abdeckungMin: ab?.min ?? null, sekunden: Math.round((Date.now() - t0) / 1000) }));
