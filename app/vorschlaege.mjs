// Fertige Anweisungen je Hebel (nur Hebel ohne Kosten: Titel, erstes Bild, Beschreibung/Maße/Versand).
// Bewusst keine Werbung und keine Preisvorschläge. Pro Produkt wird genau EIN Hebel vorgeschlagen,
// weil sich zwei gleichzeitige Änderungen später nicht trennen lassen (Briefing).
//
// Was ein Programm sicher kann und was nicht:
//  - Titel: ein fertiger neuer Titel, aber NUR aus belegten Änderungen (siehe neuerTitel). Es werden keine Fakten erfunden.
//    Gibt es keine sichere Änderung, sagt die App das offen und liefert keinen Titel.
//  - Bild: eine konkrete Aufnahmeanweisung für genau dieses Produkt. Das Foto selbst kann die App nicht erzeugen.
//  - Beschreibung: ein fertiger Text zum Einfügen. Was die App nicht wissen kann (Maße, Material), steht als [Platzhalter].
// Die Hinweise zu Wörtern beruhen auf den eigenen Zahlen des Shops (Korrelation, kein Beweis) und nennen diese Zahlen.
// Texte zum Einfügen in eBay sind deutsch (Sprache der Angebote), die Anweisungen drumherum englisch.
import { istNeu, EINSTELLUNGEN } from "./regeln.mjs";

const wortliste = (titel) => new Set((String(titel || "").toLowerCase().match(/[\p{L}\p{N}-]+/gu) || []).filter((w) => w.length >= 4 && !/^\d+$/.test(w)));
const sauber = (t) => String(t || "").replace(/\s+/g, " ").trim();
const proz = (x) => Math.round(100 * x);
const maskiere = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Lernt aus den Titeln, welche Wörter im Shop mit mehr oder weniger Verkäufen einhergehen.
// Nur Produkte außerhalb der Schonfrist zählen; "verkauft" = mindestens 1 Verkauf in 90 Tagen.
export function lerneTitelWoerter(produkte, einst = EINSTELLUNGEN, jetzt = new Date()) {
  const reif = produkte.filter((p) => !istNeu(p.created_at, jetzt, einst.schonfristTage));
  if (reif.length < 30) return { basis: null, stark: [], schwach: [], woerter: new Map() };
  const basis = reif.filter((p) => (Number(p.units_90d) || 0) > 0).length / reif.length;
  const zaehler = new Map();
  for (const p of reif) {
    const verkauft = (Number(p.units_90d) || 0) > 0;
    for (const w of wortliste(p.title)) {
      const z = zaehler.get(w) || { wort: w, n: 0, verkauft: 0 };
      z.n++; if (verkauft) z.verkauft++;
      zaehler.set(w, z);
    }
  }
  const alle = [...zaehler.values()].map((z) => ({ ...z, quote: z.verkauft / z.n, faktor: z.verkauft / z.n / basis }));
  return {
    basis,
    stark: alle.filter((z) => z.n >= 30 && z.faktor >= 1.15).sort((a, b) => b.faktor - a.faktor).slice(0, 5),
    schwach: alle.filter((z) => z.n >= 100 && z.faktor <= 0.85).sort((a, b) => a.faktor - b.faktor),
    woerter: new Map(alle.map((z) => [z.wort, z])),
  };
}

// Zerlegt "Wandhalterung passend für Velux Integra KLI 310" in Produkt und Zielgerät (ziel kann fehlen).
export function zerlegeTitel(titel, einst = EINSTELLUNGEN) {
  let t = sauber(titel).replace(/^\d+\s?x\s+/i, "");
  const marke = einst.markenname ? new RegExp(`\\s+von\\s+${maskiere(einst.markenname)}\\b`, "gi") : null;
  if (marke) t = t.replace(marke, "");
  const m = t.match(/^(.+?)\s+(?:passend\s+(?:für|zu|zum|zur)|kompatibel\s+(?:mit|zu|für))\s+(.+)$/i);
  const raeume = (s) => s.replace(/\s*[-–,]\s*$/, "").trim();
  if (!m) return { produkt: raeume(t), ziel: null };
  return { produkt: raeume(m[1]), ziel: raeume(m[2]) };
}

// Erzeugt einen neuen Titel nur aus belegten Änderungen. Gibt { neu, gruende } zurück; neu ist null, wenn nichts Sicheres anzuwenden ist.
export function neuerTitel(titel, stat, einst = EINSTELLUNGEN) {
  const alt = sauber(titel);
  let t = alt;
  const gruende = [];
  const max = einst.titelMaxZeichen;
  const wort = (w) => stat.woerter?.get(w);

  // 1. "kompatibel mit/zu/für" -> "passend für", wenn die eigenen Zahlen "passend" klar besser zeigen
  // Nur wenn "passend" noch nicht im Titel steht, sonst entsteht "passend für ... passend für ..."
  const kompat = /\bkompatibel\s+(?:mit|zu|für)\b/i;
  if (kompat.test(t) && !/\bpassend\b/i.test(t) && wort("kompatibel") && wort("passend") && wort("passend").quote > wort("kompatibel").quote) {
    const k = t.replace(kompat, "passend für");
    if (k.length <= max) {
      t = k;
      gruende.push(`"kompatibel" replaced by "passend für": in your shop ${proz(wort("passend").quote)} % of ${wort("passend").n} titles with "passend" sold, but only ${proz(wort("kompatibel").quote)} % of ${wort("kompatibel").n} with "kompatibel". Check that the title still reads well.`);
    }
  }

  // 2. Eigener Markenname am Ende, wenn er fehlt, in den Zahlen als starkes Wort auftaucht und noch Platz ist
  const marke = einst.markenname;
  if (marke && !new RegExp(`(?<![\\p{L}\\p{N}])${maskiere(marke)}(?![\\p{L}\\p{N}])`, "iu").test(t)) {
    const z = wort(marke.toLowerCase());
    if (z && stat.stark.some((s) => s.wort === z.wort)) {
      const k = `${t} von ${marke}`;
      if (k.length <= max) {
        t = k;
        gruende.push(`"von ${marke}" added: ${proz(z.quote)} % of ${z.n} titles with "${marke}" sold (shop average ${proz(stat.basis)} %). It is your own brand, so it is true for every product. Buyers may not search for the brand name, so treat this as a small test and check the result in the change log.`);
      }
    }
  }

  // 3. Doppelte Wörter direkt hintereinander entfernen
  const ohneDoppelte = t.replace(/(?<![\p{L}\p{N}])([\p{L}\p{N}]{4,})\s+\1(?![\p{L}\p{N}])/giu, "$1");
  if (ohneDoppelte !== t) { t = ohneDoppelte; gruende.push("A word that appeared twice in a row was removed."); }

  return t === alt ? { neu: null, gruende: [] } : { neu: t, gruende };
}

const HINWEIS = "Change only this one thing, then wait for new data before changing anything else.";

function titelVorschlag(p, stat, einst) {
  const alt = sauber(p.title);
  const { neu, gruende } = neuerTitel(alt, stat, einst);
  if (neu) {
    return { hebel: "titel", anweisung: "Replace the title with this text:", alt, neu, laenge: neu.length, schritte: [], gruende, hinweis: HINWEIS };
  }
  const frei = einst.titelMaxZeichen - alt.length;
  return {
    hebel: "titel", anweisung: "No safe automatic title was found. Rework the title by hand:", alt, neu: null,
    schritte: [
      `The title uses ${alt.length} of ${einst.titelMaxZeichen} characters${frei >= 10 ? `, so ${frei} are free` : ""}.`,
      "Take the model number, part number or product type from the product itself and put it near the start of the title. Do not add words that do not describe the product.",
    ],
    gruende: [], hinweis: HINWEIS,
  };
}

function bildVorschlag(p, einst) {
  const { produkt, ziel } = zerlegeTitel(p.title, einst);
  const schritte = [
    `Take a new first photo of "${produkt}": the product alone on a plain white or light background, filling about 80 % of the frame, sharp, evenly lit, with no text or logo on the image.`,
  ];
  if (ziel) schritte.push(`Add a second photo of the part mounted on or next to "${ziel}", so buyers see at once that it fits.`);
  schritte.push("Put the new photo first. Leave the title, description and everything else unchanged.");
  return { hebel: "bild", anweisung: "Do this:", alt: null, neu: null, schritte, gruende: ["I cannot see or create the photo itself. I only know that the listing is shown often but opened rarely, and the first photo and the title decide that."], hinweis: HINWEIS };
}

// Beschreibung zum Einfügen (deutsch). Unbekanntes bleibt als [Platzhalter] stehen, nichts wird erfunden.
function angebotVorschlag(p, einst) {
  const { produkt, ziel } = zerlegeTitel(p.title, einst);
  const text = [
    `${produkt}${ziel ? ` passend für ${ziel}` : ""}`,
    "",
    `Passend für: ${ziel || "[Modelle und Teilenummern eintragen]"}`,
    "Maße: [Länge x Breite x Höhe in mm eintragen]",
    "Material: [Material eintragen]",
    "Lieferumfang: [Anzahl und Zubehör eintragen]",
    "Montage: [in ein bis zwei Sätzen beschreiben]",
    "Versand: [Versandart und Lieferzeit eintragen]",
  ].join("\n");
  return {
    hebel: "angebot", anweisung: "Put this text at the start of the description and fill in every [bracket] from the product:", alt: null, neu: text,
    schritte: ["Check the shipping costs and the delivery time in the listing as well. They are part of the buying decision."],
    gruende: ["I do not know the dimensions, the material or the contents, so those lines are placeholders. Do not publish with brackets left in."], hinweis: HINWEIS,
  };
}

// p: Produkt mit .gruppe (aus bewerte). Gibt null zurück, wenn keine Maßnahme nötig ist.
export function schlageVor(p, stat, einst = EINSTELLUNGEN) {
  switch (p.gruppe) {
    case "sichtbarkeit": return titelVorschlag(p, stat, einst);
    case "klicks": return bildVorschlag(p, einst);
    case "kaufentscheidung": return angebotVorschlag(p, einst);
    default: return null;
  }
}
