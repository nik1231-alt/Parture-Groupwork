// Dead code (checklist A4.6): every exported function in app/ that no other file in app/, public/ or scripts/ mentions.
// Call: npm run tote   Empty output and exit 0 = nothing dead; otherwise a list and exit 1.
// Deliberately simple: "mentions" means the name appears as a whole word in another file (import, call through module.name, even a
// comment). A word like "liste" occurs in many files; so the script does not find everything dead, but what it reports is surely dead.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WURZEL = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const ORDNER = ["app", "public", "scripts"];

// Justified exceptions: name -> reason. Enter here only what is exported on purpose but used by no other file.
const AUSNAHMEN = {
};

const dateien = ORDNER.flatMap((o) => fs.existsSync(path.join(WURZEL, o)) ? fs.readdirSync(path.join(WURZEL, o)).filter((f) => /\.(m?js|html)$/.test(f)).map((f) => path.join(o, f)) : []);
const inhalt = new Map(dateien.map((d) => [d, fs.readFileSync(path.join(WURZEL, d), "utf8")]));

// Exported functions: export (async) function x, export class X, export const x = (…) =>
const MUSTER = /^export\s+(?:async\s+function\*?|function\*?|class)\s+([A-Za-z_$][\w$]*)|^export\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>|^export\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?function/gm;

function toteExporte() {
  const tot = [];
  for (const [datei, text] of inhalt) {
    if (!datei.startsWith("app" + path.sep) || !datei.endsWith(".mjs")) continue;
    for (const m of text.matchAll(MUSTER)) {
      const name = m[1] || m[2] || m[3];
      if (Object.hasOwn(AUSNAHMEN, name)) continue;
      const wort = new RegExp(`(^|[^\\w$])${name.replace(/\$/g, "\\$")}([^\\w$]|$)`);
      const erwaehnt = [...inhalt].some(([andere, t]) => andere !== datei && wort.test(t));
      if (!erwaehnt) tot.push(`${datei.replace(/\\/g, "/")}: ${name}`);
    }
  }
  return tot;
}

const istHauptprogramm = () => { try { return !!process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url); } catch { return false; } };
if (istHauptprogramm()) {
  const tot = toteExporte();
  for (const z of tot) console.log(z);
  process.exit(tot.length ? 1 : 0);
}
