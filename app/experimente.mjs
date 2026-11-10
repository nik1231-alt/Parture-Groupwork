// Tests (die Schleife aus dem Briefing): Gruppenvergleich mit Kontrollgruppe per Los.
//   1. Los ziehen:  Die App zieht N Angebote aus dem Bereich "Low impressions" und teilt sie zufällig in Testgruppe und
//                   Kontrollgruppe (je zur Hälfte). Nur die Testgruppe bekommt die Änderung.
//   2. Ein Hebel:   Titel und Suchbegriffe. Der Mensch trägt je Testangebot den neuen Titel ein (die App erfindet keinen).
//   3. Starten:     Alter Titel, neuer Titel, Datum und die Ausgangszahlen beider Gruppen werden festgehalten (Protokoll).
//   4. Warten:      Standard 30 Tage und eine Mindestmenge an Impressionen.
//   5. Urteil:      Testgruppe gegen Kontrollgruppe, als Gruppe. Besser / kein Unterschied belegt / schlechter,
//                   mit den Verkäufen als Schutzkennzahl (mehr Impressionen dürfen keine Verkäufe kosten).
//   6. Abschluss:   Behalten (neue Base) oder zurück auf die alten Titel.
// Regeln aus dem Briefing: ein Angebot steckt immer nur in einem Test; gleich lange Fenster vorher und nachher;
// "kein Unterschied belegt" zählt wie "nicht besser" (zurück zur Base).
// Die App ändert nichts auf eBay: Das macht ein Mensch. Die App protokolliert und rechnet.
import crypto from "node:crypto";
import { bewerte, leiteSchwellenAb, EINSTELLUNGEN } from "./regeln.mjs";

export const ABSCHLUSS = ["behalten", "zurueck"];
const HYPOTHESE = "A better title and better search terms raise the impressions of a listing without lowering its sales.";
const MAX_NAME = 60;
const EPS = 1e-9;

export function bereiteVor(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS experiment (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL, hebel TEXT NOT NULL, hypothese TEXT NOT NULL,
      status TEXT NOT NULL,                    -- vorbereitet | laeuft | abgeschlossen
      seed INTEGER NOT NULL,                   -- Zufallszahl des Loses (damit die Ziehung nachvollziehbar bleibt)
      erstellt_at TEXT NOT NULL, gestartet_at TEXT, abschluss TEXT, abschluss_at TEXT
    );
    CREATE TABLE IF NOT EXISTS experiment_angebot (
      experiment_id INTEGER NOT NULL, number TEXT NOT NULL,
      gruppe TEXT NOT NULL,                    -- test | kontrolle
      alt TEXT NOT NULL, neu TEXT,             -- Titel beim Los / neuer Titel (nur Testgruppe)
      imp30 INTEGER, auf30 INTEGER, trans30 INTEGER,  -- Ausgangszahlen beim Start
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

// ---------- Los ----------
function mulberry32(start) {
  let a = start >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// Zieht n Angebote und teilt sie zufällig je zur Hälfte in test und kontrolle. Gleicher seed = gleiche Ziehung.
export function ziehe(kandidaten, n, seed) {
  const liste = [...kandidaten].sort((a, b) => (a.number < b.number ? -1 : a.number > b.number ? 1 : 0)); // feste Ausgangsreihenfolge
  const zufall = mulberry32(seed);
  for (let i = liste.length - 1; i > 0; i--) { const j = Math.floor(zufall() * (i + 1)); [liste[i], liste[j]] = [liste[j], liste[i]]; }
  const gezogen = liste.slice(0, n);
  return { test: gezogen.slice(0, n / 2), kontrolle: gezogen.slice(n / 2) };
}

// Angebote, die gerade in einem nicht abgeschlossenen Test stecken: Map(number -> { id, gruppe, status })
export function imTest(db) {
  const zeilen = db.prepare("SELECT ea.number, ea.gruppe, e.id, e.status FROM experiment_angebot ea JOIN experiment e ON e.id = ea.experiment_id WHERE e.status != 'abgeschlossen'").all();
  return new Map(zeilen.map((r) => [r.number, { id: r.id, gruppe: r.gruppe, status: r.status }]));
}

// Anzahl der Angebote, die heute für einen neuen Test infrage kommen (Low impressions und in keinem Test)
export function kandidaten(db, produkte, einst = EINSTELLUNGEN, jetzt = new Date()) {
  const abgeleitet = leiteSchwellenAb(produkte, einst, jetzt);
  const belegt = imTest(db);
  return produkte.filter((p) => !belegt.has(p.number) && bewerte(p, abgeleitet, jetzt).gruppe === "sichtbarkeit");
}

// ---------- Anlegen ----------
export function legeAn(db, eingabe, produkte, einst = EINSTELLUNGEN, jetzt = new Date(), seed = crypto.randomInt(1, 2147483646)) {
  if (eingabe != null && (typeof eingabe !== "object" || Array.isArray(eingabe))) return fehler(400, "Invalid request.");
  if (eingabe?.name !== undefined && typeof eingabe.name !== "string") return fehler(400, "The name must be text.");
  const name = (eingabe?.name ?? "").trim();
  if (name.length > MAX_NAME) return fehler(400, `The name is too long (at most ${MAX_NAME} characters).`);
  const n = einst.testGroesse;
  const frei = kandidaten(db, produkte, einst, jetzt);
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
  return { ok: true, wert: { id: schreibe() } };
}

const lade = (db, id) => db.prepare("SELECT * FROM experiment WHERE id = ?").get(id);
const pruefeId = (id) => Number.isInteger(id) && id >= 1;

// ---------- Neuen Titel eintragen ----------
export function setzeTitel(db, eingabe, einst = EINSTELLUNGEN) {
  if (!eingabe || typeof eingabe !== "object" || Array.isArray(eingabe)) return fehler(400, "Invalid request.");
  const { id, number, neu } = eingabe;
  if (!pruefeId(id)) return fehler(400, "Invalid test id.");
  if (typeof number !== "string" || !number || number.length > 40) return fehler(400, "Product number is missing or invalid.");
  if (typeof neu !== "string") return fehler(400, "The new title must be text.");
  const titel = neu.replace(/\s+/g, " ").trim();
  if (!titel) return fehler(400, "Please enter the new title.");
  if (titel.length > einst.titelMaxZeichen) return fehler(400, `The title is too long (${titel.length} of at most ${einst.titelMaxZeichen} characters).`);
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
export function starte(db, eingabe, produkte, jetzt = new Date()) {
  if (!eingabe || typeof eingabe !== "object" || Array.isArray(eingabe)) return fehler(400, "Invalid request.");
  if (!pruefeId(eingabe.id)) return fehler(400, "Invalid test id.");
  const e = lade(db, eingabe.id);
  if (!e) return fehler(404, "Test not found.");
  if (e.status !== "vorbereitet") return fehler(409, "This test has already started or is closed.");
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

// ---------- Abschließen ----------
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
// test / kontrolle: { vorher, nachher }, jeweils { imp, auf, trans } als Summe der Gruppe.
export function urteile(test, kontrolle, einst = EINSTELLUNGEN) {
  const netto = (feld) => {
    const eigen = verhaeltnis(test.vorher[feld], test.nachher[feld]);
    let ctrl = verhaeltnis(kontrolle.vorher[feld], kontrolle.nachher[feld]);
    if (!Number.isFinite(ctrl) || ctrl === 0) ctrl = 1; // ohne brauchbare Kontrolle zählt die Rohveränderung
    return eigen / ctrl - 1;
  };
  const p = netto("imp");
  const s = netto("trans");
  // Kleine Toleranz, weil z. B. 1200/1000 - 1 im Computer 0,19999999999999996 ergibt und die Grenze sonst knapp verfehlt würde
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
const statusVon = (e, tage, einst) => (e.status === "abgeschlossen" ? "closed" : e.status === "vorbereitet" ? "prepared" : tage < einst.pruefungNachTagen ? "running" : "ready");

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
    // Nur Angebote, die noch in den Daten sind und deren Ausgangszahlen vorliegen
    const summe = (g) => zeilen.filter((z) => z.gruppe === g && z.vorher && z.nachher).reduce((s, z) => ({ vorher: addiere(s.vorher, z.vorher), nachher: addiere(s.nachher, z.nachher) }), { vorher: leer(), nachher: leer() });
    if (e.gestartet_at) urteil = urteile(summe("test"), summe("kontrolle"), einst);
  }
  return {
    id: e.id, name: e.name, hebel: e.hebel, hypothese: e.hypothese, seed: e.seed, status, abschluss: e.abschluss, abschluss_at: e.abschluss_at,
    erstellt_at: e.erstellt_at, gestartet_at: e.gestartet_at, tage, bereit_am: bereitAm, pruefungNachTagen: einst.pruefungNachTagen,
    anzahl: { test: zeilen.filter((z) => z.gruppe === "test").length, kontrolle: zeilen.filter((z) => z.gruppe === "kontrolle").length, titel: zeilen.filter((z) => z.gruppe === "test" && z.neu).length },
    angebote: zeilen, urteil,
  };
}

export function liste(db, produkte, jetzt = new Date(), einst = EINSTELLUNGEN) {
  const aktuell = new Map(produkte.map((p) => [p.number, p]));
  return db.prepare("SELECT * FROM experiment ORDER BY id DESC").all().map((e) => {
    const d = baueDetail(e, db.prepare("SELECT * FROM experiment_angebot WHERE experiment_id = ?").all(e.id), aktuell, jetzt, einst);
    const { angebote, ...kopf } = d; // die Liste braucht die einzelnen Angebote nicht
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
