// Schreibzugriff auf eBay (Trading-API), nur für Titel und nur nach Freigabe durch einen Admin (siehe freigabe.mjs).
// Die Zugangsdaten stehen nur in der .env des Admin-Rechners: EBAY_APP_ID, EBAY_CERT_ID, EBAY_REFRESH_TOKEN. Nie im Repo.
//
// Sicherheitsschalter: Ohne EBAY_SCHREIBEN=an in der .env wird NICHTS bei eBay geändert. Dann läuft nur ein Probelauf
// (lesen und prüfen, aber nicht schreiben).
// Vor jeder Änderung wird der aktuelle Titel bei eBay gelesen. Weicht er vom erwarteten Titel ab (z. B. weil ihn jemand
// von Hand geändert hat), wird nichts überschrieben.
const ENDPUNKT = "https://api.ebay.com/ws/api.dll";
const TOKEN_URL = "https://api.ebay.com/identity/v1/oauth2/token";

const entities = (s) => (s == null ? s : s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&"));
const xmlText = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const tag = (x, t) => { const m = x.match(new RegExp(`<${t}(?:\\s[^>]*)?>([\\s\\S]*?)</${t}>`)); return m ? m[1].trim() : null; };
const alle = (x, t) => [...x.matchAll(new RegExp(`<${t}(?:\\s[^>]*)?>([\\s\\S]*?)</${t}>`, "g"))].map((m) => m[1]);

export function erzeuge({ env = process.env, fetchFn = fetch, jetzt = () => Date.now() } = {}) {
  const schreibenAn = () => String(env.EBAY_SCHREIBEN || "").trim().toLowerCase() === "an";
  const konfiguriert = () => !!(env.EBAY_APP_ID && env.EBAY_CERT_ID && env.EBAY_REFRESH_TOKEN);
  let token = { wert: null, bis: 0 };

  async function accessToken() {
    if (!konfiguriert()) throw new Error("eBay credentials are not set on this computer (EBAY_APP_ID, EBAY_CERT_ID, EBAY_REFRESH_TOKEN).");
    if (token.wert && token.bis > jetzt() + 60000) return token.wert;
    const r = await fetchFn(TOKEN_URL, {
      method: "POST", signal: AbortSignal.timeout(20000),
      headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: "Basic " + Buffer.from(`${env.EBAY_APP_ID}:${env.EBAY_CERT_ID}`).toString("base64") },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: env.EBAY_REFRESH_TOKEN }),
    });
    const j = await r.json().catch(() => ({}));
    if (!j.access_token) throw new Error("eBay did not issue an access token: " + (j.error_description || j.error || "HTTP " + r.status));
    token = { wert: j.access_token, bis: jetzt() + (Number(j.expires_in) || 7200) * 1000 };
    return token.wert;
  }

  async function trading(aufruf, innen) {
    const iaf = await accessToken();
    const r = await fetchFn(ENDPUNKT, {
      method: "POST", signal: AbortSignal.timeout(30000),
      headers: { "X-EBAY-API-COMPATIBILITY-LEVEL": "1193", "X-EBAY-API-CALL-NAME": aufruf, "X-EBAY-API-SITEID": "77", "X-EBAY-API-IAF-TOKEN": iaf, "Content-Type": "text/xml" },
      body: `<?xml version="1.0" encoding="utf-8"?><${aufruf}Request xmlns="urn:ebay:apis:eBLBaseComponents">${innen}</${aufruf}Request>`,
    });
    const x = await r.text();
    const ack = tag(x, "Ack");
    const fehlerListe = alle(x, "Errors").map((e) => ({ code: tag(e, "ErrorCode"), text: entities(tag(e, "LongMessage") || tag(e, "ShortMessage") || ""), schwer: tag(e, "SeverityCode") }));
    return { http: r.status, ack, fehler: fehlerListe, xml: x };
  }

  // Liest Titel, Status und Verkäufe eines Angebots (nur lesen).
  async function lies(itemId) {
    const r = await trading("GetItem", `<ItemID>${xmlText(itemId)}</ItemID><OutputSelector>Item.Title</OutputSelector><OutputSelector>Item.SellingStatus.QuantitySold</OutputSelector><OutputSelector>Item.SellingStatus.ListingStatus</OutputSelector>`);
    if (r.ack === "Failure" || r.http !== 200) return { ok: false, meldung: r.fehler.map((f) => f.text).join(" ") || "eBay answered with HTTP " + r.http };
    return { ok: true, titel: entities(tag(r.xml, "Title")), status: tag(r.xml, "ListingStatus"), verkauft: Number(tag(r.xml, "QuantitySold") || 0) };
  }

  // Ändert den Titel. Gibt nie etwas anderes als { ok, ack, meldung } zurück.
  async function setzeTitel(itemId, titel) {
    if (!schreibenAn()) return { ok: false, ack: null, meldung: "Writing to eBay is switched off (EBAY_SCHREIBEN is not set to 'an')." };
    const r = await trading("ReviseFixedPriceItem", `<Item><ItemID>${xmlText(itemId)}</ItemID><Title>${xmlText(titel)}</Title></Item>`);
    const meldung = r.fehler.map((f) => (f.code ? `[${f.code}] ` : "") + f.text).join(" ");
    if (r.http === 200 && (r.ack === "Success" || r.ack === "Warning")) return { ok: true, ack: r.ack, meldung };
    return { ok: false, ack: r.ack, meldung: meldung || "eBay answered with HTTP " + r.http };
  }

  return { schreibenAn, konfiguriert, lies, setzeTitel };
}
