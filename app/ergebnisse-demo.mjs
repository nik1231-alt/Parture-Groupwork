// Beispielansicht für die Seite Results: ERFUNDENE Angebote (zwei Läufe) mit erfundenen Tageswerten, durch dieselbe Rechnung wie die echten Ergebnisse geschickt.
// Ein echtes Ergebnis gibt es erst, wenn eine Prüfzeit (Standard 14 Tage) plus Datenverzug vorbei ist. Bis dahin zeigt die App damit,
// wie die Seite aussieht und gelesen wird. Die Zahlen sind in der Oberfläche als Beispiel gekennzeichnet und berühren keine echten Daten.
// Feste Startwerte: jeder Aufruf liefert dieselben Zahlen.
import { baueErgebnisse, PHASEN } from "./ergebnisse.mjs";
import { netto } from "./auswertung.mjs";

const TRAFFIC_BIS = "2026-11-10", START = "2026-08-03", GRENZE90 = 170, ANZAHL = 24, KONTROLLE = 20;
// Wirkung je Phase (Faktor auf die Impressionen) und Streuung zwischen den Angeboten: Titel kaum, Werbung deutlich, Preis kaum
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

  // Impressionen eines Tages: Grundwert × bisherige Wirkungen (in 4 Tagen eingeschwungen) × Wochentag × Zufall. Die Kontrollgruppe wächst leicht (3 %).
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

  // Zwei Starts: die ersten 14 Angebote am Anfang, die übrigen 10 eine Woche später
  const lauf = (i) => (i < 14 ? 0 : 7);
  let aktiv = listings.map((l, i) => ({ l, start: plusTage(START, lauf(i) + (i % 3)) }));
  for (const [stufe] of PHASEN) {
    const naechste = [];
    // Damit der Überblick auch laufende und wartende Angebote zeigt: in der Werbephase des ersten Starts laufen zwei noch, eines wartet auf Freigabe
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
