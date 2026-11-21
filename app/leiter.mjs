// The ladder: listings with low impressions go step by step through three levers until they are seen again.
//
//   Diagnosis "Low impressions"  ->  1 Title (AI suggestion, rule checker, approval)
//                                    enough impressions again after the waiting time?  yes -> out (recovered)
//                               ->  2 Ads (eBay Promoted Listings, default rate 10 %)     yes -> out
//                               ->  3 Price (one step down, default 10 %)                 yes -> out
//                               ->  4 Manual check: the admin decides rework / take offline / keep
//
// "Enough impressions again" means: the impressions per day during the waiting time, scaled up to 90 days, are no longer
// below the diagnosis limit (lowest quarter of the shop). The limit moves with the shop; if the whole shop gets quieter
// (season) it falls, and a listing is not wrongly counted as failed.
// Every step changes eBay only after approval by an admin. What the steps do on eBay is in fuehreAus (below).
// Every function returns { ok, wert } or { ok: false, status, fehler }, like the other modules.
//
// Control group (always runs along, no page of its own): the daily run draws twice as many candidates as there are free places,
// and splits them half and half onto the ladder and into the control group. Control listings stay unchanged on eBay for as long as
// the three waiting times take together. At every evaluation of a step the app measures the same days on the control group: if
// the whole shop rises (season), the control rises with it, and the net effect shows what the step itself brought.
import crypto from "node:crypto";
import { bewerte, leiteSchwellenAb, EINSTELLUNGEN } from "./regeln.mjs";
import { ziehe } from "./experimente.mjs";
import { netto } from "./auswertung.mjs";
import { pruefeTitel } from "./titel-regeln.mjs";
import * as protokoll from "./protokoll.mjs";

export const STUFEN = ["titel", "werbung", "preis", "pruefung"];
export const KONTROLLE = "kontrolle";
// The control group stays unchanged for all three waiting times plus a buffer: the next phase starts only when an admin decides,
// usually a day or more after a waiting time ends, and the last phase must still be measured against the control group.
export const KONTROLLE_PUFFER = 7;
export const kontrollTage = (einst = EINSTELLUNGEN) => einst.leiterTageTitel + einst.leiterTageWerbung + einst.leiterTagePreis + KONTROLLE_PUFFER;
export const ENTSCHEIDUNGEN = ["ueberarbeiten", "offline", "behalten"];
// After so many days a listing that has left the ladder may come back in (if it has low impressions again)
export const WIEDER_NACH_TAGEN = 90;
const BASIS_TAGE = 30; // Comparison value: impressions per day in the 30 days before the start of a step

const fehler = (status, text) => ({ ok: false, status, fehler: text });
const ok = (wert) => ({ ok: true, wert });
const tag = (d) => d.toISOString().slice(0, 10);
const plusTage = (t, n) => tag(new Date(Date.parse(t + "T12:00:00Z") + n * 864e5));
const wer = (n) => ({ benutzer: n.name, rolle: n.rolle });
export const naechste = (stufe) => STUFEN[STUFEN.indexOf(stufe) + 1] || null;
export const pruefTage = (stufe, einst = EINSTELLUNGEN) => ({ titel: einst.leiterTageTitel, werbung: einst.leiterTageWerbung, preis: einst.leiterTagePreis })[stufe] ?? null;

export function bereiteVor(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS leiter (
      number TEXT PRIMARY KEY,
      stufe TEXT NOT NULL,                  -- titel | werbung | preis | pruefung | kontrolle | raus
      phase TEXT NOT NULL,                  -- vorschlag (waiting for approval) | laeuft (waiting time) | offen (manual check) | kontrolle | fertig
      ergebnis TEXT,                        -- on raus: erholt | ueberarbeiten | offline | behalten | abgebrochen | kontrolle (control time over)
      eingestiegen_at TEXT NOT NULL,
      stufe_start TEXT,                     -- day (YYYY-MM-DD) on which the measure of the running step went live on eBay
      basis_imp_tag REAL,                   -- impressions per day in the 30 days before this day
      vorschlag TEXT,                       -- JSON: what the step should change on eBay
      aktualisiert_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS leiter_verlauf (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      number TEXT NOT NULL, stufe TEXT NOT NULL,
      ereignis TEXT NOT NULL,               -- aufgenommen | vorschlag | freigegeben | probelauf | fehlgeschlagen | gestartet | ausgewertet | uebersprungen | entschieden | abgebrochen
      details TEXT, benutzer TEXT NOT NULL, at TEXT NOT NULL
    );
  `);
}

const lade = (db, number) => db.prepare("SELECT * FROM leiter WHERE number = ?").get(number);
const json = (s) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };
function verlauf(db, number, stufe, ereignis, details, benutzer, jetzt) {
  db.prepare("INSERT INTO leiter_verlauf (number, stufe, ereignis, details, benutzer, at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(number, stufe, ereignis, details == null ? null : JSON.stringify(details), benutzer, jetzt.toISOString());
}
function setze(db, number, felder, jetzt) {
  const k = Object.keys(felder);
  db.prepare(`UPDATE leiter SET ${k.map((x) => x + " = ?").join(", ")}, aktualisiert_at = ? WHERE number = ?`)
    .run(...k.map((x) => (x === "vorschlag" && felder[x] != null ? JSON.stringify(felder[x]) : felder[x])), jetzt.toISOString(), number);
}

// Numbers that are on the ladder right now: they must not go into any title test (and vice versa), otherwise two things are measured at once.
export const aktiveNummern = (db) => new Set(db.prepare("SELECT number FROM leiter WHERE stufe != 'raus'").all().map((r) => r.number));

// Who newly comes onto the ladder? Diagnosis "Low impressions", a running eBay listing, not blocked, in no test, not already on it
// (or left less than 90 days ago). Proven listings first (more sales in total), then by number.
export function kandidaten(db, produkte, einst = EINSTELLUNGEN, jetzt = new Date(), { imTest = new Map(), gesperrt = new Set() } = {}) {
  const abgeleitet = leiteSchwellenAb(produkte, einst, jetzt);
  const grenze = tag(new Date(jetzt.getTime() - WIEDER_NACH_TAGEN * 864e5));
  const belegt = new Set(db.prepare("SELECT number FROM leiter WHERE stufe != 'raus' OR substr(aktualisiert_at, 1, 10) > ?").all(grenze).map((r) => r.number));
  return produkte
    .filter((p) => p.ebay_aktiv !== 0 && !belegt.has(p.number) && !imTest.has(p.number) && !gesperrt.has(p.number) && bewerte(p, abgeleitet, jetzt).gruppe === "sichtbarkeit" && !schonVerkauft(p, einst))
    .sort((a, b) => (Number(b.units_total) || 0) - (Number(a.units_total) || 0) || (Number(b.impressionen_90d) || 0) - (Number(a.impressionen_90d) || 0) || (a.number < b.number ? -1 : a.number > b.number ? 1 : 0));
}
// Niko, 20 Nov: listings that have already sold on eBay are not touched; there are enough that never sold.
// Setting leiterNurOhneVerkauf ("ja" default / "nein"). units_total has been eBay only since #44/#45.
export const schonVerkauft = (p, einst = EINSTELLUNGEN) => einst.leiterNurOhneVerkauf !== "nein" && (Number(p.units_total) || 0) > 0;

// Takes in new listings until at most einst.leiterMax are on the ladder at the same time. Returns the new numbers.
// With a control group (einst.leiterKontrolle): the next 2 × free candidates are split by lot (ziehe from experimente.mjs,
// same seed = same draw, the seed is in the history). Returns the numbers that came onto the ladder.
// By hand (button "Draw listings by lot", Niko, 20 Nov): optionen.anzahl = so many onto the ladder, without an upper limit;
// optionen.kontrolle = true/false decides per draw whether the same number is also drawn into the control group.
export function nimmAuf(db, produkte, einst = EINSTELLUNGEN, jetzt = new Date(), optionen = {}) {
  const frei = optionen.anzahl != null ? Math.max(0, Math.floor(optionen.anzahl)) : Math.max(0, einst.leiterMax - aufLeiter(db));
  const mitKontrolle = optionen.kontrolle ?? einst.leiterKontrolle;
  const k = kandidaten(db, produkte, einst, jetzt, optionen);
  if (!mitKontrolle) {
    const neu = k.slice(0, frei).map((p) => p.number);
    db.transaction(() => { for (const n of neu) trageEin(db, n, null, "system", jetzt); })();
    return neu;
  }
  if (!frei) return [];
  const seed = optionen.seed ?? crypto.randomInt(1, 2147483646);
  const { test, kontrolle } = ziehe(k.slice(0, 2 * frei), 2 * frei, seed);
  db.transaction(() => {
    for (const p of test) trageEin(db, p.number, { seed }, "system", jetzt);
    for (const p of kontrolle) trageEin(db, p.number, { seed }, "system", jetzt, KONTROLLE);
  })();
  return test.map((p) => p.number);
}

const aufLeiter = (db) => db.prepare("SELECT COUNT(*) n FROM leiter WHERE stufe NOT IN ('raus', 'kontrolle')").get().n;

function trageEin(db, number, details, benutzer, jetzt, stufe = "titel") {
  const phase = stufe === KONTROLLE ? KONTROLLE : "vorschlag", start = stufe === KONTROLLE ? tag(jetzt) : null;
  db.prepare("INSERT INTO leiter (number, stufe, phase, eingestiegen_at, stufe_start, aktualisiert_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(number) DO UPDATE SET stufe = excluded.stufe, phase = excluded.phase, ergebnis = NULL, eingestiegen_at = excluded.eingestiegen_at, stufe_start = excluded.stufe_start, basis_imp_tag = NULL, vorschlag = NULL, aktualisiert_at = excluded.aktualisiert_at")
    .run(number, stufe, phase, jetzt.toISOString(), start, jetzt.toISOString());
  verlauf(db, number, stufe, stufe === KONTROLLE ? "kontrolle" : "aufgenommen", details, benutzer, jetzt);
}

// Control listings whose control time fully covers the days von..bis: the comparison group for a step with this time window
function kontrollGruppe(db, von, bis, einst) {
  return db.prepare("SELECT number, stufe_start FROM leiter WHERE (stufe = 'kontrolle' OR ergebnis = 'kontrolle') AND stufe_start IS NOT NULL").all()
    .filter((z) => z.stufe_start <= von && plusTage(z.stufe_start, kontrollTage(einst)) >= bis).map((z) => z.number);
}
// Impressions per day of the control group before (30 days) and during a time window, as the sum of the group
function kontrollVergleich(db, impTag, von, bis, einst) {
  const nr = kontrollGruppe(db, von, bis, einst);
  if (!nr.length) return null;
  const vorher = nr.reduce((s, n) => s + impTag(n, plusTage(von, -BASIS_TAGE - 1), plusTage(von, -1)), 0);
  const nachher = nr.reduce((s, n) => s + impTag(n, von, bis), 0);
  return { anzahl: nr.length, vorher90: Math.round(vorher * 90), nachher90: Math.round(nachher * 90) };
}

// An admin picks a specific listing from the candidates (selection list on the page Ladder) and puts it onto the ladder at once,
// even beyond the maximum: for a targeted test or the demo. The same conditions apply as for the run.
export function nimmVonHandAuf(db, nutzer, number, produkte, einst = EINSTELLUNGEN, jetzt = new Date(), optionen = {}) {
  if (nutzer?.rolle !== "admin") return fehler(403, "Only an admin can put a listing on the ladder.");
  const nr = String(number ?? "");
  if (!kandidaten(db, produkte, einst, jetzt, optionen).some((p) => p.number === nr))
    return fehler(409, "This listing cannot go on the ladder right now (not low impressions, no active eBay listing, blocked, in a test, or on the ladder in the last 90 days).");
  db.transaction(() => trageEin(db, nr, { vonHand: true }, nutzer.name, jetzt))();
  protokoll.schreibe(db, { ...wer(nutzer), aktion: "ladder_added", objekt: "product " + nr, details: { vonHand: true } }, jetzt);
  return ok({ number: nr });
}

// Listings in step 1 without a suggestion (the AI is asked for one afterwards, see server.mjs)
export const ohneTitelVorschlag = (db) => db.prepare("SELECT number FROM leiter WHERE stufe = 'titel' AND phase = 'vorschlag' AND vorschlag IS NULL").all().map((r) => r.number);

// Suggestion for ads and price: follows from the settings and the listing. kanaele: active eBay listings of the number.
// The app lowers the price only if all variants have the same price (otherwise one step would destroy the price scale).
export function baueVorschlag(stufe, einst, { kanaele = [], varianten = [] } = {}) {
  if (stufe === "werbung") return { satz: einst.werbesatz };
  if (stufe === "preis") {
    const preise = [...new Set([...kanaele.map((k) => Number(k.preis_aktuell)), ...varianten.map((v) => Number(v.price))].filter((x) => x > 0))];
    if (!kanaele.length || !preise.length) return { nichtMoeglich: "The current eBay price is not known." };
    if (preise.length > 1) return { nichtMoeglich: `The variants have different prices (${preise.map((p) => p.toFixed(2)).join(" / ")} €). One step down would break the price ladder, please decide by hand.` };
    const alt = preise[0];
    return { alt, neu: Math.floor(alt * (1 - einst.preisSchritt) * 100) / 100, schritt: einst.preisSchritt };
  }
  return null;
}

function inPhase(db, number, stufen, phase) {
  const z = lade(db, String(number ?? ""));
  if (!z) return { f: fehler(404, "This listing is not on the ladder.") };
  if (!stufen.includes(z.stufe) || z.phase !== phase) return { f: fehler(409, "This step is not possible right now (the listing has moved on).") };
  return { z };
}

// Sets the title suggestion (from the AI, the title help or by hand). The rule checker must have passed before (see server.mjs).
export function setzeTitelVorschlag(db, nutzer, number, vorschlag, jetzt = new Date()) {
  const { z, f } = inPhase(db, number, ["titel"], "vorschlag"); if (f) return f;
  if (!vorschlag?.pruefung?.ok) return fehler(400, "This title did not pass the rule check: " + (vorschlag?.pruefung?.verstoesse || []).map((v) => v.text).join(" "));
  setze(db, z.number, { vorschlag }, jetzt);
  verlauf(db, z.number, "titel", "vorschlag", { titel: vorschlag.titel, alt: vorschlag.alt, quelle: vorschlag.quelle, verworfen: vorschlag.verworfen?.length || 0 }, nutzer.name, jetzt);
  return ok({ number: z.number });
}

// No suggestion possible (AI not reachable, all suggestions failed at the rule checker): it is noted in the history, the suggestion stays empty
// and is tried again at the next run. The same message twice in a row is recorded only once.
export function merkeFehlschlag(db, number, text, verworfen = [], jetzt = new Date()) {
  const letzte = db.prepare("SELECT ereignis, details FROM leiter_verlauf WHERE number = ? ORDER BY id DESC LIMIT 1").get(String(number));
  if (letzte?.ereignis === "kein_vorschlag" && json(letzte.details)?.text === text) return;
  verlauf(db, String(number), "titel", "kein_vorschlag", { text, verworfen: (verworfen || []).slice(0, 5) }, "system", jetzt);
}

// What the step does on eBay. items: active eBay listings of the number [{ external_id, title, skus }]. schreiber: ebay-schreiben.mjs.
// Return: { ausgang: "angewendet" | "probelauf" | "fehlgeschlagen", text }. Before every change it reads; if anything differs, nothing happens.
export async function fuehreAus(stufe, v, items, schreiber) {
  if (!items.length) return { ausgang: "fehlgeschlagen", text: "No active eBay listing found for this product." };
  const schalter = stufe === "titel" ? schreiber.schreibenAn() : stufe === "werbung" ? schreiber.schreibenAn() && schreiber.werbungAn() : schreiber.schreibenAn() && schreiber.preisAn();
  const name = { titel: "EBAY_SCHREIBEN=an", werbung: "EBAY_SCHREIBEN=an and EBAY_WERBUNG=an", preis: "EBAY_SCHREIBEN=an and EBAY_PREIS=an" }[stufe];
  if (!schreiber.konfiguriert()) return { ausgang: "probelauf", text: `Dry run: this computer has no eBay credentials. With credentials and ${name} the change would be made. Nothing was changed on eBay.` };
  const texte = [];
  for (const it of items) {
    const g = await schreiber.lies(String(it.external_id));
    if (!g.ok) return { ausgang: "fehlgeschlagen", text: "Could not read the listing on eBay: " + g.meldung };
    if (g.status && g.status !== "Active") return { ausgang: "fehlgeschlagen", text: `The listing is not active (${g.status}).` };
    if (stufe === "titel" && norm(g.titel) !== norm(v.alt) && norm(g.titel) !== norm(v.titel)) return { ausgang: "fehlgeschlagen", text: `The title on eBay is not the expected one, nothing was overwritten. On eBay now: “${g.titel}”` };
    if (stufe === "preis") {
      const jetzt = g.variationen?.length ? [...new Set(g.variationen.map((x) => x.preis))] : [g.preis];
      if (jetzt.length !== 1 || Math.abs(jetzt[0] - v.alt) > 0.005) return { ausgang: "fehlgeschlagen", text: `The price on eBay (${jetzt.map((p) => Number(p).toFixed(2)).join(" / ")} €) is not the expected ${v.alt.toFixed(2)} €, nothing was changed.` };
    }
    if (!schalter) { texte.push(`Dry run: listing ${it.external_id} was read and would be changed. Writing is switched off (${name}).`); continue; }
    const r = stufe === "titel" ? (norm(g.titel) === norm(v.titel) ? { ok: true, meldung: "already current" } : await schreiber.setzeTitel(String(it.external_id), v.titel))
      : stufe === "werbung" ? await schreiber.setzeWerbung(String(it.external_id), v.satz)
      : await schreiber.setzePreis(String(it.external_id), g.variationen?.map((x) => x.sku) || [], v.neu);
    if (!r.ok) return { ausgang: "fehlgeschlagen", text: "eBay refused the change: " + r.meldung };
    // Read back: does eBay now really show the new title / price? (Proof for the demo and the history)
    let nachher = "";
    if (stufe !== "werbung" && typeof schreiber.lies === "function") {
      const n = await schreiber.lies(String(it.external_id));
      if (n?.ok) nachher = stufe === "titel" ? ` Now on eBay: “${n.titel}”.` : ` Now on eBay: ${(n.variationen?.length ? n.variationen.map((x) => x.preis) : [n.preis]).map((p) => Number(p).toFixed(2)).join(" / ")} €.`;
    }
    texte.push(`Listing ${it.external_id} changed on eBay.` + (r.meldung ? " eBay note: " + r.meldung : "") + nachher);
  }
  return { ausgang: schalter ? "angewendet" : "probelauf", text: texte.join(" ") };
}
const norm = (s) => String(s ?? "").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

// An admin approves the running step: the app changes eBay, after that the waiting time runs. impTag(number, von, bis): impressions per day.
export async function gibFrei(db, nutzer, number, { items, schreiber, impTag }, jetzt = new Date()) {
  if (nutzer?.rolle !== "admin") return fehler(403, "Only an admin can approve a ladder step.");
  const { z, f } = inPhase(db, number, ["titel", "werbung", "preis"], "vorschlag"); if (f) return f;
  const v = json(z.vorschlag);
  if (!v || v.nichtMoeglich) return fehler(409, v?.nichtMoeglich || "There is no suggestion to approve yet.");
  // Check the title once more right before writing: rules get stricter (20 Nov: brand before "passend für"),
  // an earlier saved suggestion must then no longer slip through.
  if (z.stufe === "titel") {
    const p = pruefeTitel(v.titel, v.alt);
    if (!p.ok) return fehler(409, "This title breaks a rule that was tightened after it was suggested: " + p.verstoesse.map((x) => x.text).join(" ") + " Ask the AI again or enter a title by hand.");
  }
  let r;
  try { r = await fuehreAus(z.stufe, v, items, schreiber); } catch (e) { r = { ausgang: "fehlgeschlagen", text: "Error while talking to eBay: " + e.message }; }
  const ereignis = r.ausgang === "angewendet" ? "freigegeben" : r.ausgang;
  verlauf(db, z.number, z.stufe, ereignis, { text: r.text, vorschlag: v }, nutzer.name, jetzt);
  protokoll.schreibe(db, { ...wer(nutzer), aktion: "ladder_" + ereignis, objekt: "product " + z.number, details: { stufe: z.stufe, vorschlag: v, text: r.text }, ergebnis: r.ausgang === "angewendet" ? "ok" : r.ausgang === "probelauf" ? "dry_run" : "error" }, jetzt);
  if (r.ausgang === "angewendet") starte(db, z, impTag, nutzer, jetzt);
  return ok({ number: z.number, ausgang: r.ausgang, text: r.text });
}

// Admin: the measure was done by hand on eBay (or should count as started without an eBay change, e.g. in a dry run).
export function starteVonHand(db, nutzer, number, { impTag }, jetzt = new Date()) {
  if (nutzer?.rolle !== "admin") return fehler(403, "Only an admin can start a ladder step.");
  const { z, f } = inPhase(db, number, ["titel", "werbung", "preis"], "vorschlag"); if (f) return f;
  if (z.stufe === "titel" && !json(z.vorschlag)) return fehler(409, "There is no title yet. Enter one first.");
  protokoll.schreibe(db, { ...wer(nutzer), aktion: "ladder_started_manually", objekt: "product " + z.number, details: { stufe: z.stufe, hinweis: "Started without the app changing eBay" } }, jetzt);
  starte(db, z, impTag, nutzer, jetzt, true);
  return ok({ number: z.number });
}

function starte(db, z, impTag, nutzer, jetzt, vonHand = false) {
  const heute = tag(jetzt);
  const basis = impTag(z.number, plusTage(heute, -BASIS_TAGE - 1), plusTage(heute, -1));
  setze(db, z.number, { phase: "laeuft", stufe_start: heute, basis_imp_tag: basis }, jetzt);
  verlauf(db, z.number, z.stufe, "gestartet", { basis_imp_tag: basis, vonHand }, nutzer.name, jetzt);
}

// An admin skips the running step (e.g. no ads for this listing): on to the next one, without an eBay change.
export function ueberspringe(db, nutzer, number, grund, einst = EINSTELLUNGEN, kontext = {}, jetzt = new Date()) {
  if (nutzer?.rolle !== "admin") return fehler(403, "Only an admin can skip a ladder step.");
  const { z, f } = inPhase(db, number, ["titel", "werbung", "preis"], "vorschlag"); if (f) return f;
  const g = String(grund ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
  verlauf(db, z.number, z.stufe, "uebersprungen", { grund: g }, nutzer.name, jetzt);
  protokoll.schreibe(db, { ...wer(nutzer), aktion: "ladder_skipped", objekt: "product " + z.number, details: { stufe: z.stufe, grund: g } }, jetzt);
  weiter(db, z, einst, kontext, jetzt);
  return ok({ number: z.number, stufe: naechste(z.stufe) });
}

function weiter(db, z, einst, kontext, jetzt) {
  const n = naechste(z.stufe);
  if (n === "pruefung") setze(db, z.number, { stufe: n, phase: "offen", vorschlag: null, stufe_start: null }, jetzt);
  else setze(db, z.number, { stufe: n, phase: "vorschlag", vorschlag: baueVorschlag(n, einst, kontext.fuer ? kontext.fuer(z.number) : {}), stufe_start: null }, jetzt);
  verlauf(db, z.number, n, n === "pruefung" ? "pruefung" : "vorschlag", null, "system", jetzt);
}

// Daily step: every step whose waiting time lies completely inside the data is evaluated.
// trafficBis: last day with finished traffic data. grenze90: the diagnosis limit (impressions in 90 days).
// nurKontrolle: do not evaluate steps (movement by hand), only release control listings whose time is over.
export function werteAus(db, { impTag, trafficBis, grenze90, einst = EINSTELLUNGEN, fuer = null, nurKontrolle = false }, jetzt = new Date()) {
  const ergebnisse = [];
  if (!trafficBis) return ergebnisse;
  for (const z of nurKontrolle ? [] : db.prepare("SELECT * FROM leiter WHERE phase = 'laeuft' ORDER BY number").all()) {
    const tage = pruefTage(z.stufe, einst);
    const ende = plusTage(z.stufe_start, tage);
    if (trafficBis < ende) continue;
    const jeTag = impTag(z.number, z.stufe_start, ende);
    const hoch90 = Math.round(jeTag * 90);
    const erholt = hoch90 >= grenze90;
    const vorher90 = Math.round((z.basis_imp_tag ?? 0) * 90);
    // The same days on the control group: net effect = (listing after/before) / (control after/before) − 1
    const kontrolle = kontrollVergleich(db, impTag, z.stufe_start, ende, einst);
    const nettoEffekt = kontrolle ? netto({ vorher: vorher90, nachher: hoch90 }, { vorher: kontrolle.vorher90, nachher: kontrolle.nachher90 }) : null;
    // datenBis: the last data day this evaluation used, so it can be reproduced even if corrected numbers arrive later
    const details = { tage, vorher90, nachher90: hoch90, grenze90: Math.round(grenze90), erholt, kontrolle, netto: nettoEffekt, datenBis: ende };
    db.transaction(() => {
      verlauf(db, z.number, z.stufe, "ausgewertet", details, "system", jetzt);
      if (erholt) setze(db, z.number, { stufe: "raus", phase: "fertig", ergebnis: "erholt" }, jetzt);
      else weiter(db, z, einst, { fuer }, jetzt);
    })();
    ergebnisse.push({ number: z.number, stufe: z.stufe, ...details });
  }
  // Control time over (all three waiting times): the listing is free and may be taken in again after 90 days
  for (const z of db.prepare("SELECT * FROM leiter WHERE stufe = 'kontrolle' AND stufe_start IS NOT NULL").all()) {
    if (trafficBis < plusTage(z.stufe_start, kontrollTage(einst))) continue;
    db.transaction(() => {
      setze(db, z.number, { stufe: "raus", phase: "fertig", ergebnis: KONTROLLE }, jetzt);
      verlauf(db, z.number, KONTROLLE, "kontrolle_ende", { tage: kontrollTage(einst) }, "system", jetzt);
    })();
  }
  return ergebnisse;
}

// Effect per step against the control group: all evaluations of this step together (sum before/after of the listings and of the
// control group at the same time). Without a control group the evaluation counts only for "seen again", not in the net effect.
export function wirkung(db) {
  const aus = {};
  for (const s of ["titel", "werbung", "preis"]) aus[s] = { ausgewertet: 0, erholt: 0, mitKontrolle: 0, vorher90: 0, nachher90: 0, kontrolleVorher90: 0, kontrolleNachher90: 0, netto: null };
  for (const v of db.prepare("SELECT stufe, details FROM leiter_verlauf WHERE ereignis = 'ausgewertet'").all()) {
    const d = json(v.details), w = aus[v.stufe];
    if (!d || !w) continue;
    w.ausgewertet++; if (d.erholt) w.erholt++;
    if (!d.kontrolle) continue;
    w.mitKontrolle++; w.vorher90 += d.vorher90; w.nachher90 += d.nachher90; w.kontrolleVorher90 += d.kontrolle.vorher90; w.kontrolleNachher90 += d.kontrolle.nachher90;
  }
  for (const w of Object.values(aus)) if (w.mitKontrolle) w.netto = netto({ vorher: w.vorher90, nachher: w.nachher90 }, { vorher: w.kontrolleVorher90, nachher: w.kontrolleNachher90 });
  return aus;
}

// The funnel: where is every product and why. The check runs in the same order as the intake (kandidaten above),
// so that "eligible" here is exactly the listings that the next run would take.
//   status: nicht_geeignet | geeignet | kontrolle | titel | werbung | preis | pruefung | erholt | raus
//   art (only for nicht_geeignet): kein_ebay | gesperrt | im_test | pause | genug | neu | verkauft
export const STATUS = ["nicht_geeignet", "geeignet", KONTROLLE, ...STUFEN, "erholt", "raus"];
export function trichter(db, produkte, einst = EINSTELLUNGEN, jetzt = new Date(), { imTest = new Map(), gesperrt = new Set() } = {}) {
  const abgeleitet = leiteSchwellenAb(produkte, einst, jetzt);
  const zeilen = new Map(db.prepare("SELECT * FROM leiter").all().map((z) => [z.number, z]));
  const pauseBis = (z) => plusTage(z.aktualisiert_at.slice(0, 10), WIEDER_NACH_TAGEN);
  const heute = tag(jetzt);
  const liste = produkte.map((p) => {
    const z = zeilen.get(p.number), b = bewerte(p, abgeleitet, jetzt);
    const zeile = (status, grund, art = null) => ({ number: p.number, title: p.title ?? null, image_url: p.image_url ?? null, impressionen_90d: p.impressionen_90d ?? null, units_90d: p.units_90d ?? null, status, art, grund, phase: z?.phase ?? null });
    if (z?.stufe === KONTROLLE) return zeile(KONTROLLE, `Control group since ${z.stufe_start}: stays unchanged on eBay until ${plusTage(z.stufe_start, kontrollTage(einst))}, so each step can be measured against it.`);
    if (z && STUFEN.includes(z.stufe)) return zeile(z.stufe, PHASE_GRUND[z.phase] || "");
    if (z?.stufe === "raus" && pauseBis(z) > heute) {
      if (z.ergebnis === "erholt") return zeile("erholt", `Seen again after the ladder. Can come back after ${pauseBis(z)} if impressions drop again.`);
      return zeile("raus", `${ERGEBNIS_GRUND[z.ergebnis] || "Left the ladder"}. Can come back after ${pauseBis(z)}.`, "pause");
    }
    if (p.ebay_aktiv === 0) return zeile("nicht_geeignet", "No active eBay listing, so the title cannot be changed.", "kein_ebay");
    if (gesperrt.has(p.number)) return zeile("nicht_geeignet", "Part of a running price test in the shop. Changing the title now would mix two effects.", "gesperrt");
    if (imTest.has(p.number)) return zeile("nicht_geeignet", "In a running title test.", "im_test");
    if (b.gruppe === "warten") return zeile("nicht_geeignet", b.begruendung, "neu");
    if (b.gruppe !== "sichtbarkeit") return zeile("nicht_geeignet", b.begruendung, "genug");
    if (schonVerkauft(p, einst)) return zeile("nicht_geeignet", `Already sold on eBay (${Number(p.units_total)} in total), so it is left alone on purpose. Only listings that never sold enter the funnel.`, "verkauft");
    return zeile("geeignet", b.begruendung + " Waiting for a place on the ladder.");
  });
  const zahl = Object.fromEntries(STATUS.map((s) => [s, liste.filter((x) => x.status === s).length]));
  const gruende = Object.fromEntries(["kein_ebay", "gesperrt", "im_test", "neu", "genug", "verkauft"].map((a) => [a, liste.filter((x) => x.status === "nicht_geeignet" && x.art === a).length]));
  const summe = (f) => liste.filter(f).reduce((s, x) => s + (Number(x.impressionen_90d) || 0), 0);
  const kpi = {
    produkte: liste.length, impressionen90: summe(() => true),
    aufLeiter: STUFEN.reduce((s, x) => s + zahl[x], 0), impressionenLeiter90: summe((x) => STUFEN.includes(x.status)),
    impressionenKontrolle90: summe((x) => x.status === KONTROLLE), grenze90: Math.round(abgeleitet.wenigImpressionen90d),
  };
  return { zahl, gruende, kpi, liste };
}
const PHASE_GRUND = { vorschlag: "A suggestion is ready and waits for an admin's approval.", laeuft: "The change is live on eBay; the waiting time is running.", offen: "Title, ads and price did not help; an admin decides what happens." };
const ERGEBNIS_GRUND = { ueberarbeiten: "Decided after the manual check: rework the listing", offline: "Decided after the manual check: take it offline", behalten: "Decided after the manual check: keep it as it is", abgebrochen: "Taken off the ladder by an admin", kontrolle: "Was in the control group" };

// An admin decides after the manual check. The app changes nothing on eBay here: "offline" is a task for the admin.
// Movement by hand (Niko, 20 Nov: products move only by button): an admin pushes a listing out of the running waiting time
// into the next phase (ziel "weiter") or takes it off the ladder as seen again (ziel "erholt"). It is measured as in the
// automatic run, only over the days that are in the data so far; the measurement is in the history as "ausgewertet"
// (with vonHand), so that the effect per phase continues to be calculated against the control group.
// Before the waiting time is complete in the data the move ends it early (F2, no silent peeking): it needs vorzeitigBestaetigt,
// and the evaluation stores vorzeitig with the planned end, so Results and the history show it.
export function schiebeVonHand(db, nutzer, number, ziel, { impTag, trafficBis, grenze90, einst = EINSTELLUNGEN, fuer = null }, jetzt = new Date(), { vorzeitigBestaetigt = false } = {}) {
  if (nutzer?.rolle !== "admin") return fehler(403, "Only an admin can move a listing in the funnel.");
  if (!["weiter", "erholt"].includes(ziel)) return fehler(400, "Unknown move.");
  const { z, f } = inPhase(db, number, ["titel", "werbung", "preis"], "laeuft"); if (f) return f;
  const tage = pruefTage(z.stufe, einst), ende = plusTage(z.stufe_start, tage);
  const bis = trafficBis && trafficBis < ende ? trafficBis : ende;
  const gemessen = trafficBis ? Math.max(0, Math.round((Date.parse(bis) - Date.parse(z.stufe_start)) / 864e5)) : 0;
  const vorher90 = Math.round((z.basis_imp_tag ?? 0) * 90);
  const nachher90 = gemessen > 0 ? Math.round(impTag(z.number, z.stufe_start, bis) * 90) : null;
  const kontrolle = gemessen > 0 ? kontrollVergleich(db, impTag, z.stufe_start, bis, einst) : null;
  const vorzeitig = gemessen < tage;
  if (vorzeitig && !vorzeitigBestaetigt) return fehler(409, `The waiting time is not over: ${gemessen} of ${tage} data days. Moving on now ends it early; this is recorded and shown in Results. Confirm to continue.`);
  const nettoEffekt = kontrolle && nachher90 != null ? netto({ vorher: vorher90, nachher: nachher90 }, { vorher: kontrolle.vorher90, nachher: kontrolle.nachher90 }) : null;
  const details = { tage, gemessenTage: gemessen, vorzeitig, geplantesEnde: ende, vorher90, nachher90, grenze90: Math.round(grenze90 ?? 0), erholt: ziel === "erholt", kontrolle, netto: nettoEffekt, vonHand: true, datenBis: gemessen > 0 ? bis : null };
  db.transaction(() => {
    verlauf(db, z.number, z.stufe, "ausgewertet", details, nutzer.name, jetzt);
    if (ziel === "erholt") setze(db, z.number, { stufe: "raus", phase: "fertig", ergebnis: "erholt" }, jetzt);
    else weiter(db, z, einst, { fuer }, jetzt);
  })();
  protokoll.schreibe(db, { ...wer(nutzer), aktion: "ladder_moved", objekt: "product " + z.number, details: { stufe: z.stufe, ziel, gemessenTage: gemessen, vorzeitig, netto: nettoEffekt } }, jetzt);
  return ok({ number: z.number, ziel, stufe: ziel === "erholt" ? "raus" : naechste(z.stufe), messung: details });
}

export function entscheide(db, nutzer, number, entscheidung, notiz, jetzt = new Date()) {
  if (nutzer?.rolle !== "admin") return fehler(403, "Only an admin can decide after the manual check.");
  if (!ENTSCHEIDUNGEN.includes(entscheidung)) return fehler(400, "Unknown decision.");
  const n = String(notiz ?? "").replace(/\s+/g, " ").trim().slice(0, 500);
  if (!n) return fehler(400, "Please write down why (one sentence is enough).");
  const { z, f } = inPhase(db, number, ["pruefung"], "offen"); if (f) return f;
  setze(db, z.number, { stufe: "raus", phase: "fertig", ergebnis: entscheidung }, jetzt);
  verlauf(db, z.number, "pruefung", "entschieden", { entscheidung, notiz: n }, nutzer.name, jetzt);
  protokoll.schreibe(db, { ...wer(nutzer), aktion: "ladder_decided", objekt: "product " + z.number, details: { entscheidung, notiz: n } }, jetzt);
  return ok({ number: z.number, entscheidung });
}

// Was something changed on eBay for this listing since it came onto the ladder (approved or "Done by hand")?
const geaendert = (db, z) => !!db.prepare("SELECT 1 FROM leiter_verlauf WHERE number = ? AND at >= ? AND ereignis IN ('freigegeben', 'gestartet') LIMIT 1").get(z.number, z.eingestiegen_at);

// An admin takes a listing off the ladder. If nothing has been changed on eBay yet, it is immediately "Eligible" again (no 90 days
// pause: there is nothing to wait for; Niko, 20 Nov). Otherwise the changes stay on eBay, and the pause applies as before.
export function brichAb(db, nutzer, number, grund, jetzt = new Date()) {
  if (nutzer?.rolle !== "admin") return fehler(403, "Only an admin can take a listing off the ladder.");
  const z = lade(db, String(number ?? ""));
  if (!z || z.stufe === "raus") return fehler(404, "This listing is not on the ladder.");
  const g = String(grund ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
  const ohnePause = !geaendert(db, z);
  db.transaction(() => {
    if (ohnePause) db.prepare("DELETE FROM leiter WHERE number = ?").run(z.number);
    else setze(db, z.number, { stufe: "raus", phase: "fertig", ergebnis: "abgebrochen" }, jetzt);
    verlauf(db, z.number, z.stufe, ohnePause ? "zurueckgesetzt" : "abgebrochen", { grund: g }, nutzer.name, jetzt);
  })();
  protokoll.schreibe(db, { ...wer(nutzer), aktion: ohnePause ? "ladder_reset" : "ladder_removed", objekt: "product " + z.number, details: { stufe: z.stufe, grund: g } }, jetzt);
  return ok({ number: z.number, pause: !ohnePause });
}

// "Start over": everything that has not been changed on eBay yet goes back to "Eligible" (the control group too). Listings with
// a change on eBay stay, because their measurement is running.
export function setzeZurueck(db, nutzer, grund, jetzt = new Date()) {
  if (nutzer?.rolle !== "admin") return fehler(403, "Only an admin can start the ladder over.");
  const g = String(grund ?? "").replace(/\s+/g, " ").trim().slice(0, 200) || "Start over";
  const zeilen = db.prepare("SELECT * FROM leiter WHERE stufe != 'raus'").all();
  const weg = zeilen.filter((z) => !geaendert(db, z));
  db.transaction(() => {
    for (const z of weg) { db.prepare("DELETE FROM leiter WHERE number = ?").run(z.number); verlauf(db, z.number, z.stufe, "zurueckgesetzt", { grund: g }, nutzer.name, jetzt); }
  })();
  protokoll.schreibe(db, { ...wer(nutzer), aktion: "ladder_start_over", objekt: "ladder", details: { zurueckgesetzt: weg.length, behalten: zeilen.length - weg.length, grund: g } }, jetzt);
  return ok({ zurueckgesetzt: weg.length, behalten: zeilen.length - weg.length });
}

// Listings already sold on eBay that came onto the ladder before the rule leiterNurOhneVerkauf (Niko, 20 Nov: "why is this
// product in the funnel if we have already sold it"), come off again — but only as long as nothing has been changed on eBay.
// Applies to phase and control alike, otherwise the control group would hold sold against never-sold listings.
export function raeumeVerkaufteAb(db, produkte, einst = EINSTELLUNGEN, jetzt = new Date()) {
  if (einst.leiterNurOhneVerkauf === "nein") return [];
  const nach = new Map(produkte.map((p) => [p.number, p]));
  const weg = db.prepare("SELECT * FROM leiter WHERE stufe != 'raus'").all().filter((z) => nach.has(z.number) && schonVerkauft(nach.get(z.number), einst) && !geaendert(db, z));
  if (!weg.length) return [];
  db.transaction(() => {
    for (const z of weg) {
      db.prepare("DELETE FROM leiter WHERE number = ?").run(z.number);
      verlauf(db, z.number, z.stufe, "zurueckgesetzt", { grund: `Already sold on eBay (${Number(nach.get(z.number).units_total)} in total), so it is left alone. Nothing had been changed on eBay.`, automatisch: true }, "system", jetzt);
    }
  })();
  protokoll.schreibe(db, { benutzer: "system", aktion: "ladder_sold_removed", objekt: "ladder", details: { entfernt: weg.length, nummern: weg.map((z) => z.number).slice(0, 100) } }, jetzt);
  return weg.map((z) => z.number);
}

// Listings that are already advertised on eBay are not eligible for phase 2 (Niko, 20 Nov) and jump straight to the
// price step. info: { kampagnen: [name] } from ebay-schreiben.istBeworben. Changes nothing on eBay.
export function springeUeberWerbung(db, number, info, einst = EINSTELLUNGEN, kontext = {}, jetzt = new Date()) {
  const { z, f } = inPhase(db, number, ["werbung"], "vorschlag"); if (f) return f;
  const kampagnen = (info?.kampagnen || []).slice(0, 5);
  verlauf(db, z.number, "werbung", "uebersprungen", { grund: `Already advertised on eBay (${kampagnen.join(", ") || "running campaign"}), so not eligible for the ads phase.`, automatisch: true, kampagnen }, "system", jetzt);
  weiter(db, z, einst, kontext, jetzt);
  return ok({ number: z.number, stufe: "preis" });
}

// Everything for the interface: count per step, every listing with its state, interim state of the waiting time and history.
export function uebersicht(db, produkte, { impTag, trafficBis, grenze90, einst = EINSTELLUNGEN }, jetzt = new Date()) {
  const p = new Map(produkte.map((x) => [x.number, x]));
  const verlaeufe = new Map();
  for (const v of db.prepare("SELECT * FROM leiter_verlauf ORDER BY id").all()) {
    if (!verlaeufe.has(v.number)) verlaeufe.set(v.number, []);
    verlaeufe.get(v.number).push({ stufe: v.stufe, ereignis: v.ereignis, details: json(v.details), benutzer: v.benutzer, at: v.at });
  }
  const zeilen = db.prepare("SELECT * FROM leiter ORDER BY aktualisiert_at DESC").all().map((z) => {
    let stand = null;
    if (z.phase === "laeuft") {
      const tage = pruefTage(z.stufe, einst), ende = plusTage(z.stufe_start, tage);
      const bis = trafficBis && trafficBis < ende ? trafficBis : ende;
      const gelaufen = trafficBis ? Math.max(0, Math.round((Date.parse(bis) - Date.parse(z.stufe_start)) / 864e5)) : 0;
      stand = { tage, gelaufen, ende, jetzt90: gelaufen > 0 ? Math.round(impTag(z.number, z.stufe_start, bis) * 90) : null, vorher90: Math.round((z.basis_imp_tag ?? 0) * 90) };
      // Interim state against the control group over the same days: basis for "Next phase" / "Seen again" by hand
      const k = gelaufen > 0 ? kontrollVergleich(db, impTag, z.stufe_start, bis, einst) : null;
      stand.kontrolle = k;
      stand.netto = k && stand.jetzt90 != null ? netto({ vorher: stand.vorher90, nachher: stand.jetzt90 }, { vorher: k.vorher90, nachher: k.nachher90 }) : null;
    }
    const x = p.get(z.number) || {};
    return { number: z.number, title: x.title ?? null, image_url: x.image_url ?? null, units_90d: x.units_90d ?? null, impressionen_90d: x.impressionen_90d ?? null,
      stufe: z.stufe, phase: z.phase, ergebnis: z.ergebnis, eingestiegen_at: z.eingestiegen_at, stufe_start: z.stufe_start, vorschlag: json(z.vorschlag), stand, verlauf: verlaeufe.get(z.number) || [] };
  });
  const zahl = Object.fromEntries([...STUFEN, KONTROLLE, "raus"].map((s) => [s, zeilen.filter((z) => z.stufe === s).length]));
  const raus = Object.fromEntries(["erholt", ...ENTSCHEIDUNGEN, "abgebrochen", KONTROLLE].map((e) => [e, zeilen.filter((z) => z.ergebnis === e).length]));
  return { zahl, raus, grenze90: Math.round(grenze90), trafficBis, max: einst.leiterMax, tage: { titel: einst.leiterTageTitel, werbung: einst.leiterTageWerbung, preis: einst.leiterTagePreis, kontrolle: kontrollTage(einst) },
    kontrolleAn: !!einst.leiterKontrolle, bewegung: einst.leiterBewegung === "automatisch" ? "automatisch" : "hand", werbesatz: einst.werbesatz, preisSchritt: einst.preisSchritt, wirkung: wirkung(db), angebote: zeilen };
}
export const anzahlKontrolle = (db) => db.prepare("SELECT COUNT(*) n FROM leiter WHERE stufe = 'kontrolle'").get().n;
