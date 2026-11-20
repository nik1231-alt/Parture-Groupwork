// XSS (checklist A3.6): a listing title with <script> must never get into the page as HTML.
// Three latches: (1) the interface inserts data only through textContent (static check of public/), (2) the API delivers JSON with
// nosniff, never HTML, (3) the CSP allows only scripts from the app itself, so injected inline scripts would not run even then.
// The server runs with a copy of the team data in which one title contains a script.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { bereiteVor, legeBenutzerAn } from "./login.mjs";

const WURZEL = path.join(import.meta.dirname, "..");
const PUBLIC = path.join(WURZEL, "public");
const BOESE = `<script>alert("xss")</script> Holder <img src=x onerror=alert(1)>`;

// ---------- static: the interface ----------
test("Interface: no innerHTML, outerHTML, insertAdjacentHTML, document.write, eval or new Function in public/*.js", () => {
  const verboten = /\.(innerHTML|outerHTML)\s*[+]?=|insertAdjacentHTML|document\.write|\beval\s*\(|new\s+Function\s*\(|createContextualFragment|DOMParser|javascript:/;
  const dateien = fs.readdirSync(PUBLIC).filter((f) => f.endsWith(".js"));
  assert.ok(dateien.length >= 3, "public/*.js nicht gefunden");
  for (const f of dateien) {
    fs.readFileSync(path.join(PUBLIC, f), "utf8").split(/\r?\n/).forEach((z, i) => {
      if (/^\s*\/\//.test(z)) return; // Comments may name the words
      assert.doesNotMatch(z, verboten, `${f}:${i + 1}: ${z.trim().slice(0, 120)}`);
    });
  }
});

test("Interface: the el() helper sets text only via textContent, images only from https", () => {
  const app = fs.readFileSync(path.join(PUBLIC, "app.js"), "utf8");
  assert.match(app, /if \(k === "text"\) n\.textContent = v;/, "el({ text }) muss textContent benutzen");
  assert.match(app, /for \(const kind of kinder\.flat\(\)\) if \(kind != null\) n\.append\(kind\);/, "Kinder werden per append eingesetzt (Zeichenketten werden dabei zu Textknoten)");
  assert.match(app, /const bildUrl = \(u\) => \(typeof u === "string" && \/\^https:\\\/\\\/\/i\.test\(u\) \? u : null\);/, "Bildadressen nur mit https://");
});

test("Interface: HTML pages have no inline scripts and no on…= handlers (the CSP would block them anyway)", () => {
  for (const f of fs.readdirSync(PUBLIC).filter((n) => n.endsWith(".html"))) {
    const html = fs.readFileSync(path.join(PUBLIC, f), "utf8");
    for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      // own file, at most with a version number (?v=…), so that a rollout does not get stuck on the cache
      assert.match(m[1], /\bsrc="\/[\w.-]+\.js(\?v=[\w.-]+)?"/, `${f}: Skript ohne eigene Datei`);
      assert.equal(m[2].trim(), "", `${f}: Inline-Skript`);
    }
    assert.doesNotMatch(html, /\son[a-z]+\s*=/i, `${f}: Inline-Handler`);
  }
});

// ---------- Server with prepared data ----------
const PORT = 4200 + Math.floor(Math.random() * 90);
const verz = fs.mkdtempSync(path.join(os.tmpdir(), "parture-xss-"));
const appdb = path.join(verz, "app.db"), pmdb = path.join(verz, "pm.db");
fs.copyFileSync(path.join(WURZEL, "daten-team", "pm.db"), pmdb);
let NR;
{
  const p = new Database(pmdb);
  NR = p.prepare("SELECT number FROM produkt ORDER BY units_90d DESC LIMIT 1").get().number;
  p.prepare("UPDATE produkt SET title = ? WHERE number = ?").run(BOESE, NR);
  p.prepare("UPDATE kanal SET title = ? WHERE number = ?").run(BOESE, NR);
  p.close();
  const d = new Database(appdb); bereiteVor(d); legeBenutzerAn(d, "anna", "ein-langes-passwort"); d.close();
}
const basis = `http://127.0.0.1:${PORT}`;
let server;
test.before(async () => {
  server = spawn(process.execPath, [path.join(import.meta.dirname, "server.mjs")], { env: { ...process.env, PM_OHNE_ENV: "1", PM_PORT: String(PORT), PM_APPDB: appdb, PM_DB: pmdb, CF_ACCESS_TEAM_DOMAIN: "", CF_ACCESS_AUD: "", EBAY_SCHREIBEN: "", EBAY_APP_ID: "", EBAY_CERT_ID: "", EBAY_REFRESH_TOKEN: "", SICHERUNG_AUTO: "aus", SICHERUNG_ORDNER: path.join(verz, "s") }, stdio: "ignore" });
  for (let i = 0; i < 900; i++) { try { if ((await fetch(basis + "/healthz")).ok) return; } catch { /* noch nicht bereit */ } await new Promise((r) => setTimeout(r, 100)); }
  throw new Error("Server startet nicht");
});
// First wait for the end of the server, then delete: on Windows the running process keeps app.db open (EBUSY).
test.after(async () => {
  if (server && server.exitCode === null) { const weg = new Promise((r) => server.once("exit", r)); server.kill(); await weg; }
  fs.rmSync(verz, { recursive: true, force: true });
});
async function anmelden() {
  const r = await fetch(basis + "/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "anna", passwort: "ein-langes-passwort" }) });
  assert.equal(r.status, 200);
  return r.headers.get("set-cookie").split(";")[0];
}
const istJson = (r) => { assert.match(r.headers.get("content-type"), /^application\/json/); assert.equal(r.headers.get("x-content-type-options"), "nosniff"); };

test("API: a title with <script> comes back as JSON text, unchanged, never as HTML", async () => {
  const c = await anmelden();
  const liste = await fetch(basis + "/api/produkte?q=" + encodeURIComponent("<script>"), { headers: { Cookie: c } });
  istJson(liste);
  const treffer = (await liste.json()).daten;
  assert.deepEqual(treffer.map((p) => [p.number, p.title]), [[NR, BOESE]], "der Titel ist Text, er wird weder ausgeführt noch verändert");
  const einzel = await fetch(basis + "/api/produkt?nr=" + encodeURIComponent(NR), { headers: { Cookie: c } });
  istJson(einzel);
  assert.equal((await einzel.json()).daten.title, BOESE);
  const bew = await fetch(basis + "/api/bewertung", { headers: { Cookie: c } });
  istJson(bew);
  assert.ok((await bew.text()).includes(JSON.stringify(BOESE).slice(1, -1)));
  const fehlt = await fetch(basis + "/api/produkt?nr=" + encodeURIComponent(BOESE), { headers: { Cookie: c } });
  assert.equal(fehlt.status, 404); istJson(fehlt);
});

test("CSP: every HTML response allows only scripts from the app itself (script-src 'self', no unsafe-inline/eval)", async () => {
  const c = await anmelden();
  const seiten = [["/", null], ["/login.html", null], ["/", c], ["/index.html", c]];
  for (const [p, cookie] of seiten) {
    const r = await fetch(basis + p, { headers: cookie ? { Cookie: cookie } : {} });
    assert.equal(r.status, 200, p);
    assert.match(r.headers.get("content-type"), /^text\/html/, p);
    const csp = r.headers.get("content-security-policy") || "";
    const regeln = Object.fromEntries(csp.split(";").map((t) => t.trim().split(/\s+/)).map(([k, ...w]) => [k, w]));
    assert.deepEqual(regeln["script-src"], ["'self'"], `${p}: ${csp}`);
    assert.deepEqual(regeln["default-src"], ["'self'"], p);
    assert.deepEqual(regeln["frame-ancestors"], ["'none'"], p);
    assert.deepEqual(regeln["base-uri"], ["'none'"], p);
    assert.equal(r.headers.get("x-frame-options"), "DENY", p);
    assert.equal(r.headers.get("x-content-type-options"), "nosniff", p);
  }
});
