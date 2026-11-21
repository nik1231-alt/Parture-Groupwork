// AI titles for step 1 of the ladder: Google Gemini suggests three new eBay titles, the rule checker (titel-regeln.mjs) lets only safe ones through.
// The AI decides nothing alone: the best rule-conforming suggestion goes to approval, and an admin approves it or not.
//
// Key: GOOGLE_API_KEY in the server's .env (admin only, never in the repo, just like the eBay keys).
// Without a key there is a rule-based suggestion from the title help (frequent words of the best-seen own listings),
// clearly marked as "without AI". Model: KI_MODELL in the .env, otherwise gemini-3.5-flash.
// Called through the REST interface of the Gemini API with fetch, without an additional dependency.
import { pruefeTitel, REGELN_FUER_KI, FUELL } from "./titel-regeln.mjs";
import { TITEL_MAX_ZEICHEN } from "./regeln.mjs";

const ENDPUNKT = "https://generativelanguage.googleapis.com/v1beta/models/";
// Answer format that Gemini has to keep (fixed JSON instead of free text)
const SCHEMA = {
  type: "OBJECT",
  properties: {
    vorschlaege: { type: "ARRAY", items: { type: "OBJECT", properties: { titel: { type: "STRING" }, begruendung: { type: "STRING" } }, required: ["titel", "begruendung"] } },
  },
  required: ["vorschlaege"],
};

const auftrag = ({ alt, hinweisWoerter }) => [
  "You write eBay titles for a German shop that sells 3D-printed holders, adapters and spare parts.",
  "This listing gets very few impressions in eBay search. Write 3 alternative titles that buyers are more likely to find.",
  "",
  "Old title: " + alt,
  hinweisWoerter.length ? "Words that often appear in the shop's most-seen listings and are missing here (use only if they truly fit this product): " + hinweisWoerter.join(", ") : "",
  "",
  "Rules (a title that breaks one is thrown away):",
  ...REGELN_FUER_KI.map((r) => "- " + r),
  "",
  "For each title give a one-sentence reason in English (which search words it adds or moves forward).",
].filter((z) => z !== "").join("\n");

// Without AI: append the missing frequent words at the end as long as they fit. This also goes through the rule checker.
// Filler words ("passend", "für") are often in the most-seen titles but make no sense when appended: they are left out.
export function regelVorschlag(alt, hinweisWoerter) {
  let t = String(alt ?? "").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
  const genutzt = [];
  for (const w of hinweisWoerter.filter((x) => !FUELL.has(String(x).toLowerCase()))) {
    const neu = `${t} ${w.charAt(0).toUpperCase()}${w.slice(1)}`;
    if (neu.length > TITEL_MAX_ZEICHEN) continue;
    t = neu; genutzt.push(w);
  }
  return genutzt.length ? { titel: t, begruendung: `Adds words that often appear in the most-seen listings: ${genutzt.join(", ")}.` } : null;
}

// fetchFn: replaceable for tests (the tests rebuild the Gemini answer, without network).
export function erzeuge({ env = process.env, fetchFn = fetch } = {}) {
  const schluessel = env.GOOGLE_API_KEY || "";
  const modell = env.KI_MODELL || "gemini-3.5-flash";
  const konfiguriert = () => !!schluessel;

  async function frageKi(eingabe) {
    const r = await fetchFn(ENDPUNKT + encodeURIComponent(modell) + ":generateContent", {
      method: "POST", signal: AbortSignal.timeout(60000),
      headers: { "x-goog-api-key": schluessel, "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: auftrag(eingabe) }] }],
        generationConfig: { responseMimeType: "application/json", responseSchema: SCHEMA },
      }),
    });
    const j = await r.json().catch(() => ({}));
    if (r.status === 400 || r.status === 401 || r.status === 403) throw new Error(`The AI key is not valid or not allowed (${r.status}${j.error?.message ? ": " + j.error.message.slice(0, 120) : ""}).`);
    if (r.status === 429) throw new Error("The AI is busy (rate limit), try again later.");
    if (!r.ok) throw new Error(`The AI answered with an error (${r.status}).`);
    const kandidat = j.candidates?.[0];
    if (!kandidat || kandidat.finishReason === "SAFETY" || j.promptFeedback?.blockReason) throw new Error("The AI declined this request.");
    if (kandidat.finishReason === "MAX_TOKENS") throw new Error("The AI answer was cut off.");
    const text = (kandidat.content?.parts || []).map((p) => p.text || "").join("").replace(/```json|```/g, "").trim();
    let daten; try { daten = JSON.parse(text); } catch { throw new Error("The AI answer was not readable."); }
    return (daten.vorschlaege || []).slice(0, 5).map((v) => ({ titel: String(v.titel || "").replace(/\s+/g, " ").trim(), begruendung: String(v.begruendung || "").slice(0, 300) }));
  }

  // Returns { ok, wert: { titel, begruendung, quelle: "ki"|"regel", pruefung, verworfen } } or { ok: false, status, fehler }.
  // verworfen (discarded): the suggestions that failed at the rule checker, with the reason (for the display and the log).
  async function vorschlag({ alt, hinweisWoerter = [] }) {
    const verworfen = [];
    let kiFehler = null;
    if (konfiguriert()) {
      try {
        for (const v of await frageKi({ alt, hinweisWoerter })) {
          const p = pruefeTitel(v.titel, alt);
          if (p.ok && v.titel !== alt) return { ok: true, wert: { ...v, quelle: "ki", modell, pruefung: p, verworfen } };
          verworfen.push({ titel: v.titel, verstoesse: p.ok ? [{ regel: "gleich", text: "Same as the old title." }] : p.verstoesse });
        }
      } catch (e) { kiFehler = e.name === "TimeoutError" ? "The AI did not answer in time." : e.message; }
    }
    const r = regelVorschlag(alt, hinweisWoerter);
    const p = r ? pruefeTitel(r.titel, alt) : null;
    if (r && p.ok) return { ok: true, wert: { ...r, quelle: "regel", pruefung: p, verworfen, hinweis: kiFehler || (konfiguriert() ? "No AI suggestion passed the rule check." : "No AI key on this computer, so this suggestion comes from the title help.") } };
    const grund = kiFehler || (verworfen.length ? "No suggestion passed the rule check."
      : konfiguriert() ? "The AI gave no suggestion." : "There is no AI key on this computer (GOOGLE_API_KEY), and the title help found no fitting words.");
    return { ok: false, status: 409, fehler: grund + " Enter a title by hand.", verworfen };
  }

  return { konfiguriert, modell: () => modell, vorschlag };
}
