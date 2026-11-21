// Secret scan: looks in the repo for credentials that must never be there.
//   node scripts/geheimnis-scan.mjs              checks all files tracked by Git (this is how it runs in the CI)
//   node scripts/geheimnis-scan.mjs --historie   also checks the complete Git history (of all branches)
// Exits with code 1 as soon as something is found. Found values are never printed, only file, line and kind.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WURZEL = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const git = (...a) => execFileSync("git", a, { cwd: WURZEL, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });

// Files that must never be tracked (except the template and the deliberately checked-in team copy)
const VERBOTEN = [
  [/(^|\/)\.env($|\.)(?!beispiel$)/, "Umgebungsdatei"],
  [/(^|\/)erstes-passwort/i, "Passwortdatei"],
  [/\.(pem|key|p12|pfx)$/i, "key file"],
  [/\.db(-wal|-shm)?$/i, "Datenbank"],
];
const ERLAUBT = new Set([".env.beispiel", "daten-team/pm.db"]);

// Patterns for values. The parts are separated, so that this script does not find itself.
const MUSTER = [
  ["eBay-Token", new RegExp("v\\^1\\.1#" + "i\\^1")],
  ["eBay-App-ID", /\b[A-Za-z0-9]+-[A-Za-z0-9]+-PRD-[0-9a-f]{9}-[0-9a-f]{8}\b/],
  ["private key", new RegExp("-----BEGIN [A-Z ]*PRIVATE " + "KEY-----")],
  ["GitHub-Token", /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{30,}\b/],
  ["AWS key", /\bAKIA[0-9A-Z]{16}\b/],
  ["Telegram-Bot-Token", /\b\d{8,11}:[A-Za-z0-9_-]{33,36}\b/],
  ["Cloudflare-Token", /\bcfut_[A-Za-z0-9]{30,}\b/],
  // Assignments in the style of an .env line with a real value (code like const X = process.env.X does not count; placeholders in angle brackets, empty or "..." do not count)
  ["Zuweisung eines Geheimnisses", /^\s*(?:export\s+|set\s+)?(EBAY_(?:APP_ID|CERT_ID|DEV_ID|REFRESH_TOKEN)|PM_TOKEN|TELEGRAM_BOT_TOKEN|CF_TUNNEL_TOKEN|SMTP_PASSWORT)\s*=\s*(?!<|\.\.\.|$|["']?\s*$)[^\s#]{6,}/],
];

function pruefeText(name, text, treffer, ort = "") {
  const zeilen = text.split(/\r?\n/);
  zeilen.forEach((z, i) => {
    if (z.length > 4000 || z.includes("scan-ok")) return;
    for (const [art, re] of MUSTER) if (re.test(z)) treffer.push(`${ort}${name}:${i + 1}  ${art}`);
  });
}

const treffer = [];
const dateien = git("ls-files", "-z").split("\0").filter(Boolean);
for (const f of dateien) {
  if (!ERLAUBT.has(f)) for (const [re, art] of VERBOTEN) if (re.test(f)) treffer.push(`${f}  ${art} im Repo`);
  if (/\.(db|png|jpe?g|gif|ico|woff2?)$/i.test(f)) continue;
  const p = path.join(WURZEL, f);
  if (!fs.existsSync(p) || fs.statSync(p).size > 2e6) continue;
  pruefeText(f, fs.readFileSync(p, "utf8"), treffer);
}

if (process.argv.includes("--historie")) {
  // Every line of text ever checked in, of all branches (added lines only)
  const log = git("log", "--all", "-p", "--no-color", "--text", "-U0", "--diff-filter=AM", "--format=commit %h");
  let commit = ""; let datei = "";
  for (const z of log.split(/\r?\n/)) {
    if (z.startsWith("commit ")) { commit = z.slice(7); continue; }
    if (z.startsWith("+++ b/")) { datei = z.slice(6); continue; }
    if (!z.startsWith("+") || z.startsWith("+++")) continue;
    if (z.length > 4000 || z.includes("scan-ok")) continue;
    for (const [art, re] of MUSTER) if (re.test(z)) treffer.push(`Historie ${commit}:${datei}  ${art}`);
  }
  const verfolgt = git("log", "--all", "--name-only", "--no-color", "--format=").split(/\r?\n/).filter(Boolean);
  for (const f of new Set(verfolgt)) if (!ERLAUBT.has(f)) for (const [re, art] of VERBOTEN) if (re.test(f)) treffer.push(`Historie ${f}  ${art}`);
}

const einmalig = [...new Set(treffer)];
if (einmalig.length) {
  console.error("Secret scan: FOUND\n  " + einmalig.join("\n  ") + "\nPlease remove it (and renew the affected secret at eBay/GitHub if it was already pushed).");
  process.exit(1);
}
console.log(`Secret scan: clean (${dateien.length} files${process.argv.includes("--historie") ? " and the whole history" : ""}).`);
