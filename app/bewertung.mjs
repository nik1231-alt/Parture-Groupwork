// Bringt Produkte aus pm.db, die Regeln, die Vorschläge und die gespeicherten Entscheidungen zusammen.
import { bewerte, conversion, klickrate, leiteSchwellenAb, GRUPPEN, AKTIONEN, EINSTELLUNGEN } from "./regeln.mjs";
import { lerneTitelWoerter, bereiteAehnlichkeit, schlageVor } from "./vorschlaege.mjs";

// Alle Produkte mit Traffic-Summen der letzten 90 Tage. Die traffic-Tabelle ist optional (ältere pm.db hat sie nicht).
export function ladeProdukte(db) {
  const hatTraffic = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='traffic'").get();
  const sql = `SELECT p.number, p.title, p.image_url, p.avg_price, p.units_total, p.units_90d, p.created_at, p.last_sold_at, `
    + (hatTraffic
      ? "(SELECT SUM(aufrufe) FROM traffic t WHERE t.number = p.number AND t.tage = 90) AS aufrufe_90d, (SELECT SUM(impressionen) FROM traffic t WHERE t.number = p.number AND t.tage = 90) AS impressionen_90d, "
        // 30-Tage-Werte: Grundlage für die Prüfung einer Änderung (Protokoll)
        + "(SELECT SUM(aufrufe) FROM traffic t WHERE t.number = p.number AND t.tage = 30) AS aufrufe_30d, (SELECT SUM(impressionen) FROM traffic t WHERE t.number = p.number AND t.tage = 30) AS impressionen_30d, (SELECT SUM(transaktionen) FROM traffic t WHERE t.number = p.number AND t.tage = 30) AS transaktionen_30d "
      : "NULL AS aufrufe_90d, NULL AS impressionen_90d, NULL AS aufrufe_30d, NULL AS impressionen_30d, NULL AS transaktionen_30d ")
    + "FROM produkt p";
  return db.prepare(sql).all();
}

export function baueBewertung(produkte, entscheidungen, jetzt = new Date(), laufend = new Map(), entwuerfe = new Map()) {
  // Schwellen und Titel-Statistik kommen aus den Zahlen des Shops selbst
  const einst = leiteSchwellenAb(produkte, EINSTELLUNGEN, jetzt);
  const stat = lerneTitelWoerter(produkte, einst, jetzt);
  const aehnlich = bereiteAehnlichkeit(produkte, einst, jetzt);
  const uebersicht = Object.fromEntries(Object.keys(GRUPPEN).map((k) => [k, 0]));
  let entschieden = 0;
  const liste = produkte.map((p) => {
    const b = bewerte(p, einst, jetzt);
    uebersicht[b.gruppe]++;
    const e = entscheidungen.get(p.number) || null;
    if (e && e.aktion) entschieden++;
    const mitGruppe = { ...p, gruppe: b.gruppe };
    return { ...p, conversion: conversion(p), klickrate: klickrate(p), gruppe: b.gruppe, empfehlung: b.empfehlung, begruendung: b.begruendung, vorschlag: schlageVor(mitGruppe, stat, einst, aehnlich, entwuerfe.get(p.number) || null), entscheidung: e, laufendeAenderung: laufend.get(p.number) || null };
  });
  return {
    einstellungen: einst,
    gruppen: GRUPPEN,
    aktionen: AKTIONEN,
    uebersicht,
    summe: { produkte: liste.length, entschieden },
    produkte: liste,
  };
}
