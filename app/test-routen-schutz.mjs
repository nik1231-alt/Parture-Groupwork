// Routenschutz für ALLE Adressen (Checkliste A3.2, A3.4, A3.5, A3.9): die Liste wird aus server.mjs gelesen, nicht von Hand gepflegt.
// Kommt eine neue Route dazu, wird sie hier automatisch mitgeprüft: ohne Anmeldung 401, mit Builder-Sitzung auf einer Admin-Route 403.
// Ist sie ungeschützt und steht nicht in OEFFENTLICH, schlägt der Test fehl. Es wird nie bei eBay geschrieben (keine Zugangsdaten, Schalter aus).
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { bereiteVor, legeBenutzerAn, SITZUNG_STUNDEN } from "./login.mjs";
import * as rollen from "./rollen.mjs";
import { SCHEMA } from "./einstellungen.mjs";

const QUELLE = fs.readFileSync(path.join(import.meta.dirname, "server.mjs"), "utf8");
const PUBLIC = path.join(import.meta.dirname, "..", "public");

// ---------- Routenliste aus dem Quelltext ----------
// Ein Objekt-Block "const NAME = { ... };" → je Schlüssel der Text bis zum nächsten Schlüssel (daran erkennt man adminNoetig).
function block(name) {
  const start = QUELLE.indexOf(`const ${name} = {`);
  assert.ok(start >= 0, `${name} nicht in server.mjs gefunden`);
  const ende = QUELLE.indexOf("\n};", start);
  const text = QUELLE.slice(start, ende);
  const treffer = [...text.matchAll(/^ {2}"(\/[^"]+)":/gm)];
  return treffer.map((m, i) => ({ pfad: m[1], code: text.slice(m.index, treffer[i + 1]?.index ?? text.length) }));
}
// Direkt im Request-Handler behandelte Adressen (Login, Passwort, Logout, ich, healthz): Methode steht in derselben Zeile.
const inline = [...QUELLE.matchAll(/^.*url\.pathname === "(\/(?:api\/[^"]+|healthz))".*$/gm)]
  .map((m) => ({ methode: /req\.method === "POST"/.test(m[0]) ? "POST" : "GET", pfad: m[1], code: m[0] }));
const ROUTEN = [
  ...block("ROUTEN").map((r) => ({ methode: "GET", ...r })),
  ...block("POST_ROUTEN").map((r) => ({ methode: "POST", ...r })),
  ...inline,
];
const schluessel = (r) => `${r.methode} ${r.pfad}`;

// Bewusst ohne Anmeldung erreichbar. Wer hier etwas ergänzt, muss es im Review begründen.
const OEFFENTLICH = new Set([
  "GET /healthz",      // Lebenszeichen für den Wächter: nur { ok, version }
  "POST /api/login",   // Anmeldung selbst
  "GET /api/ich",      // sagt der Oberfläche nur, ob jemand angemeldet ist
  "POST /api/logout",  // löscht nur die Sitzung des mitgeschickten Cookies, ohne Cookie passiert nichts
]);
// Diese Routen MÜSSEN Admin-only sein (Checkliste A3.9). Weitere Admin-Routen werden aus adminNoetig erkannt und mitgeprüft.
const PFLICHT_ADMIN = ["GET /api/rollen", "POST /api/rolle", "POST /api/freigabe/erteilen", "POST /api/freigabe/ablehnen", "POST /api/experiment/start", "POST /api/traffic/import", "POST /api/sicherung"];
const ADMIN = new Set(ROUTEN.filter((r) => r.code.includes("adminNoetig(")).map(schluessel));
// Statische Dateien, die ohne Anmeldung ausgeliefert werden (die Anmeldeseite und was sie braucht)
const OFFENE_DATEIEN = ["/login.html", "/login.js", "/app.css"];

// ---------- Server mit Wegwerf-Datenbank ----------
const PORT = 4100 + Math.floor(Math.random() * 90);
const verz = fs.mkdtempSync(path.join(os.tmpdir(), "parture-schutz-"));
const appdb = path.join(verz, "app.db");
{
  const d = new Database(appdb); bereiteVor(d);
  legeBenutzerAn(d, "niko", "ein-langes-passwort", new Date("2026-11-01T10:00:00Z"));
  legeBenutzerAn(d, "anna", "ein-langes-passwort", new Date("2026-11-02T10:00:00Z"));
  rollen.bereiteVor(d); // der älteste Benutzer (niko) wird Admin, anna ist Builder
  d.close();
}
const basis = `http://127.0.0.1:${PORT}`;
let server;
test.before(async () => {
  server = spawn(process.execPath, [path.join(import.meta.dirname, "server.mjs")], { env: { ...process.env, PM_OHNE_ENV: "1", PM_PORT: String(PORT), PM_APPDB: appdb, PM_DB: "", CF_ACCESS_TEAM_DOMAIN: "", CF_ACCESS_AUD: "", EBAY_SCHREIBEN: "", EBAY_APP_ID: "", EBAY_CERT_ID: "", EBAY_REFRESH_TOKEN: "", EBAY_TRAFFIC_AUTO: "", HUB_URL: "", PM_TOKEN: "", SICHERUNG_ORDNER: path.join(verz, "sicherung"), SICHERUNG_AUTO: "aus", TRAFFIC_CACHE: path.join(verz, "kein-cache.db") }, stdio: "ignore" });
  for (let i = 0; i < 50; i++) { try { if ((await fetch(basis + "/healthz")).ok) return; } catch { /* noch nicht bereit */ } await new Promise((r) => setTimeout(r, 100)); }
  throw new Error("Server startet nicht");
});
// Erst auf das Ende des Servers warten, dann löschen: unter Windows hält der laufende Prozess app.db offen (EBUSY).
test.after(async () => {
  if (server && server.exitCode === null) { const weg = new Promise((r) => server.once("exit", r)); server.kill(); await weg; }
  fs.rmSync(verz, { recursive: true, force: true });
});

const anfrage = (r, { cookie, kopf = {}, body = "{}" } = {}) => fetch(basis + r.pfad, r.methode === "POST"
  ? { method: "POST", headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}), ...kopf }, body }
  : { headers: { ...(cookie ? { Cookie: cookie } : {}), ...kopf } });
async function anmelden(name, kopf = {}) {
  const r = await fetch(basis + "/api/login", { method: "POST", headers: { "Content-Type": "application/json", ...kopf }, body: JSON.stringify({ name, passwort: "ein-langes-passwort" }) });
  assert.equal(r.status, 200);
  return { cookie: r.headers.get("set-cookie").split(";")[0], kopfzeile: r.headers.get("set-cookie") };
}

// ---------- Tests ----------
test("Routenliste: aus server.mjs gelesen, vollständig klassifiziert, öffentliche Liste ohne Leichen", (t) => {
  const alle = ROUTEN.map(schluessel);
  t.diagnostic(`${alle.length} Routen (Methode + Pfad), davon ${alle.filter((s) => s.includes(" /api/")).length} unter /api, ${ADMIN.size} nur für Admins, ${OEFFENTLICH.size} öffentlich`);
  assert.ok(alle.length >= 30, "der Parser findet die Routen nicht mehr (server.mjs umgebaut?) — dann diesen Test anpassen, nicht abschalten");
  assert.equal(new Set(alle).size, alle.length, "keine Route doppelt");
  for (const s of OEFFENTLICH) assert.ok(alle.includes(s), `${s} steht in OEFFENTLICH, gibt es aber nicht mehr`);
  for (const s of PFLICHT_ADMIN) assert.ok(ADMIN.has(s), `${s} muss adminNoetig(ctx) aufrufen`);
  for (const s of ADMIN) assert.ok(!OEFFENTLICH.has(s), `${s} ist Admin-Route und zugleich öffentlich`);
  // Die Anmeldeprüfung muss vor den Routentabellen stehen, sonst wären alle Routen ungeschützt.
  assert.ok(QUELLE.indexOf("if (!benutzer) {") < QUELLE.indexOf("POST_ROUTEN[url.pathname]"), "Anmeldeprüfung steht hinter der Routenauswahl");
});

test("jede nicht öffentliche Route: ohne Anmeldung 401", async () => {
  const geprueft = [];
  for (const r of ROUTEN.filter((x) => !OEFFENTLICH.has(schluessel(x)))) {
    const a = await anfrage(r);
    assert.equal(a.status, 401, `${schluessel(r)} ist ohne Anmeldung erreichbar (Status ${a.status})`);
    assert.equal(a.headers.get("set-cookie"), null);
    geprueft.push(schluessel(r));
  }
  assert.ok(geprueft.length >= 26, `nur ${geprueft.length} Routen geprüft`);
});

test("jede nicht öffentliche Route: ein erfundenes oder abgelaufenes Cookie öffnet nichts", async () => {
  for (const r of ROUTEN.filter((x) => !OEFFENTLICH.has(schluessel(x)))) {
    assert.equal((await anfrage(r, { cookie: "sitzung=" + "a".repeat(43) })).status, 401, schluessel(r));
  }
});

test("öffentliche Routen: ohne Anmeldung erreichbar, aber ohne Daten oder Wirkung", async () => {
  const h = await (await fetch(basis + "/healthz")).json();
  assert.deepEqual(Object.keys(h).sort(), ["ok", "version"]);
  const ich = (await (await fetch(basis + "/api/ich")).json()).daten;
  assert.deepEqual([ich.angemeldet, ich.name, ich.rolle], [false, null, null]);
  assert.equal((await anfrage({ methode: "POST", pfad: "/api/logout" })).status, 200, "Abmelden ohne Sitzung schadet nicht");
  assert.equal((await anfrage({ methode: "POST", pfad: "/api/login" }, { body: JSON.stringify({ name: "anna", passwort: "falsch-falsch" }) })).status, 401);
});

test("jede Admin-Route: Builder bekommt 403, und danach ist er immer noch Builder", async () => {
  const { cookie } = await anmelden("anna");
  for (const s of ADMIN) {
    const [methode, pfad] = s.split(" ");
    const a = await anfrage({ methode, pfad }, { cookie, body: JSON.stringify({ id: 1, art: "titel", name: "anna", rolle: "admin" }) });
    assert.equal(a.status, 403, `${s}: Builder bekommt ${a.status}`);
  }
  assert.equal((await (await fetch(basis + "/api/ich", { headers: { Cookie: cookie } })).json()).daten.rolle, "builder");
  assert.equal(fs.existsSync(path.join(verz, "sicherung")), false, "keine Sicherung durch einen Builder");
  // Gegenprobe: der Admin kommt durch (nur eine lesende Route, damit nichts ausgelöst wird)
  assert.equal((await fetch(basis + "/api/rollen", { headers: { Cookie: (await anmelden("niko")).cookie } })).status, 200);
});

test("eBay-Schreibschalter: keine Route und keine Einstellung kann EBAY_SCHREIBEN setzen, nur die .env des Servers", () => {
  for (const f of fs.readdirSync(import.meta.dirname).filter((n) => n.endsWith(".mjs") && !n.startsWith("test"))) {
    const q = fs.readFileSync(path.join(import.meta.dirname, f), "utf8");
    assert.doesNotMatch(q, /(process\.)?env(\[["']EBAY_SCHREIBEN["']\]|\.EBAY_SCHREIBEN)\s*=[^=]/, `${f} setzt EBAY_SCHREIBEN`);
  }
  assert.ok(!SCHEMA.some((f) => /ebay|schreib/i.test(f.key)), "kein Einstellungsfeld für den Schreibschalter");
});

test("CSRF: jede POST-Route lehnt eine fremde Herkunft (403) und einen falschen Typ (415) ab, auch mit gültiger Admin-Sitzung", async () => {
  const { cookie } = await anmelden("niko");
  const posts = ROUTEN.filter((r) => r.methode === "POST");
  for (const r of posts) {
    for (const origin of ["http://boese.example", "null", `http://127.0.0.1:${PORT + 1}`]) {
      const a = await anfrage(r, { cookie, kopf: { Origin: origin }, body: JSON.stringify({ name: "niko", passwort: "ein-langes-passwort", id: 1, art: "titel" }) });
      assert.equal(a.status, 403, `${schluessel(r)} mit Origin ${origin}: ${a.status}`);
    }
    const typ = await fetch(basis + r.pfad, { method: "POST", headers: { Cookie: cookie, "Content-Type": "text/plain" }, body: "{}" });
    assert.equal(typ.status, 415, `${schluessel(r)} mit text/plain: ${typ.status}`);
  }
  // Keiner der Versuche hatte eine Wirkung: auch /api/logout nicht, die Sitzung gilt noch.
  assert.equal((await (await fetch(basis + "/api/ich", { headers: { Cookie: cookie } })).json()).daten.angemeldet, true);
  assert.equal(fs.existsSync(path.join(verz, "sicherung")), false);
});

test("Formulare schicken nirgendwohin außer an die eigene App", () => {
  for (const f of fs.readdirSync(PUBLIC).filter((n) => n.endsWith(".html"))) {
    const html = fs.readFileSync(path.join(PUBLIC, f), "utf8");
    for (const m of html.matchAll(/<form\b[^>]*>/gi)) assert.doesNotMatch(m[0], /\baction\s*=\s*["']?(https?:)?\/\//i, `${f}: ${m[0]}`);
  }
  assert.match(QUELLE, /form-action 'self'/, "CSP verbietet fremde Formularziele");
});

test("statische Dateien: ohne Anmeldung nur die Anmeldeseite, alles andere 401", async () => {
  const offen = JSON.parse((QUELLE.match(/const offen = (\[[^\]]*\]);/) || [])[1] || "null");
  assert.deepEqual(offen, OFFENE_DATEIEN, "die Liste der offenen Dateien in server.mjs hat sich geändert");
  assert.equal((await fetch(basis + "/")).status, 200);
  assert.match(await (await fetch(basis + "/")).text(), /Sign in/);
  for (const f of fs.readdirSync(PUBLIC)) {
    const a = await fetch(basis + "/" + f);
    assert.equal(a.status, OFFENE_DATEIEN.includes("/" + f) ? 200 : 401, f);
  }
});

test("Cookie: HttpOnly und SameSite=Strict immer, Secure nur über HTTPS (hinter Cloudflare), Laufzeit begrenzt", async () => {
  const lokal = (await anmelden("anna")).kopfzeile;
  assert.match(lokal, /HttpOnly/); assert.match(lokal, /SameSite=Strict/); assert.match(lokal, /Path=\//);
  assert.doesNotMatch(lokal, /Secure/, "lokal über http://127.0.0.1 würde der Browser ein Secure-Cookie nicht zurückschicken");
  assert.match(lokal, new RegExp(`Max-Age=${SITZUNG_STUNDEN * 3600}(;|$)`));
  assert.ok(SITZUNG_STUNDEN <= 12, "Sitzung höchstens 12 Stunden");
  const https = (await anmelden("anna", { "X-Forwarded-Proto": "https" })).kopfzeile;
  assert.match(https, /; Secure/); assert.match(https, /HttpOnly/); assert.match(https, /SameSite=Strict/);
  const { cookie } = await anmelden("anna");
  const weg = await fetch(basis + "/api/logout", { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie }, body: "{}" });
  assert.match(weg.headers.get("set-cookie"), /Max-Age=0/, "beim Abmelden wird das Cookie gelöscht");
  assert.equal((await fetch(basis + "/api/stand", { headers: { Cookie: cookie } })).status, 401, "und die Sitzung ist serverseitig weg");
});

test("Cloudflare Access: mit gesetzter Aud nur mit gültigem JWT — fehlt, falsche Aud, abgelaufen, alg none, nicht prüfbare Signatur: 401", async () => {
  const port = PORT + 100, b = `http://127.0.0.1:${port}`;
  // Team-Domain zeigt auf eine Adresse ohne Dienst: die Schlüssel sind nicht abrufbar, die Signatur also nie prüfbar → muss ablehnen
  const s = spawn(process.execPath, [path.join(import.meta.dirname, "server.mjs")], { env: { ...process.env, PM_OHNE_ENV: "1", PM_PORT: String(port), PM_APPDB: path.join(verz, "access.db"), PM_DB: "", CF_ACCESS_TEAM_DOMAIN: "127.0.0.1:1", CF_ACCESS_AUD: "aud-test", SICHERUNG_AUTO: "aus", EBAY_SCHREIBEN: "", EBAY_APP_ID: "" }, stdio: "ignore" });
  try {
    let bereit = false;
    for (let i = 0; i < 50 && !bereit; i++) { try { bereit = (await fetch(b + "/healthz")).ok; } catch { await new Promise((r) => setTimeout(r, 100)); } }
    assert.ok(bereit, "Server mit Access startet nicht");
    const teil = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const jwt = (kopf, last) => `${teil(kopf)}.${teil(last)}.${Buffer.from("keine-echte-signatur").toString("base64url")}`;
    const spaeter = Math.floor(Date.now() / 1000) + 3600, frueher = Math.floor(Date.now() / 1000) - 60;
    const faelle = {
      "ohne Token": null,
      "kein JWT": "abc",
      "alg none": jwt({ alg: "none", kid: "k" }, { aud: ["aud-test"], exp: spaeter }),
      "falsche Aud": jwt({ alg: "RS256", kid: "k" }, { aud: ["andere-app"], exp: spaeter }),
      "abgelaufen": jwt({ alg: "RS256", kid: "k" }, { aud: ["aud-test"], exp: frueher }),
      "Signatur nicht prüfbar": jwt({ alg: "RS256", kid: "k" }, { aud: "aud-test", exp: spaeter }),
    };
    for (const [fall, tok] of Object.entries(faelle)) {
      for (const p of ["/", "/login.html", "/api/ich", "/api/stand"]) {
        const r = await fetch(b + p, { headers: tok ? { "Cf-Access-Jwt-Assertion": tok } : {} });
        assert.equal(r.status, 401, `${fall}: ${p} → ${r.status}`);
      }
      const login = await fetch(b + "/api/login", { method: "POST", headers: { "Content-Type": "application/json", ...(tok ? { "Cf-Access-Jwt-Assertion": tok } : {}) }, body: JSON.stringify({ name: "x", passwort: "y" }) });
      assert.equal(login.status, 401, `${fall}: /api/login`);
    }
    assert.equal((await fetch(b + "/healthz")).status, 200, "nur das Lebenszeichen für den Wächter bleibt offen");
  } finally {
    if (s.exitCode === null) { const weg = new Promise((r) => s.once("exit", r)); s.kill(); await weg; }
  }
});
