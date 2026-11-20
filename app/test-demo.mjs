// Tests für die Beispiel-Urteile (demo.mjs): Die Vorführung zeigt erfundene Zahlen, gerechnet mit der ECHTEN Urteilsfunktion.
// Hier wird geprüft, dass sie genau die drei gedachten Urteile ergeben und als Beispiel gekennzeichnet sind, damit niemand
// sie für echte Ergebnisse hält.
import test from "node:test";
import assert from "node:assert/strict";
import { baueDemo } from "./demo.mjs";
import { EINSTELLUNGEN } from "./regeln.mjs";

test("Demo: die drei Beispiele ergeben mit den echten Regeln genau die drei gedachten Urteile und sind als Beispiel gekennzeichnet", () => {
  const d = baueDemo(EINSTELLUNGEN);
  assert.equal(d.beispiel, true);
  assert.match(d.hinweis, /Invented/);
  assert.deepEqual(d.faelle.map((f) => f.urteil.urteil), ["better", "no_difference", "worse"]);
  assert.deepEqual(d.faelle.map((f) => f.urteil.empfehlung), ["keep", "revert", "revert"]);
  assert.equal(d.faelle[2].urteil.schutz.ok, false, "Beispiel C scheitert an der Schutzkennzahl Verkäufe");
});
