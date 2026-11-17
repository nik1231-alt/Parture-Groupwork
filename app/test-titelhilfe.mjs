import test from "node:test";
import assert from "node:assert/strict";
import { woerter, hinweiseFuer } from "./titelhilfe.mjs";

const p = (nr, title, imp) => ({ number: String(nr), title, impressionen_90d: imp });
// 10 gut gesehene Angebote mit "halterung" und "magnetisch", 30 schlecht gesehene ohne
const daten = [
  ...Array.from({ length: 10 }, (_, i) => p(100 + i, `Handy Halterung magnetisch Auto Modell ${i}`, 5000 - i)),
  ...Array.from({ length: 30 }, (_, i) => p(200 + i, `Ständer Tisch Modell ${i}`, 10 + i)),
  p(999, "Handy Ständer Tisch", 50),
];

test("Wörter: klein, ohne Füllwörter, ohne reine Zahlen, einmalig", () => {
  assert.deepEqual(woerter("Handy-Halterung FÜR das Auto 3D 3D 12345"), ["handy-halterung", "auto", "3d"].filter((w) => woerter("Handy-Halterung FÜR das Auto 3D 3D 12345").includes(w)));
  assert.ok(!woerter("Halter für die Wand").includes("für"));
  assert.deepEqual(woerter(null), []);
  assert.ok(!woerter("Ab 12 99").includes("12"));
});

test("Hinweise: nur Wörter, die oben oft und unten selten vorkommen und im eigenen Titel fehlen", () => {
  const r = hinweiseFuer(daten, "999");
  assert.equal(r.ok, true);
  const w = r.hinweise.map((h) => h.wort);
  assert.ok(w.includes("halterung") && w.includes("magnetisch"), w.join(","));
  assert.ok(!w.includes("handy"), "steht schon im eigenen Titel");
  assert.ok(!w.includes("modell"), "kommt oben wie unten gleich oft vor");
  assert.equal(r.hinweise.find((h) => h.wort === "halterung").top, 100);
  assert.equal(r.freieZeichen, 80 - "Handy Ständer Tisch".length);
});

test("Hinweise: zu wenig Daten oder unbekanntes Produkt liefern ok:false statt Raten", () => {
  assert.equal(hinweiseFuer(daten.slice(0, 6), "100").ok, false);
  assert.equal(hinweiseFuer(daten, "nicht-da").ok, false);
  assert.equal(hinweiseFuer(daten.map((x) => ({ ...x, impressionen_90d: null })), "100").ok, false);
});
