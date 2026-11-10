// Oberfläche: Produktliste mit Empfehlung und fertigem nächsten Schritt, dazu das Änderungsprotokoll.
// Wichtig: Texte aus den Daten (z. B. eBay-Titel) werden nur als Text eingesetzt (textContent), nie als HTML.
// Sichtbare Texte sind auf Englisch.
const $ = (s) => document.querySelector(s);

function el(tag, props = {}, ...kinder) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === "class") n.className = v;
    else if (k === "text") n.textContent = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? "" : v);
  }
  for (const kind of kinder.flat()) if (kind != null) n.append(kind);
  return n;
}

const LOCALE = "en-GB";
const zahl = (v) => (v == null ? "–" : Number(v).toLocaleString(LOCALE));
const eur = (v) => (v == null ? "–" : Number(v).toLocaleString(LOCALE, { style: "currency", currency: "EUR" }));
const prozent = (v, stellen = 1) => (v == null ? "–" : (100 * v).toLocaleString(LOCALE, { minimumFractionDigits: stellen, maximumFractionDigits: stellen }) + " %");
const veraenderung = (v) => (v == null ? "n/a" : (v >= 0 ? "+" : "") + Math.round(100 * v) + " %");
const datum = (s) => (s && !Number.isNaN(Date.parse(s)) ? new Date(s).toLocaleDateString(LOCALE) : "–");

const zustand = { daten: null, log: [], ansicht: "produkte", gruppe: null, suche: "", sortierung: "verkaeufe", filter: "alle", sichtbar: 40 };
const SEITENGROESSE = 40;

async function api(pfad, optionen) {
  const r = await fetch(pfad, optionen);
  let j;
  try { j = await r.json(); } catch { throw new Error("Unexpected response from the server."); }
  if (!j.ok) throw new Error(j.error || "Unknown error");
  return j.daten;
}
const post = (pfad, body) => api(pfad, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

let toastTimer;
function meldung(text) {
  const t = $("#toast");
  t.textContent = text; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 4500);
}

async function kopiere(text) {
  try { await navigator.clipboard.writeText(text); meldung("Copied to the clipboard."); }
  catch { meldung("Copying is not possible here. Select the text and copy it by hand."); }
}

// ---------- Laden ----------
async function laden() {
  $("#fehler").hidden = true;
  try {
    const [daten, stand, log] = await Promise.all([api("/api/bewertung"), api("/api/stand").catch(() => null), api("/api/aenderungen")]);
    zustand.daten = daten; zustand.log = log;
    $("#stand").textContent = stand ? `Data as of ${new Date(stand.exportiert_at).toLocaleString(LOCALE, { dateStyle: "short", timeStyle: "short" })}` : "";
    zeichneAlles();
  } catch (e) {
    const box = $("#fehler");
    box.hidden = false;
    box.replaceChildren(el("strong", { text: "The data could not be loaded. " }), document.createTextNode(e.message + " "), el("button", { class: "knopf", type: "button", onclick: laden, text: "Try again" }));
  }
}
async function ladeLog() { zustand.log = await api("/api/aenderungen"); zeichneZaehler(); if (zustand.ansicht === "log") zeichneLog(); }

// ---------- Auswertung der Filter ----------
function gefiltert() {
  const { produkte } = zustand.daten;
  const q = zustand.suche.trim().toLowerCase();
  const liste = produkte.filter((p) => {
    if (zustand.gruppe && p.gruppe !== zustand.gruppe) return false;
    if (zustand.filter === "offen" && p.entscheidung?.aktion) return false;
    if (zustand.filter === "entschieden" && !p.entscheidung?.aktion) return false;
    if (q && !(String(p.title || "").toLowerCase().includes(q) || String(p.number).toLowerCase().includes(q))) return false;
    return true;
  });
  const num = (v) => (v == null ? -1 : Number(v));
  const zeit = (v) => (Number.isNaN(Date.parse(v)) ? 0 : Date.parse(v));
  const sortierer = {
    verkaeufe: (a, b) => num(b.units_90d) - num(a.units_90d) || num(b.units_total) - num(a.units_total),
    aufrufe: (a, b) => num(b.aufrufe_90d) - num(a.aufrufe_90d),
    zuletzt: (a, b) => zeit(b.last_sold_at) - zeit(a.last_sold_at),
    neueste: (a, b) => zeit(b.created_at) - zeit(a.created_at),
  }[zustand.sortierung];
  return liste.sort(sortierer);
}

// ---------- Zeichnen: Produkte ----------
function zeichneAlles() { zeichneGruppen(); zeichneFortschritt(); zeichneListe(); zeichneZaehler(); zeichneLog(); }

function zeichneZaehler() {
  const bereit = zustand.log.filter((a) => a.status === "ready").length;
  const z = $("#log-zaehler");
  z.hidden = bereit === 0; z.textContent = bereit;
  z.setAttribute("aria-label", `${bereit} ready for review`);
}

function zeichneFortschritt() {
  const { summe } = zustand.daten;
  $("#fortschritt").hidden = false;
  $("#fortschritt-fuellung").style.width = (summe.produkte ? (100 * summe.entschieden) / summe.produkte : 0) + "%";
  $("#fortschritt-text").textContent = `${zahl(summe.entschieden)} of ${zahl(summe.produkte)} products decided`;
}

function zeichneGruppen() {
  const { gruppen, uebersicht, summe, aktionen } = zustand.daten;
  const kachel = (schluessel, name, anzahl, zusatz, punkt) => {
    const aktiv = zustand.gruppe === schluessel;
    return el("button", { class: "gruppe", type: "button", "aria-pressed": String(aktiv), onclick: () => { zustand.gruppe = aktiv ? null : schluessel; zustand.sichtbar = SEITENGROESSE; zeichneGruppen(); zeichneListe(); } },
      el("span", { class: "gruppe-name" }, punkt ? el("span", { class: "punkt", style: `--punkt: var(--g-${punkt})` }) : null, name),
      el("span", { class: "gruppe-zahl", text: zahl(anzahl) }),
      el("span", { class: "gruppe-aktion", text: zusatz }));
  };
  const knoten = [kachel(null, "All products", summe.produkte, "no restriction", null)];
  for (const [k, g] of Object.entries(gruppen)) knoten.push(kachel(k, g.label, uebersicht[k], "Recommendation: " + aktionen[g.empfehlung], k));
  $("#gruppen").replaceChildren(...knoten);
}

function zeichneListe() {
  const liste = gefiltert();
  const teil = liste.slice(0, zustand.sichtbar);
  $("#ergebnis").textContent = `${zahl(liste.length)} ${liste.length === 1 ? "product" : "products"}`;
  $("#liste").replaceChildren(...(liste.length ? teil.map(zeile) : [el("div", { class: "leer", text: "No products found. Adjust the search or the filters." })]));
  $("#mehr").hidden = liste.length <= teil.length;
  $("#mehr").textContent = `Show more (${zahl(liste.length - teil.length)} more)`;
}

const bildUrl = (u) => (typeof u === "string" && /^https:\/\//i.test(u) ? u : null);
const kennzahl = (name, wert) => el("div", {}, el("dt", { text: name }), el("dd", { text: wert }));
const kasten = (beschriftung, text, mitKopie) => el("div", { class: "kasten" },
  el("div", { class: "kasten-kopf" }, el("span", { class: "leise", text: beschriftung }), mitKopie ? el("button", { class: "knopf knopf-klein", type: "button", onclick: () => kopiere(text), text: "Copy" }) : null),
  el("div", { class: "kasten-text", text }));

function zeile(p) {
  const { gruppen, aktionen } = zustand.daten;
  const g = gruppen[p.gruppe];
  const bild = bildUrl(p.image_url);
  const gewaehlt = p.entscheidung?.aktion || null;
  const status = el("span", { class: "status", "aria-live": "polite" });

  const knoepfe = Object.entries(aktionen).map(([schluessel, name]) =>
    el("button", {
      class: "aktion" + (schluessel === p.empfehlung ? " empfohlen" : ""), type: "button",
      "aria-pressed": String(gewaehlt === schluessel),
      title: schluessel === p.empfehlung ? "This is the recommendation" : null,
      onclick: () => speichern(p, gewaehlt === schluessel ? null : schluessel, p.entscheidung?.notiz || "", status),
    }, name));

  const notiz = el("textarea", { class: "notiz", maxlength: "500", rows: "2", placeholder: "Note for the team (optional, up to 500 characters)", "aria-label": "Note for product " + p.number }, null);
  notiz.value = p.entscheidung?.notiz || "";
  notiz.hidden = !notiz.value;
  let t;
  notiz.addEventListener("input", () => { clearTimeout(t); status.textContent = ""; t = setTimeout(() => speichern(p, p.entscheidung?.aktion || null, notiz.value, status, false), 700); });
  const schalter = el("button", { class: "knopf knopf-leise notiz-schalter", type: "button", "aria-expanded": String(!notiz.hidden), onclick: () => { notiz.hidden = !notiz.hidden; schalter.setAttribute("aria-expanded", String(!notiz.hidden)); if (!notiz.hidden) notiz.focus(); } }, "Note");

  return el("article", { class: "zeile", "data-nr": p.number },
    bild ? el("img", { class: "bild", src: bild, alt: "", loading: "lazy", referrerpolicy: "no-referrer" }) : el("span", { class: "bild bild-leer" }),
    el("div", {},
      el("div", { class: "titel", text: p.title || "(untitled)" }),
      el("div", { class: "nummer", text: "No. " + p.number }),
      el("dl", { class: "kennzahlen" },
        kennzahl("Avg. price", eur(p.avg_price)), kennzahl("Sales 90 d", zahl(p.units_90d ?? 0)), kennzahl("Sales total", zahl(p.units_total ?? 0)),
        kennzahl("Impressions 90 d", zahl(p.impressionen_90d)), kennzahl("Views 90 d", zahl(p.aufrufe_90d)), kennzahl("Click rate", prozent(p.klickrate, 2)),
        kennzahl("Conversion", prozent(p.conversion)), kennzahl("Last sold", datum(p.last_sold_at))),
      el("div", { class: "empfehlung" },
        el("span", { class: "pille" }, el("span", { class: "punkt", style: `--punkt: var(--g-${p.gruppe})` }), `${g.label} · Recommendation: ${aktionen[p.empfehlung]}`),
        el("span", { class: "empfehlung-text", text: p.begruendung })),
      p.vorschlag ? vorschlag(p) : null,
      el("div", { class: "entscheidung" }, el("span", { class: "entscheidung-label", text: "Your decision" }), el("span", { class: "aktionen" }, knoepfe), schalter, status),
      notiz));
}

// ---------- Vorschlag: fertige Anweisung, Kopieren, Umsetzen ----------
function vorschlag(p) {
  const v = p.vorschlag;
  const titel = v.hebel === "titel" ? (v.neu ? "New title" : "Rework the title") : v.hebel === "bild" ? "New first photo" : "Description text";
  const laufend = p.laufendeAenderung;
  const inhalt = [el("p", { class: "vorschlag-anweisung", text: v.anweisung })];
  if (v.hebel === "titel") {
    inhalt.push(kasten("Old title", v.alt, false));
    if (v.neu) inhalt.push(kasten(`New title (${v.laenge} of 80 characters)`, v.neu, true));
  } else if (v.neu) inhalt.push(kasten("Text to paste (German, as your listings are)", v.neu, true));
  if (v.schritte.length) inhalt.push(el(v.hebel === "bild" ? "ol" : "ul", { class: "vorschlag-liste" }, v.schritte.map((t) => el("li", { text: t }))));
  if (v.gruende.length) inhalt.push(el("div", { class: "vorschlag-gruende" }, el("div", { class: "leise", text: "Why" }), el("ul", {}, v.gruende.map((t) => el("li", { text: t })))));
  inhalt.push(el("p", { class: "vorschlag-hinweis", text: v.hinweis }));
  inhalt.push(laufend ? el("p", { class: "vorschlag-laeuft", text: `A test is already running for this listing since ${datum(laufend.angelegt_at)}. See the change log.` }) : umsetzen(p, v));
  return el("details", { class: "vorschlag" }, el("summary", { text: `First step: ${titel}${laufend ? " · test running" : ""}` }), inhalt);
}

function umsetzen(p, v) {
  const vorgabe = v.hebel === "titel" ? (v.neu || "") : v.hebel === "bild" ? "New first photo uploaded" : (v.neu || "");
  const feld = v.hebel === "angebot"
    ? el("textarea", { class: "feld", rows: "4", maxlength: "2000", "aria-label": "What did you publish?" })
    : el("input", { class: "feld", type: "text", maxlength: v.hebel === "titel" ? "80" : "2000", "aria-label": "What did you publish?" });
  feld.value = vorgabe;
  const knopf = el("button", { class: "knopf knopf-akzent", type: "button", text: "I published this change" });
  knopf.addEventListener("click", async () => {
    knopf.disabled = true;
    try {
      const a = await post("/api/aenderung", { number: p.number, hebel: v.hebel, neu: feld.value });
      p.laufendeAenderung = { id: a.id, number: a.number, hebel: a.hebel, angelegt_at: a.angelegt_at };
      document.querySelector(`.zeile[data-nr="${CSS.escape(p.number)}"]`)?.replaceWith(zeile(p));
      meldung(`Logged. The review is possible from ${datum(new Date(Date.parse(a.angelegt_at) + zustand.daten.einstellungen.pruefungNachTagen * 86400000))}.`);
      ladeLog();
    } catch (e) { knopf.disabled = false; meldung("Not logged: " + e.message); }
  });
  return el("div", { class: "umsetzen" },
    el("label", { class: "umsetzen-label" }, v.hebel === "titel" ? "Title as you published it" : v.hebel === "bild" ? "Short note on what you changed" : "Text as you published it", feld),
    el("p", { class: "leise klein", text: "Logging stores the old value, the new value, today's date and the current numbers. Do this only after you have changed the listing on eBay." }),
    knopf);
}

// ---------- Speichern der Entscheidung ----------
async function speichern(p, aktion, notiz, statusKnoten, neuZeichnen = true) {
  const vorher = p.entscheidung;
  statusKnoten.textContent = "Saving…";
  try {
    const antwort = await post("/api/entscheidung", { number: p.number, aktion, notiz });
    const { summe } = zustand.daten;
    p.entscheidung = antwort;
    summe.entschieden += (antwort?.aktion ? 1 : 0) - (vorher?.aktion ? 1 : 0);
    zeichneFortschritt();
    if (neuZeichnen) {
      const neu = zeile(p);
      document.querySelector(`.zeile[data-nr="${CSS.escape(p.number)}"]`)?.replaceWith(neu);
      const s = neu.querySelector(".status"); if (s) s.textContent = "Saved";
    } else statusKnoten.textContent = "Saved";
  } catch (e) {
    statusKnoten.textContent = "";
    meldung("Not saved: " + e.message);
  }
}

// ---------- Zeichnen: Änderungsprotokoll ----------
const URTEIL = {
  better: { text: "Better", klasse: "gut", satz: "The numbers improved clearly compared with the unchanged listings." },
  no_difference: { text: "No difference proven", klasse: "neutral", satz: "No clear difference to the unchanged listings. This counts as not better." },
  worse: { text: "Worse", klasse: "schlecht", satz: "The numbers got worse, or sales fell too much compared with the unchanged listings." },
  not_enough_data: { text: "Not enough data", klasse: "neutral", satz: "Too few impressions in the 30 days to judge. This counts as not better." },
};

function zeichneLog() {
  const liste = zustand.log;
  $("#log-ergebnis").textContent = liste.length ? `${liste.length} ${liste.length === 1 ? "change" : "changes"}` : "";
  $("#log-liste").replaceChildren(...(liste.length ? liste.map(aenderungKarte) : [el("div", { class: "leer", text: "No changes logged yet. Open a product, follow its first step on eBay and then press “I published this change”." })]));
}

function aenderungKarte(a) {
  const { aktionen } = zustand.daten;
  const bild = bildUrl(a.bild);
  const badge = a.status === "closed"
    ? el("span", { class: "badge neutral", text: a.abschluss === "behalten" ? "Kept" : "Reverted" })
    : a.status === "running" ? el("span", { class: "badge laeuft", text: `Running · day ${a.tage} of ${a.pruefungNachTagen}` })
    : el("span", { class: "badge " + (URTEIL[a.pruefung?.urteil]?.klasse || "neutral"), text: a.pruefung ? URTEIL[a.pruefung.urteil].text : "Ready" });
  const teile = [
    el("div", { class: "aenderung-kopf" }, el("div", {}, el("div", { class: "titel", text: a.titel || "(listing no longer in the data)" }), el("div", { class: "nummer", text: `No. ${a.number} · ${aktionen[a.hebel]}` })), badge),
    el("p", { class: "leise klein", text: `Logged ${datum(a.angelegt_at)} · review from ${datum(a.bereit_am)} · hypothesis: ${a.hypothese}` }),
  ];
  if (a.hebel === "titel") teile.push(kasten("Old title", a.alt, false), kasten("New title", a.neu, false));
  else {
    teile.push(kasten("What was published", a.neu, false));
    if (a.hebel === "bild" && bildUrl(a.alt)) teile.push(el("div", { class: "alt-bild" }, el("span", { class: "leise klein", text: "Old first photo" }), el("img", { class: "bild", src: a.alt, alt: "", loading: "lazy", referrerpolicy: "no-referrer" })));
    else if (a.hebel === "bild" && bild) teile.push(el("p", { class: "leise klein", text: "The old photo was not stored." }));
  }
  if (a.status === "ready" && a.pruefung) teile.push(pruefungBox(a));
  if (a.status === "ready" && !a.pruefung) teile.push(el("p", { class: "leise", text: "This listing is no longer in the data, so it cannot be compared." }), abschlussKnoepfe(a, null));
  if (a.status === "closed") {
    teile.push(el("p", { class: "leise klein", text: `Closed ${datum(a.abschluss_at)}.` }));
    if (a.abschluss === "zurueck" && a.hebel === "titel") teile.push(kasten("Set the old title again on eBay", a.alt, true));
    else if (a.abschluss === "zurueck") teile.push(el("p", { class: "leise", text: "Set the old value again on eBay." }));
  }
  return el("article", { class: "zeile aenderung" }, el("div", { class: "aenderung-inhalt" }, teile));
}

function pruefungBox(a) {
  const r = a.pruefung; const u = URTEIL[r.urteil];
  const zeileMitZahlen = (k, einheit) => `${k.name}: ${einheit(k.vorher)} → ${einheit(k.nachher)}, ${veraenderung(k.netto)} compared with unchanged listings`;
  const fmt = (name) => (name === "click rate" || name === "conversion" ? (v) => prozent(v, 2) : (v) => zahl(Math.round(v * 10) / 10));
  return el("div", { class: "pruefung" },
    el("div", { class: "pille", text: `Review: ${u.text}` }),
    el("p", { class: "leise", text: u.satz }),
    el("ul", { class: "leise klein" },
      el("li", { text: "Main figure, " + zeileMitZahlen(r.primaer, fmt(r.primaer.name)) }),
      el("li", { text: "Protected figure, " + zeileMitZahlen(r.schutz, fmt(r.schutz.name)) + (r.schutz.ok ? "" : " (fell too much)") }),
      el("li", { text: r.mitKontrolle ? `Comparison group: ${zahl(r.vergleichsgruppe)} unchanged listings.` : "No usable comparison group (fewer than 20 unchanged listings), so the raw change is used." })),
    el("p", { class: "leise klein", text: "One listing alone is only an indication, not proof. The comparison group is not randomised: it is all other unchanged listings." }),
    abschlussKnoepfe(a, r.empfehlung));
}

function abschlussKnoepfe(a, empfohlen) {
  const knopf = (wert, text) => el("button", { class: "knopf" + (empfohlen === (wert === "behalten" ? "keep" : "revert") ? " knopf-akzent" : ""), type: "button", text, onclick: async () => {
    try { await post("/api/aenderung/abschluss", { id: a.id, abschluss: wert }); meldung(wert === "behalten" ? "Kept as the new base. The listing is free for the next test." : "Closed. Set the old value again on eBay, then the listing is free for the next test."); await laden(); }
    catch (e) { meldung("Not closed: " + e.message); }
  } }, text);
  return el("div", { class: "pruefung-knoepfe" }, knopf("behalten", "Keep (new base)"), knopf("zurueck", "Revert to the old value"));
}

// ---------- Regeln-Dialog ----------
function zeichneRegeln() {
  const { gruppen, aktionen, einstellungen: e } = zustand.daten;
  $("#regeln-inhalt").replaceChildren(
    el("p", { text: "Every sale passes three stages: impressions (is the listing shown?), clicks (is it opened?) and sales (is it bought?). For products that sell too little, the weakest stage decides what to try first. Change one thing at a time, then wait for new data." }),
    el("p", { text: "Left out on purpose: advertising (it needs a budget) and price (it needs a margin target). Delisting is never recommended automatically, a person decides. Only eBay data is used. The app cannot change listings on eBay, you publish the change yourself and log it." }),
    el("p", { text: `Current values: grace period ${e.schonfristTage} days · top from ${e.topVerkaeufe90d} sales · steady from ${(e.schwacheConversion * 100).toLocaleString(LOCALE)} % conversion · stage 1 below ${zahl(Math.round(e.wenigImpressionen90d))} impressions · stage 2 below ${prozent(e.schwacheKlickrate, 2)} click rate. The stage limits are the bottom quarter of your shop and are recalculated from the data.` }),
    el("p", { text: `Review of a change: after ${e.pruefungNachTagen} days, only with at least ${e.mindestImpressionen30} impressions in the window. It counts as better if the main figure is at least ${Math.round(e.besserAb * 100)} % better than in the unchanged listings and the protected figure does not fall by more than ${Math.round(e.schutzGrenze * 100)} %. All values are starting points to be agreed on by the team.` }),
    ...Object.entries(gruppen).map(([k, g]) => el("div", { class: "regel" },
      el("span", { class: "regel-name" }, el("span", { class: "punkt", style: `--punkt: var(--g-${k})` }), g.label),
      el("span", { class: "regel-text", text: g.regel }),
      el("span", { class: "regel-text", text: "→ " + aktionen[g.empfehlung] }))));
}

// ---------- Bedienung ----------
function zeigeAnsicht(name) {
  zustand.ansicht = name;
  $("#ansicht-produkte").hidden = name !== "produkte";
  $("#ansicht-log").hidden = name !== "log";
  $("#nav-produkte").setAttribute("aria-current", name === "produkte" ? "page" : "false");
  $("#nav-log").setAttribute("aria-current", name === "log" ? "page" : "false");
  if (name === "log" && zustand.daten) { zeichneLog(); ladeLog().catch(() => {}); }
}
$("#nav-produkte").addEventListener("click", () => { location.hash = ""; zeigeAnsicht("produkte"); });
$("#nav-log").addEventListener("click", () => { location.hash = "log"; zeigeAnsicht("log"); });

let sucheTimer;
$("#suche").addEventListener("input", (e) => { clearTimeout(sucheTimer); sucheTimer = setTimeout(() => { zustand.suche = e.target.value; zustand.sichtbar = SEITENGROESSE; if (zustand.daten) zeichneListe(); }, 200); });
$("#sortierung").addEventListener("change", (e) => { zustand.sortierung = e.target.value; zustand.sichtbar = SEITENGROESSE; if (zustand.daten) zeichneListe(); });
$("#entscheidungsfilter").addEventListener("change", (e) => { zustand.filter = e.target.value; zustand.sichtbar = SEITENGROESSE; if (zustand.daten) zeichneListe(); });
$("#mehr").addEventListener("click", () => { zustand.sichtbar += SEITENGROESSE; zeichneListe(); });
$("#regeln-auf").addEventListener("click", () => { if (!zustand.daten) return; zeichneRegeln(); $("#regeln").showModal(); });

if (location.hash === "#log") zeigeAnsicht("log");
laden();
