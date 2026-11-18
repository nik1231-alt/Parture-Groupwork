// Einstellungen: alle Regelwerte, die das Team in der App ändern kann (Seite "Settings").
// Gespeichert werden nur Abweichungen von den Startwerten (EINSTELLUNGEN in regeln.mjs) in der Tabelle "einstellung".
// Das Schema unten beschreibt jedes Feld (Beschriftung, Erklärung, Grenzen). Die Oberfläche baut das Formular daraus,
// neue Regeln lassen sich also später durch einen Eintrag im Schema ergänzen. Geprüft wird immer hier auf dem Server.
import { EINSTELLUNGEN } from "./regeln.mjs";

export const ABSCHNITTE = [
  { id: "diagnose", titel: "Which listings need attention?", text: "A listing is flagged as “Low impressions” when buyers rarely see it. Impressions are counted over the last 90 days." },
  { id: "tests", titel: "Tests", text: "A test compares a test group with a control group after the same time. Only the test group gets the change." },
];

// typ: zahl (faktor = Anzeige-Umrechnung, z. B. 100 für Prozent), auswahl, text. ganz: nur ganze Zahlen. gerade: nur gerade Zahlen.
export const SCHEMA = [
  { key: "modus", abschnitt: "diagnose", typ: "auswahl", label: "How to decide that impressions are low",
    hilfe: "“Lowest share” adapts to your shop. “Fixed number” uses the same limit for every listing.",
    optionen: [{ wert: "anteil", label: "Lowest share of the shop" }, { wert: "fest", label: "Fixed number" }] },
  { key: "anteilUnten", abschnitt: "diagnose", typ: "zahl", label: "Lowest share of the shop", einheit: "%", faktor: 100, min: 0.05, max: 0.5, schritt: 1, nur: { modus: "anteil" },
    hilfe: "Listings in this lowest share by impressions are flagged. 25 % flags the quietest quarter." },
  { key: "festeGrenze", abschnitt: "diagnose", typ: "zahl", label: "Fixed limit", einheit: "impressions in 90 days", ganz: true, min: 1, max: 1000000, schritt: 100, nur: { modus: "fest" },
    hilfe: "Listings with fewer impressions than this are flagged." },
  { key: "schonfristTage", abschnitt: "diagnose", typ: "zahl", label: "Grace period for new listings", einheit: "days", ganz: true, min: 0, max: 365, schritt: 1,
    hilfe: "New listings get “Wait” for this long, because they have not had time to collect impressions." },
  { key: "testGroesse", abschnitt: "tests", typ: "zahl", label: "Listings per test", einheit: "listings", ganz: true, gerade: true, min: 4, max: 200, schritt: 2,
    hilfe: "Half become the test group, half the control group. The briefing suggests 30 to 50 listings per test." },
  { key: "pruefungNachTagen", abschnitt: "tests", typ: "zahl", label: "Test duration", einheit: "days", ganz: true, min: 7, max: 180, schritt: 1,
    hilfe: "The verdict comes after this many days. The data covers 30 days at a time, so shorter than 30 is possible but weaker." },
  { key: "mindestImpressionen30", abschnitt: "tests", typ: "zahl", label: "Minimum impressions for a verdict", einheit: "impressions in 30 days", ganz: true, min: 0, max: 100000, schritt: 50,
    hilfe: "Below this amount in the test group, the app does not judge." },
  { key: "besserAb", abschnitt: "tests", typ: "zahl", label: "Counts as better from", einheit: "% more impressions than control", faktor: 100, min: 0.01, max: 2, schritt: 1,
    hilfe: "How much more the test group must grow than the control group." },
  { key: "schutzGrenze", abschnitt: "tests", typ: "zahl", label: "Sales may fall by at most", einheit: "% compared with control", faktor: 100, min: 0.01, max: 1, schritt: 1,
    hilfe: "Safety check: more impressions must not cost sales. If sales fall more than this, the change counts as worse." },
];

export const STANDARD = Object.fromEntries(SCHEMA.map((f) => [f.key, EINSTELLUNGEN[f.key]]));
const feld = (key) => SCHEMA.find((f) => f.key === key);

// Gibt einen Fehlertext zurück, oder null wenn der Wert gültig ist.
export function pruefeWert(f, wert) {
  if (f.typ === "auswahl") return f.optionen.some((o) => o.wert === wert) ? null : `${f.label}: please choose one of the options.`;
  if (f.typ === "zahl") {
    if (typeof wert !== "number" || !Number.isFinite(wert)) return `${f.label}: please enter a number.`;
    if (f.ganz && !Number.isInteger(wert)) return `${f.label}: please enter a whole number.`;
    if (f.gerade && wert % 2 !== 0) return `${f.label}: please enter an even number.`;
    // kleine Rundungsfehler bei Prozentwerten (z. B. 0.07 * 100) dürfen die Grenzen nicht verletzen
    if (wert < f.min - 1e-9 || wert > f.max + 1e-9) {
      const k = f.faktor || 1;
      return `${f.label}: please enter a value between ${Math.round(f.min * k * 100) / 100} and ${Math.round(f.max * k * 100) / 100}${f.einheit ? " " + f.einheit.split(" ")[0] : ""}.`;
    }
    return null;
  }
  return "Unknown field type.";
}

// Prüft eine Eingabe { key: wert, ... } (einzelne Felder genügen). Gibt { ok: true, wert } oder { ok: false, status: 400, fehler } zurück.
const ungueltig = (fehler) => ({ ok: false, status: 400, fehler });
export function pruefe(eingabe) {
  if (!eingabe || typeof eingabe !== "object" || Array.isArray(eingabe)) return ungueltig("Invalid request.");
  const wert = {};
  for (const [key, v] of Object.entries(eingabe)) {
    const f = Object.hasOwn(STANDARD, key) ? feld(key) : null;
    if (!f) return ungueltig(`Unknown setting: ${String(key).slice(0, 40)}.`);
    const fehler = pruefeWert(f, v);
    if (fehler) return ungueltig(fehler);
    wert[key] = v;
  }
  if (!Object.keys(wert).length) return ungueltig("Nothing to save.");
  return { ok: true, wert };
}

export function bereiteVor(db) {
  db.exec("CREATE TABLE IF NOT EXISTS einstellung (key TEXT PRIMARY KEY, wert TEXT NOT NULL)");
}

// Gespeicherte, gültige Abweichungen (kaputte oder veraltete Einträge werden still ignoriert)
export function lese(db) {
  const aus = {};
  for (const r of db.prepare("SELECT key, wert FROM einstellung").all()) {
    const f = Object.hasOwn(STANDARD, r.key) ? feld(r.key) : null;
    if (!f) continue;
    try { const w = JSON.parse(r.wert); if (!pruefeWert(f, w)) aus[r.key] = w; } catch { /* ignorieren */ }
  }
  return aus;
}

// Alle Regelwerte: Startwerte, überschrieben durch das, was das Team gespeichert hat
export const effektiv = (db) => ({ ...EINSTELLUNGEN, ...lese(db) });

export function speichere(db, eingabe) {
  const p = pruefe(eingabe);
  if (!p.ok) return p;
  const schreibe = db.transaction(() => {
    const st = db.prepare("INSERT INTO einstellung (key, wert) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET wert = excluded.wert");
    for (const [k, v] of Object.entries(p.wert)) st.run(k, JSON.stringify(v));
  });
  schreibe();
  return { ok: true, wert: effektiv(db) };
}

export function zuruecksetzen(db) {
  db.prepare("DELETE FROM einstellung").run();
  return { ok: true, wert: effektiv(db) };
}
