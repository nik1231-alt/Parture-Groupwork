// Protokoll und Prüfung (die Schleife aus dem Briefing, soweit sie ohne eBay-Schreibzugriff geht):
//   Mensch setzt einen Vorschlag um -> App loggt alt/neu/Datum/Ausgangszahlen -> nach 30 Tagen vergleicht die App
//   das Angebot mit allen UNVERÄNDERTEN Angeboten -> Urteil: besser / kein Unterschied belegt / schlechter ->
//   Mensch entscheidet: behalten (neue Base) oder zurück auf den alten Wert.
// Regeln (aus dem Briefing): ein Angebot steckt immer nur in einem Test, Mindestmenge, Vergleich gegen eine
// Kontrollgruppe, Schutzkennzahl. "Kein Unterschied belegt" zählt wie "nicht besser": zurück zur Base.
// Ehrlich: Die Kontrollgruppe ist hier nicht gelost, sondern "alle anderen unveränderten Angebote". Das ist ein
// Näherungswert. Bei einem einzelnen Angebot ist das Urteil ein Hinweis, kein Beweis.
import { istNeu, EINSTELLUNGEN } from "./regeln.mjs";

// Hauptkennzahl und Schutzkennzahl je Hebel (Trichterstufe)
export const HEBEL = {
  titel: { primaer: "imp", schutz: "trans", primaerName: "impressions", schutzName: "sales", maxLaenge: null },
  bild: { primaer: "ctr", schutz: "trans", primaerName: "click rate", schutzName: "sales", maxLaenge: 2000 },
  angebot: { primaer: "conv", schutz: "auf", primaerName: "conversion", schutzName: "views", maxLaenge: 2000 },
};
export const ABSCHLUSS = ["behalten", "zurueck"];

export function bereiteVor(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS aenderung (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      number TEXT NOT NULL, hebel TEXT NOT NULL, alt TEXT NOT NULL, neu TEXT NOT NULL, hypothese TEXT NOT NULL,
      angelegt_at TEXT NOT NULL, imp30 INTEGER NOT NULL, auf30 INTEGER NOT NULL, trans30 INTEGER NOT NULL,
      abschluss TEXT, abschluss_at TEXT
    );
    CREATE TABLE IF NOT EXISTS momentaufnahme (
      datum TEXT NOT NULL, number TEXT NOT NULL, imp30 INTEGER NOT NULL, auf30 INTEGER NOT NULL, trans30 INTEGER NOT NULL,
      PRIMARY KEY (datum, number)
    );
  `);
}

const wert = (p) => ({ imp: Number(p.impressionen_30d) || 0, auf: Number(p.aufrufe_30d) || 0, trans: Number(p.transaktionen_30d) || 0 });
const metrik = (w, name) => (name === "ctr" ? (w.imp > 0 ? w.auf / w.imp : 0) : name === "conv" ? (w.auf > 0 ? w.trans / w.auf : 0) : w[name]);
const verhaeltnis = (vorher, nachher) => (vorher > 0 ? nachher / vorher : nachher > 0 ? Infinity : 1);
const endlich = (x) => (Number.isFinite(x) ? x : null);

const HYPOTHESE = {
  titel: "A better title raises impressions without lowering sales.",
  bild: "A better first photo raises the click rate without lowering sales.",
  angebot: "A fuller description raises the share of views that buy, without lowering views.",
};

// ---------- Anlegen ----------
// eingabe: { number, hebel, neu }. produkte: aktuelle Produkte (aus ladeProdukte). Gibt { ok, wert } oder { ok:false, status, fehler }.
export function legeAn(db, eingabe, produkte, jetzt = new Date(), einst = EINSTELLUNGEN) {
  const fehler = (status, text) => ({ ok: false, status, fehler: text });
  if (!eingabe || typeof eingabe !== "object" || Array.isArray(eingabe)) return fehler(400, "Invalid request.");
  const { number, hebel, neu } = eingabe;
  if (typeof number !== "string" || !number.trim() || number.length > 40) return fehler(400, "Product number is missing or invalid.");
  if (typeof hebel !== "string" || !Object.hasOwn(HEBEL, hebel)) return fehler(400, "Unknown lever.");
  if (typeof neu !== "string" || !neu.trim()) return fehler(400, "Please enter what you published.");
  const text = neu.replace(/\s+$/g, "").trim();
  const grenze = hebel === "titel" ? einst.titelMaxZeichen : HEBEL[hebel].maxLaenge;
  if (text.length > grenze) return fehler(400, `Text is too long (at most ${grenze} characters).`);
  const p = produkte.find((x) => x.number === number.trim());
  if (!p) return fehler(404, `Product ${number} not found.`);
  if (db.prepare("SELECT 1 FROM aenderung WHERE number = ? AND abschluss IS NULL").get(p.number)) return fehler(409, "This listing is already in a test. Close it first (one change at a time).");
  const alt = hebel === "titel" ? String(p.title || "") : hebel === "bild" ? String(p.image_url || "") : "(the previous description is not part of the data)";
  const w = wert(p);
  const datum = jetzt.toISOString().slice(0, 10);
  const schreibe = db.transaction(() => {
    // Ausgangszahlen ALLER Produkte an diesem Tag festhalten: sie bilden später die Vergleichsgruppe
    const ins = db.prepare("INSERT OR IGNORE INTO momentaufnahme (datum, number, imp30, auf30, trans30) VALUES (?, ?, ?, ?, ?)");
    for (const x of produkte) { const v = wert(x); ins.run(datum, x.number, v.imp, v.auf, v.trans); }
    const r = db.prepare("INSERT INTO aenderung (number, hebel, alt, neu, hypothese, angelegt_at, imp30, auf30, trans30) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(p.number, hebel, alt, text, HYPOTHESE[hebel], jetzt.toISOString(), w.imp, w.auf, w.trans);
    return Number(r.lastInsertRowid);
  });
  const id = schreibe();
  return { ok: true, wert: db.prepare("SELECT * FROM aenderung WHERE id = ?").get(id) };
}

export function schliesse(db, eingabe, jetzt = new Date()) {
  const fehler = (status, text) => ({ ok: false, status, fehler: text });
  if (!eingabe || typeof eingabe !== "object" || Array.isArray(eingabe)) return fehler(400, "Invalid request.");
  const { id, abschluss } = eingabe;
  if (!Number.isInteger(id) || id < 1) return fehler(400, "Invalid id.");
  if (typeof abschluss !== "string" || !ABSCHLUSS.includes(abschluss)) return fehler(400, "Unknown outcome.");
  const a = db.prepare("SELECT * FROM aenderung WHERE id = ?").get(id);
  if (!a) return fehler(404, "Change not found.");
  if (a.abschluss) return fehler(409, "This change is already closed.");
  db.prepare("UPDATE aenderung SET abschluss = ?, abschluss_at = ? WHERE id = ?").run(abschluss, jetzt.toISOString(), id);
  return { ok: true, wert: db.prepare("SELECT * FROM aenderung WHERE id = ?").get(id) };
}

// ---------- Urteil (reine Funktion) ----------
// vorher/nachher: { imp, auf, trans } des Angebots. kontrolle: { vorher, nachher } (Summen der unveränderten Angebote) oder null.
export function urteile(hebel, vorher, nachher, kontrolle, einst = EINSTELLUNGEN) {
  const h = HEBEL[hebel];
  const netto = (name) => {
    const eigen = verhaeltnis(metrik(vorher, name), metrik(nachher, name));
    let ctrl = kontrolle ? verhaeltnis(metrik(kontrolle.vorher, name), metrik(kontrolle.nachher, name)) : 1;
    if (!Number.isFinite(ctrl) || ctrl === 0) ctrl = 1; // ohne brauchbare Vergleichsgruppe zählt die Rohveränderung
    return eigen / ctrl - 1;
  };
  const p = netto(h.primaer);
  const s = netto(h.schutz);
  const schutzOk = metrik(vorher, h.schutz) === 0 ? true : s >= -einst.schutzGrenze;
  const ausgabe = (urteil, empfehlung) => ({
    urteil, empfehlung, mitKontrolle: !!kontrolle,
    primaer: { name: h.primaerName, vorher: metrik(vorher, h.primaer), nachher: metrik(nachher, h.primaer), netto: endlich(p) },
    schutz: { name: h.schutzName, vorher: metrik(vorher, h.schutz), nachher: metrik(nachher, h.schutz), netto: endlich(s), ok: schutzOk },
  });
  if (nachher.imp < einst.mindestImpressionen30) return ausgabe("not_enough_data", "revert");
  if (p >= einst.besserAb && schutzOk) return ausgabe("better", "keep");
  if (p <= -einst.besserAb || !schutzOk) return ausgabe("worse", "revert");
  return ausgabe("no_difference", "revert"); // "kein Unterschied belegt" zählt wie "nicht besser"
}

// ---------- Liste mit Prüfstatus ----------
export function liste(db, produkte, jetzt = new Date(), einst = EINSTELLUNGEN) {
  const aktuell = new Map(produkte.map((p) => [p.number, p]));
  const alle = db.prepare("SELECT * FROM aenderung ORDER BY id DESC").all();
  const veraendert = new Set(alle.map((a) => a.number));
  const aufnahmen = new Map(); // datum -> Map(number -> werte)
  const aufnahme = (datum) => {
    if (!aufnahmen.has(datum)) aufnahmen.set(datum, new Map(db.prepare("SELECT number, imp30, auf30, trans30 FROM momentaufnahme WHERE datum = ?").all(datum).map((r) => [r.number, { imp: r.imp30, auf: r.auf30, trans: r.trans30 }])));
    return aufnahmen.get(datum);
  };
  return alle.map((a) => {
    const angelegt = new Date(a.angelegt_at);
    const tage = Math.floor((jetzt.getTime() - angelegt.getTime()) / 86400000);
    const bereitAm = new Date(angelegt.getTime() + einst.pruefungNachTagen * 86400000).toISOString().slice(0, 10);
    const p = aktuell.get(a.number);
    const basis = { ...a, titel: p?.title ?? null, bild: p?.image_url ?? null, tage, bereit_am: bereitAm, pruefungNachTagen: einst.pruefungNachTagen };
    if (a.abschluss) return { ...basis, status: "closed" };
    if (tage < einst.pruefungNachTagen) return { ...basis, status: "running" };
    if (!p) return { ...basis, status: "ready", pruefung: null };
    // Vergleichsgruppe: alle Produkte, die heute und beim Start da waren, nie verändert wurden und beim Start nicht neu waren
    const start = aufnahme(a.angelegt_at.slice(0, 10));
    const stichtag = new Date(a.angelegt_at);
    const k = { vorher: { imp: 0, auf: 0, trans: 0 }, nachher: { imp: 0, auf: 0, trans: 0 } };
    let anzahl = 0;
    for (const [nr, v] of start) {
      const q = aktuell.get(nr);
      if (!q || veraendert.has(nr) || istNeu(q.created_at, stichtag, einst.schonfristTage)) continue;
      const n = wert(q);
      for (const f of ["imp", "auf", "trans"]) { k.vorher[f] += v[f]; k.nachher[f] += n[f]; }
      anzahl++;
    }
    const kontrolle = anzahl >= 20 ? k : null; // zu kleine Vergleichsgruppe zählt nicht
    const pruefung = urteile(a.hebel, { imp: a.imp30, auf: a.auf30, trans: a.trans30 }, wert(p), kontrolle, einst);
    return { ...basis, status: "ready", pruefung: { ...pruefung, vergleichsgruppe: anzahl } };
  });
}

// Welche Produkte stecken gerade in einem Test? (für die Produktliste)
export function laufende(db) {
  return new Map(db.prepare("SELECT id, number, hebel, angelegt_at FROM aenderung WHERE abschluss IS NULL").all().map((r) => [r.number, r]));
}
