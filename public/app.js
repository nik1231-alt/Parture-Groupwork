// Oberfläche: Listings (Diagnose), Tests (Gruppenvergleich nach dem Briefing), Approvals (Freigabe von Titeländerungen),
// Team (Rollen, nur Admin), Log (Protokoll) und Settings (Regelwerte).
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
// Breite Tabellen scrollen in ihrem eigenen Kasten, nie die ganze Seite (Telefon-Breite)
const rollbar = (tabelle) => el("div", { class: "rollbar" }, tabelle);

const zustand = { ich: { name: "", rolle: "builder" }, daten: null, tests: null, einst: null, tab: "sichtbarkeit", suche: "", sortierung: "potential", sichtbar: SEITENGROESSE };

// Kleiner Zwischenspeicher im Tab (sessionStorage): ungespeicherte Titel überstehen so eine abgelaufene Sitzung und die neue Anmeldung.
// Kann fehlen oder gesperrt sein (privates Fenster): dann geht es ohne.
const entwurf = {
  lies: (k) => { try { return sessionStorage.getItem("entwurf:" + k); } catch { return null; } },
  merke: (k, v) => { try { sessionStorage.setItem("entwurf:" + k, v); } catch { /* ohne Zwischenspeicher */ } },
  weg: (k) => { try { sessionStorage.removeItem("entwurf:" + k); } catch { /* ohne Zwischenspeicher */ } },
};

async function api(pfad, optionen) {
  const r = await fetch(pfad, optionen);
  // Sitzung abgelaufen: dieselbe Adresse neu laden. Der Server zeigt dann die Anmeldeseite, die Adresse (#tests/5) bleibt stehen,
  // nach der Anmeldung geht es genau dorthin zurück, und eingetippte Titel liegen im Zwischenspeicher (entwurf).
  if (r.status === 401) { location.reload(); throw new Error("Your session has expired. Please sign in again."); }
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
    $("#stand").textContent = stand ? `Data as of ${new Date(stand.exportiert_at).toLocaleString(LOCALE, { dateStyle: "short", timeStyle: "short" })}${stand.traffic_bis ? ` · traffic up to ${datum(stand.traffic_bis + "T12:00:00Z")}` : ""}` : "";
    zeichneListings();
    ladeZaehler();
    ladeBetrieb();
  } catch (e) { zeigeFehler(e, laden); }
}
// Umgebung (PROD / VORSCHAU) im Kopf und eine Warnung, wenn die Traffic-Daten dem Soll hinterherhinken
async function ladeBetrieb() {
  try {
    const b = await api("/api/betrieb");
    zustand.betrieb = b;
    const u = $("#umgebung");
    u.hidden = b.umgebung === "lokal"; u.textContent = b.umgebung === "vorschau" ? "PREVIEW" : b.umgebung === "prod" ? "LIVE" : "";
    u.className = "umgebung " + b.umgebung;
    u.title = b.umgebung === "vorschau" ? "Preview environment: changes here never reach eBay." : b.version ? "Version " + b.version : "";
    const w = $("#warnung"); const d = b.daten;
    w.hidden = !d.veraltet;
    if (d.veraltet) w.textContent = `Traffic data is ${d.rueckstandTage} days behind (latest day: ${d.trafficBis}, expected: ${d.soll}). The daily import may have failed, see the Log.`;
  } catch { /* der Status ist nur eine Zugabe */ }
}
async function ladeZaehler() {
  try {
    zustand.tests = await api("/api/experimente");
    const bereit = zustand.tests.tests.filter((t) => t.status === "ready").length;
    const z = $("#tests-zaehler"); z.hidden = bereit === 0; z.textContent = bereit; z.setAttribute("aria-label", `${bereit} ready for a verdict`);
  } catch { /* Zähler ist nur eine Zugabe */ }
  try {
    const f = await api("/api/freigaben");
    const z = $("#approvals-zaehler"); z.hidden = f.offen === 0; z.textContent = f.offen; z.setAttribute("aria-label", `${f.offen} waiting for approval`);
  } catch { /* wie oben */ }
  try {
    const l = await api("/api/leiter");
    const offen = l.angebote.filter((a) => a.phase === "vorschlag" || a.phase === "offen").length;
    const z = $("#ladder-zaehler"); z.hidden = offen === 0; z.textContent = offen; z.setAttribute("aria-label", `${offen} waiting for a decision`);
  } catch { /* wie oben */ }
}

let ersterAufruf = true;
function route() {
  const [seite, arg] = location.hash.replace(/^#/, "").split("/");
  const ansicht = ["tests", "ladder", "settings", "approvals", "team", "log", "account"].includes(seite) ? seite : "listings";
  for (const a of ["listings", "tests", "ladder", "settings", "approvals", "team", "log", "account"]) {
    $("#ansicht-" + a).hidden = a !== ansicht;
    $("#nav-" + a).setAttribute("aria-current", a === ansicht ? "page" : "false");
  }
  window.scrollTo(0, 0);
  // Die Listings immer frisch laden: Tests und Einstellungen verändern, welche Angebote wo stehen
  if (ansicht === "listings" && !ersterAufruf) laden();
  ersterAufruf = false;
  if (ansicht === "tests") ladeTests(arg ? Number(arg) : null);
  if (ansicht === "ladder") ladeLeiter();
  if (ansicht === "settings") ladeEinstellungen();
  if (ansicht === "approvals") ladeFreigaben();
  if (ansicht === "team") ladeTeam();
  if (ansicht === "log") ladeLog();
  if (ansicht === "account") zeichneKonto();
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
const SCHRITTE = ["Draw groups", "Enter new titles", "Admin approval", "Wait", "Verdict", "Keep or revert"];
const istAdmin = () => zustand.ich.rolle === "admin";
const URTEIL = {
  better: { text: "Better", klasse: "gut", satz: "The test group gained clearly more impressions than the control group, and sales did not suffer." },
  no_difference: { text: "No difference proven", klasse: "", satz: "The test group did not do clearly better than the control group. This counts as not better." },
  worse: { text: "Worse", klasse: "schlecht", satz: "The test group did worse than the control group, or its sales fell too much." },
  not_enough_data: { text: "Not enough data", klasse: "", satz: "Too few impressions in the test group to judge. This counts as not better." },
};

const badge = (t) => {
  if (t.status === "closed") return el("span", { class: "badge", text: t.abschluss === "behalten" ? "Kept" : "Reverted" });
  if (t.status === "approval") return el("span", { class: "badge vorbereitet", text: "Waiting for admin approval" });
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
  const { tests, moeglich, testGroesse, gesperrt } = zustand.tests;
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
      gesperrt ? el("p", { class: "leise klein", text: `${zahl(gesperrt)} listing${gesperrt === 1 ? " is" : "s are"} excluded from the draw because ${gesperrt === 1 ? "it is" : "they are"} part of a running price experiment in the shop.` }) : null,
      !genug ? el("p", { class: "leise", text: "There are not enough listings for a test of this size. Lower the test size in Settings." }) : null,
      el("div", { class: "aktionen" }, neu, !genug ? el("a", { class: "knopf", href: "#settings", text: "Open Settings" }) : null)),
    el("details", { class: "panel", ontoggle: async (ev) => {
      const box = ev.target; if (!box.open || box.dataset.geladen) return; box.dataset.geladen = "1";
      try { const demo = await api("/api/demo"); box.append(el("p", { class: "hinweis hinweis-warnung", text: "EXAMPLE. " + demo.hinweis }), ...demo.faelle.map((f) => el("div", {}, el("h3", { text: f.titel }), urteilBox({ urteil: f.urteil }), auswertungPanel(f.auswertung, false)))); }
      catch (e) { box.append(el("p", { class: "leise", text: e.message })); }
    } }, el("summary", { style: "cursor:pointer", text: "Show an example verdict (invented numbers)" })),
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
  const aktuell = d.status === "prepared" ? (alleTitel ? 2 : 1) : d.status === "approval" ? 2 : d.status === "running" ? 3 : d.status === "ready" ? 4 : 6;
  const fertig = d.status === "closed" ? 6 : aktuell;
  root.replaceChildren(
    zurueck(),
    el("div", { class: "kopf-zeile", style: "margin: 8px 0 16px" }, el("div", {}, el("h1", { text: d.name }), el("p", { class: "leise klein", text: `${d.anzahl.test} test + ${d.anzahl.kontrolle} control listings · drawn ${datum(d.erstellt_at)} (draw number ${d.seed}) · lever: title and search terms` })), badge(d)),
    schritteListe(d.status === "closed" ? -1 : aktuell, fertig),
    ...({ prepared: detailVorbereitet, approval: detailFreigabe, running: detailLaeuft, ready: detailBereit, closed: detailAbgeschlossen }[d.status](d)));
}

function testAngebote(d) { return d.angebote.filter((a) => a.gruppe === "test"); }
function kontrollAngebote(d) { return d.angebote.filter((a) => a.gruppe === "kontrolle"); }
function kontrollePanel(d) {
  return el("details", { class: "panel" },
    el("summary", { style: "cursor:pointer", text: `Control group (${d.anzahl.kontrolle} listings): leave these unchanged` }),
    kontrollAngebote(d).map((a) => el("div", { class: "angebotszeile zwei" }, bildVon(a), listingName(a))));
}

function detailVorbereitet(d) {
  const start = el("button", { class: "knopf knopf-akzent", type: "button", text: "Send for approval", disabled: d.anzahl.titel !== d.anzahl.test });
  start.addEventListener("click", () => { start.disabled = true; aktion("/api/experiment/freigabe", { id: d.id }, d.id, "Sent for approval. An admin has to approve the changes before anything changes on eBay."); });
  const manuell = istAdmin() ? zweiStufig(el("button", { class: "knopf", type: "button", text: "Start without changing eBay" }), "Titles are already changed on eBay?", () => aktion("/api/experiment/start", { id: d.id }, d.id, "Test started. Nothing was changed on eBay by the app.")) : null;
  const wegen = el("span", {});
  const fortschritt = el("span", { class: "leise", text: `${d.anzahl.titel} of ${d.anzahl.test} titles entered` });
  const aktualisiere = () => { const n = testAngebote(d).filter((a) => a.neu).length; fortschritt.textContent = `${n} of ${d.anzahl.test} titles entered`; start.disabled = n !== d.anzahl.test; if (manuell) manuell.disabled = n !== d.anzahl.test; };
  const max = zustand.tests.titelMaxZeichen;   // vom Server (TITEL_MAX_ZEICHEN in regeln.mjs), keine eigene Kopie der Zahl
  const zeilen = testAngebote(d).map((a) => {
    const feld = el("input", { class: "feld", type: "text", maxlength: String(max), "aria-label": "New title for product " + a.number, placeholder: `New title (up to ${max} characters)` });
    const schluessel = d.id + ":" + a.number;
    feld.value = a.neu || "";
    const stand = el("span", { class: "leise klein" });
    const zaehler = el("span", { text: `${feld.value.length} / ${max}` });
    let t;
    const speichern = async () => {
      const wert = feld.value;
      if (!wert.trim() || wert === (a.neu || "")) { if (wert === (a.neu || "")) entwurf.weg(schluessel); return; }
      stand.textContent = "Saving…"; feld.removeAttribute("aria-invalid");
      try { const r = await post("/api/experiment/titel", { id: d.id, number: a.number, neu: wert }); a.neu = r.neu; if (feld.value === wert) entwurf.weg(schluessel); stand.textContent = "Saved"; aktualisiere(); }
      catch (e) { feld.setAttribute("aria-invalid", "true"); stand.textContent = e.message; }
    };
    // Ein Entwurf aus dem Zwischenspeicher (z. B. nach abgelaufener Sitzung) wird wieder eingesetzt und gespeichert
    const gemerkt = entwurf.lies(schluessel);
    if (gemerkt != null && gemerkt !== feld.value) { feld.value = gemerkt; zaehler.textContent = `${gemerkt.length} / ${max}`; stand.textContent = "Restored your unsaved title."; t = setTimeout(speichern, 300); }
    feld.addEventListener("input", () => { entwurf.merke(schluessel, feld.value); zaehler.textContent = `${feld.value.length} / ${max}`; clearTimeout(t); stand.textContent = ""; t = setTimeout(speichern, 700); });
    feld.addEventListener("change", () => { clearTimeout(t); speichern(); });
    // Hinweise aus den eigenen Daten: Wörter der am besten gesehenen Angebote, die hier fehlen. Ein Klick hängt das Wort an (der Mensch entscheidet).
    const hilfe = el("div", { class: "leise klein titelhilfe" });
    api("/api/titelhilfe?nr=" + encodeURIComponent(a.number)).then((h) => {
      if (!h.ok) return;
      if (!h.hinweise.length) { hilfe.textContent = "Title hint: no word stands out clearly in your best-seen listings, so the app suggests none."; return; }
      hilfe.append("Often in your best-seen listings, missing here: ", ...h.hinweise.map((x) => el("button", { class: "wort", type: "button", title: `In ${x.top} % of the top ${h.basis.top} listings, in ${x.rest} % of the others`, text: x.wort,
        onclick: () => { const neu = (feld.value.trim() + " " + x.wort).trim(); if (neu.length > max) { stand.textContent = `Too long for ${max} characters.`; return; } feld.value = neu; entwurf.merke(schluessel, neu); zaehler.textContent = `${neu.length} / ${max}`; feld.dispatchEvent(new Event("change")); } })));
    }).catch(() => {});
    return el("div", { class: "angebotszeile" }, bildVon(a), listingName(a), el("div", { class: "titelfeld" }, feld, el("div", { class: "zaehlerzeile" }, stand, zaehler), hilfe));
  });
  const verwerfen = zweiStufig(el("button", { class: "knopf", type: "button", text: "Discard this test" }), "Really discard?", () => aktion("/api/experiment/abschluss", { id: d.id, abschluss: "zurueck" }, d.id, "Test discarded. The listings are free again."));
  return [
    el("div", { class: "panel" },
      el("h2", { text: "Enter the new titles" }),
      el("p", { class: "leise", text: "Enter the new title for each test listing. The app does not write titles for you. Nothing changes on eBay yet: after you send the test for approval, an admin checks the titles and lets the app change them on eBay. The control listings stay as they are." }),
      zeilen,
      el("div", { class: "aktionen" }, start, manuell, verwerfen, fortschritt)),
    kontrollePanel(d),
  ];
}

// Summen einer Gruppe (Ausgangszahlen bzw. aktuelle Zahlen)
function summe(zeilen, feld) {
  return zeilen.filter((z) => z.vorher && z.nachher).reduce((s, z) => ({ imp: s.imp + z[feld].imp, auf: s.auf + z[feld].auf, trans: s.trans + z[feld].trans }), { imp: 0, auf: 0, trans: 0 });
}
const titelListe = (d) => el("details", { class: "panel" }, el("summary", { style: "cursor:pointer", text: `Changed titles (${d.anzahl.test})` }),
  testAngebote(d).map((a) => el("div", { class: "angebotszeile titelpaar" }, bildVon(a), kasten("Old title", a.alt, false), kasten("New title", a.neu || "", false))));

function kasten(beschriftung, text, mitKopie) {
  return el("div", { class: "kasten", style: "margin:0" }, el("div", { class: "kasten-kopf" }, el("span", { class: "leise", text: beschriftung }), mitKopie ? el("button", { class: "knopf knopf-klein", type: "button", onclick: () => kopiere(text), text: "Copy" }) : null), el("div", { class: "kasten-text", text }));
}

// Test wartet auf die Freigabe durch einen Admin
function detailFreigabe(d) {
  const platz = el("div", {}, el("p", { class: "leise", text: "Loading …" }));
  api("/api/freigaben").then((f) => { platz.replaceChildren(...gruppenKarten(f, (a) => a.experiment_id === d.id && a.art === "titel", () => neuLaden(d.id))); }).catch((e) => { platz.textContent = e.message; });
  const verwerfen = zweiStufig(el("button", { class: "knopf", type: "button", text: "Discard this test" }), "Really discard?", () => aktion("/api/experiment/abschluss", { id: d.id, abschluss: "zurueck" }, d.id, "Test discarded. The listings are free again."));
  return [
    el("div", { class: "panel" }, el("h2", { text: "Waiting for approval" }),
      el("p", { class: "leise", text: istAdmin() ? "You are an admin: check the changes below, then approve them. The app changes the titles on eBay and the test starts once all titles are live." : "An admin has to approve these changes. Until then nothing changes on eBay, and you cannot edit the titles." }),
      el("div", { class: "aktionen" }, verwerfen)),
    platz, kontrollePanel(d),
  ];
}

function detailLaeuft(d) {
  const t = summe(testAngebote(d), "vorher"), k = summe(kontrollAngebote(d), "vorher");
  const stop = zweiStufig(el("button", { class: "knopf", type: "button", text: "Stop and revert" }), "Really stop?", () => aktion("/api/experiment/abschluss", { id: d.id, abschluss: "zurueck" }, d.id, "Test stopped. Going back to the old titles needs an admin's approval (see Approvals)."));
  return [
    el("div", { class: "panel" },
      el("h2", { text: "Waiting for data" }),
      el("p", { class: "leise", text: `The test started on ${datum(d.gestartet_at)}. It is day ${d.tage} of ${d.pruefungNachTagen}. The verdict comes on ${datum(d.bereit_am)}. Until then, do not change these listings again.` }),
      rollbar(el("table", { class: "mini" }, el("thead", {}, el("tr", {}, el("th", { text: "Starting figures (30 days before the start)" }), el("th", { class: "zahl", text: "Impressions" }), el("th", { class: "zahl", text: "Sales" }))),
        el("tbody", {}, el("tr", {}, el("td", { text: `Test group (${d.anzahl.test})` }), el("td", { class: "zahl", text: zahl(t.imp) }), el("td", { class: "zahl", text: zahl(t.trans) })),
          el("tr", {}, el("td", { text: `Control group (${d.anzahl.kontrolle})` }), el("td", { class: "zahl", text: zahl(k.imp) }), el("td", { class: "zahl", text: zahl(k.trans) }))))),
      el("div", { class: "aktionen" }, stop)),
    auswertungPanel(d.auswertung, true), titelListe(d), kontrollePanel(d),
  ];
}

// Auswertung mit Diagrammen (siehe diagramm.js). zwischenstand: Prüfzeit läuft noch, die Zahlen sind noch nicht das Urteil.
function auswertungPanel(a, zwischenstand) {
  if (!a || (!a.test.anzahl && !a.kontrolle.anzahl)) return null;
  const block = (titel, erklaerung, svg) => el("div", { class: "d-block" }, el("h3", { text: titel }), el("p", { class: "leise klein", text: erklaerung }), el("div", { class: "d-rahmen" }, svg));
  const links = a.test.ausgelassen + a.kontrolle.ausgelassen;
  const pz = Diagramm.proz;
  const kurz = a.test.median == null || a.kontrolle.median == null ? null
    : `Typical listing (median): test group ${pz(a.test.median)}, control group ${pz(a.kontrolle.median)}. ${Math.round((a.test.anteilBesser ?? 0) * a.test.anzahl)} of ${a.test.anzahl} test listings gained impressions, ${Math.round((a.kontrolle.anteilBesser ?? 0) * a.kontrolle.anzahl)} of ${a.kontrolle.anzahl} control listings.`;
  return el("div", { class: "panel auswertung" },
    el("h2", { text: "Evaluation" }),
    zwischenstand ? el("p", { class: "hinweis hinweis-warnung", text: "Interim view. The test period is not over yet, so these figures are not the verdict. Do not draw conclusions from them." }) : null,
    kurz ? el("p", { text: kurz }) : null,
    block("Impressions before and after", "Impressions in the 30 days before the start (grey) and in the last 30 days (colour). The control group shows what happened in the shop in the meantime.", Diagramm.saeulen(a)),
    block("Result against the goal", `The net effect compares how much the test group grew with how much the control group grew. It counts as better from ${pz(a.skala.besserAb)}. Sales must not fall by more than ${pz(a.skala.schutzGrenze, false)} compared with the control group.`, Diagramm.skala(a)),
    block("Every listing on its own", "Each dot is one listing, the line is the median. If most test dots sit clearly to the right of the control dots, the effect is broad and not just one lucky listing.", Diagramm.punkte(a)),
    links ? el("p", { class: "leise klein", text: `${links} listing${links === 1 ? "" : "s"} left out: no starting figures or no longer in the data.` }) : null);
}

function urteilBox(d) {
  const u = d.urteil; if (!u) return el("p", { class: "leise", text: "This test never started, so there is no verdict." });
  const info = URTEIL[u.urteil];
  const zeileMit = (name, v, n, einheit = zahl) => el("tr", {}, el("td", { text: name }), el("td", { class: "zahl", text: einheit(v) }), el("td", { class: "zahl", text: einheit(n) }), el("td", { class: "zahl", text: aenderung(v > 0 ? n / v - 1 : null) }));
  return el("div", { class: "urteil " + info.klasse },
    el("div", { class: "urteil-titel", text: info.text }),
    el("p", { text: info.satz }),
    rollbar(el("table", { class: "mini" }, el("thead", {}, el("tr", {}, el("th", { text: "Last 30 days" }), el("th", { class: "zahl", text: "Before" }), el("th", { class: "zahl", text: "After" }), el("th", { class: "zahl", text: "Change" }))),
      el("tbody", {},
        zeileMit("Impressions, test group", u.test.vorher.imp, u.test.nachher.imp), zeileMit("Impressions, control group", u.kontrolle.vorher.imp, u.kontrolle.nachher.imp),
        zeileMit("Sales, test group", u.test.vorher.trans, u.test.nachher.trans), zeileMit("Sales, control group", u.kontrolle.vorher.trans, u.kontrolle.nachher.trans)))),
    el("p", { class: "leise klein", text: `Net effect on impressions compared with the control group: ${aenderung(u.primaer.netto)}. Sales check: ${u.schutz.ok ? "sales did not fall too much" : "sales fell too much"}. The control group is drawn by lot, so season and chance affect both groups alike.` }));
}

function detailBereit(d) {
  const empf = d.urteil?.empfehlung;
  const knopf = (wert, text) => el("button", { class: "knopf" + (empf === (wert === "behalten" ? "keep" : "revert") ? " knopf-akzent" : ""), type: "button", text,
    onclick: () => aktion("/api/experiment/abschluss", { id: d.id, abschluss: wert }, d.id, wert === "behalten" ? "Kept as the new base. The listings are free for the next test." : "Closed. Going back to the old titles needs an admin's approval (see Approvals).") });
  return [
    el("div", { class: "panel" }, el("h2", { text: "Verdict" }), urteilBox(d),
      el("p", { text: empf === "keep" ? "Recommendation: keep the new titles." : "Recommendation: go back to the old titles." }),
      el("div", { class: "aktionen" }, knopf("behalten", "Keep the new titles"), knopf("zurueck", "Revert to the old titles"))),
    auswertungPanel(d.auswertung, false), titelListe(d), kontrollePanel(d),
  ];
}

function detailAbgeschlossen(d) {
  const zurueckGesetzt = d.abschluss === "zurueck";
  return [
    el("div", { class: "panel" }, el("h2", { text: d.abschluss === "behalten" ? "Kept" : "Reverted" }),
      el("p", { class: "leise", text: `Closed on ${datum(d.abschluss_at)}.` + (d.gestartet_at ? "" : " The test never started.") }),
      d.gestartet_at ? urteilBox(d) : null),
    d.gestartet_at ? auswertungPanel(d.auswertung, false) : null,
    zurueckGesetzt && d.gestartet_at
      ? el("div", { class: "panel" }, el("h2", { text: "Back to the old titles" }),
        el("p", { class: "leise", text: "The app changes the old titles back on eBay after an admin approves it. If the test never reached eBay, there is nothing to change." }),
        el("div", { class: "aktionen" }, el("a", { class: "knopf", href: "#approvals", text: "Open Approvals" })))
      : null,
  ];
}

// ======================================================= Approvals (Freigaben)
const AENDERUNG_STATUS = { offen: ["Waiting", "vorbereitet"], angewendet: ["Changed on eBay", "gut"], abgelehnt: ["Rejected", "schlecht"], fehlgeschlagen: ["Failed", "schlecht"], verworfen: ["Dropped", ""] };
const zeitpunkt = (s) => (s && !Number.isNaN(Date.parse(s)) ? new Date(s).toLocaleString(LOCALE, { dateStyle: "short", timeStyle: "short" }) : "–");

// Baut je Test und Art (neue Titel / Rückänderung) eine Karte. filter wählt aus, welche Änderungen gezeigt werden.
function gruppenKarten(f, filter, danach) {
  const gruppen = new Map();
  for (const a of f.aenderungen.filter(filter)) { const k = a.experiment_id + ":" + a.art; if (!gruppen.has(k)) gruppen.set(k, []); gruppen.get(k).push(a); }
  if (!gruppen.size) return [el("p", { class: "leere-hinweis leise", text: "No changes to show." })];
  return [...gruppen.values()].map((zeilen) => gruppenKarte(f, zeilen, danach));
}

function gruppenKarte(f, zeilen, danach) {
  const erste = zeilen[zeilen.length - 1]; // die Liste kommt neueste zuerst
  const offen = zeilen.filter((z) => z.status === "offen" || z.status === "fehlgeschlagen");
  const art = erste.art === "titel" ? "New titles" : "Back to the old titles";
  const fertig = async (pfad, body, text) => { try { const r = await post(pfad, body); meldung(typeof text === "function" ? text(r) : text); await danach(); ladeZaehler(); } catch (e) { meldung(e.message); danach(); } };
  const knoepfe = [];
  if (offen.length && istAdmin()) {
    const text = f.schreibenAn ? `Approve and change ${offen.length} on eBay` : "Approve (dry run only)";
    const frage = f.schreibenAn ? `Really change ${offen.length} title${offen.length === 1 ? "" : "s"} on eBay?` : "Run the dry run?";
    knoepfe.push(zweiStufig(el("button", { class: "knopf knopf-akzent", type: "button", text }), frage, () => fertig("/api/freigabe/erteilen", { id: erste.experiment_id, art: erste.art },
      (r) => r.schreibenAn ? `${r.angewendet} changed on eBay, ${r.fehlgeschlagen} failed.${r.gestartet ? " The test has started." : ""}` : `Dry run done: ${r.probelauf} change${r.probelauf === 1 ? "" : "s"} recorded in the Log, nothing was changed on eBay.${r.fehlgeschlagen ? ` ${r.fehlgeschlagen} could not be checked, see the reason below.` : ""}`)));
    knoepfe.push(zweiStufig(el("button", { class: "knopf", type: "button", text: "Reject" }), "Really reject?", () => fertig("/api/freigabe/ablehnen", { id: erste.experiment_id, art: erste.art }, "Rejected. Nothing was changed on eBay.")));
  }
  return el("div", { class: "panel" },
    el("div", { class: "kopf-zeile" }, el("div", {}, el("h2", { text: `${art} · ${erste.experiment_name}` }),
      el("p", { class: "leise klein", text: `Test #${erste.experiment_id} · proposed by ${erste.vorgeschlagen_von} on ${zeitpunkt(erste.vorgeschlagen_at)} · ${zeilen.length} change${zeilen.length === 1 ? "" : "s"}` })),
      offen.length ? el("span", { class: "badge vorbereitet", text: `${offen.length} waiting` }) : el("span", { class: "badge", text: "Done" })),
    zeilen.slice().reverse().map((z) => {
      const [name, klasse] = AENDERUNG_STATUS[z.status] || [z.status, ""];
      return el("div", { class: "angebotszeile vergleich" },
        el("div", {}, el("div", { class: "nummer", text: `No. ${z.number} · eBay item ${z.item_id}` }), kasten("Now on eBay", z.alt, false)),
        kasten("Proposed title", z.neu, false),
        el("div", {}, el("span", { class: "badge " + klasse, text: name }), z.ergebnis ? el("p", { class: "leise klein", text: z.ergebnis }) : null));
    }),
    knoepfe.length ? el("div", { class: "aktionen" }, knoepfe) : null,
    offen.length && !istAdmin() ? el("p", { class: "leise klein", text: "Only an admin can approve." }) : null);
}

async function ladeFreigaben() {
  const root = $("#ansicht-approvals");
  try {
    const f = await api("/api/freigaben");
    const offene = f.aenderungen.filter((a) => a.status === "offen" || a.status === "fehlgeschlagen").map((a) => a.experiment_id + ":" + a.art);
    const gruppiert = (offenFlag) => gruppenKarten(f, (a) => offene.includes(a.experiment_id + ":" + a.art) === offenFlag, ladeFreigaben);
    root.replaceChildren(
      el("div", { class: "einstieg" }, el("h1", { text: "Approvals" }),
        el("p", { class: "leise", text: `Builders propose new titles. An admin checks them here and approves. Only then does the app change the title on eBay, and every change is written to the Log. A single approval changes at most ${f.maxAenderungen} listings.` })),
      f.schreibenAn
        ? el("div", { class: "hinweiszeile", style: "margin-bottom:14px" }, el("span", { text: "Writing to eBay is ON on this computer. Approving changes real listings." }))
        : el("div", { class: "hinweiszeile", style: "margin-bottom:14px" }, el("span", { text: f.zugangsdaten ? "Writing to eBay is OFF (dry run). Approving only checks the listings and changes nothing. To allow changes, set EBAY_SCHREIBEN=an in the .env of the admin computer." : "This computer has no eBay credentials, so nothing can be changed on eBay from here." })),
      el("h2", { text: "Waiting for approval", style: "margin: 8px 0 10px" }), ...gruppiert(true),
      el("h2", { text: "History", style: "margin: 22px 0 10px" }), ...gruppiert(false));
    ladeZaehler();
  } catch (e) { zeigeFehler(e, ladeFreigaben); }
}

// ======================================================= Leiter (Titel -> Werbung -> Preis -> manuelle Prüfung)
const STUFE_TEXT = { titel: "1 · New title", werbung: "2 · Ads", preis: "3 · Lower price", pruefung: "4 · Manual check", raus: "Done" };
const ERGEBNIS_LEITER = { erholt: "Seen again", ueberarbeiten: "Rework", offline: "Take offline", behalten: "Keep as is", abgebrochen: "Taken off" };
const QUELLE_TEXT = { ki: "AI suggestion", regel: "From the title help (no AI)", hand: "Entered by hand" };
const EREIGNIS_TEXT = { aufgenommen: "Entered the ladder (low impressions)", vorschlag: "Suggestion ready", kein_vorschlag: "No suggestion possible", freigegeben: "Approved and changed on eBay",
  probelauf: "Dry run, nothing changed", fehlgeschlagen: "Change failed", gestartet: "Waiting time started", ausgewertet: "Checked after the waiting time", uebersprungen: "Step skipped",
  pruefung: "Moved to the manual check", entschieden: "Decided", abgebrochen: "Taken off the ladder" };

async function ladeLeiter() {
  const root = $("#ansicht-ladder");
  try { zeichneLeiter(await api("/api/leiter")); }
  catch (e) { zeigeFehler(e, ladeLeiter); root.replaceChildren(); }
}
async function leiterAktion(pfad, body, ok) {
  try { const r = await post(pfad, body); meldung(typeof ok === "function" ? ok(r) : ok); } catch (e) { meldung(e.message); }
  await ladeLeiter(); ladeZaehler();
}

function zeichneLeiter(l) {
  const root = $("#ansicht-ladder");
  const st = l.status;
  const warten = l.angebote.filter((a) => a.phase === "vorschlag" || a.phase === "offen");
  const laufen = l.angebote.filter((a) => a.phase === "laeuft");
  const fertig = l.angebote.filter((a) => a.stufe === "raus");
  const laufKnopf = istAdmin() ? el("button", { class: "knopf knopf-akzent", type: "button", disabled: st.laeuft, text: st.laeuft ? "Running …" : "Run the ladder now",
    onclick: (ev) => { ev.target.disabled = true; leiterAktion("/api/leiter/lauf", {}, (r) => `Done: ${r.aufgenommen} entered, ${r.ausgewertet} checked (${r.erholt} seen again), ${r.titelVorschlaege} title suggestions.`); } }) : null;
  root.replaceChildren(
    el("div", { class: "einstieg" }, el("h1", { text: "Ladder" }),
      el("p", { class: "leise", text: `Listings with low impressions climb step by step: first a new title, then ads, then a lower price. After each step the app waits, then checks whether the listing is seen again (at least ${zahl(l.grenze90)} impressions in 90 days, the limit of the diagnosis). If yes, it leaves the ladder; if not, the next step follows. After the third step a person checks the listing. Nothing changes on eBay without an admin's approval.` })),
    trichter(l),
    el("div", { class: "panel" },
      el("p", { class: "leise klein", text: [
        st.ki ? `Titles: AI (${st.kiModell}), every suggestion passes the rule check first` : "Titles: no AI key on this computer, suggestions come from the title help",
        `ads on eBay: ${st.werbungAn ? "on" : "off (dry run)"}`, `price changes on eBay: ${st.preisAn ? "on" : "off (dry run)"}`,
        st.automatisch ? `runs daily from ${st.uhrzeit}:00` : "daily run is off", `last run: ${st.letzterLauf ? zeitpunkt(st.letzterLauf) : "never"}${st.letzterFehler ? " (failed, see Log)" : ""}`,
        `${zahl(l.kandidaten)} more listings are waiting for a place (at most ${l.max} at a time)`].join(" · ") }),
      laufKnopf ? el("div", { class: "aktionen" }, laufKnopf) : null),
    el("h2", { text: `Waiting for a decision (${warten.length})`, style: "margin: 18px 0 10px" }),
    warten.length ? warten.map(leiterKarte) : el("p", { class: "leere-hinweis leise", text: "Nothing is waiting." }),
    el("h2", { text: `Waiting time running (${laufen.length})`, style: "margin: 22px 0 10px" }),
    laufen.length ? laufen.map(leiterKarte) : el("p", { class: "leere-hinweis leise", text: "No step is running." }),
    fertig.length ? el("details", { class: "panel", style: "margin-top:22px" }, el("summary", { style: "cursor:pointer", text: `Left the ladder (${fertig.length})` }), fertig.map(leiterKarte)) : null);
}

// Der Trichter oben: wie viele Angebote auf welcher Stufe stehen und wie viele die Leiter wie verlassen haben
function trichter(l) {
  const kasten = (titel, n, unter, klasse = "") => el("div", { class: "stufe " + klasse }, el("div", { class: "stufe-zahl", text: zahl(n) }), el("div", { class: "stufe-titel", text: titel }), unter ? el("div", { class: "leise klein", text: unter }) : null);
  return el("div", { class: "trichter", role: "list", "aria-label": "Ladder steps" },
    kasten(STUFE_TEXT.titel, l.zahl.titel, `${l.tage.titel} days`),
    kasten(STUFE_TEXT.werbung, l.zahl.werbung, `${Math.round(l.werbesatz * 100)} % · ${l.tage.werbung} days`),
    kasten(STUFE_TEXT.preis, l.zahl.preis, `−${Math.round(l.preisSchritt * 100)} % · ${l.tage.preis} days`),
    kasten(STUFE_TEXT.pruefung, l.zahl.pruefung, "a person decides"),
    kasten("Seen again", l.raus.erholt, `${l.raus.offline} offline · ${l.raus.ueberarbeiten} rework · ${l.raus.behalten} kept`, "gut"));
}

function leiterKarte(a) {
  const b = bildUrl(a.image_url);
  const kopf = el("div", { class: "leiter-kopf" },
    b ? el("img", { class: "bild", src: b, alt: "", loading: "lazy", referrerpolicy: "no-referrer" }) : el("span", { class: "bild" }),
    el("div", {}, el("div", { class: "titel", text: a.title || "(untitled)" }), el("div", { class: "leise klein", text: `No. ${a.number} · ${zahl(a.impressionen_90d)} impressions in 90 days · ${zahl(a.units_90d)} sales · on the ladder since ${datum(a.eingestiegen_at)}` })),
    el("span", { class: "badge " + (a.stufe === "raus" ? (a.ergebnis === "erholt" ? "gut" : "") : a.phase === "laeuft" ? "laeuft" : "vorbereitet"), text: a.stufe === "raus" ? ERGEBNIS_LEITER[a.ergebnis] || a.ergebnis : STUFE_TEXT[a.stufe] }));
  const inhalt = a.phase === "laeuft" ? leiterLaeuft(a) : a.phase === "offen" ? leiterPruefung(a) : a.phase === "vorschlag" ? leiterVorschlag(a) : [];
  return el("div", { class: "panel leiter-karte" }, kopf, ...inhalt, lebenslauf(a));
}

function leiterLaeuft(a) {
  const s = a.stand;
  const anteil = Math.min(1, s.gelaufen / s.tage);
  return [el("div", { class: "fortschritt", role: "progressbar", "aria-valuemin": 0, "aria-valuemax": s.tage, "aria-valuenow": s.gelaufen, "aria-label": "Waiting time" }, el("span", { style: `width:${Math.round(anteil * 100)}%` })),
    el("p", { class: "leise klein", text: `Day ${s.gelaufen} of ${s.tage} (with finished traffic data; checked on ${datum(s.ende + "T12:00:00Z")} or later). Before: ${zahl(s.vorher90)} impressions per 90 days${s.jetzt90 != null ? ` · so far: ${zahl(s.jetzt90)} per 90 days` : ""}.` })];
}

function leiterVorschlag(a) {
  const v = a.vorschlag;
  const aus = [];
  if (a.stufe === "titel") {
    const letzter = [...a.verlauf].reverse().find((e) => e.stufe === "titel");
    if (v) {
      aus.push(el("div", { class: "angebotszeile titelpaar", style: "grid-template-columns: minmax(0,1fr) minmax(0,1fr)" }, kasten("Old title", v.alt, false), kasten("New title (" + (QUELLE_TEXT[v.quelle] || v.quelle) + ")", v.titel, false)),
        el("p", { class: "leise klein", text: v.begruendung }));
      if (v.hinweis) aus.push(el("p", { class: "leise klein", text: "Note: " + v.hinweis }));
      for (const h of v.pruefung?.hinweise || []) aus.push(el("p", { class: "hinweis hinweis-warnung klein", text: h.text }));
      if (v.verworfen?.length) aus.push(el("details", { class: "klein" }, el("summary", { style: "cursor:pointer", text: `${v.verworfen.length} AI suggestion${v.verworfen.length === 1 ? " was" : "s were"} thrown away by the rule check` }),
        el("ul", {}, v.verworfen.map((x) => el("li", { text: `“${x.titel}”: ${x.verstoesse.map((y) => y.text).join(" ")}` })))));
    } else aus.push(el("p", { class: "leise", text: letzter?.ereignis === "kein_vorschlag" ? "No suggestion yet: " + letzter.details?.text : "No title suggestion yet. It comes with the next ladder run, or enter one below." }));
    aus.push(titelEingabe(a, v));
  } else if (a.stufe === "werbung") {
    aus.push(el("p", { text: `Switch on eBay Promoted Listings (standard) at ${Math.round((v?.satz ?? 0) * 100)} % of the sale price. The fee is only due when the item sells after a click on the ad.` }));
  } else if (a.stufe === "preis") {
    aus.push(v?.nichtMoeglich ? el("p", { class: "hinweis hinweis-warnung", text: v.nichtMoeglich + " Skip this step to go to the manual check." })
      : el("p", { text: `Lower the price from ${eur(v?.alt)} to ${eur(v?.neu)} (−${Math.round((v?.schritt ?? 0) * 100)} %). The app does not know the costs: check that the new price still pays off before approving.` }));
  }
  if (istAdmin()) {
    const kannFrei = !!v && !v.nichtMoeglich;
    const grund = el("input", { class: "feld", type: "text", maxlength: 200, placeholder: "Why skip? (optional)", "aria-label": "Reason for skipping" });
    aus.push(el("div", { class: "aktionen" },
      kannFrei ? zweiStufig(el("button", { class: "knopf knopf-akzent", type: "button", text: "Approve and change on eBay" }), "Really change on eBay?", () => leiterAktion("/api/leiter/freigabe", { number: a.number }, (r) => r.text)) : null,
      kannFrei || a.stufe !== "titel" ? el("button", { class: "knopf", type: "button", text: "Done by hand", title: "The change was made on eBay by hand (or should count as started without a change)", onclick: () => leiterAktion("/api/leiter/vonhand", { number: a.number }, "Waiting time started.") }) : null,
      zweiStufig(el("button", { class: "knopf", type: "button", text: "Skip this step" }), "Really skip?", () => leiterAktion("/api/leiter/ueberspringen", { number: a.number, grund: grund.value }, "Skipped. The next step is waiting."))),
      el("div", { style: "max-width:420px; margin-top:8px" }, grund));
  } else aus.push(el("p", { class: "leise klein", text: "An admin approves this step. Until then nothing changes on eBay." }));
  return aus;
}

// Titel von Hand eintragen oder die KI noch einmal fragen (Builder und Admin). Der Server prüft jeden Titel mit dem Regelprüfer.
function titelEingabe(a, v) {
  const feld = el("input", { class: "feld", type: "text", maxlength: String(zustand.betrieb?.regeln?.titelMaxZeichen || 80), value: v?.titel || "", "aria-label": "Your own title for product " + a.number, placeholder: "Your own title" });
  const zaehler = el("span", { class: "leise klein", text: `${feld.value.length} / ${feld.maxLength}` });
  feld.addEventListener("input", () => { zaehler.textContent = `${feld.value.length} / ${feld.maxLength}`; });
  return el("details", { class: "klein", style: "margin-top:8px" }, el("summary", { style: "cursor:pointer", text: "Enter a title yourself or ask the AI again" }),
    el("div", { class: "eingabezeile", style: "margin-top:8px" }, feld, zaehler),
    el("div", { class: "aktionen" },
      el("button", { class: "knopf", type: "button", text: "Use my title", onclick: () => leiterAktion("/api/leiter/titel", { number: a.number, titel: feld.value }, "Title saved, it passed the rule check.") }),
      el("button", { class: "knopf", type: "button", text: "Ask the AI again", onclick: (ev) => { ev.target.disabled = true; leiterAktion("/api/leiter/neuvorschlag", { number: a.number }, "New suggestion ready."); } })));
}

function leiterPruefung(a) {
  const auswertungen = a.verlauf.filter((e) => e.ereignis === "ausgewertet");
  const aus = [el("p", { text: "Title, ads and price did not bring the impressions back. Something about the product itself may be wrong: photos, fit, demand, or the competition. Please look at the listing and decide." }),
    auswertungen.length ? el("p", { class: "leise klein", text: auswertungen.map((e) => `${STUFE_TEXT[e.stufe]}: ${zahl(e.details.vorher90)} → ${zahl(e.details.nachher90)} per 90 days`).join(" · ") }) : null];
  if (istAdmin()) {
    const wahl = el("select", { class: "feld", "aria-label": "Decision" }, ["ueberarbeiten", "offline", "behalten"].map((k) => el("option", { value: k, text: ERGEBNIS_LEITER[k] })));
    const notiz = el("input", { class: "feld", type: "text", maxlength: 500, placeholder: "Why? (required)", "aria-label": "Reason for the decision" });
    aus.push(el("div", { class: "stapel", style: "max-width:520px" }, wahl, notiz),
      el("div", { class: "aktionen" }, el("button", { class: "knopf knopf-akzent", type: "button", text: "Save decision", onclick: () => leiterAktion("/api/leiter/entscheidung", { number: a.number, entscheidung: wahl.value, notiz: notiz.value }, "Decision saved.") })),
      el("p", { class: "leise klein", text: "“Take offline” does not end the listing automatically; it is a task for the admin on eBay." }));
  } else aus.push(el("p", { class: "leise klein", text: "An admin decides here." }));
  return aus;
}

function lebenslauf(a) {
  if (!a.verlauf.length) return null;
  const zeile = (e) => {
    const d = e.details || {};
    const extra = e.ereignis === "ausgewertet" ? ` ${zahl(d.vorher90)} → ${zahl(d.nachher90)} impressions per 90 days (limit ${zahl(d.grenze90)}): ${d.erholt ? "seen again" : "still too few"}`
      : e.ereignis === "vorschlag" && d.titel ? ` “${d.titel}”` : d.text ? " " + d.text : d.grund ? " " + d.grund : d.notiz ? ` ${ERGEBNIS_LEITER[d.entscheidung] || ""}: ${d.notiz}` : "";
    return el("li", { text: `${zeitpunkt(e.at)} · ${STUFE_TEXT[e.stufe] || e.stufe} · ${EREIGNIS_TEXT[e.ereignis] || e.ereignis}${extra}${e.benutzer !== "system" ? ` (${e.benutzer})` : ""}` });
  };
  return el("details", { class: "klein", style: "margin-top:10px" }, el("summary", { style: "cursor:pointer", text: `History (${a.verlauf.length})` }), el("ol", { class: "lebenslauf" }, a.verlauf.map(zeile)));
}

// ======================================================= Konto (Passwort ändern)
function zeichneKonto() {
  const root = $("#ansicht-account");
  const alt = el("input", { class: "feld", type: "password", autocomplete: "current-password", required: true, maxlength: 200, "aria-label": "Current password" });
  const neu = el("input", { class: "feld", type: "password", autocomplete: "new-password", required: true, minlength: 10, maxlength: 200, "aria-label": "New password" });
  const neu2 = el("input", { class: "feld", type: "password", autocomplete: "new-password", required: true, minlength: 10, maxlength: 200, "aria-label": "Repeat new password" });
  const fehler = el("p", { class: "leise", role: "alert" });
  const knopf = el("button", { class: "knopf", type: "submit", text: "Change password" });
  const form = el("form", { class: "panel", onsubmit: async (ev) => {
    ev.preventDefault(); fehler.textContent = "";
    if (neu.value !== neu2.value) { fehler.textContent = "The two new passwords are different."; return; }
    knopf.disabled = true;
    try { await post("/api/passwort", { altes: alt.value, neues: neu.value }); alt.value = neu.value = neu2.value = ""; meldung("Password changed. Other sessions of yours were signed out."); }
    catch (e) { fehler.textContent = e.message; }
    knopf.disabled = false;
  } },
    el("h2", { text: "Change password" }),
    el("div", { class: "stapel" }, el("label", {}, el("span", { class: "leise klein", text: "Current password" }), alt), el("label", {}, el("span", { class: "leise klein", text: "New password (at least 10 characters)" }), neu), el("label", {}, el("span", { class: "leise klein", text: "Repeat new password" }), neu2)),
    fehler, el("div", { class: "aktionen" }, knopf));
  root.replaceChildren(
    el("div", { class: "einstieg" }, el("h1", { text: "Account" }), el("p", { class: "leise", text: `Signed in as ${zustand.ich.name} (${zustand.ich.rolle === "admin" ? "admin" : "builder"}). Please never share your password, not even with the team.` })),
    form);
}

// ======================================================= Team (Rollen)
async function ladeTeam() {
  const root = $("#ansicht-team");
  try {
    const t = await api("/api/rollen");
    root.replaceChildren(
      el("div", { class: "einstieg" }, el("h1", { text: "Team" }),
        el("p", { class: "leise", text: "Admins approve changes that go to eBay and assign roles. Builders prepare tests and propose titles, but cannot change eBay. New people start as builders. Accounts are created on the computer that runs the app (npm run benutzer)." })),
      el("div", { class: "panel" },
        rollbar(el("table", { class: "mini" }, el("thead", {}, el("tr", {}, el("th", { text: "User" }), el("th", { text: "Role" }), el("th", { text: "Created" }))),
          el("tbody", {}, t.benutzer.map((b) => {
            const wahl = el("select", { class: "feld", "aria-label": "Role of " + b.name }, ["admin", "builder"].map((r) => el("option", { value: r, text: r === "admin" ? "Admin" : "Builder" })));
            wahl.value = b.rolle;
            wahl.addEventListener("change", async () => {
              wahl.disabled = true;
              try { await post("/api/rolle", { name: b.name, rolle: wahl.value }); meldung(`${b.name} is now ${wahl.value === "admin" ? "an admin" : "a builder"}.`); }
              catch (e) { meldung(e.message); }
              ladeTeam();
            });
            return el("tr", {}, el("td", { text: b.name + (b.name === zustand.ich.name ? " (you)" : "") }), el("td", {}, wahl), el("td", { text: datum(b.erstellt_at) }));
          }))))),
      el("p", { class: "leise klein", text: `${t.admins} admin${t.admins === 1 ? "" : "s"}. There is always at least one.` }));
  } catch (e) { zeigeFehler(e, ladeTeam); }
}

// ======================================================= Log (Protokoll)
const LOG_TEXT = {
  role_changed: "Role changed", change_proposed: "Change proposed", change_approved: "Approved", change_rejected: "Rejected", revert_proposed: "Revert proposed",
  ebay_changed: "Changed on eBay", ebay_failed: "eBay change failed", ebay_refused: "Not changed (title differs or listing inactive)", ebay_already_current: "Already up to date", ebay_dry_run: "Dry run",
  password_changed: "Password changed", backup: "Backup", test_created: "Test created", test_started: "Test started", test_started_manually: "Test started manually", test_closed: "Test closed", traffic_sync: "Traffic import",
  ladder_run: "Ladder run", ladder_freigegeben: "Ladder step changed on eBay", ladder_probelauf: "Ladder step: dry run", ladder_fehlgeschlagen: "Ladder step failed", ladder_started_manually: "Ladder step started by hand",
  ladder_skipped: "Ladder step skipped", ladder_decided: "Manual check decided", ladder_removed: "Taken off the ladder",
};
// Die Protokoll-Details haben deutsche Schlüssel (so stehen sie in der Datenbank); angezeigt werden sie englisch
const DETAIL_TEXT = {
  test: "test", number: "product", alt: "old title", neu: "new title", art: "kind", aenderung: "change", anzahl: "count", schreibenAn: "writing to eBay", verkauft: "sold so far",
  ack: "eBay answer", grund: "reason", fehler: "error", hinweis: "note", von: "from", zu: "to", dateien: "files", aktuell_bei_ebay: "now on eBay", listingStatus: "listing status",
  seed: "draw number", kontrolle: "control", gesperrt: "excluded (price experiment)", ohneZugangsdaten: "no eBay credentials", abschluss: "outcome", gekuerzt: "shortened",
  produkte: "products", kanaele: "channels", trafficBis: "traffic up to", tageGeholt: "days fetched", tageVorhanden: "days available", vollstaendig: "complete", limitErreicht: "limit reached",
  nachgeprueft: "days rechecked", abweichungen: "corrections", abdeckungMittel: "coverage (mean)", abdeckungMin: "coverage (min)", sekunden: "seconds",
};
const WERT_TEXT = { titel: "new title", zurueck: "revert", behalten: "keep", true: "yes", false: "no" };
const ERGEBNIS_TEXT = { ok: "ok", error: "error", dry_run: "dry run", refused: "refused" };
const detailText = (details) => Object.entries(details).map(([k, v]) => `${DETAIL_TEXT[k] || k}: ${v !== null && typeof v === "object" ? JSON.stringify(v) : WERT_TEXT[String(v)] ?? v}`).join(" · ");
async function ladeLog() {
  const root = $("#ansicht-log");
  try {
    const [l, ts, bt] = await Promise.all([api("/api/protokoll"), api("/api/traffic/status").catch(() => null), api("/api/betrieb").catch(() => null)]);
    const sich = bt?.sicherung;
    const sicherKnopf = sich && istAdmin()
      ? el("button", { class: "knopf knopf-klein", type: "button", disabled: sich.laeuft, text: "Back up now", onclick: async () => { try { await post("/api/sicherung", {}); meldung("Backup done."); } catch (e) { meldung(e.message); } ladeLog(); } })
      : null;
    const jetztKnopf = ts && istAdmin() && ts.zugangsdaten
      ? el("button", { class: "knopf knopf-klein", type: "button", disabled: ts.laeuft, text: ts.laeuft ? "Import is running …" : "Import now", onclick: async () => { try { await post("/api/traffic/import", {}); meldung("Traffic import started. It takes a few minutes, reload the Log afterwards."); setTimeout(ladeLog, 2000); } catch (e) { meldung(e.message); } } })
      : null;
    root.replaceChildren(
      el("div", { class: "einstieg" }, el("h1", { text: "Log" }),
        el("p", { class: "leise", text: "Everything that was proposed, approved, changed on eBay or imported, with who did it and the result. Entries are only ever added, never edited. The latest 300 are shown." })),
      ts ? el("div", { class: "panel" }, el("h2", { text: "Traffic import" }),
        el("p", { class: "leise", text: !ts.zugangsdaten ? "This computer has no eBay credentials, so it does not import traffic. Data comes from the team copy in the repository."
          : ts.automatisch ? `Runs automatically once a day from ${ts.uhrzeit}:00. Only finished days are imported (${ts.verzoegerungTage} days delay), and the latest ${ts.nachpruefenTage} days are checked again against eBay.`
          : "Automatic import is off. Set EBAY_TRAFFIC_AUTO=an in the .env of this computer to import traffic every day." }),
        el("p", { class: "leise klein", text: `Last successful import: ${zeitpunkt(ts.letzterErfolg)} · last failed import: ${ts.letzterFehler ? zeitpunkt(ts.letzterFehler) : "none"}` }),
        jetztKnopf ? el("div", { class: "aktionen" }, jetztKnopf) : null) : null,
      bt ? el("div", { class: "panel" }, el("h2", { text: "System" }),
        el("p", { class: "leise klein", text: `Environment: ${bt.umgebung === "prod" ? "live" : bt.umgebung === "vorschau" ? "preview (cannot change eBay)" : "local"} · version: ${bt.version || "n/a"} · writing to eBay: ${bt.schreibenAn ? "on" : "off"} · notifications to the admin: ${bt.benachrichtigung ? "on" : "off"}` }),
        el("p", { class: "leise klein", text: sich.automatisch ? `Daily backup at ${sich.uhrzeit}:00 · last backup: ${zeitpunkt(sich.letzte)} · ${sich.anzahl} kept${sich.zweiterOrt ? " · copied to a second location" : " · no second location set"}` : "Automatic backup is off." }),
        sicherKnopf ? el("div", { class: "aktionen" }, sicherKnopf) : null) : null,
      el("div", { class: "panel" }, l.length ? rollbar(el("table", { class: "mini protokoll" }, el("thead", {}, el("tr", {}, ["When", "Who", "What", "Object", "Result", "Details"].map((x) => el("th", { text: x })))),
        el("tbody", {}, l.map((z) => el("tr", {}, el("td", { text: zeitpunkt(z.zeit) }), el("td", { text: z.benutzer + (z.rolle ? ` (${z.rolle})` : "") }), el("td", { text: LOG_TEXT[z.aktion] || z.aktion }), el("td", { text: z.objekt || "" }),
          el("td", {}, el("span", { class: "badge " + (z.ergebnis === "ok" ? "gut" : z.ergebnis === "error" || z.ergebnis === "refused" ? "schlecht" : ""), text: ERGEBNIS_TEXT[z.ergebnis] || z.ergebnis })),
          el("td", { class: "klein details", text: z.details ? detailText(z.details) : "" })))))) : el("p", { class: "leise", text: "Nothing logged yet." })));
  } catch (e) { zeigeFehler(e, ladeLog); }
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
const ichGeladen = api("/api/ich").then((d) => { zustand.ich = { name: d.name || "", rolle: d.rolle || "builder" }; $("#benutzer").textContent = d.name ? `${d.name} (${d.rolle === "admin" ? "admin" : "builder"})` : ""; $("#nav-team").hidden = d.rolle !== "admin"; }).catch(() => {});

ichGeladen.then(laden).then(route); // erst die Rolle kennen, dann zeichnen
