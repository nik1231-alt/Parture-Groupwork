// Interface English only (checklist A1.11): visible texts in public/ and error messages of the modules that reach the interface
// contain no umlauts and no ß. Comments are English as well; they are removed beforehand anyway so that only strings are checked.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const WURZEL = path.join(import.meta.dirname, "..");
const DEUTSCH = /[äöüÄÖÜß]/;

// Splits JavaScript roughly into strings ('…', "…", `…`) and skips comments. Regex literals are not recognised;
// none of the files here contains a quotation mark in one, and a mistake would make the test turn red rather than wrongly green.
function zeichenketten(quelle) {
  const aus = []; let i = 0;
  while (i < quelle.length) {
    const c = quelle[i], n = quelle[i + 1];
    if (c === "/" && n === "/") { const e = quelle.indexOf("\n", i); i = e < 0 ? quelle.length : e; continue; }
    if (c === "/" && n === "*") { const e = quelle.indexOf("*/", i + 2); i = e < 0 ? quelle.length : e + 2; continue; }
    if (c === '"' || c === "'" || c === "`") {
      let j = i + 1, text = "";
      while (j < quelle.length && quelle[j] !== c) { if (quelle[j] === "\\") { text += quelle[j + 1]; j += 2; continue; } if (c !== "`" && quelle[j] === "\n") break; text += quelle[j]; j++; }
      aus.push({ text, zeile: quelle.slice(0, i).split("\n").length }); i = j + 1; continue;
    }
    i++;
  }
  return aus;
}

test("Splitter: finds strings and skips comments (also with umlauts and addresses)", () => {
  const z = zeichenketten('// Kommentar mit Ä\nconst a = "eins"; /* Größe */ const b = `zwei ${x}`; const u = "https://x.y/z"; // noch ein Ö');
  assert.deepEqual(z.map((x) => x.text), ["eins", "zwei ${x}", "https://x.y/z"]);
  assert.ok(zeichenketten('const t = "Fehler: ungültig";').some((x) => DEUTSCH.test(x.text)), "a German text would be found");
});

test("public/*.js: no umlauts or ß in strings (everything visible is English)", () => {
  const funde = [];
  for (const f of fs.readdirSync(path.join(WURZEL, "public")).filter((x) => x.endsWith(".js")))
    for (const z of zeichenketten(fs.readFileSync(path.join(WURZEL, "public", f), "utf8"))) if (DEUTSCH.test(z.text)) funde.push(`${f}:${z.zeile} ${z.text.slice(0, 80)}`);
  assert.deepEqual(funde, []);
});

test("public/*.html: no umlauts or ß outside comments", () => {
  const funde = [];
  for (const f of fs.readdirSync(path.join(WURZEL, "public")).filter((x) => x.endsWith(".html"))) {
    const ohne = fs.readFileSync(path.join(WURZEL, "public", f), "utf8").replace(/<!--[\s\S]*?-->/g, "");
    ohne.split("\n").forEach((zeile, i) => { if (DEUTSCH.test(zeile)) funde.push(`${f}:${i + 1} ${zeile.trim().slice(0, 80)}`); });
  }
  assert.deepEqual(funde, []);
});

test("app/*.mjs: error messages to the interface (new Error, fehler(status, …)) are English", () => {
  // Only files whose messages reach the interface through the server (command-line tools such as benutzer.mjs and waechter.mjs are English too, but do not reach the interface)
  const ui = ["auswertung", "bewertung", "demo", "ebay-schreiben", "einstellungen", "experimente", "export-ebay", "freigabe", "login", "protokoll", "regeln", "rollen", "server", "sicherung", "titelhilfe", "traffic"];
  const muster = /(?:new Error|fehler)\(\s*(?:\d+\s*,\s*)?(["'`])((?:\\.|(?!\1).)*)\1/g;
  const woerter = /\b(nicht|nur|fehlt|gefunden|antwortet|bitte|unter|kein|keine|ungültig)\b/i;
  const funde = [];
  for (const name of ui) {
    const q = fs.readFileSync(path.join(WURZEL, "app", name + ".mjs"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((z) => z.replace(/(^|\s)\/\/.*$/, "")).join("\n");
    for (const m of q.matchAll(muster)) if (DEUTSCH.test(m[2]) || woerter.test(m[2])) funde.push(`${name}.mjs: ${m[2].slice(0, 80)}`);
  }
  assert.deepEqual(funde, []);
});

// Loading indicator (public/app.js): the part between the heading "Loading indicator" and apiRoh runs here against a
// tiny stand-in for the page. It must switch the bar on only for slow requests, keep it across requests that follow
// each other directly, and remove leftover placeholders when the last request is done (also after an error).
test("Loading indicator: bar after 150 ms, stays across chained requests, placeholders removed at the end", async () => {
  const quelle = fs.readFileSync(path.join(WURZEL, "public", "app.js"), "utf8");
  const teil = quelle.slice(quelle.indexOf("let offeneAnfragen"), quelle.indexOf("async function apiRoh"));
  assert.ok(teil.includes("function skelett") && teil.includes("async function api("), "the block was found");
  const klassen = new Set(); let platzhalter = 1, antwort;
  const balken = { classList: { add: (k) => klassen.add(k), remove: (k) => klassen.delete(k) } };
  const dokument = { querySelectorAll: () => (platzhalter ? [{ remove: () => { platzhalter = 0; } }] : []) };
  const api = new Function("$", "document", "apiRoh", "el", teil + "; return api;")(() => balken, dokument, () => antwort, () => ({}));
  const warte = (ms) => new Promise((r) => setTimeout(r, ms));

  antwort = Promise.resolve(1);                       // fast answer: no bar
  await api("/a"); await warte(200);
  assert.equal(klassen.has("an"), false, "a fast answer shows no bar");
  assert.equal(platzhalter, 0, "placeholders are removed when the request is done");

  antwort = Promise.resolve(1);                       // two fast answers directly after each other: still no bar, also later
  await api("/a1"); await api("/a2"); await warte(250);
  assert.equal(klassen.has("an"), false, "fast answers in a row leave no bar behind");

  platzhalter = 1; antwort = warte(250).then(() => 2); // slow answer: bar on, and it stays for the request that follows directly
  const erste = api("/b"); await warte(200);
  assert.equal(klassen.has("an"), true, "a slow answer shows the bar");
  await erste; antwort = warte(100).then(() => 3); const zweite = api("/c"); await warte(20);
  assert.equal(klassen.has("an"), true, "the bar stays for a request that follows directly");
  assert.equal(platzhalter, 1, "placeholders stay as long as a request is open");
  await zweite; await warte(20);
  assert.equal(klassen.has("an"), false, "the bar goes when the last request is done");

  platzhalter = 1; antwort = Promise.reject(new Error("down")); // an error ends the display as well
  await assert.rejects(api("/d")); await warte(20);
  assert.equal(platzhalter, 0, "placeholders are removed after an error");
  assert.equal(klassen.has("an"), false);
});

test("Loading indicator: the page has the bar, and motion is switched off for people who asked for less of it", () => {
  assert.match(fs.readFileSync(path.join(WURZEL, "public", "index.html"), "utf8"), /id="ladebalken"/);
  // The tour for builders: its place is in the page, admins never get it, and every page it names exists in the menu.
  const seite = fs.readFileSync(path.join(WURZEL, "public", "index.html"), "utf8"), skript = fs.readFileSync(path.join(WURZEL, "public", "app.js"), "utf8");
  assert.match(seite, /id="rundgang"[^>]*hidden/);
  assert.match(skript, /if \(!ort \|\| istAdmin\(\) \|\| versteckt\) return;/);
  const ziele = [...skript.match(/const RUNDGANG = (\[\[.*\]\]);/)[1].matchAll(/\["#([a-z]+)"/g)].map((m) => m[1]);
  assert.equal(ziele.length, 4);
  for (const z of ziele) assert.match(seite, new RegExp(`href="#${z}"`), `the tour names #${z}, which is not in the menu`);
  const css = fs.readFileSync(path.join(WURZEL, "public", "app.css"), "utf8");
  assert.ok(css.includes("prefers-reduced-motion: reduce) { .skelett, .skelett-teil { animation: none"));
});

// Thumbnails (public/app.js): pictures of the shop's image server are asked for in a small size; everything else stays as it is.
test("Thumbnails: the shop's image server gets a width, other addresses stay unchanged, non-https stays out", () => {
  const quelle = fs.readFileSync(path.join(WURZEL, "public", "app.js"), "utf8");
  const zeilen = quelle.split("\n").filter((z) => z.startsWith("const bildUrl = ") || z.startsWith("const vorschauBild = "));
  assert.equal(zeilen.length, 2);
  const vorschauBild = new Function(zeilen.join("\n") + "; return vorschauBild;")();
  assert.equal(vorschauBild("https://cdn.shopify.com/s/files/1/a.jpg?v=1"), "https://cdn.shopify.com/s/files/1/a.jpg?v=1&width=96");
  assert.equal(vorschauBild("https://cdn.shopify.com/s/files/1/a.jpg"), "https://cdn.shopify.com/s/files/1/a.jpg?width=96");
  assert.equal(vorschauBild("https://cdn.shopify.com/a.jpg?width=400"), "https://cdn.shopify.com/a.jpg?width=400", "a width that is there is kept");
  assert.equal(vorschauBild("https://i.ebayimg.com/images/g/x/s-l500.jpg"), "https://i.ebayimg.com/images/g/x/s-l500.jpg");
  assert.equal(vorschauBild("http://cdn.shopify.com/a.jpg"), null);
  assert.equal(vorschauBild("javascript:alert(1)"), null);
  assert.equal(vorschauBild(null), null);
  assert.equal(quelle.split("\n").filter((z) => /= bildUrl\(/.test(z) && !z.startsWith("const vorschauBild")).length, 0, "every picture goes through vorschauBild");
});

test("Log: every action the server writes has an English label in the interface", () => {
  const app = fs.readFileSync(path.join(WURZEL, "public", "app.js"), "utf8");
  const tabelle = app.slice(app.indexOf("const LOG_TEXT = {"), app.indexOf("};", app.indexOf("const LOG_TEXT = {")));
  const aktionen = new Set();
  for (const f of fs.readdirSync(path.join(WURZEL, "app")).filter((d) => d.endsWith(".mjs") && !d.startsWith("test"))) {
    for (const m of fs.readFileSync(path.join(WURZEL, "app", f), "utf8").matchAll(/aktion: "([a-z_]+)"(?! \+)/g)) aktionen.add(m[1]);
  }
  assert.ok(aktionen.size > 20, "the actions were found");
  const ohne = [...aktionen].filter((a) => !new RegExp("\\b" + a + ": \"").test(tabelle));
  assert.deepEqual(ohne, [], "actions without a label would show their raw name in the Log");
});

// Two-step button (public/app.js): the second click executes, and until the action is done further clicks do nothing.
test("Two-step button: asks first, runs once, is locked while the action runs, is usable again afterwards", async () => {
  // Line ends made equal first: on the Windows server the file is checked out with CRLF, and the end of the function was not found
  // (the server refused the rollout of e46dfe8 for this test, while CI on Linux was green).
  const app = fs.readFileSync(path.join(WURZEL, "public", "app.js"), "utf8").replace(/\r\n/g, "\n");
  const start = app.indexOf("function zweiStufig("), teil = app.slice(start, app.indexOf("\n}\n", start) + 3);
  const zweiStufig = new Function(teil + "; return zweiStufig;")();
  let klick; const knopf = { textContent: "Next phase", dataset: {}, disabled: false, addEventListener: (_, f) => { klick = () => { if (!knopf.disabled) f(); }; } };
  let laeufe = 0, fertig;
  zweiStufig(knopf, "Really?", () => { laeufe++; return new Promise((r) => { fertig = r; }); });
  klick();
  assert.equal(knopf.textContent, "Really?"); assert.equal(laeufe, 0, "the first click only asks");
  klick(); await new Promise((r) => setTimeout(r, 5));
  assert.equal(laeufe, 1); assert.equal(knopf.disabled, true, "locked while the action runs");
  klick(); klick(); await new Promise((r) => setTimeout(r, 5));
  assert.equal(laeufe, 1, "more clicks during the action send nothing");
  fertig(); await new Promise((r) => setTimeout(r, 5));
  assert.equal(knopf.disabled, false); assert.equal(knopf.textContent, "Next phase");
});

// Shop page: the first page of the app. It must say plainly what the shop built itself and what the team project is.
test("Shop page: first in the menu, opens without an address, and keeps the shop's own systems apart from the team project", () => {
  const seite = fs.readFileSync(path.join(WURZEL, "public", "index.html"), "utf8").replace(/\r\n/g, "\n");
  const app = fs.readFileSync(path.join(WURZEL, "public", "app.js"), "utf8");
  assert.ok(seite.indexOf('id="nav-shop"') > 0 && seite.indexOf('id="nav-shop"') < seite.indexOf('id="nav-listings"'), "Shop comes before Products");
  const shop = seite.slice(seite.indexOf('<section id="ansicht-shop"'), seite.indexOf('<section id="ansicht-listings"'));
  assert.match(shop, /Built by the shop itself[^<]*outside this course/, "what the shop built is not passed off as the project");
  assert.match(shop, /The Listing Lab<\/strong> \(this app, the team project\)/);
  assert.ok(!/€|revenue|turnover|orders per|customers/i.test(shop.replace(/Orders and shipping|Orders from all channels|open orders/g, "")), "no money and no customer figures on a public page");
  assert.match(app, /seite === "" \? "shop" : "listings"/, "no address opens the shop page, an unknown one the products");
  for (const ziel of [...shop.matchAll(/href="#([a-z]+)"/g)].map((m) => m[1])) assert.match(app + seite, new RegExp(`"${ziel}"|id="nav-${ziel}"`), `the link #${ziel} leads somewhere`);
});
