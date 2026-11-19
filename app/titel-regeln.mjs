// Regelprüfer für neue eBay-Titel: entscheidet ohne KI, ob ein Vorschlag abmahnsicher und eBay-konform ist.
// Jeder Titelvorschlag (von der KI, aus der Titelhilfe oder von Hand) muss hier durch, bevor er zur Freigabe kann.
// Reine Funktionen, keine Datenbank, kein Netz. Tests: app/test-titel-regeln.mjs (mit bösen Beispielen).
//
// Die Regeln, kurz:
//   1. Länge 1 bis 80 Zeichen (Vorgabe von eBay).
//   2. Keine Werbe- und Gütebehauptungen: Superlative, Prüfsiegel, Umweltaussagen, Preis- und Versandversprechen, "Original".
//   3. Fremde Marken nur als Bezug ("passend für Bosch"), nie als Hersteller; keine Marke, die im alten Titel nicht stand.
//   4. Nichts erfinden: jede Zahl (Maß, Stückzahl) und jede Farbe muss schon im alten Titel stehen.
//   5. Keine Schlagwortlisten: kein Schlagwort öfter als vorher, keine Emojis, keine neuen Sonderzeichen oder Großbuchstaben-Wörter.
// Geprüft am 19.11.2026 gegen alle 745 aktiven eBay-Titel des Shops (jeder Titel gegen sich selbst): Was dabei auffiel, steht
// in den Ausnahmen unten (Füllwörter, Sonderzeichen aus dem alten Titel, Behauptungen aus dem alten Titel nur als Hinweis).
import { TITEL_MAX_ZEICHEN } from "./regeln.mjs";

// Wörter, die in einem neuen Titel nicht stehen dürfen (als ganzes Wort, Groß-/Kleinschreibung egal). Der Grund steht im Prüfergebnis.
const VERBOTEN = [
  { muster: /\boriginal\w*|\boem\b/i, grund: "“Original”/“OEM” claims the part comes from the brand owner (trademark risk)." },
  { muster: /\b(beste[nmrs]?|best|top|nr\.?\s?1|nummer\s?1|testsieger|premium|perfekt\w*|ultimativ\w*|einzigartig\w*)\b/i, grund: "Superlatives and quality claims cannot be proven (unfair competition)." },
  { muster: /\b(tüv|geprüft|zertifiziert|ce|patent\w*|gs)\b/i, grund: "Test marks and certificates may only be named with proof." },
  { muster: /\b(nachhaltig\w*|umweltfreundlich\w*|ressourcenschonend\w*|klimaneutral\w*|öko\w*|bio|recycel\w*)\b/i, grund: "Environmental claims need proof (green claims, warning letters are common)." },
  { muster: /\b(gratis|kostenlos\w*|versandkostenfrei|gratisversand|rabatt\w*|sale|angebot|aktion|günstig\w*|billig\w*|schnäppchen)\b/i, grund: "Price and shipping promises do not belong in the title (eBay rule, price claims)." },
  { muster: /\b(garantie\w*|lebenslang\w*|unzerstörbar\w*|bruchsicher\w*)\b/i, grund: "Guarantee and durability promises create legal obligations." },
];

// Fremdmarken, die im Katalog vorkommen (Liste von der Gruppe gepflegt). Eine Marke darf nur zusammen mit einem Bezugswort stehen.
export const MARKEN = ["bosch", "makita", "metabo", "ryobi", "stihl", "festool", "dewalt", "milwaukee", "einhell", "gardena", "kärcher", "karcher",
  "hilti", "parkside", "ikea", "kallax", "billy", "trofast", "variera", "thule", "hymer", "vw", "volkswagen", "bmw", "tesla", "apple", "dyson",
  "sonos", "kermi", "new era", "flexfit", "worx", "black+decker", "hikoki", "wera", "wiha", "knipex", "samsung", "philips", "xiaomi", "garmin",
  "rummikub", "lego", "playmobil", "nintendo", "playstation", "xbox", "gopro", "dji", "weber", "kitchenaid", "thermomix", "vorwerk", "intex",
  "bestway", "webasto", "dometic", "fritz!box", "fritzfon", "blink", "ring", "sortimo", "babyzen"];
const BEZUG = /\b(passend|kompatibel|geeignet|für)\b/i;
const FARBEN = ["schwarz", "weiß", "weiss", "grau", "rot", "blau", "grün", "gelb", "orange", "pink", "rosa", "lila", "violett", "braun", "beige", "gold", "silber", "transparent", "anthrazit"];
// Füllwörter dürfen mehrfach vorkommen ("passend für A … für B"), sie sind keine Schlagwörter
export const FUELL = new Set(["für", "mit", "und", "oder", "von", "zum", "zur", "der", "die", "das", "den", "dem", "ein", "eine", "auf", "aus", "passend", "kompatibel", "geeignet", "set", "stk", "stück"]);
const EMOJI = /[\p{Extended_Pictographic}✅✔⭐]/u;
const ERLAUBT = /[\p{L}\p{N}\s\-/,.&()+'"×:]/u;

const klein = (s) => String(s ?? "").toLowerCase();
// Titel aus pm.db tragen manchmal HTML-Entitäten (&amp;): vor dem Prüfen in Zeichen umwandeln
const entities = (s) => String(s ?? "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
const woerter = (s) => klein(s).match(/[\p{L}\p{N}][\p{L}\p{N}+&-]*/gu) || [];
const zahlen = (s) => klein(s).match(/\d+(?:[.,]\d+)?/g) || [];
const zaehle = (liste) => liste.reduce((m, w) => m.set(w, (m.get(w) || 0) + 1), new Map());
const enthaeltMarke = (text, m) => new RegExp(`(^|[^\\p{L}\\p{N}])${m.replace(/[+.*?^${}()|[\]\\]/g, "\\$&")}($|[^\\p{L}\\p{N}])`, "iu").test(text);
export const markenIn = (text) => MARKEN.filter((m) => enthaeltMarke(klein(entities(text)), m));

// Prüft einen neuen Titel gegen den alten. Liefert { ok, verstoesse, hinweise }; ok nur ohne Verstoß.
// verstoesse blockieren die Freigabe. hinweise blockieren nicht: sie markieren Riskantes, das schon im alten Titel stand
// (z. B. ist "Webasto Air Top" ein Produktname, "TOP" am Titelende eine Behauptung), und der Admin soll es ansehen.
export function pruefeTitel(neu, alt) {
  const v = [], h = [];
  const n = entities(neu).replace(/\s+/g, " ").trim();
  const a = entities(alt);
  const melde = (regel, text) => v.push({ regel, text });

  if (!n) melde("laenge", "The title is empty.");
  if (n.length > TITEL_MAX_ZEICHEN) melde("laenge", `The title has ${n.length} characters, eBay allows at most ${TITEL_MAX_ZEICHEN}.`);
  for (const { muster, grund } of VERBOTEN) {
    const m = n.match(muster);
    if (!m) continue;
    if (klein(a).match(muster)?.[0] === klein(m[0])) h.push({ regel: "behauptung", text: `“${m[0]}” was already in the old title. Check it: ${grund}` });
    else melde("behauptung", `“${m[0]}”: ${grund}`);
  }
  // Marken: keine neuen, und Marken nur zusammen mit einem Bezugswort ("passend für …")
  const neueMarken = markenIn(n), alteMarken = markenIn(a);
  for (const m of neueMarken) if (!alteMarken.includes(m)) melde("marke", `“${m}” is a brand that was not in the old title. Brands must not be added.`);
  if (neueMarken.length && !BEZUG.test(n)) melde("marke", "A brand may only appear as a reference, e.g. “passend für …”, never as if we were the maker.");
  // Nichts erfinden: Zahlen und Farben müssen schon im alten Titel stehen
  const alteZahlen = new Set(zahlen(a));
  for (const z of zahlen(n)) if (!alteZahlen.has(z)) melde("erfunden", `The number “${z}” is not in the old title. Sizes and quantities must not be made up.`);
  const alteWoerter = woerter(a);
  for (const f of FARBEN) if (woerter(n).includes(f) && !alteWoerter.includes(f)) melde("erfunden", `The colour “${f}” is not in the old title.`);
  // Form: kein Schlagwort öfter als im alten Titel, keine Emojis, keine neuen Sonderzeichen, keine neuen Großbuchstaben-Wörter
  const vorher = zaehle(alteWoerter);
  for (const [w, k] of zaehle(woerter(n))) {
    if (k < 2 || w.length < 3 || /^\d/.test(w) || FUELL.has(w) || k <= (vorher.get(w) || 0)) continue;
    melde("form", `“${w}” appears ${k} times (keyword stuffing).`); break;
  }
  const emoji = n.match(EMOJI);
  if (emoji) melde("form", `Emojis like “${emoji[0]}” are not allowed in a title.`);
  const sonder = [...n].find((z) => !ERLAUBT.test(z) && !EMOJI.test(z) && !a.includes(z));
  if (sonder) melde("form", `The character “${sonder}” is not allowed in a title.`);
  for (const w of n.match(/(?<![\p{L}\p{N}])\p{Lu}{4,}(?![\p{L}\p{N}])/gu) || []) if (!a.includes(w)) { melde("form", `“${w}” is written in capitals, eBay counts that as shouting.`); break; }

  return { ok: v.length === 0, verstoesse: v, hinweise: h };
}

// Der Teil des KI-Auftrags, der die Regeln beschreibt: dieselben Regeln wie oben, damit die meisten Vorschläge gleich durchgehen.
export const REGELN_FUER_KI = [
  `At most ${TITEL_MAX_ZEICHEN} characters.`,
  "German, like the old title. Keep the product type and what it fits; put the words buyers search for first.",
  "Brands only as a reference (“passend für Bosch”), never as the maker. Use only brands that are already in the old title.",
  "Do not add numbers, sizes, quantities or colours that are not in the old title.",
  "No superlatives (beste, top, premium, perfekt), no test marks (TÜV, geprüft, zertifiziert, CE), no environmental claims (nachhaltig, öko, recycelt), no price or shipping promises (gratis, Rabatt, Angebot), no guarantees, never “Original” or “OEM”.",
  "No search word more often than in the old title, no emojis, no special characters like ! ? * # that are not in the old title, no words in capitals that are not in the old title.",
];
