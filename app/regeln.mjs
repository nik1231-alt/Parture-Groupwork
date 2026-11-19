// Diagnose (Grundgerüst, Fokus: Impressionen): jedes Angebot bekommt einen von drei Bereichen.
// Reine Funktionen ohne Datenbank und ohne Netz, damit sie leicht zu testen sind.
// Nur eBay. Bewusst NICHT enthalten: Werbung (bräuchte ein Budget) und Preis als Hebel (bräuchte einen Deckungsbeitrag).
// Alle Werte stehen in EINSTELLUNGEN (Startwerte) und lassen sich in der App unter "Settings" ändern.
// Sichtbare Texte sind auf Englisch; Schlüssel und Kommentare bleiben deutsch.
//
// Der Baum (der erste Treffer gewinnt):
//   1. jünger als die Schonfrist (Standard 90 Tage)  -> warten        (Briefing: zu wenig Daten = abwarten)
//   2. keine Impressionen bekannt                    -> warten
//   3. Impressionen unter der Grenze                 -> sichtbarkeit  (Hebel: Titel und Suchbegriffe)
//        Grenze = unteres Viertel des Shops (einstellbar) oder eine feste Zahl
//   4. sonst                                         -> ok

// eBay-Titel dürfen höchstens so lang sein (Vorgabe von eBay, daher fest und nicht in den Settings). Die einzige Stelle mit dieser Zahl:
// Server (setzeTitel, Titelhilfe), Tests und Oberfläche (über /api/experimente) lesen sie von hier.
export const TITEL_MAX_ZEICHEN = 80;

export const EINSTELLUNGEN = {
  // Diagnose
  schonfristTage: 90,        // so lange gilt ein Angebot als "neu" und wird nicht bewertet
  modus: "anteil",           // "anteil" = unteres Viertel des Shops, "fest" = feste Zahl
  anteilUnten: 0.25,         // Anteil des Shops, der als "wenig Impressionen" gilt (Modus "anteil")
  festeGrenze: 2000,         // Grenze in Impressionen je 90 Tage (Modus "fest")
  wenigImpressionen90d: 2000, // wird aus den Daten berechnet (leiteSchwellenAb); dies ist nur der Rückfallwert
  // Tests (Gruppenvergleich, siehe experimente.mjs)
  testGroesse: 40,           // so viele Angebote kommen in einen Test (je zur Hälfte Test- und Kontrollgruppe)
  pruefungNachTagen: 30,     // so lange läuft ein Test, bevor geurteilt wird (das Datenfenster der App ist 30 Tage)
  mindestImpressionen30: 150, // darunter wird nicht geurteilt (Mindestmenge aus dem Briefing)
  besserAb: 0.2,             // Zielmarke: die Testgruppe muss gegenüber der Kontrollgruppe um mindestens 20 % mehr Impressionen haben (einzige Stelle; Oberfläche liest sie aus der Auswertung)
  schutzGrenze: 0.2,         // die Verkäufe der Testgruppe dürfen gegenüber der Kontrollgruppe um höchstens 20 % fallen
  // Leiter (siehe leiter.mjs): Prüfzeit je Stufe, wie viele Angebote gleichzeitig, Werbesatz und Preisschritt
  leiterTageTitel: 14,       // so lange läuft der neue Titel, bevor die Impressionen wieder geprüft werden
  leiterTageWerbung: 14,     // Prüfzeit nach dem Einschalten der Werbung
  leiterTagePreis: 21,       // Prüfzeit nach der Preissenkung (Verkäufe reagieren langsamer)
  leiterMax: 20,             // höchstens so viele Angebote stehen gleichzeitig auf der Leiter
  werbesatz: 0.1,            // Werbesatz für eBay Promoted Listings (Anteil am Verkaufspreis, nur bei Verkauf fällig)
  preisSchritt: 0.1,         // um diesen Anteil wird der Preis in Stufe 3 gesenkt
};

// Reihenfolge = Reihenfolge der Reiter in der Oberfläche
export const GRUPPEN = {
  sichtbarkeit: { label: "Low impressions", empfehlung: "Improve the title", regel: "impressions are in the lowest share of the shop (or under your fixed limit): buyers rarely see the listing" },
  ok: { label: "Fine", empfehlung: "No action needed", regel: "enough impressions" },
  warten: { label: "Wait", empfehlung: "Wait and check again", regel: "listed less than the grace period ago, or no impression numbers yet" },
};

function istNeu(erstellt, jetzt, tage) {
  const t = Date.parse(erstellt);
  if (Number.isNaN(t)) return false;
  return jetzt.getTime() - t < tage * 86400000;
}

function perzentil(werte, anteil) {
  const v = [...werte].sort((a, b) => a - b);
  return v[Math.floor(anteil * (v.length - 1))];
}

// Berechnet die Grenze für "wenig Impressionen". Modus "fest": die eingestellte Zahl. Modus "anteil": das untere Viertel
// (oder der eingestellte Anteil) der Angebote außerhalb der Schonfrist. Bei weniger als 20 Angeboten bleibt der Rückfallwert.
export function leiteSchwellenAb(produkte, einst = EINSTELLUNGEN, jetzt = new Date()) {
  if (einst.modus === "fest") return { ...einst, wenigImpressionen90d: einst.festeGrenze };
  const imp = produkte
    .filter((p) => !istNeu(p.created_at, jetzt, einst.schonfristTage) && p.impressionen_90d != null)
    .map((p) => Number(p.impressionen_90d));
  if (imp.length < 20) return { ...einst };
  return { ...einst, wenigImpressionen90d: perzentil(imp, einst.anteilUnten) };
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

// p: { created_at, units_90d, impressionen_90d } (fehlende Zahlen = null). einst: bitte mit leiteSchwellenAb berechnet.
export function bewerte(p, einst = EINSTELLUNGEN, jetzt = new Date()) {
  const v90 = Number(p.units_90d) || 0;
  const imp = p.impressionen_90d == null ? null : Number(p.impressionen_90d);
  const g = (gruppe, begruendung) => ({ gruppe, empfehlung: GRUPPEN[gruppe].empfehlung, begruendung });

  if (istNeu(p.created_at, jetzt, einst.schonfristTage)) return g("warten", `Listed for less than ${einst.schonfristTage} days, so we wait.`);
  if (imp == null) return g("warten", "No impression numbers are available yet.");

  const grenze = Math.round(einst.wenigImpressionen90d);
  if (imp < einst.wenigImpressionen90d) {
    const massstab = einst.modus === "fest" ? `your limit: under ${n(grenze)}` : `lowest ${Math.round(100 * einst.anteilUnten)} % of the shop: under ${n(grenze)}`;
    const verkauf = v90 >= 1 ? ` It already sells (${n(v90)} ${v90 === 1 ? "sale" : "sales"} in 90 days), so more impressions should bring more sales.` : " Too few buyers see this listing.";
    return g("sichtbarkeit", `Only ${n(imp)} impressions in 90 days (${massstab}).${verkauf}`);
  }
  return g("ok", `${n(imp)} impressions in 90 days, no action needed.`);
}
