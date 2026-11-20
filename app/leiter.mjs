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
import { bewerte, leiteSchwellenAb, EINSTELLUNGEN } from "./regeln.mjs";
import * as protokoll from "./protokoll.mjs";

export const STUFEN = ["titel", "werbung", "preis", "pruefung"];
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
      stufe TEXT NOT NULL,                  -- titel | werbung | preis | pruefung | raus
      phase TEXT NOT NULL,                  -- vorschlag (wartet auf Freigabe) | laeuft (Prüfzeit) | offen (manuelle Prüfung) | fertig
      ergebnis TEXT,                        -- bei raus: erholt | ueberarbeiten | offline | behalten | abgebrochen
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
    .filter((p) => p.ebay_aktiv !== 0 && !belegt.has(p.number) && !imTest.has(p.number) && !gesperrt.has(p.number) && bewerte(p, abgeleitet, jetzt).gruppe === "sichtbarkeit")
    .sort((a, b) => (Number(b.units_total) || 0) - (Number(a.units_total) || 0) || (a.number < b.number ? -1 : a.number > b.number ? 1 : 0));
}

// Nimmt neue Angebote auf, bis höchstens einst.leiterMax gleichzeitig auf der Leiter stehen. Gibt die neuen Nummern zurück.
export function nimmAuf(db, produkte, einst = EINSTELLUNGEN, jetzt = new Date(), optionen = {}) {
  const frei = Math.max(0, einst.leiterMax - aktiveNummern(db).size);
  const neu = kandidaten(db, produkte, einst, jetzt, optionen).slice(0, frei).map((p) => p.number);
  db.transaction(() => { for (const n of neu) trageEin(db, n, null, "system", jetzt); })();
  return neu;
}

function trageEin(db, number, details, benutzer, jetzt) {
  db.prepare("INSERT INTO leiter (number, stufe, phase, eingestiegen_at, aktualisiert_at) VALUES (?, 'titel', 'vorschlag', ?, ?) ON CONFLICT(number) DO UPDATE SET stufe = 'titel', phase = 'vorschlag', ergebnis = NULL, eingestiegen_at = excluded.eingestiegen_at, stufe_start = NULL, basis_imp_tag = NULL, vorschlag = NULL, aktualisiert_at = excluded.aktualisiert_at")
    .run(number, jetzt.toISOString(), jetzt.toISOString());
  verlauf(db, number, "titel", "aufgenommen", details, benutzer, jetzt);
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
    texte.push(`Listing ${it.external_id} changed on eBay.` + (r.meldung ? " eBay note: " + r.meldung : ""));
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
export function werteAus(db, { impTag, trafficBis, grenze90, einst = EINSTELLUNGEN, fuer = null }, jetzt = new Date()) {
  const ergebnisse = [];
  if (!trafficBis) return ergebnisse;
  for (const z of db.prepare("SELECT * FROM leiter WHERE phase = 'laeuft' ORDER BY number").all()) {
    const tage = pruefTage(z.stufe, einst);
    const ende = plusTage(z.stufe_start, tage);
    if (trafficBis < ende) continue;
    const jeTag = impTag(z.number, z.stufe_start, ende);
    const hoch90 = Math.round(jeTag * 90);
    const erholt = hoch90 >= grenze90;
    const details = { tage, vorher90: Math.round((z.basis_imp_tag ?? 0) * 90), nachher90: hoch90, grenze90: Math.round(grenze90), erholt };
    db.transaction(() => {
      verlauf(db, z.number, z.stufe, "ausgewertet", details, "system", jetzt);
      if (erholt) setze(db, z.number, { stufe: "raus", phase: "fertig", ergebnis: "erholt" }, jetzt);
      else weiter(db, z, einst, { fuer }, jetzt);
    })();
    ergebnisse.push({ number: z.number, stufe: z.stufe, ...details });
  }
  return ergebnisse;
}

// Admin entscheidet nach der manuellen Prüfung. Die App ändert dabei nichts bei eBay: "offline" ist ein Auftrag an den Admin.
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

// Admin nimmt ein Angebot von der Leiter (z. B. weil es ausläuft). Bereits gemachte Änderungen bei eBay bleiben.
export function brichAb(db, nutzer, number, grund, jetzt = new Date()) {
  if (nutzer?.rolle !== "admin") return fehler(403, "Only an admin can take a listing off the ladder.");
  const z = lade(db, String(number ?? ""));
  if (!z || z.stufe === "raus") return fehler(404, "This listing is not on the ladder.");
  const g = String(grund ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
  setze(db, z.number, { stufe: "raus", phase: "fertig", ergebnis: "abgebrochen" }, jetzt);
  verlauf(db, z.number, z.stufe, "abgebrochen", { grund: g }, nutzer.name, jetzt);
  protokoll.schreibe(db, { ...wer(nutzer), aktion: "ladder_removed", objekt: "product " + z.number, details: { stufe: z.stufe, grund: g } }, jetzt);
  return ok({ number: z.number });
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
    }
    const x = p.get(z.number) || {};
    return { number: z.number, title: x.title ?? null, image_url: x.image_url ?? null, units_90d: x.units_90d ?? null, impressionen_90d: x.impressionen_90d ?? null,
      stufe: z.stufe, phase: z.phase, ergebnis: z.ergebnis, eingestiegen_at: z.eingestiegen_at, stufe_start: z.stufe_start, vorschlag: json(z.vorschlag), stand, verlauf: verlaeufe.get(z.number) || [] };
  });
  const zahl = Object.fromEntries([...STUFEN, "raus"].map((s) => [s, zeilen.filter((z) => z.stufe === s).length]));
  const raus = Object.fromEntries(["erholt", ...ENTSCHEIDUNGEN, "abgebrochen"].map((e) => [e, zeilen.filter((z) => z.ergebnis === e).length]));
  return { zahl, raus, grenze90: Math.round(grenze90), trafficBis, max: einst.leiterMax, tage: { titel: einst.leiterTageTitel, werbung: einst.leiterTageWerbung, preis: einst.leiterTagePreis }, werbesatz: einst.werbesatz, preisSchritt: einst.preisSchritt, angebote: zeilen };
}
