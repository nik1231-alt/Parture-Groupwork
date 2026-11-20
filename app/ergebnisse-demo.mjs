// Example view for the page Results: INVENTED listings (two runs) with invented daily values, sent through the same calculation as the real results.
// A real result exists only once a waiting time (default 14 days) plus data delay has passed. Until then the app uses this to show
// what the page looks like and how it is read. The figures are marked as an example in the interface and touch no real data.
// Feste Startwerte: jeder Aufruf liefert dieselben Zahlen.
import { baueErgebnisse, PHASEN } from "./ergebnisse.mjs";
import { netto } from "./auswertung.mjs";

const TRAFFIC_BIS = "2026-11-10", START = "2026-08-03", GRENZE90 = 170, ANZAHL = 24, KONTROLLE = 20;
// Effect per phase (factor on the impressions) and spread between the listings: title hardly, ads clearly, price hardly
const WIRKUNG = { titel: [0.99, 0.5], werbung: [1.4, 0.5], preis: [0.8, 0.5] };

function mulberry32(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const hash = (s) => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
const plusTage = (t, n) => new Date(Date.parse(t + "T12:00:00Z") + n * 864e5).toISOString().slice(0, 10);
const tageZwischen = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);

export function baueDemoErgebnisse(einst) {
  const tage = { titel: einst.leiterTageTitel, werbung: einst.leiterTageWerbung, preis: einst.leiterTagePreis };
  const rng = mulberry32(20261120);
  const listings = Array.from({ length: ANZAHL }, (_, i) => ({ number: "D" + String(i + 1).padStart(2, "0"), basis: 0.7 + 1.6 * rng(), schritte: [], verlauf: [], stufe: "titel", ergebnis: null }));
  const kontrolle = Array.from({ length: KONTROLLE }, (_, i) => "K" + String(i + 1).padStart(2, "0"));
  const nr = new Map(listings.map((l) => [l.number, l]));

  // Impressions of one day: base value × effects so far (settled within 4 days) × weekday × chance. The control group grows slightly (3 %).
  const tagWert = (n, datum) => {
    const l = nr.get(n);
    let f = 1;
    if (l) { for (const s of l.schritte) if (datum >= s.start) f *= 1 + (s.faktor - 1) * Math.min(1, (tageZwischen(s.start, datum) + 1) / 4); }
    else f *= 1 + 0.03 * Math.max(0, tageZwischen(START, datum)) / 100;
    const wochentag = 1 + 0.12 * Math.sin((2 * Math.PI * (Date.parse(datum) / 864e5)) / 7);
    const zufall = 0.85 + 0.3 * mulberry32(hash(n + datum))();
    return (l ? l.basis : 1.5) * f * wochentag * zufall;
  };
    const summe90 = (n, von, bis) => { let s = 0, k = 0; for (let d = von; d <= bis; d = plusTage(d, 1)) { s += tagWert(n, d); k++; } return Math.round((s / k) * 90); };
  const gruppe90 = (von, bis) => kontrolle.reduce((s, n) => s + summe90(n, von, bis), 0);

  // Two starts: the first 14 listings at the beginning, the other 10 one week later
  const lauf = (i) => (i < 14 ? 0 : 7);
  let aktiv = listings.map((l, i) => ({ l, start: plusTage(START, lauf(i) + (i % 3)) }));
  for (const [stufe] of PHASEN) {
    const naechste = [];
    // So that the overview also shows running and waiting listings: in the ads phase of the first start two are still running, one waits for approval
    const halt = new Map();
    if (stufe === "werbung") aktiv.filter((x) => listings.indexOf(x.l) < 14).slice(-3).forEach((x, k) => halt.set(x.l.number, k < 2 ? "laeuft" : "vorschlag"));
    for (const { l, start } of aktiv) {
      if (halt.has(l.number)) { l.stufe = "werbung"; l.phase = halt.get(l.number); if (l.phase === "laeuft") l.verlauf.push({ stufe, ereignis: "gestartet", at: start + "T06:00:00.000Z", details: { vonHand: false } }); else l.verlauf.push({ stufe, ereignis: "vorschlag", at: start + "T06:00:00.000Z", details: null }); continue; }
      const [mitte, streu] = WIRKUNG[stufe];
      l.schritte.push({ start, faktor: mitte + streu * (rng() - 0.5) });
      const ende = plusTage(start, tage[stufe]);
      const vorher90 = summe90(l.number, plusTage(start, -30), plusTage(start, -1)), nachher90 = summe90(l.number, start, ende);
      const k = { anzahl: KONTROLLE, vorher90: gruppe90(plusTage(start, -30), plusTage(start, -1)), nachher90: gruppe90(start, ende) };
      const erholt = nachher90 >= GRENZE90;
      l.verlauf.push({ stufe, ereignis: "gestartet", at: start + "T06:00:00.000Z", details: { vonHand: false } });
      l.verlauf.push({ stufe, ereignis: "ausgewertet", at: ende + "T06:00:00.000Z", details: { tage: tage[stufe], vorher90, nachher90, grenze90: GRENZE90, erholt, kontrolle: k, netto: netto({ vorher: vorher90, nachher: nachher90 }, { vorher: k.vorher90, nachher: k.nachher90 }) } });
      if (erholt) { l.stufe = "raus"; l.ergebnis = "erholt"; } else { l.stufe = stufe === "preis" ? "pruefung" : PHASEN[PHASEN.findIndex(([s]) => s === stufe) + 1][0]; naechste.push({ l, start: ende }); }
    }
    aktiv = naechste;
  }
  const angebote = [
    ...listings.map((l, i) => ({ number: l.number, title: "Example listing " + l.number, stufe: l.stufe, phase: l.phase ?? (l.stufe === "pruefung" ? "offen" : "fertig"), ergebnis: l.ergebnis, eingestiegen_at: plusTage(START, lauf(i)) + "T06:00:00.000Z", verlauf: l.verlauf })),
    ...kontrolle.map((n) => ({ number: n, title: "Example control " + n, stufe: "kontrolle", phase: "laeuft", ergebnis: null, eingestiegen_at: START + "T06:00:00.000Z", verlauf: [] })),
  ];
  const u = { angebote, tage, trafficBis: TRAFFIC_BIS };
  return { ...baueErgebnisse(u, { besserAb: einst.besserAb }), beispiel: true };
}
