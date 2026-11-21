// Page Problem: the problem explained in one minute (data: /api/problem, problem.mjs).
//   1. der Satz: so viele eBay-Angebote haben in 90 Tagen nichts verkauft
//   2. all listings in three groups without overlap: sold / shown, not bought / hardly shown
//   3. warum Sichtbarkeit zuerst kommt: Verkaufschance kaum gezeigt gegen oft gezeigt, typische Impressionen je Gruppe
//   4. der Plan: drei Hebel, der billigste zuerst, gemessen an einer Kontrollgruppe
// Eigene Datei, damit app.js nur ladeProblem() braucht. Nutzt el, zahl, LOCALE aus app.js. Sichtbares englisch, Daten nur als Text.
const Problem = (() => {
  const z = (v) => (v == null ? "–" : Number(v).toLocaleString(LOCALE, { maximumFractionDigits: 0 }));
  const proz = (v) => (v == null ? "–" : Math.round(100 * v) + " %");
  const vonZehn = (v) => (v == null ? "–" : String(Math.round(10 * v)));
  // Typische Werte gerundet auf zwei Stellen (1,502 → 1,500; 179 → 180): mit "~" davor wirkt eine krumme Zahl falsch genau
  const rund = (v) => { if (v == null) return null; if (v < 100) return Math.round(v); const p = 10 ** (Math.floor(Math.log10(v)) - 1); return Math.round(v / p) * p; };
  const schritt = (t) => el("span", { class: "p-schritt", text: t });

  function zeichne(root, d) {
    const g = d.gruppen, n = d.ebayAktiv;
    if (!n) return fuelle(root, el("div", { class: "einstieg" }, el("h1", { text: "Problem" }), el("p", { class: "leise", text: "No active eBay listings in the data yet." })));
    const ohne = g.gezeigtNichtGekauft + g.kaumGezeigt;
    fuelle(root,
      el("div", { class: "einstieg" }, el("h1", { text: "Problem" }),
        el("p", { class: "leise", text: "Our 3D printing shop on eBay, last 90 days. Only eBay listings and eBay sales count here." })),
      held(d, ohne), gruppen(d, ohne), sichtbarkeit(d), plan(d), details(d));
  }

  function held(d, ohne) {
    return el("section", { class: "panel p-held", "aria-label": "The problem in one sentence" },
      schritt("The problem"),
      el("p", { class: "p-satz" }, el("strong", { text: `${z(ohne)} of our ${z(d.ebayAktiv)}` }), " eBay listings sold nothing in the last 90 days."),
      el("p", { class: "leise", text: `That is ${proz(ohne / d.ebayAktiv)} of the shop. For most of them the first problem is not the product: buyers hardly ever see them.` }));
  }

  function gruppen(d, ohne) {
    const g = d.gruppen, n = d.ebayAktiv;
    const teil = (klasse, wert, name) => el("div", { class: klasse, style: `flex:${Math.max(wert, 1)}` }, el("b", { text: z(wert) }), el("span", { text: name }));
    const karte = (klasse, regel, titel, text) => el("div", { class: klasse }, el("span", { class: "regel", text: regel }), el("strong", { text: titel }), el("p", { text }));
    return el("section", { class: "panel" },
      schritt("Why they don't sell"),
      el("h2", { style: "margin-top:4px", text: `All ${z(n)} listings in three groups: each listing is in exactly one` }),
      el("div", { class: "p-teil", role: "img", "aria-label": `${z(n)} listings: ${z(g.verkauft)} selling, ${z(g.gezeigtNichtGekauft)} shown but not bought, ${z(g.kaumGezeigt)} hardly shown and not sold` },
        teil("t-geht", g.verkauft, "Selling"), teil("t-gesehen", g.gezeigtNichtGekauft, "Shown, not bought"), teil("t-unsichtbar", g.kaumGezeigt, "Hardly shown")),
      el("div", { class: "p-klammer", "aria-hidden": "true", style: `grid-template-columns:${Math.max(g.verkauft, 1)}fr ${Math.max(ohne, 1)}fr` },
        el("span", { text: "sold at least once" }), el("span", { class: "rot", text: `${z(ohne)} sold nothing` })),
      el("div", { class: "p-legende3" },
        karte("l-geht", "At least 1 sale", `Selling · ${z(g.verkauft)}`, "Buyers find and buy these. We leave them alone."),
        karte("l-gesehen", `0 sales · ${z(d.grenze90)}+ impressions`, `Shown, not bought · ${z(g.gezeigtNichtGekauft)}`, "Buyers see them in search but do not buy. The offer does not convince."),
        karte("l-unsichtbar", `0 sales · under ${z(d.grenze90)} impressions`, `Hardly shown · ${z(g.kaumGezeigt)}`, `Buyers almost never see them${g.kaumGezeigtNie ? `, ${z(g.kaumGezeigtNie)} not even once` : ""}. The biggest problem group.`)),
      el("p", { class: "p-summe", text: `${z(g.verkauft)} + ${z(g.gezeigtNichtGekauft)} + ${z(g.kaumGezeigt)} = ${z(n)} listings` }),
      el("p", { class: "p-fazit" }, `${z(g.kaumGezeigt)} of the ${z(ohne)} listings that sell nothing never really had a chance: `, el("strong", { text: "buyers hardly ever see them." })));
  }

  function sichtbarkeit(d) {
    const c = d.chance, t = d.typisch;
    const faktor = c.kaum > 0 && c.oft != null ? Math.floor(c.oft / c.kaum) : null;
    const seite = (klasse, wert, titel, unter) => el("div", { class: "p-seite " + klasse }, el("span", { class: "gross" }, vonZehn(wert) + " ", el("small", { text: "out of 10" })), el("strong", { text: titel }), el("small", { class: "leise", text: unter }));
    const mal = t.kaum > 0 && t.verkauft != null ? Math.round(t.verkauft / t.kaum) : null;
    return el("section", { class: "panel" },
      schritt("Why visibility comes first"),
      el("h2", { style: "margin-top:4px", text: "Listings that buyers see are the ones that sell" }),
      el("div", { class: "p-vergleich", role: "img", "aria-label": `Hardly shown listings: ${vonZehn(c.kaum)} out of 10 sell. Often shown listings: ${vonZehn(c.oft)} out of 10 sell.` },
        seite("kaum", c.kaum, "hardly shown listings sell", `under ${z(d.grenze90)} impressions in 90 days`),
        faktor && faktor >= 2 ? el("div", { class: "p-pfeil", "aria-hidden": "true" }, el("b", { text: `${faktor}×` }), "more likely") : el("div", { class: "p-pfeil", "aria-hidden": "true" }),
        seite("oft", c.oft, "often shown listings sell", `${z(c.oftAb)}+ impressions in 90 days`)),
      el("div", { class: "p-rechnung" },
        el("div", {}, el("span", { class: "kpi-titel", text: "A listing that sells" }), el("span", { class: "p-z", text: `~${z(rund(t.verkauft))} impressions` }), el("small", { class: "leise", text: "is typically shown this often in 90 days (median of the selling listings)" })),
        el("div", { class: "rot" }, el("span", { class: "kpi-titel", text: "A hardly shown listing" }), el("span", { class: "p-z", text: `~${z(rund(t.kaum))} impressions` }), el("small", { class: "leise", text: `in the same 90 days (median).${mal && mal >= 2 ? ` About ${mal} times less.` : ""}` }))));
  }

  function plan(d) {
    const phase = (nr, titel, text, kosten) => el("div", { class: "p-phase" }, el("span", { class: "kpi-titel", text: "Phase " + nr }), el("h3", { text: titel }), el("p", { text }), el("span", { class: "p-kosten", text: kosten }));
    return el("section", { class: "panel" },
      schritt("Our plan"),
      el("h2", { style: "margin-top:4px", text: "Three levers to get hardly shown listings in front of buyers, cheapest first" }),
      el("p", { class: "leise klein", style: "margin:4px 0 0", text: `Every listing under ${z(d.grenze90)} impressions can enter: the ${z(d.gruppen.kaumGezeigt)} hardly shown ones above, plus ${z(d.felder.kaumGesehenVerkauft)} that sell a little despite few impressions (${z(d.kaumGesehen)} in total).` }),
      el("div", { class: "p-plan" },
        phase(1, "New title", "AI writes a better title, a rule check removes risky words, an admin approves. Goal: more impressions in eBay search.", "Free"),
        phase(2, "eBay ads", "Promoted Listings push the listing higher in search for listings that are still barely seen.", `${Math.round(100 * d.werbesatz)} % fee, only when it sells`),
        phase(3, "Lower price", "The price goes down one step. This also tests whether the offer, not only visibility, holds sales back.", `−${Math.round(100 * d.preisSchritt)} % on every sale`)),
      el("div", { class: "p-plan-fuss" },
        el("p", { class: "leise", text: "Half of the listings are drawn by lot into a control group and stay unchanged. So we can tell what a phase did, and what a busy week in the whole shop did." }),
        el("div", { class: "p-knoepfe" }, el("a", { class: "knopf", href: "#ergebnisse", text: "See the results" }), el("a", { class: "knopf knopf-akzent", href: "#ladder", text: "Open the Funnel →" }))));
  }

  function details(d) {
    const max = Math.max(1, ...d.stufen.map((s) => s.anzahl));
    const name = (s) => (s.bis == null ? `${z(s.von)}+` : s.von === s.bis ? z(s.von) : `${z(s.von)}–${z(s.bis)}`);
    return el("details", { class: "panel p-details" }, el("summary", { style: "cursor:pointer", text: "How we count" }),
      el("p", { class: "leise", text: `Only active eBay listings (${z(d.ebayAktiv)} of ${z(d.produkte)} products in the catalogue) and their eBay sales and impressions of the last 90 days. Amazon, Etsy and the own shop are left out on purpose.` }),
      el("p", { class: "leise", text: `“Hardly shown” means under ${z(d.grenze90)} impressions in 90 days: the lowest quarter of the shop. The limit moves with the shop, so a quiet season does not make every listing look weak. “Often shown” means ${z(d.chance.oftAb)} impressions or more.` }),
      el("div", { class: "p-saeulen", role: "img", "aria-label": "Listings by impressions in 90 days: " + d.stufen.map((s) => `${z(s.anzahl)} with ${name(s)}`).join(", ") },
        d.stufen.map((s) => el("div", { class: "p-saeule" + (s.unterGrenze ? " unter" : "") }, el("span", { class: "w", text: z(s.anzahl) }), el("span", { class: "bahn" }, el("i", { style: `height:${Math.max(2, (100 * s.anzahl) / max)}%` })), el("small", { text: name(s) })))),
      el("p", { class: "leise klein", text: "Impressions in 90 days per listing. Red: under the limit, these can go into the Funnel." }));
  }

  return { zeichne };
})();
