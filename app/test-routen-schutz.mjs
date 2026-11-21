// Route protection for ALL addresses (checklist A3.2, A3.4, A3.5, A3.9): the list is read from server.mjs, not maintained by hand.
// If a new route is added, it is checked here automatically: 401 without a login, 403 with a builder session on an admin route.
// If it is unprotected and not in OEFFENTLICH (public), the test fails. Nothing is ever written to eBay (no credentials, switch off).
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

// ---------- Route list from the source text ----------
// An object block "const NAME = { ... };" → per key the text up to the next key (that is how adminNoetig is recognised).
function block(name) {
  const start = QUELLE.indexOf(`const ${name} = {`);
  assert.ok(start >= 0, `${name} nicht in server.mjs gefunden`);
  const ende = QUELLE.indexOf("\n};", start);
  const text = QUELLE.slice(start, ende);
  const treffer = [...text.matchAll(/^ {2}"(\/[^"]+)":/gm)];
  return treffer.map((m, i) => ({ pfad: m[1], code: text.slice(m.index, treffer[i + 1]?.index ?? text.length) }));
}
// Addresses handled directly in the request handler (login, password, logout, me, healthz): the method is in the same line.
const inline = [...QUELLE.matchAll(/^.*url\.pathname === "(\/(?:api\/[^"]+|healthz))".*$/gm)]
  .map((m) => ({ methode: /req\.method === "POST"/.test(m[0]) ? "POST" : "GET", pfad: m[1], code: m[0] }));
const ROUTEN = [
  ...block("ROUTEN").map((r) => ({ methode: "GET", ...r })),
  ...block("POST_ROUTEN").map((r) => ({ methode: "POST", ...r })),
  ...inline,
];
const schluessel = (r) => `${r.methode} ${r.pfad}`;

// Deliberately reachable without a login. Whoever adds something here must justify it in the review.
const OEFFENTLICH = new Set([
  "GET /healthz",      // Lebenszeichen für den Wächter: nur { ok, version }
  "POST /api/login",   // Anmeldung selbst
  "GET /api/ich",      // sagt der Oberfläche nur, ob jemand angemeldet ist
  "POST /api/logout",  // löscht nur die Sitzung des mitgeschickten Cookies, ohne Cookie passiert nichts
]);
// These routes MUST be admin only (checklist A3.9). Further admin routes are recognised from adminNoetig and checked as well.
const PFLICHT_ADMIN = ["GET /api/rollen", "POST /api/rolle", "POST /api/freigabe/erteilen", "POST /api/freigabe/ablehnen", "POST /api/experiment/start", "POST /api/traffic/import", "POST /api/sicherung"];
const ADMIN = new Set(ROUTEN.filter((r) => r.code.includes("adminNoetig(")).map(schluessel));
// Static files that are delivered without a login (the login page and what it needs)
const OFFENE_DATEIEN = ["/login.html", "/login.js", "/app.css"];

// ---------- Server with a throw-away database ----------
const PORT = 4100 + Math.floor(Math.random() * 90);
const verz = fs.mkdtempSync(path.join(os.tmpdir(), "parture-schutz-"));
const appdb = path.join(verz, "app.db");
{
  const d = new Database(appdb); bereiteVor(d);
  legeBenutzerAn(d, "niko", "ein-langes-passwort", new Date("2026-11-01T10:00:00Z"));
  legeBenutzerAn(d, "anna", "ein-langes-passwort", new Date("2026-11-02T10:00:00Z"));
  rollen.bereiteVor(d); // the oldest user (niko) becomes admin, anna is a builder
  d.close();
}
const basis = `http://127.0.0.1:${PORT}`;
let server;
test.before(async () => {
  server = spawn(process.execPath, [path.join(import.meta.dirname, "server.mjs")], { env: { ...process.env, PM_OHNE_ENV: "1", PM_PORT: String(PORT), PM_APPDB: appdb, PM_DB: "", CF_ACCESS_TEAM_DOMAIN: "", CF_ACCESS_AUD: "", EBAY_SCHREIBEN: "", EBAY_APP_ID: "", EBAY_CERT_ID: "", EBAY_REFRESH_TOKEN: "", EBAY_TRAFFIC_AUTO: "", HUB_URL: "", PM_TOKEN: "", SICHERUNG_ORDNER: path.join(verz, "sicherung"), SICHERUNG_AUTO: "aus", TRAFFIC_CACHE: path.join(verz, "kein-cache.db") }, stdio: "ignore" });
  for (let i = 0; i < 900; i++) { try { if ((await fetch(basis + "/healthz")).ok) return; } catch { /* noch nicht bereit */ } await new Promise((r) => setTimeout(r, 100)); }
  throw new Error("Server startet nicht");
});
// First wait for the end of the server, then delete: on Windows the running process keeps app.db open (EBUSY).
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
test("Route list: read from server.mjs, completely classified, public list without dead entries", (t) => {
  const alle = ROUTEN.map(schluessel);
  t.diagnostic(`${alle.length} Routen (Methode + Pfad), davon ${alle.filter((s) => s.includes(" /api/")).length} unter /api, ${ADMIN.size} nur für Admins, ${OEFFENTLICH.size} öffentlich`);
  assert.ok(alle.length >= 30, "the parser no longer finds the routes (server.mjs rebuilt?) — then adapt this test, do not switch it off");
  assert.equal(new Set(alle).size, alle.length, "no route twice");
  for (const s of OEFFENTLICH) assert.ok(alle.includes(s), `${s} steht in OEFFENTLICH, gibt es aber nicht mehr`);
  for (const s of PFLICHT_ADMIN) assert.ok(ADMIN.has(s), `${s} muss adminNoetig(ctx) aufrufen`);
  for (const s of ADMIN) assert.ok(!OEFFENTLICH.has(s), `${s} ist Admin-Route und zugleich öffentlich`);
  // The login check must come before the route tables, otherwise all routes would be unprotected.
  assert.ok(QUELLE.indexOf("if (!benutzer) {") < QUELLE.indexOf("POST_ROUTEN[url.pathname]"), "the login check comes after the route selection");
});

test("every non-public route: 401 without login", async () => {
  const geprueft = [];
  for (const r of ROUTEN.filter((x) => !OEFFENTLICH.has(schluessel(x)))) {
    const a = await anfrage(r);
    assert.equal(a.status, 401, `${schluessel(r)} ist ohne Anmeldung erreichbar (Status ${a.status})`);
    assert.equal(a.headers.get("set-cookie"), null);
    geprueft.push(schluessel(r));
  }
  assert.ok(geprueft.length >= 26, `nur ${geprueft.length} Routen geprüft`);
});

test("every non-public route: an invented or expired cookie opens nothing", async () => {
  for (const r of ROUTEN.filter((x) => !OEFFENTLICH.has(schluessel(x)))) {
    assert.equal((await anfrage(r, { cookie: "sitzung=" + "a".repeat(43) })).status, 401, schluessel(r));
  }
});

test("public routes: reachable without login, but without data or effect", async () => {
  const h = await (await fetch(basis + "/healthz")).json();
  assert.deepEqual(Object.keys(h).sort(), ["ok", "version"]);
  const ich = (await (await fetch(basis + "/api/ich")).json()).daten;
  assert.deepEqual([ich.angemeldet, ich.name, ich.rolle], [false, null, null]);
  assert.equal((await anfrage({ methode: "POST", pfad: "/api/logout" })).status, 200, "logging out without a session does no harm");
  assert.equal((await anfrage({ methode: "POST", pfad: "/api/login" }, { body: JSON.stringify({ name: "anna", passwort: "falsch-falsch" }) })).status, 401);
});

test("every admin route: a builder gets 403, and is still a builder afterwards", async () => {
  const { cookie } = await anmelden("anna");
  for (const s of ADMIN) {
    const [methode, pfad] = s.split(" ");
    const a = await anfrage({ methode, pfad }, { cookie, body: JSON.stringify({ id: 1, art: "titel", name: "anna", rolle: "admin" }) });
    assert.equal(a.status, 403, `${s}: Builder bekommt ${a.status}`);
  }
  assert.equal((await (await fetch(basis + "/api/ich", { headers: { Cookie: cookie } })).json()).daten.rolle, "builder");
  assert.equal(fs.existsSync(path.join(verz, "sicherung")), false, "no backup by a builder");
  // Counter-check: the admin gets through (only a reading route, so that nothing is triggered)
  assert.equal((await fetch(basis + "/api/rollen", { headers: { Cookie: (await anmelden("niko")).cookie } })).status, 200);
});

test("eBay write switch: no route and no setting can set EBAY_SCHREIBEN, only the server's .env", () => {
  for (const f of fs.readdirSync(import.meta.dirname).filter((n) => n.endsWith(".mjs") && !n.startsWith("test"))) {
    const q = fs.readFileSync(path.join(import.meta.dirname, f), "utf8");
    assert.doesNotMatch(q, /(process\.)?env(\[["']EBAY_SCHREIBEN["']\]|\.EBAY_SCHREIBEN)\s*=[^=]/, `${f} setzt EBAY_SCHREIBEN`);
  }
  assert.ok(!SCHEMA.some((f) => /ebay|schreib/i.test(f.key)), "no settings field for the write switch");
});

test("CSRF: every POST route rejects a foreign origin (403) and a wrong type (415), even with a valid admin session", async () => {
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
  // None of the attempts had an effect: not even /api/logout, the session is still valid.
  assert.equal((await (await fetch(basis + "/api/ich", { headers: { Cookie: cookie } })).json()).daten.angemeldet, true);
  assert.equal(fs.existsSync(path.join(verz, "sicherung")), false);
});

test("Forms send nowhere except to the app itself", () => {
  for (const f of fs.readdirSync(PUBLIC).filter((n) => n.endsWith(".html"))) {
    const html = fs.readFileSync(path.join(PUBLIC, f), "utf8");
    for (const m of html.matchAll(/<form\b[^>]*>/gi)) assert.doesNotMatch(m[0], /\baction\s*=\s*["']?(https?:)?\/\//i, `${f}: ${m[0]}`);
  }
  assert.match(QUELLE, /form-action 'self'/, "CSP verbietet fremde Formularziele");
});

test("static files: without login only the login page, everything else 401", async () => {
  const offen = JSON.parse((QUELLE.match(/const offen = (\[[^\]]*\]);/) || [])[1] || "null");
  assert.deepEqual(offen, OFFENE_DATEIEN, "the list of open files in server.mjs has changed");
  assert.equal((await fetch(basis + "/")).status, 200);
  assert.match(await (await fetch(basis + "/")).text(), /Sign in/);
  for (const f of fs.readdirSync(PUBLIC)) {
    const a = await fetch(basis + "/" + f);
    assert.equal(a.status, OFFENE_DATEIEN.includes("/" + f) ? 200 : 401, f);
  }
});

test("Cookie: HttpOnly and SameSite=Strict always, Secure only over HTTPS (behind Cloudflare), limited lifetime", async () => {
  const lokal = (await anmelden("anna")).kopfzeile;
  assert.match(lokal, /HttpOnly/); assert.match(lokal, /SameSite=Strict/); assert.match(lokal, /Path=\//);
  assert.doesNotMatch(lokal, /Secure/, "locally over http://127.0.0.1 the browser would not send a Secure cookie back");
  assert.match(lokal, new RegExp(`Max-Age=${SITZUNG_STUNDEN * 3600}(;|$)`));
  assert.ok(SITZUNG_STUNDEN <= 12, "session 12 hours at most");
  const https = (await anmelden("anna", { "X-Forwarded-Proto": "https" })).kopfzeile;
  assert.match(https, /; Secure/); assert.match(https, /HttpOnly/); assert.match(https, /SameSite=Strict/);
  const { cookie } = await anmelden("anna");
  const weg = await fetch(basis + "/api/logout", { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie }, body: "{}" });
  assert.match(weg.headers.get("set-cookie"), /Max-Age=0/, "on logout the cookie is deleted");
  assert.equal((await fetch(basis + "/api/stand", { headers: { Cookie: cookie } })).status, 401, "and the session is gone on the server");
});

test("Cloudflare Access: with the aud set only with a valid JWT — missing, wrong aud, expired, alg none, unverifiable signature: 401", async () => {
  const port = PORT + 100, b = `http://127.0.0.1:${port}`;
  // The team domain points to an address without a service: the keys cannot be fetched, so the signature can never be verified → must refuse
  const s = spawn(process.execPath, [path.join(import.meta.dirname, "server.mjs")], { env: { ...process.env, PM_OHNE_ENV: "1", PM_PORT: String(port), PM_APPDB: path.join(verz, "access.db"), PM_DB: "", CF_ACCESS_TEAM_DOMAIN: "127.0.0.1:1", CF_ACCESS_AUD: "aud-test", SICHERUNG_AUTO: "aus", EBAY_SCHREIBEN: "", EBAY_APP_ID: "" }, stdio: "ignore" });
  try {
    let bereit = false;
    for (let i = 0; i < 50 && !bereit; i++) { try { bereit = (await fetch(b + "/healthz")).ok; } catch { await new Promise((r) => setTimeout(r, 100)); } }
    assert.ok(bereit, "server with Access does not start");
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
    assert.equal((await fetch(b + "/healthz")).status, 200, "only the sign of life for the watcher stays open");
  } finally {
    if (s.exitCode === null) { const weg = new Promise((r) => s.once("exit", r)); s.kill(); await weg; }
  }
});
