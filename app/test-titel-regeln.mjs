// Tests for the rule checker (titel-regeln.mjs) and the AI title suggestion (ki-titel.mjs, with a rebuilt AI, without network).
// The bad examples are deliberately worded the way an AI would write them.
import test from "node:test";
import assert from "node:assert/strict";
import { pruefeTitel, markenIn } from "./titel-regeln.mjs";
import * as kiTitel from "./ki-titel.mjs";

const ALT = "2x Halter passend für Bosch L-Boxx Wandhalterung schwarz";
const regeln = (neu, alt = ALT) => pruefeTitel(neu, alt).verstoesse.map((v) => v.regel);

test("a clean new title goes through", () => {
  const r = pruefeTitel("Wandhalterung passend für Bosch L-Boxx, 2x Halter schwarz", ALT);
  assert.equal(r.ok, true, JSON.stringify(r.verstoesse));
});

test("Claims are rejected: original, superlative, test mark, environment, price, guarantee", () => {
  for (const [neu, regel] of [
    ["Original Bosch L-Boxx Halter 2x Wandhalterung", "behauptung"],
    ["Bester Halter passend für Bosch L-Boxx 2x", "behauptung"],
    ["TÜV geprüft: 2x Halter passend für Bosch L-Boxx", "behauptung"],
    ["Nachhaltiger 2x Halter passend für Bosch L-Boxx", "behauptung"],
    ["2x Halter passend für Bosch L-Boxx versandkostenfrei", "behauptung"],
    ["2x Halter passend für Bosch L-Boxx mit Garantie", "behauptung"],
  ]) assert.ok(regeln(neu).includes(regel), neu);
});

test("Brands: no new ones, and only with a reference word", () => {
  assert.ok(regeln("2x Halter passend für Bosch und Makita L-Boxx").includes("marke"), "Makita was not in the old title");
  assert.ok(regeln("Bosch L-Boxx Halter 2x Wandhalterung").includes("marke"), "Bosch without passend für sounds like the maker");
  assert.deepEqual(markenIn("Adapter passend für IKEA Trofast &amp; Kallax"), ["ikea", "kallax", "trofast"]);
});

test("Stay German (F4): a new English word is rejected, one from the old title is kept, common German loanwords pass", () => {
  assert.ok(regeln("2x Wallmount Halter passend für Bosch L-Boxx schwarz").includes("sprache"), "Wallmount added");
  assert.ok(regeln("2x Holder Bracket passend für Bosch L-Boxx").includes("sprache"), "two English words added");
  assert.match(pruefeTitel("2x Holder passend für Bosch L-Boxx", ALT).verstoesse.find((v) => v.regel === "sprache").text, /“holder” is English/);
  // The live titles of 20 Nov: the English words came from the old title, so they pass
  assert.deepEqual(regeln("Wandhalterung Wallmount passend für Lautsprecher Sonos Beam schwarz", "Wandhalterung passend für Lautsprecher Sonos Beam, Wallmount, schwarz"), []);
  assert.deepEqual(regeln("Werkzeug Wandhalterung Halter passend für Dewalt Circular Saw 7 1/4", "Wandhalterung passend für Dewalt Circular Saw 7 1/4, Halterung, Halter, Werkzeug"), []);
  // Loanwords that German titles use all the time are not on the list
  assert.deepEqual(regeln("2x Halter Set passend für Bosch L-Boxx Wandhalterung schwarz").filter((r) => r === "sprache"), []);
  assert.deepEqual(regeln("Gehäuse Cover passend für FritzFon C5", "Gehäuse passend für FritzFon C5").filter((r) => r === "sprache"), []);
});

test("Invent nothing: new numbers and colours are rejected", () => {
  assert.ok(regeln("4x Halter passend für Bosch L-Boxx Wandhalterung").includes("erfunden"), "4x instead of 2x");
  assert.ok(regeln("2x Halter 30 cm passend für Bosch L-Boxx").includes("erfunden"), "size invented");
  assert.ok(regeln("2x Halter passend für Bosch L-Boxx weiß").includes("erfunden"), "Farbe erfunden");
});

test("Form: length, keyword lists, emojis, special characters, capital letters", () => {
  assert.ok(regeln("2x Halter passend für Bosch L-Boxx " + "x".repeat(60)).includes("laenge"));
  assert.ok(regeln("").includes("laenge"));
  assert.ok(regeln("2x Halter Halter Halter passend für Bosch L-Boxx").includes("form"), "Halter dreimal");
  assert.ok(regeln("2x Halter passend für Bosch L-Boxx ✅").includes("form"), "Emoji");
  assert.ok(regeln("2x Halter passend für Bosch L-Boxx!!!").includes("form"), "Ausrufezeichen");
  assert.ok(regeln("2x HALTER passend für Bosch L-Boxx").includes("form"), "capital letters");
  // Filler words may occur twice, and what was already in the old title stays allowed
  assert.equal(pruefeTitel("Blende für Türgriff für BMW E30", "2x Blende passend für Türgriff für BMW E30").ok, true);
  assert.equal(pruefeTitel("Adapterplatte für Fritz!Box 7590", "Adapterplatte passend für Fritz!Box 7590 Wandhalterung").ok, true);
});

test("Risky things from the old title do not block, but are shown as a note", () => {
  const r = pruefeTitel("Luftauslass passend für VW T5 und Webasto Air Top", "Luftauslass kompatibel mit VW T5 MULTIVAN und Webasto Air Top");
  assert.equal(r.ok, true);
  assert.equal(r.hinweise.length, 1);
  assert.match(r.hinweise[0].text, /Top/);
});

// ---------- AI suggestion with a rebuilt Gemini answer (no network) ----------
const ENV = { GOOGLE_API_KEY: "test-schluessel" };
function geminiMit(antwort, status = 200) {
  const f = async (url, opt) => { f.url = url; f.opt = opt; f.body = JSON.parse(opt.body); return { status, ok: status < 300, json: async () => antwort }; };
  return f;
}
const kandidat = (vorschlaege) => ({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify({ vorschlaege }) }] } }] });

test("AI: the first suggestion that passes the rules is taken; the others are listed with a reason in discarded", async () => {
  const f = geminiMit(kandidat([
    { titel: "Original Bosch L-Boxx Halter", begruendung: "a" },
    { titel: "Wandhalterung passend für Bosch L-Boxx, 2x Halter schwarz", begruendung: "moves the search word forward" },
  ]));
  const k = kiTitel.erzeuge({ env: ENV, fetchFn: f });
  const r = await k.vorschlag({ alt: ALT, hinweisWoerter: ["wandhalterung"] });
  assert.equal(r.ok, true);
  assert.equal(r.wert.quelle, "ki");
  assert.equal(r.wert.titel, "Wandhalterung passend für Bosch L-Boxx, 2x Halter schwarz");
  assert.equal(r.wert.verworfen.length, 1);
  // the request goes to Gemini, names the old title and the rules and demands fixed JSON; the key is in the header, not in the address
  assert.equal(f.url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent");
  assert.equal(f.opt.headers["x-goog-api-key"], "test-schluessel");
  assert.match(f.body.contents[0].parts[0].text, /Bosch L-Boxx/);
  assert.match(f.body.contents[0].parts[0].text, /OEM/);
  assert.equal(f.body.generationConfig.responseMimeType, "application/json");
});

test("AI: if it refuses, the key is wrong or everything fails, the rule-based suggestion from the title help is used, clearly marked", async () => {
  const abgelehnt = kiTitel.erzeuge({ env: ENV, fetchFn: geminiMit({ candidates: [{ finishReason: "SAFETY" }] }) });
  const r = await abgelehnt.vorschlag({ alt: "Halter passend für Bosch L-Boxx", hinweisWoerter: ["wandhalterung"] });
  assert.equal(r.ok, true);
  assert.equal(r.wert.quelle, "regel");
  assert.equal(r.wert.titel, "Halter passend für Bosch L-Boxx Wandhalterung");
  assert.match(r.wert.hinweis, /declined/);
  const falsch = kiTitel.erzeuge({ env: ENV, fetchFn: geminiMit({ error: { message: "API key not valid" } }, 400) });
  const r2 = await falsch.vorschlag({ alt: "Halter passend für Bosch L-Boxx", hinweisWoerter: [] });
  assert.equal(r2.ok, false); assert.match(r2.fehler, /key is not valid/);
  const ohneKi = kiTitel.erzeuge({ env: {} });
  assert.equal(ohneKi.konfiguriert(), false);
  const o = await ohneKi.vorschlag({ alt: "Halter passend für Bosch L-Boxx", hinweisWoerter: ["passend"] });
  assert.equal(o.ok, false, "without AI and with filler words only there is no suggestion");
  assert.match(o.fehler, /GOOGLE_API_KEY/);
});

// Real AI suggestions of 20 Nov: the old rule demanded a reference word only somewhere, "BMW X3 F25 … passend" went through.
test("Brands: the brand must come after \"passend für …\", not before; if it was already at the front of the old title, only a note", () => {
  const alt = "Aufbewahrungsbox Armlehne kompatibel mit BMW X3 F25";
  const vorne = pruefeTitel("BMW X3 F25 Armlehne Aufbewahrungsbox passend", alt);
  assert.equal(vorne.ok, false);
  assert.ok(vorne.verstoesse.some((v) => v.regel === "marke" && /must come after/.test(v.text)));
  assert.equal(pruefeTitel("Dometic Kühlschrank Lüftungsgitter Knopf-Abdeckung Ersatz passend Weiß", "Ersatz Knopf-Abdeckung kompatibel mit Dometic Kühlschrank Weiß Lüftungsgitter").ok, false);
  assert.equal(pruefeTitel("Aufbewahrungsbox Armlehne passend für BMW X3 F25", alt).ok, true);
  assert.equal(pruefeTitel("Wandhalter Kettensäge passend für Einhell STIHL Bosch Makita Halterung", "Wandhalter Kettensäge kompatibel mit Einhell STIHL Bosch Makita Halterung").ok, true, "mehrere Marken hinter einem Bezugswort");
  const wieVorher = pruefeTitel("Bosch Akku Halter für die Wand passend", "Bosch Akku Halter Wand passend");
  assert.equal(wieVorher.ok, true, "it was already like this in the old title: no violation");
  assert.ok(wieVorher.hinweise.some((x) => x.regel === "marke"), "but a note for the admin");
});
