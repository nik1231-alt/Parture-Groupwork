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


  // ================= Seite Results (Phasen der Leiter) =================

  // ---- 4. Phasenvergleich: Nettoeffekt jeder Phase gegen die Kontrollgruppe, dazu die Wirkung aller Phasen zusammen
  function phasenBalken(e) {
    const B = 560, links = 150, rechts = 28, zeile = 54, oben = 24;
    const { besserAb } = e.skala;
    const reihen = [...e.phasen.map((p) => ({ name: p.name, wert: p.urteil === "too_few" ? null : p.netto, hinweis: p.urteil === "too_few" ? `too few listings yet (${p.mitKontrolle} of ${e.skala.mindestAusgewertet})` : null })),
      { name: "All phases combined", wert: e.kombiniert, hinweis: e.kombiniert == null ? "no phase has a result yet" : null, summe: true }];
    const werte = reihen.map((r) => r.wert).filter((v) => v != null);
    const lo = Math.min(-0.6, ...werte.map((v) => v - 0.1)), hi = Math.max(1, ...werte.map((v) => v + 0.1));
    const x = (v) => links + (B - links - rechts) * ((klemme(v, lo, hi) - lo) / (hi - lo));
    const H = oben + reihen.length * zeile + 34, teile = [];
    reihen.forEach((r, i) => {
      const y = oben + i * zeile + 18, y0 = y - 11;
      if (r.summe) teile.push(s("line", { x1: 16, x2: B - 16, y1: y0 - 14, y2: y0 - 14, class: "d-gitter" }));
      teile.push(text(links - 12, y + 4, r.name, "d-gruppe", "end"));
      const matt = r.wert == null ? " d-matt" : "";
      [[lo, -besserAb, "d-zone-schlecht"], [-besserAb, besserAb, "d-zone-mitte"], [besserAb, hi, "d-zone-gut"]].forEach(([von, bis, k]) => teile.push(s("rect", { x: x(von), y: y0, width: Math.max(0, x(bis) - x(von)), height: 22, class: k + matt })));
      teile.push(s("line", { x1: x(0), x2: x(0), y1: y0 - 3, y2: y0 + 25, class: "d-null" }));
      if (r.wert != null) teile.push(s("circle", { cx: x(r.wert), cy: y, r: 8, class: "d-marke" + (r.wert < lo || r.wert > hi ? " d-aussen" : "") }), text(x(r.wert), y - 17, proz(r.wert), "d-wert"));
      else teile.push(text(x(0) + 0, y + 4, r.hinweis, "d-klein"));
    });
    const achse = H - 10;
    [-0.5, 0, besserAb, 0.5, 1].filter((t, i, a) => t >= lo && t <= hi && a.indexOf(t) === i).forEach((t) => teile.push(text(x(t), achse, proz(t), "d-klein")));
    return s("svg", { viewBox: `0 0 ${B} ${H}`, class: "diagramm", role: "img", "aria-label": "Net effect on impressions per phase compared with the control group: " + reihen.map((r) => `${r.name} ${r.wert == null ? "no result yet" : proz(r.wert)}`).join(", ") + `. Better from ${proz(besserAb)}.` }, teile);
  }

  // ---- 5. Vorher/nachher als Index (vorher = 100): Angebote der Phase gegen die Kontrollgruppe. Summen wären nicht vergleichbar (die Kontrollgruppe ist viel größer).
  function indexSaeulen(p) {
    const B = 560, H = 232, links = 20, rechts = 20, oben = 34, unten = 62;
    const gruppen = [["Listings in this phase", p.aenderung, "d-test", `${p.mitKontrolle} checked`], ["Control group", p.kontrolleAenderung, "d-kontrolle", "same days"]];
    const nachher = gruppen.map(([, a]) => 100 * (1 + (a ?? 0)));
    const max = Math.max(120, ...nachher) * 1.12, grund = H - unten, y = (v) => oben + (H - oben - unten) * (1 - v / max);
    const breite = (B - links - rechts) / 2, sw = 64, luecke = 14, teile = [s("line", { x1: links, x2: B - rechts, y1: grund, y2: grund, class: "d-achse" })];
    gruppen.forEach(([name, a, klasse, sub], i) => {
      const mitte = links + breite * i + breite / 2;
      [["Before", 100, "d-vorher", mitte - sw - luecke / 2], ["After", nachher[i], klasse, mitte + luecke / 2]].forEach(([beschr, wert, k, bx]) => {
        const h = Math.max(2, grund - y(wert));
        teile.push(s("rect", { x: bx, y: grund - h, width: sw, height: h, rx: 4, class: k }), text(bx + sw / 2, grund - h - 7, String(Math.round(wert)), "d-wert"), text(bx + sw / 2, grund + 16, beschr, "d-klein"));
      });
      teile.push(text(mitte, grund + 38, `${name} (${sub})`, "d-gruppe"), text(mitte, grund + 54, a == null ? "n/a" : `${proz(a)} impressions`, "d-aenderung " + (Math.round(100 * (a ?? 0)) === 0 ? "" : a > 0 ? "d-plus" : "d-minus")));
    });
    return s("svg", { viewBox: `0 0 ${B} ${H}`, class: "diagramm", role: "img", "aria-label": `Impressions before = 100. After: listings ${Math.round(nachher[0])}, control group ${Math.round(nachher[1])}.` }, teile);
  }

  // ---- 6. Jedes Angebot der Phase mit seinem Nettoeffekt (damit ein Ausreißer allein nichts entscheidet)
  function punkteNetto(p, besserAb) {
    const B = 560, H = 160, links = 30, rechts = 28, lo = -1, hi = 3, mitte = 70;
    const x = (v) => links + (B - links - rechts) * ((klemme(v, lo, hi) - lo) / (hi - lo));
    const teile = [];
    [[lo, -besserAb, "d-zone-schlecht"], [-besserAb, besserAb, "d-zone-mitte"], [besserAb, hi, "d-zone-gut"]].forEach(([von, bis, k]) => teile.push(s("rect", { x: x(von), y: 30, width: x(bis) - x(von), height: 80, class: k })));
    [-1, 0, 1, 2, 3].forEach((t) => teile.push(s("line", { x1: x(t), x2: x(t), y1: 30, y2: 110, class: t === 0 ? "d-null" : "d-gitter" }), text(x(t), H - 24, proz(t), "d-klein")));
    const mit = p.punkte.filter((q) => q.netto != null);
    mit.forEach((q, i) => {
      const k = s("circle", { cx: x(q.netto), cy: mitte + ((i * 37) % 7 - 3) * 8, r: 5, class: "d-test d-punkt" + (q.netto > hi || q.netto < lo ? " d-aussen" : "") });
      k.append(Object.assign(s("title"), { textContent: `Listing ${q.number}: ${zahl(q.vorher90)} to ${zahl(q.nachher90)} impressions per 90 days (net ${proz(q.netto)})${q.erholt ? ", seen again" : ""}` }));
      teile.push(k);
    });
    if (p.median != null) teile.push(s("line", { x1: x(p.median), x2: x(p.median), y1: 24, y2: 116, class: "d-median" }), text(x(p.median), 18, `median ${proz(p.median)}`, "d-klein"));
    teile.push(text(x(-0.6), 46, "worse", "d-klein"), text(x(1.5), 46, "better than the control group", "d-klein"));
    return s("svg", { viewBox: `0 0 ${B} ${H}`, class: "diagramm", role: "img", "aria-label": `Net effect per listing: ${mit.length} listings, median ${proz(p.median)}, ${proz(p.anteilBesser, false)} gained against the control group.` }, teile);
  }

  // ---- 7. Verlauf über die Tage: Impressionen als Index (100 = Schnitt der 30 Tage vor dem Start), Angebote gegen Kontrollgruppe
  function verlauf(v) {
    const B = 560, H = 262, links = 44, rechts = 96, oben = 30, unten = 42;
    const alle = [...v.test, ...v.kontrolle].filter((q) => q != null);
    const lo = Math.floor(Math.min(80, ...alle) / 10) * 10, hi = Math.ceil(Math.max(120, ...alle) / 10) * 10;
    const t0 = v.tage[0], t1 = v.tage[v.tage.length - 1];
    const x = (d) => links + (B - links - rechts) * ((d - t0) / (t1 - t0)), y = (w) => oben + (H - oben - unten) * (1 - (w - lo) / (hi - lo));
    const teile = [s("rect", { x: x(0), y: oben, width: x(t1) - x(0), height: H - oben - unten, class: "d-flaeche" })];
    for (let w = lo; w <= hi; w += (hi - lo > 80 ? 20 : 10)) teile.push(s("line", { x1: links, x2: B - rechts, y1: y(w), y2: y(w), class: w === 100 ? "d-null d-gestrichelt" : "d-gitter" }), text(links - 6, y(w) + 4, String(w), "d-klein", "end"));
    const ticks = [t0, Math.round(t0 / 2), 0, Math.round(t1 / 2), t1].filter((t, i, a) => a.indexOf(t) === i);
    ticks.forEach((t) => teile.push(text(x(t), H - unten + 16, t === 0 ? "start" : (t > 0 ? "+" : "") + t + " d", "d-klein")));
    teile.push(text(links, H - 8, "Days relative to the start of the phase. Shaded: phase running. 7-day average.", "d-klein", "start"));
    const linie = (reihe, klasse) => {
      let d = "", offen = false;
      reihe.forEach((w, i) => { if (w == null) { offen = false; return; } d += `${offen ? "L" : "M"}${x(v.tage[i]).toFixed(1)} ${y(w).toFixed(1)}`; offen = true; });
      return s("path", { d, fill: "none", class: "d-linie " + klasse });
    };
    teile.push(linie(v.kontrolle, "d-linie-kontrolle"), linie(v.test, "d-linie-test"));
    const letzt = (reihe) => { for (let i = reihe.length - 1; i >= 0; i--) if (reihe[i] != null) return [v.tage[i], reihe[i]]; return null; };
    const lt = letzt(v.test), lk = letzt(v.kontrolle);
    if (lt) teile.push(s("circle", { cx: x(lt[0]), cy: y(lt[1]), r: 4, class: "d-test" }), text(x(lt[0]) + 8, y(lt[1]) + (lk && Math.abs(y(lk[1]) - y(lt[1])) < 14 && lt[1] >= lk[1] ? -6 : 4), `Listings ${Math.round(lt[1])}`, "d-gruppe", "start"));
    if (lk) teile.push(s("circle", { cx: x(lk[0]), cy: y(lk[1]), r: 4, class: "d-kontrolle" }), text(x(lk[0]) + 8, y(lk[1]) + (lt && Math.abs(y(lk[1]) - y(lt[1])) < 14 && lk[1] > lt[1] ? -6 : 14), `Control ${Math.round(lk[1])}`, "d-gruppe", "start"));
    return s("svg", { viewBox: `0 0 ${B} ${H}`, class: "diagramm", role: "img", "aria-label": `Impressions over time as an index (100 = average before the start). At the end: listings ${lt ? Math.round(lt[1]) : "n/a"}, control group ${lk ? Math.round(lk[1]) : "n/a"}.` }, teile);
  }

  return { saeulen, skala, punkte, proz, phasenBalken, indexSaeulen, punkteNetto, verlauf };
})();
