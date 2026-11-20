// Das Problem in Zahlen (Seite Problem): wie ungleich Sichtbarkeit und Verkäufe über die Produkte verteilt sind.
// Reine Rechnung ohne Datenbank, live aus derselben Produktliste wie alle anderen Seiten.
//
// Gemessen am 20.11.2026: 80 % der Verkäufe kommen von 8,5 % der Produkte, 80 % der Impressionen aber von 35 % der
// eBay-Angebote. Die Sichtbarkeit ist also breiter verteilt als die Verkäufe, und unten bleibt ein langer Schwanz, den
// kaum jemand sieht. Genau dort setzt der Funnel an (Diagnose "Low impressions", Grenze aus regeln.leiteSchwellenAb).

const zahl = (v) => Number(v) || 0;

// Konzentration: Werte absteigend sortieren und kumulieren. kurve = 101 Punkte (0 … 100 % der Produkte → Anteil der Summe),
// anteilFuer(z) = kleinster Anteil der Produkte, der z der Summe bringt; top10 = Anteil der Summe bei den besten 10 %.
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

// Verteilung der Impressionen in Stufen; die Grenze der Diagnose ist eine eigene Kante, damit "Low impressions" genau eine Säule ist.
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

// produkte: Liste aus bewertung.ladeProdukte (impressionen_90d, units_90d, ebay_aktiv). grenze90: Grenze der Diagnose.
export function auswerten(produkte, grenze90) {
  const ebay = produkte.filter((p) => p.ebay_aktiv === 1 || p.ebay_aktiv === true);
  const gesehen = (p) => zahl(p.impressionen_90d) >= grenze90, verkauft = (p) => zahl(p.units_90d) > 0;
  const feld = (s, v) => ebay.filter((p) => gesehen(p) === s && verkauft(p) === v).length;
  return {
    grenze90: Math.round(grenze90),
    produkte: produkte.length,
    ebayAktiv: ebay.length,
    ohneVerkauf: produkte.filter((p) => !verkauft(p)).length,
    ebayOhneVerkauf: ebay.filter((p) => !verkauft(p)).length,
    ohneImpressionen: ebay.filter((p) => zahl(p.impressionen_90d) === 0).length,
    kaumGesehen: ebay.filter((p) => !gesehen(p)).length,
    verkaeufe: konzentration(produkte.map((p) => p.units_90d)),
    impressionen: konzentration(ebay.map((p) => p.impressionen_90d)),
    // Vier Felder der eBay-Angebote: gesehen ja/nein × verkauft ja/nein (gesehen = über der Grenze der Diagnose)
    felder: { gesehenVerkauft: feld(true, true), gesehenNichtVerkauft: feld(true, false), kaumGesehenVerkauft: feld(false, true), kaumGesehenNichtVerkauft: feld(false, false) },
    stufen: stufen(ebay.map((p) => p.impressionen_90d), grenze90),
  };
}
