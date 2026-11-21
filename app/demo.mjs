// Demo: three example verdicts with INVENTED figures, calculated with the real verdict function and the real settings.
// A real verdict needs at least one waiting time (default 30 days) plus data delay. For the demo the app therefore shows
// what a verdict and the charts look like and how they are read. The examples are marked as examples in the interface,
// they touch no real tests.
import { urteile } from "./experimente.mjs";
import { baueAuswertung } from "./auswertung.mjs";

const g = (imp, auf, trans) => ({ imp, auf, trans });
const FAELLE = [
  { schluessel: "better", titel: "Example A: the new titles helped", test: { vorher: g(1200, 30, 4), nachher: g(2100, 52, 5) }, kontrolle: { vorher: g(1250, 31, 4), nachher: g(1300, 32, 4) } },
  { schluessel: "no_difference", titel: "Example B: no difference proven", test: { vorher: g(1180, 29, 4), nachher: g(1290, 31, 4) }, kontrolle: { vorher: g(1200, 30, 4), nachher: g(1280, 31, 4) } },
  { schluessel: "worse", titel: "Example C: impressions rose, but sales fell", test: { vorher: g(1200, 30, 6), nachher: g(2000, 50, 2) }, kontrolle: { vorher: g(1250, 31, 5), nachher: g(1300, 32, 5) } },
];

// Random numbers with a fixed start value: every call returns the same example listings
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// Distributes a sum into whole numbers by weights, so that the parts add up exactly to the sum (largest remainder)
function verteile(summe, gewichte) {
  const gesamt = gewichte.reduce((s, x) => s + x, 0);
  const teile = gewichte.map((w) => Math.floor((summe * w) / gesamt));
  let rest = summe - teile.reduce((s, x) => s + x, 0);
  const reihenfolge = gewichte.map((w, i) => [(summe * w) / gesamt - teile[i], i]).sort((a, b) => b[0] - a[0]);
  for (let k = 0; rest > 0; k = (k + 1) % reihenfolge.length, rest--) teile[reihenfolge[k][1]]++;
  return teile;
}

// Invented single listings whose sums match the figures of the example exactly: this way verdict and chart agree.
function angebote(gruppe, summen, rng, namensanfang) {
  const n = 20;
  const ausgang = Array.from({ length: n }, () => 0.4 + rng() * 1.6);           // listings of different size
  const schwankung = Array.from({ length: n }, () => 0.5 + rng() * 1.0);        // every listing develops a little differently
  const nachGewicht = ausgang.map((w, i) => w * schwankung[i]);
  const feld = (f) => [verteile(summen.vorher[f], ausgang), verteile(summen.nachher[f], nachGewicht)];
  const [iv, inn] = feld("imp"), [av, an] = feld("auf"), [tv, tn] = feld("trans");
  return Array.from({ length: n }, (_, i) => ({ number: `${namensanfang}${i + 1}`, gruppe, vorher: g(iv[i], av[i], tv[i]), nachher: g(inn[i], an[i], tn[i]) }));
}

export function baueDemo(einst) {
  return {
    beispiel: true,
    hinweis: "Invented numbers to show how a verdict looks. They are not from your shop and no real test is affected.",
    faelle: FAELLE.map(({ schluessel, titel, test, kontrolle }, i) => {
      const rng = mulberry32(1000 + i);
      const zeilen = [...angebote("test", test, rng, "T"), ...angebote("kontrolle", kontrolle, rng, "K")];
      return { schluessel, titel, urteil: urteile(test, kontrolle, einst), auswertung: baueAuswertung(zeilen, einst) };
    }),
  };
}
