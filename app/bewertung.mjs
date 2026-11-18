// Bringt die Produkte aus pm.db und die Regeln zusammen: jedes Angebot bekommt Bereich, Empfehlung und Begründung.
import { bewerte, conversion, klickrate, leiteSchwellenAb, GRUPPEN, EINSTELLUNGEN } from "./regeln.mjs";

// Alle Produkte mit Traffic-Summen. Die traffic-Tabelle ist optional (ältere pm.db hat sie nicht).
// 90-Tage-Werte: Diagnose. 30-Tage-Werte: Ausgangs- und Endzahlen der Tests.
export function ladeProdukte(db) {
  const hatTraffic = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='traffic'").get();
  const summe = (spalte, tage) => `(SELECT SUM(${spalte}) FROM traffic t WHERE t.number = p.number AND t.tage = ${tage})`;
  const sql = "SELECT p.number, p.title, p.image_url, p.avg_price, p.units_total, p.units_90d, p.created_at, p.last_sold_at, "
    + (hatTraffic
      ? `${summe("aufrufe", 90)} AS aufrufe_90d, ${summe("impressionen", 90)} AS impressionen_90d, ${summe("aufrufe", 30)} AS aufrufe_30d, ${summe("impressionen", 30)} AS impressionen_30d, ${summe("transaktionen", 30)} AS transaktionen_30d `
      : "NULL AS aufrufe_90d, NULL AS impressionen_90d, NULL AS aufrufe_30d, NULL AS impressionen_30d, NULL AS transaktionen_30d ")
    + "FROM produkt p";
  return db.prepare(sql).all();
}

// Sperrliste aus pm.db (Tabelle "sperre", vom Hub: Angebote eines laufenden Preisversuchs). Die Tabelle ist optional: fehlt sie
// (ältere pm.db, Team-Kopie), ist nichts gesperrt. Eine Zeile sperrt über die Produktnummer (sperre.number) oder über die
// eBay-Artikelnummer (sperre.external_id, über die Tabelle kanal auf die Produktnummer abgebildet). Liefert [{ number, bis }];
// ob "bis" schon vorbei ist, entscheidet experimente.gesperrteNummern.
export function ladeSperre(db) {
  const hat = (t) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t);
  if (!hat("sperre")) return [];
  const direkt = db.prepare("SELECT number, bis FROM sperre WHERE number IS NOT NULL AND number != ''").all();
  const ueberEbay = hat("kanal") ? db.prepare("SELECT k.number AS number, s.bis AS bis FROM sperre s JOIN kanal k ON k.channel = 'ebay' AND k.external_id = s.external_id WHERE s.external_id IS NOT NULL AND s.external_id != ''").all() : [];
  return [...direkt, ...ueberEbay];
}

// einst: die gespeicherten Einstellungen. imTest: Map(number -> { id, gruppe, status }) aus experimente.imTest.
export function baueBewertung(produkte, einst = EINSTELLUNGEN, jetzt = new Date(), imTest = new Map()) {
  const abgeleitet = leiteSchwellenAb(produkte, einst, jetzt); // die Grenze "wenig Impressionen" kommt aus den Daten bzw. der Einstellung
  const uebersicht = Object.fromEntries(Object.keys(GRUPPEN).map((k) => [k, 0]));
  const liste = produkte.map((p) => {
    const b = bewerte(p, abgeleitet, jetzt);
    uebersicht[b.gruppe]++;
    return { ...p, conversion: conversion(p), klickrate: klickrate(p), gruppe: b.gruppe, empfehlung: b.empfehlung, begruendung: b.begruendung, imTest: imTest.get(p.number) || null };
  });
  return { einstellungen: abgeleitet, gruppen: GRUPPEN, uebersicht, summe: { produkte: liste.length }, produkte: liste };
}
