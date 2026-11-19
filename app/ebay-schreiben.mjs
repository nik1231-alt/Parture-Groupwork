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
  // Werbung und Preis kosten Geld bzw. Marge: je ein eigener Schalter zusätzlich zu EBAY_SCHREIBEN (Leiter, Stufe 2 und 3)
  const werbungAn = () => String(env.EBAY_WERBUNG || "").trim().toLowerCase() === "an";
  const preisAn = () => String(env.EBAY_PREIS || "").trim().toLowerCase() === "an";
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

  // Liest Titel, Status, Verkäufe und Preis eines Angebots (nur lesen). Bei Varianten-Angeboten: Preis je Variante (SKU).
  async function lies(itemId) {
    const felder = ["Item.Title", "Item.SellingStatus.QuantitySold", "Item.SellingStatus.ListingStatus", "Item.StartPrice", "Item.Variations.Variation.SKU", "Item.Variations.Variation.StartPrice"];
    const r = await trading("GetItem", `<ItemID>${xmlText(itemId)}</ItemID>${felder.map((f) => `<OutputSelector>${f}</OutputSelector>`).join("")}`);
    if (r.ack === "Failure" || r.http !== 200) return { ok: false, meldung: r.fehler.map((f) => f.text).join(" ") || "eBay answered with HTTP " + r.http };
    const variationen = alle(r.xml, "Variation").map((v) => ({ sku: entities(tag(v, "SKU")), preis: Number(tag(v, "StartPrice")) }));
    const ohneVariationen = r.xml.replace(/<Variations>[\s\S]*<\/Variations>/, "");
    return { ok: true, titel: entities(tag(r.xml, "Title")), status: tag(r.xml, "ListingStatus"), verkauft: Number(tag(r.xml, "QuantitySold") || 0), preis: Number(tag(ohneVariationen, "StartPrice")) || null, variationen };
  }

  // Setzt den Preis (Leiter, Stufe 3). skus leer = Angebot ohne Varianten; sonst bekommen alle Varianten denselben Preis.
  // ReviseInventoryStatus nimmt höchstens 4 Einträge je Aufruf.
  async function setzePreis(itemId, skus, preis) {
    if (!schreibenAn() || !preisAn()) return { ok: false, meldung: "Changing prices on eBay is switched off (EBAY_SCHREIBEN and EBAY_PREIS must be 'an')." };
    if (!(preis > 0)) return { ok: false, meldung: "Invalid price." };
    const eintraege = (skus.length ? skus : [null]).map((sku) => `<InventoryStatus><ItemID>${xmlText(itemId)}</ItemID>${sku ? `<SKU>${xmlText(sku)}</SKU>` : ""}<StartPrice>${preis.toFixed(2)}</StartPrice></InventoryStatus>`);
    const meldungen = [];
    for (let i = 0; i < eintraege.length; i += 4) {
      const r = await trading("ReviseInventoryStatus", eintraege.slice(i, i + 4).join(""));
      const m = r.fehler.map((f) => (f.code ? `[${f.code}] ` : "") + f.text).join(" ");
      if (!(r.http === 200 && (r.ack === "Success" || r.ack === "Warning"))) return { ok: false, meldung: (m || "eBay answered with HTTP " + r.http) + (i ? ` (the first ${i} variants were already changed)` : "") };
      if (m) meldungen.push(m);
    }
    return { ok: true, meldung: meldungen.join(" ") };
  }

  // REST-Aufruf (Marketing-API) mit demselben Zugangstoken. Gibt { status, daten, ort } zurück.
  async function rest(methode, pfad, body) {
    const iaf = await accessToken();
    const r = await fetchFn("https://api.ebay.com" + pfad, {
      method: methode, signal: AbortSignal.timeout(30000),
      headers: { Authorization: "Bearer " + iaf, "Content-Type": "application/json", "X-EBAY-C-MARKETPLACE-ID": "EBAY_DE" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await r.text();
    let daten = null; try { daten = text ? JSON.parse(text) : null; } catch { daten = { roh: text.slice(0, 300) }; }
    return { status: r.status, daten, ort: r.headers.get("location") || "" };
  }
  const restFehler = (r) => (r.daten?.errors || []).map((e) => `[${e.errorId}] ${e.longMessage || e.message}`).join(" ") || "eBay answered with HTTP " + r.status;

  // Schaltet Werbung für ein Angebot ein (Leiter, Stufe 2): eBay Promoted Listings Standard, Kosten nur bei Verkauf.
  // Alle Angebote der Leiter liegen in einer eigenen Kampagne "Parture Ladder" (wird beim ersten Mal angelegt).
  // Braucht beim eBay-Zugang zusätzlich die Berechtigung sell.marketing; fehlt sie, meldet eBay das und es wird nichts geändert.
  const KAMPAGNE = "Parture Ladder";
  let kampagneId = env.EBAY_KAMPAGNE_ID || null;
  async function setzeWerbung(itemId, satz) {
    if (!schreibenAn() || !werbungAn()) return { ok: false, meldung: "Ads on eBay are switched off (EBAY_SCHREIBEN and EBAY_WERBUNG must be 'an')." };
    if (!(satz >= 0.02 && satz <= 1)) return { ok: false, meldung: "Invalid ad rate." };
    const prozent = (satz * 100).toFixed(1);
    if (!kampagneId) {
      const such = await rest("GET", "/sell/marketing/v1/ad_campaign?campaign_name=" + encodeURIComponent(KAMPAGNE));
      if (such.status !== 200 && such.status !== 404) return { ok: false, meldung: "Could not read the ad campaigns: " + restFehler(such) };
      kampagneId = such.daten?.campaigns?.[0]?.campaignId || null;
    }
    if (!kampagneId) {
      const neu = await rest("POST", "/sell/marketing/v1/ad_campaign", { campaignName: KAMPAGNE, marketplaceId: "EBAY_DE", startDate: new Date(jetzt()).toISOString(), fundingStrategy: { fundingModel: "COST_PER_SALE", bidPercentage: prozent } });
      if (neu.status !== 201) return { ok: false, meldung: "Could not create the ad campaign: " + restFehler(neu) };
      kampagneId = neu.ort.split("/").pop() || null;
      if (!kampagneId) return { ok: false, meldung: "eBay created the campaign but did not return its id." };
    }
    const r = await rest("POST", `/sell/marketing/v1/ad_campaign/${encodeURIComponent(kampagneId)}/ad`, { listingId: String(itemId), bidPercentage: prozent });
    if (r.status === 201 || r.status === 200) return { ok: true, meldung: `Ad switched on at ${prozent} % (campaign ${kampagneId}).` };
    return { ok: false, meldung: restFehler(r) };
  }

  // Ändert den Titel. Gibt nie etwas anderes als { ok, ack, meldung } zurück.
  async function setzeTitel(itemId, titel) {
    if (!schreibenAn()) return { ok: false, ack: null, meldung: "Writing to eBay is switched off (EBAY_SCHREIBEN is not set to 'an')." };
    const r = await trading("ReviseFixedPriceItem", `<Item><ItemID>${xmlText(itemId)}</ItemID><Title>${xmlText(titel)}</Title></Item>`);
    const meldung = r.fehler.map((f) => (f.code ? `[${f.code}] ` : "") + f.text).join(" ");
    if (r.http === 200 && (r.ack === "Success" || r.ack === "Warning")) return { ok: true, ack: r.ack, meldung };
    return { ok: false, ack: r.ack, meldung: meldung || "eBay answered with HTTP " + r.http };
  }

  return { schreibenAn, werbungAn, preisAn, konfiguriert, lies, setzeTitel, setzePreis, setzeWerbung };
}
