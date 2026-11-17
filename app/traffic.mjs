// Traffic je Listing und Tag aus der eBay-Analytics-API, mit Absicherung gegen unfertige Zahlen.
//
// Warum mit Verzögerung: eBay ändert die Zahlen der letzten Tage noch nachträglich. Deshalb gilt ein Tag erst nach
// VERZOEGERUNG Tagen als fertig (Standard 3, in der .env als TRAFFIC_VERZOEGERUNG_TAGE änderbar). Die letzten Tage vor dem
// Stichtag werden bei jedem Lauf noch einmal geholt und verglichen: Weicht eBay ab, wird überschrieben und gezählt.
// Kontrolle: Je Tag wird die Summe über alle Listings mit der Gesamtsumme des Kontos (Dimension DAY) verglichen.
// Alle Funktionen mit Netz bekommen fetchFn, damit die Tests ohne Internet laufen.
export const VERZOEGERUNG_STANDARD = 3;
export const FENSTER_TAGE = 90;     // so viele Tage werden vorgehalten (reicht für die 30- und 90-Tage-Summen)
export const NACHPRUEFEN_TAGE = 3;  // die letzten Tage bis zum Stichtag werden jedes Mal neu geholt und verglichen
const PAKET = 200;                  // die API liefert je Aufruf höchstens 200 Listings (listing_ids-Filter, offset gilt nicht)
const METRIKEN = "TOTAL_IMPRESSION_TOTAL,LISTING_VIEWS_TOTAL,TRANSACTION";

// ---------- Datum (eBay rechnet in Los-Angeles-Zeit) ----------
export const laDatum = (jetzt = new Date(), tageZurueck = 0) => new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Los_Angeles" }).format(new Date(jetzt.getTime() - tageZurueck * 864e5));
export function addTage(iso, n) { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
export const tageListe = (bis, anzahl) => Array.from({ length: anzahl }, (_, i) => addTage(bis, -(anzahl - 1 - i)));
const kompakt = (iso) => iso.replace(/-/g, "");
const ausKompakt = (s) => { const m = String(s).match(/^(\d{4})-?(\d{2})-?(\d{2})$/); return m ? `${m[1]}-${m[2]}-${m[3]}` : null; };

// ---------- Abruf ----------
async function holeJson(fetchFn, url, token, versuche = 3, pauseMs = 1500) {
  let letzter;
  for (let i = 1; i <= versuche; i++) {
    try {
      const r = await fetchFn(url, { headers: { Authorization: "Bearer " + token, "X-EBAY-C-MARKETPLACE-ID": "EBAY_DE" }, signal: AbortSignal.timeout(45000) });
      if (r.ok) return await r.json();
      letzter = new Error(`eBay Analytics: HTTP ${r.status}`);
      if (r.status >= 400 && r.status < 500 && r.status !== 429) break; // Client-Fehler: Wiederholen hilft nicht
    } catch (e) { letzter = e; }
    if (i < versuche) await new Promise((res) => setTimeout(res, pauseMs * i));
  }
  throw letzter;
}
const wert = (keys, mv, k) => { const i = keys.indexOf(k); return i >= 0 ? Number(mv?.[i]?.value) || 0 : 0; };

// Ein Tag, alle Listings: Map(itemId -> { imp, auf, trans }). Wirft bei jedem endgültigen Fehler: lieber kein Tag als ein halber.
export async function holeTag(token, datum, ids, { fetchFn = fetch, versuche = 3, pauseMs = 1500 } = {}) {
  const je = new Map();
  for (let i = 0; i < ids.length; i += PAKET) {
    const filter = `date_range:[${kompakt(datum)}..${kompakt(datum)}],marketplace_ids:{EBAY_DE},listing_ids:{${ids.slice(i, i + PAKET).join("|")}}`;
    const url = "https://api.ebay.com/sell/analytics/v1/traffic_report?" + new URLSearchParams({ dimension: "LISTING", filter, metric: METRIKEN, sort: "-TOTAL_IMPRESSION_TOTAL", limit: String(PAKET) });
    const j = await holeJson(fetchFn, url, token, versuche, pauseMs);
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

// Kontosumme je Tag (Dimension DAY): Map(datum -> { imp, auf, trans }). Bei Fehlern null (die Kontrolle ist eine Zugabe).
export async function holeKontrolle(token, von, bis, { fetchFn = fetch, versuche = 3, pauseMs = 1500 } = {}) {
  try {
    const url = "https://api.ebay.com/sell/analytics/v1/traffic_report?" + new URLSearchParams({ dimension: "DAY", filter: `date_range:[${kompakt(von)}..${kompakt(bis)}],marketplace_ids:{EBAY_DE}`, metric: METRIKEN });
    const j = await holeJson(fetchFn, url, token, versuche, pauseMs);
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

// ---------- Planung und Vergleich (reine Funktionen) ----------
// Welche Tage müssen geholt werden? Fehlende, und die letzten nachpruefen Tage immer.
export function planeTage(vorhandeneTage, alleTage, nachpruefen = NACHPRUEFEN_TAGE) {
  const hat = new Set(vorhandeneTage);
  const spaet = new Set(alleTage.slice(-nachpruefen));
  return alleTage.filter((t) => !hat.has(t) || spaet.has(t));
}

// Wie viele Zeilen eines Tages sind bei eBay inzwischen anders als gespeichert? (neu, weggefallen oder geänderte Zahlen)
export function zaehleAbweichungen(alt, neu) {
  if (!alt) return 0;
  let n = 0;
  const gleich = (a, b) => a.imp === b.imp && a.auf === b.auf && a.trans === b.trans;
  for (const [id, w] of neu) { const a = alt.get(id); if (!a || !gleich(a, w)) n++; }
  for (const id of alt.keys()) if (!neu.has(id)) n++;
  return n;
}

// Summen je Listing über die letzten laenge Tage bis einschließlich bis. tage: Map(datum -> Map(itemId -> {imp,auf,trans})).
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

// Anteil der Kontosumme (Impressionen), den die Listings je Tag erklären. 1 = vollständig. Fehlende Kontrolle: null.
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
