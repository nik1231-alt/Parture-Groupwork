// Tests (the loop from the briefing): group comparison with a control group by lot.
//   1. Draw by lot:  The app draws N listings from the area "Low impressions" and splits them randomly into a test group and
//                    a control group (half each). Only the test group gets the change.
//   2. One lever:    Title and search terms. A human enters the new title for each test listing (the app invents none).
//   3. Start:        Old title, new title, date and the starting figures of both groups are recorded (log).
//   4. Wait:         Default 30 days and a minimum amount of impressions.
//   5. Verdict:      Test group against control group, as a group. Better / no difference proven / worse,
//                    with sales as a safety figure (more impressions must not cost sales).
//   6. Closing:      Keep (new base) or back to the old titles.
// Rules from the briefing: a listing is only ever in one test; equally long windows before and after;
// "no difference proven" counts like "not better" (back to the base).
// The app changes titles on eBay only after approval by an admin (see freigabe.mjs). Status "freigabe": the suggestion waits for the admin.
// The app logs and calculates.
import crypto from "node:crypto";
import { bewerte, leiteSchwellenAb, EINSTELLUNGEN, TITEL_MAX_ZEICHEN } from "./regeln.mjs";
import { baueAuswertung } from "./auswertung.mjs";

export const ABSCHLUSS = ["behalten", "zurueck"];
const HYPOTHESE = "A better title and better search terms raise the impressions of a listing without lowering its sales.";
const MAX_NAME = 60;
const EPS = 1e-9;

export function bereiteVor(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS experiment (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL, hebel TEXT NOT NULL, hypothese TEXT NOT NULL,
      status TEXT NOT NULL,                    -- vorbereitet | freigabe | laeuft | abgeschlossen
      seed INTEGER NOT NULL,                   -- Random number of the draw (so that the drawing stays traceable)
      erstellt_at TEXT NOT NULL, gestartet_at TEXT, abschluss TEXT, abschluss_at TEXT
    );
    CREATE TABLE IF NOT EXISTS experiment_angebot (
      experiment_id INTEGER NOT NULL, number TEXT NOT NULL,
      gruppe TEXT NOT NULL,                    -- test | kontrolle
      alt TEXT NOT NULL, neu TEXT,             -- Title at the draw / new title (test group only)
      imp30 INTEGER, auf30 INTEGER, trans30 INTEGER,  -- Starting figures at the start
      PRIMARY KEY (experiment_id, number)
    );
  `);
}

const fehler = (status, text) => ({ ok: false, status, fehler: text });
const wert = (p) => ({ imp: Number(p.impressionen_30d) || 0, auf: Number(p.aufrufe_30d) || 0, trans: Number(p.transaktionen_30d) || 0 });
const leer = () => ({ imp: 0, auf: 0, trans: 0 });
const addiere = (a, b) => ({ imp: a.imp + b.imp, auf: a.auf + b.auf, trans: a.trans + b.trans });
const verhaeltnis = (vorher, nachher) => (vorher > 0 ? nachher / vorher : nachher > 0 ? Infinity : 1);
const endlich = (x) => (Number.isFinite(x) ? x : null);

// ---------- Draw ----------
function mulberry32(start) {
  let a = start >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// Draws n listings and splits them randomly, half each, into test and kontrolle. Same seed = same draw.
// Duplicate numbers among the candidates count only once (otherwise a listing could end up in both groups).
// With an odd number the control group has one more: the groups never differ by more than 1.
export function ziehe(kandidaten, n, seed) {
  const eindeutig = [...new Map(kandidaten.map((p) => [String(p.number), p])).values()];
  const liste = eindeutig.sort((a, b) => (String(a.number) < String(b.number) ? -1 : String(a.number) > String(b.number) ? 1 : 0)); // feste Ausgangsreihenfolge
  const zufall = mulberry32(seed);
  for (let i = liste.length - 1; i > 0; i--) { const j = Math.floor(zufall() * (i + 1)); [liste[i], liste[j]] = [liste[j], liste[i]]; }
  const gezogen = liste.slice(0, n);
  // F5, matched pairs: the drawn listings sorted by impressions in 90 days, neighbours form a pair and a seeded coin decides which
  // one of each pair is tested. Both groups then contain one listing of every size class, so a strong listing cannot land in one
  // group by chance. Ties by number, so the input order still does not matter. Odd number: the last one goes to the control group.
  const nr = (p) => String(p.number);
  const sortiert = [...gezogen].sort((a, b) => (Number(b.impressionen_90d) || 0) - (Number(a.impressionen_90d) || 0) || (nr(a) < nr(b) ? -1 : nr(a) > nr(b) ? 1 : 0));
  const test = [], kontrolle = [];
  for (let i = 0; i + 1 < sortiert.length; i += 2) {
    const [t, k] = zufall() < 0.5 ? [sortiert[i], sortiert[i + 1]] : [sortiert[i + 1], sortiert[i]];
    test.push(t); kontrolle.push(k);
  }
  if (sortiert.length % 2) kontrolle.push(sortiert[sortiert.length - 1]);
  return { test, kontrolle };
}

// Block list (table "sperre" in pm.db, comes from the hub): listings of a running price experiment in the shop must not go into any title test,
// otherwise nobody would know whether the title or the price worked. zeilen: [{ number, bis }] (see bewertung.ladeSperre, where
// eBay item numbers are already mapped to product numbers). bis = last blocked day (ISO date); empty = unlimited.
// An unreadable date keeps blocking (better one listing too few in the draw than one in the wrong experiment).
export function gesperrteNummern(zeilen, jetzt = new Date()) {
  const heute = jetzt.toISOString().slice(0, 10);
  const aktiv = (bis) => { const b = String(bis ?? "").trim(); return !b || !/^\d{4}-\d{2}-\d{2}/.test(b) || b.slice(0, 10) >= heute; };
  return new Set((zeilen || []).filter((z) => z?.number != null && String(z.number) !== "" && aktiv(z.bis)).map((z) => String(z.number)));
}

// Listings that are currently in an unfinished test: Map(number -> { id, gruppe, status })
export function imTest(db) {
  const zeilen = db.prepare("SELECT ea.number, ea.gruppe, e.id, e.status FROM experiment_angebot ea JOIN experiment e ON e.id = ea.experiment_id WHERE e.status != 'abgeschlossen'").all();
  return new Map(zeilen.map((r) => [r.number, { id: r.id, gruppe: r.gruppe, status: r.status }]));
}

// Listings that qualify for a new test today (Low impressions, in no test, not blocked).
// gesperrt: Set of the product numbers from gesperrteNummern (empty if the block list is missing).
export function kandidaten(db, produkte, einst = EINSTELLUNGEN, jetzt = new Date(), gesperrt = new Set()) {
  const abgeleitet = leiteSchwellenAb(produkte, einst, jetzt);
  const belegt = imTest(db);
  // ebay_aktiv === 0: no running eBay listing (ended), the title could not be changed. null = unknown (data without the table kanal).
  return produkte.filter((p) => !belegt.has(p.number) && !gesperrt.has(String(p.number)) && p.ebay_aktiv !== 0 && bewerte(p, abgeleitet, jetzt).gruppe === "sichtbarkeit");
}

// ---------- Anlegen ----------
// The seed is stored in experiment.seed and returned (the server writes it to the log): with the same candidates
// the same seed gives the same draw, so the draw can be checked.
export function legeAn(db, eingabe, produkte, einst = EINSTELLUNGEN, jetzt = new Date(), seed = crypto.randomInt(1, 2147483646), gesperrt = new Set()) {
  if (eingabe != null && (typeof eingabe !== "object" || Array.isArray(eingabe))) return fehler(400, "Invalid request.");
  if (eingabe?.name !== undefined && typeof eingabe.name !== "string") return fehler(400, "The name must be text.");
  const name = (eingabe?.name ?? "").trim();
  if (name.length > MAX_NAME) return fehler(400, `The name is too long (at most ${MAX_NAME} characters).`);
  const n = einst.testGroesse;
  const frei = kandidaten(db, produkte, einst, jetzt, gesperrt);
  if (frei.length < n) return fehler(409, `Not enough listings for a test: ${frei.length} available, ${n} needed. Lower the test size in Settings, or wait until more listings are flagged.`);
  const { test, kontrolle } = ziehe(frei, n, seed);
  const schreibe = db.transaction(() => {
    const r = db.prepare("INSERT INTO experiment (name, hebel, hypothese, status, seed, erstellt_at) VALUES (?, 'titel', ?, 'vorbereitet', ?, ?)").run(name || "tmp", HYPOTHESE, seed, jetzt.toISOString());
    const id = Number(r.lastInsertRowid);
    if (!name) db.prepare("UPDATE experiment SET name = ? WHERE id = ?").run(`Title test #${id}`, id);
    const ins = db.prepare("INSERT INTO experiment_angebot (experiment_id, number, gruppe, alt) VALUES (?, ?, ?, ?)");
    for (const p of test) ins.run(id, p.number, "test", String(p.title ?? ""));
    for (const p of kontrolle) ins.run(id, p.number, "kontrolle", String(p.title ?? ""));
    return id;
  });
  return { ok: true, wert: { id: schreibe(), seed, test: test.length, kontrolle: kontrolle.length, gesperrt: gesperrt.size } };
}

const lade = (db, id) => db.prepare("SELECT * FROM experiment WHERE id = ?").get(id);
const pruefeId = (id) => Number.isInteger(id) && id >= 1;

// ---------- Enter a new title ----------
// Only in the status "vorbereitet" (prepared): after "Send for approval" (status "freigabe") the suggestion is locked (409), so that the admin
// approves exactly what he saw. If he rejects it, the test goes back to "vorbereitet" and the titles are open again.
// The third parameter (settings) is no longer needed: the title length is fixed (TITEL_MAX_ZEICHEN).
export function setzeTitel(db, eingabe) {
  if (!eingabe || typeof eingabe !== "object" || Array.isArray(eingabe)) return fehler(400, "Invalid request.");
  const { id, number, neu } = eingabe;
  if (!pruefeId(id)) return fehler(400, "Invalid test id.");
  if (typeof number !== "string" || !number || number.length > 40) return fehler(400, "Product number is missing or invalid.");
  if (typeof neu !== "string") return fehler(400, "The new title must be text.");
  const titel = neu.replace(/\s+/g, " ").trim();
  if (!titel) return fehler(400, "Please enter the new title.");
  if (titel.length > TITEL_MAX_ZEICHEN) return fehler(400, `The title is too long (${titel.length} of at most ${TITEL_MAX_ZEICHEN} characters).`);
  if (/[\u0000-\u001f\u007f]/.test(titel)) return fehler(400, "The title contains invalid characters.");
  const e = lade(db, id);
  if (!e) return fehler(404, "Test not found.");
  if (e.status !== "vorbereitet") return fehler(409, "Titles can only be entered before the test starts.");
  const a = db.prepare("SELECT * FROM experiment_angebot WHERE experiment_id = ? AND number = ?").get(id, number);
  if (!a) return fehler(404, "This listing is not part of the test.");
  if (a.gruppe !== "test") return fehler(409, "Control listings stay unchanged: no new title for them.");
  if (titel === a.alt.replace(/\s+/g, " ").trim()) return fehler(400, "The new title is the same as the old one.");
  db.prepare("UPDATE experiment_angebot SET neu = ? WHERE experiment_id = ? AND number = ?").run(titel, id, number);
  return { ok: true, wert: { id, number, neu: titel } };
}

// ---------- Starten ----------
export function starte(db, eingabe, produkte, jetzt = new Date(), erlaubterStatus = "vorbereitet") {
  if (!eingabe || typeof eingabe !== "object" || Array.isArray(eingabe)) return fehler(400, "Invalid request.");
  if (!pruefeId(eingabe.id)) return fehler(400, "Invalid test id.");
  const e = lade(db, eingabe.id);
  if (!e) return fehler(404, "Test not found.");
  if (e.status !== erlaubterStatus) return fehler(409, "This test has already started or is closed.");
  const angebote = db.prepare("SELECT * FROM experiment_angebot WHERE experiment_id = ?").all(e.id);
  const ohneTitel = angebote.filter((a) => a.gruppe === "test" && !a.neu).length;
  if (ohneTitel) return fehler(409, `${ohneTitel} of ${angebote.filter((a) => a.gruppe === "test").length} test listings still need a new title.`);
  const aktuell = new Map(produkte.map((p) => [p.number, p]));
  if (angebote.some((a) => !aktuell.has(a.number))) return fehler(409, "Some listings are no longer in the data. Discard this test and draw a new one.");
  const belegt = db.prepare("SELECT 1 FROM experiment_angebot ea JOIN experiment x ON x.id = ea.experiment_id WHERE x.status = 'laeuft' AND ea.number IN (" + angebote.map(() => "?").join(",") + ") LIMIT 1").get(...angebote.map((a) => a.number));
  if (belegt) return fehler(409, "A listing of this test is already in a running test.");
  const schreibe = db.transaction(() => {
    const up = db.prepare("UPDATE experiment_angebot SET imp30 = ?, auf30 = ?, trans30 = ? WHERE experiment_id = ? AND number = ?");
    for (const a of angebote) { const w = wert(aktuell.get(a.number)); up.run(w.imp, w.auf, w.trans, e.id, a.number); }
    db.prepare("UPDATE experiment SET status = 'laeuft', gestartet_at = ? WHERE id = ?").run(jetzt.toISOString(), e.id);
  });
  schreibe();
  return { ok: true, wert: { id: e.id } };
}

// ---------- Closing ----------
export function schliesse(db, eingabe, jetzt = new Date()) {
  if (!eingabe || typeof eingabe !== "object" || Array.isArray(eingabe)) return fehler(400, "Invalid request.");
  const { id, abschluss } = eingabe;
  if (!pruefeId(id)) return fehler(400, "Invalid test id.");
  if (typeof abschluss !== "string" || !ABSCHLUSS.includes(abschluss)) return fehler(400, "Unknown outcome.");
  const e = lade(db, id);
  if (!e) return fehler(404, "Test not found.");
  if (e.status === "abgeschlossen") return fehler(409, "This test is already closed.");
  db.prepare("UPDATE experiment SET status = 'abgeschlossen', abschluss = ?, abschluss_at = ? WHERE id = ?").run(abschluss, jetzt.toISOString(), id);
  return { ok: true, wert: { id, abschluss } };
}

// ---------- Urteil (reine Funktion) ----------
// test / kontrolle: { vorher, nachher }, each { imp, auf, trans } as the sum of the group.
export function urteile(test, kontrolle, einst = EINSTELLUNGEN) {
  const netto = (feld) => {
    const eigen = verhaeltnis(test.vorher[feld], test.nachher[feld]);
    let ctrl = verhaeltnis(kontrolle.vorher[feld], kontrolle.nachher[feld]);
    if (!Number.isFinite(ctrl) || ctrl === 0) ctrl = 1; // without a usable control the raw change counts
    return eigen / ctrl - 1;
  };
  const p = netto("imp");
  const s = netto("trans");
  // A small tolerance, because e.g. 1200/1000 - 1 gives 0.19999999999999996 in the computer and the limit would otherwise be narrowly missed
  const schutzOk = test.vorher.trans === 0 ? true : s >= -einst.schutzGrenze - EPS;
  const aus = (urteil, empfehlung) => ({
    urteil, empfehlung,
    primaer: { netto: endlich(p) }, schutz: { netto: endlich(s), ok: schutzOk },
    test: { vorher: test.vorher, nachher: test.nachher }, kontrolle: { vorher: kontrolle.vorher, nachher: kontrolle.nachher },
  });
  if (test.nachher.imp < einst.mindestImpressionen30) return aus("not_enough_data", "revert");
  if (p >= einst.besserAb - EPS && schutzOk) return aus("better", "keep");
  if (p <= -einst.besserAb + EPS || !schutzOk) return aus("worse", "revert");
  return aus("no_difference", "revert"); // "kein Unterschied belegt" zählt wie "nicht besser"
}

// ---------- Auswertung ----------
const statusVon = (e, tage, einst) => (e.status === "abgeschlossen" ? "closed" : e.status === "vorbereitet" ? "prepared" : e.status === "freigabe" ? "approval" : tage < einst.pruefungNachTagen ? "running" : "ready");

function baueDetail(e, angebote, aktuell, jetzt, einst) {
  const tage = e.gestartet_at ? Math.floor((jetzt.getTime() - Date.parse(e.gestartet_at)) / 86400000) : null;
  const status = statusVon(e, tage, einst);
  const bereitAm = e.gestartet_at ? new Date(Date.parse(e.gestartet_at) + einst.pruefungNachTagen * 86400000).toISOString().slice(0, 10) : null;
  const zeilen = angebote.map((a) => {
    const p = aktuell.get(a.number);
    const vorher = a.imp30 == null ? null : { imp: a.imp30, auf: a.auf30, trans: a.trans30 };
    return { number: a.number, gruppe: a.gruppe, alt: a.alt, neu: a.neu, titelJetzt: p?.title ?? null, bild: p?.image_url ?? null, preis: p?.avg_price ?? null, vorher, nachher: p ? wert(p) : null };
  });
  let urteil = null;
  if (status === "ready" || status === "closed") {
    // Only listings that are still in the data and whose starting figures exist
    const summe = (g) => zeilen.filter((z) => z.gruppe === g && z.vorher && z.nachher).reduce((s, z) => ({ vorher: addiere(s.vorher, z.vorher), nachher: addiere(s.nachher, z.nachher) }), { vorher: leer(), nachher: leer() });
    if (e.gestartet_at) urteil = urteile(summe("test"), summe("kontrolle"), einst);
  }
  return {
    id: e.id, name: e.name, hebel: e.hebel, hypothese: e.hypothese, seed: e.seed, status, abschluss: e.abschluss, abschluss_at: e.abschluss_at,
    erstellt_at: e.erstellt_at, gestartet_at: e.gestartet_at, tage, bereit_am: bereitAm, pruefungNachTagen: einst.pruefungNachTagen,
    anzahl: { test: zeilen.filter((z) => z.gruppe === "test").length, kontrolle: zeilen.filter((z) => z.gruppe === "kontrolle").length, titel: zeilen.filter((z) => z.gruppe === "test" && z.neu).length },
    angebote: zeilen, urteil,
    // Figures for the charts (only after the start; before the waiting time is over only an interim state)
    auswertung: e.gestartet_at ? baueAuswertung(zeilen, einst) : null,
  };
}

export function liste(db, produkte, jetzt = new Date(), einst = EINSTELLUNGEN) {
  const aktuell = new Map(produkte.map((p) => [p.number, p]));
  return db.prepare("SELECT * FROM experiment ORDER BY id DESC").all().map((e) => {
    const d = baueDetail(e, db.prepare("SELECT * FROM experiment_angebot WHERE experiment_id = ?").all(e.id), aktuell, jetzt, einst);
    const { angebote, auswertung, ...kopf } = d; // the list needs neither the single listings nor the chart data
    return kopf;
  });
}

export function detail(db, id, produkte, jetzt = new Date(), einst = EINSTELLUNGEN) {
  if (!pruefeId(id)) return fehler(400, "Invalid test id.");
  const e = lade(db, id);
  if (!e) return fehler(404, "Test not found.");
  const aktuell = new Map(produkte.map((p) => [p.number, p]));
  return { ok: true, wert: baueDetail(e, db.prepare("SELECT * FROM experiment_angebot WHERE experiment_id = ? ORDER BY gruppe DESC, number").all(id), aktuell, jetzt, einst) };
}
