// Ergebnisse (Seite Results): wie haben sich die Impressionen verändert, und ist der Unterschied zur Kontrollgruppe klar oder Zufall?
// Reine Rechnung ohne Datenbank: sie bekommt die Übersicht der Leiter (leiter.uebersicht) und liefert fertige Zahlen für die Seite.
// Ein "Lauf" sind alle Angebote, die am selben Tag auf die Leiter kamen (ein Start mit ein paar Produkten). Jeder Lauf wird für sich
// ausgewertet, dazu gibt es "alle Läufe". Je Phase (Titel, Werbung, Preis): Summe der Impressionen vorher und nachher, Veränderung der Kontrollgruppe
// und ein Urteil. Das Urteil sagt, ob der Effekt eines typischen Angebots klar von null verschieden ist: ein 95-%-Bereich um den Effekt je Angebot.
// Liegt der ganze Bereich über null, ist es ein klarer Anstieg; liegt er darunter, ein klarer Rückgang; sonst ist es nicht von Zufall zu unterscheiden.
import { netto } from "./auswertung.mjs";

export const PHASEN = [["titel", "New title"], ["werbung", "Ads"], ["preis", "Lower price"]];
export const MIN_AUSGEWERTET = 5;  // so viele Angebote mit Kontrollgruppe braucht eine Phase, bevor sie ein Urteil bekommt (sonst "too_few")
export const ALLE = "alle";

const endlich = (x) => (Number.isFinite(x) ? x : null);
const aenderung = (vorher, nachher) => (vorher > 0 ? endlich(nachher / vorher - 1) : null);
const istKontrolle = (a) => a.stufe === "kontrolle" || a.ergebnis === "kontrolle";

// Kritischer Wert der t-Verteilung (zweiseitig, 95 %) nach Freiheitsgraden; ab 30 gilt die Normalverteilung (1,96)
const T95 = [12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.160, 2.145, 2.131, 2.120, 2.110, 2.101, 2.093, 2.086, 2.080, 2.074, 2.069, 2.064, 2.060, 2.056, 2.052, 2.048, 2.045, 2.042];
export const tKritisch = (freiheitsgrade) => (freiheitsgrade < 1 ? null : freiheitsgrade <= 30 ? T95[freiheitsgrade - 1] : 1.96);

// Typischer Effekt je Angebot gegen die Kontrollgruppe mit 95-%-Bereich. Gerechnet wird mit dem Logarithmus des Verhältnisses (+50 % und −33 %
// heben sich so auf, wie man es erwartet); ein Angebot mit 0 Impressionen nachher zählt mit −99 %.
export function schaetze(nettos) {
  const w = nettos.filter((x) => Number.isFinite(x)).map((x) => Math.log(1 + Math.max(x, -0.99)));
  if (w.length < 2) return null;
  const m = w.reduce((a, b) => a + b, 0) / w.length;
  const sd = Math.sqrt(w.reduce((a, b) => a + (b - m) ** 2, 0) / (w.length - 1));
  const abstand = tKritisch(w.length - 1) * (sd / Math.sqrt(w.length));
  return { effekt: Math.exp(m) - 1, von: Math.exp(m - abstand) - 1, bis: Math.exp(m + abstand) - 1, n: w.length };
}

// "up" und "down": der ganze 95-%-Bereich liegt über bzw. unter null. Sonst "unclear". Zu wenige Angebote: "too_few".
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
    vorher90: s.v, nachher90: s.n, aenderung: mit.length ? aenderung(s.v, s.n) : null, kontrolleAenderung: mit.length ? aenderung(s.kv, s.kn) : null,
    netto: mit.length ? netto({ vorher: s.v, nachher: s.n }, { vorher: s.kv, nachher: s.kn }) : null,
    schaetzung, urteil: urteil(schaetzung, mit.length),
    laeuft: laufend.length, naechstesEnde: laufend.map((a) => a.stand?.ende).filter(Boolean).sort()[0] ?? null,
  };
}

// Wohin sind die Angebote gekommen? Je Phase: wie viele sind dort angekommen und was ist aus ihnen geworden: wieder gesehen (raus aus der Leiter),
// weitergereicht, noch in der Prüfzeit, wartet auf Freigabe, ohne Messung übersprungen (z. B. schon beworben) oder von Hand herausgenommen.
// Nach der letzten Phase folgt die manuelle Prüfung durch einen Admin (wartet oder entschieden).
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

const lauf = (schluessel, name, angebote) => ({
  schluessel, name, angebote: angebote.filter((a) => !istKontrolle(a)).length,
  fluss: fluss(angebote.filter((a) => !istKontrolle(a))),
  phasen: PHASEN.map(([s, n]) => phase(angebote, s, n)),
});

// u = Ergebnis von leiter.uebersicht. Ein Lauf je Tag, an dem Angebote auf die Leiter kamen (neueste zuerst), davor "alle Läufe".
export function baueErgebnisse(u, { besserAb = 0.2 } = {}) {
  const getestet = u.angebote.filter((a) => !istKontrolle(a));
  const tage = [...new Set(getestet.map((a) => String(a.eingestiegen_at).slice(0, 10)))].sort().reverse();
  const laeufe = [lauf(ALLE, "All runs", u.angebote), ...tage.map((t) => lauf(t, t, getestet.filter((a) => String(a.eingestiegen_at).slice(0, 10) === t)))];
  // Die Kontrollgruppe gehört zu keinem Lauf, ihre Zahlen stecken in den Auswertungen der Angebote
  return {
    laeufe, kontrollgruppe: u.angebote.length - getestet.length, trafficBis: u.trafficBis ?? null,
    skala: { besserAb, mindestAusgewertet: MIN_AUSGEWERTET }, leer: laeufe[0].phasen.every((p) => p.ausgewertet === 0),
  };
}
