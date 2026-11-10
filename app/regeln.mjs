// Regelwerk (Entscheidungsbaum nach dem Trichter aus dem Briefing): Impressionen -> Klicks -> Käufe.
// Reine Funktionen ohne Datenbank und ohne Netz, damit sie leicht zu testen sind.
// Nur eBay. Bewusst NICHT enthalten: Werbung (bräuchte ein Budget) und Preis (bräuchte einen Deckungsbeitrag).
// Es bleiben die Hebel ohne Kosten: Titel/Suchbegriffe, erstes Bild, Beschreibung/Maße/Versandangaben.
// Sichtbare Texte sind auf Englisch; Schlüssel und Kommentare bleiben deutsch.
//
// Der Baum, von oben nach unten (der erste Treffer gewinnt). FOKUS: Impressionen (Stufe 1).
//   1. jünger als 90 Tage                       -> neu              (abwarten)
//   2. Impressionen im unteren Viertel          -> sichtbarkeit     (Hebel: Titel und Suchbegriffe)
//        gilt für ALLE Angebote, auch für verkaufsstarke: wer sich schon verkauft, gewinnt am meisten durch mehr Sichtbarkeit
//   3. 30+ Verkäufe in 90 Tagen                 -> top              (behalten)
//   4. keine Impressionen/Aufrufe bekannt       -> ohne_daten       (abwarten)
//   5. verkauft und Conversion >= 2 %           -> normal           (behalten)
//   6. sonst die nächste schwache Stufe (Stufen 2 und 3, später im Fokus):
//        Klickrate im unteren Viertel           -> klicks           (Hebel: erstes Bild und Titel)
//        sonst                                  -> kaufentscheidung (Hebel: Beschreibung, Maße, Versand)
// Auslisten wird nie automatisch empfohlen, das entscheidet ein Mensch (wie im Briefing).

// Schlüssel werden gespeichert, die Beschriftung ist, was die Oberfläche zeigt.
export const AKTIONEN = {
  behalten: "Keep",
  beobachten: "Watch",
  titel: "Title & keywords",
  bild: "Main image",
  angebot: "Listing details",
  auslisten: "Delist",
};

export const EINSTELLUNGEN = {
  schonfristTage: 90,        // so lange gilt ein Produkt als "neu" und wird nicht bewertet
  topVerkaeufe90d: 30,       // ab so vielen Verkäufen in 90 Tagen: Top
  schwacheConversion: 0.02,  // Verkäufe / Aufrufe unterhalb dieses Werts: schwach
  anteilUnten: 0.25,         // "unteres Viertel" des Shops gilt als schwach (Impressionen, Klickrate)
  titelMaxZeichen: 80,       // eBay-Titel dürfen höchstens so lang sein
  markenname: "Parture",     // eigener Markenname, darf bei einem Titelvorschlag angehängt werden
  aehnlichMin: 5,           // so viele ähnliche Angebote mit vielen Impressionen braucht ein Wortvorschlag mindestens
  aehnlichAnteil: 0.4,      // ein Wort muss in mindestens so vielen dieser ähnlichen Angebote vorkommen
  // Prüfung einer Änderung (Briefing: genug Tage UND genug Menge, Vergleich gegen unveränderte Angebote)
  pruefungNachTagen: 30,     // so lange läuft ein Test, bevor geurteilt wird (das Datenfenster der App ist 30 Tage)
  mindestImpressionen30: 150, // darunter wird nicht geurteilt (Mindestmenge aus dem Briefing)
  besserAb: 0.2,             // Hauptkennzahl muss gegenüber der Vergleichsgruppe um mindestens 20 % besser sein
  schutzGrenze: 0.2,         // die Schutzkennzahl darf gegenüber der Vergleichsgruppe um höchstens 20 % fallen
  mindestAufrufe: 30,        // darunter ist ein Urteil über die Kaufentscheidung nur ein schwaches Signal
  // Rückfallwerte, falls zu wenige Daten für die Berechnung da sind (leiteSchwellenAb überschreibt sie):
  wenigImpressionen90d: 2000,
  schwacheKlickrate: 0.0025,
};

// Reihenfolge = Reihenfolge der Kacheln in der Oberfläche. fokus: false = Stufe, die später dran ist (wird dezent gezeigt).
export const GRUPPEN = {
  sichtbarkeit: { label: "Stage 1 · Low impressions", empfehlung: "titel", fokus: true, regel: "impressions in the bottom quarter of the shop, whether it sells or not: buyers rarely see it" },
  top: { label: "Top sellers", empfehlung: "behalten", fokus: true, regel: "30 or more sales in 90 days and enough impressions" },
  normal: { label: "Steady sellers", empfehlung: "behalten", fokus: true, regel: "at least 1 sale in 90 days, at least 2 % of views turn into a sale, enough impressions" },
  neu: { label: "New", empfehlung: "beobachten", fokus: true, regel: "younger than 90 days, not rated yet" },
  ohne_daten: { label: "No traffic data", empfehlung: "beobachten", fokus: true, regel: "impressions or views unknown, so no rating" },
  klicks: { label: "Stage 2 · Not clicked (later)", empfehlung: "bild", fokus: false, regel: "enough impressions, weak sales, click rate in the bottom quarter: seen, not opened" },
  kaufentscheidung: { label: "Stage 3 · Not bought (later)", empfehlung: "angebot", fokus: false, regel: "enough impressions and clicks, weak sales: visitors do not buy" },
};

export function istNeu(erstellt, jetzt, tage) {
  const t = Date.parse(erstellt);
  if (Number.isNaN(t)) return false;
  return jetzt.getTime() - t < tage * 86400000;
}

function perzentil(werte, anteil) {
  const v = [...werte].sort((a, b) => a - b);
  return v[Math.floor(anteil * (v.length - 1))];
}

// Berechnet die Schwellen "unteres Viertel" aus den Produkten des Shops (nur Produkte außerhalb der Schonfrist).
// Zu wenig Daten (< 20 Produkte): die Rückfallwerte bleiben.
export function leiteSchwellenAb(produkte, einst = EINSTELLUNGEN, jetzt = new Date()) {
  const reif = produkte.filter((p) => !istNeu(p.created_at, jetzt, einst.schonfristTage));
  const imp = reif.filter((p) => p.impressionen_90d != null).map((p) => Number(p.impressionen_90d));
  const ctr = reif.filter((p) => Number(p.impressionen_90d) > 0 && p.aufrufe_90d != null).map((p) => Number(p.aufrufe_90d) / Number(p.impressionen_90d));
  if (imp.length < 20 || ctr.length < 20) return { ...einst };
  return { ...einst, wenigImpressionen90d: perzentil(imp, einst.anteilUnten), schwacheKlickrate: perzentil(ctr, einst.anteilUnten) };
}

export const conversion = (p) => {
  const a = Number(p.aufrufe_90d);
  return a > 0 ? (Number(p.units_90d) || 0) / a : null;
};
export const klickrate = (p) => {
  const i = Number(p.impressionen_90d);
  return i > 0 && p.aufrufe_90d != null ? Number(p.aufrufe_90d) / i : null;
};

const n = (x) => Number(x).toLocaleString("en-GB");
const pct = (anteil, stellen = 1) => (100 * anteil).toFixed(stellen);

// p: { created_at, units_90d, impressionen_90d, aufrufe_90d } (fehlende Zahlen = null)
export function bewerte(p, einst = EINSTELLUNGEN, jetzt = new Date()) {
  const v90 = Number(p.units_90d) || 0;
  const imp = p.impressionen_90d == null ? null : Number(p.impressionen_90d);
  const auf = p.aufrufe_90d == null ? null : Number(p.aufrufe_90d);
  const g = (gruppe, begruendung) => ({ gruppe, empfehlung: GRUPPEN[gruppe].empfehlung, begruendung });

  if (istNeu(p.created_at, jetzt, einst.schonfristTage)) return g("neu", `Listed for less than ${einst.schonfristTage} days, so we are still waiting.`);

  // FOKUS Stufe 1: wenige Impressionen, egal wie gut sich das Angebot sonst verkauft
  if (imp != null && imp < einst.wenigImpressionen90d) {
    const kontext = v90 >= 1 ? ` It already sells (${n(v90)} ${v90 === 1 ? "sale" : "sales"} in 90 days), so more impressions should bring more sales.` : " Too few buyers see this listing.";
    return g("sichtbarkeit", `Only ${n(imp)} impressions in 90 days (bottom quarter of the shop: under ${n(Math.round(einst.wenigImpressionen90d))}).${kontext}`);
  }
  if (v90 >= einst.topVerkaeufe90d) return g("top", `${n(v90)} sales in 90 days.`);
  if (imp == null || auf == null) return g("ohne_daten", "No impression or view numbers are available for this product.");

  if (v90 >= 1) {
    if (auf === 0) return g("normal", `${n(v90)} sales in 90 days, no view numbers recorded.`);
    if (v90 / auf >= einst.schwacheConversion) return g("normal", `${n(v90)} sales from ${n(auf)} views (${pct(v90 / auf)} %).`);
  }

  // Schwächste Stufe des Trichters
  const ctr = auf / imp;
  if (ctr < einst.schwacheKlickrate) {
    return g("klicks", `Shown ${n(imp)} times but opened only ${n(auf)} times (${pct(ctr, 2)} %, bottom quarter of the shop: under ${pct(einst.schwacheKlickrate, 2)} %). Seen, but not clicked.`);
  }
  const verkauf = v90 === 0 ? "no sale" : `only ${n(v90)} ${v90 === 1 ? "sale" : "sales"} (${pct(v90 / auf)} % of views)`;
  // Bei sehr wenigen Aufrufen ist das Urteil unsicher (Briefing: Mindestmenge), das sagen wir offen dazu.
  const unsicher = auf < einst.mindestAufrufe ? ` Only ${n(auf)} views so far, so treat this as a weak signal.` : "";
  return g("kaufentscheidung", `${n(auf)} views but ${verkauf} in 90 days. Visitors open the listing but do not buy.${unsicher}`);
}
