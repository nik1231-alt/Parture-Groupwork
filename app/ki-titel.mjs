// KI-Titel für Stufe 1 der Leiter: Google Gemini schlägt drei neue eBay-Titel vor, der Regelprüfer (titel-regeln.mjs) lässt nur sichere durch.
// Die KI entscheidet nichts allein: Der beste regelkonforme Vorschlag geht zur Freigabe, ein Admin gibt ihn frei oder nicht.
//
// Schlüssel: GOOGLE_API_KEY in der .env des Servers (nur Admin, nie im Repo, genau wie die eBay-Keys).
// Ohne Schlüssel gibt es einen Regelvorschlag aus der Titelhilfe (häufige Wörter der meistgesehenen eigenen Angebote),
// klar als "ohne KI" gekennzeichnet. Modell: KI_MODELL in der .env, sonst gemini-3.5-flash.
// Aufruf über die REST-Schnittstelle der Gemini-API mit fetch, ohne zusätzliche Abhängigkeit.
import { pruefeTitel, REGELN_FUER_KI, FUELL } from "./titel-regeln.mjs";
import { TITEL_MAX_ZEICHEN } from "./regeln.mjs";

const ENDPUNKT = "https://generativelanguage.googleapis.com/v1beta/models/";
// Antwortformat, das Gemini einhalten muss (festes JSON statt freiem Text)
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

// Ohne KI: die fehlenden häufigen Wörter hinten anhängen, solange sie passen. Geht auch durch den Regelprüfer.
// Füllwörter ("passend", "für") stehen oft in den meistgesehenen Titeln, ergeben angehängt aber keinen Sinn: die bleiben weg.
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

// fetchFn: zum Testen austauschbar (die Tests bauen die Gemini-Antwort nach, ohne Netz).
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

  // Liefert { ok, wert: { titel, begruendung, quelle: "ki"|"regel", pruefung, verworfen } } oder { ok: false, status, fehler }.
  // verworfen: die Vorschläge, die am Regelprüfer gescheitert sind, mit Grund (für die Anzeige und das Protokoll).
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
