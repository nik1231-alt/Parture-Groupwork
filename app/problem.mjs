// The problem in numbers (page Problem): how unevenly visibility and sales are spread over the products.
// Pure calculation without a database, live from the same product list as all other pages.
//
// eBay only (Niko, 20 Nov 2026: other platforms are not in scope): everything refers to the active eBay listings and
// their eBay sales. A first measurement with the sales of all channels (Amazon alone more than eBay) was discarded.
// The question of the page: how much more strongly do sales than impressions depend on a few listings, and how long is the tail
// that hardly anyone sees? That is exactly where the funnel starts (diagnosis "Low impressions", limit from regeln.leiteSchwellenAb).

import { median } from "./auswertung.mjs";

const zahl = (v) => Number(v) || 0;
// Ab so vielen Impressionen in 90 Tagen gilt ein Angebot auf der Seite Problem als "oft gezeigt" (Vergleich der Verkaufschancen)
export const OFT_GEZEIGT_AB = 1000;

// Concentration: sort the values in descending order and accumulate. kurve = 101 points (0 … 100 % of the products → share of the sum),
// anteilFuer(z) = smallest share of the products that brings z of the sum; top10 = share of the sum held by the best 10 %.
export function konzentration(werte) {
  const v = werte.map(zahl).sort((a, b) => b - a), n = v.length, summe = v.reduce((a, b) => a + b, 0);
  const kum = []; let c = 0; for (const x of v) { c += x; kum.push(c); }
  const bis = (k) => (k <= 0 || !n ? 0 : kum[Math.min(n, k) - 1]);
  const kurve = Array.from({ length: 101 }, (_, i) => ({ produkte: i / 100, anteil: summe ? bis(Math.round((i / 100) * n)) / summe : 0 }));
  const anteilFuer = (ziel) => { if (!summe) return null; const i = kum.findIndex((k) => k >= ziel * summe - 1e-9); return { anzahl: i + 1, anteil: (i + 1) / n }; };
  return { anzahl: n, summe, null: v.filter((x) => x === 0).length, kurve,
    fuer50: anteilFuer(0.5), fuer80: anteilFuer(0.8), fuer90: anteilFuer(0.9),
    top10: summe ? bis(Math.round(0.1 * n)) / summe : null, top20: summe ? bis(Math.round(0.2 * n)) / summe : null };
}

// Distribution of the impressions into bands; the diagnosis limit is its own edge, so that "Low impressions" is exactly one column.
export function stufen(impressionen, grenze) {
  const g = Math.round(grenze);
  const kanten = [...new Set([0, 1, g, 1000, 5000, Infinity].filter((k) => k === 0 || k === Infinity || k >= 1).sort((a, b) => a - b))];
  const aus = [];
  for (let i = 0; i < kanten.length - 1; i++) {
    const von = kanten[i], bis = kanten[i + 1];
    aus.push({ von, bis: bis === Infinity ? null : bis - 1, unterGrenze: bis <= g, anzahl: impressionen.filter((x) => zahl(x) >= von && zahl(x) < bis).length });
  }
  return aus;
}

// products: list from bewertung.ladeProdukte (impressionen_90d, units_90d, ebay_aktiv). grenze90: the diagnosis limit.
const anteil = (liste, f) => (liste.length ? liste.filter(f).length / liste.length : null);

export function auswerten(produkte, grenze90) {
  const ebay = produkte.filter((p) => p.ebay_aktiv === 1 || p.ebay_aktiv === true);
  const gesehen = (p) => zahl(p.impressionen_90d) >= grenze90, verkauft = (p) => zahl(p.units_90d) > 0;
  const feld = (s, v) => ebay.filter((p) => gesehen(p) === s && verkauft(p) === v).length;
  return {
    grenze90: Math.round(grenze90),
    produkte: produkte.length,
    ebayAktiv: ebay.length,
    ohneVerkauf: ebay.filter((p) => !verkauft(p)).length,
    ohneImpressionen: ebay.filter((p) => zahl(p.impressionen_90d) === 0).length,
    kaumGesehen: ebay.filter((p) => !gesehen(p)).length,
    verkaeufe: konzentration(ebay.map((p) => p.units_90d)),
    impressionen: konzentration(ebay.map((p) => p.impressionen_90d)),
    // Four fields of the eBay listings: seen yes/no × sold yes/no (seen = above the diagnosis limit)
    felder: { gesehenVerkauft: feld(true, true), gesehenNichtVerkauft: feld(true, false), kaumGesehenVerkauft: feld(false, true), kaumGesehenNichtVerkauft: feld(false, false) },
    stufen: stufen(ebay.map((p) => p.impressionen_90d), grenze90),
    // Three groups without overlap (together = ebayAktiv): sold / shown, not bought / hardly shown, nothing sold
    gruppen: {
      verkauft: ebay.filter(verkauft).length,
      gezeigtNichtGekauft: feld(true, false),
      kaumGezeigt: feld(false, false),
      kaumGezeigtNie: ebay.filter((p) => !verkauft(p) && zahl(p.impressionen_90d) === 0).length,
    },
    // Anteil der Angebote mit mindestens einem Verkauf: kaum gezeigt (unter der Grenze) gegen oft gezeigt (ab OFT_GEZEIGT_AB)
    chance: { kaum: anteil(ebay.filter((p) => !gesehen(p)), verkauft), oft: anteil(ebay.filter((p) => zahl(p.impressionen_90d) >= OFT_GEZEIGT_AB), verkauft), oftAb: OFT_GEZEIGT_AB },
    // Impressionen eines typischen Angebots (Median): eines, das verkauft hat, gegen eines unter der Grenze
    typisch: { verkauft: median(ebay.filter(verkauft).map((p) => zahl(p.impressionen_90d))), kaum: median(ebay.filter((p) => !gesehen(p)).map((p) => zahl(p.impressionen_90d))) },
  };
}
