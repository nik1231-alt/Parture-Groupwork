// Diagramme für die Testauswertung, als reines SVG ohne Zusatzpakete.
// Texte kommen nur über textContent in die Seite, nie als HTML. Farben stehen in app.css (Klassen d-*), damit helle und dunkle Darstellung passen.
const Diagramm = (() => {
  const NS = "http://www.w3.org/2000/svg";
  const L = "en-GB";
  const s = (tag, attrs = {}, ...kinder) => {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) if (v != null && v !== false) n.setAttribute(k, String(v));
    for (const k of kinder.flat()) if (k != null) n.append(k);
    return n;
  };
  const text = (x, y, t, klasse, anker = "middle") => { const n = s("text", { x, y, class: "d-text " + klasse, "text-anchor": anker }); n.textContent = t; return n; };
  const zahl = (v) => Number(v).toLocaleString(L);
  const proz = (v, vorzeichen = true) => { if (v == null) return "n/a"; const r = Math.round(100 * v); return (vorzeichen && r > 0 ? "+" : "") + (r === 0 ? 0 : r).toLocaleString(L) + " %"; };
  const klemme = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  // ---- 1. Säulen: Impressionen vorher und nachher, Testgruppe und Kontrollgruppe nebeneinander
  function saeulen(a) {
    const B = 560, H = 250, links = 20, rechts = 20, oben = 34, unten = 62;
    const gruppen = [["Test group", a.test, "d-test"], ["Control group", a.kontrolle, "d-kontrolle"]];
    const max = Math.max(1, ...gruppen.flatMap(([, g]) => [g.vorher.imp, g.nachher.imp])) * 1.12;
    const y = (v) => oben + (H - oben - unten) * (1 - v / max);
    const grund = H - unten;
    const breite = (B - links - rechts) / gruppen.length, sw = 64, luecke = 14;
    const teile = [s("line", { x1: links, x2: B - rechts, y1: grund, y2: grund, class: "d-achse" })];
    gruppen.forEach(([name, g, klasse], i) => {
      const mitte = links + breite * i + breite / 2;
      [["Before", g.vorher.imp, "d-vorher", mitte - sw - luecke / 2], ["After", g.nachher.imp, klasse, mitte + luecke / 2]].forEach(([beschr, wert, k, x]) => {
        const h = Math.max(wert > 0 ? 2 : 0, grund - y(wert));
        teile.push(s("rect", { x, y: grund - h, width: sw, height: h, rx: 4, class: k }), text(x + sw / 2, grund - h - 7, zahl(wert), "d-wert"), text(x + sw / 2, grund + 16, beschr, "d-klein"));
      });
      teile.push(text(mitte, grund + 38, `${name} (${g.anzahl} listings)`, "d-gruppe"), text(mitte, grund + 54, `${proz(g.aenderung.imp)} impressions`, "d-aenderung " + ((g.aenderung.imp ?? 0) >= 0 ? "d-plus" : "d-minus")));
    });
    return s("svg", { viewBox: `0 0 ${B} ${H}`, class: "diagramm", role: "img", "aria-label": `Impressions before and after. Test group: ${zahl(a.test.vorher.imp)} to ${zahl(a.test.nachher.imp)}. Control group: ${zahl(a.kontrolle.vorher.imp)} to ${zahl(a.kontrolle.nachher.imp)}.` }, teile);
  }

  // ---- 2. Skala: Nettoeffekt gegenüber der Kontrollgruppe, mit den Grenzen für „besser" und „schlechter"
  function skala(a) {
    const B = 560, H = 150, links = 130, rechts = 28;
    const { besserAb, schutzGrenze } = a.skala;
    const werte = [a.netto.imp, a.netto.trans].map((v) => v ?? 0);
    const lo = Math.min(-0.6, ...werte.map((v) => v - 0.1)), hi = Math.max(1, ...werte.map((v) => v + 0.1));
    const x = (v) => links + (B - links - rechts) * ((klemme(v, lo, hi) - lo) / (hi - lo));
    // Jede Zeile besteht aus Zonen [von, bis, Beschriftung, Klasse]
    const zeilen = [
      { name: "Impressions", wert: a.netto.imp, y: 46, zonen: [[lo, -besserAb, "worse", "d-zone-schlecht"], [-besserAb, besserAb, "no difference proven", "d-zone-mitte"], [besserAb, hi, "better", "d-zone-gut"]] },
      { name: "Sales (protection)", wert: a.netto.trans, y: 108, zonen: [[lo, -schutzGrenze, "too low", "d-zone-schlecht"], [-schutzGrenze, hi, "OK", "d-zone-gut"]] },
    ];
    const teile = [];
    for (const z of zeilen) {
      const y0 = z.y - 11, h = 22;
      teile.push(text(links - 12, z.y + 4, z.name, "d-gruppe", "end"));
      for (const [von, bis, beschr, klasse] of z.zonen) {
        teile.push(s("rect", { x: x(von), y: y0, width: Math.max(0, x(bis) - x(von)), height: h, class: klasse }));
        if (x(bis) - x(von) > 70) teile.push(text((x(von) + x(bis)) / 2, z.y + 25, beschr, "d-klein"));
      }
      teile.push(s("line", { x1: x(0), x2: x(0), y1: y0 - 3, y2: y0 + h + 3, class: "d-null" }));
      if (z.wert != null) {
        const aussen = z.wert < lo || z.wert > hi;
        teile.push(s("circle", { cx: x(z.wert), cy: z.y, r: 8, class: "d-marke" + (aussen ? " d-aussen" : "") }), text(x(z.wert), z.y - 17, proz(z.wert), "d-wert"));
      } else teile.push(text(x(0), z.y - 17, "n/a", "d-klein"));
    }
    [-0.5, 0, 0.5, 1].filter((t) => t >= lo && t <= hi).forEach((t) => teile.push(text(x(t), H - 4, proz(t), "d-klein")));
    return s("svg", { viewBox: `0 0 ${B} ${H}`, class: "diagramm", role: "img", "aria-label": `Net effect compared with the control group: impressions ${proz(a.netto.imp)} (goal at least ${proz(besserAb)}), sales ${proz(a.netto.trans)} (must not fall below ${proz(-schutzGrenze)}).` }, teile);
  }

  // ---- 3. Punkte: Veränderung jedes einzelnen Angebots (damit ein Ausreißer allein kein Urteil trägt)
  function punkte(a) {
    const B = 560, H = 190, links = 130, rechts = 28, lo = -1, hi = 3;
    const x = (v) => links + (B - links - rechts) * ((klemme(v, lo, hi) - lo) / (hi - lo));
    const zeilen = [["Test group", a.test, "d-test", 56], ["Control group", a.kontrolle, "d-kontrolle", 118]];
    const teile = [];
    [-1, 0, 1, 2, 3].forEach((t) => { teile.push(s("line", { x1: x(t), x2: x(t), y1: 22, y2: H - 26, class: t === 0 ? "d-null" : "d-gitter" }), text(x(t), H - 8, proz(t), "d-klein")); });
    for (const [name, g, klasse, y] of zeilen) {
      teile.push(text(links - 12, y + 4, name, "d-gruppe", "end"));
      const mitWert = g.punkte.filter((p) => p.aenderung != null);
      mitWert.forEach((p, i) => {
        const ruettel = ((i * 37) % 7 - 3) * 4.2; // feste Streuung nach oben/unten, damit sich Punkte nicht verdecken
        const aussen = p.aenderung > hi || p.aenderung < lo;
        const kreis = s("circle", { cx: x(p.aenderung), cy: y + ruettel, r: 4.6, class: klasse + " d-punkt" + (aussen ? " d-aussen" : "") });
        kreis.append(Object.assign(s("title"), { textContent: `Listing ${p.number}: ${zahl(p.vorher)} to ${zahl(p.nachher)} impressions (${proz(p.aenderung)})` }));
        teile.push(kreis);
      });
      if (g.median != null) teile.push(s("line", { x1: x(g.median), x2: x(g.median), y1: y - 24, y2: y + 24, class: "d-median" }), text(x(g.median), y - 29, `median ${proz(g.median)}`, "d-klein"));
    }
    return s("svg", { viewBox: `0 0 ${B} ${H}`, class: "diagramm", role: "img", "aria-label": `Change per listing. Test group: median ${proz(a.test.median)}, ${proz(a.test.anteilBesser, false)} of listings up. Control group: median ${proz(a.kontrolle.median)}, ${proz(a.kontrolle.anteilBesser, false)} of listings up.` }, teile);
  }


  // ================= Seite Results =================
  // Je Phase eine schmale Zeile: Punkt = Effekt eines typischen Angebots gegen die Kontrollgruppe, Linie = 95-%-Bereich.
  // Alle Zeilen einer Ansicht haben dieselbe Skala (achse), unten steht die Beschriftung einmal (phasenAchse).
  // Liegt die ganze Linie rechts von der Nulllinie, ist der Anstieg klar; reicht sie über die Null, kann es Zufall sein.
  const ZB = 440, ZRAND = 12;
  function achse(phasen) {
    const werte = phasen.filter((p) => p.urteil !== "too_few" && p.schaetzung).flatMap((p) => [p.schaetzung.von, p.schaetzung.bis]);
    const lo = Math.min(-0.5, ...werte) - 0.05, hi = Math.max(1, ...werte) + 0.05;
    const schritte = hi - lo > 1.8 ? [-0.5, 0, 0.5, 1, 1.5, 2, 3] : [-0.5, -0.25, 0, 0.25, 0.5, 0.75, 1];
    return { lo, hi, ticks: schritte.filter((t) => t >= lo && t <= hi) };
  }
  const zx = (a, v) => ZRAND + (ZB - 2 * ZRAND) * ((klemme(v, a.lo, a.hi) - a.lo) / (a.hi - a.lo));
  function phasenZeile(p, a) {
    const H = 38, teile = a.ticks.filter((t) => t !== 0).map((t) => s("line", { x1: zx(a, t), x2: zx(a, t), y1: 0, y2: H, class: "d-gitter" }));
    teile.push(s("line", { x1: zx(a, 0), x2: zx(a, 0), y1: 0, y2: H, class: "d-null" }));
    const e = p.schaetzung, offen = p.urteil === "too_few" || !e, y = H / 2;
    if (offen) teile.push(text(ZB / 2 + 30, y + 4, "too early", "d-klein"));
    else {
      const k = "d-" + p.urteil;
      teile.push(s("line", { x1: zx(a, e.von), x2: zx(a, e.bis), y1: y, y2: y, class: "d-bereich " + k }), s("circle", { cx: zx(a, e.effekt), cy: y, r: 6, class: "d-effekt " + k }));
    }
    return s("svg", { viewBox: `0 0 ${ZB} ${H}`, class: "diagramm d-zeile", role: "img", "aria-label": `${p.name}: ` + (offen ? "too early" : `effect ${proz(e.effekt)}, 95 percent range ${proz(e.von)} to ${proz(e.bis)}`) }, teile);
  }
  function phasenAchse(a) {
    return s("svg", { viewBox: `0 0 ${ZB} 18`, class: "diagramm d-zeile", "aria-hidden": "true" }, a.ticks.map((t) => text(zx(a, t), 13, proz(t, false).replace(/^0 %$/, "0 %"), "d-klein")));
  }

  // Funnel-Überblick: ein Balken je Phase, Länge = Anteil an allen gestarteten Angeboten, unterteilt nach dem, was aus ihnen geworden ist.
  const FLUSS_TEIL = [["erholt", "Seen again, left the funnel"], ["weiter", "Passed on"], ["uebersprungen", "Skipped"], ["laeuft", "Running"], ["wartet", "Waiting for approval"], ["entfernt", "Removed by hand"],
    ["behalten", "Kept"], ["ueberarbeiten", "To rework"], ["offline", "Taken offline"], ["offen", "Waiting for a decision"]];
  function flussBalken(zahlen, gesamt) {
    const B = 360, H = 22, teile = [s("rect", { x: 0, y: 0, width: B, height: H, rx: 4, class: "d-f-spur" })];
    let x = 0;
    for (const [schluessel, beschr] of FLUSS_TEIL) {
      const n = zahlen[schluessel] || 0;
      if (!n || !gesamt) continue;
      const w = (n / gesamt) * B, r = s("rect", { x, y: 0, width: Math.max(w, 1), height: H, class: "d-f d-f-" + schluessel });
      r.append(Object.assign(s("title"), { textContent: `${beschr}: ${n}` }));
      teile.push(r); x += w;
    }
    return s("svg", { viewBox: `0 0 ${B} ${H}`, class: "diagramm d-fluss", role: "img", "aria-label": FLUSS_TEIL.filter(([k]) => zahlen[k]).map(([k, b]) => `${b} ${zahlen[k]}`).join(", ") || "no listings" }, teile);
  }

  return { saeulen, skala, punkte, proz, achse, phasenZeile, phasenAchse, flussBalken, FLUSS_TEIL };
})();
