import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { ladeProdukte, baueBewertung, ladeImpressionenProTag } from './bewertung.mjs';
import { conversion } from './regeln.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { bereiteVor, legeBenutzerAn } from './login.mjs';

function fixture() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE produkt (number TEXT, title TEXT, image_url TEXT, created_at TEXT, units_90d INTEGER);
    CREATE TABLE kanal (number TEXT, channel TEXT, external_id TEXT, listed INTEGER, title TEXT, preis_aktuell REAL, units_total INTEGER, units_90d INTEGER, last_sold_at TEXT);
    CREATE TABLE traffic (number TEXT, item_id TEXT, tage INTEGER, impressionen INTEGER, aufrufe INTEGER, transaktionen INTEGER);
    CREATE TABLE traffic_tag (number TEXT, item_id TEXT, datum TEXT, impressionen INTEGER);
    INSERT INTO produkt VALUES ('A','Catalogue',NULL,'2020-01-01',9999), ('B','Amazon only',NULL,'2020-01-01',99999);
    INSERT INTO kanal VALUES
      ('A','ebay','E1',1,'eBay title',10,20,4,'2026-10-01'),
      ('A','ebay','E2',1,'eBay title',20,10,2,'2026-10-02'),
      ('A','amazon','X1',1,'Amazon title',100,9999,9999,'2026-11-01'),
      ('A','ebay-ali','X2',1,'Other account',100,9999,9999,'2026-11-01'),
      ('B','amazon','B1',1,'Amazon only',100,99999,99999,'2026-11-01');
    INSERT INTO traffic VALUES
      ('A','E1',90,1000,100,4), ('A','E2',90,500,50,2),
      ('A','E1',30,300,30,1),
      ('A','X1',90,999999,99999,999), ('A','X1',30,999999,99999,999),
      ('A','X2',90,999999,99999,999), ('A','unknown',90,999999,99999,999),
      ('B','E1',90,999999,99999,999);
    INSERT INTO traffic_tag VALUES
      ('A','E1','2026-10-02',100), ('A','E2','2026-10-02',50),
      ('A','X1','2026-10-02',99999), ('A','unknown','2026-10-02',99999),
      ('B','E1','2026-10-02',99999);
  `);
  return db;
}

test('Analysis: eBay only; foreign and unassigned traffic ids and foreign product assignment excluded', () => {
  const db = fixture();
  try {
    const ps = ladeProdukte(db);
    assert.equal(ps.length, 1);
    const p = ps[0];
    assert.equal(p.title, 'eBay title');
    assert.equal(p.units_90d, 6);
    assert.equal(p.units_total, 30);
    assert.equal(p.avg_price, 15);
    assert.equal(p.last_sold_at, '2026-10-02');
    assert.equal(p.impressionen_90d, 1500);
    assert.equal(p.aufrufe_90d, 150);
    assert.equal(p.transaktionen_30d, 1);
    assert.equal(conversion(p), 0.04);
    assert.equal(ladeImpressionenProTag(db, 'A', '2026-10-01', '2026-10-03'), 75);
    assert.equal(ladeImpressionenProTag(db, 'B', '2026-10-01', '2026-10-03'), 0);
    const vorher = baueBewertung(ps);
    db.exec("UPDATE kanal SET units_90d=1000000, units_total=1000000, preis_aktuell=1000000 WHERE channel != 'ebay'; UPDATE produkt SET units_90d=1000000; UPDATE traffic SET impressionen=1000000 WHERE item_id LIKE 'X%'");
    assert.deepEqual(baueBewertung(ladeProdukte(db)), vorher);
  } finally { db.close(); }
});

test('Missing eBay assignment or figures: no fallback to the whole catalogue', () => {
  const db = fixture();
  try {
    db.exec("UPDATE kanal SET units_90d=NULL WHERE channel='ebay'");
    assert.equal(ladeProdukte(db)[0].units_90d, null);
    assert.equal(conversion(ladeProdukte(db)[0]), null);
    db.exec('DROP TABLE kanal');
    assert.deepEqual(ladeProdukte(db), []);
    assert.equal(ladeImpressionenProTag(db, 'A', '2026-10-01', '2026-10-03'), 0);
  } finally { db.close(); }
});

test('Missing traffic table: unknown instead of invented performance', () => {
  const db = fixture();
  try {
    db.exec('DROP TABLE traffic; DROP TABLE traffic_tag');
    assert.equal(ladeProdukte(db)[0].impressionen_90d, null);
    assert.equal(ladeImpressionenProTag(db, 'A', '2026-10-01', '2026-10-03'), 0);
  } finally { db.close(); }
});

test('HTTP: lists, detail, diagnosis and traffic are eBay-only; channels stay a reference', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'parture-scope-'));
  const pm = path.join(dir, 'pm.db'), app = path.join(dir, 'app.db');
  const db = fixture();
  db.exec("ALTER TABLE kanal ADD COLUMN kanal_status TEXT; CREATE TABLE bild (number TEXT, url TEXT, position INTEGER, kind TEXT)");
  await db.backup(pm); db.close();
  const users = new Database(app); bereiteVor(users); legeBenutzerAn(users, 'tester', 'scope-test-password'); users.close();
  const port = 18000 + Math.floor(Math.random() * 1000), base = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, [path.join(import.meta.dirname, 'server.mjs')], {
    env: { ...process.env, PM_OHNE_ENV: '1', PM_PORT: String(port), PM_DB: pm, PM_APPDB: app,
      LEITER_AUTO: 'aus', SICHERUNG_AUTO: 'aus', EBAY_TRAFFIC_AUTO: '', CF_ACCESS_TEAM_DOMAIN: '', CF_ACCESS_AUD: '' }, stdio: 'ignore',
  });
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      try { if ((await fetch(base + '/healthz')).ok) { ready = true; break; } } catch {}
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(ready, 'test server ready');
    const login = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'tester', passwort: 'scope-test-password' }) });
    assert.equal(login.status, 200);
    const headers = { Cookie: login.headers.get('set-cookie').split(';')[0] };
    const get = async (url) => { const r = await fetch(base + url, { headers }); assert.equal(r.status, 200); return (await r.json()).daten; };
    const listings = await get('/api/produkte');
    assert.deepEqual(listings.map((p) => p.number), ['A']);
    assert.equal(listings[0].units_90d, 6);
    assert.deepEqual(await get('/api/produkte?q=Amazon'), []);
    const detail = await get('/api/produkt?nr=A');
    assert.equal(detail.units_90d, 6);
    assert.equal(detail.kanaele.find((k) => k.channel === 'amazon').units_90d, 9999);
    assert.equal((await fetch(base + '/api/produkt?nr=B', { headers })).status, 404);
    assert.equal((await get('/api/bewertung')).produkte[0].conversion, 0.04);
    assert.deepEqual(await get('/api/traffic'), [
      { tage: 30, impressionen: 300, aufrufe: 30, transaktionen: 1 },
      { tage: 90, impressionen: 1500, aufrufe: 150, transaktionen: 6 },
    ]);
  } finally {
    if (server.exitCode === null) { const exit = new Promise((r) => server.once('exit', r)); server.kill(); await exit; }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
