// The dashboard (section "Day by day" on the page Results): what each phase of the ladder brought, measured against the control group over the same days.
// Pure calculation without a database. The server delivers the starts and evaluations from leiter_verlauf, the control group from
// leiter and the daily values from traffic_tag (pm.db); from these this file calculates for every phase:
//   - status: geplant (planned, no start yet) / laeuft (running, waiting time not completely in the data yet) / fertig (done)
//   - net effect on impressions and views, with the same formula and the same windows as leiter.werteAus:
//     before = average per day in the 30 days before the start, after = average per day since the start (without the
//     start day itself), control = control listings whose control time covers the whole waiting time (as in leiter.kontrollGruppe)
//   - click rate (views ÷ impressions) and sales as a safety figure, per group
//   - how many listings became better / worse individually (so that no outlier alone carries the result)
//   - a daily curve per group, indexed to 100 = average of the 7 days before the start, aligned per listing at its own
//     start day (listings start on different days)
// eBay data only (Niko, 20 Nov 2026), no costs, fees or revenue.
import { netto } from "./auswertung.mjs";
import { EINSTELLUNGEN } from "./regeln.mjs";

export const PHASEN = ["titel", "werbung", "preis"];
export const BASIS_TAGE = 30;   // as in leiter.mjs: the comparison value is the 30 days before the start
export const KURVE_VORHER = 7;  // so many days before the start the curve shows (and the 100 comes from them)
export const SCHWELLE_EINZELN = 0.1; // a single listing counts as better / worse from ±10 %, in between "about equal"

const plusTage = (t, n) => new Date(Date.parse(t + "T12:00:00Z") + n * 864e5).toISOString().slice(0, 10);
const tageZwischen = (von, bis) => Math.round((Date.parse(bis + "T12:00:00Z") - Date.parse(von + "T12:00:00Z")) / 864e5);
const pruefTage = (stufe, einst) => ({ titel: einst.leiterTageTitel, werbung: einst.leiterTageWerbung, preis: einst.leiterTagePreis })[stufe];
const kontrollTage = (einst) => einst.leiterTageTitel + einst.leiterTageWerbung + einst.leiterTagePreis;
const leer = () => ({ imp: 0, auf: 0, trans: 0 });
const plus = (a, b) => ({ imp: a.imp + b.imp, auf: a.auf + b.auf, trans: a.trans + b.trans });
const mal = (a, f) => ({ imp: a.imp * f, auf: a.auf * f, trans: a.trans * f });

// Sum of the daily values of a listing for the days after "von" up to and including "bis" (like impTag in the server)
function summe(tage, nummer, von, bis) {
  const je = tage.get(nummer), aus = leer();
  if (!je || bis <= von) return aus;
  for (let d = plusTage(von, 1); d <= bis; d = plusTage(d, 1)) { const w = je.get(d); if (w) { aus.imp += w.imp || 0; aus.auf += w.auf || 0; aus.trans += w.trans || 0; } }
  return aus;
}
const tagWert = (tage, nummer, d) => tage.get(nummer)?.get(d) ?? null;

// One phase: all listings with a start of this step (the latest per listing counts)
function phase(stufe, { starts, auswertungen, kontrolle, tage, trafficBis, einst }) {
  const n = pruefTage(stufe, einst);
  const jeAngebot = new Map();
  for (const s of starts.filter((x) => x.stufe === stufe)) if (!jeAngebot.has(s.number) || jeAngebot.get(s.number).tag < s.tag) jeAngebot.set(s.number, s);
  const liste = [...jeAngebot.values()];
  const basis = { stufe, tage: n, angebote: liste.length };
  if (!liste.length) return { ...basis, status: "geplant" };

  let test = { vorher: leer(), nachher: leer() }, ctrl = { vorher: leer(), nachher: leer() };
  let mitDaten = 0, mitKontrolle = 0, besser = 0, schlechter = 0, gelaufenMax = 0, alleFertig = true;
  const kontrollNummern = new Set();
  const kurve = new Map(); // relative day → { t, k, nt, nk }
  for (const a of liste) {
    const ende = plusTage(a.tag, n);
    if (!trafficBis || trafficBis < ende) alleFertig = false;
    const bis = trafficBis && trafficBis < ende ? trafficBis : ende;
    const gelaufen = trafficBis ? Math.max(0, tageZwischen(a.tag, bis)) : 0;
    gelaufenMax = Math.max(gelaufenMax, gelaufen);
    const gruppe = kontrolle.filter((k) => k.start <= a.tag && plusTage(k.start, kontrollTage(einst)) >= ende).map((k) => k.number);
    gruppe.forEach((k) => kontrollNummern.add(k));
    // Curve: 7 days before the start and every day since the start, as far as data exists
    for (let r = -KURVE_VORHER; r <= gelaufen; r++) {
      if (r === 0) continue; // the start day counts nowhere (as in the windows)
      const d = plusTage(a.tag, r);
      if (trafficBis && d > trafficBis) continue;
      const p = kurve.get(r) || { t: 0, k: 0, nt: 0, nk: 0 };
      p.t += tagWert(tage, a.number, d)?.imp || 0; p.nt++;
      if (gruppe.length) { p.k += gruppe.reduce((x, k) => x + (tagWert(tage, k, d)?.imp || 0), 0) / gruppe.length; p.nk++; }
      kurve.set(r, p);
    }
    if (gelaufen <= 0) continue;
    mitDaten++;
    const v = mal(summe(tage, a.number, plusTage(a.tag, -BASIS_TAGE - 1), plusTage(a.tag, -1)), 1 / BASIS_TAGE);
    const w = mal(summe(tage, a.number, a.tag, bis), 1 / gelaufen);
    test = { vorher: plus(test.vorher, v), nachher: plus(test.nachher, w) };
    if (v.imp > 0) { const x = w.imp / v.imp - 1; if (x >= SCHWELLE_EINZELN) besser++; else if (x <= -SCHWELLE_EINZELN) schlechter++; }
    else if (w.imp > 0) besser++;
    if (!gruppe.length) continue;
    // Control: average per control listing over exactly the same days, weighted as large as one listing of the phase
    mitKontrolle++;
    const kv = gruppe.reduce((s, k) => plus(s, summe(tage, k, plusTage(a.tag, -BASIS_TAGE - 1), plusTage(a.tag, -1))), leer());
    const kw = gruppe.reduce((s, k) => plus(s, summe(tage, k, a.tag, bis)), leer());
    ctrl = { vorher: plus(ctrl.vorher, mal(kv, 1 / (BASIS_TAGE * gruppe.length))), nachher: plus(ctrl.nachher, mal(kw, 1 / (gelaufen * gruppe.length))) };
  }
  const nettoVon = (feld) => (mitKontrolle === mitDaten && mitDaten && ctrl.vorher[feld] > 0 ? netto({ vorher: test.vorher[feld], nachher: test.nachher[feld] }, { vorher: ctrl.vorher[feld], nachher: ctrl.nachher[feld] }) : null);
  // Per listing and day (this is how the tile "Impressions per listing / day" reads)
  const jeTag = (g) => (mitDaten ? mal(g, 1 / mitDaten) : leer());
  const tageReihe = [...kurve.keys()].sort((a, b) => a - b);
  const mittel = (r, f) => { const p = kurve.get(r); return p && p[f === "t" ? "nt" : "nk"] ? p[f] / p[f === "t" ? "nt" : "nk"] : null; };
  const basisVon = (f) => { const w = tageReihe.filter((r) => r < 0).map((r) => mittel(r, f)).filter((x) => x != null); return w.length ? w.reduce((a, b) => a + b, 0) / w.length : 0; };
  const bt = basisVon("t"), bk = basisVon("k");
  const verkaeufe = { test: 0, kontrolle: 0 };
  // Sales during the phase as a sum (safety figure): test group counted, control scaled up to the same number of listings
  for (const a of liste) {
    const ende = plusTage(a.tag, n), bis = trafficBis && trafficBis < ende ? trafficBis : ende;
    if (!trafficBis || bis <= a.tag) continue;
    verkaeufe.test += summe(tage, a.number, a.tag, bis).trans;
    const gruppe = kontrolle.filter((k) => k.start <= a.tag && plusTage(k.start, kontrollTage(einst)) >= ende).map((k) => k.number);
    if (gruppe.length) verkaeufe.kontrolle += gruppe.reduce((s, k) => s + summe(tage, k, a.tag, bis).trans, 0) / gruppe.length;
  }
  return {
    ...basis,
    status: alleFertig ? "fertig" : "laeuft",
    start: liste.map((a) => a.tag).sort()[0],
    gelaufen: Math.min(n, gelaufenMax),
    mitDaten, kontrolleAnzahl: kontrollNummern.size, ohneKontrolle: mitDaten - mitKontrolle,
    test: { vorher: jeTag(test.vorher), nachher: jeTag(test.nachher) },
    kontrolle: mitKontrolle ? { vorher: jeTag(ctrl.vorher), nachher: jeTag(ctrl.nachher) } : null,
    netto: { imp: nettoVon("imp"), auf: nettoVon("auf") },
    verkaeufe,
    besser, schlechter, gleich: mitDaten - besser - schlechter,
    erholt: auswertungen.filter((x) => x.stufe === stufe && x.erholt).length,
    kurve: tageReihe.map((r) => ({ tag: r, test: bt > 0 && mittel(r, "t") != null ? (100 * mittel(r, "t")) / bt : null, kontrolle: bk > 0 && mittel(r, "k") != null ? (100 * mittel(r, "k")) / bk : null })),
  };
}

// starts: [{ number, stufe, tag: "JJJJ-MM-TT", at, vonHand }] (leiter_verlauf, ereignis "gestartet")
// abbrueche: [{ number, at }]                                (leiter_verlauf, "abgebrochen" / "zurueckgesetzt": Take off, Start over)
// auswertungen: [{ number, stufe, erholt }]                  (leiter_verlauf, ereignis "ausgewertet")
// kontrolle: [{ number, start: "YYYY-MM-DD" }]               (ladder: control group, even if its time is already over)
// tage: Map(number → Map(date → { imp, auf, trans }))       (traffic_tag from pm.db)
export function baueDashboard({ starts: alleStarts = [], abbrueche = [], auswertungen = [], kontrolle = [], tage = new Map(), trafficBis = null, einst = EINSTELLUNGEN } = {}) {
  // A start no longer counts if the listing was taken off the ladder or reset afterwards
  const starts = alleStarts.filter((s) => !abbrueche.some((a) => a.number === s.number && (a.at ?? "") >= (s.at ?? s.tag)));
  const daten = { starts, auswertungen, kontrolle, tage, trafficBis, einst };
  const phasen = PHASEN.map((s) => phase(s, daten));
  return {
    trafficBis,
    einst: { besserAb: einst.besserAb, werbesatz: einst.werbesatz, preisSchritt: einst.preisSchritt },
    summe: {
      aufLeiter: new Set(starts.map((s) => s.number)).size,
      kontrolle: new Set(kontrolle.map((k) => k.number)).size,
      erholt: auswertungen.filter((x) => x.erholt).length,
      aenderungenEbay: starts.filter((s) => !s.vonHand).length,
    },
    phasen,
  };
}

// Which days and listings the server has to load from traffic_tag: from the earliest comparison window until today
export function benoetigt({ starts = [], kontrolle = [] }) {
  const nummern = new Set([...starts.map((s) => s.number), ...kontrolle.map((k) => k.number)]);
  const erster = starts.map((s) => s.tag).sort()[0];
  return { nummern: [...nummern], ab: erster ? plusTage(erster, -BASIS_TAGE - 1) : null };
}
