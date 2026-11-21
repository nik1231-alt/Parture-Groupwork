// Traffic per listing and day from the eBay Analytics API, with protection against unfinished figures.
//
// Why with a delay: eBay still changes the figures of the last days afterwards. That is why a day counts as finished only after
// VERZOEGERUNG days (default 3, changeable in the .env as TRAFFIC_VERZOEGERUNG_TAGE). The last days before the
// cut-off day are fetched again on every run and compared: if eBay differs, it is overwritten and counted.
// Control: for each day the sum over all listings is compared with the total of the account (dimension DAY).
// All functions with network get fetchFn, so that the tests run without internet.
export const VERZOEGERUNG_STANDARD = 3;
export const FENSTER_TAGE = 90;     // so many days are kept (enough for the 30- and 90-day sums)
export const NACHPRUEFEN_TAGE = 3;  // the last days up to the cut-off day are fetched anew each time and compared
// The delay that actually applies (export, data-age warning and interface all calculate with this one function)
export const verzoegerungTage = (env = process.env) => Math.max(1, Number(env.TRAFFIC_VERZOEGERUNG_TAGE) || VERZOEGERUNG_STANDARD);
const PAKET = 200;                  // the API returns at most 200 listings per call (listing_ids filter, offset does not apply)
const METRIKEN = "TOTAL_IMPRESSION_TOTAL,LISTING_VIEWS_TOTAL,TRANSACTION";

// ---------- Date (eBay calculates in Los Angeles time) ----------
export const laDatum = (jetzt = new Date(), tageZurueck = 0) => new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Los_Angeles" }).format(new Date(jetzt.getTime() - tageZurueck * 864e5));
export function addTage(iso, n) { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
export const tageListe = (bis, anzahl) => Array.from({ length: anzahl }, (_, i) => addTage(bis, -(anzahl - 1 - i)));
const kompakt = (iso) => iso.replace(/-/g, "");
const ausKompakt = (s) => { const m = String(s).match(/^(\d{4})-?(\d{2})-?(\d{2})$/); return m ? `${m[1]}-${m[2]}-${m[3]}` : null; };

// ---------- Abruf ----------
// eBay limits the Analytics API (HTTP 429, "request limit has been reached"). Then there is no hammering: after a
// short wait there is a second attempt, after that the function throws a LimitFehler. The import saves what it has
// and continues at the next run.
export class LimitFehler extends Error { constructor(m) { super(m); this.name = "LimitFehler"; this.limit = true; } }
async function holeJson(fetchFn, url, token, versuche = 3, pauseMs = 1500, limitPauseMs = 20000) {
  let letzter; let limitVersuche = 0;
  for (let i = 1; i <= versuche; i++) {
    try {
      const r = await fetchFn(url, { headers: { Authorization: "Bearer " + token, "X-EBAY-C-MARKETPLACE-ID": "EBAY_DE" }, signal: AbortSignal.timeout(45000) });
      if (r.ok) return await r.json();
      if (r.status === 429) {
        if (++limitVersuche >= 2) throw new LimitFehler("eBay Analytics: request limit reached (HTTP 429)");
        await new Promise((res) => setTimeout(res, limitPauseMs)); i--; continue; // does not count as a normal attempt
      }
      letzter = new Error(`eBay Analytics: HTTP ${r.status}`);
      if (r.status >= 400 && r.status < 500) break; // Client error: retrying does not help
    } catch (e) { if (e instanceof LimitFehler) throw e; letzter = e; }
    if (i < versuche) await new Promise((res) => setTimeout(res, pauseMs * i));
  }
  throw letzter;
}
const wert = (keys, mv, k) => { const i = keys.indexOf(k); return i >= 0 ? Number(mv?.[i]?.value) || 0 : 0; };

// A period (von to bis, inclusive), all listings: Map(itemId -> { imp, auf, trans }).
// Throws on every final error: rather nothing at all than half a day.
export async function holeZeitraum(token, von, bis, ids, { fetchFn = fetch, versuche = 3, pauseMs = 1500, limitPauseMs = 20000, drosselMs = 0 } = {}) {
  const je = new Map();
  for (let i = 0; i < ids.length; i += PAKET) {
    if (i > 0 && drosselMs) await new Promise((res) => setTimeout(res, drosselMs));
    const filter = `date_range:[${kompakt(von)}..${kompakt(bis)}],marketplace_ids:{EBAY_DE},listing_ids:{${ids.slice(i, i + PAKET).join("|")}}`;
    const url = "https://api.ebay.com/sell/analytics/v1/traffic_report?" + new URLSearchParams({ dimension: "LISTING", filter, metric: METRIKEN, sort: "-TOTAL_IMPRESSION_TOTAL", limit: String(PAKET) });
    const j = await holeJson(fetchFn, url, token, versuche, pauseMs, limitPauseMs);
    const keys = (j.header?.metrics || []).map((m) => m.key);
    for (const rec of j.records || []) {
      const id = rec.dimensionValues?.[0]?.value;
      if (!id || je.has(id)) continue;
      const mv = rec.metricValues || [];
      je.set(id, { imp: wert(keys, mv, "TOTAL_IMPRESSION_TOTAL"), auf: wert(keys, mv, "LISTING_VIEWS_TOTAL"), trans: wert(keys, mv, "TRANSACTION") });
    }
  }
  return je;
}

export const holeTag = (token, datum, ids, opts) => holeZeitraum(token, datum, datum, ids, opts);

// Account total per day (dimension DAY): Map(date -> { imp, auf, trans }). On errors null (the control is an extra).
export async function holeKontrolle(token, von, bis, { fetchFn = fetch, versuche = 3, pauseMs = 1500 } = {}) {
  try {
    const url = "https://api.ebay.com/sell/analytics/v1/traffic_report?" + new URLSearchParams({ dimension: "DAY", filter: `date_range:[${kompakt(von)}..${kompakt(bis)}],marketplace_ids:{EBAY_DE}`, metric: METRIKEN });
    const j = await holeJson(fetchFn, url, token, versuche, pauseMs, 0);
    const keys = (j.header?.metrics || []).map((m) => m.key);
    const aus = new Map();
    for (const rec of j.records || []) {
      const d = ausKompakt(rec.dimensionValues?.[0]?.value); if (!d) continue;
      const mv = rec.metricValues || [];
      aus.set(d, { imp: wert(keys, mv, "TOTAL_IMPRESSION_TOTAL"), auf: wert(keys, mv, "LISTING_VIEWS_TOTAL"), trans: wert(keys, mv, "TRANSACTION") });
    }
    return aus;
  } catch { return null; }
}

// ---------- Planning and comparison (pure functions) ----------
// Which days have to be fetched? Missing ones, and the last nachpruefen days always.
export function planeTage(vorhandeneTage, alleTage, nachpruefen = NACHPRUEFEN_TAGE) {
  const hat = new Set(vorhandeneTage);
  const spaet = new Set(alleTage.slice(-nachpruefen));
  return alleTage.filter((t) => !hat.has(t) || spaet.has(t));
}

// How many rows of a day are now different on eBay than stored? (new, dropped or changed figures)
export function zaehleAbweichungen(alt, neu) {
  if (!alt) return 0;
  let n = 0;
  const gleich = (a, b) => a.imp === b.imp && a.auf === b.auf && a.trans === b.trans;
  for (const [id, w] of neu) { const a = alt.get(id); if (!a || !gleich(a, w)) n++; }
  for (const id of alt.keys()) if (!neu.has(id)) n++;
  return n;
}

// Sums per listing over the last laenge days up to and including bis. tage: Map(date -> Map(itemId -> {imp,auf,trans})).
export function fensterSummen(tage, bis, laenge, bekannt = null) {
  const von = addTage(bis, -(laenge - 1));
  const je = new Map();
  for (const [datum, ids] of tage) {
    if (datum < von || datum > bis) continue;
    for (const [id, w] of ids) {
      if (bekannt && !bekannt.has(id)) continue;
      const s = je.get(id) || { imp: 0, auf: 0, trans: 0 };
      s.imp += w.imp; s.auf += w.auf; s.trans += w.trans; je.set(id, s);
    }
  }
  return je;
}

// Share of the account total (impressions) that the listings explain per day. 1 = complete. Missing control: null.
export function abdeckung(tage, kontrolle, tageListeGeprueft) {
  if (!kontrolle) return null;
  const zeilen = [];
  for (const d of tageListeGeprueft) {
    const k = kontrolle.get(d); const ids = tage.get(d);
    if (!k || !ids || !k.imp) continue;
    let summe = 0; for (const w of ids.values()) summe += w.imp;
    zeilen.push({ datum: d, anteil: summe / k.imp });
  }
  if (!zeilen.length) return null;
  return { min: Math.min(...zeilen.map((z) => z.anteil)), mittel: zeilen.reduce((s, z) => s + z.anteil, 0) / zeilen.length, schlechtester: zeilen.reduce((a, b) => (b.anteil < a.anteil ? b : a)).datum, tage: zeilen.length };
}
