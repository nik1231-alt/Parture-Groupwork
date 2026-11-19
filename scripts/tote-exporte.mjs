// Toter Code (Checkliste A4.6): jede exportierte Funktion in app/, die keine andere Datei in app/, public/ oder scripts/ erwähnt.
// Aufruf: npm run tote   Ausgabe leer und Exit 0 = nichts Totes; sonst Liste und Exit 1.
// Bewusst einfach: "erwähnt" heißt, der Name steht als ganzes Wort in einer anderen Datei (Import, Aufruf über modul.name, auch ein
// Kommentar). Ein Wort wie "liste" kommt in vielen Dateien vor; das Skript findet also nicht alles Tote, aber was es meldet, ist sicher tot.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WURZEL = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const ORDNER = ["app", "public", "scripts"];

// Begründete Ausnahmen: Name -> Grund. Nur hier eintragen, was absichtlich exportiert, aber von keiner anderen Datei benutzt wird.
const AUSNAHMEN = {
};

const dateien = ORDNER.flatMap((o) => fs.existsSync(path.join(WURZEL, o)) ? fs.readdirSync(path.join(WURZEL, o)).filter((f) => /\.(m?js|html)$/.test(f)).map((f) => path.join(o, f)) : []);
const inhalt = new Map(dateien.map((d) => [d, fs.readFileSync(path.join(WURZEL, d), "utf8")]));

// Exportierte Funktionen: export (async) function x, export class X, export const x = (…) => / async (…) => / function
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
