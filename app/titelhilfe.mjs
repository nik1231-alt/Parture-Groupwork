// Title help: for a listing shows words that often occur in the own most-seen listings but are missing in this title.
// The app invents no titles (rule from the briefing). It delivers only evidence-based hints from the own data, which a human checks and adopts.
// Evidence per word: in how many titles of the upper group it appears, and in how many of the rest. A word counts only if the upper group has it
// clearly more often, so that it could have something to do with visibility (correlation, not proof: that is exactly what the tests are for).
import { TITEL_MAX_ZEICHEN } from "./regeln.mjs";

const STOPP = new Set(("und oder mit ohne für fuer der die das den dem des ein eine einen einem einer von zum zur im in am an auf aus bei nach vor über ueber unter the and for with set stück stueck st pcs").split(" "));
const MIN_TOP = 5;            // so many listings the upper group needs at least, otherwise there are no hints
const ANTEIL_TOP = 0.2;       // the top 20 % by impressions
const MIN_ANTEIL = 0.25;      // the word is in at least a quarter of the upper titles (weaker patterns are noise, e.g. a brand word)
const MIN_VORSPRUNG = 0.1;    // and in at least 10 percentage points more than in the rest

export const woerter = (titel) => [...new Set(String(titel ?? "").toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}-]*/gu) || [])].filter((w) => w.length >= 3 && !STOPP.has(w) && !/^\d+$/.test(w));

// produkte: as from bewertung.ladeProdukte (number, title, impressionen_90d). Returns { ok, hinweise: [{ wort, top, rest }], basis } or { ok:false, grund }.
export function hinweiseFuer(produkte, nummer, { max = 6, titelMax = TITEL_MAX_ZEICHEN } = {}) {
  const p = produkte.find((x) => String(x.number) === String(nummer));
  if (!p) return { ok: false, grund: "unknown product" };
  const mitDaten = produkte.filter((x) => x.title && Number(x.impressionen_90d) > 0).sort((a, b) => b.impressionen_90d - a.impressionen_90d);
  const nTop = Math.max(MIN_TOP, Math.ceil(mitDaten.length * ANTEIL_TOP));
  if (mitDaten.length < nTop * 2) return { ok: false, grund: "not enough listings with traffic data yet" };
  const top = mitDaten.slice(0, nTop), rest = mitDaten.slice(nTop).filter((x) => x.number !== p.number);
  const zaehle = (liste) => { const m = new Map(); for (const x of liste) for (const w of woerter(x.title)) m.set(w, (m.get(w) || 0) + 1); return m; };
  const t = zaehle(top), r = zaehle(rest);
  const eigene = new Set(woerter(p.title));
  const hinweise = [...t].map(([wort, n]) => ({ wort, top: n / top.length, rest: (r.get(wort) || 0) / Math.max(1, rest.length) }))
    .filter((h) => !eigene.has(h.wort) && h.top >= MIN_ANTEIL && h.top - h.rest >= MIN_VORSPRUNG)
    .sort((a, b) => (b.top - b.rest) - (a.top - a.rest) || (a.wort < b.wort ? -1 : 1))
    .slice(0, max).map((h) => ({ wort: h.wort, top: Math.round(h.top * 100), rest: Math.round(h.rest * 100) }));
  const frei = Math.max(0, titelMax - String(p.title ?? "").length);
  return { ok: true, hinweise, basis: { top: top.length, rest: rest.length }, freieZeichen: frei };
}
