// Die Leiter: Angebote mit wenig Impressionen gehen Stufe für Stufe durch drei Hebel, bis sie wieder gesehen werden.
//
//   Diagnose "Low impressions"  ->  1 Titel (KI-Vorschlag, Regelprüfer, Freigabe)
//                                    nach der Prüfzeit wieder genug Impressionen?  ja -> raus (erholt)
//                               ->  2 Werbung (eBay Promoted Listings, Standard-Satz 10 %)     ja -> raus
//                               ->  3 Preis (ein Schritt nach unten, Standard 10 %)            ja -> raus
//                               ->  4 Manuelle Prüfung: Admin entscheidet überarbeiten / offline nehmen / behalten
//
// "Wieder genug Impressionen" heißt: die Impressionen je Tag während der Prüfzeit, hochgerechnet auf 90 Tage, liegen nicht mehr
// unter der Grenze der Diagnose (unteres Viertel des Shops). Die Grenze wandert mit dem Shop mit; wird es im ganzen Shop ruhiger
// (Saison), sinkt sie, und ein Angebot gilt nicht fälschlich als gescheitert.
// Jede Stufe ändert bei eBay erst nach Freigabe durch einen Admin. Was die Stufen bei eBay tun, steht in fuehreAus (unten).
// Jede Funktion liefert { ok, wert } oder { ok: false, status, fehler }, wie die anderen Module.
//
// Kontrollgruppe (läuft immer mit, keine eigene Seite): Der tägliche Lauf zieht doppelt so viele Kandidaten, wie Plätze frei sind,
// und lost sie je zur Hälfte auf die Leiter und in die Kontrollgruppe. Kontrollangebote bleiben bei eBay unverändert, so lange wie
// die drei Prüfzeiten zusammen dauern. Bei jeder Auswertung einer Stufe misst die App dieselben Tage an der Kontrollgruppe: Steigt
// der ganze Shop (Saison), steigt die Kontrolle mit, und der Nettoeffekt zeigt, was die Stufe selbst gebracht hat.
import crypto from "node:crypto";
import { bewerte, leiteSchwellenAb, EINSTELLUNGEN } from "./regeln.mjs";
import { ziehe } from "./experimente.mjs";
import { netto } from "./auswertung.mjs";
import { pruefeTitel } from "./titel-regeln.mjs";
import * as protokoll from "./protokoll.mjs";

export const STUFEN = ["titel", "werbung", "preis", "pruefung"];
export const KONTROLLE = "kontrolle";
export const kontrollTage = (einst = EINSTELLUNGEN) => einst.leiterTageTitel + einst.leiterTageWerbung + einst.leiterTagePreis;
export const ENTSCHEIDUNGEN = ["ueberarbeiten", "offline", "behalten"];
// Nach so vielen Tagen darf ein Angebot, das die Leiter verlassen hat, wieder hinein (wenn es wieder wenig Impressionen hat)
export const WIEDER_NACH_TAGEN = 90;
const BASIS_TAGE = 30; // Vergleichswert: Impressionen je Tag in den 30 Tagen vor dem Start einer Stufe

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
      phase TEXT NOT NULL,                  -- vorschlag (wartet auf Freigabe) | laeuft (Prüfzeit) | offen (manuelle Prüfung) | kontrolle | fertig
      ergebnis TEXT,                        -- bei raus: erholt | ueberarbeiten | offline | behalten | abgebrochen | kontrolle (Kontrollzeit vorbei)
      eingestiegen_at TEXT NOT NULL,
      stufe_start TEXT,                     -- Tag (JJJJ-MM-TT), an dem die Maßnahme der laufenden Stufe bei eBay live ging
      basis_imp_tag REAL,                   -- Impressionen je Tag in den 30 Tagen vor diesem Tag
      vorschlag TEXT,                       -- JSON: was die Stufe bei eBay ändern soll
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

// Nummern, die gerade auf der Leiter stehen: die dürfen in keinen Titeltest (und umgekehrt), sonst misst man zwei Dinge auf einmal.
export const aktiveNummern = (db) => new Set(db.prepare("SELECT number FROM leiter WHERE stufe != 'raus'").all().map((r) => r.number));

// Wer kommt neu auf die Leiter? Diagnose "Low impressions", laufendes eBay-Angebot, nicht gesperrt, in keinem Test, nicht schon drauf
// (oder vor weniger als 90 Tagen ausgestiegen). Bewährte Angebote zuerst (mehr Verkäufe insgesamt), dann nach Nummer.
export function kandidaten(db, produkte, einst = EINSTELLUNGEN, jetzt = new Date(), { imTest = new Map(), gesperrt = new Set() } = {}) {
  const abgeleitet = leiteSchwellenAb(produkte, einst, jetzt);
  const grenze = tag(new Date(jetzt.getTime() - WIEDER_NACH_TAGEN * 864e5));
  const belegt = new Set(db.prepare("SELECT number FROM leiter WHERE stufe != 'raus' OR substr(aktualisiert_at, 1, 10) > ?").all(grenze).map((r) => r.number));
  return produkte
    .filter((p) => p.ebay_aktiv !== 0 && !belegt.has(p.number) && !imTest.has(p.number) && !gesperrt.has(p.number) && bewerte(p, abgeleitet, jetzt).gruppe === "sichtbarkeit" && !schonVerkauft(p, einst))
    .sort((a, b) => (Number(b.units_total) || 0) - (Number(a.units_total) || 0) || (Number(b.impressionen_90d) || 0) - (Number(a.impressionen_90d) || 0) || (a.number < b.number ? -1 : a.number > b.number ? 1 : 0));
}
// Niko 20.11.: Angebote, die bei eBay schon verkauft haben, werden nicht angefasst; es gibt genug, die nie verkauft haben.
// Einstellung leiterNurOhneVerkauf ("ja" Standard / "nein"). units_total ist seit #44/#45 nur eBay.
export const schonVerkauft = (p, einst = EINSTELLUNGEN) => einst.leiterNurOhneVerkauf !== "nein" && (Number(p.units_total) || 0) > 0;

// Nimmt neue Angebote auf, bis höchstens einst.leiterMax gleichzeitig auf der Leiter stehen. Gibt die neuen Nummern zurück.
// Mit Kontrollgruppe (einst.leiterKontrolle): die nächsten 2 × frei Kandidaten werden per Los geteilt (ziehe aus experimente.mjs,
// gleicher seed = gleiche Ziehung, der seed steht im Lebenslauf). Gibt die Nummern zurück, die auf die Leiter kamen.
// Von Hand (Knopf "Draw listings by lot", Niko 20.11.): optionen.anzahl = so viele auf die Leiter, ohne Obergrenze;
// optionen.kontrolle = true/false entscheidet je Ziehung, ob genauso viele in die Kontrollgruppe gelost werden.
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

// Kontrollangebote, deren Kontrollzeit die Tage von..bis ganz abdeckt: die Vergleichsgruppe für eine Stufe mit diesem Zeitfenster
function kontrollGruppe(db, von, bis, einst) {
  return db.prepare("SELECT number, stufe_start FROM leiter WHERE (stufe = 'kontrolle' OR ergebnis = 'kontrolle') AND stufe_start IS NOT NULL").all()
    .filter((z) => z.stufe_start <= von && plusTage(z.stufe_start, kontrollTage(einst)) >= bis).map((z) => z.number);
}
// Impressionen je Tag der Kontrollgruppe vor (30 Tage) und während eines Zeitfensters, als Summe der Gruppe
function kontrollVergleich(db, impTag, von, bis, einst) {
  const nr = kontrollGruppe(db, von, bis, einst);
  if (!nr.length) return null;
  const vorher = nr.reduce((s, n) => s + impTag(n, plusTage(von, -BASIS_TAGE - 1), plusTage(von, -1)), 0);
  const nachher = nr.reduce((s, n) => s + impTag(n, von, bis), 0);
  return { anzahl: nr.length, vorher90: Math.round(vorher * 90), nachher90: Math.round(nachher * 90) };
}

// Admin wählt ein bestimmtes Angebot aus den Kandidaten (Auswahlliste auf der Seite Ladder) und setzt es sofort auf die Leiter,
// auch über die Höchstzahl hinaus: für einen gezielten Test oder die Vorführung. Es gelten dieselben Bedingungen wie beim Lauf.
export function nimmVonHandAuf(db, nutzer, number, produkte, einst = EINSTELLUNGEN, jetzt = new Date(), optionen = {}) {
  if (nutzer?.rolle !== "admin") return fehler(403, "Only an admin can put a listing on the ladder.");
  const nr = String(number ?? "");
  if (!kandidaten(db, produkte, einst, jetzt, optionen).some((p) => p.number === nr))
    return fehler(409, "This listing cannot go on the ladder right now (not low impressions, no active eBay listing, blocked, in a test, or on the ladder in the last 90 days).");
  db.transaction(() => trageEin(db, nr, { vonHand: true }, nutzer.name, jetzt))();
  protokoll.schreibe(db, { ...wer(nutzer), aktion: "ladder_added", objekt: "product " + nr, details: { vonHand: true } }, jetzt);
  return ok({ number: nr });
}

// Angebote in Stufe 1 ohne Vorschlag (die KI wird danach gefragt, siehe server.mjs)
export const ohneTitelVorschlag = (db) => db.prepare("SELECT number FROM leiter WHERE stufe = 'titel' AND phase = 'vorschlag' AND vorschlag IS NULL").all().map((r) => r.number);

// Vorschlag für Werbung und Preis: ergibt sich aus den Einstellungen und dem Angebot. kanaele: aktive eBay-Angebote der Nummer.
// Den Preis senkt die App nur, wenn alle Varianten denselben Preis haben (sonst würde ein Schritt die Preisstaffel zerstören).
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

// Setzt den Titelvorschlag (aus der KI, der Titelhilfe oder von Hand). Der Regelprüfer muss vorher bestanden sein (siehe server.mjs).
export function setzeTitelVorschlag(db, nutzer, number, vorschlag, jetzt = new Date()) {
  const { z, f } = inPhase(db, number, ["titel"], "vorschlag"); if (f) return f;
  if (!vorschlag?.pruefung?.ok) return fehler(400, "This title did not pass the rule check: " + (vorschlag?.pruefung?.verstoesse || []).map((v) => v.text).join(" "));
  setze(db, z.number, { vorschlag }, jetzt);
  verlauf(db, z.number, "titel", "vorschlag", { titel: vorschlag.titel, alt: vorschlag.alt, quelle: vorschlag.quelle, verworfen: vorschlag.verworfen?.length || 0 }, nutzer.name, jetzt);
  return ok({ number: z.number });
}

// Kein Vorschlag möglich (KI nicht erreichbar, alle Vorschläge am Regelprüfer gescheitert): steht im Lebenslauf, der Vorschlag bleibt leer
// und wird beim nächsten Lauf erneut versucht. Gleiche Meldung zweimal hintereinander wird nur einmal festgehalten.
export function merkeFehlschlag(db, number, text, verworfen = [], jetzt = new Date()) {
  const letzte = db.prepare("SELECT ereignis, details FROM leiter_verlauf WHERE number = ? ORDER BY id DESC LIMIT 1").get(String(number));
  if (letzte?.ereignis === "kein_vorschlag" && json(letzte.details)?.text === text) return;
  verlauf(db, String(number), "titel", "kein_vorschlag", { text, verworfen: (verworfen || []).slice(0, 5) }, "system", jetzt);
}

// Was die Stufe bei eBay tut. items: aktive eBay-Angebote der Nummer [{ external_id, title, skus }]. schreiber: ebay-schreiben.mjs.
// Rückgabe: { ausgang: "angewendet" | "probelauf" | "fehlgeschlagen", text }. Vor jeder Änderung wird gelesen; weicht etwas ab, passiert nichts.
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
    // Nachlesen: steht bei eBay jetzt wirklich der neue Titel / Preis? (Beleg für die Vorführung und den Lebenslauf)
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

// Admin gibt die laufende Stufe frei: die App ändert bei eBay, danach läuft die Prüfzeit. impTag(number, von, bis): Impressionen je Tag.
export async function gibFrei(db, nutzer, number, { items, schreiber, impTag }, jetzt = new Date()) {
  if (nutzer?.rolle !== "admin") return fehler(403, "Only an admin can approve a ladder step.");
  const { z, f } = inPhase(db, number, ["titel", "werbung", "preis"], "vorschlag"); if (f) return f;
  const v = json(z.vorschlag);
  if (!v || v.nichtMoeglich) return fehler(409, v?.nichtMoeglich || "There is no suggestion to approve yet.");
  // Den Titel unmittelbar vor dem Schreiben noch einmal prüfen: Regeln werden schärfer (20.11.: Marke vor "passend für"),
  // ein früher gespeicherter Vorschlag darf dann nicht mehr durchrutschen.
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

// Admin: die Maßnahme wurde von Hand bei eBay gemacht (oder soll ohne eBay-Änderung als gestartet gelten, z. B. im Probelauf).
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

// Admin überspringt die laufende Stufe (z. B. keine Werbung für dieses Angebot): weiter zur nächsten, ohne eBay-Änderung.
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

// Täglicher Schritt: jede Stufe, deren Prüfzeit vollständig in den Daten liegt, wird ausgewertet.
// trafficBis: letzter Tag mit fertigen Traffic-Daten. grenze90: die Grenze der Diagnose (Impressionen in 90 Tagen).
// nurKontrolle: Stufen nicht bewerten (Bewegung von Hand), nur Kontrollangebote freigeben, deren Zeit um ist.
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
    // Dieselben Tage an der Kontrollgruppe: Nettoeffekt = (Angebot nachher/vorher) / (Kontrolle nachher/vorher) − 1
    const kontrolle = kontrollVergleich(db, impTag, z.stufe_start, ende, einst);
    const nettoEffekt = kontrolle ? netto({ vorher: vorher90, nachher: hoch90 }, { vorher: kontrolle.vorher90, nachher: kontrolle.nachher90 }) : null;
    const details = { tage, vorher90, nachher90: hoch90, grenze90: Math.round(grenze90), erholt, kontrolle, netto: nettoEffekt };
    db.transaction(() => {
      verlauf(db, z.number, z.stufe, "ausgewertet", details, "system", jetzt);
      if (erholt) setze(db, z.number, { stufe: "raus", phase: "fertig", ergebnis: "erholt" }, jetzt);
      else weiter(db, z, einst, { fuer }, jetzt);
    })();
    ergebnisse.push({ number: z.number, stufe: z.stufe, ...details });
  }
  // Kontrollzeit vorbei (alle drei Prüfzeiten): das Angebot ist frei und darf nach 90 Tagen wieder aufgenommen werden
  for (const z of db.prepare("SELECT * FROM leiter WHERE stufe = 'kontrolle' AND stufe_start IS NOT NULL").all()) {
    if (trafficBis < plusTage(z.stufe_start, kontrollTage(einst))) continue;
    db.transaction(() => {
      setze(db, z.number, { stufe: "raus", phase: "fertig", ergebnis: KONTROLLE }, jetzt);
      verlauf(db, z.number, KONTROLLE, "kontrolle_ende", { tage: kontrollTage(einst) }, "system", jetzt);
    })();
  }
  return ergebnisse;
}

// Wirkung je Stufe gegen die Kontrollgruppe: alle Auswertungen dieser Stufe zusammen (Summe vorher/nachher der Angebote und der
// jeweils gleichzeitigen Kontrollgruppe). Ohne Kontrollgruppe zählt die Auswertung nur bei "wieder gesehen", nicht im Nettoeffekt.
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

// Der Funnel: wo steht jedes Produkt und warum. Die Prüfung läuft in derselben Reihenfolge wie die Aufnahme (kandidaten oben),
// so dass "eligible" hier genau die Angebote sind, die der nächste Lauf nehmen würde.
//   status: nicht_geeignet | geeignet | kontrolle | titel | werbung | preis | pruefung | erholt | raus
//   art (nur bei nicht_geeignet): kein_ebay | gesperrt | im_test | pause | genug | neu | verkauft
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

// Admin entscheidet nach der manuellen Prüfung. Die App ändert dabei nichts bei eBay: "offline" ist ein Auftrag an den Admin.
// Bewegung von Hand (Niko 20.11.: Produkte wandern nur per Knopf): ein Admin schiebt ein Angebot aus der laufenden Prüfzeit
// in die nächste Phase (ziel "weiter") oder nimmt es als wieder gesehen von der Leiter (ziel "erholt"). Gemessen wird wie im
// automatischen Lauf, nur über die Tage, die bis jetzt in den Daten liegen; die Messung steht als "ausgewertet" im Lebenslauf
// (mit vonHand), damit die Wirkung je Phase weiter gegen die Kontrollgruppe gerechnet wird.
export function schiebeVonHand(db, nutzer, number, ziel, { impTag, trafficBis, grenze90, einst = EINSTELLUNGEN, fuer = null }, jetzt = new Date()) {
  if (nutzer?.rolle !== "admin") return fehler(403, "Only an admin can move a listing in the funnel.");
  if (!["weiter", "erholt"].includes(ziel)) return fehler(400, "Unknown move.");
  const { z, f } = inPhase(db, number, ["titel", "werbung", "preis"], "laeuft"); if (f) return f;
  const tage = pruefTage(z.stufe, einst), ende = plusTage(z.stufe_start, tage);
  const bis = trafficBis && trafficBis < ende ? trafficBis : ende;
  const gemessen = trafficBis ? Math.max(0, Math.round((Date.parse(bis) - Date.parse(z.stufe_start)) / 864e5)) : 0;
  const vorher90 = Math.round((z.basis_imp_tag ?? 0) * 90);
  const nachher90 = gemessen > 0 ? Math.round(impTag(z.number, z.stufe_start, bis) * 90) : null;
  const kontrolle = gemessen > 0 ? kontrollVergleich(db, impTag, z.stufe_start, bis, einst) : null;
  const nettoEffekt = kontrolle && nachher90 != null ? netto({ vorher: vorher90, nachher: nachher90 }, { vorher: kontrolle.vorher90, nachher: kontrolle.nachher90 }) : null;
  const details = { tage, gemessenTage: gemessen, vorher90, nachher90, grenze90: Math.round(grenze90 ?? 0), erholt: ziel === "erholt", kontrolle, netto: nettoEffekt, vonHand: true };
  db.transaction(() => {
    verlauf(db, z.number, z.stufe, "ausgewertet", details, nutzer.name, jetzt);
    if (ziel === "erholt") setze(db, z.number, { stufe: "raus", phase: "fertig", ergebnis: "erholt" }, jetzt);
    else weiter(db, z, einst, { fuer }, jetzt);
  })();
  protokoll.schreibe(db, { ...wer(nutzer), aktion: "ladder_moved", objekt: "product " + z.number, details: { stufe: z.stufe, ziel, gemessenTage: gemessen, netto: nettoEffekt } }, jetzt);
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

// Wurde für dieses Angebot seit dem Einstieg bei eBay etwas geändert (freigegeben oder "Done by hand")?
const geaendert = (db, z) => !!db.prepare("SELECT 1 FROM leiter_verlauf WHERE number = ? AND at >= ? AND ereignis IN ('freigegeben', 'gestartet') LIMIT 1").get(z.number, z.eingestiegen_at);

// Admin nimmt ein Angebot von der Leiter. Wurde bei eBay noch nichts geändert, ist es sofort wieder "Eligible" (keine 90 Tage
// Pause: es gibt nichts abzuwarten; Niko 20.11.). Sonst bleiben die Änderungen bei eBay, und die Pause gilt wie bisher.
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

// "Start over": alles, was bei eBay noch nicht geändert wurde, zurück zu "Eligible" (auch die Kontrollgruppe). Angebote mit
// einer Änderung bei eBay bleiben, weil ihre Messung läuft.
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

// Schon bei eBay verkaufte Angebote, die vor der Regel leiterNurOhneVerkauf auf die Leiter kamen (Niko 20.11.: "wieso ist das
// Produkt im Funnel, wenn wir es schon verkauft haben"), gehen wieder runter — aber nur, solange bei eBay nichts geändert wurde.
// Gilt für Phase und Kontrolle gleich, sonst stünden in der Kontrollgruppe verkaufte gegen nie verkaufte Angebote.
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

// Angebote, die bei eBay schon beworben werden, sind für Phase 2 nicht berechtigt (Niko 20.11.) und springen direkt in die
// Preisstufe. info: { kampagnen: [Name] } aus ebay-schreiben.istBeworben. Ändert nichts bei eBay.
export function springeUeberWerbung(db, number, info, einst = EINSTELLUNGEN, kontext = {}, jetzt = new Date()) {
  const { z, f } = inPhase(db, number, ["werbung"], "vorschlag"); if (f) return f;
  const kampagnen = (info?.kampagnen || []).slice(0, 5);
  verlauf(db, z.number, "werbung", "uebersprungen", { grund: `Already advertised on eBay (${kampagnen.join(", ") || "running campaign"}), so not eligible for the ads phase.`, automatisch: true, kampagnen }, "system", jetzt);
  weiter(db, z, einst, kontext, jetzt);
  return ok({ number: z.number, stufe: "preis" });
}

// Alles für die Oberfläche: Zahl je Stufe, jedes Angebot mit Stand, Zwischenstand der Prüfzeit und Lebenslauf.
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
      // Zwischenstand gegen die Kontrollgruppe über dieselben Tage: Grundlage für "Next phase" / "Seen again" von Hand
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
