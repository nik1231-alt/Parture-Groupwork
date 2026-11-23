// Page Results, part "Day by day": what each phase of the ladder brought, measured against the control group (data: /api/dashboard, ergebnisse.mjs).
// A file of its own, so that app.js (being rebuilt in parallel) needs only the menu item and the call Dashboard.lade().
// Uses the helpers from app.js (el, fuelle, api, zeigeFehler, LOCALE). Texts from data only as text, never as HTML. Visible text is English.
const Dashboard = (() => {
  const NS = "http://www.w3.org/2000/svg";
  const sv = (tag, attrs = {}, ...kinder) => {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, String(v));
    for (const k of kinder.flat()) if (k != null) n.append(k);
    return n;
  };
  const st = (x, y, t, klasse, anker = "middle") => { const n = sv("text", { x, y, class: "d-text " + klasse, "text-anchor": anker }); n.textContent = t; return n; };
  const z = (v, d = 0) => (v == null ? "–" : Number(v).toLocaleString(LOCALE, { minimumFractionDigits: d, maximumFractionDigits: d }));
  const vz = (v) => (v == null ? "n/a" : (Math.round(100 * v) === 0 ? "" : v > 0 ? "+" : "−") + Math.abs(Math.round(100 * v)).toLocaleString(LOCALE) + " %");
  const pzt = (v) => (v == null || !Number.isFinite(v) ? "–" : (100 * v).toLocaleString(LOCALE, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + " %");
  const tagText = (t) => (t ? new Date(t + "T12:00:00Z").toLocaleDateString(LOCALE) : "–");
  const quote = (a, b) => (b > 0 ? a / b : null);

  let daten = null, gewaehlt = "titel";
  const NAME = { titel: "Phase 1", werbung: "Phase 2", preis: "Phase 3" };
  const hebel = (s) => ({ titel: "New title", werbung: `Ads ${Math.round(100 * daten.einst.werbesatz)} %`, preis: `Price −${Math.round(100 * daten.einst.preisSchritt)} %` })[s];
  const AUFWAND = { titel: ["Free", "only the title text changes"], werbung: ["Fee on sale", "eBay charges only when the listing sells"], preis: ["Lower price", "less income on every sale"] };
  const STATUS = { fertig: ["gut", "Final"], laeuft: ["warn", "Preliminary"], geplant: ["grau", "Planned"] };
  const kachel = (titel, wert, unter, klasse = "") => el("div", { class: "kpi " + klasse }, el("div", { class: "kpi-titel", text: titel }), el("div", { class: "kpi-wert", text: wert }), unter ? el("div", { class: "kpi-unter", text: unter }) : null);

  async function lade() {
    const root = $("#ansicht-dashboard");
    try { daten = await api("/api/dashboard"); zeichne(); } catch (e) { zeigeFehler(e, lade); fuelle(root); }
  }

  function zeichne() {
    const root = $("#ansicht-dashboard");
    const tabs = [...daten.phasen.map((p) => ({ key: p.stufe, text: `${NAME[p.stufe]} · ${hebel(p.stufe)}`, klein: { fertig: "final", laeuft: "running", geplant: "planned" }[p.status] })), { key: "alle", text: "All phases", klein: "compare" }];
    const p = daten.phasen.find((x) => x.stufe === gewaehlt);
    fuelle(root,
      el("div", { class: "einstieg" }, el("h2", { text: "Day by day" }),
        el("p", { class: "leise", text: "What each phase of the ladder did, measured against the control group over the same days. Pick a phase to see its numbers. Results update every day while a phase runs and are marked preliminary until its waiting time is over." })),
      el("div", { class: "tabs r-phasen", role: "tablist", "aria-label": "Phase" }, tabs.map((t) => el("button", { class: "tab", type: "button", role: "tab", "aria-selected": String(gewaehlt === t.key), onclick: () => { gewaehlt = t.key; zeichne(); } },
        el("span", { text: t.text }), el("small", { text: t.klein })))),
      gewaehlt === "alle" ? alle() : p.status === "geplant" ? geplant(p) : !p.mitDaten ? wartet(p) : phase(p),
      methodik());
  }

  // ---------- one phase ----------
  function phase(p) {
    return [antwort(p), kpis(p), p.kurve.some((k) => k.tag > 0 && k.test != null) ? kurve(p) : null, gruppen(p)];
  }
  function antwort(p) {
    const n = p.netto.imp, vorl = p.status === "laeuft", ziel = daten.einst.besserAb;
    const urteil = n == null ? ["grau", "No control group"] : n >= ziel ? ["gut", "Clearly better"] : n <= -ziel ? ["schlecht", "Worse"] : ["grau", "No clear difference yet"];
    const satz = n == null
      ? el("p", { class: "r-satz neutral" }, `${NAME[p.stufe]} (${hebel(p.stufe).toLowerCase()}): impressions per day went from ${z(p.test.vorher.imp, 1)} to ${z(p.test.nachher.imp, 1)} per listing.`)
      : el("p", { class: "r-satz" + (Math.abs(n) < ziel ? " neutral" : "") }, `${NAME[p.stufe]} (${hebel(p.stufe).toLowerCase()}): `, el("strong", { text: `${vz(n)} impressions` }), ` against the control group${vorl ? " so far" : ""}.`);
    return el("section", { class: "panel r-antwort", "aria-label": "Answer" },
      el("div", { class: "r-meta" },
        el("span", { class: "status " + (vorl ? "warn" : "gut"), text: vorl ? "Preliminary" : "Final" }),
        el("span", { class: "status " + urteil[0], text: urteil[1] }),
        el("span", { class: "leise klein", text: `Day ${p.gelaufen} of ${p.tage} · started ${tagText(p.start)} · ${p.angebote} listings vs. ${p.kontrolleAnzahl} in the control group` })),
      satz,
      el("div", { class: "r-fortschritt", role: "progressbar", "aria-label": "Waiting time", "aria-valuenow": p.gelaufen, "aria-valuemin": 0, "aria-valuemax": p.tage }, el("i", { style: `width:${Math.min(100, (100 * p.gelaufen) / Math.max(1, p.tage))}%` })),
      p.ohneKontrolle ? el("p", { class: "leise klein", style: "margin:0", text: `${p.ohneKontrolle} listings have no control group over the same days, so the net effect is not shown.` }) : null);
  }
  function kpis(p) {
    const k = p.kontrolle, n = p.netto.imp, ziel = daten.einst.besserAb;
    const ctrT = quote(p.test.nachher.auf, p.test.nachher.imp), ctrK = k ? quote(k.nachher.auf, k.nachher.imp) : null;
    const schutz = p.verkaeufe.test === 0 && p.verkaeufe.kontrolle === 0 ? ["No sales yet", "grau"] : p.verkaeufe.test >= p.verkaeufe.kontrolle * 0.8 ? ["No drop", "gut"] : ["Check", "warn"];
    return el("div", { class: "kpis" },
      kachel("Net effect, impressions", vz(n), "after ÷ before, against the control group", n != null && n >= ziel ? "gut" : "phase"),
      kachel("Impressions per listing / day", `${z(p.test.vorher.imp, 1)} → ${z(p.test.nachher.imp, 1)}`, k ? `control group: ${z(k.vorher.imp, 1)} → ${z(k.nachher.imp, 1)}` : "no control group", "phase"),
      kachel("Click rate", pzt(ctrT), k ? `control group: ${pzt(ctrK)} · net effect on views ${vz(p.netto.auf)}` : "views ÷ impressions", "kontrolle"),
      kachel("Listings improved", `${p.besser} of ${p.mitDaten}`, `${p.schlechter} worse · so not one outlier`),
      kachel("Sales (safeguard)", schutz[0], `${z(p.verkaeufe.test)} in the phase vs. ${z(p.verkaeufe.kontrolle, p.verkaeufe.kontrolle % 1 ? 1 : 0)} in the control group`, schutz[1]));
  }
  function kurve(p) {
    const pk = p.kurve.filter((k) => k.test != null || k.kontrolle != null);
    const B = 760, H = 300, li = 44, re = 54, ob = 24, un = 40, n = pk.length;
    const werte = pk.flatMap((k) => [k.test, k.kontrolle]).filter((v) => v != null);
    const lo = Math.floor(Math.min(80, ...werte) / 10) * 10, hi = Math.ceil(Math.max(120, ...werte) / 10) * 10, schritt = hi - lo > 80 ? 20 : 10;
    const x = (i) => li + ((B - li - re) * i) / Math.max(1, n - 1), y = (v) => ob + (H - ob - un) * (1 - (v - lo) / (hi - lo));
    const pfad = (f) => pk.map((k, i) => (k[f] == null ? null : [x(i), y(k[f])])).filter(Boolean).map(([a, b], i) => `${i ? "L" : "M"}${a.toFixed(1)},${b.toFixed(1)}`).join(" ");
    const erster = pk.findIndex((k) => k.tag > 0), startX = erster > 0 ? (x(erster - 1) + x(erster)) / 2 : x(0);
    const teile = [sv("rect", { x: li, y: ob, width: Math.max(0, startX - li), height: H - ob - un, class: "r-vorher" })];
    for (let v = lo; v <= hi; v += schritt) teile.push(sv("line", { x1: li, x2: B - re, y1: y(v), y2: y(v), class: "d-gitter" }), st(li - 8, y(v) + 4, z(v), "d-klein", "end"));
    const nach = pk.map((k, i) => ({ ...k, i })).filter((k) => k.tag > 0 && k.test != null && k.kontrolle != null);
    if (nach.length) {
      const davor = pk[erster - 1];
      const a = davor && davor.test != null && davor.kontrolle != null ? [{ ...davor, i: erster - 1 }, ...nach] : nach;
      teile.push(sv("polygon", { points: [...a.map((k) => `${x(k.i).toFixed(1)},${y(k.test).toFixed(1)}`), ...a.map((k) => `${x(k.i).toFixed(1)},${y(k.kontrolle).toFixed(1)}`).reverse()].join(" "), class: "r-luecke" }));
    }
    teile.push(sv("line", { x1: startX, x2: startX, y1: ob - 6, y2: H - un, class: "r-start" }), st(startX + 6, ob + 6, `${NAME[p.stufe]} live`, "d-gruppe", "start"));
    if (erster > 1) teile.push(st((li + startX) / 2, H - un - 10, "before: baseline = 100", "d-klein"));
    teile.push(sv("path", { d: pfad("kontrolle"), class: "r-linie-ctrl" }), sv("path", { d: pfad("test"), class: "r-linie-test" }));
    const letzt = pk[n - 1];
    // Labels at the end at least 14 px apart, the higher one moved up
    let yt = letzt.test != null ? y(letzt.test) : null, yk = letzt.kontrolle != null ? y(letzt.kontrolle) : null;
    if (yt != null && yk != null && Math.abs(yt - yk) < 14) { const m = (yt + yk) / 2, oben = letzt.test >= letzt.kontrolle; yt = m + (oben ? -7 : 7); yk = m + (oben ? 7 : -7); }
    if (letzt.kontrolle != null) teile.push(sv("circle", { cx: x(n - 1), cy: y(letzt.kontrolle), r: 4.5, class: "r-punkt-ctrl" }), st(x(n - 1) + 8, yk + 4, z(letzt.kontrolle), "d-wert kontrolle", "start"));
    if (letzt.test != null) teile.push(sv("circle", { cx: x(n - 1), cy: y(letzt.test), r: 5, class: "r-punkt-test" }), st(x(n - 1) + 8, yt + 4, z(letzt.test), "d-wert phase", "start"));
    pk.forEach((k, i) => { if (k.tag < 0 && (k.tag % 2 === 0) && k.tag !== -1) return; teile.push(st(x(i), H - un + 18, `D${k.tag}`, "d-klein")); });
    teile.push(sv("line", { x1: li, x2: B - re, y1: H - un, y2: H - un, class: "d-achse" }));
    return el("section", { class: "panel" },
      el("div", { class: "kopf-zeile" }, el("div", {}, el("h2", { text: "Impressions per day, phase group vs. control group" }),
        el("p", { class: "leise klein", style: "margin:0", text: "Both groups start at 100 (their average in the 7 days before the phase). The shaded area is the gap between the two groups: if the phase line runs above the control line, the phase added visibility on top of the season. Each listing is aligned to its own start day." })),
        el("div", { class: "r-legende" }, el("span", {}, el("i", { class: "r-test" }), `${NAME[p.stufe]} group`), el("span", {}, el("i", { class: "r-ctrl" }), "Control group"))),
      el("div", { class: "d-rahmen", style: "margin-top:12px" },
        sv("svg", { viewBox: `0 0 ${B} ${H}`, class: "r-svg", role: "img", "aria-label": `Impressions per day, indexed to 100 before the phase. Phase group at ${z(letzt.test)}, control group at ${z(letzt.kontrolle)} on day ${letzt.tag}.` }, ...teile)));
  }
  function gruppen(p) {
    const k = p.kontrolle;
    const reihe = (name, wert, max, klasse, text) => el("div", { class: "r-reihe" }, el("span", { text: name }), el("span", { class: "r-balken" }, el("i", { class: klasse, style: `width:${max > 0 ? Math.max(2, (100 * (wert || 0)) / max) : 2}%` })), el("span", { class: "zahl", text }));
    const block = (titel, unter, t, c, fmt) => { const max = Math.max(t || 0, c || 0); return el("div", { class: "r-block" }, el("h3", { text: titel }), el("p", { class: "leise klein", style: "margin:0 0 4px", text: unter }),
      reihe(NAME[p.stufe], t, max, "r-test", fmt(t)), k ? reihe("Control", c, max, "r-ctrl", fmt(c)) : null); };
    const links = el("section", { class: "panel" }, el("h2", { text: "Seen, clicked, bought" }),
      el("p", { class: "leise klein", text: "Since the start of the phase, per listing and day. A better title should first be seen more often, then clicked more often." }),
      block("Impressions", "how often buyers see the listing in search", p.test.nachher.imp, k?.nachher.imp, (v) => z(v, 1)),
      block("Click rate", "views ÷ impressions", quote(p.test.nachher.auf, p.test.nachher.imp), k ? quote(k.nachher.auf, k.nachher.imp) : null, pzt),
      block("Sales in the phase", "too few to judge, used as a safeguard only", p.verkaeufe.test, p.verkaeufe.kontrolle, (v) => z(v, v % 1 ? 1 : 0)));
    const punkte = el("div", { class: "r-punkte", role: "img", "aria-label": `${p.besser} better, ${p.schlechter} worse, ${p.gleich} about the same` });
    for (let i = 0; i < p.mitDaten; i++) punkte.append(el("span", { class: i < p.besser ? "besser" : i < p.besser + p.schlechter ? "schlechter" : null }));
    const rechts = el("section", { class: "panel" }, el("h2", { text: "Is it every listing or just one?" }),
      el("p", { class: "leise klein", text: "Each square is one listing of the phase, compared with its own impressions in the 30 days before. From ±10 % it counts as better or worse." }),
      punkte,
      el("div", { class: "r-legende", style: "margin-bottom:12px" }, el("span", { text: `${p.besser} better` }), el("span", { text: `${p.schlechter} worse` }), el("span", { text: `${p.gleich} about the same` })),
      el("div", { class: "r-block" }, el("h3", { text: "Seen again" }),
        el("p", { class: "leise klein", style: "margin:0", text: p.status === "fertig" ? `${p.erholt} listings climbed above the low-impressions line and left the ladder. The others move on to the next phase.` : "Counted when the waiting time is over." })));
    return el("div", { class: "r-zwei" }, links, rechts);
  }
  function geplant(p) {
    return el("div", { class: "r-leer" }, el("span", { class: "status", text: "Planned" }),
      el("h2", { text: `${NAME[p.stufe]} · ${hebel(p.stufe)} has not started yet` }),
      el("p", { class: "leise", style: "margin:0;max-width:60ch", text: `It starts when an admin approves the first listing for this phase. Each listing then runs for ${p.tage} days. This page shows the same numbers as for the other phases: net effect, daily curve, click rate and how many listings improved.` }));
  }
  function wartet(p) {
    return el("div", { class: "r-leer" }, el("span", { class: "status warn", text: "Running" }),
      el("h2", { text: `${NAME[p.stufe]} started on ${tagText(p.start)} with ${p.angebote} listings` }),
      el("p", { class: "leise", style: "margin:0;max-width:60ch", text: `The first numbers appear once eBay traffic for the days after the start is complete (traffic up to ${tagText(daten.trafficBis)}).` }));
  }

  // ---------- all phases ----------
  function alle() {
    const mitWert = daten.phasen.filter((p) => p.netto?.imp != null);
    const ziel = daten.einst.besserAb;
    const gewinner = mitWert.filter((p) => p.status === "fertig" && p.netto.imp >= ziel).sort((a, b) => b.netto.imp - a.netto.imp)[0];
    const hoechster = [...mitWert].sort((a, b) => b.netto.imp - a.netto.imp)[0];
    const max = Math.max(daten.einst.besserAb, ...mitWert.map((p) => Math.abs(p.netto.imp)));
    const zeile = (p) => {
      const n = p.netto?.imp ?? null, s = STATUS[p.status];
      return el("div", { class: "r-hebel-zeile" },
        el("div", {}, el("strong", { text: `${NAME[p.stufe]} · ${hebel(p.stufe)}` }), el("div", {}, el("span", { class: "status " + s[0], text: s[1] }))),
        el("div", { class: "r-balken", "aria-hidden": "true" }, n == null ? null : el("i", { class: n >= ziel ? null : "grau", style: `width:${Math.max(2, (100 * Math.max(0, n)) / max)}%` })),
        el("div", { class: "zahl", text: n == null ? "–" : vz(n) }),
        el("div", { class: "r-aufwand" }, el("div", { text: AUFWAND[p.stufe][0] }), el("div", { class: "leise klein", text: AUFWAND[p.stufe][1] })));
    };
    const s = daten.summe;
    return [
      el("section", { class: "panel r-antwort" },
        el("div", { class: "r-meta" }, el("span", { class: "status " + (gewinner ? "gut" : hoechster ? "warn" : "grau"), text: gewinner ? "Recommendation" : hoechster ? "No clear winner yet" : "No results yet" })),
        gewinner
          ? el("p", { class: "r-satz" }, `Best lever: ${NAME[gewinner.stufe]} (${hebel(gewinner.stufe).toLowerCase()}) with `, el("strong", { text: `${vz(gewinner.netto.imp)} impressions` }), " against the control group.")
          : hoechster
            ? el("p", { class: "r-satz neutral" }, `No lever has reached +${Math.round(100 * ziel)} % yet. Highest so far: ${NAME[hoechster.stufe]} (${hebel(hoechster.stufe).toLowerCase()}) with `, el("strong", { text: vz(hoechster.netto.imp) }), `${hoechster.status === "fertig" ? "" : ", still running"}.`)
            : el("p", { class: "r-satz neutral", text: "No phase has numbers yet. Results appear here as soon as the first phase has a few days of traffic data." }),
        el("p", { class: "leise", style: "margin:0", text: "The levers run in a fixed order, cheapest first: a new title is free, ads cost only on a sale, a lower price costs on every sale. Every result is measured against the same control group." })),
      el("div", { class: "kpis" },
        kachel("Listings on the ladder", z(s.aufLeiter), "drawn by lot from the eligible listings", "phase"),
        kachel("Control group", z(s.kontrolle), "unchanged on eBay", "kontrolle"),
        kachel("Seen again", z(s.erholt), "left the ladder after a phase", "gut"),
        kachel("Changes on eBay", z(s.aenderungenEbay), "every one approved by an admin")),
      el("section", { class: "panel" }, el("h2", { text: "Which lever works?" }),
        el("p", { class: "leise klein", text: "Net effect on impressions against the control group." }),
        el("div", { class: "r-hebel" }, daten.phasen.map(zeile)))];
  }
  function methodik() {
    return el("details", { class: "panel r-methodik" }, el("summary", { style: "cursor:pointer", text: "How we measure" }),
      el("p", { class: "leise", text: "Listings with low impressions are drawn by lot. Half climb the ladder, half stay unchanged as the control group. Both groups are measured over the same days, so a busy week in the whole shop does not count as success." }),
      el("p", { class: "leise", text: `Net effect = (phase group after ÷ before) ÷ (control group after ÷ before) − 1, with "before" = the 30 days before the start. From +${Math.round(100 * daten.einst.besserAb)} % a phase counts as clearly better. Traffic comes from the eBay Analytics API with a delay of a few days, so the numbers are final. Only eBay data is used.` }));
  }
  return { lade };
})();
