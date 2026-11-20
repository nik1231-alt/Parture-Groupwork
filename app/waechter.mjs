// Wächter: hält die App am Leben und rollt neue Stände von GitHub aus, aber nur geprüfte.
//
//   node app/waechter.mjs --branch main                    PROD: nur Fast-Forward, nach bestandenen Tests, alle 10 Minuten
//   node app/waechter.mjs --branch vorschau --hart --intervall 60   VORSCHAU: folgt dem Branch auch bei Force-Push, jede Minute
//   node app/waechter.mjs                                  nur überwachen (kein Auto-Deploy)
//
// Ablauf je Prüfung: git fetch → liegt der Branch vor dem lokalen Stand → vorwärts ziehen → (bei geänderter package.json/-lock:
// App stoppen, dann npm ci) → npm test (ohne eBay-Keys, ohne Netz) → bestanden: App neu starten. Durchgefallen: sofort zurück auf
// den alten Stand, die App läuft unverändert weiter (bzw. startet wieder), der abgelehnte Stand wird gemerkt und nicht erneut
// getestet, bis ein neuer Stand kommt.
// WARUM die App vor npm ci stoppt (Parture-Server, 18.11.2026): npm ci löscht node_modules und legt es neu an. Unter Windows hält
// die laufende App better_sqlite3.node offen, die Datei lässt sich dann nicht löschen (EPERM), npm ci scheitert, und der Stand wurde
// abgelehnt, obwohl weder Code noch Tests ein Problem hatten (defd8b5 auf VORSCHAU, Grund: nur die Version in package.json).
// Fehlt die Antwort auf /healthz dreimal hintereinander, wird die App beendet und neu gestartet. Stürzt sie ab, startet sie mit Pause wieder.
// Der Wächter selbst läuft als Dienst bzw. geplante Aufgabe (siehe docs/server-einrichtung.md).
import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const WURZEL = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const GEHEIM = /^(EBAY_|PM_TOKEN$|TELEGRAM_|CF_|SMTP_|PM_OHNE_ENV$)/;
const bereinigt = (env) => Object.fromEntries(Object.entries(env).filter(([k]) => !GEHEIM.test(k)));

const lauf = (cmd, args, { cwd, env = process.env, timeout = 600000 } = {}) => new Promise((resolve) => {
  execFile(cmd, args, { cwd, env, timeout, maxBuffer: 32 * 1024 * 1024, shell: process.platform === "win32" && /npm/.test(cmd) }, (fehler, stdout, stderr) => {
    resolve({ ok: !fehler, code: fehler ? (typeof fehler.code === "number" ? fehler.code : 1) : 0, ausgabe: String(stdout || "") + String(stderr || "") });
  });
});
const git = (ordner, ...a) => lauf("git", a, { cwd: ordner });
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

export function leseStatus(ordner) {
  try { return JSON.parse(fs.readFileSync(path.join(ordner, "daten", "waechter-status.json"), "utf8")); } catch { return {}; }
}
function schreibeStatus(ordner, teil) {
  const neu = { ...leseStatus(ordner), ...teil };
  fs.mkdirSync(path.join(ordner, "daten"), { recursive: true });
  const ziel = path.join(ordner, "daten", "waechter-status.json");
  fs.writeFileSync(ziel + ".neu", JSON.stringify(neu, null, 2));
  fs.renameSync(ziel + ".neu", ziel);
  return neu;
}

// Eine Prüfung. Liefert { status, von, nach, grund }:
//   unveraendert | ausgerollt | abgelehnt (Tests durchgefallen, alter Stand bleibt) | blockiert (lokale Änderungen / kein Fast-Forward) | fehler (z. B. kein Netz)
// `vorInstallation` wird genau dann (und höchstens einmal) aufgerufen, wenn npm ci nötig ist — der Wächter stoppt darin die App,
// damit keine geöffnete native Datei den Austausch von node_modules blockiert. Das Ergebnis trägt `appGestoppt: true`, wenn das
// geschah; der Aufrufer startet die App dann wieder, falls nicht ohnehin ausgerollt wird.
export async function aktualisiere({ ordner = WURZEL, branch, hart = false, testBefehl = [npm, ["test"]],
  installBefehl = [npm, ["ci", "--no-audit", "--no-fund"]], vorInstallation = null, jetzt = () => new Date() } = {}) {
  const f = (grund) => ({ status: "fehler", grund });
  let r = await git(ordner, "fetch", "--quiet", "origin", branch);
  if (!r.ok) return f("git fetch: " + r.ausgabe.trim().split("\n").slice(-1)[0]);
  const lokal = (await git(ordner, "rev-parse", "HEAD")).ausgabe.trim();
  const fern = (await git(ordner, "rev-parse", `origin/${branch}`)).ausgabe.trim();
  if (!lokal || !fern) return f("Stand nicht lesbar");
  if (lokal === fern) return { status: "unveraendert", von: lokal, nach: fern };
  if (leseStatus(ordner).abgelehnt === fern) return { status: "unveraendert", von: lokal, nach: fern, grund: "this version was already rejected" };

  if (!hart) {
    const schmutzig = (await git(ordner, "status", "--porcelain", "--untracked-files=no")).ausgabe.trim();
    if (schmutzig) return { status: "blockiert", von: lokal, nach: fern, grund: "local changes in the folder block the rollout: " + schmutzig.split("\n")[0] };
    r = await git(ordner, "merge", "--ff-only", "--quiet", `origin/${branch}`);
    if (!r.ok) return { status: "blockiert", von: lokal, nach: fern, grund: "no fast-forward possible: " + r.ausgabe.trim().split("\n").slice(-1)[0] };
  } else {
    r = await git(ordner, "reset", "--hard", "--quiet", `origin/${branch}`);
    if (!r.ok) return f("git reset: " + r.ausgabe.trim());
  }

  let appGestoppt = false;
  const installiere = async () => {
    if (!appGestoppt && vorInstallation) { await vorInstallation(); appGestoppt = true; }
    return lauf(installBefehl[0], installBefehl[1], { cwd: ordner });
  };
  const zurueck = async (grund, ausgabe) => {
    await git(ordner, "reset", "--hard", "--quiet", lokal);
    if (lockGeaendert) await installiere();   // node_modules wieder zum alten Stand, die App startet danach damit
    schreibeStatus(ordner, { abgelehnt: fern, abgelehntGrund: grund, abgelehntAm: jetzt().toISOString() });
    return { status: "abgelehnt", von: lokal, nach: fern, grund, appGestoppt, ausgabe: String(ausgabe || "").split("\n").slice(-25).join("\n") };
  };
  const geaendert = (await git(ordner, "diff", "--name-only", lokal, fern)).ausgabe.split("\n");
  const lockGeaendert = geaendert.some((n) => n === "package-lock.json" || n === "package.json");
  if (lockGeaendert) {
    r = await installiere();
    if (!r.ok) return zurueck("npm ci fehlgeschlagen", r.ausgabe);
  }
  // Tests ohne Geheimnisse und ohne die .env des Ordners (PM_OHNE_ENV wird von den Tests selbst gesetzt)
  r = await lauf(testBefehl[0], testBefehl[1], { cwd: ordner, env: bereinigt(process.env) });
  if (!r.ok) return zurueck("Tests fehlgeschlagen", r.ausgabe);
  schreibeStatus(ordner, { commit: fern, branch, ausgerolltAm: jetzt().toISOString(), abgelehnt: null, abgelehntGrund: null, abgelehntAm: null });
  return { status: "ausgerollt", von: lokal, nach: fern, appGestoppt };
}

// Port der App aus der .env des Ordners (die App liest sie selbst; der Wächter braucht sie nur für /healthz)
function portAusEnv(ordner) {
  try {
    const m = fs.readFileSync(path.join(ordner, ".env"), "utf8").match(/^\s*PM_PORT\s*=\s*(\d+)/m);
    if (m) return Number(m[1]);
  } catch { /* keine .env */ }
  return Number(process.env.PM_PORT) || 5060;
}

// ---- Hauptprogramm ----
async function haupt() {
  const arg = (n) => { const i = process.argv.indexOf("--" + n); return i >= 0 ? process.argv[i + 1] : undefined; };
  const branch = arg("branch") || process.env.WAECHTER_BRANCH || "";
  const hart = process.argv.includes("--hart");
  const intervallS = Math.max(1, Number(arg("intervall") || process.env.WAECHTER_INTERVALL_S) || (hart ? 60 : 600));
  const gesundheitS = Math.max(1, Number(process.env.WAECHTER_GESUNDHEIT_S) || 30);   // nur die Tests verkürzen diese Zeiten
  const anlaufS = Number(process.env.WAECHTER_ANLAUF_S ?? 20);
  const ordner = WURZEL;
  const port = portAusEnv(ordner);
  fs.mkdirSync(path.join(ordner, "daten"), { recursive: true });
  const logPfad = path.join(ordner, "daten", "waechter.log");
  const log = (m) => {
    const z = `[${new Date().toISOString().replace("T", " ").slice(0, 19)}] ${m}\n`;
    process.stdout.write(z);
    try { if (fs.existsSync(logPfad) && fs.statSync(logPfad).size > 1e6) fs.renameSync(logPfad, logPfad + ".alt"); fs.appendFileSync(logPfad, z); } catch { /* Log nicht beschreibbar */ }
  };

  let kind = null, beendet = false, neustarts = 0, startAm = 0, fehlschlaege = 0, geplant = null;
  const starte = () => {
    if (beendet || kind) return;
    const aus = fs.openSync(path.join(ordner, "daten", "app.log"), "a");
    startAm = Date.now(); fehlschlaege = 0;
    kind = spawn(process.execPath, [path.join(ordner, "app", "server.mjs")], { cwd: ordner, env: process.env, stdio: ["ignore", aus, aus], windowsHide: true });
    const mein = kind;
    log(`App gestartet (PID ${mein.pid}, Port ${port}, Stand ${(leseStatus(ordner).commit || "?").slice(0, 7)})`);
    mein.on("exit", (code, signal) => {
      fs.closeSync(aus);
      if (kind === mein) kind = null;
      if (beendet) return;
      if (Date.now() - startAm > 5 * 60e3) neustarts = 0;
      const pause = Math.min(60, 2 ** neustarts++);
      log(`App beendet (Code ${code ?? signal}). Neustart in ${pause} s.`);
      geplant = setTimeout(() => { geplant = null; starte(); }, pause * 1000);
    });
  };
  const stoppe = () => new Promise((resolve) => {
    if (!kind) return resolve();
    const k = kind; const t = setTimeout(() => k.kill("SIGKILL"), 8000);
    k.once("exit", () => { clearTimeout(t); resolve(); });
    k.kill();
  });

  const gesund = async () => {
    try { const r = await fetch(`http://127.0.0.1:${port}/healthz`, { signal: AbortSignal.timeout(5000) }); return r.ok; } catch { return false; }
  };
  setInterval(async () => {
    if (!kind || beendet || Date.now() - startAm < anlaufS * 1000) return;
    if (await gesund()) { fehlschlaege = 0; return; }
    if (++fehlschlaege >= 3) { log("/healthz does not answer (3 attempts), restarting the app."); fehlschlaege = 0; kind?.kill("SIGKILL"); }
  }, gesundheitS * 1000).unref?.();

  let pruefLaeuft = false;
  const pruefe = async () => {
    if (!branch || pruefLaeuft || beendet) return;
    pruefLaeuft = true;
    try {
      // App vor npm ci stoppen (siehe Kopf); der Neustart-Timer des exit-Handlers wird dabei entschärft, sonst liefe die App
      // mitten in npm ci wieder an und hielte die Dateien erneut offen.
      const vorInstallation = async () => { log("Dependencies changed: stopping the app for npm ci."); await stoppe(); if (geplant) { clearTimeout(geplant); geplant = null; } };
      const e = await aktualisiere({ ordner, branch, hart, vorInstallation });
      if (e.status === "ausgerollt") { log(`Rolled out: ${e.von.slice(0, 7)} → ${e.nach.slice(0, 7)} (tests passed). Restarting.`); await stoppe(); if (geplant) { clearTimeout(geplant); geplant = null; } starte(); }
      else if (e.status === "abgelehnt") { log(`REJECTED ${e.nach.slice(0, 7)}: ${e.grund}. Old version ${e.von.slice(0, 7)} keeps running.\n${e.ausgabe}`); if (e.appGestoppt) starte(); }
      else if (e.status === "blockiert" || e.status === "fehler") { if (e.grund !== leseStatus(ordner).letzterHinweis) { log(`${e.status.toUpperCase()}: ${e.grund}`); schreibeStatus(ordner, { letzterHinweis: e.grund }); } }
      else if (leseStatus(ordner).letzterHinweis) schreibeStatus(ordner, { letzterHinweis: null });
      schreibeStatus(ordner, { geprueftAm: new Date().toISOString() });
    } catch (x) { log("Check failed: " + x.message); } finally { pruefLaeuft = false; }
  };

  const ende = async (sig) => { beendet = true; log(`${sig}: watcher is shutting down.`); if (geplant) clearTimeout(geplant); await stoppe(); process.exit(0); };
  process.on("SIGINT", () => ende("SIGINT")); process.on("SIGTERM", () => ende("SIGTERM"));

  setInterval(() => {}, 2 ** 30); // hält den Prozess auch dann am Leben, wenn gerade keine App läuft
  log(`Watcher started: ${branch ? `follows origin/${branch}${hart ? " (hard)" : " (fast-forward only)"}, check every ${intervallS} s` : "monitoring only"}`);
  if (branch) await pruefe();   // vor dem ersten Start: gleich den aktuellen Stand holen
  starte();
  if (branch) setInterval(pruefe, intervallS * 1000);
}

// realpath: über Symlinks (macOS /tmp, Windows-Junctions) gestartet, ist der Pfad sonst nicht gleich
const istHauptprogramm = () => { try { return !!process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href; } catch { return false; } };
if (istHauptprogramm()) haupt();
