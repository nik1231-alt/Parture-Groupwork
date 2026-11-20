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

// Wie replaceChildren, aber Listen werden ausgepackt und null/false weggelassen (replaceChildren selbst schreibt sie als Text hin:
// so stand auf der Seite Ladder "[object HTMLDivElement]" statt der Karten und "null" darunter)
const fuelle = (ziel, ...kinder) => ziel.replaceChildren(...kinder.flat(Infinity).filter((k) => k != null && k !== false));

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

const zustand = { ich: { name: "", rolle: "builder" }, daten: null, tests: null, einst: null, tab: "alle", funnel: null, funnelFilter: "alle", funnelSuche: "", funnelSichtbar: 50, suche: "", sortierung: "potential", sichtbar: SEITENGROESSE };

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
  fuelle(box, el("strong", { text: "Something went wrong. " }), document.createTextNode(e.message + " "), erneut ? el("button", { class: "knopf", type: "button", onclick: erneut, text: "Try again" }) : null);
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
    const [daten, stand, leiterDaten] = await Promise.all([api("/api/bewertung"), api("/api/stand").catch(() => null), api("/api/leiter").catch(() => null)]);
    zustand.daten = daten;
    // Funnel-Status je Produkt für die Hinweiszeile auf der Seite Products
    zustand.funnel = leiterDaten?.trichter ? new Map(leiterDaten.trichter.liste.map((x) => [x.number, x])) : null;
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
  const ansicht = ["problem", "tests", "ladder", "settings", "approvals", "team", "log", "account"].includes(seite) ? seite : "listings";
  for (const a of ["listings", "problem", "tests", "ladder", "settings", "approvals", "team", "log", "account"]) {
    $("#ansicht-" + a).hidden = a !== ansicht;
    $("#nav-" + a).setAttribute("aria-current", a === ansicht ? "page" : "false");
  }
  window.scrollTo(0, 0);
  // Die Listings immer frisch laden: Tests und Einstellungen verändern, welche Angebote wo stehen
  if (ansicht === "listings" && !ersterAufruf) laden();
  ersterAufruf = false;
  if (ansicht === "problem") ladeProblem();
  if (ansicht === "tests") ladeTests(arg ? Number(arg) : null);
  if (ansicht === "ladder") { if (arg && FUNNEL_TABS.includes(arg)) zustand.funnelTab = arg; else if (arg) { zustand.funnelSuche = decodeURIComponent(arg); zustand.funnelFilter = "alle"; zustand.funnelTab = "all"; } ladeLeiter(); }
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
  fuelle($("#tabs"), 
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
  const fu = zustand.funnel?.get(p.number);
  const hinweis = fu ? el("div", { class: "hinweiszeile" }, el("span", {}, statusChip(fu.status), " ", fu.grund), el("a", { class: "knopf knopf-klein", href: `#ladder/${encodeURIComponent(p.number)}`, text: "Show in Funnel" })) : null;
  const mehrInfo = el("div", { class: "produkt-mehr" }, el("p", { class: "leise klein", text: "Loading variants, eBay listing and history …" }));
  return el("details", { class: "zeile", ontoggle: (ev) => { if (ev.target.open && !mehrInfo.dataset.geladen) { mehrInfo.dataset.geladen = "1"; ladeProduktMehr(p.number, mehrInfo); } } },
    el("summary", { class: "zeilenkopf spalten" },
      bild ? el("img", { class: "bild", src: bild, alt: "", loading: "lazy", referrerpolicy: "no-referrer" }) : el("span", { class: "bild" }),
      el("div", { class: "name" }, el("div", { class: "titel", text: p.title || "(untitled)" }), el("div", { class: "nummer", text: "No. " + p.number })),
      el("span", { class: "zahl", text: eur(p.avg_price) }),
      el("span", { class: "zahl", text: zahl(p.units_90d) }),
      el("span", { class: "zahl", text: zahl(p.impressionen_90d) }),
      el("span", { class: "chip" }, el("span", { class: "punkt", style: `--punkt: var(--g-${p.gruppe})` }), p.empfehlung),
      el("span", { class: "pfeil", "aria-hidden": "true", text: "›" }),
      el("div", { class: "kennzahlen-kurz" }, el("span", { text: eur(p.avg_price) }), el("span", { text: `${zahl(p.units_90d)} sales` }), el("span", { text: `${zahl(p.impressionen_90d)} impressions` }))),
    el("div", { class: "zeilendetails" },
      el("p", { text: p.begruendung }),
      el("dl", { class: "kennzahlen" },
        kennzahl("Views 90 d", zahl(p.aufrufe_90d)), kennzahl("Click rate", prozent(p.klickrate, 2)), kennzahl("eBay conversion", prozent(p.conversion)),
        kennzahl("eBay sales total", zahl(p.units_total)), kennzahl("Last sold", datum(p.last_sold_at)), kennzahl("In catalogue since", datum(p.created_at))),
      hinweis, mehrInfo));
}

// Details eines Produkts erst beim Aufklappen laden: Varianten (Ausprägungen), Kanäle und alles, was mit ihm geschehen ist
async function ladeProduktMehr(nr, ziel) {
  try {
    const [p, v] = await Promise.all([api("/api/produkt?nr=" + encodeURIComponent(nr)), api("/api/produkt/verlauf?nr=" + encodeURIComponent(nr))]);
    let varianten = null; try { varianten = JSON.parse(p.variant_meta || "null"); } catch { /* ohne Varianten */ }
    const werte = varianten?.values || [];
    const KANAL = { ebay: "eBay", shopify: "Shop", amazon: "Amazon", etsy: "Etsy", tiktok: "TikTok", "ebay-ali": "eBay (second account)" };
    const geschichte = [
      ...v.verlauf.map((e) => ({ at: e.at, text: `${STUFE_TEXT[e.stufe] || e.stufe} · ${EREIGNIS_TEXT[e.ereignis] || e.ereignis}`, wer: e.benutzer })),
      ...v.protokoll.map((e) => ({ at: e.zeit, text: `${LOG_TEXT[e.aktion] || e.aktion}${e.ergebnis && e.ergebnis !== "ok" ? ` (${e.ergebnis})` : ""}`, wer: e.benutzer })),
    ].sort((a, b) => (a.at < b.at ? 1 : -1));
    fuelle(ziel,
      el("div", { class: "produkt-raster" },
        el("div", {}, el("h3", { text: werte.length ? `Variants · ${varianten.option || "option"}` : "Variants" }),
          werte.length ? el("ul", { class: "varianten" }, werte.map((w) => el("li", {}, el("span", { text: w.value }), el("span", { class: "leise", text: `${w.sku} · ${eur(w.price)}` }))))
            : el("p", { class: "leise klein", text: "One version only, no variants." })),
        el("div", {}, el("h3", { text: "Channels · reference only" }),
          p.kanaele.length ? el("ul", { class: "varianten" }, p.kanaele.map((k) => el("li", {}, el("span", { text: KANAL[k.channel] || k.channel }),
            el("span", { class: "leise", text: `${k.listed ? "listed" : "not listed"}${k.preis_aktuell ? " · " + eur(k.preis_aktuell) : ""} · ${zahl(k.units_90d ?? 0)} sales in 90 days` }))))
            : el("p", { class: "leise klein", text: "No eBay listing." }))),
      el("h3", { text: "History" }),
      geschichte.length ? el("ol", { class: "lebenslauf" }, geschichte.map((g) => el("li", { text: `${zeitpunkt(g.at)} · ${g.text}${g.wer && g.wer !== "system" ? ` (${g.wer})` : ""}` })))
        : el("p", { class: "leise klein", text: "Nothing has happened with this product in the app yet." }));
  } catch (e) { fuelle(ziel, el("p", { class: "hinweis hinweis-fehler klein", text: "Could not load the details: " + e.message })); }
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
  fuelle(root, 
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
  fuelle(root, 
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
    fuelle(root, 
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

// ======================================================= Problem (problem.mjs): wie ungleich Sichtbarkeit und Verkäufe verteilt sind
const SVG_NS = "http://www.w3.org/2000/svg";
function svg(tag, attrs = {}, ...kinder) {
  const n = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null && v !== false) n.setAttribute(k, String(v));
  for (const k of kinder.flat()) if (k != null) n.append(k);
  return n;
}
const svgText = (x, y, t, klasse = "", anker = "start") => { const n = svg("text", { x, y, class: "d-text " + klasse, "text-anchor": anker }); n.textContent = t; return n; };
const pz = (v, stellen = 0) => (v == null ? "–" : (100 * v).toLocaleString(LOCALE, { maximumFractionDigits: stellen }) + " %");

async function ladeProblem() {
  const root = $("#ansicht-problem");
  try { zeichneProblem(await api("/api/problem")); } catch (e) { zeigeFehler(e, ladeProblem); fuelle(root); }
}

function zeichneProblem(d) {
  const kachel = (titel, wert, unter, klasse = "") => el("div", { class: "kpi " + klasse }, el("div", { class: "kpi-titel", text: titel }), el("div", { class: "kpi-wert", text: wert }), unter ? el("div", { class: "kpi-unter", text: unter }) : null);
  const v80 = d.verkaeufe.fuer80, i80 = d.impressionen.fuer80;
  fuelle($("#ansicht-problem"),
    el("div", { class: "einstieg" }, el("h1", { text: "Problem" }),
      el("p", { class: "leise", text: "Live from the shop's eBay numbers (active eBay listings, eBay sales and impressions, last 90 days; other marketplaces are left out on purpose): a few listings carry most of the sales, while a long tail is hardly ever shown to buyers. This page is the reason the Funnel exists." })),
    el("div", { class: "kpis" },
      kachel("eBay listings", zahl(d.ebayAktiv), `active, of ${zahl(d.produkte)} products in the catalogue`),
      kachel("Sold nothing on eBay", zahl(d.ohneVerkauf), `${pz(d.ohneVerkauf / d.ebayAktiv)} of eBay listings, last 90 days`, "warn"),
      kachel("Barely seen on eBay", zahl(d.kaumGesehen), `${pz(d.kaumGesehen / d.ebayAktiv)} of eBay listings under ${zahl(d.grenze90)} impressions`, "offen"),
      kachel("Never shown", zahl(d.ohneImpressionen), "eBay listings with 0 impressions in 90 days", "grau")),
    el("div", { class: "aussagen" },
      aussage(pz(v80?.anteil, 1), "of the eBay listings bring 80 % of the eBay sales", `${zahl(v80?.anzahl)} of ${zahl(d.verkaeufe.anzahl)} listings · the best 10 % bring ${pz(d.verkaeufe.top10)}`, "phase"),
      aussage(pz(i80?.anteil), "of the eBay listings get 80 % of the impressions", `${zahl(i80?.anzahl)} of ${zahl(d.impressionen.anzahl)} listings · the best 10 % get ${pz(d.impressionen.top10)}`, "kontrolle")),
    el("section", { class: "panel" },
      el("h2", { text: "Where sales and visibility come from" }),
      el("p", { class: "leise klein", text: "eBay listings sorted from best to worst. The curve shows how much of the total the best x % bring. The higher and steeper it rises, the more the total depends on a few products. The dashed line would be a shop where every product does equally well." }),
      konzentrationsBild(d)),
    el("div", { class: "problem-raster" },
      el("section", { class: "panel" }, el("h2", { text: "Seen × sold" }),
        el("p", { class: "leise klein", text: `Every active eBay listing in one of four fields. “Seen” means at least ${zahl(d.grenze90)} impressions in 90 days, the limit of the diagnosis.` }),
        vierFelder(d)),
      el("section", { class: "panel" }, el("h2", { text: "How often buyers see a listing" }),
        el("p", { class: "leise klein", text: "eBay listings by impressions in 90 days. The orange columns are under the limit: that is where the Funnel starts." }),
        stufenBild(d))),
    el("div", { class: "panel kopf-zeile weiter" },
      el("div", {}, el("h2", { text: "What we do about it" }), el("p", { class: "leise klein", text: `The ${zahl(d.kaumGesehen)} barely seen listings go into the Funnel: new title, then ads, then a lower price, each step measured against a control group.` })),
      el("a", { class: "knopf knopf-akzent", href: "#ladder", text: "Open the Funnel →" })));
}

function aussage(gross, satz, unter, klasse) {
  return el("div", { class: "aussage " + klasse }, el("div", { class: "aussage-zahl", text: gross }), el("div", { class: "aussage-satz", text: satz }), el("div", { class: "leise klein", text: unter }));
}

// Konzentrationskurve: x = Anteil der Produkte (beste zuerst), y = Anteil der Summe; Markierung beim 80-%-Punkt
function konzentrationsBild(d) {
  const B = 720, H = 330, l = 48, r = 20, o = 18, u = 42, w = B - l - r, h = H - o - u;
  const x = (p) => l + w * p, y = (a) => o + h * (1 - a);
  const pfad = (kurve) => kurve.map((pt, i) => `${i ? "L" : "M"}${x(pt.produkte).toFixed(1)},${y(pt.anteil).toFixed(1)}`).join(" ");
  const gitter = [0, 0.2, 0.4, 0.6, 0.8, 1].flatMap((t) => [svg("line", { x1: l, x2: B - r, y1: y(t), y2: y(t), class: "d-gitter" }), svgText(l - 8, y(t) + 4, pz(t), "d-klein", "end"),
    svg("line", { x1: x(t), x2: x(t), y1: o, y2: o + h, class: "d-gitter" }), svgText(x(t), H - u + 18, pz(t), "d-klein", "middle")]);
  const marke = (pt, klasse, text, unten) => pt ? [svg("line", { x1: x(pt.anteil), x2: x(pt.anteil), y1: y(0.8), y2: o + h, class: "k-hilfslinie " + klasse }),
    svg("circle", { cx: x(pt.anteil), cy: y(0.8), r: 5, class: "k-punkt " + klasse }), svgText(x(pt.anteil) + (unten ? 10 : 16), y(0.8) + (unten ? 20 : -14), text, "d-wert " + klasse)] : [];
  return el("div", { class: "d-rahmen" }, svg("svg", { viewBox: `0 0 ${B} ${H}`, class: "diagramm", role: "img", "aria-label": `80 % of eBay sales come from ${pz(d.verkaeufe.fuer80?.anteil, 1)} of the listings, 80 % of impressions from ${pz(d.impressionen.fuer80?.anteil)} of the eBay listings` },
    ...gitter,
    svg("line", { x1: x(0), y1: y(0), x2: x(1), y2: y(1), class: "k-gleich" }),
    svg("line", { x1: l, x2: B - r, y1: y(0.8), y2: y(0.8), class: "k-achtzig" }), svgText(B - r, y(0.8) - 6, "80 %", "d-klein", "end"),
    svg("path", { d: pfad(d.impressionen.kurve), class: "k-kurve kontrolle" }),
    svg("path", { d: pfad(d.verkaeufe.kurve), class: "k-kurve phase" }),
    ...marke(d.verkaeufe.fuer80, "phase", `Sales: ${pz(d.verkaeufe.fuer80?.anteil, 1)} of listings`, false),
    ...marke(d.impressionen.fuer80, "kontrolle", `Impressions: ${pz(d.impressionen.fuer80?.anteil)}`, true),
    svgText(l + w / 2, H - 6, "Share of eBay listings, best first", "d-klein", "middle")),
    el("div", { class: "legende" }, el("span", { class: "leg phase", text: "eBay sales" }), el("span", { class: "leg kontrolle", text: "eBay impressions" }), el("span", { class: "leg gleich", text: "Every product equal" })));
}

// Vier Felder gesehen × verkauft: Fläche je Feld nach Anzahl, das Ziel des Funnels ist markiert
function vierFelder(d) {
  const f = d.felder, summe = Math.max(1, f.gesehenVerkauft + f.gesehenNichtVerkauft + f.kaumGesehenVerkauft + f.kaumGesehenNichtVerkauft);
  const feld = (n, titel, unter, klasse) => el("div", { class: "feld4 " + klasse },
    el("div", { class: "feld4-zahl", text: zahl(n) }), el("div", { class: "feld4-titel", text: titel }), el("div", { class: "feld4-unter", text: `${pz(n / summe)} · ${unter}` }),
    el("div", { class: "feld4-balken" }, el("i", { style: `width:${(100 * n) / summe}%` })));
  return el("div", { class: "felder4" },
    el("div", {}), el("div", { class: "feld4-kopf", text: "sold" }), el("div", { class: "feld4-kopf", text: "not sold" }),
    el("div", { class: "feld4-seite", text: "seen" }),
    feld(f.gesehenVerkauft, "Works", "keep it as it is", "gut"),
    feld(f.gesehenNichtVerkauft, "Seen, not bought", "price, photos or fit", "warn"),
    el("div", { class: "feld4-seite", text: "barely seen" }),
    feld(f.kaumGesehenVerkauft, "Sells despite few views", "more visibility pays off first", "ziel"),
    feld(f.kaumGesehenNichtVerkauft, "Invisible", "the Funnel's main target", "ziel"));
}

// Säulen der Impressions-Stufen; Stufen unter der Grenze sind orange
function stufenBild(d) {
  const max = Math.max(1, ...d.stufen.map((s) => s.anzahl));
  const name = (s) => s.bis === 0 ? "0" : s.bis == null ? `${zahl(s.von)}+` : `${zahl(s.von)}–${zahl(s.bis)}`;
  return el("div", { class: "stufen-bild" }, d.stufen.map((s) => el("div", { class: "stufe-saeule" + (s.unterGrenze ? " unter" : "") },
    el("div", { class: "stufe-wert", text: zahl(s.anzahl) }),
    el("div", { class: "stufe-balken" }, el("i", { style: `height:${Math.max(2, (100 * s.anzahl) / max)}%` })),
    el("div", { class: "stufe-name", text: name(s) }))));
}

// ======================================================= Leiter (Titel -> Werbung -> Preis -> manuelle Prüfung)
const STUFE_TEXT = { titel: "1 · New title", werbung: "2 · Ads", preis: "3 · Lower price", pruefung: "4 · Manual check", kontrolle: "Control group", raus: "Done" };
const ERGEBNIS_LEITER = { erholt: "Seen again", ueberarbeiten: "Rework", offline: "Take offline", behalten: "Keep as is", abgebrochen: "Taken off", kontrolle: "Control time over" };
const QUELLE_TEXT = { ki: "AI suggestion", regel: "From the title help (no AI)", hand: "Entered by hand" };
const EREIGNIS_TEXT = { aufgenommen: "Entered the ladder (low impressions)", vorschlag: "Suggestion ready", kein_vorschlag: "No suggestion possible", freigegeben: "Approved and changed on eBay",
  probelauf: "Dry run, nothing changed", fehlgeschlagen: "Change failed", gestartet: "Waiting time started", ausgewertet: "Checked after the waiting time", uebersprungen: "Step skipped",
  pruefung: "Moved to the manual check", entschieden: "Decided", abgebrochen: "Taken off the ladder",
  kontrolle: "Drawn into the control group (stays unchanged)", kontrolle_ende: "Control time over" };

async function ladeLeiter() {
  const root = $("#ansicht-ladder");
  try { zeichneLeiter(await api("/api/leiter")); }
  catch (e) { zeigeFehler(e, ladeLeiter); fuelle(root); }
}
async function leiterAktion(pfad, body, ok) {
  try { const r = await post(pfad, body); meldung(typeof ok === "function" ? ok(r) : ok); } catch (e) { meldung(e.message); }
  await ladeLeiter(); ladeZaehler();
}

// Status im Funnel (siehe leiter.trichter): Name, Farbe und Reihenfolge der Filter
const STATUS_TEXT = { nicht_geeignet: "Not eligible", geeignet: "Eligible", kontrolle: "Control group", titel: "Phase 1 · New title", werbung: "Phase 2 · Ads",
  preis: "Phase 3 · Lower price", pruefung: "Phase 4 · Manual check", erholt: "Seen again", raus: "Left, pausing" };
const STATUS_KLASSE = { nicht_geeignet: "grau", geeignet: "offen", kontrolle: "kontrolle", titel: "phase", werbung: "phase", preis: "phase", pruefung: "warn", erholt: "gut", raus: "grau" };
const STATUS_REIHE = ["nicht_geeignet", "geeignet", "kontrolle", "titel", "werbung", "preis", "pruefung", "erholt", "raus"];
const GRUND_TEXT = { genug: "Enough impressions already", neu: "Too new or no data yet", kein_ebay: "No active eBay listing", gesperrt: "Blocked by a price test", im_test: "In a title test", verkauft: "Already sold on eBay" };
const statusChip = (s) => el("span", { class: "status " + (STATUS_KLASSE[s] || ""), text: STATUS_TEXT[s] || s });

// Funnel-Seite (Niko 20.11.: "sehr intuitiv durchbewegen, leicht verständlich, übersichtlich, anwendungsbezogen"):
//   Kopf mit einem Satz und "How it works" zum Aufklappen, Band zum Datenstand, Schrittleiste 1–5 mit Zahlen,
//   drei Reiter: Overview (Kennzahlen, Bild, Wirkung) · Work (losen, freigeben, warten, entscheiden) · All products (Tabelle).
const FUNNEL_TABS = ["work", "overview", "all"];
function zeichneLeiter(l) {
  zustand.leiterDaten = l;
  zustand.leiterStatus = l.status;
  if (!FUNNEL_TABS.includes(zustand.funnelTab)) zustand.funnelTab = istAdmin() ? "work" : "overview";
  const tab = zustand.funnelTab, f = l.trichter;
  const reiter = (id, name, zahlText) => el("button", { class: "reiter", type: "button", role: "tab", "aria-selected": String(tab === id), onclick: () => { zustand.funnelTab = id; history.replaceState(null, "", "#ladder/" + id); zeichneLeiter(l); } },
    name, zahlText != null ? el("span", { class: "zahl-pille", text: String(zahlText) }) : null);
  const offen = l.angebote.filter((a) => a.phase === "vorschlag" || a.phase === "offen" || (a.phase === "laeuft" && a.stand && a.stand.gelaufen >= a.stand.tage)).length;
  fuelle($("#ansicht-ladder"),
    el("div", { class: "einstieg" }, el("h1", { text: "Funnel" }),
      el("p", { class: "leise", text: "Find the eBay listings buyers rarely see, change one thing at a time, and measure each change against a control group. Only eBay performance counts here." }),
      el("details", { class: "wie" }, el("summary", { text: "How it works" }),
        el("ol", { class: "wie-liste" },
          el("li", { text: `Eligible: under ${zahl(f.kpi.grenze90)} impressions in 90 days, active on eBay, not blocked.` }),
          el("li", { text: "Draw by lot: you choose how many. With a control group, the same number stays unchanged, so a busy or quiet season does not count as an effect." }),
          el("li", { text: "Phase 1 new title (AI + rule check) → Phase 2 ads (only if the listing is not advertised yet; otherwise it skips to the price) → Phase 3 lower price → Phase 4 manual check." }),
          el("li", { text: `After each waiting time you decide: “Seen again” (at least ${zahl(f.kpi.grenze90)} impressions per 90 days) or the next phase. The app shows the numbers and a recommendation.` }),
          el("li", { text: "Nothing changes on eBay until an admin approves it. Every step is in the history and the Log." })))),
    vorschauBand(),  datenBand(l),
    schrittLeiste(l),
    el("div", { class: "reiterleiste", role: "tablist", "aria-label": "Funnel views" },
      reiter("work", "Work", offen), reiter("overview", "Overview"), reiter("all", "All products", f.kpi.produkte)),
    tab === "overview" ? [kpiLeiste(l), trichterBild(l), wirkungTabelle(l)]
      : tab === "all" ? statusTabelle(f)
      : arbeitsBereich(l));
}

// Auf VORSCHAU deutlich sagen, dass hier nichts bei eBay passiert (20.11.: die erste Tranche wurde dort statt auf PROD gestartet)
function vorschauBand() {
  if (zustand.betrieb?.umgebung !== "vorschau") return null;
  return el("div", { class: "hinweis hinweis-warnung band" }, el("strong", { text: "Preview: nothing here changes eBay. " }), "This copy has its own data and only does dry runs. Real changes happen on ",
    el("a", { href: "https://app.parture-team.com/#ladder/work", text: "app.parture-team.com" }), ".");
}

// Band oben, solange die eBay-Daten alt sind: dann bewegen sich Prüfzeiten und Messungen nicht
function datenBand(l) {
  const bis = l.trafficBis;
  if (!bis) return null;
  const alter = Math.round((Date.now() - Date.parse(bis + "T12:00:00Z")) / 864e5);
  if (alter <= 3) return null;
  return el("div", { class: "hinweis hinweis-warnung band" }, el("strong", { text: `eBay data up to ${datum(bis + "T12:00:00Z")}. ` }),
    `Waiting times count finished data days, so they only move on when new days arrive (normally with a lag of 1–3 days; now ${alter} days).`);
}

// Schrittleiste: der Weg in fünf Schritten mit der Zahl, die gerade dort steht; Klick springt in die Arbeitsliste
function schrittLeiste(l) {
  const f = l.trichter, A = l.angebote;
  const vorschlag = A.filter((a) => a.phase === "vorschlag").length, laeuft = A.filter((a) => a.phase === "laeuft");
  const fertigWarten = laeuft.filter((a) => a.stand && a.stand.gelaufen >= a.stand.tage).length + A.filter((a) => a.phase === "offen").length;
  const schritt = (nr, titel, n, unter, ziel) => el("button", { class: "schritt-knopf" + (n ? " aktiv" : ""), type: "button", onclick: () => { zustand.funnelTab = ziel === "all" ? "all" : "work"; if (ziel === "all") zustand.funnelFilter = "geeignet"; zeichneLeiter(l); const z = document.getElementById(ziel); if (z) z.scrollIntoView({ behavior: "smooth", block: "start" }); } },
    el("span", { class: "schritt-nr", text: String(nr) }), el("span", { class: "schritt-text" }, el("strong", { text: titel }), el("small", { text: unter })), el("span", { class: "schritt-zahl", text: zahl(n) }));
  return el("div", { class: "schrittleiste" },
    schritt(1, "Choose", f.zahl.geeignet, "eligible listings", "ziehen"),
    schritt(2, "Approve", vorschlag, "suggestions waiting", "freigeben"),
    schritt(3, "Wait", laeuft.length - laeuft.filter((a) => a.stand && a.stand.gelaufen >= a.stand.tage).length, "waiting time running", "warten"),
    schritt(4, "Decide", fertigWarten, "waiting over or manual check", "entscheiden"),
    schritt(5, "Results", f.zahl.erholt + f.zahl.raus, "seen again or left", "ergebnis"));
}

function arbeitsBereich(l) {
  const A = l.angebote;
  const gruppe = (id, titel, hinweis, liste, extra = null) => el("section", { id, class: "arbeitsgruppe" },
    el("div", { class: "abschnitt-kopf" }, el("h2", {}, titel, el("span", { class: "zahl-pille", text: String(liste.length) })), extra),
    hinweis ? el("p", { class: "leise klein", text: hinweis }) : null,
    liste.length ? el("div", { class: "tabelle" }, liste.map((a) => leiterZeile(a, l))) : el("p", { class: "leere-hinweis leise", text: "Nothing here right now." }));
  const titelOffen = A.filter((a) => a.phase === "vorschlag" && a.stufe === "titel");
  const sonstOffen = A.filter((a) => a.phase === "vorschlag" && a.stufe !== "titel");
  const laeuft = A.filter((a) => a.phase === "laeuft");
  const warten = laeuft.filter((a) => !(a.stand && a.stand.gelaufen >= a.stand.tage)), entscheiden = [...laeuft.filter((a) => a.stand && a.stand.gelaufen >= a.stand.tage), ...A.filter((a) => a.phase === "offen")];
  const fertig = A.filter((a) => a.stufe === "raus" && a.ergebnis !== "kontrolle");
  return [
    istAdmin() ? ziehenPanel(l) : null,
    gruppe("freigeben", "Approve new titles", "Old title on the left, new one on the right; added words are highlighted. “Approve all” approves the whole list; tick rows to approve only some.", titelOffen, istAdmin() && titelOffen.length ? sammelFreigabe(titelOffen, l, "titel") : null),
    sonstOffen.length ? gruppe("freigeben-2", "Approve ads or price", "Ads only for listings that are not advertised yet; the app checks eBay right before and otherwise moves the listing to the price step.", sonstOffen, istAdmin() ? sammelFreigabe(sonstOffen, l, "sonst") : null) : null,
    gruppe("warten", "Waiting time running", "The change is live. The bars compare this listing with the control group over the same days.", warten),
    gruppe("entscheiden", "Decide", "The waiting time is over (or title, ads and price did not help). The app recommends a step; you decide.", entscheiden),
    el("details", { id: "ergebnis", class: "panel", style: "margin-top:18px" }, el("summary", { text: `Left the ladder (${fertig.length})` }), fertig.length ? el("div", { class: "tabelle" }, fertig.map((a) => leiterZeile(a, l))) : el("p", { class: "leise klein", text: "Nothing yet." })),
    istAdmin() ? el("details", { class: "panel" }, el("summary", { text: "Add one specific listing" }), auswahlAufnehmen(l.kandidatenListe || [])) : null,
    istAdmin() ? steuerZeile(l) : null];
}

// Losen: Anzahl frei wählbar, Kontrollgruppe ja/nein, Vorschau genau der Angebote, die gezogen würden (in Losreihenfolge)
function ziehenPanel(l) {
  const liste = l.kandidatenListe || [];
  const anzahl = el("input", { id: "zieh-anzahl", class: "feld", type: "number", min: 1, max: Math.max(1, liste.length), step: 1, value: String(Math.min(zustand.ziehAnzahl || 10, Math.max(1, liste.length))), "aria-label": "How many listings to put on the ladder" });
  const kontrolle = el("input", { id: "zieh-kontrolle", type: "checkbox", checked: zustand.ziehKontrolle !== false });
  const vorschau = el("div", { class: "zieh-vorschau" }), knopf = el("button", { class: "knopf knopf-akzent", type: "button" });
  const neu = () => {
    const n = Math.max(1, Math.min(liste.length, Math.floor(Number(anzahl.value) || 1))), mit = kontrolle.checked, gezogen = liste.slice(0, mit ? 2 * n : n);
    zustand.ziehAnzahl = n; zustand.ziehKontrolle = mit;
    const beworben = gezogen.filter((p) => p.beworben).length;
    knopf.textContent = mit ? `Draw ${zahl(Math.min(n, Math.floor(gezogen.length / 2)))} + ${zahl(Math.ceil(gezogen.length / 2))} control` : `Put ${zahl(gezogen.length)} on the ladder`;
    knopf.disabled = !liste.length;
    fuelle(vorschau,
      el("p", { class: "leise klein", text: mit ? `These ${zahl(gezogen.length)} listings go into the lot (in a fixed order, most impressions first). Half go on the ladder, half stay unchanged as the control group, decided by chance.` : `These ${zahl(gezogen.length)} listings go on the ladder (most impressions first), without a control group: their effect cannot be told apart from the season.` }),
      beworben ? el("p", { class: "leise klein", text: `${zahl(beworben)} of them are already advertised on eBay and will skip Phase 2 (ads).` }) : null,
      el("ol", { class: "zieh-liste" }, gezogen.slice(0, 40).map((p) => el("li", {}, el("span", { class: "titel-kurz", text: p.title || "(untitled)" }),
        el("span", { class: "leise klein", text: `No. ${p.number} · ${zahl(p.impressionen_90d)} imp. · ${zahl(p.units_90d)} sales` }), p.beworben ? el("span", { class: "status grau", text: "advertised" }) : null))),
      gezogen.length > 40 ? el("p", { class: "leise klein", text: `… and ${zahl(gezogen.length - 40)} more.` }) : null);
  };
  anzahl.addEventListener("input", neu); kontrolle.addEventListener("change", neu);
  knopf.addEventListener("click", () => { knopf.disabled = true; knopf.textContent = "Drawing and asking the AI …";
    leiterAktion("/api/leiter/ziehen", { anzahl: zustand.ziehAnzahl, kontrolle: zustand.ziehKontrolle }, (r) => `${r.aufgenommen} on the ladder${r.kontrolle ? `, ${r.kontrolle} in the control group` : ""}, ${r.titelVorschlaege} AI titles.`); });
  neu();
  return el("section", { id: "ziehen", class: "panel zieh-panel" },
    el("div", { class: "kopf-zeile" }, el("div", {}, el("h2", { text: "1 · Choose listings" }), el("p", { class: "leise klein", text: `${zahl(liste.length)} listings are eligible right now. There is no upper limit.` }))),
    el("div", { class: "zieh-felder" },
      el("label", { class: "zieh-feld", for: "zieh-anzahl" }, el("span", { text: "How many on the ladder" }), anzahl),
      el("label", { class: "zieh-feld schalter-feld" }, kontrolle, el("span", { text: "Draw a control group of the same size" })),
      knopf),
    vorschau);
}

// Sammelfreigabe (Niko 20.11.: "einen Button für Bulk Approval"): ein großer Knopf "Approve all N" für die ganze Gruppe,
// daneben "Approve ticked" für eine Auswahl über die Häkchen in den Zeilen. Jedes Angebot wird einzeln gegen eBay geprüft.
// gruppe: "titel" oder "sonst" (Werbung und Preis); live: schreibt die App gerade wirklich bei eBay?
function sammelFreigabe(liste, l, gruppe = "titel") {
  const freigebbar = liste.filter((a) => a.vorschlag && !a.vorschlag.nichtMoeglich);
  const live = gruppe === "titel" ? l.schreiben?.titel : l.schreiben?.werbung || l.schreiben?.preis;
  const was = gruppe === "titel" ? "title" : "step";
  const haken = () => [...document.querySelectorAll(`.zeile-haken[data-gruppe="${gruppe}"]`)];
  const gewaehlt = () => haken().filter((c) => c.checked).map((c) => c.value);
  const alleKnopf = el("button", { class: "knopf " + (live ? "knopf-live" : "knopf-akzent"), type: "button", disabled: !freigebbar.length,
    text: `Approve all ${freigebbar.length} ${was}${freigebbar.length === 1 ? "" : "s"} · ${live ? "LIVE" : "dry run"}` });
  const auswahlKnopf = el("button", { class: "knopf knopf-klein", type: "button", disabled: true, text: "Approve ticked" });
  const alle = el("input", { type: "checkbox", "aria-label": "Tick all", onchange: () => { for (const c of haken()) c.checked = alle.checked; aktualisiere(); } });
  const aktualisiere = () => { const n = gewaehlt().length; auswahlKnopf.disabled = !n; auswahlKnopf.textContent = n ? `Approve ${n} ticked` : "Approve ticked"; };
  const los = async (nummern, knopf) => {
    for (const k of [alleKnopf, auswahlKnopf]) k.disabled = true;
    knopf.textContent = `Approving ${nummern.length} … (about 2 s each)`;
    try { const r = await post("/api/leiter/freigabe-mehrere", { numbers: nummern }); meldung(`${r.angewendet} changed on eBay, ${r.probelauf} dry runs, ${r.fehler} failed.${r.fehler ? " Open “More → History” of the failed ones." : ""}`); } catch (e) { meldung(e.message); }
    await ladeLeiter(); ladeZaehler();
  };
  zweiStufig(alleKnopf, live ? `Really change all ${freigebbar.length} on eBay?` : `Run ${freigebbar.length} dry runs?`, () => los(freigebbar.map((a) => a.number), alleKnopf));
  zweiStufig(auswahlKnopf, live ? "Really change the ticked ones on eBay?" : "Run the dry runs?", () => los(gewaehlt(), auswahlKnopf));
  // Ein Listener für alle Häkchen der Seite (nicht bei jedem Neuzeichnen einen neuen)
  if (!window.__sammelHaken) { window.__sammelHaken = true; document.addEventListener("change", (ev) => { if (ev.target.classList?.contains("zeile-haken")) zustand.sammelAktualisieren?.forEach((f) => f()); }); }
  (zustand.sammelAktualisieren ||= new Set()).add(aktualisiere);
  return el("span", { class: "sammel" }, alleKnopf, el("label", { class: "sammel-alle" }, alle, " tick all"), auswahlKnopf);
}

// Eine Zeile der Arbeitsliste: Bild, Titel (alt → neu), Kennzahlen, Status, ein Hauptknopf; Aufklappen für alles Weitere
function leiterZeile(a, l) {
  const b = bildUrl(a.image_url), v = a.vorschlag;
  const live = a.stufe === "titel" ? l.schreiben?.titel : a.stufe === "werbung" ? l.schreiben?.werbung : l.schreiben?.preis;
  const ebayLink = a.ebay_id ? el("a", { class: "ebay-link", href: `https://www.ebay.de/itm/${encodeURIComponent(a.ebay_id)}`, target: "_blank", rel: "noopener noreferrer", text: "eBay ↗" }) : null;
  const marken = [
    el("span", { class: "status " + (a.stufe === "raus" ? (a.ergebnis === "erholt" ? "gut" : "grau") : a.phase === "laeuft" ? "phase" : a.phase === "offen" ? "warn" : "offen"), text: a.stufe === "raus" ? ERGEBNIS_LEITER[a.ergebnis] || a.ergebnis : STUFE_TEXT[a.stufe] }),
    a.beworben && a.stufe !== "raus" ? el("span", { class: "status grau", title: `Already advertised in “${a.beworben}”: skips Phase 2`, text: "advertised → skips ads" }) : null,
    a.verlauf?.some((e) => e.ereignis === "aufgenommen" && e.details?.vonHand) ? el("span", { class: "status grau", title: "Added by hand, no control partner", text: "added by hand" }) : null];
  // Inhalt je Stufe
  let mitte = null, haupt = null, haken = null;
  if (a.phase === "vorschlag" && a.stufe === "titel") {
    mitte = v ? titelDiff(v.alt, v.titel) : el("p", { class: "leise klein", text: (zustand.leiterStatus?.ki ? "No suggestion yet." : "No AI key: enter a title below.") + " Open the row to enter one or ask the AI." });
    if (istAdmin() && v && !v.nichtMoeglich) { haken = el("input", { type: "checkbox", class: "zeile-haken", "data-gruppe": "titel", value: a.number, "aria-label": "Tick for approval" }); haupt = freigabeKnopf(a, live); }
    else if (istAdmin() && !v) haupt = el("button", { class: "knopf knopf-klein", type: "button", text: "Ask the AI", onclick: (ev) => { ev.target.disabled = true; ev.target.textContent = "Asking …"; leiterAktion("/api/leiter/neuvorschlag", { number: a.number }, "New suggestion ready."); } });
  } else if (a.phase === "vorschlag" && a.stufe === "werbung") {
    mitte = el("p", { class: "klein", text: a.beworben ? `Already advertised in “${a.beworben}”. Approving moves it straight to the price step; no second ad is created.` : `Switch on Promoted Listings at ${Math.round((v?.satz ?? 0) * 100)} % of the sale price (paid only when it sells after an ad click).` });
    if (istAdmin()) haken = el("input", { type: "checkbox", class: "zeile-haken", "data-gruppe": "sonst", value: a.number, "aria-label": "Tick for approval" });
    if (istAdmin()) haupt = a.beworben ? zweiStufig(el("button", { class: "knopf knopf-akzent knopf-klein", type: "button", text: "Move to price step" }), "Really?", () => leiterAktion("/api/leiter/freigabe", { number: a.number }, (r) => r.text)) : freigabeKnopf(a, live);
  } else if (a.phase === "vorschlag" && a.stufe === "preis") {
    mitte = v?.nichtMoeglich ? el("p", { class: "hinweis hinweis-warnung klein", text: v.nichtMoeglich }) : el("p", { class: "klein" }, "Price ", el("del", { text: eur(v?.alt) }), " → ", el("strong", { text: eur(v?.neu) }), ` (−${Math.round((v?.schritt ?? 0) * 100)} %). The app does not know the costs: check that it still pays off.`);
    if (istAdmin() && v && !v.nichtMoeglich) { haupt = freigabeKnopf(a, live); haken = el("input", { type: "checkbox", class: "zeile-haken", "data-gruppe": "sonst", value: a.number, "aria-label": "Tick for approval" }); }
  } else if (a.phase === "laeuft") {
    const s = a.stand, e = empfehlung(a, l);
    mitte = el("div", {}, el("div", { class: "fortschritt", role: "progressbar", "aria-valuemin": 0, "aria-valuemax": s.tage, "aria-valuenow": s.gelaufen, "aria-label": "Waiting time" }, el("span", { style: `width:${Math.round(Math.min(1, s.gelaufen / s.tage) * 100)}%` })),
      el("p", { class: "leise klein", text: `Started ${datum(a.stufe_start + "T12:00:00Z")} · data day ${s.gelaufen} of ${s.tage} · due ${datum(s.ende + "T12:00:00Z")}` }),
      e ? el("p", { class: "empfehlung " + e.klasse, text: e.text }) : null);
    if (istAdmin()) haupt = el("span", { class: "knopf-paar" },
      zweiStufig(el("button", { class: "knopf knopf-klein" + (e?.ziel === "weiter" ? " knopf-akzent" : ""), type: "button", text: `Next phase →` }), "Really move on?", () => leiterAktion("/api/leiter/schieben", { number: a.number, ziel: "weiter" }, (r) => r.werbungUebersprungen ? `Already advertised (${r.werbungUebersprungen.join(", ")}): moved straight to the price step.` : `Moved to ${STUFE_TEXT[r.stufe] || r.stufe}.`)),
      zweiStufig(el("button", { class: "knopf knopf-klein" + (e?.ziel === "erholt" ? " knopf-akzent" : ""), type: "button", text: "Seen again ✓" }), "Really mark as seen again?", () => leiterAktion("/api/leiter/schieben", { number: a.number, ziel: "erholt" }, "Marked as seen again; the listing left the ladder.")));
  } else if (a.phase === "offen") {
    mitte = el("p", { class: "klein", text: "Title, ads and price did not bring the impressions back. Open the row to decide: rework, take offline or keep." });
  }
  const details = el("details", { class: "zeile-mehr" }, el("summary", { text: "More" }), ...zeileMehr(a, l));
  return el("div", { class: "lzeile " + (a.phase || "") },
    el("div", { class: "lzeile-haken" }, haken),
    b ? el("img", { class: "bild", src: b, alt: "", loading: "lazy", referrerpolicy: "no-referrer" }) : el("span", { class: "bild" }),
    el("div", { class: "lzeile-mitte" },
      el("div", { class: "lzeile-kopf" }, el("span", { class: "titel-kurz", text: a.title || "(untitled)" }), ...marken),
      el("div", { class: "leise klein lzeile-zahlen" }, `No. ${a.number} · ${zahl(a.impressionen_90d)} impressions · ${zahl(a.units_90d)} eBay sales in 90 days `, ebayLink),
      mitte, details),
    el("div", { class: "lzeile-aktion" }, haupt));
}

// Freigabeknopf: sagt, ob gerade wirklich bei eBay geschrieben wird oder nur zur Probe
function freigabeKnopf(a, live) {
  return zweiStufig(el("button", { class: "knopf knopf-klein " + (live ? "knopf-live" : "knopf-akzent"), type: "button", title: live ? "Writes to the live eBay listing" : "Dry run: everything is checked, nothing changes on eBay", text: live ? "Approve · LIVE on eBay" : "Approve · dry run" }),
    live ? "Really change on eBay?" : "Run the dry run?", () => leiterAktion("/api/leiter/freigabe", { number: a.number }, (r) => r.text));
}

// Alt → neu als Wörter: gestrichene durchgestrichen, neue hervorgehoben; Zeichen gezählt
function titelDiff(alt, neu) {
  const w = (s) => String(s || "").split(/\s+/).filter(Boolean), norm = (x) => x.toLowerCase().replace(/[.,;:!?()]/g, "");
  const altSet = new Set(w(alt).map(norm)), neuSet = new Set(w(neu).map(norm));
  const wort = (x, set, tag) => (set.has(norm(x)) ? document.createTextNode(x + " ") : el(tag, { text: x + " " }));
  return el("div", { class: "diff" },
    el("div", { class: "diff-alt" }, el("span", { class: "diff-tag", text: "old" }), ...w(alt).map((x) => wort(x, neuSet, "del"))),
    el("div", { class: "diff-neu" }, el("span", { class: "diff-tag", text: "new" }), ...w(neu).map((x) => wort(x, altSet, "mark")), el("span", { class: "leise klein", text: `${String(neu || "").length}/80` })));
}

// Empfehlung für eine laufende Prüfzeit aus den Zahlen (der Admin entscheidet)
function empfehlung(a, l) {
  const s = a.stand, grenze = l.grenze90;
  if (!s || s.jetzt90 == null) return { ziel: null, klasse: "grau", text: "No new traffic data since the start yet." };
  const fertig = s.gelaufen >= s.tage, ueber = s.jetzt90 >= grenze, netto = s.netto != null ? ` · net effect vs control ${aenderung(s.netto)}` : "";
  if (ueber) return { ziel: "erholt", klasse: "gut", text: `${zahl(s.jetzt90)} impressions per 90 days, above the limit of ${zahl(grenze)}${netto}. Recommended: Seen again.` };
  if (fertig) return { ziel: "weiter", klasse: "warn", text: `Still ${zahl(s.jetzt90)} per 90 days, under the limit of ${zahl(grenze)}${netto}. Recommended: next phase.` };
  return { ziel: null, klasse: "grau", text: `So far ${zahl(s.jetzt90)} per 90 days (before ${zahl(s.vorher90)})${netto}. Waiting time still running.` };
}

// Aufgeklappt: Zwischenstand, eigener Titel, Überspringen, von Hand gemacht, von der Leiter nehmen, Verlauf
function zeileMehr(a, l) {
  const teile = [];
  if (a.phase === "laeuft" && a.stand) teile.push(zwischenstand(a.stand));
  if (a.phase === "vorschlag" && a.stufe === "titel") {
    const v = a.vorschlag;
    if (v?.begruendung) teile.push(el("p", { class: "leise klein", text: "Why: " + v.begruendung }));
    for (const h of v?.pruefung?.hinweise || []) teile.push(el("p", { class: "hinweis hinweis-warnung klein", text: h.text }));
    teile.push(titelEingabe(a, v));
  }
  if (a.phase === "offen") teile.push(...leiterPruefung(a));
  if (istAdmin() && a.stufe !== "raus") {
    const grund = el("input", { class: "feld", type: "text", maxlength: 200, placeholder: "Reason (optional)", "aria-label": "Reason" });
    teile.push(el("div", { class: "aktionen" },
      a.phase === "vorschlag" ? el("button", { class: "knopf knopf-klein", type: "button", text: "Done by hand", title: "The change was made on eBay by hand: start the waiting time", onclick: () => leiterAktion("/api/leiter/vonhand", { number: a.number }, "Waiting time started.") }) : null,
      a.phase === "vorschlag" ? zweiStufig(el("button", { class: "knopf knopf-klein", type: "button", text: "Skip this step" }), "Really skip?", () => leiterAktion("/api/leiter/ueberspringen", { number: a.number, grund: grund.value }, (r) => r.werbungUebersprungen ? "Skipped; already advertised, so it moved straight to the price step." : "Skipped. The next step is waiting.")) : null,
      zweiStufig(el("button", { class: "knopf knopf-klein", type: "button", text: "Take off the ladder" }), "Really take it off?", () => leiterAktion("/api/leiter/abbrechen", { number: a.number, grund: grund.value }, (r) => r.pause ? "Taken off. It was changed on eBay, so it pauses 90 days." : "Taken off. Nothing was changed on eBay, so it is eligible again right away.")),
      el("span", { class: "grund-feld" }, grund)));
  }
  teile.push(lebenslauf(a));
  return teile;
}

// Steuerzeile ganz unten: Schalter, Lauf, Neustart
function steuerZeile(l) {
  const st = l.status;
  const schalter = (name, an, text) => el("li", {}, name + ":", el("span", { class: an ? "an" : "aus", text }));
  const behalten = l.angebote.filter((a) => a.stufe !== "raus").length;
  return el("div", { class: "panel kopf-zeile steuerung" },
    el("ul", { class: "leiter-status", "aria-label": "Ladder status" },
      schalter("Titles on eBay", l.schreiben?.titel, l.schreiben?.titel ? "LIVE" : "dry run"),
      schalter("Ads on eBay", l.schreiben?.werbung, l.schreiben?.werbung ? "LIVE" : "dry run"),
      schalter("Prices on eBay", l.schreiben?.preis, l.schreiben?.preis ? "LIVE" : "dry run"),
      schalter("AI titles", st.ki, st.ki ? st.kiModell : "no key"),
      schalter("Movement", true, l.bewegung === "automatisch" ? "automatic" : "by hand"),
      el("li", { text: `Advertised on eBay: ${l.werbung?.anzahl ?? "?"} listings${l.werbung?.stand ? ` (checked ${zeitpunkt(l.werbung.stand)})` : ""}${l.werbung?.fehler ? " · check failed: " + l.werbung.fehler : ""}` })),
    el("div", { class: "aktionen", style: "margin-top:0" },
      el("button", { class: "knopf knopf-klein", type: "button", text: "Get AI titles", onclick: (ev) => { ev.target.disabled = true; leiterAktion("/api/leiter/lauf", {}, (r) => `${r.titelVorschlaege} new AI titles.`); } }),
      behalten ? zweiStufig(el("button", { class: "knopf knopf-klein", type: "button", text: "Start over" }), "Really reset everything not changed on eBay?", () => leiterAktion("/api/leiter/neustart", { grund: "Start over" }, (r) => `${r.zurueckgesetzt} listings are eligible again${r.behalten ? `, ${r.behalten} stay (already changed on eBay)` : ""}.`)) : null));
}

// Kennzahlen oben: wie groß der Shop ist, wie viele Impressionen er hat und wo die Produkte gerade stehen
function kpiLeiste(l) {
  const f = l.trichter, k = f.kpi;
  const kachel = (titel, wert, unter, klasse = "") => el("div", { class: "kpi " + klasse }, el("div", { class: "kpi-titel", text: titel }), el("div", { class: "kpi-wert", text: wert }), unter ? el("div", { class: "kpi-unter", text: unter }) : null);
  return el("div", { class: "kpis" },
    kachel("Products", zahl(k.produkte), `${zahl(f.zahl.nicht_geeignet)} not eligible · ${zahl(f.zahl.geeignet)} eligible`),
    kachel("Impressions, 90 days", zahl(k.impressionen90), "all products together"),
    kachel("On the ladder", zahl(k.aufLeiter), `${zahl(k.impressionenLeiter90)} impressions in 90 days`, "phase"),
    kachel("Control group", zahl(f.zahl.kontrolle), `${zahl(k.impressionenKontrolle90)} impressions in 90 days`, "kontrolle"),
    kachel("Seen again", zahl(l.raus.erholt), "left the ladder with enough impressions", "gut"));
}

// Der Funnel als Bild (Niko 20.11.: visuell statt Text, Methodik unverändert):
//   1. alle Produkte als ein gestapelter Balken nach Status, 2. warum nicht geeignet: je Grund "x von N" als Balken,
//   3. die Leiter als Fluss: geeignet → Los → Phase 1 … 4 → wieder gesehen, Abzweig Kontrollgruppe; Kreisfläche ~ Anzahl.
// Ein Klick auf jeden Teil filtert die Tabelle aller Produkte unten.
function trichterBild(l) {
  const f = l.trichter, N = Math.max(1, f.kpi.produkte);
  const filtern = (status) => { zustand.funnelFilter = status; zustand.funnelSichtbar = 50; zustand.funnelTab = "all"; zeichneLeiter(l); $("#funnel-tabelle")?.scrollIntoView({ behavior: "smooth", block: "start" }); };
  const anteil = (n) => pz(n / N, n && n / N < 0.01 ? 1 : 0);
  const seg = STATUS_REIHE.filter((s) => f.zahl[s] > 0).map((s) => el("button", { class: "fb-seg " + (STATUS_KLASSE[s] || ""), type: "button", style: `flex-grow:${f.zahl[s]}`,
    title: `${STATUS_TEXT[s]}: ${zahl(f.zahl[s])} of ${zahl(N)} (${anteil(f.zahl[s])})`, "aria-label": `${STATUS_TEXT[s]}: ${zahl(f.zahl[s])}`, onclick: () => filtern(s) },
    f.zahl[s] / N >= 0.06 ? el("span", { text: zahl(f.zahl[s]) }) : null));
  const legende = STATUS_REIHE.map((s) => el("button", { class: "fb-leg", type: "button", onclick: () => filtern(s) },
    el("span", { class: "punkt status-punkt " + (STATUS_KLASSE[s] || "") }), el("span", { text: STATUS_TEXT[s] }), el("strong", { text: zahl(f.zahl[s] || 0) })));
  const gruende = Object.entries(f.gruende).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).map(([a, n]) => el("button", { class: "gr-zeile", type: "button", onclick: () => filtern("nicht_geeignet") },
    el("span", { class: "gr-name", text: GRUND_TEXT[a] || a }),
    el("span", { class: "gr-balken" }, el("i", { style: `width:${(100 * n) / N}%` })),
    el("span", { class: "gr-wert" }, el("strong", { text: zahl(n) }), ` of ${zahl(N)} · ${anteil(n)}`)));
  const maxP = Math.max(1, f.zahl.geeignet, f.zahl.kontrolle, f.zahl.titel, f.zahl.werbung, f.zahl.preis, f.zahl.pruefung, f.zahl.erholt);
  const knoten = (status, titel, unter) => {
    const n = f.zahl[status] || 0, d = Math.round(46 + 50 * Math.sqrt(n / maxP));
    return el("button", { class: "pl-knoten " + (STATUS_KLASSE[status] || "") + (n ? "" : " leer"), type: "button", onclick: () => filtern(status), title: `${STATUS_TEXT[status]}: ${zahl(n)}` },
      el("span", { class: "pl-kreis", style: `width:${d}px;height:${d}px` }, el("span", { text: zahl(n) })),
      el("strong", { text: titel }), el("small", { text: unter }));
  };
  const pfeil = (text) => el("span", { class: "pl-pfeil", "aria-hidden": "true" }, text ? el("small", { text }) : null);
  return el("section", { class: "panel trichter-bild", "aria-label": "Funnel" },
    el("div", { class: "kopf-zeile" }, el("h2", { text: "Where every product stands" }), el("span", { class: "leise klein", text: "Click any part to list those products below." })),
    el("div", { class: "fb", role: "group", "aria-label": "All products by status" }, ...seg),
    el("div", { class: "fb-legende" }, ...legende),
    el("div", { class: "tb-teil" }, el("h3", { text: `Why ${zahl(f.zahl.nicht_geeignet)} of ${zahl(N)} products are not eligible` }), el("div", { class: "gruende" }, ...gruende)),
    el("div", { class: "tb-teil" }, el("h3", { text: "The ladder" }),
      el("div", { class: "pipeline" },
        knoten("geeignet", "Eligible", "low impressions, free"),
        pfeil("drawn by lot"),
        el("div", { class: "pl-gabel" },
          el("div", { class: "pl-reihe" },
            knoten("titel", "Phase 1", `New title · ${l.tage.titel} d`), pfeil(),
            knoten("werbung", "Phase 2", `Ads ${Math.round(l.werbesatz * 100)} % · ${l.tage.werbung} d`), pfeil(),
            knoten("preis", "Phase 3", `Price −${Math.round(l.preisSchritt * 100)} % · ${l.tage.preis} d`), pfeil(),
            knoten("pruefung", "Phase 4", "Manual check"), pfeil(),
            knoten("erholt", "Seen again", "left the ladder")),
          el("div", { class: "pl-reihe pl-kontrolle" }, knoten("kontrolle", "Control group", `unchanged · ${l.tage.kontrolle} d`),
            el("span", { class: "leise klein pl-erklaerung", text: "Half of every draw stays unchanged, so each phase is measured against listings that got nothing." }))))));
}

// Wirkung je Phase gegen die Kontrollgruppe (leiter.wirkung): erst wenn eine Prüfzeit vorbei ist, gibt es Zahlen
function wirkungTabelle(l) {
  const w = l.wirkung, phasen = [["titel", "Phase 1 · New title"], ["werbung", "Phase 2 · Ads"], ["preis", "Phase 3 · Lower price"]];
  const ende = l.angebote.filter((a) => a.stand?.ende).map((a) => a.stand.ende).sort()[0];
  const nettoZelle = (x) => x.netto == null ? el("td", { class: "zahl leise", text: x.ausgewertet ? "no control" : "–" })
    : el("td", { class: "zahl" }, el("span", { class: "status " + (x.netto >= 0.2 ? "gut" : x.netto <= -0.2 ? "schlecht" : "grau"), text: aenderung(x.netto) }));
  const tabelle = el("table", { class: "mini" },
    el("thead", {}, el("tr", {}, ["Phase", "Checked", "Seen again", "Listings, impressions per 90 days", "Control group, same days", "Net effect"].map((t, i) => el("th", { class: i ? "zahl" : null, text: t })))),
    el("tbody", {}, phasen.map(([s, name]) => { const x = w[s]; return el("tr", {},
      el("td", { text: name }), el("td", { class: "zahl", text: zahl(x.ausgewertet) }), el("td", { class: "zahl", text: zahl(x.erholt) }),
      el("td", { class: "zahl", text: x.mitKontrolle ? `${zahl(x.vorher90)} → ${zahl(x.nachher90)}` : "–" }),
      el("td", { class: "zahl", text: x.mitKontrolle ? `${zahl(x.kontrolleVorher90)} → ${zahl(x.kontrolleNachher90)}` : "–" }), nettoZelle(x)); })));
  const leer = !phasen.some(([s]) => w[s].ausgewertet);
  return el("section", { class: "panel" },
    el("h2", { text: "Effect of each phase, measured against the control group" }),
    el("p", { class: "leise klein", text: "Net effect = (listings after ÷ before) ÷ (control group after ÷ before) − 1. If the whole shop gets busier, the control group rises too and the net effect stays near zero. From +20 % a phase counts as clearly better." }),
    leer ? el("p", { class: "leere-hinweis leise", text: ende ? `No phase has finished its waiting time yet. The first result is due on ${datum(ende + "T12:00:00Z")} (when the traffic data for that day is complete).` : "No phase is running yet. The first result comes one waiting time after the first approval." }) : rollbar(tabelle));
}

// Alle Produkte mit Status und Grund; Filter über die Chips oder einen Klick im Funnel, Suche nach Nummer oder Wort
function statusTabelle(f) {
  return el("section", { id: "funnel-tabelle", class: "funnel-tabelle" },
    el("div", { class: "abschnitt-kopf" }, el("h2", { text: "All products and why they are where they are" })),
    el("div", { id: "funnel-inhalt" }, statusInhalt(f)));
}
function zeichneStatusTabelle(f) { const ziel = $("#funnel-inhalt"); if (ziel) fuelle(ziel, statusInhalt(f)); }
function statusInhalt(f) {
  const filter = zustand.funnelFilter || "alle";
  const chip = (s, name, n) => el("button", { class: "tab", type: "button", role: "tab", "aria-selected": String(filter === s), onclick: () => { zustand.funnelFilter = s; zustand.funnelSichtbar = 50; zeichneStatusTabelle(f); } },
    s !== "alle" ? el("span", { class: "punkt status-punkt " + (STATUS_KLASSE[s] || "") }) : null, name, el("span", { class: "tab-zahl", text: zahl(n) }));
  const suche = el("input", { type: "search", value: zustand.funnelSuche || "", placeholder: "Search by name or number", "aria-label": "Search products in the funnel", maxlength: 100,
    oninput: () => { zustand.funnelSuche = suche.value; zustand.funnelSichtbar = 50; zeichneTreffer(); } });
  const tabelle = el("div", { class: "tabelle" }), treffer = el("p", { class: "leise ergebnis-zeile" }), mehr = el("div", { class: "mehr" });
  const zeile = (x) => { const b = bildUrl(x.image_url); return el("div", { class: "fzeile" },
    b ? el("img", { class: "bild", src: b, alt: "", loading: "lazy", referrerpolicy: "no-referrer" }) : el("span", { class: "bild" }),
    el("div", { class: "name" }, el("div", { class: "titel", text: x.title || "(untitled)" }), el("div", { class: "nummer", text: `No. ${x.number} · ${zahl(x.impressionen_90d)} impressions · ${zahl(x.units_90d ?? 0)} eBay sales in 90 days` })),
    el("div", {}, statusChip(x.status)), el("div", { class: "grund leise", text: x.grund })); };
  // Nur Trefferliste neu zeichnen, damit das Suchfeld beim Tippen den Fokus behält
  function zeichneTreffer() {
    const q = (zustand.funnelSuche || "").trim().toLowerCase();
    const liste = f.liste.filter((x) => (filter === "alle" || x.status === filter) && (!q || `${x.number} ${x.title || ""}`.toLowerCase().includes(q)));
    const teil = liste.slice(0, zustand.funnelSichtbar || 50);
    treffer.textContent = `${zahl(liste.length)} ${liste.length === 1 ? "product" : "products"}`;
    fuelle(tabelle, liste.length ? teil.map(zeile) : el("div", { class: "leer", text: "No product matches. Change the filter or the search." }));
    fuelle(mehr, liste.length > teil.length ? el("button", { class: "knopf", type: "button", text: `Show more (${zahl(liste.length - teil.length)} more)`, onclick: () => { zustand.funnelSichtbar = (zustand.funnelSichtbar || 50) + 100; zeichneTreffer(); } }) : null);
  }
  zeichneTreffer();
  return [el("div", { class: "tabs", role: "tablist", "aria-label": "Filter by status" }, chip("alle", "All", f.liste.length), ...STATUS_REIHE.map((s) => chip(s, STATUS_TEXT[s], f.zahl[s] || 0))),
    el("div", { class: "werkzeuge" }, el("label", { class: "suche" }, suche)), treffer, tabelle, mehr];
}

// Admin: ein bestimmtes Angebot aus allen Kandidaten wählen und sofort auf die Leiter setzen (der KI-Titel kommt gleich mit)
function auswahlAufnehmen(liste) {
  const option = (p) => el("option", { value: p.number, text: `${p.number} · ${p.title || "(untitled)"} · ${zahl(p.impressionen_90d)} impressions / 90 days · ${zahl(p.units_90d)} eBay sales` });
  const wahl = el("select", { "aria-label": "Listing for the ladder" }, el("option", { value: "", text: liste.length ? `Choose one of ${zahl(liste.length)} listings …` : "No listing qualifies right now" }), ...liste.map(option));
  const suche = el("input", { type: "search", placeholder: "Filter by number or word", "aria-label": "Filter the list",
    oninput: () => { const q = suche.value.trim().toLowerCase(); wahl.replaceChildren(wahl.firstChild, ...liste.filter((p) => !q || `${p.number} ${p.title || ""}`.toLowerCase().includes(q)).map(option)); } });
  const knopf = el("button", { class: "knopf knopf-akzent", type: "button", text: "Put on the ladder",
    onclick: () => { if (!wahl.value) return meldung("Please choose a listing first."); knopf.disabled = true; knopf.textContent = "Asking the AI …";
      leiterAktion("/api/leiter/aufnehmen", { number: wahl.value }, (r) => r.vorschlag ? `Listing ${r.number} is on the ladder, the title suggestion is ready below.` : `Listing ${r.number} is on the ladder, but there is no title suggestion yet: ${r.hinweis}`); } });
  return el("div", { class: "panel auswahl" },
    el("h2", { text: "Add a listing" }),
    el("p", { class: "leise klein", text: "Every listing that qualifies for the ladder: low impressions, active on eBay, not blocked, not in a test. Sorted by eBay sales, best first. The listing starts at step 1; nothing changes on eBay until you approve the title." }),
    el("div", { class: "auswahl-zeile" }, suche, wahl, knopf));
}

const naechsteStufe = (s) => ({ titel: "werbung", werbung: "preis", preis: "pruefung" })[s];

// Zwischenstand der laufenden Prüfzeit als kleine Balken: Angebot vorher/jetzt und Kontrollgruppe vorher/jetzt, dazu der Nettoeffekt
function zwischenstand(s) {
  if (s.jetzt90 == null) return el("p", { class: "leise klein", text: "No traffic data since the start yet, so nothing to compare." });
  const k = s.kontrolle, max = Math.max(1, s.vorher90, s.jetzt90, k?.vorher90 || 0, k?.nachher90 || 0);
  const balken = (name, v, klasse) => el("div", { class: "zs-zeile" }, el("span", { class: "zs-name", text: name }),
    el("span", { class: "zs-balken" }, el("i", { class: klasse, style: `width:${(100 * v) / max}%` })), el("span", { class: "zs-wert", text: zahl(v) }));
  return el("div", { class: "zwischenstand" },
    el("div", { class: "zs-gruppe" }, el("div", { class: "zs-titel", text: "This listing, impressions per 90 days" }), balken("before", s.vorher90, "vorher"), balken("so far", s.jetzt90, "phase")),
    k ? el("div", { class: "zs-gruppe" }, el("div", { class: "zs-titel", text: `Control group (${k.anzahl}), same days` }), balken("before", k.vorher90, "vorher"), balken("so far", k.nachher90, "kontrolle"))
      : el("div", { class: "zs-gruppe leise klein", text: "No control group covers these days." }),
    s.netto != null ? el("div", { class: "zs-netto" }, el("span", { class: "leise klein", text: "Net effect so far" }), el("span", { class: "status " + (s.netto >= 0.2 ? "gut" : s.netto <= -0.2 ? "schlecht" : "grau"), text: aenderung(s.netto) })) : null);
}

// Titel von Hand eintragen oder die KI noch einmal fragen (Builder und Admin). Der Server prüft jeden Titel mit dem Regelprüfer.
function titelEingabe(a, v) {
  const feld = el("input", { class: "feld", type: "text", maxlength: String(zustand.betrieb?.regeln?.titelMaxZeichen || 80), value: v?.titel || "", "aria-label": "Your own title for product " + a.number, placeholder: "Your own title" });
  const zaehler = el("span", { class: "leise klein", text: `${feld.value.length} / ${feld.maxLength}` });
  feld.addEventListener("input", () => { zaehler.textContent = `${feld.value.length} / ${feld.maxLength}`; });
  return el("div", { class: "eigener-titel" }, el("div", { class: "leise klein", text: "Your own title (checked by the same rules) or a new AI suggestion:" }),
    el("div", { class: "eingabezeile", style: "margin-top:6px" }, feld, zaehler),
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
    const extra = e.ereignis === "ausgewertet" ? ` ${zahl(d.vorher90)} → ${zahl(d.nachher90)} impressions per 90 days (limit ${zahl(d.grenze90)}): ${d.erholt ? "seen again" : "still too few"}${d.kontrolle ? `; control group ${zahl(d.kontrolle.vorher90)} → ${zahl(d.kontrolle.nachher90)}, net effect ${aenderung(d.netto)}` : ""}`
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
  fuelle(root, 
    el("div", { class: "einstieg" }, el("h1", { text: "Account" }), el("p", { class: "leise", text: `Signed in as ${zustand.ich.name} (${zustand.ich.rolle === "admin" ? "admin" : "builder"}). Please never share your password, not even with the team.` })),
    form);
}

// ======================================================= Team (Rollen)
async function ladeTeam() {
  const root = $("#ansicht-team");
  try {
    const t = await api("/api/rollen");
    fuelle(root, 
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
  ladder_run: "Ladder run", ladder_added: "Put on the ladder", ladder_freigegeben: "Ladder step changed on eBay", ladder_probelauf: "Ladder step: dry run", ladder_fehlgeschlagen: "Ladder step failed", ladder_started_manually: "Ladder step started by hand",
  ladder_skipped: "Ladder step skipped", ladder_decided: "Manual check decided", ladder_removed: "Taken off the ladder",
};
// Die Protokoll-Details haben deutsche Schlüssel (so stehen sie in der Datenbank); angezeigt werden sie englisch
const DETAIL_TEXT = {
  ausgewertet: "checked", erholt: "seen again", aufgenommen: "on the ladder", titelVorschlaege: "title suggestions", ohneVorschlag: "without suggestion", ki: "AI",
  stufe: "step", vorschlag: "suggestion", titel: "title", quelle: "source", modell: "model", satz: "ad rate", text: "result", vonHand: "by hand", entscheidung: "decision", notiz: "note",
  test: "test", number: "product", alt: "old title", neu: "new title", art: "kind", aenderung: "change", anzahl: "count", schreibenAn: "writing to eBay", verkauft: "sold so far",
  ack: "eBay answer", grund: "reason", fehler: "error", hinweis: "note", von: "from", zu: "to", dateien: "files", aktuell_bei_ebay: "now on eBay", listingStatus: "listing status",
  seed: "draw number", kontrolle: "control", gesperrt: "excluded (price experiment)", ohneZugangsdaten: "no eBay credentials", abschluss: "outcome", gekuerzt: "shortened",
  produkte: "products", kanaele: "channels", trafficBis: "traffic up to", tageGeholt: "days fetched", tageVorhanden: "days available", vollstaendig: "complete", limitErreicht: "limit reached",
  nachgeprueft: "days rechecked", abweichungen: "corrections", abdeckungMittel: "coverage (mean)", abdeckungMin: "coverage (min)", sekunden: "seconds",
};
const WERT_TEXT = { titel: "new title", zurueck: "revert", behalten: "keep", true: "yes", false: "no" };
const ERGEBNIS_TEXT = { ok: "ok", error: "error", dry_run: "dry run", refused: "refused" };
// Verschachtelte Werte (z. B. der Vorschlag einer Leiterstufe) lesbar statt als JSON: das Wichtigste zuerst, Prüfdetails weg
const WICHTIG = ["titel", "alt", "satz", "neu", "quelle", "modell"];
const wertText = (v) => {
  if (v === null || typeof v !== "object") return WERT_TEXT[String(v)] ?? v;
  if (Array.isArray(v)) return v.length + " " + (v.length === 1 ? "entry" : "entries");
  const teile = WICHTIG.filter((k) => v[k] != null && v[k] !== "").map((k) => `${DETAIL_TEXT[k] || k} “${v[k]}”`);
  return teile.length ? teile.join(", ") : Object.entries(v).filter(([, x]) => x === null || typeof x !== "object").map(([k, x]) => `${DETAIL_TEXT[k] || k} ${x}`).join(", ");
};
const detailText = (details) => Object.entries(details).map(([k, v]) => `${DETAIL_TEXT[k] || k}: ${wertText(v)}`).join(" · ");
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
    fuelle(root, 
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
  // Regeln ändern nur Admins (Werbesatz und Preisschritt kosten Geld); der Server prüft das ebenfalls
  const form = el("form", { novalidate: true }, abschnitte, fehler, istAdmin() ? el("div", { class: "aktionen" }, speichern, zuruecksetzen) : el("p", { class: "leise klein", text: "Only an admin can change the rules." }));
  if (!istAdmin()) for (const z of zeilen) z.eingabe.disabled = true;
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
