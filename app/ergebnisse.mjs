// Results (page "Results"): how did impressions change, and is the difference from the control group clear or chance?
// Pure calculation without a database: it receives the overview of the ladder (leiter.uebersicht) and returns finished figures for the page.
// A "run" is all listings that went onto the ladder on the same day (one start with a few products). Each run is evaluated on its own,
// plus "all runs". Per phase (title, ads, price): sum of impressions before and after, change of the control group
// and a verdict. The verdict says whether the effect of a typical listing is clearly different from zero: a 95 % range around the effect per listing.
// If the whole range lies above zero it is a clear increase; if it lies below, a clear decrease; otherwise it cannot be told apart from chance.
import { netto } from "./auswertung.mjs";

export const PHASEN = [["titel", "New title"], ["werbung", "Ads"], ["preis", "Lower price"]];
export const MIN_AUSGEWERTET = 5;  // so many listings with a control group does a phase need before it gets a verdict (otherwise "too_few")
export const ALLE = "alle";

const endlich = (x) => (Number.isFinite(x) ? x : null);
const aenderung = (vorher, nachher) => (vorher > 0 ? endlich(nachher / vorher - 1) : null);
const istKontrolle = (a) => a.stufe === "kontrolle" || a.ergebnis === "kontrolle";

// Critical value of the t distribution (two-sided, 95 %) by degrees of freedom; from 30 on the normal distribution applies (1.96)
const T95 = [12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.160, 2.145, 2.131, 2.120, 2.110, 2.101, 2.093, 2.086, 2.080, 2.074, 2.069, 2.064, 2.060, 2.056, 2.052, 2.048, 2.045, 2.042];
export const tKritisch = (freiheitsgrade) => (freiheitsgrade < 1 ? null : freiheitsgrade <= 30 ? T95[freiheitsgrade - 1] : 1.96);

// Typical effect per listing against the control group with a 95 % range. It is calculated with the logarithm of the ratio (+50 % and −33 %
// cancel out, as one would expect); a listing with 0 impressions afterwards counts as −99 %.
export function schaetze(nettos) {
  const w = nettos.filter((x) => Number.isFinite(x)).map((x) => Math.log(1 + Math.max(x, -0.99)));
  if (w.length < 2) return null;
  const m = w.reduce((a, b) => a + b, 0) / w.length;
  const sd = Math.sqrt(w.reduce((a, b) => a + (b - m) ** 2, 0) / (w.length - 1));
  const abstand = tKritisch(w.length - 1) * (sd / Math.sqrt(w.length));
  return { effekt: Math.exp(m) - 1, von: Math.exp(m - abstand) - 1, bis: Math.exp(m + abstand) - 1, n: w.length };
}

// "up" and "down": the whole 95 % range lies above or below zero. Otherwise "unclear". Too few listings: "too_few".
export function urteil(schaetzung, anzahl) {
  if (!schaetzung || anzahl < MIN_AUSGEWERTET) return "too_few";
  if (schaetzung.von > 0) return "up";
  if (schaetzung.bis < 0) return "down";
  return "unclear";
}

function phase(angebote, stufe, name) {
  const aus = [];
  for (const a of angebote) for (const v of a.verlauf || []) if (v.ereignis === "ausgewertet" && v.stufe === stufe && v.details) aus.push(v.details);
  const mit = aus.filter((d) => d.kontrolle);
  const s = mit.reduce((t, d) => ({ v: t.v + d.vorher90, n: t.n + d.nachher90, kv: t.kv + d.kontrolle.vorher90, kn: t.kn + d.kontrolle.nachher90 }), { v: 0, n: 0, kv: 0, kn: 0 });
  const schaetzung = schaetze(mit.map((d) => d.netto));
  const laufend = angebote.filter((a) => a.phase === "laeuft" && a.stufe === stufe);
  return {
    schluessel: stufe, name, ausgewertet: aus.length, mitKontrolle: mit.length, erholt: aus.filter((d) => d.erholt).length,
    // ended before the waiting time was complete (F2): count and the shortest measurement
    fremd: aus.filter((d) => d.fremdSeit).length, // F6: evaluations of listings that were changed outside the app
    vorzeitig: aus.filter((d) => d.vorzeitig).length, kuerzesteTage: aus.filter((d) => d.vorzeitig && Number.isFinite(d.gemessenTage)).reduce((m, d) => (m == null ? d.gemessenTage : Math.min(m, d.gemessenTage)), null),
    vorher90: s.v, nachher90: s.n, aenderung: mit.length ? aenderung(s.v, s.n) : null, kontrolleAenderung: mit.length ? aenderung(s.kv, s.kn) : null,
    netto: mit.length ? netto({ vorher: s.v, nachher: s.n }, { vorher: s.kv, nachher: s.kn }) : null,
    schaetzung, urteil: urteil(schaetzung, mit.length),
    laeuft: laufend.length, naechstesEnde: laufend.map((a) => a.stand?.ende).filter(Boolean).sort()[0] ?? null,
    zwischenstand: zwischenstand(laufend),
  };
}

// Interim (live) for the listings still in their waiting time: the same figures as a finished phase, but only over the days that are in
// the data so far (leiter.uebersicht → stand). Before the first day after the start there are only the real "before" figures.
// It is never a result: the verdict uses the same rule, but the page shows it as interim.
export function zwischenstand(laufend) {
  if (!laufend.length) return null;
  const mitDaten = laufend.filter((a) => a.stand?.gelaufen > 0 && a.stand.jetzt90 != null);
  const mit = mitDaten.filter((a) => a.stand.kontrolle);
  const basis = mitDaten.length ? mitDaten : laufend;
  const s = mit.reduce((t, a) => ({ v: t.v + a.stand.vorher90, n: t.n + a.stand.jetzt90, kv: t.kv + a.stand.kontrolle.vorher90, kn: t.kn + a.stand.kontrolle.nachher90 }), { v: 0, n: 0, kv: 0, kn: 0 });
  const schaetzung = schaetze(mit.map((a) => a.stand.netto));
  return {
    anzahl: laufend.length, mitDaten: mitDaten.length, mitKontrolle: mit.length,
    gelaufen: Math.max(0, ...laufend.map((a) => a.stand?.gelaufen ?? 0)), tage: Math.max(0, ...laufend.map((a) => a.stand?.tage ?? 0)),
    vorher90: basis.reduce((t, a) => t + (a.stand?.vorher90 ?? 0), 0), nachher90: mitDaten.length ? mitDaten.reduce((t, a) => t + a.stand.jetzt90, 0) : null,
    aenderung: mit.length ? aenderung(s.v, s.n) : null, kontrolleAenderung: mit.length ? aenderung(s.kv, s.kn) : null,
    netto: mit.length ? netto({ vorher: s.v, nachher: s.n }, { vorher: s.kv, nachher: s.kn }) : null,
    schaetzung, urteil: urteil(schaetzung, mit.length),
  };
}

// Where did the listings end up? Per phase: how many arrived there and what became of them: seen again (left the ladder),
// passed on, still in the waiting time, waiting for approval, skipped without a measurement (e.g. already advertised) or taken off by hand.
// After the last phase comes the manual check by an admin (waiting or decided).
const ENTSCHEIDUNGEN = ["behalten", "ueberarbeiten", "offline"];
export function fluss(angebote) {
  const stufen = PHASEN.map(([schluessel, name]) => ({ schluessel, name, erreicht: 0, erholt: 0, weiter: 0, laeuft: 0, wartet: 0, uebersprungen: 0, entfernt: 0 }));
  const pruefung = { erreicht: 0, offen: 0, behalten: 0, ueberarbeiten: 0, offline: 0 };
  for (const a of angebote) {
    const ev = (st) => (a.verlauf || []).filter((v) => v.stufe === st);
    stufen.forEach((z) => {
      const e = ev(z.schluessel), jetzt = a.stufe === z.schluessel;
      if (!e.length && !jetzt) return;
      z.erreicht++;
      const aus = e.find((v) => v.ereignis === "ausgewertet");
      if (aus) { if (aus.details?.erholt) z.erholt++; else z.weiter++; }
      else if (e.some((v) => v.ereignis === "uebersprungen")) z.uebersprungen++;
      else if (jetzt && a.phase === "laeuft") z.laeuft++;
      else if (jetzt) z.wartet++;
      else z.entfernt++;
    });
    if (ev("pruefung").length || a.stufe === "pruefung") {
      pruefung.erreicht++;
      if (ENTSCHEIDUNGEN.includes(a.ergebnis)) pruefung[a.ergebnis]++; else if (a.stufe === "pruefung") pruefung.offen++;
    }
  }
  return { stufen, pruefung };
}

// Balance at the draw (F5): impressions per 90 days of the test and the control listings in the 30 days before the day they were
// drawn, from the daily traffic (impTag as in the server), so it works for draws made before the paired lot too. null without impTag.
const plusTage = (t, n) => new Date(Date.parse(t + "T12:00:00Z") + n * 864e5).toISOString().slice(0, 10);
export function ausgleich(test, kontrolle, impTag) {
  if (typeof impTag !== "function" || !test.length || !kontrolle.length) return null;
  const summe = (liste) => Math.round(liste.reduce((s, a) => { const tag = String(a.eingestiegen_at).slice(0, 10); return s + (Number(impTag(a.number, plusTage(tag, -31), plusTage(tag, -1))) || 0) * 90; }, 0));
  return { test: summe(test), kontrolle: summe(kontrolle), nTest: test.length, nKontrolle: kontrolle.length };
}

const lauf = (schluessel, name, angebote, balance = null) => ({
  schluessel, name, angebote: angebote.filter((a) => !istKontrolle(a)).length,
  fluss: fluss(angebote.filter((a) => !istKontrolle(a))),
  phasen: PHASEN.map(([s, n]) => phase(angebote, s, n)),
  ausgleich: balance,
});

// u = result of leiter.uebersicht. One run per day on which listings went onto the ladder (newest first), preceded by "all runs".
export function baueErgebnisse(u, { besserAb = 0.2, impTag = null } = {}) {
  const getestet = u.angebote.filter((a) => !istKontrolle(a)), kontrollen = u.angebote.filter(istKontrolle);
  const tag = (a) => String(a.eingestiegen_at).slice(0, 10);
  const tage = [...new Set(getestet.map(tag))].sort().reverse();
  const laeufe = [lauf(ALLE, "All runs", u.angebote, ausgleich(getestet, kontrollen, impTag)),
    ...tage.map((t) => lauf(t, t, getestet.filter((a) => tag(a) === t), ausgleich(getestet.filter((a) => tag(a) === t), kontrollen.filter((a) => tag(a) === t), impTag)))];
  // The control group belongs to no run; its figures are inside the evaluations of the listings
  return {
    laeufe, kontrollgruppe: u.angebote.length - getestet.length, trafficBis: u.trafficBis ?? null,
    skala: { besserAb, mindestAusgewertet: MIN_AUSGEWERTET }, leer: laeufe[0].phasen.every((p) => p.ausgewertet === 0),
    // live: at least one phase is in its waiting time, so the page shows the interim with real figures instead of the example
    live: laeufe[0].phasen.some((p) => p.zwischenstand),
  };
}
