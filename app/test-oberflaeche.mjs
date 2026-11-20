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
  assert.ok(zeichenketten('const t = "Fehler: ungültig";').some((x) => DEUTSCH.test(x.text)), "ein deutscher Text würde gefunden");
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
