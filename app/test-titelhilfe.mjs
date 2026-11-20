// Tests for the title help (titelhilfe.mjs): it suggests only words that occur in well-seen listings of the own shop
// and are still missing in the title; it invents no titles. The data below is built so that the result is unambiguous.
import test from "node:test";
import assert from "node:assert/strict";
import { woerter, hinweiseFuer } from "./titelhilfe.mjs";
import { TITEL_MAX_ZEICHEN } from "./regeln.mjs";

const p = (nr, title, imp) => ({ number: String(nr), title, impressionen_90d: imp });
// 10 well-seen listings with "halterung" and "magnetisch", 30 poorly seen ones without
const daten = [
  ...Array.from({ length: 10 }, (_, i) => p(100 + i, `Handy Halterung magnetisch Auto Modell ${i}`, 5000 - i)),
  ...Array.from({ length: 30 }, (_, i) => p(200 + i, `Ständer Tisch Modell ${i}`, 10 + i)),
  p(999, "Handy Ständer Tisch", 50),
];

test("Words: lower case, without filler words, without pure numbers, unique", () => {
  assert.deepEqual(woerter("Handy-Halterung FÜR das Auto 3D 3D 12345"), ["handy-halterung", "auto", "3d"].filter((w) => woerter("Handy-Halterung FÜR das Auto 3D 3D 12345").includes(w)));
  assert.ok(!woerter("Halter für die Wand").includes("für"));
  assert.deepEqual(woerter(null), []);
  assert.ok(!woerter("Ab 12 99").includes("12"));
});

test("Hints: only words that are frequent at the top and rare at the bottom and missing in the own title", () => {
  const r = hinweiseFuer(daten, "999");
  assert.equal(r.ok, true);
  const w = r.hinweise.map((h) => h.wort);
  assert.ok(w.includes("halterung") && w.includes("magnetisch"), w.join(","));
  assert.ok(!w.includes("handy"), "is already in the own title");
  assert.ok(!w.includes("modell"), "occurs equally often at the top and at the bottom");
  assert.equal(r.hinweise.find((h) => h.wort === "halterung").top, 100);
  assert.equal(r.freieZeichen, TITEL_MAX_ZEICHEN - "Handy Ständer Tisch".length);
});

test("Hints: too little data or an unknown product return ok:false instead of guessing", () => {
  assert.equal(hinweiseFuer(daten.slice(0, 6), "100").ok, false);
  assert.equal(hinweiseFuer(daten, "nicht-da").ok, false);
  assert.equal(hinweiseFuer(daten.map((x) => ({ ...x, impressionen_90d: null })), "100").ok, false);
});
