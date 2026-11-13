// Oberfläche mit drei Seiten: Listings (Diagnose), Tests (Gruppenvergleich nach dem Briefing) und Settings (Regelwerte).
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
const aenderung = (v) => (v == null ? "n/a" : (v >= 0 ? "+" : "") + Math.round(100 * v) + " %");
const datum = (s) => (s && !Number.isNaN(Date.parse(s)) ? new Date(s).toLocaleDateString(LOCALE) : "–");
const bildUrl = (u) => (typeof u === "string" && /^https:\/\//i.test(u) ? u : null);
const SEITENGROESSE = 40;

const zustand = { daten: null, tests: null, einst: null, tab: "sichtbarkeit", suche: "", sortierung: "potential", sichtbar: SEITENGROESSE };

async function api(pfad, optionen) {
  const r = await fetch(pfad, optionen);
  if (r.status === 401) { location.replace("/"); throw new Error("Please sign in."); } // Sitzung abgelaufen: zurück zur Anmeldung
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
function zeigeFehler(e, erneut) {
  const box = $("#fehler");
  box.hidden = false;
  box.replaceChildren(el("strong", { text: "Something went wrong. " }), document.createTextNode(e.message + " "), erneut ? el("button", { class: "knopf", type: "button", onclick: erneut, text: "Try again" }) : null);
}
// Zweistufiger Knopf für Folgenreiches: erster Klick fragt nach, zweiter führt aus (nach 4 Sekunden zurück)
function zweiStufig(knopf, frage, aktion) {
  const text = knopf.textContent; let t;
  knopf.addEventListener("click", () => {
    if (knopf.dataset.scharf === "1") { clearTimeout(t); knopf.dataset.scharf = ""; knopf.textContent = text; aktion(); return; }
    knopf.dataset.scharf = "1"; knopf.textContent = frage;
    t = setTimeout(() => { knopf.dataset.scharf = ""; knopf.textContent = text; }, 4000);
  });
  return knopf;
}

// ======================================================= Laden und Routing
async function laden() {
  $("#fehler").hidden = true;
  try {
    const [daten, stand] = await Promise.all([api("/api/bewertung"), api("/api/stand").catch(() => null)]);
    zustand.daten = daten;
    $("#stand").textContent = stand ? `Data as of ${new Date(stand.exportiert_at).toLocaleString(LOCALE, { dateStyle: "short", timeStyle: "short" })}` : "";
    zeichneListings();
    ladeZaehler();
  } catch (e) { zeigeFehler(e, laden); }
}
async function ladeZaehler() {
  try {
    zustand.tests = await api("/api/experimente");
    const bereit = zustand.tests.tests.filter((t) => t.status === "ready").length;
    const z = $("#tests-zaehler"); z.hidden = bereit === 0; z.textContent = bereit; z.setAttribute("aria-label", `${bereit} ready for a verdict`);
  } catch { /* Zähler ist nur eine Zugabe */ }
}

let ersterAufruf = true;
function route() {
  const [seite, arg] = location.hash.replace(/^#/, "").split("/");
  const ansicht = seite === "tests" || seite === "settings" ? seite : "listings";
  for (const a of ["listings", "tests", "settings"]) {
    $("#ansicht-" + a).hidden = a !== ansicht;
    $("#nav-" + a).setAttribute("aria-current", a === ansicht ? "page" : "false");
  }
  window.scrollTo(0, 0);
  // Die Listings immer frisch laden: Tests und Einstellungen verändern, welche Angebote wo stehen
  if (ansicht === "listings" && !ersterAufruf) laden();
  ersterAufruf = false;
  if (ansicht === "tests") ladeTests(arg ? Number(arg) : null);
  if (ansicht === "settings") ladeEinstellungen();
}

// ======================================================= Listings
function gefiltert() {
  const q = zustand.suche.trim().toLowerCase();
  const num = (v) => (v == null ? 0 : Number(v));
  const zeit = (v) => (Number.isNaN(Date.parse(v)) ? 0 : Date.parse(v));
  const sortierer = {
    potential: (a, b) => num(b.units_90d) / (num(b.impressionen_90d) + 1) - num(a.units_90d) / (num(a.impressionen_90d) + 1) || num(b.units_total) - num(a.units_total),
    verkaeufe: (a, b) => num(b.units_90d) - num(a.units_90d),
    impressionen_auf: (a, b) => num(a.impressionen_90d) - num(b.impressionen_90d),
    impressionen_ab: (a, b) => num(b.impressionen_90d) - num(a.impressionen_90d),
    preis: (a, b) => num(b.avg_price) - num(a.avg_price),
    neueste: (a, b) => zeit(b.created_at) - zeit(a.created_at),
  }[zustand.sortierung];
  return zustand.daten.produkte
    .filter((p) => (zustand.tab === "alle" || p.gruppe === zustand.tab) && (!q || String(p.title || "").toLowerCase().includes(q) || String(p.number).toLowerCase().includes(q)))
    .sort(sortierer);
}

function zeichneListings() { zeichneTabs(); zeichneListe(); }

function zeichneTabs() {
  const { gruppen, uebersicht, summe } = zustand.daten;
  const tab = (schluessel, name, anzahl, punkt, hinweis) => el("button", {
    class: "tab", type: "button", role: "tab", "aria-selected": String(zustand.tab === schluessel), title: hinweis,
    onclick: () => { zustand.tab = schluessel; zustand.sichtbar = SEITENGROESSE; zeichneListings(); },
  }, punkt ? el("span", { class: "punkt", style: `--punkt: var(--g-${punkt})` }) : null, name, el("span", { class: "tab-zahl", text: zahl(anzahl) }));
  $("#tabs").replaceChildren(
    ...Object.entries(gruppen).map(([k, g]) => tab(k, g.label, uebersicht[k], k, g.regel)),
    tab("alle", "All", summe.produkte, null, "All listings"));
}

function zeichneListe() {
  const liste = gefiltert();
  const teil = liste.slice(0, zustand.sichtbar);
  $("#ergebnis").textContent = `${zahl(liste.length)} ${liste.length === 1 ? "listing" : "listings"}`;
  $("#liste").replaceChildren(...(liste.length ? teil.map(zeile) : [el("div", { class: "leer", text: "No listings found. Change the filter or the search." })]));
  $("#mehr").hidden = liste.length <= teil.length;
  $("#mehr").textContent = `Show more (${zahl(liste.length - teil.length)} more)`;
}

const kennzahl = (name, wert) => el("div", {}, el("dt", { text: name }), el("dd", { text: wert }));

function zeile(p) {
  const bild = bildUrl(p.image_url);
  const t = p.imTest;
  const hinweis = t
    ? el("div", { class: "hinweiszeile" }, el("span", { text: `In test #${t.id} as ${t.gruppe === "test" ? "test group (new title)" : "control group (stays unchanged)"} · ${t.status === "vorbereitet" ? "not started yet" : "running"}` }), el("a", { class: "knopf knopf-klein", href: `#tests/${t.id}`, text: "Open test" }))
    : p.gruppe === "sichtbarkeit"
      ? el("div", { class: "hinweiszeile" }, el("span", { text: "Next step: improve the title and search terms. Titles are changed in tests, so the effect can be measured." }), el("a", { class: "knopf knopf-klein", href: "#tests", text: "Go to Tests" }))
      : null;
  return el("details", { class: "zeile" },
    el("summary", { class: "zeilenkopf spalten" },
      bild ? el("img", { class: "bild", src: bild, alt: "", loading: "lazy", referrerpolicy: "no-referrer" }) : el("span", { class: "bild" }),
      el("div", { class: "name" }, el("div", { class: "titel", text: p.title || "(untitled)" }), el("div", { class: "nummer", text: "No. " + p.number })),
      el("span", { class: "zahl", text: eur(p.avg_price) }),
      el("span", { class: "zahl", text: zahl(p.units_90d ?? 0) }),
      el("span", { class: "zahl", text: zahl(p.impressionen_90d) }),
      el("span", { class: "chip" }, el("span", { class: "punkt", style: `--punkt: var(--g-${p.gruppe})` }), p.empfehlung),
      el("span", { class: "pfeil", "aria-hidden": "true", text: "›" }),
      el("div", { class: "kennzahlen-kurz" }, el("span", { text: eur(p.avg_price) }), el("span", { text: `${zahl(p.units_90d ?? 0)} sales` }), el("span", { text: `${zahl(p.impressionen_90d)} impressions` }))),
    el("div", { class: "zeilendetails" },
      el("p", { text: p.begruendung }),
      el("dl", { class: "kennzahlen" },
        kennzahl("Views 90 d", zahl(p.aufrufe_90d)), kennzahl("Click rate", prozent(p.klickrate, 2)), kennzahl("Conversion", prozent(p.conversion)),
        kennzahl("Sales total", zahl(p.units_total ?? 0)), kennzahl("Last sold", datum(p.last_sold_at)), kennzahl("Listed since", datum(p.created_at))),
      hinweis));
}

// ======================================================= Tests
const SCHRITTE = ["Draw groups", "Enter new titles", "Start", "Wait", "Verdict", "Keep or revert"];
const URTEIL = {
  better: { text: "Better", klasse: "gut", satz: "The test group gained clearly more impressions than the control group, and sales did not suffer." },
  no_difference: { text: "No difference proven", klasse: "", satz: "The test group did not do clearly better than the control group. This counts as not better." },
  worse: { text: "Worse", klasse: "schlecht", satz: "The test group did worse than the control group, or its sales fell too much." },
  not_enough_data: { text: "Not enough data", klasse: "", satz: "Too few impressions in the test group to judge. This counts as not better." },
};

const badge = (t) => {
  if (t.status === "closed") return el("span", { class: "badge", text: t.abschluss === "behalten" ? "Kept" : "Reverted" });
  if (t.status === "prepared") return el("span", { class: "badge vorbereitet", text: `Step 2 · ${t.anzahl.titel} of ${t.anzahl.test} titles entered` });
  if (t.status === "running") return el("span", { class: "badge laeuft", text: `Running · day ${t.tage} of ${t.pruefungNachTagen}` });
  const u = URTEIL[t.urteil?.urteil];
  return el("span", { class: "badge " + (u?.klasse || ""), text: u ? `Verdict: ${u.text}` : "Verdict ready" });
};

async function ladeTests(id) {
  try {
    zustand.tests = await api("/api/experimente");
    const bereit = zustand.tests.tests.filter((t) => t.status === "ready").length;
    const z = $("#tests-zaehler"); z.hidden = bereit === 0; z.textContent = bereit;
    if (id) { zustand.detail = await api("/api/experiment?id=" + id); zeichneDetail(zustand.detail); }
    else zeichneTestUebersicht();
  } catch (e) { zeigeFehler(e, () => ladeTests(id)); }
}

function schritteListe(aktuell, fertigBis) {
  return el("ol", { class: "schritte", "aria-label": "Steps of a test" }, SCHRITTE.map((s, i) => el("li", { class: i < fertigBis ? "fertig" : "", "aria-current": i === aktuell ? "step" : null, text: s })));
}

function zeichneTestUebersicht() {
  $("#test-detail").hidden = true;
  const root = $("#tests-uebersicht"); root.hidden = false;
  const { tests, moeglich, testGroesse } = zustand.tests;
  const genug = moeglich >= testGroesse;
  const neu = el("button", { class: "knopf knopf-akzent", type: "button", text: "Draw a new test", disabled: !genug });
  neu.addEventListener("click", async () => {
    neu.disabled = true;
    try { const r = await post("/api/experiment", {}); location.hash = "tests/" + r.id; }
    catch (e) { neu.disabled = false; meldung(e.message); }
  });
  root.replaceChildren(
    el("div", { class: "einstieg" }, el("h1", { text: "Tests" }),
      el("p", { class: "leise", text: "A test changes the titles of half of a group of listings and compares them with the other half after the same time. That shows whether the change really helped, or whether the whole shop just had a good month." })),
    schritteListe(-1, 0),
    el("div", { class: "panel" },
      el("h2", { text: "New test" }),
      el("p", { class: "leise", text: `${zahl(moeglich)} listings are flagged as “Low impressions” and free for a test. A test uses ${testGroesse} of them: the app draws them by lot, half get new titles (test group), half stay unchanged (control group).` }),
      !genug ? el("p", { class: "leise", text: "There are not enough listings for a test of this size. Lower the test size in Settings." }) : null,
      el("div", { class: "aktionen" }, neu, !genug ? el("a", { class: "knopf", href: "#settings", text: "Open Settings" }) : null)),
    tests.length
      ? el("div", {}, el("h2", { text: "Your tests", style: "margin: 22px 0 10px" }), tests.map((t) => el("a", { class: "testkarte", href: "#tests/" + t.id },
        el("div", {}, el("div", { class: "titel", text: t.name }), el("div", { class: "leise klein", text: `${t.anzahl.test} test + ${t.anzahl.kontrolle} control listings · drawn ${datum(t.erstellt_at)}${t.gestartet_at ? " · started " + datum(t.gestartet_at) : ""}` })), badge(t))))
      : el("p", { class: "leere-hinweis leise", text: "No tests yet." }));
}

function zurueck() { return el("a", { class: "knopf knopf-leise", href: "#tests", text: "← All tests" }); }
function listingName(a) { return el("div", {}, el("div", { class: "titel", text: a.alt || "(untitled)" }), el("div", { class: "nummer", text: "No. " + a.number })); }
function bildVon(a) { const b = bildUrl(a.bild); return b ? el("img", { class: "bild", src: b, alt: "", loading: "lazy", referrerpolicy: "no-referrer" }) : el("span", { class: "bild" }); }
async function neuLaden(id) { zustand.detail = await api("/api/experiment?id=" + id); zeichneDetail(zustand.detail); ladeZaehler(); }
async function aktion(pfad, body, id, ok) {
  try { await post(pfad, body); if (ok) meldung(ok); await neuLaden(id); } catch (e) { meldung(e.message); }
}

function zeichneDetail(d) {
  $("#tests-uebersicht").hidden = true;
  const root = $("#test-detail"); root.hidden = false;
  const alleTitel = d.anzahl.titel === d.anzahl.test;
  const aktuell = d.status === "prepared" ? (alleTitel ? 2 : 1) : d.status === "running" ? 3 : d.status === "ready" ? 4 : 6;
  const fertig = d.status === "closed" ? 6 : aktuell;
  root.replaceChildren(
    zurueck(),
    el("div", { class: "kopf-zeile", style: "margin: 8px 0 16px" }, el("div", {}, el("h1", { text: d.name }), el("p", { class: "leise klein", text: `${d.anzahl.test} test + ${d.anzahl.kontrolle} control listings · drawn ${datum(d.erstellt_at)} (draw number ${d.seed}) · lever: title and search terms` })), badge(d)),
    schritteListe(d.status === "closed" ? -1 : aktuell, fertig),
    ...({ prepared: detailVorbereitet, running: detailLaeuft, ready: detailBereit, closed: detailAbgeschlossen }[d.status](d)));
}

function testAngebote(d) { return d.angebote.filter((a) => a.gruppe === "test"); }
function kontrollAngebote(d) { return d.angebote.filter((a) => a.gruppe === "kontrolle"); }
function kontrollePanel(d) {
  return el("details", { class: "panel" },
    el("summary", { style: "cursor:pointer", text: `Control group (${d.anzahl.kontrolle} listings): leave these unchanged` }),
    kontrollAngebote(d).map((a) => el("div", { class: "angebotszeile", style: "grid-template-columns: 48px minmax(0,1fr)" }, bildVon(a), listingName(a))));
}

function detailVorbereitet(d) {
  const start = el("button", { class: "knopf knopf-akzent", type: "button", text: "Start test", disabled: d.anzahl.titel !== d.anzahl.test });
  start.addEventListener("click", () => { start.disabled = true; aktion("/api/experiment/start", { id: d.id }, d.id, "Test started. The verdict comes after the test duration."); });
  const fortschritt = el("span", { class: "leise", text: `${d.anzahl.titel} of ${d.anzahl.test} titles entered` });
  const aktualisiere = () => { const n = testAngebote(d).filter((a) => a.neu).length; fortschritt.textContent = `${n} of ${d.anzahl.test} titles entered`; start.disabled = n !== d.anzahl.test; };
  const zeilen = testAngebote(d).map((a) => {
    const feld = el("input", { class: "feld", type: "text", maxlength: "80", "aria-label": "New title for product " + a.number, placeholder: "New title (up to 80 characters)" });
    feld.value = a.neu || "";
    const stand = el("span", { class: "leise klein" });
    const zaehler = el("span", { text: `${feld.value.length} / 80` });
    let t;
    const speichern = async () => {
      const wert = feld.value;
      if (!wert.trim() || wert === (a.neu || "")) return;
      stand.textContent = "Saving…"; feld.removeAttribute("aria-invalid");
      try { const r = await post("/api/experiment/titel", { id: d.id, number: a.number, neu: wert }); a.neu = r.neu; stand.textContent = "Saved"; aktualisiere(); }
      catch (e) { feld.setAttribute("aria-invalid", "true"); stand.textContent = e.message; }
    };
    feld.addEventListener("input", () => { zaehler.textContent = `${feld.value.length} / 80`; clearTimeout(t); stand.textContent = ""; t = setTimeout(speichern, 700); });
    feld.addEventListener("change", () => { clearTimeout(t); speichern(); });
    return el("div", { class: "angebotszeile" }, bildVon(a), listingName(a), el("div", { class: "titelfeld" }, feld, el("div", { class: "zaehlerzeile" }, stand, zaehler)));
  });
  const verwerfen = zweiStufig(el("button", { class: "knopf", type: "button", text: "Discard this test" }), "Really discard?", () => aktion("/api/experiment/abschluss", { id: d.id, abschluss: "zurueck" }, d.id, "Test discarded. The listings are free again."));
  return [
    el("div", { class: "panel" },
      el("h2", { text: "Enter the new titles" }),
      el("p", { class: "leise", text: "Change the title of each test listing on eBay, then enter the new title here exactly as you published it. The app does not write titles for you, and it cannot change eBay. The control listings stay as they are." }),
      zeilen,
      el("div", { class: "aktionen" }, start, verwerfen, fortschritt)),
    kontrollePanel(d),
  ];
}

// Summen einer Gruppe (Ausgangszahlen bzw. aktuelle Zahlen)
function summe(zeilen, feld) {
  return zeilen.filter((z) => z.vorher && z.nachher).reduce((s, z) => ({ imp: s.imp + z[feld].imp, auf: s.auf + z[feld].auf, trans: s.trans + z[feld].trans }), { imp: 0, auf: 0, trans: 0 });
}
const titelListe = (d) => el("details", { class: "panel" }, el("summary", { style: "cursor:pointer", text: `Changed titles (${d.anzahl.test})` }),
  testAngebote(d).map((a) => el("div", { class: "angebotszeile", style: "grid-template-columns: 48px minmax(0,1fr) minmax(0,1fr)" }, bildVon(a), kasten("Old title", a.alt, false), kasten("New title", a.neu || "", false))));

function kasten(beschriftung, text, mitKopie) {
  return el("div", { class: "kasten", style: "margin:0" }, el("div", { class: "kasten-kopf" }, el("span", { class: "leise", text: beschriftung }), mitKopie ? el("button", { class: "knopf knopf-klein", type: "button", onclick: () => kopiere(text), text: "Copy" }) : null), el("div", { class: "kasten-text", text }));
}

function detailLaeuft(d) {
  const t = summe(testAngebote(d), "vorher"), k = summe(kontrollAngebote(d), "vorher");
  const stop = zweiStufig(el("button", { class: "knopf", type: "button", text: "Stop and revert" }), "Really stop?", () => aktion("/api/experiment/abschluss", { id: d.id, abschluss: "zurueck" }, d.id, "Test stopped. Set the old titles again on eBay."));
  return [
    el("div", { class: "panel" },
      el("h2", { text: "Waiting for data" }),
      el("p", { class: "leise", text: `The test started on ${datum(d.gestartet_at)}. It is day ${d.tage} of ${d.pruefungNachTagen}. The verdict comes on ${datum(d.bereit_am)}. Until then, do not change these listings again.` }),
      el("table", { class: "mini" }, el("thead", {}, el("tr", {}, el("th", { text: "Starting figures (30 days before the start)" }), el("th", { class: "zahl", text: "Impressions" }), el("th", { class: "zahl", text: "Sales" }))),
        el("tbody", {}, el("tr", {}, el("td", { text: `Test group (${d.anzahl.test})` }), el("td", { class: "zahl", text: zahl(t.imp) }), el("td", { class: "zahl", text: zahl(t.trans) })),
          el("tr", {}, el("td", { text: `Control group (${d.anzahl.kontrolle})` }), el("td", { class: "zahl", text: zahl(k.imp) }), el("td", { class: "zahl", text: zahl(k.trans) })))),
      el("div", { class: "aktionen" }, stop)),
    titelListe(d), kontrollePanel(d),
  ];
}

function urteilBox(d) {
  const u = d.urteil; if (!u) return el("p", { class: "leise", text: "This test never started, so there is no verdict." });
  const info = URTEIL[u.urteil];
  const zeileMit = (name, v, n, einheit = zahl) => el("tr", {}, el("td", { text: name }), el("td", { class: "zahl", text: einheit(v) }), el("td", { class: "zahl", text: einheit(n) }), el("td", { class: "zahl", text: aenderung(v > 0 ? n / v - 1 : null) }));
  return el("div", { class: "urteil " + info.klasse },
    el("div", { class: "urteil-titel", text: info.text }),
    el("p", { text: info.satz }),
    el("table", { class: "mini" }, el("thead", {}, el("tr", {}, el("th", { text: "Last 30 days" }), el("th", { class: "zahl", text: "Before" }), el("th", { class: "zahl", text: "After" }), el("th", { class: "zahl", text: "Change" }))),
      el("tbody", {},
        zeileMit("Impressions, test group", u.test.vorher.imp, u.test.nachher.imp), zeileMit("Impressions, control group", u.kontrolle.vorher.imp, u.kontrolle.nachher.imp),
        zeileMit("Sales, test group", u.test.vorher.trans, u.test.nachher.trans), zeileMit("Sales, control group", u.kontrolle.vorher.trans, u.kontrolle.nachher.trans))),
    el("p", { class: "leise klein", text: `Net effect on impressions compared with the control group: ${aenderung(u.primaer.netto)}. Sales check: ${u.schutz.ok ? "sales did not fall too much" : "sales fell too much"}. The control group is drawn by lot, so season and chance affect both groups alike.` }));
}

function detailBereit(d) {
  const empf = d.urteil?.empfehlung;
  const knopf = (wert, text) => el("button", { class: "knopf" + (empf === (wert === "behalten" ? "keep" : "revert") ? " knopf-akzent" : ""), type: "button", text,
    onclick: () => aktion("/api/experiment/abschluss", { id: d.id, abschluss: wert }, d.id, wert === "behalten" ? "Kept as the new base. The listings are free for the next test." : "Closed. Set the old titles again on eBay.") });
  return [
    el("div", { class: "panel" }, el("h2", { text: "Verdict" }), urteilBox(d),
      el("p", { text: empf === "keep" ? "Recommendation: keep the new titles." : "Recommendation: go back to the old titles." }),
      el("div", { class: "aktionen" }, knopf("behalten", "Keep the new titles"), knopf("zurueck", "Revert to the old titles"))),
    titelListe(d), kontrollePanel(d),
  ];
}

function detailAbgeschlossen(d) {
  const zurueckGesetzt = d.abschluss === "zurueck";
  return [
    el("div", { class: "panel" }, el("h2", { text: d.abschluss === "behalten" ? "Kept" : "Reverted" }),
      el("p", { class: "leise", text: `Closed on ${datum(d.abschluss_at)}.` + (d.gestartet_at ? "" : " The test never started.") }),
      d.gestartet_at ? urteilBox(d) : null),
    zurueckGesetzt && d.gestartet_at
      ? el("div", { class: "panel" }, el("h2", { text: "Set the old titles again on eBay" }), el("p", { class: "leise", text: "Copy each old title back into the listing." }),
        testAngebote(d).map((a) => el("div", { class: "angebotszeile", style: "grid-template-columns: 48px minmax(0,1fr)" }, bildVon(a), kasten(`No. ${a.number}`, a.alt, true))))
      : null,
  ];
}

// ======================================================= Einstellungen
async function ladeEinstellungen() {
  try { zustand.einst = await api("/api/einstellungen"); zeichneEinstellungen(); } catch (e) { zeigeFehler(e, ladeEinstellungen); }
}

function zeichneEinstellungen() {
  const e = zustand.einst;
  const werte = { ...e.werte };
  const zeilen = [];
  const info = el("div", { class: "info" });
  const zeigeInfo = () => { info.textContent = `Right now: listings with fewer than ${zahl(Math.round(e.abgeleitet.wenigImpressionen90d))} impressions in the last 90 days are flagged as “Low impressions”. This number is calculated from your data and the saved settings.`; };
  zeigeInfo();
  const fehler = el("div", { class: "fehlerzeile", role: "alert" });
  const aktualisiereSichtbar = () => zeilen.forEach(({ f, zeile }) => { zeile.hidden = !!f.nur && Object.entries(f.nur).some(([k, v]) => werte[k] !== v); });

  const abschnitte = e.abschnitte.map((a) => el("section", { class: "abschnitt" },
    el("h2", { text: a.titel }), el("p", { class: "leise", text: a.text }),
    a.id === "diagnose" ? info : null,
    e.schema.filter((f) => f.abschnitt === a.id).map((f) => {
      const id = "feld-" + f.key; const k = f.faktor || 1;
      let eingabe;
      if (f.typ === "auswahl") {
        eingabe = el("select", { class: "feld", id }, f.optionen.map((o) => el("option", { value: o.wert, text: o.label })));
        eingabe.value = werte[f.key];
        eingabe.addEventListener("change", () => { werte[f.key] = eingabe.value; aktualisiereSichtbar(); });
      } else {
        eingabe = el("input", { class: "feld", id, type: "number", min: String(f.min * k), max: String(f.max * k), step: String(f.schritt || 1), inputmode: "decimal" });
        eingabe.value = String(Math.round(werte[f.key] * k * 100) / 100);
        eingabe.addEventListener("input", () => { werte[f.key] = eingabe.value === "" ? NaN : Math.round(Number(eingabe.value) / k * 1e6) / 1e6; eingabe.removeAttribute("aria-invalid"); });
      }
      const zeile = el("div", { class: "einstellung" },
        el("div", {}, el("label", { for: id, text: f.label }), el("div", { class: "leise klein", text: f.hilfe })),
        el("div", { class: "eingabezeile" }, eingabe, f.einheit ? el("span", { class: "einheit", text: f.einheit }) : null));
      zeilen.push({ f, zeile, eingabe });
      return zeile;
    })));

  const speichern = el("button", { class: "knopf knopf-akzent", type: "submit", text: "Save settings" });
  const zuruecksetzen = zweiStufig(el("button", { class: "knopf", type: "button", text: "Reset to defaults" }), "Really reset?", async () => {
    try { await post("/api/einstellungen/zuruecksetzen", {}); meldung("Settings reset to the defaults."); await ladeEinstellungen(); laden(); } catch (x) { fehler.textContent = x.message; }
  });
  const form = el("form", { novalidate: true }, abschnitte, fehler, el("div", { class: "aktionen" }, speichern, zuruecksetzen));
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault(); fehler.textContent = ""; speichern.disabled = true;
    try {
      const neu = await post("/api/einstellungen", { werte });
      meldung("Settings saved. The listings are re-evaluated with the new values.");
      await ladeEinstellungen(); laden(); return neu;
    } catch (x) { fehler.textContent = x.message; speichern.disabled = false; }
  });
  $("#einstellungen").replaceChildren(form);
  aktualisiereSichtbar();
}

// ======================================================= Bedienung
let sucheTimer;
$("#suche").addEventListener("input", (ev) => { clearTimeout(sucheTimer); sucheTimer = setTimeout(() => { zustand.suche = ev.target.value; zustand.sichtbar = SEITENGROESSE; if (zustand.daten) zeichneListe(); }, 200); });
$("#sortierung").addEventListener("change", (ev) => { zustand.sortierung = ev.target.value; zustand.sichtbar = SEITENGROESSE; if (zustand.daten) zeichneListe(); });
$("#mehr").addEventListener("click", () => { zustand.sichtbar += SEITENGROESSE; zeichneListe(); });
window.addEventListener("hashchange", route);
$("#abmelden").addEventListener("click", async () => {
  try { await post("/api/logout", {}); } catch { /* auch bei Fehler zur Anmeldung zurück */ }
  location.replace("/");
});
api("/api/ich").then((d) => { $("#benutzer").textContent = d.name || ""; }).catch(() => {});

laden().then(route);
