// Tests for the watcher (app/waechter.mjs): rolling out with a test gate, fall back on failed tests, blocks,
// secrets stay out of the test run, and the whole process (start, auto-deploy, crash, hanging app).
// Everything in temporary folders with local Git repos, without network.
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

// Bare repo as "GitHub", a working folder for pushing
const quelle = path.join(wurzel, "github.git");
const werk = path.join(wurzel, "werk");
execFileSync("git", ["init", "--bare", "-b", "main", quelle], { stdio: "ignore" });
execFileSync("git", ["clone", "-q", quelle, werk], { stdio: "ignore" });
const w = gitIn(werk);
w("config", "user.email", "t@example.com"); w("config", "user.name", "Test");
// The project's "test": passes if the file ok.txt exists and no eBay secret is in the environment
const PRUEFUNG = `import fs from "node:fs"; if (process.env.EBAY_APP_ID || process.env.PM_TOKEN) { console.error("GEHEIMNIS IM TESTLAUF"); process.exit(1); } if (!fs.existsSync("ok.txt")) { console.error("ok.txt fehlt"); process.exit(1); }`;
schreibe(werk, "pruefung.mjs", PRUEFUNG);
schreibe(werk, "ok.txt", "1");
schreibe(werk, ".gitignore", "daten/\n");
w("add", "-A"); w("commit", "-q", "-m", "start"); w("push", "-q", "origin", "main");
let zaehler = 0;
const push = (nachricht) => { schreibe(werk, "verlauf.txt", String(++zaehler)); w("add", "-A"); w("commit", "-q", "-m", nachricht); w("push", "-q", "origin", "main"); return w("rev-parse", "HEAD"); };
const klone = (name, branch = "main") => { const d = path.join(wurzel, name); execFileSync("git", ["clone", "-q", "-b", branch, quelle, d], { stdio: "ignore" }); return d; };
const TEST = [process.execPath, ["pruefung.mjs"]];

test("unchanged: nothing to do when the version is the same", async () => {
  const prod = klone("prod1");
  const e = await aktualisiere({ ordner: prod, branch: "main", testBefehl: TEST });
  assert.equal(e.status, "unveraendert");
});

test("a new version with passing tests is rolled out and remembered", async () => {
  const prod = klone("prod2");
  const neu = push("gute Änderung");
  const e = await aktualisiere({ ordner: prod, branch: "main", testBefehl: TEST });
  assert.equal(e.status, "ausgerollt");
  assert.equal(gitIn(prod)("rev-parse", "HEAD"), neu);
  assert.equal(leseStatus(prod).commit, neu);
});

test("failed tests: fall back to the old version, the bad version is not tested again, a new one is", async () => {
  const prod = klone("prod3");
  const gut = gitIn(prod)("rev-parse", "HEAD");
  fs.rmSync(path.join(werk, "ok.txt")); const schlecht = push("kaputt");
  const e = await aktualisiere({ ordner: prod, branch: "main", testBefehl: TEST });
  assert.equal(e.status, "abgelehnt");
  assert.match(e.ausgabe, /ok\.txt fehlt/);
  assert.equal(gitIn(prod)("rev-parse", "HEAD"), gut, "alter Stand bleibt");
  assert.ok(!fs.existsSync(path.join(prod, "ok.txt")) === false, "files are the old ones again");
  assert.equal(leseStatus(prod).abgelehnt, schlecht);
  const nochmal = await aktualisiere({ ordner: prod, branch: "main", testBefehl: TEST });
  assert.equal(nochmal.status, "unveraendert");
  assert.match(nochmal.grund, /rejected/);
  schreibe(werk, "ok.txt", "1"); const repariert = push("repariert");
  const e2 = await aktualisiere({ ordner: prod, branch: "main", testBefehl: TEST });
  assert.equal(e2.status, "ausgerollt");
  assert.equal(gitIn(prod)("rev-parse", "HEAD"), repariert);
  assert.equal(leseStatus(prod).abgelehnt, null, "the rejection is lifted");
});

test("changed package.json: the app is stopped BEFORE npm ci, exactly once; not at all without a change to the dependencies", async () => {
  // Parture server, 18 Nov 2026: npm ci failed on Windows because the running app kept better_sqlite3.node open (EPERM).
  const prod = klone("prod-install");
  // Replacement for npm ci: writes a marker into the folder. The stop hook remembers whether the marker already existed then.
  const INSTALL = [process.execPath, ["-e", "require('fs').writeFileSync('installiert.txt', '1')"]];
  const reihenfolge = [];
  const stopp = async () => { reihenfolge.push(fs.existsSync(path.join(prod, "installiert.txt")) ? "stopp NACH install" : "stopp"); };
  // 1) only code changed: no stop, no install
  push("nur Code");
  let e = await aktualisiere({ ordner: prod, branch: "main", testBefehl: TEST, installBefehl: INSTALL, vorInstallation: stopp });
  assert.equal(e.status, "ausgerollt");
  assert.equal(e.appGestoppt, false);
  assert.deepEqual(reihenfolge, []);
  assert.ok(!fs.existsSync(path.join(prod, "installiert.txt")), "no npm ci without a change to the dependencies");
  // 2) package.json changed (only the version, as with defd8b5): stop, then install, then tests, then rolled out
  schreibe(werk, "package.json", JSON.stringify({ name: "probe", version: "0.2.0" })); push("Version hoch");
  e = await aktualisiere({ ordner: prod, branch: "main", testBefehl: TEST, installBefehl: INSTALL, vorInstallation: stopp });
  assert.equal(e.status, "ausgerollt");
  assert.equal(e.appGestoppt, true, "the caller must know that the app was stopped");
  assert.deepEqual(reihenfolge, ["stopp"], "exactly one stop, and before the install");
  assert.ok(fs.existsSync(path.join(prod, "installiert.txt")));
  // 3) package.json changed AND tests fail: stop once, the fall back installs the old version again, appGestoppt (app stopped) reported
  fs.rmSync(path.join(prod, "installiert.txt")); reihenfolge.length = 0;
  schreibe(werk, "package.json", JSON.stringify({ name: "probe", version: "0.3.0" })); fs.rmSync(path.join(werk, "ok.txt")); push("Version hoch, aber kaputt");
  e = await aktualisiere({ ordner: prod, branch: "main", testBefehl: TEST, installBefehl: INSTALL, vorInstallation: stopp });
  assert.equal(e.status, "abgelehnt");
  assert.equal(e.appGestoppt, true);
  assert.deepEqual(reihenfolge, ["stopp"], "also on the fall back it is stopped only once");
  assert.ok(fs.existsSync(path.join(prod, "installiert.txt")), "the fall back installed the old dependencies again");
  schreibe(werk, "ok.txt", "1"); push("repariert");
});

test("local changes to the code block the rollout, nothing is overwritten", async () => {
  const prod = klone("prod4");
  const vorher = gitIn(prod)("rev-parse", "HEAD");
  push("noch eine");
  schreibe(prod, "ok.txt", "von Hand geändert");
  const e = await aktualisiere({ ordner: prod, branch: "main", testBefehl: TEST });
  assert.equal(e.status, "blockiert");
  assert.equal(gitIn(prod)("rev-parse", "HEAD"), vorher);
  assert.equal(fs.readFileSync(path.join(prod, "ok.txt"), "utf8"), "von Hand geändert");
});

test("Secrets from the watcher's environment do not reach the test run", async () => {
  const prod = klone("prod5");
  push("wieder was");
  process.env.EBAY_APP_ID = "geheim"; process.env.PM_TOKEN = "geheim";
  try {
    const e = await aktualisiere({ ordner: prod, branch: "main", testBefehl: TEST });
    assert.equal(e.status, "ausgerollt", e.ausgabe);
  } finally { delete process.env.EBAY_APP_ID; delete process.env.PM_TOKEN; }
});

test("no fast-forward (local commit on the server): PROD blocks. Rewritten history: PREVIEW (hard) follows", async () => {
  const prod = klone("prod6"); const vorschau = klone("vorschau6");
  // PROD has its own commit that does not exist on GitHub, and GitHub gets a different one
  schreibe(prod, "lokal.txt", "x"); gitIn(prod)("add", "-A"); gitIn(prod)("-c", "user.email=a@b.c", "-c", "user.name=a", "commit", "-q", "-m", "lokaler Commit");
  const lokal = gitIn(prod)("rev-parse", "HEAD");
  push("auf GitHub weiter");
  const b = await aktualisiere({ ordner: prod, branch: "main", testBefehl: TEST });
  assert.equal(b.status, "blockiert");
  assert.match(b.grund, /fast-forward/);
  assert.equal(gitIn(prod)("rev-parse", "HEAD"), lokal, "PROD bleibt unangetastet");
  // GitHub history is rewritten (force push): PREVIEW pulls hard
  w("reset", "--hard", "--quiet", "HEAD~1"); schreibe(werk, "anders.txt", "x"); w("add", "-A"); w("commit", "-q", "-m", "umgeschrieben"); w("push", "-q", "--force", "origin", "main");
  const h = await aktualisiere({ ordner: vorschau, branch: "main", hart: true, testBefehl: TEST });
  assert.equal(h.status, "ausgerollt", h.ausgabe);
  assert.equal(gitIn(vorschau)("rev-parse", "HEAD"), w("rev-parse", "HEAD"));
});

test("no network or source gone: status error, nothing breaks", async () => {
  const prod = klone("prod7");
  const vorher = gitIn(prod)("rev-parse", "HEAD");
  gitIn(prod)("remote", "set-url", "origin", path.join(wurzel, "gibt-es-nicht.git"));
  const e = await aktualisiere({ ordner: prod, branch: "main", testBefehl: TEST });
  assert.equal(e.status, "fehler");
  assert.equal(gitIn(prod)("rev-parse", "HEAD"), vorher);
});

// ---------- ganzer Prozess ----------
const warte = async (fn, ms = 20000, schritt = 150) => { const bis = Date.now() + ms; for (;;) { try { const r = await fn(); if (r) return r; } catch { /* noch nicht */ } if (Date.now() > bis) throw new Error("Zeitüberschreitung"); await new Promise((r) => setTimeout(r, schritt)); } };

test("Watcher process: starts the app, rolls out a new version, restarts after a crash and with a hanging app", async () => {
  // A small "project": app/server.mjs is a dummy, app/waechter.mjs the real file
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
  let appPid = null;   // the app is a child of the watcher: kill() on the watcher does not end it on Windows
  const hole = async () => { const x = await (await fetch(`http://127.0.0.1:${port}/x`, { signal: AbortSignal.timeout(1500) })).json(); appPid = x.pid ?? appPid; return x; };
  try {
    const a = await warte(hole);
    assert.equal(a.stand, "eins", "app is running");
    // Auto-deploy: new version on GitHub (the mini project's tests pass through npm test) → the app then runs with the new version
    schreibe(werk, "stand.txt", "zwei"); const neuerStand = push("Stand zwei");
    const z = await warte(async () => { const x = await hole(); return x.stand === "zwei" ? x : null; }, 30000);
    assert.notEqual(z.pid, a.pid, "the app was restarted");
    assert.equal(leseStatus(prod).commit, neuerStand);
    a.pid = z.pid;
    // Crash: the app ends itself, the watcher restarts it (different PID)
    await fetch(`http://127.0.0.1:${port}/absturz`).catch(() => {});
    const b = await warte(async () => { const x = await hole(); return x.pid !== a.pid ? x : null; });
    assert.ok(b.pid !== a.pid, "restarted after a crash");
    // Hanging app: no longer answers, the watcher ends and restarts it
    schreibe(prod, "haengt", "1");
    const c = await warte(async () => { const x = await hole(); return x.pid !== b.pid ? x : null; }, 30000);
    assert.ok(c.pid !== b.pid, "hanging app restarted");
    assert.ok(fs.existsSync(path.join(prod, "daten", "waechter.log")), "the log is written");
    assert.match(fs.readFileSync(path.join(prod, "daten", "waechter.log"), "utf8"), /App gestartet/);
  } catch (e) {
    try { process.stderr.write("\nLOG:\n" + fs.readFileSync(path.join(prod, "daten", "waechter.log"), "utf8").slice(-1500), fs.existsSync(path.join(prod, "daten", "app.log")) ? fs.readFileSync(path.join(prod, "daten", "app.log"), "utf8").slice(-800) : ""); } catch { /* kein Log */ }
    throw e;
  } finally {
    // First end watcher AND app and wait for both, then clean up: otherwise the app keeps files open (EBUSY on Windows)
    if (kind.exitCode === null) { const weg = new Promise((r) => kind.once("exit", r)); kind.kill(); await weg; }
    if (appPid) { try { process.kill(appPid); } catch { /* schon beendet */ } }
    for (let i = 0; i < 30; i++) { try { await fetch(`http://127.0.0.1:${port}/x`, { signal: AbortSignal.timeout(200) }); } catch { break; } await new Promise((r) => setTimeout(r, 100)); }
  }
});

test.after(() => fs.rmSync(wurzel, { recursive: true, force: true }));
