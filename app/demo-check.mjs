// Check before the demo: npm run demo-check (on the server, in the folder of the environment; reads only, changes nothing).
// Asks everything the fallback table in docs/vorfuehrung.md names: app up, version = main, watcher alive, data fresh,
// backup there, eBay answers, AI key there. Exit code 1 if one line is red.
// The judgement (bewerte) is a pure function and has its own tests; the lines below it only collect the facts.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { laDatum, verzoegerungFuer } from "./traffic.mjs";

const STUNDE = 3600e3;
const alter = (iso, jetzt) => (iso && !Number.isNaN(Date.parse(iso)) ? (jetzt.getTime() - Date.parse(iso)) / STUNDE : null);

// lage: { healthz, mainSha, waechter, stand, sicherung, ebay, ki } (each may be null when it could not be read).
export function bewerte(lage, jetzt = new Date()) {
  const z = [];
  const zeile = (name, ok, text) => z.push({ name, ok, text });
  const h = lage.healthz;
  zeile("App", !!h?.ok, h?.ok ? `answers, version ${h.version || "unknown"}` : "does not answer on /healthz");
  const gleich = !!(h?.version && lage.mainSha && lage.mainSha.startsWith(h.version));
  zeile("Version", gleich, gleich ? "is main on GitHub" : `app ${h?.version || "unknown"}, main ${lage.mainSha ? lage.mainSha.slice(0, 7) : "unknown (no network or no git)"}`);
  const w = lage.waechter, wAlt = alter(w?.geprueftAm, jetzt);
  zeile("Watcher", wAlt !== null && wAlt < 0.5 && !w.abgelehnt, wAlt === null ? "no status file" : w.abgelehnt ? `rejected ${String(w.abgelehnt).slice(0, 7)}: ${w.abgelehntGrund || "tests failed"}` : `last check ${Math.round(wAlt * 60)} min ago`);
  const s = lage.stand;
  if (!s?.traffic_bis) zeile("Data", false, "no traffic date in pm.db");
  else {
    const soll = laDatum(jetzt, verzoegerungFuer(s.quelle)), zurueck = Math.round((Date.parse(soll) - Date.parse(s.traffic_bis)) / 864e5);
    zeile("Data", zurueck < 2, `traffic up to ${s.traffic_bis}` + (zurueck > 0 ? `, ${zurueck} day(s) behind` : ", up to date"));
  }
  const sAlt = alter(lage.sicherung, jetzt);
  zeile("Backup", sAlt !== null && sAlt < 26, sAlt === null ? "none found" : `newest ${Math.round(sAlt)} h old`);
  const e = lage.ebay;
  zeile("eBay", !!e?.ok, !e?.konfiguriert ? "no keys on this machine" : e.ok ? "read one listing" : "keys there, but reading failed: " + (e.meldung || "no answer"));
  zeile("AI titles", !!lage.ki?.konfiguriert, lage.ki?.konfiguriert ? "key there (not called, a call costs)" : "no key: titles can still be typed by hand");
  return { zeilen: z, ok: z.every((x) => x.ok) };
}

// Reads a .env the way the server does: the whole rest of the line is the value. Node's own loader (process.loadEnvFile)
// cuts a value at "#", and eBay refresh tokens contain "#": with it this check said "token invalid" on a healthy PROD (23 Nov 2026).
export function liesEnv(text) {
  const aus = {};
  for (const z of String(text).split(/\r?\n/)) { const m = z.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i); if (m) aus[m[1]] = m[2]; }
  return aus;
}

async function sammle(wurzel, env) {
  const versuche = async (f) => { try { return await f(); } catch { return null; } };
  const { default: Database } = await import("better-sqlite3");
  const { erzeuge: ebay } = await import("./ebay-schreiben.mjs");
  const { erzeuge: ki } = await import("./ki-titel.mjs");
  const sicherung = await import("./sicherung.mjs");
  const pm = path.resolve(wurzel, env.PM_DB || (fs.existsSync(path.join(wurzel, "daten/pm.db")) ? "daten/pm.db" : "daten-team/pm.db"));
  const ausPm = (f) => { const d = new Database(pm, { readonly: true }); try { return f(d); } finally { d.close(); } };
  const schreiber = ebay({ env });
  const itemId = await versuche(() => ausPm((d) => d.prepare("SELECT external_id FROM kanal WHERE channel = 'ebay' AND listed = 1 AND external_id IS NOT NULL LIMIT 1").get()?.external_id));
  const liesEbay = async () => { try { return await schreiber.lies(itemId); } catch (f) { return { ok: false, meldung: f.message }; } };
  return {
    healthz: await versuche(async () => (await fetch(`http://127.0.0.1:${env.PM_PORT || 5060}/healthz`, { signal: AbortSignal.timeout(5000) })).json()),
    mainSha: await versuche(() => execFileSync("git", ["ls-remote", "origin", "refs/heads/main"], { cwd: wurzel, encoding: "utf8", timeout: 20000 }).split(/\s/)[0] || null),
    waechter: await versuche(() => JSON.parse(fs.readFileSync(path.join(wurzel, "daten/waechter-status.json"), "utf8"))),
    stand: await versuche(() => ausPm((d) => d.prepare("SELECT traffic_bis, quelle FROM stand").get())),
    sicherung: await versuche(() => sicherung.liste(sicherung.konfiguration(env, wurzel).ziel)[0]?.geaendert ?? null),
    ebay: { konfiguriert: schreiber.konfiguriert(), ...(schreiber.konfiguriert() && itemId ? await liesEbay() : { ok: false }) },
    ki: { konfiguriert: ki({ env }).konfiguriert() },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  const wurzel = path.join(import.meta.dirname, "..");
  let datei = {};
  try { datei = liesEnv(fs.readFileSync(path.join(wurzel, ".env"), "utf8")); } catch { /* no .env: the lines below say what is missing */ }
  const { zeilen, ok } = bewerte(await sammle(wurzel, { ...datei, ...process.env }));
  for (const x of zeilen) console.log(`${x.ok ? "OK  " : "FAIL"}  ${x.name.padEnd(10)} ${x.text}`);
  console.log(ok ? "\nAll green." : "\nNot ready: see the FAIL lines and the fallback table in docs/vorfuehrung.md.");
  process.exit(ok ? 0 : 1);
}
