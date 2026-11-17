// Änderungsprotokoll: wer hat wann was getan, und was ist dabei herausgekommen.
// Es wird nur angehängt. Die App kann Einträge weder ändern noch löschen (Trigger in der Datenbank brechen das ab).
// Wer direkten Zugriff auf die Datei daten/app.db hat, könnte die Trigger entfernen: Das Protokoll ist ein Nachweis
// innerhalb der App, kein manipulationssicherer Beleg.
const MAX_DETAILS = 4000;

export function bereiteVor(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS protokoll (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      zeit TEXT NOT NULL,
      benutzer TEXT NOT NULL,       -- wer es ausgelöst hat ("system" für automatische Läufe)
      rolle TEXT,                   -- Rolle zum Zeitpunkt der Aktion
      aktion TEXT NOT NULL,         -- z. B. change_proposed, change_approved, ebay_changed, role_changed
      objekt TEXT,                  -- z. B. "item 1234567890" oder "user anna"
      details TEXT,                 -- JSON (alter und neuer Wert, eBay-Antwort ...)
      ergebnis TEXT NOT NULL        -- ok | error | dry_run | refused
    );
    CREATE TRIGGER IF NOT EXISTS protokoll_kein_update BEFORE UPDATE ON protokoll BEGIN SELECT RAISE(ABORT, 'The log is append-only.'); END;
    CREATE TRIGGER IF NOT EXISTS protokoll_kein_delete BEFORE DELETE ON protokoll BEGIN SELECT RAISE(ABORT, 'The log is append-only.'); END;
  `);
}

export function schreibe(db, { benutzer, rolle = null, aktion, objekt = null, details = null, ergebnis = "ok" }, jetzt = new Date()) {
  let d = details == null ? null : JSON.stringify(details);
  if (d && d.length > MAX_DETAILS) d = JSON.stringify({ gekuerzt: d.slice(0, MAX_DETAILS) });
  db.prepare("INSERT INTO protokoll (zeit, benutzer, rolle, aktion, objekt, details, ergebnis) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(jetzt.toISOString(), String(benutzer), rolle, aktion, objekt, d, ergebnis);
}

export function liste(db, limit = 200) {
  const n = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 1000) : 200;
  return db.prepare("SELECT id, zeit, benutzer, rolle, aktion, objekt, details, ergebnis FROM protokoll ORDER BY id DESC LIMIT ?").all(n)
    .map((z) => { let d = null; try { d = z.details ? JSON.parse(z.details) : null; } catch { d = null; } return { ...z, details: d }; });
}
