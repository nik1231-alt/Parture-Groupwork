// Tests für den Wächter (app/waechter.mjs): Ausrollen mit Testschranke, Rückfall bei durchgefallenen Tests, Blockaden,
// Geheimnisse bleiben aus dem Testlauf, und der ganze Prozess (Start, Auto-Deploy, Absturz, hängende App).
// Alles in temporären Ordnern mit lokalen Git-Repos, ohne Netz.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { aktualisiere, leseStatus } from "./waechter.mjs";

const wurzel = fs.mkdtempSync(path.join(os.tmpdir(), "parture-waechter-"));
const sh = (cwd, ...a) => execFileSync("git", a, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const gitIn = (cwd) => (...a) => sh(cwd, ...a);
const schreibe = (ordner, datei, inhalt) => { fs.mkdirSync(path.dirname(path.join(ordner, datei)), { recursive: true }); fs.writeFileSync(path.join(ordner, datei), inhalt); };

// Bare-Repo als "GitHub", ein Arbeitsordner zum Pushen
const quelle = path.join(wurzel, "github.git");
const werk = path.join(wurzel, "werk");
execFileSync("git", ["init", "--bare", "-b", "main", quelle], { stdio: "ignore" });
execFileSync("git", ["clone", "-q", quelle, werk], { stdio: "ignore" });
const w = gitIn(werk);
w("config", "user.email", "t@example.com"); w("config", "user.name", "Test");
// Der "Test" des Projekts: besteht, wenn Datei ok.txt vorhanden ist und kein eBay-Geheimnis in der Umgebung steht
const PRUEFUNG = `import fs from "node:fs"; if (process.env.EBAY_APP_ID || process.env.PM_TOKEN) { console.error("GEHEIMNIS IM TESTLAUF"); process.exit(1); } if (!fs.existsSync("ok.txt")) { console.error("ok.txt fehlt"); process.exit(1); }`;
schreibe(werk, "pruefung.mjs", PRUEFUNG);
schreibe(werk, "ok.txt", "1");
schreibe(werk, ".gitignore", "daten/\n");
w("add", "-A"); w("commit", "-q", "-m", "start"); w("push", "-q", "origin", "main");
let zaehler = 0;
const push = (nachricht) => { schreibe(werk, "verlauf.txt", String(++zaehler)); w("add", "-A"); w("commit", "-q", "-m", nachricht); w("push", "-q", "origin", "main"); return w("rev-parse", "HEAD"); };
const klone = (name, branch = "main") => { const d = path.join(wurzel, name); execFileSync("git", ["clone", "-q", "-b", branch, quelle, d], { stdio: "ignore" }); return d; };
const TEST = [process.execPath, ["pruefung.mjs"]];

test("unverändert: nichts zu tun, wenn der Stand gleich ist", async () => {
  const prod = klone("prod1");
  const e = await aktualisiere({ ordner: prod, branch: "main", testBefehl: TEST });
  assert.equal(e.status, "unveraendert");
});

test("neuer Stand mit bestandenen Tests wird ausgerollt und gemerkt", async () => {
  const prod = klone("prod2");
  const neu = push("gute Änderung");
  const e = await aktualisiere({ ordner: prod, branch: "main", testBefehl: TEST });
  assert.equal(e.status, "ausgerollt");
  assert.equal(gitIn(prod)("rev-parse", "HEAD"), neu);
  assert.equal(leseStatus(prod).commit, neu);
});

test("durchgefallene Tests: Rückfall auf den alten Stand, der schlechte Stand wird nicht erneut getestet, ein neuer schon", async () => {
  const prod = klone("prod3");
  const gut = gitIn(prod)("rev-parse", "HEAD");
  fs.rmSync(path.join(werk, "ok.txt")); const schlecht = push("kaputt");
  const e = await aktualisiere({ ordner: prod, branch: "main", testBefehl: TEST });
  assert.equal(e.status, "abgelehnt");
  assert.match(e.ausgabe, /ok\.txt fehlt/);
  assert.equal(gitIn(prod)("rev-parse", "HEAD"), gut, "alter Stand bleibt");
  assert.ok(!fs.existsSync(path.join(prod, "ok.txt")) === false, "Dateien sind wieder die alten");
  assert.equal(leseStatus(prod).abgelehnt, schlecht);
  const nochmal = await aktualisiere({ ordner: prod, branch: "main", testBefehl: TEST });
  assert.equal(nochmal.status, "unveraendert");
  assert.match(nochmal.grund, /abgelehnt/);
  schreibe(werk, "ok.txt", "1"); const repariert = push("repariert");
  const e2 = await aktualisiere({ ordner: prod, branch: "main", testBefehl: TEST });
  assert.equal(e2.status, "ausgerollt");
  assert.equal(gitIn(prod)("rev-parse", "HEAD"), repariert);
  assert.equal(leseStatus(prod).abgelehnt, null, "Ablehnung ist aufgehoben");
});

test("lokale Änderungen am Code blockieren das Ausrollen, nichts wird überschrieben", async () => {
  const prod = klone("prod4");
  const vorher = gitIn(prod)("rev-parse", "HEAD");
  push("noch eine");
  schreibe(prod, "ok.txt", "von Hand geändert");
  const e = await aktualisiere({ ordner: prod, branch: "main", testBefehl: TEST });
  assert.equal(e.status, "blockiert");
  assert.equal(gitIn(prod)("rev-parse", "HEAD"), vorher);
  assert.equal(fs.readFileSync(path.join(prod, "ok.txt"), "utf8"), "von Hand geändert");
});

test("Geheimnisse aus der Umgebung des Wächters kommen nicht in den Testlauf", async () => {
  const prod = klone("prod5");
  push("wieder was");
  process.env.EBAY_APP_ID = "geheim"; process.env.PM_TOKEN = "geheim";
  try {
    const e = await aktualisiere({ ordner: prod, branch: "main", testBefehl: TEST });
    assert.equal(e.status, "ausgerollt", e.ausgabe);
  } finally { delete process.env.EBAY_APP_ID; delete process.env.PM_TOKEN; }
});

test("kein Fast-Forward (lokaler Commit auf dem Server): PROD blockiert. Umgeschriebene Historie: VORSCHAU (hart) folgt", async () => {
  const prod = klone("prod6"); const vorschau = klone("vorschau6");
  // PROD hat einen eigenen Commit, den es auf GitHub nicht gibt, und GitHub bekommt einen anderen
  schreibe(prod, "lokal.txt", "x"); gitIn(prod)("add", "-A"); gitIn(prod)("-c", "user.email=a@b.c", "-c", "user.name=a", "commit", "-q", "-m", "lokaler Commit");
  const lokal = gitIn(prod)("rev-parse", "HEAD");
  push("auf GitHub weiter");
  const b = await aktualisiere({ ordner: prod, branch: "main", testBefehl: TEST });
  assert.equal(b.status, "blockiert");
  assert.match(b.grund, /Fast-Forward/);
  assert.equal(gitIn(prod)("rev-parse", "HEAD"), lokal, "PROD bleibt unangetastet");
  // GitHub-Historie wird umgeschrieben (Force-Push): VORSCHAU zieht hart nach
  w("reset", "--hard", "--quiet", "HEAD~1"); schreibe(werk, "anders.txt", "x"); w("add", "-A"); w("commit", "-q", "-m", "umgeschrieben"); w("push", "-q", "--force", "origin", "main");
  const h = await aktualisiere({ ordner: vorschau, branch: "main", hart: true, testBefehl: TEST });
  assert.equal(h.status, "ausgerollt", h.ausgabe);
  assert.equal(gitIn(vorschau)("rev-parse", "HEAD"), w("rev-parse", "HEAD"));
});

test("kein Netz bzw. Quelle weg: Status fehler, nichts geht kaputt", async () => {
  const prod = klone("prod7");
  const vorher = gitIn(prod)("rev-parse", "HEAD");
  gitIn(prod)("remote", "set-url", "origin", path.join(wurzel, "gibt-es-nicht.git"));
  const e = await aktualisiere({ ordner: prod, branch: "main", testBefehl: TEST });
  assert.equal(e.status, "fehler");
  assert.equal(gitIn(prod)("rev-parse", "HEAD"), vorher);
});

// ---------- ganzer Prozess ----------
const warte = async (fn, ms = 20000, schritt = 150) => { const bis = Date.now() + ms; for (;;) { try { const r = await fn(); if (r) return r; } catch { /* noch nicht */ } if (Date.now() > bis) throw new Error("Zeitüberschreitung"); await new Promise((r) => setTimeout(r, schritt)); } };

test("Wächter-Prozess: startet die App, rollt neuen Stand aus, startet nach Absturz und bei hängender App neu", async () => {
  // Ein kleines "Projekt": app/server.mjs ist eine Attrappe, app/waechter.mjs die echte Datei
  const port = 4300 + Math.floor(Math.random() * 90);
  schreibe(werk, "app/server.mjs", `import http from "node:http"; import fs from "node:fs"; import path from "node:path";
const w = path.resolve(import.meta.dirname, "..");
fs.rmSync(path.join(w, "haengt"), { force: true });
const stand = fs.readFileSync(path.join(w, "stand.txt"), "utf8");   // wie die echte App: Stand beim Start geladen
http.createServer((q, s) => {
  if (q.url === "/absturz") process.exit(3);
  if (fs.existsSync(path.join(w, "haengt"))) return;            // antwortet nie
  s.end(JSON.stringify({ ok: true, stand, pid: process.pid }));
}).listen(Number(process.env.PM_PORT), "127.0.0.1");`);
  schreibe(werk, "stand.txt", "eins");
  schreibe(werk, "package.json", JSON.stringify({ name: "mini", version: "1.0.0", scripts: { test: "node pruefung.mjs" } }));
  fs.copyFileSync(path.join(import.meta.dirname, "waechter.mjs"), path.join(werk, "app", "waechter.mjs"));
  schreibe(werk, ".env", ""); // wird von .gitignore nicht erfasst, soll aber nicht ins Repo
  fs.rmSync(path.join(werk, ".env"));
  push("Attrappe");
  const prod = klone("prod8");
  schreibe(prod, ".env", `PM_PORT=${port}\n`);
  const kind = spawn(process.execPath, [path.join(prod, "app", "waechter.mjs"), "--branch", "main", "--intervall", "1"], { cwd: prod, env: { ...process.env, WAECHTER_GESUNDHEIT_S: "1", WAECHTER_ANLAUF_S: "0", PM_PORT: String(port) }, stdio: "ignore" });
  const hole = async () => (await fetch(`http://127.0.0.1:${port}/x`, { signal: AbortSignal.timeout(1500) })).json();
  try {
    const a = await warte(hole);
    assert.equal(a.stand, "eins", "App läuft");
    // Auto-Deploy: neuer Stand auf GitHub (Tests des Mini-Projekts bestehen über npm test) → App läuft danach mit dem neuen Stand
    schreibe(werk, "stand.txt", "zwei"); const neuerStand = push("Stand zwei");
    const z = await warte(async () => { const x = await hole(); return x.stand === "zwei" ? x : null; }, 30000);
    assert.notEqual(z.pid, a.pid, "App wurde neu gestartet");
    assert.equal(leseStatus(prod).commit, neuerStand);
    a.pid = z.pid;
    // Absturz: App beendet sich, der Wächter startet sie neu (andere PID)
    await fetch(`http://127.0.0.1:${port}/absturz`).catch(() => {});
    const b = await warte(async () => { const x = await hole(); return x.pid !== a.pid ? x : null; });
    assert.ok(b.pid !== a.pid, "nach Absturz neu gestartet");
    // Hängende App: antwortet nicht mehr, der Wächter beendet und startet sie neu
    schreibe(prod, "haengt", "1");
    const c = await warte(async () => { const x = await hole(); return x.pid !== b.pid ? x : null; }, 30000);
    assert.ok(c.pid !== b.pid, "hängende App neu gestartet");
    assert.ok(fs.existsSync(path.join(prod, "daten", "waechter.log")), "Log wird geschrieben");
    assert.match(fs.readFileSync(path.join(prod, "daten", "waechter.log"), "utf8"), /App gestartet/);
  } catch (e) {
    try { process.stderr.write("\nLOG:\n" + fs.readFileSync(path.join(prod, "daten", "waechter.log"), "utf8").slice(-1500), fs.existsSync(path.join(prod, "daten", "app.log")) ? fs.readFileSync(path.join(prod, "daten", "app.log"), "utf8").slice(-800) : ""); } catch { /* kein Log */ }
    throw e;
  } finally { kind.kill(); await new Promise((r) => setTimeout(r, 400)); }
});

test.after(() => fs.rmSync(wurzel, { recursive: true, force: true }));
