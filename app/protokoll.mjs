// Change log: who did what when, and what came of it.
// It is only appended to. The app can neither change nor delete entries (triggers in the database abort that).
// Whoever has direct access to the file daten/app.db could remove the triggers: the log is a proof
// inside the app, not tamper-proof evidence.
const MAX_DETAILS = 4000;

export function bereiteVor(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS protokoll (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      zeit TEXT NOT NULL,
      benutzer TEXT NOT NULL,       -- who triggered it ("system" for automatic runs)
      rolle TEXT,                   -- role at the time of the action
      aktion TEXT NOT NULL,         -- z. B. change_proposed, change_approved, ebay_changed, role_changed
      objekt TEXT,                  -- e.g. "item 1234567890" or "user anna"
      details TEXT,                 -- JSON (old and new value, eBay answer ...)
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
