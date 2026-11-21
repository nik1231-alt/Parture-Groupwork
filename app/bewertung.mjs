// Brings the products from pm.db and the rules together: every listing gets an area, a recommendation and a reason.
import { bewerte, conversion, klickrate, leiteSchwellenAb, GRUPPEN, EINSTELLUNGEN } from "./regeln.mjs";

// All products with traffic sums. The traffic table is optional (an older pm.db does not have it).
// 90-day values: diagnosis. 30-day values: starting and final figures of the tests.
export function ladeProdukte(db) {
  const hatTraffic = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='traffic'").get();
  const hatKanal = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='kanal'").get();
  // Without a provable eBay assignment no analysis; never fall back to cross-channel figures.
  if (!hatKanal) return [];
  const spalten = new Set(db.prepare("PRAGMA table_info(kanal)").all().map((s) => s.name));
  const kanal = (spalte, funktion) => spalten.has(spalte)
    ? `(SELECT ${funktion}(k.${spalte}) FROM kanal k WHERE k.number = p.number AND k.channel = 'ebay')` : "NULL";
  const summe = (spalte, tage) => `(SELECT SUM(${spalte}) FROM traffic t WHERE t.number = p.number AND t.tage = ${tage} AND ${ebayTrafficFilter(db)})`;
  const sql = "SELECT p.number, " + kanal("title", "MIN") + " AS title, p.image_url, "
    + kanal("preis_aktuell", "AVG") + " AS avg_price, " + kanal("units_total", "SUM") + " AS units_total, "
    + kanal("units_90d", "SUM") + " AS units_90d, p.created_at, " + kanal("last_sold_at", "MAX") + " AS last_sold_at, "
    + (hatTraffic
      ? `${summe("aufrufe", 90)} AS aufrufe_90d, ${summe("impressionen", 90)} AS impressionen_90d, ${summe("aufrufe", 30)} AS aufrufe_30d, ${summe("impressionen", 30)} AS impressionen_30d, ${summe("transaktionen", 30)} AS transaktionen_30d `
      : "NULL AS aufrufe_90d, NULL AS impressionen_90d, NULL AS aufrufe_30d, NULL AS impressionen_30d, NULL AS transaktionen_30d ")
    // ebay_aktiv: does the product have a running eBay listing with a number? Only those can get a new title (see kandidaten)
    + (hatKanal ? ", EXISTS (SELECT 1 FROM kanal k WHERE k.number = p.number AND k.channel = 'ebay' AND k.listed = 1 AND k.external_id IS NOT NULL) AS ebay_aktiv " : ", NULL AS ebay_aktiv ")
    + "FROM produkt p WHERE EXISTS (SELECT 1 FROM kanal k WHERE k.number = p.number AND k.channel = 'ebay')";
  return db.prepare(sql).all();
}

// EXISTS avoids doubled traffic sums for multiple channel rows. Foreign/unknown ids never count.
export function ebayTrafficFilter(db) {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='kanal'").get()) return "0";
  return "EXISTS (SELECT 1 FROM kanal k WHERE k.channel = 'ebay' AND k.number = t.number AND k.external_id = t.item_id AND k.external_id IS NOT NULL AND k.external_id != '')";
}

export function ladeImpressionenProTag(db, nummer, von, bis) {
  const tage = Math.round((Date.parse(bis) - Date.parse(von)) / 864e5);
  if (tage <= 0 || !db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='traffic_tag'").get()) return 0;
  return (db.prepare(`SELECT SUM(t.impressionen) s FROM traffic_tag t WHERE t.number = ? AND t.datum > ? AND t.datum <= ? AND ${ebayTrafficFilter(db)}`).get(nummer, von, bis).s || 0) / tage;
}

// Block list from pm.db (table "sperre", from the hub: listings of a running price experiment). The table is optional: if it is missing
// (older pm.db, team copy), nothing is blocked. A row blocks through the product number (sperre.number) or through the
// eBay item number (sperre.external_id, mapped to the product number through the table kanal). Returns [{ number, bis }];
// whether "bis" is already over is decided by experimente.gesperrteNummern.
export function ladeSperre(db) {
  const hat = (t) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t);
  if (!hat("sperre")) return [];
  const direkt = db.prepare("SELECT number, bis FROM sperre WHERE number IS NOT NULL AND number != ''").all();
  const ueberEbay = hat("kanal") ? db.prepare("SELECT k.number AS number, s.bis AS bis FROM sperre s JOIN kanal k ON k.channel = 'ebay' AND k.external_id = s.external_id WHERE s.external_id IS NOT NULL AND s.external_id != ''").all() : [];
  return [...direkt, ...ueberEbay];
}

// einst: the saved settings. imTest: Map(number -> { id, gruppe, status }) from experimente.imTest.
export function baueBewertung(produkte, einst = EINSTELLUNGEN, jetzt = new Date(), imTest = new Map()) {
  const abgeleitet = leiteSchwellenAb(produkte, einst, jetzt); // the limit "low impressions" comes from the data or the setting
  const uebersicht = Object.fromEntries(Object.keys(GRUPPEN).map((k) => [k, 0]));
  const liste = produkte.map((p) => {
    const b = bewerte(p, abgeleitet, jetzt);
    uebersicht[b.gruppe]++;
    return { ...p, conversion: conversion(p), klickrate: klickrate(p), gruppe: b.gruppe, empfehlung: b.empfehlung, begruendung: b.begruendung, imTest: imTest.get(p.number) || null };
  });
  return { einstellungen: abgeleitet, gruppen: GRUPPEN, uebersicht, summe: { produkte: liste.length }, produkte: liste };
}
