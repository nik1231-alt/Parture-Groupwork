// Rule checker for new eBay titles: decides without an AI whether a suggestion is safe from warning letters and conforms to eBay.
// Every title suggestion (from the AI, from the title help or by hand) must pass here before it can go to approval.
// Pure functions, no database, no network. Tests: app/test-titel-regeln.mjs (with bad examples).
//
// Die Regeln, kurz:
//   1. Length 1 to 80 characters (eBay's rule).
//   2. No advertising or quality claims: superlatives, test marks, environmental statements, price and shipping promises, "original".
//   3. Foreign brands only as a reference ("passend für Bosch" = "fits Bosch"), never as the maker; no brand that was not in the old title.
//   4. Invent nothing: every number (size, quantity) and every colour must already be in the old title.
//   5. No keyword lists: no keyword more often than before, no emojis, no new special characters or capitalised words.
// Checked on 19 Nov 2026 against all 745 active eBay titles of the shop (each title against itself): what stood out is listed
// in the exceptions below (filler words, special characters from the old title, claims from the old title only as a note).
import { TITEL_MAX_ZEICHEN } from "./regeln.mjs";

// Words that must not appear in a new title (as a whole word, case does not matter). The reason is in the check result.
const VERBOTEN = [
  { muster: /\boriginal\w*|\boem\b/i, grund: "“Original”/“OEM” claims the part comes from the brand owner (trademark risk)." },
  { muster: /\b(beste[nmrs]?|best|top|nr\.?\s?1|nummer\s?1|testsieger|premium|perfekt\w*|ultimativ\w*|einzigartig\w*)\b/i, grund: "Superlatives and quality claims cannot be proven (unfair competition)." },
  { muster: /\b(tüv|geprüft|zertifiziert|ce|patent\w*|gs)\b/i, grund: "Test marks and certificates may only be named with proof." },
  { muster: /\b(nachhaltig\w*|umweltfreundlich\w*|ressourcenschonend\w*|klimaneutral\w*|öko\w*|bio|recycel\w*)\b/i, grund: "Environmental claims need proof (green claims, warning letters are common)." },
  { muster: /\b(gratis|kostenlos\w*|versandkostenfrei|gratisversand|rabatt\w*|sale|angebot|aktion|günstig\w*|billig\w*|schnäppchen)\b/i, grund: "Price and shipping promises do not belong in the title (eBay rule, price claims)." },
  { muster: /\b(garantie\w*|lebenslang\w*|unzerstörbar\w*|bruchsicher\w*)\b/i, grund: "Guarantee and durability promises create legal obligations." },
];

// Foreign brands that occur in the catalogue (list kept by the group). A brand may only appear together with a reference word.
export const MARKEN = ["bosch", "makita", "metabo", "ryobi", "stihl", "festool", "dewalt", "milwaukee", "einhell", "gardena", "kärcher", "karcher",
  "hilti", "parkside", "ikea", "kallax", "billy", "trofast", "variera", "thule", "hymer", "vw", "volkswagen", "bmw", "tesla", "apple", "dyson",
  "sonos", "kermi", "new era", "flexfit", "worx", "black+decker", "hikoki", "wera", "wiha", "knipex", "samsung", "philips", "xiaomi", "garmin",
  "rummikub", "lego", "playmobil", "nintendo", "playstation", "xbox", "gopro", "dji", "weber", "kitchenaid", "thermomix", "vorwerk", "intex",
  "bestway", "webasto", "dometic", "fritz!box", "fritzfon", "blink", "ring", "sortimo", "babyzen"];
const BEZUG = /\b(passend|kompatibel|geeignet|für)\b/i;
const FARBEN = ["schwarz", "weiß", "weiss", "grau", "rot", "blau", "grün", "gelb", "orange", "pink", "rosa", "lila", "violett", "braun", "beige", "gold", "silber", "transparent", "anthrazit"];
// Filler words may occur several times ("passend für A … für B"), they are not keywords
export const FUELL = new Set(["für", "mit", "und", "oder", "von", "zum", "zur", "der", "die", "das", "den", "dem", "ein", "eine", "auf", "aus", "passend", "kompatibel", "geeignet", "set", "stk", "stück"]);
// F4: English words that German buyers do not search for. A new title may keep them if the old title had them (e.g. the
// product name "Circular Saw" or "Wallmount" in No. 405 and No. 2009), but it must not add them. Only clearly English words:
// "Cover", "Set", "Clip", "Organizer", "Adapter" or "Kit" are common in German titles and stay allowed.
export const ENGLISCH = new Set(["for", "with", "and", "the", "of", "mount", "wallmount", "holder", "bracket", "hanger", "hook", "wall", "shelf",
  "saw", "circular", "drill", "replacement", "spare", "part", "parts", "storage", "black", "white", "grey", "gray", "red", "blue", "green"]);
const EMOJI = /[\p{Extended_Pictographic}✅✔⭐]/u;
const ERLAUBT = /[\p{L}\p{N}\s\-/,.&()+'"×:]/u;

const klein = (s) => String(s ?? "").toLowerCase();
// Titles from pm.db sometimes carry HTML entities (&amp;): convert them into characters before checking
const entities = (s) => String(s ?? "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
const woerter = (s) => klein(s).match(/[\p{L}\p{N}][\p{L}\p{N}+&-]*/gu) || [];
const zahlen = (s) => klein(s).match(/\d+(?:[.,]\d+)?/g) || [];
const zaehle = (liste) => liste.reduce((m, w) => m.set(w, (m.get(w) || 0) + 1), new Map());
const enthaeltMarke = (text, m) => new RegExp(`(^|[^\\p{L}\\p{N}])${m.replace(/[+.*?^${}()|[\]\\]/g, "\\$&")}($|[^\\p{L}\\p{N}])`, "iu").test(text);
export const markenIn = (text) => MARKEN.filter((m) => enthaeltMarke(klein(entities(text)), m));
// Is the brand before the first reference word ("BMW X3 Armlehne passend")? Then it reads as if we were the maker.
// Found on 20 Nov on real AI suggestions: the old rule demanded a reference word only SOMEWHERE.
const markeVorBezug = (text, m) => {
  const t = klein(entities(text));
  const stelle = t.search(new RegExp(`(^|[^\\p{L}\\p{N}])${m.replace(/[+.*?^${}()|[\]\\]/g, "\\$&")}($|[^\\p{L}\\p{N}])`, "iu"));
  const bezug = t.search(BEZUG);
  return stelle >= 0 && (bezug < 0 || stelle < bezug);
};

// Checks a new title against the old one. Returns { ok, verstoesse, hinweise }; ok only without a violation.
// verstoesse (violations) block the approval. hinweise (notes) do not block: they mark risky things that were already in the old title
// (e.g. "Webasto Air Top" is a product name, "TOP" at the end of a title is a claim), and the admin should look at it.
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
  // Brands: no new ones, and brands only together with a reference word ("passend für …")
  const neueMarken = markenIn(n), alteMarken = markenIn(a);
  for (const m of neueMarken) if (!alteMarken.includes(m)) melde("marke", `“${m}” is a brand that was not in the old title. Brands must not be added.`);
  if (neueMarken.length && !BEZUG.test(n)) melde("marke", "A brand may only appear as a reference, e.g. “passend für …”, never as if we were the maker.");
  else for (const m of neueMarken.filter((x) => markeVorBezug(n, x))) {
    if (markeVorBezug(a, m)) h.push({ regel: "marke", text: `“${m}” stands before “passend für …”, as in the old title. Check it: a brand in front reads as if we were the maker.` });
    else melde("marke", `“${m}” must come after “passend für …” or “kompatibel mit …”. A brand in front reads as if we were the maker.`);
  }
  // Invent nothing: numbers and colours must already be in the old title
  const alteZahlen = new Set(zahlen(a));
  for (const z of zahlen(n)) if (!alteZahlen.has(z)) melde("erfunden", `The number “${z}” is not in the old title. Sizes and quantities must not be made up.`);
  const alteWoerter = woerter(a);
  for (const f of FARBEN) if (woerter(n).includes(f) && !alteWoerter.includes(f)) melde("erfunden", `The colour “${f}” is not in the old title.`);
  // Stay German (F4): no English word that the old title did not have
  const englisch = [...new Set(woerter(n))].filter((w) => ENGLISCH.has(w) && !alteWoerter.includes(w));
  if (englisch.length) melde("sprache", `“${englisch.join("”, “")}” ${englisch.length === 1 ? "is" : "are"} English and not in the old title. Titles stay German: buyers on eBay.de search in German.`);
  // Form: no keyword more often than in the old title, no emojis, no new special characters, no new capitalised words
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

// The part of the AI task that describes the rules: the same rules as above, so that most suggestions pass at once.
export const REGELN_FUER_KI = [
  `At most ${TITEL_MAX_ZEICHEN} characters.`,
  "German, like the old title. Start with the product type (what it is), then what it fits; put the words buyers search for early.",
  "No English words (mount, holder, bracket, wall …) unless the old title already has them; use the German word (Halterung, Halter, Wand).",
  "Brands only AFTER “passend für” or “kompatibel mit” (“Armlehne Box passend für BMW X3”), never at the start and never before that phrase, so we never look like the maker. Use only brands that are already in the old title.",
  "Do not add numbers, sizes, quantities or colours that are not in the old title.",
  "No superlatives (beste, top, premium, perfekt), no test marks (TÜV, geprüft, zertifiziert, CE), no environmental claims (nachhaltig, öko, recycelt), no price or shipping promises (gratis, Rabatt, Angebot), no guarantees, never “Original” or “OEM”.",
  "No search word more often than in the old title, no emojis, no special characters like ! ? * # that are not in the old title, no words in capitals that are not in the old title.",
];
