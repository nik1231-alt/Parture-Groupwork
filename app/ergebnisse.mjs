// Ergebnisse (Seite Results): was jede Phase der Leiter (Titel, Werbung, Preis) an Impressionen gebracht hat, gemessen gegen die Kontrollgruppe.
// Reine Rechnung ohne Datenbank: sie bekommt die Übersicht der Leiter (leiter.uebersicht) und eine Funktion für Tageswerte und liefert
// fertige Zahlen für die Diagramme. Gerechnet wird mit denselben Formeln wie leiter.wirkung und auswertung.netto, damit die Zahlen auf
// der Seite Funnel und auf der Seite Results nie voneinander abweichen.
//
// Aufbau je Phase: wie viele Angebote ausgewertet sind, Summen vorher/nachher (je 90 Tage hochgerechnet) für Angebote und Kontrollgruppe,
// Nettoeffekt, jedes Angebot einzeln (damit ein Ausreißer nichts entscheidet) und der Verlauf über die Tage als Index (100 = Schnitt der 30 Tage davor).
import { netto, median } from "./auswertung.mjs";

export const PHASEN = [["titel", "New title"], ["werbung", "Ads"], ["preis", "Lower price"]];
export const MIN_AUSGEWERTET = 5;  // so viele ausgewertete Angebote braucht eine Phase, bevor sie ein Urteil bekommt (sonst "too few")
export const VORLAUF_TAGE = 30;    // Tage vor dem Start einer Phase, die im Verlauf gezeigt werden (gleich dem Vergleichswert der Leiter)
export const GLAETTUNG_TAGE = 7;   // Verlauf: gleitender Durchschnitt über so viele Tage, sonst springt die Linie mit dem Wochentag

const plusTage = (t, n) => new Date(Date.parse(t + "T12:00:00Z") + n * 864e5).toISOString().slice(0, 10);
const endlich = (x) => (Number.isFinite(x) ? x : null);
const aenderung = (vorher, nachher) => (vorher > 0 ? endlich(nachher / vorher - 1) : null);

// "better" ab +besserAb (Standard 20 %), "worse" ab −besserAb, dazwischen "no_difference". Zu wenige Angebote oder keine Kontrolle: "too_few".
export function urteil(nettoEffekt, anzahl, besserAb) {
  if (nettoEffekt == null || anzahl < MIN_AUSGEWERTET) return "too_few";
  if (nettoEffekt >= besserAb) return "better";
  if (nettoEffekt <= -besserAb) return "worse";
  return "no_difference";
}

// Alle Auswertungen einer Phase aus dem Lebenslauf der Angebote
function auswertungen(angebote, stufe) {
  const aus = [];
  for (const a of angebote) {
    for (const v of a.verlauf || []) {
      if (v.ereignis !== "ausgewertet" || v.stufe !== stufe || !v.details) continue;
      aus.push({ number: a.number, title: a.title ?? null, at: v.at, ...v.details });
    }
  }
  return aus;
}

function phase(angebote, stufe, name, tage, besserAb) {
  const aus = auswertungen(angebote, stufe);
  const mit = aus.filter((d) => d.kontrolle);
  const s = mit.reduce((t, d) => ({ v: t.v + d.vorher90, n: t.n + d.nachher90, kv: t.kv + d.kontrolle.vorher90, kn: t.kn + d.kontrolle.nachher90 }), { v: 0, n: 0, kv: 0, kn: 0 });
  const nettoEffekt = mit.length ? netto({ vorher: s.v, nachher: s.n }, { vorher: s.kv, nachher: s.kn }) : null;
  const punkte = aus.map((d) => ({ number: d.number, title: d.title, vorher90: d.vorher90, nachher90: d.nachher90, aenderung: aenderung(d.vorher90, d.nachher90), netto: endlich(d.netto), erholt: !!d.erholt }));
  const nettos = punkte.map((p) => p.netto).filter((x) => x != null);
  const laufend = angebote.filter((a) => a.phase === "laeuft" && a.stufe === stufe);
  const enden = laufend.map((a) => a.stand?.ende).filter(Boolean).sort();
  return {
    schluessel: stufe, name, tage,
    ausgewertet: aus.length, mitKontrolle: mit.length, erholt: aus.filter((d) => d.erholt).length,
    vorher90: s.v, nachher90: s.n, kontrolleVorher90: s.kv, kontrolleNachher90: s.kn,
    aenderung: mit.length ? aenderung(s.v, s.n) : null,
    kontrolleAenderung: mit.length ? aenderung(s.kv, s.kn) : null,
    netto: nettoEffekt, median: median(nettos), anteilBesser: nettos.length ? nettos.filter((x) => x > 0).length / nettos.length : null,
    urteil: urteil(nettoEffekt, mit.length, besserAb), punkte,
    laeuft: laufend.length, naechstesEnde: enden[0] ?? null,
  };
}

// Verlauf einer Phase: Impressionen je Tag der Angebote dieser Phase gegen die Kontrollgruppe, auf denselben Kalendertagen, als Index.
// starts: [{ number, start }] (start = Tag, an dem die Phase für das Angebot begann). tageswerte(nummer, von, bis) liefert { "JJJJ-MM-TT": Impressionen }.
// bis = letzter Tag mit vollständigen Daten, ab = erster Tag, für den es überhaupt Daten gibt. Tage ohne Daten bleiben leer (null).
export function baueVerlauf(starts, kontrollNummern, tage, tageswerte, { bis, ab = null }) {
  if (!starts.length || !kontrollNummern.length || !bis) return null;
  const ersterStart = starts.map((s) => s.start).sort()[0], letzterStart = starts.map((s) => s.start).sort().at(-1);
  const von = plusTage(ersterStart, -VORLAUF_TAGE), bisTag = plusTage(letzterStart, tage);
  const zwischen = (n) => tageswerte(n, von, bisTag);
  const kont = kontrollNummern.map(zwischen), eigen = new Map(starts.map((s) => [s.number, zwischen(s.number)]));
  const da = (datum) => datum <= bis && (!ab || datum >= ab);
  const mittel = (liste) => (liste.length ? liste.reduce((a, b) => a + b, 0) / liste.length : null);
  const kontrolleAm = (datum) => (da(datum) ? mittel(kont.map((k) => k[datum] ?? 0)) : null);
  const tageListe = Array.from({ length: VORLAUF_TAGE + tage + 1 }, (_, i) => i - VORLAUF_TAGE);
  const roh = { test: [], kontrolle: [] };
  for (const d of tageListe) {
    const t = [], k = [];
    for (const s of starts) {
      const datum = plusTage(s.start, d);
      if (!da(datum)) continue;
      t.push(eigen.get(s.number)[datum] ?? 0);
      k.push(kontrolleAm(datum));
    }
    roh.test.push(mittel(t)); roh.kontrolle.push(mittel(k.filter((x) => x != null)));
  }
  // gleitender Durchschnitt (nur über vorhandene Werte), dann Index gegen den Schnitt der Tage vor dem Start
  const glatt = (reihe) => reihe.map((w, i) => { if (w == null) return null; const f = reihe.slice(Math.max(0, i - GLAETTUNG_TAGE + 1), i + 1).filter((x) => x != null); return f.length >= Math.ceil(GLAETTUNG_TAGE / 2) ? mittel(f) : null; });
  const index = (reihe) => {
    const basis = mittel(reihe.filter((x, i) => tageListe[i] < 0 && x != null));
    return basis > 0 ? glatt(reihe).map((x) => (x == null ? null : Math.round((x / basis) * 1000) / 10)) : null;
  };
  const test = index(roh.test), kontrolle = index(roh.kontrolle);
  if (!test || !kontrolle || test.every((x) => x == null)) return null;
  return { tage: tageListe, test, kontrolle, angebote: starts.length, kontrollgruppe: kontrollNummern.length, phasenTage: tage };
}

// u = Ergebnis von leiter.uebersicht. tageswerte und bis/ab: siehe baueVerlauf. besserAb kommt aus den Einstellungen.
export function baueErgebnisse(u, tageswerte, { besserAb = 0.2, bis = null, ab = null } = {}) {
  const phasen = PHASEN.map(([s, name]) => phase(u.angebote, s, name, u.tage?.[s] ?? 0, besserAb));
  const kontrolle = u.angebote.filter((a) => a.stufe === "kontrolle" || a.ergebnis === "kontrolle").map((a) => a.number);
  for (const p of phasen) {
    const starts = u.angebote.flatMap((a) => (a.verlauf || []).filter((v) => v.ereignis === "gestartet" && v.stufe === p.schluessel).map((v) => ({ number: a.number, start: String(v.at).slice(0, 10) })));
    p.verlauf = tageswerte ? baueVerlauf(starts, kontrolle, p.tage, tageswerte, { bis, ab }) : null;
  }
  // Phasen nacheinander: jede misst gegen den Stand direkt davor, die Wirkungen vervielfachen sich also (nur Phasen mit Urteil zählen)
  const zaehlt = phasen.filter((p) => p.urteil !== "too_few");
  const kombiniert = zaehlt.length ? zaehlt.reduce((x, p) => x * (1 + p.netto), 1) - 1 : null;
  const ausgewertet = phasen.reduce((s, p) => s + p.ausgewertet, 0);
  return {
    phasen, kombiniert, ausgewertet, erholt: phasen.reduce((s, p) => s + p.erholt, 0), laeuft: phasen.reduce((s, p) => s + p.laeuft, 0),
    kontrollgruppe: kontrolle.length, trafficBis: u.trafficBis ?? null,
    skala: { besserAb, mindestAusgewertet: MIN_AUSGEWERTET }, leer: ausgewertet === 0,
  };
}
