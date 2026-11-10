// Titelentwürfe (von einer KI geschrieben, von Menschen zu prüfen): entwuerfe/titel.json
// Die App zeigt einen Entwurf nur, wenn er
//   1. für genau den heutigen Titel geschrieben wurde ("fuer" == aktueller Titel, sonst ist er veraltet) und
//   2. die Prüfung unten besteht (höchstens 80 Zeichen, keine Sonderzeichen, alle Zahlen-/Modellcodes bleiben erhalten,
//      keine neuen Codes). So kann auch ein von Hand geänderter Eintrag keine Modellnummer verlieren.
import fs from "node:fs";

// Mengenangaben vereinheitlichen ("8Stk", "2x", "2xWort" -> "8 ", "2 "), Gedankenstriche und weiche Trennstriche normalisieren
const norm = (t) => String(t)
  .replace(/­/g, "").replace(/[–‑]/g, "-")
  .replace(/(\d+)\s*(?:[sS][tT][kK]\.?|[sS][tT][üÜ][cC][kK]|[sS][tT][uU][eE][cC][kK]|[xX])(?![a-zäöü])/g, "$1 ");
const codes = (t) => new Set((norm(t).match(/[A-Za-zÄÖÜäöüß]*\d[\w\-./"ø]*/g) || []).map((c) => c.toLowerCase().replace(/^[.,;:()]+|[.,;:()]+$/g, "")));

// Gibt eine Liste von Problemen zurück (leer = in Ordnung)
export function pruefeEntwurf(fuer, neu, maxZeichen = 80) {
  const probleme = [];
  if (typeof fuer !== "string" || typeof neu !== "string" || !neu.trim()) return ["invalid entry"];
  if (neu.length > maxZeichen) probleme.push(`too long (${neu.length} of ${maxZeichen})`);
  if (/[^\p{L}\p{N}\s\-/.,&()"'ø°+]/u.test(neu)) probleme.push("special characters");
  if (/\s{2,}/.test(neu) || neu !== neu.trim()) probleme.push("spacing");
  const alt = codes(fuer), neuCodes = codes(neu);
  const fehlt = [...alt].filter((c) => !neuCodes.has(c));
  const erfunden = [...neuCodes].filter((c) => !alt.has(c) && ![...alt].some((a) => a.includes(c)));
  if (fehlt.length) probleme.push(`model or number missing: ${fehlt.join(", ")}`);
  if (erfunden.length) probleme.push(`model or number invented: ${erfunden.join(", ")}`);
  return probleme;
}

// Lädt die Datei. Fehlende oder kaputte Datei = keine Entwürfe (die App läuft ohne sie weiter).
// Gibt Map(number -> { fuer, neu, aenderung }) zurück; ungültige Einträge werden still ausgelassen.
export function ladeEntwuerfe(pfad, maxZeichen = 80) {
  const karte = new Map();
  let daten;
  try { daten = JSON.parse(fs.readFileSync(pfad, "utf8")); } catch { return karte; }
  const eintraege = daten && typeof daten === "object" ? daten.eintraege : null;
  if (!eintraege || typeof eintraege !== "object") return karte;
  for (const [nr, e] of Object.entries(eintraege)) {
    if (!e || typeof e !== "object") continue;
    if (pruefeEntwurf(e.fuer, e.neu, maxZeichen).length) continue;
    karte.set(nr, { fuer: e.fuer, neu: e.neu.trim(), aenderung: typeof e.aenderung === "string" ? e.aenderung : "" });
  }
  return karte;
}
