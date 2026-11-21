// Tests for the example verdicts (demo.mjs): the demo shows invented figures, calculated with the REAL verdict function.
// This checks that they give exactly the three intended verdicts and are marked as an example, so that nobody
// takes them for real results.
import test from "node:test";
import assert from "node:assert/strict";
import { baueDemo } from "./demo.mjs";
import { EINSTELLUNGEN } from "./regeln.mjs";

test("Demo: with the real rules the three examples give exactly the three intended verdicts and are marked as examples", () => {
  const d = baueDemo(EINSTELLUNGEN);
  assert.equal(d.beispiel, true);
  assert.match(d.hinweis, /Invented/);
  assert.deepEqual(d.faelle.map((f) => f.urteil.urteil), ["better", "no_difference", "worse"]);
  assert.deepEqual(d.faelle.map((f) => f.urteil.empfehlung), ["keep", "revert", "revert"]);
  assert.equal(d.faelle[2].urteil.schutz.ok, false, "example C fails on the safety figure sales");
});
