// Diagnosis (basic framework, focus: impressions): every listing gets one of three areas.
// Pure functions without a database and without network, so that they are easy to test.
// eBay only. Deliberately NOT included: ads (would need a budget) and price as a lever (would need a contribution margin).
// All values are in EINSTELLUNGEN (default values) and can be changed in the app under "Settings".
// Visible texts are in English; keys (names) stay German, comments are English.
//
// The tree (the first hit wins):
//   1. younger than the grace period (default 90 days)  -> warten (wait)    (briefing: too little data = wait)
//   2. no impressions known                             -> warten
//   3. impressions below the limit                      -> sichtbarkeit (visibility)  (lever: title and search terms)
//        limit = lowest quarter of the shop (adjustable) or a fixed number
//   4. otherwise                                        -> ok

// eBay titles may be at most this long (eBay's rule, hence fixed and not in the Settings). The only place with this number:
// server (setzeTitel, title help), tests and interface (through /api/experimente) read it from here.
export const TITEL_MAX_ZEICHEN = 80;

export const EINSTELLUNGEN = {
  // Diagnose
  schonfristTage: 90,        // for so long a listing counts as "new" and is not assessed
  modus: "anteil",           // "anteil" = unteres Viertel des Shops, "fest" = feste Zahl
  anteilUnten: 0.25,         // share of the shop that counts as "low impressions" (mode "anteil")
  festeGrenze: 2000,         // limit in impressions per 90 days (mode "fest")
  wenigImpressionen90d: 2000, // is calculated from the data (leiteSchwellenAb); this is only the fallback value
  // Tests (group comparison, see experimente.mjs)
  testGroesse: 40,           // so many listings go into a test (half test group, half control group)
  pruefungNachTagen: 30,     // so long a test runs before a verdict is given (the app's data window is 30 days)
  mindestImpressionen30: 150, // below this no verdict is given (minimum amount from the briefing)
  besserAb: 0.2,             // Target mark: the test group must have at least 20 % more impressions than the control group (the only place; the interface reads it from the evaluation)
  schutzGrenze: 0.2,         // the sales of the test group may fall by at most 20 % compared with the control group
  // Ladder (see leiter.mjs): waiting time per step, how many listings at the same time, ad rate and price step
  // Niko 21.11.: 4 days per phase, so the listings pass several phases before the presentation on 04.12. Short waits give
  // noisy figures; for a real measurement raise them in Settings (14 / 14 / 21 days were the earlier defaults).
  leiterTageTitel: 4,        // for so long the new title runs before the impressions are checked again
  leiterTageWerbung: 4,      // waiting time after switching on the ads
  leiterTagePreis: 4,        // waiting time after the price cut
  leiterMax: 20,             // at most so many listings are on the ladder at the same time
  leiterNurOhneVerkauf: "ja", // Niko 20.11.: Angebote, die bei eBay schon verkauft haben, nicht anfassen ("nein" = auch verkaufte)
  leiterBewegung: "hand",    // Niko 20.11.: erst einmal nur per Knopf; "automatisch" = der Tageslauf zieht und bewertet selbst
  leiterKontrolle: true,     // the daily run draws one control listing for every listing taken in (stays unchanged, comparison per step)
  werbesatz: 0.1,            // ad rate for eBay Promoted Listings (share of the sale price, due only on a sale)
  preisSchritt: 0.1,         // by this share the price is lowered in step 3
  preisMinimum: 2.99,        // F3: the app never sets a lower price; it knows no costs, so this is a guard, not a margin check
};

// Order = order of the tabs in the interface
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

// Calculates the limit for "low impressions". Mode "fest": the set number. Mode "anteil": the lower quarter
// (or the set share) of the listings outside the grace period. With fewer than 20 listings the fallback value stays.
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
  return a > 0 && p.units_90d != null ? Number(p.units_90d) / a : null;
};
export const klickrate = (p) => {
  const i = Number(p.impressionen_90d);
  return i > 0 && p.aufrufe_90d != null ? Number(p.aufrufe_90d) / i : null;
};

const n = (x) => Number(x).toLocaleString("en-GB");

// p: { created_at, units_90d, impressionen_90d } (missing numbers = null). einst: please calculated with leiteSchwellenAb.
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
