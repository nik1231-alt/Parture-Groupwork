// Titelhilfe: zeigt zu einem Angebot Wörter, die in den eigenen, am häufigsten gesehenen Angeboten oft vorkommen, in diesem Titel aber fehlen.
// Die App erfindet keine Titel (Vorgabe aus dem Briefing). Sie liefert nur belegte Hinweise aus den eigenen Daten, die ein Mensch prüft und übernimmt.
// Beleg je Wort: in wie vielen Titeln der oberen Gruppe es steht, und in wie vielen der übrigen. Ein Wort zählt nur, wenn die obere Gruppe es
// deutlich öfter hat, es also etwas mit Sichtbarkeit zu tun haben könnte (Korrelation, kein Beweis: genau dafür gibt es die Tests).
const STOPP = new Set(("und oder mit ohne für fuer der die das den dem des ein eine einen einem einer von zum zur im in am an auf aus bei nach vor über ueber unter the and for with set stück stueck st pcs").split(" "));
const MIN_TOP = 5;            // so viele Angebote braucht die obere Gruppe mindestens, sonst gibt es keine Hinweise
const ANTEIL_TOP = 0.2;       // die oberen 20 % nach Impressionen
const MIN_ANTEIL = 0.25;      // das Wort steht in mindestens einem Viertel der oberen Titel (schwächere Muster sind Rauschen, z. B. ein Markenwort)
const MIN_VORSPRUNG = 0.1;    // und in mindestens 10 Prozentpunkten mehr als in den übrigen

export const woerter = (titel) => [...new Set(String(titel ?? "").toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}-]*/gu) || [])].filter((w) => w.length >= 3 && !STOPP.has(w) && !/^\d+$/.test(w));

// produkte: wie aus bewertung.ladeProdukte (number, title, impressionen_90d). Liefert { ok, hinweise: [{ wort, top, rest }], basis } oder { ok:false, grund }.
export function hinweiseFuer(produkte, nummer, { max = 6, titelMax = 80 } = {}) {
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
