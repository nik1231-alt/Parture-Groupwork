// Approval: suggestions for title changes on eBay. Builders suggest, an admin approves, and only then is anything changed on eBay.
// Flow of a test:
//   A builder enters the new titles  ->  "Send for approval"  (test status "freigabe", one change per listing "offen" = open)
//   The admin approves               ->  the app changes the titles on eBay and logs every change
//                                        when all titles are changed, the test starts (the starting figures are recorded now)
//   The admin rejects                ->  nothing is changed, the test goes back to "vorbereitet" (prepared)
// If a test is closed with "revert", reverting changes arise (new title back to the old one) that an admin must approve again.
// Every function returns { ok, wert } or { ok: false, status, fehler }, exactly like the other modules.
import * as experimente from "./experimente.mjs";
import * as protokoll from "./protokoll.mjs";

const fehler = (status, text) => ({ ok: false, status, fehler: text });
const ok = (wert) => ({ ok: true, wert });
const norm = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const OFFEN = ["offen", "fehlgeschlagen"];
const ARTEN = ["titel", "zurueck"];
const pruefeId = (id) => Number.isInteger(id) && id >= 1;
// Safeguard against mistakes: so many listings at most may a single approval change (tests are small anyway)
export const MAX_AENDERUNGEN = 50;
const laufend = new Set(); // prevents the same approval from running twice at the same time

export function bereiteVor(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS aenderung (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      experiment_id INTEGER NOT NULL, number TEXT NOT NULL, item_id TEXT NOT NULL,
      art TEXT NOT NULL,                       -- titel | zurueck
      alt TEXT NOT NULL, neu TEXT NOT NULL,    -- expected title on eBay / wanted title
      status TEXT NOT NULL,                    -- offen | angewendet | abgelehnt | fehlgeschlagen | verworfen
      vorgeschlagen_von TEXT NOT NULL, vorgeschlagen_at TEXT NOT NULL,
      entschieden_von TEXT, entschieden_at TEXT, ergebnis TEXT
    );
  `);
}

const wer = (n) => ({ benutzer: n.name, rolle: n.rolle });
const ladeExperiment = (db, id) => db.prepare("SELECT * FROM experiment WHERE id = ?").get(id);

// Which eBay listings belong to a product number? The same title as the old one, otherwise the only eBay listing of the number.
function waehleItems(kanaele, alt) {
  const treffer = kanaele.filter((k) => norm(k.title) === norm(alt));
  if (treffer.length) return treffer;
  return kanaele.length === 1 ? kanaele : [];
}

// ---------- Suggest (builder or admin) ----------
export function reicheEin(db, nutzer, eingabe, kanaeleFuer, jetzt = new Date()) {
  if (!eingabe || typeof eingabe !== "object" || Array.isArray(eingabe)) return fehler(400, "Invalid request.");
  if (!pruefeId(eingabe.id)) return fehler(400, "Invalid test id.");
  const e = ladeExperiment(db, eingabe.id);
  if (!e) return fehler(404, "Test not found.");
  if (e.status !== "vorbereitet") return fehler(409, "Only a prepared test can be sent for approval.");
  const test = db.prepare("SELECT * FROM experiment_angebot WHERE experiment_id = ? AND gruppe = 'test'").all(e.id);
  const ohne = test.filter((a) => !a.neu).length;
  if (ohne) return fehler(409, `${ohne} of ${test.length} test listings still need a new title.`);
  const zeilen = []; const ungeklaert = [];
  for (const a of test) {
    const items = waehleItems(kanaeleFuer(a.number), a.alt);
    if (!items.length) ungeklaert.push(a.number);
    for (const it of items) zeilen.push({ number: a.number, item_id: String(it.external_id), alt: a.alt, neu: a.neu });
  }
  if (ungeklaert.length) return fehler(409, `Cannot match these products to a single eBay listing: ${ungeklaert.slice(0, 5).join(", ")}${ungeklaert.length > 5 ? " …" : ""}. Discard the test and draw a new one.`);
  if (zeilen.length > MAX_AENDERUNGEN) return fehler(409, `A single approval can change at most ${MAX_AENDERUNGEN} listings, this test would change ${zeilen.length}. Draw a smaller test.`);
  if (zeilen.some((z) => !/^\d{6,20}$/.test(z.item_id))) return fehler(409, "A listing has an invalid eBay item number.");
  db.transaction(() => {
    const ins = db.prepare("INSERT INTO aenderung (experiment_id, number, item_id, art, alt, neu, status, vorgeschlagen_von, vorgeschlagen_at) VALUES (?, ?, ?, 'titel', ?, ?, 'offen', ?, ?)");
    for (const z of zeilen) {
      ins.run(e.id, z.number, z.item_id, z.alt, z.neu, nutzer.name, jetzt.toISOString());
      protokoll.schreibe(db, { ...wer(nutzer), aktion: "change_proposed", objekt: "item " + z.item_id, details: { test: e.id, number: z.number, alt: z.alt, neu: z.neu } }, jetzt);
    }
    db.prepare("UPDATE experiment SET status = 'freigabe' WHERE id = ?").run(e.id);
  })();
  return ok({ id: e.id, aenderungen: zeilen.length });
}

// ---------- Anzeigen ----------
export function liste(db) {
  return db.prepare("SELECT a.*, e.name AS experiment_name, e.status AS experiment_status FROM aenderung a JOIN experiment e ON e.id = a.experiment_id ORDER BY a.id DESC LIMIT 600").all();
}
export const zaehleOffen = (db) => db.prepare("SELECT COUNT(*) n FROM aenderung WHERE status IN ('offen', 'fehlgeschlagen')").get().n;

const pruefeGruppe = (eingabe) => {
  if (!eingabe || typeof eingabe !== "object" || Array.isArray(eingabe)) return "Invalid request.";
  if (!pruefeId(eingabe.id)) return "Invalid test id.";
  if (!ARTEN.includes(eingabe.art)) return "Unknown kind of change.";
  return null;
};

// ---------- Approve (admin only): change on eBay ----------
// schreiber: see ebay-schreiben.mjs. produkte: current product data (for the starting figures of the test).
export async function erteile(db, nutzer, eingabe, schreiber, produkte, jetzt = new Date()) {
  if (nutzer?.rolle !== "admin") return fehler(403, "Only an admin can approve changes.");
  const problem = pruefeGruppe(eingabe); if (problem) return fehler(400, problem);
  const { id, art } = eingabe;
  const schluessel = `${id}:${art}`;
  if (laufend.has(schluessel)) return fehler(409, "This approval is already running.");
  const offen = db.prepare("SELECT * FROM aenderung WHERE experiment_id = ? AND art = ? AND status IN ('offen', 'fehlgeschlagen') ORDER BY id").all(id, art);
  if (!offen.length) return fehler(409, "There is nothing to approve here.");
  if (offen.length > MAX_AENDERUNGEN) return fehler(409, `A single approval can change at most ${MAX_AENDERUNGEN} listings, here ${offen.length} are waiting. Nothing was changed.`);
  laufend.add(schluessel);
  const ergebnis = { angewendet: 0, fehlgeschlagen: 0, probelauf: 0, gestartet: false, schreibenAn: schreiber.schreibenAn() };
  try {
    protokoll.schreibe(db, { ...wer(nutzer), aktion: "change_approved", objekt: `test ${id} (${art})`, details: { anzahl: offen.length, schreibenAn: ergebnis.schreibenAn } }, jetzt);
    for (const c of offen) {
      const ausgang = await bearbeite(db, c, nutzer, schreiber, jetzt);
      ergebnis[ausgang]++;
    }
    if (art === "titel") {
      const e = ladeExperiment(db, id);
      const rest = db.prepare("SELECT COUNT(*) n FROM aenderung WHERE experiment_id = ? AND art = 'titel' AND status IN ('offen', 'fehlgeschlagen')").get(id).n;
      if (e?.status === "freigabe" && rest === 0) {
        const s = experimente.starte(db, { id }, produkte, jetzt, "freigabe");
        ergebnis.gestartet = s.ok;
        protokoll.schreibe(db, { ...wer(nutzer), aktion: "test_started", objekt: "test " + id, details: s.ok ? null : { fehler: s.fehler }, ergebnis: s.ok ? "ok" : "error" }, jetzt);
      }
    }
    return ok(ergebnis);
  } finally { laufend.delete(schluessel); }
}

// A single change. Returns "angewendet" (applied), "fehlgeschlagen" (failed) or "probelauf" (dry run).
async function bearbeite(db, c, nutzer, schreiber, jetzt) {
  const objekt = "item " + c.item_id;
  const setze = (status, text, protokollErgebnis, aktion, details) => {
    if (status) db.prepare("UPDATE aenderung SET status = ?, entschieden_von = ?, entschieden_at = ?, ergebnis = ? WHERE id = ?").run(status, nutzer.name, jetzt.toISOString(), text, c.id);
    else db.prepare("UPDATE aenderung SET ergebnis = ? WHERE id = ?").run(text, c.id);
    protokoll.schreibe(db, { ...wer(nutzer), aktion, objekt, details: { aenderung: c.id, art: c.art, number: c.number, alt: c.alt, neu: c.neu, ...details }, ergebnis: protokollErgebnis }, jetzt);
  };
  try {
    // Dry run without credentials (PREVIEW, local, end-to-end test): eBay cannot be read, and nothing would be written anyway.
    // That is not an error but a dry run: what would be changed is recorded. The change stays open, eBay untouched.
    // (If the switch is on but the credentials are missing, it continues below as an error: that is a misconfiguration.)
    if (!schreiber.schreibenAn() && schreiber.konfiguriert && !schreiber.konfiguriert()) {
      setze(null, "Dry run: this computer has no eBay credentials, so the listing was not read. With credentials and EBAY_SCHREIBEN=an the title would be changed. Nothing was changed on eBay.", "dry_run", "ebay_dry_run", { ohneZugangsdaten: true });
      return "probelauf";
    }
    const g = await schreiber.lies(c.item_id);
    if (!g.ok) { setze("fehlgeschlagen", "Could not read the listing on eBay: " + g.meldung, "error", "ebay_failed", {}); return "fehlgeschlagen"; }
    if (norm(g.titel) === norm(c.neu)) { setze("angewendet", "The title on eBay already matches. Nothing to change.", "ok", "ebay_already_current", { verkauft: g.verkauft }); return "angewendet"; }
    if (norm(g.titel) !== norm(c.alt)) { setze("fehlgeschlagen", `The title on eBay is not the expected one, nothing was overwritten. On eBay now: “${g.titel}”`, "refused", "ebay_refused", { aktuell_bei_ebay: g.titel }); return "fehlgeschlagen"; }
    if (g.status && g.status !== "Active") { setze("fehlgeschlagen", `The listing is not active (${g.status}).`, "refused", "ebay_refused", { listingStatus: g.status }); return "fehlgeschlagen"; }
    if (!schreiber.schreibenAn()) { setze(null, `Dry run: the listing was read and would be changed (${g.verkauft} sales so far). Writing to eBay is switched off.`, "dry_run", "ebay_dry_run", { verkauft: g.verkauft }); return "probelauf"; }
    const r = await schreiber.setzeTitel(c.item_id, c.neu);
    if (r.ok) { setze("angewendet", "Changed on eBay." + (r.meldung ? " eBay note: " + r.meldung : ""), "ok", "ebay_changed", { ack: r.ack, verkauft: g.verkauft }); return "angewendet"; }
    setze("fehlgeschlagen", "eBay refused the change: " + r.meldung, "error", "ebay_failed", { ack: r.ack, verkauft: g.verkauft });
    return "fehlgeschlagen";
  } catch (e) {
    setze("fehlgeschlagen", "Error while talking to eBay: " + e.message, "error", "ebay_failed", {});
    return "fehlgeschlagen";
  }
}

// ---------- Reject (admin only) ----------
export function lehneAb(db, nutzer, eingabe, jetzt = new Date()) {
  if (nutzer?.rolle !== "admin") return fehler(403, "Only an admin can reject changes.");
  const problem = pruefeGruppe(eingabe); if (problem) return fehler(400, problem);
  const { id, art } = eingabe;
  const grund = typeof eingabe.grund === "string" ? eingabe.grund.replace(/\s+/g, " ").trim().slice(0, 200) : "";
  const offen = db.prepare("SELECT id FROM aenderung WHERE experiment_id = ? AND art = ? AND status IN ('offen', 'fehlgeschlagen')").all(id, art);
  if (!offen.length) return fehler(409, "There is nothing to reject here.");
  if (art === "titel" && db.prepare("SELECT 1 FROM aenderung WHERE experiment_id = ? AND art = 'titel' AND status = 'angewendet' LIMIT 1").get(id))
    return fehler(409, "Some titles are already live on eBay. Approve the rest, or close the test with “revert” to go back to the old titles.");
  db.transaction(() => {
    db.prepare("UPDATE aenderung SET status = 'abgelehnt', entschieden_von = ?, entschieden_at = ?, ergebnis = ? WHERE experiment_id = ? AND art = ? AND status IN ('offen', 'fehlgeschlagen')")
      .run(nutzer.name, jetzt.toISOString(), grund || "Rejected.", id, art);
    if (art === "titel") db.prepare("UPDATE experiment SET status = 'vorbereitet' WHERE id = ? AND status = 'freigabe'").run(id);
    protokoll.schreibe(db, { ...wer(nutzer), aktion: "change_rejected", objekt: `test ${id} (${art})`, details: { anzahl: offen.length, grund } }, jetzt);
  })();
  return ok({ id, abgelehnt: offen.length });
}

// ---------- When closing a test ----------
// "zurueck" (back): titles already changed get a reverting change for approval, those not yet changed are discarded.
// "behalten" (keep): open suggestions are discarded.
export function beimAbschluss(db, nutzer, id, abschluss, jetzt = new Date()) {
  db.transaction(() => {
    db.prepare("UPDATE aenderung SET status = 'verworfen', ergebnis = 'The test was closed before this change was approved.' WHERE experiment_id = ? AND status IN ('offen', 'fehlgeschlagen')").run(id);
    if (abschluss !== "zurueck") return;
    const live = db.prepare("SELECT * FROM aenderung WHERE experiment_id = ? AND art = 'titel' AND status = 'angewendet' ORDER BY id").all(id);
    const ins = db.prepare("INSERT INTO aenderung (experiment_id, number, item_id, art, alt, neu, status, vorgeschlagen_von, vorgeschlagen_at) VALUES (?, ?, ?, 'zurueck', ?, ?, 'offen', ?, ?)");
    for (const c of live) {
      // Only one reverting change per listing, even if the test were closed again later
      if (db.prepare("SELECT 1 FROM aenderung WHERE experiment_id = ? AND item_id = ? AND art = 'zurueck' LIMIT 1").get(id, c.item_id)) continue;
      ins.run(id, c.number, c.item_id, c.neu, c.alt, nutzer.name, jetzt.toISOString());
      protokoll.schreibe(db, { ...wer(nutzer), aktion: "revert_proposed", objekt: "item " + c.item_id, details: { test: id, number: c.number, von: c.neu, zu: c.alt } }, jetzt);
    }
  })();
}
