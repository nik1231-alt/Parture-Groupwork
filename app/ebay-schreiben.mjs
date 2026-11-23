// Write access to eBay (Trading API), only for titles and only after approval by an admin (see freigabe.mjs).
// The credentials are only in the .env of the admin computer: EBAY_APP_ID, EBAY_CERT_ID, EBAY_REFRESH_TOKEN. Never in the repo.
//
// Safety switch: without EBAY_SCHREIBEN=an in the .env NOTHING is changed on eBay. Then only a dry run happens
// (read and check, but do not write).
// Before every change the current title is read on eBay. If it differs from the expected title (e.g. because somebody
// changed it by hand), nothing is overwritten.
const ENDPUNKT = "https://api.ebay.com/ws/api.dll";
const TOKEN_URL = "https://api.ebay.com/identity/v1/oauth2/token";

const entities = (s) => (s == null ? s : s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&"));
const xmlText = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const tag = (x, t) => { const m = x.match(new RegExp(`<${t}(?:\\s[^>]*)?>([\\s\\S]*?)</${t}>`)); return m ? m[1].trim() : null; };
const alle = (x, t) => [...x.matchAll(new RegExp(`<${t}(?:\\s[^>]*)?>([\\s\\S]*?)</${t}>`, "g"))].map((m) => m[1]);

export function erzeuge({ env = process.env, fetchFn = fetch, jetzt = () => Date.now() } = {}) {
  const schreibenAn = () => String(env.EBAY_SCHREIBEN || "").trim().toLowerCase() === "an";
  // Ads and price cost money or margin: each has its own switch in addition to EBAY_SCHREIBEN (ladder, steps 2 and 3)
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

  // Reads title, status, sales and price of a listing (read only). For variant listings: price per variant (SKU).
  async function lies(itemId) {
    const felder = ["Item.Title", "Item.SellingStatus.QuantitySold", "Item.SellingStatus.ListingStatus", "Item.StartPrice", "Item.Variations.Variation.SKU", "Item.Variations.Variation.StartPrice", "Item.Variations.Variation.VariationSpecifics"];
    const r = await trading("GetItem", `<ItemID>${xmlText(itemId)}</ItemID>${felder.map((f) => `<OutputSelector>${f}</OutputSelector>`).join("")}`);
    if (r.ack === "Failure" || r.http !== 200) return { ok: false, meldung: r.fehler.map((f) => f.text).join(" ") || "eBay answered with HTTP " + r.http };
    // skuRoh and spezifika stay exactly as eBay sent them (still XML-escaped): setzeVariantenPreise sends them back unchanged
    const variationen = alle(r.xml, "Variation").map((v) => ({ sku: entities(tag(v, "SKU")), preis: Number(tag(v, "StartPrice")), skuRoh: tag(v, "SKU"),
      spezifika: alle(tag(v, "VariationSpecifics") || "", "NameValueList").map((n) => ({ name: tag(n, "Name"), werte: alle(n, "Value") })) }));
    const ohneVariationen = r.xml.replace(/<Variations>[\s\S]*<\/Variations>/, "");
    return { ok: true, titel: entities(tag(r.xml, "Title")), status: tag(r.xml, "ListingStatus"), verkauft: Number(tag(r.xml, "QuantitySold") || 0), preis: Number(tag(ohneVariationen, "StartPrice")) || null, variationen };
  }

  // Sets the prices of a listing with variants (ladder, step 3): variationen as read by lies(), each with its new preis.
  // Every variant is named by its properties (e.g. Farbe = Schwarz), not only by its SKU: ReviseInventoryStatus, the call
  // for listings without variants below, was refused by eBay when the listing itself carries the SKU of one of its variants
  // (error 21916735, product 405 on 23 Nov 2026). All variants are sent, so each keeps or gets exactly the price given here.
  async function setzeVariantenPreise(itemId, variationen) {
    if (!schreibenAn() || !preisAn()) return { ok: false, meldung: "Changing prices on eBay is switched off (EBAY_SCHREIBEN and EBAY_PREIS must be 'an')." };
    if (!variationen?.length || variationen.some((v) => !(v.preis > 0) || !v.spezifika?.length || v.spezifika.some((s) => !s.name || !s.werte.length))) return { ok: false, meldung: "The variants of this listing could not be read completely, so nothing was changed." };
    const teile = variationen.map((v) => `<Variation>${v.skuRoh ? `<SKU>${v.skuRoh}</SKU>` : ""}<StartPrice currencyID="EUR">${v.preis.toFixed(2)}</StartPrice><VariationSpecifics>${v.spezifika.map((s) => `<NameValueList><Name>${s.name}</Name>${s.werte.map((w) => `<Value>${w}</Value>`).join("")}</NameValueList>`).join("")}</VariationSpecifics></Variation>`);
    const r = await trading("ReviseFixedPriceItem", `<Item><ItemID>${xmlText(itemId)}</ItemID><Variations>${teile.join("")}</Variations></Item>`);
    const m = r.fehler.map((f) => (f.code ? `[${f.code}] ` : "") + f.text).join(" ");
    if (!(r.http === 200 && (r.ack === "Success" || r.ack === "Warning"))) return { ok: false, meldung: m || "eBay answered with HTTP " + r.http };
    return { ok: true, meldung: m };
  }

  // Sets the price (ladder, step 3). skus empty = listing without variants; otherwise all variants get the same price.
  // ReviseInventoryStatus accepts at most 4 entries per call.
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

  // REST call (Marketing API) with the same access token. Returns { status, daten, ort }.
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

  // Switches on ads for a listing (ladder, step 2): eBay Promoted Listings Standard, cost only on a sale.
  // All listings of the ladder are in a campaign of their own, "Parture Ladder" (created the first time).
  // Needs the permission sell.marketing on the eBay access in addition; if it is missing, eBay says so and nothing is changed.
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

  // Undo of step 2 (F7): removes the listing from the app's own campaign "Parture Ladder" only, never from the shop's campaigns.
  // Not in that campaign (or no campaign at all) = nothing to remove, that counts as done.
  async function entferneWerbung(itemId) {
    if (!schreibenAn() || !werbungAn()) return { ok: false, meldung: "Ads on eBay are switched off (EBAY_SCHREIBEN and EBAY_WERBUNG must be 'an')." };
    if (!kampagneId) {
      const such = await rest("GET", "/sell/marketing/v1/ad_campaign?campaign_name=" + encodeURIComponent(KAMPAGNE));
      if (such.status !== 200 && such.status !== 404) return { ok: false, meldung: "Could not read the ad campaigns: " + restFehler(such) };
      kampagneId = such.daten?.campaigns?.[0]?.campaignId || null;
    }
    if (!kampagneId) return { ok: true, meldung: "The app's campaign does not exist, so there is no ad to remove." };
    const r = await rest("POST", `/sell/marketing/v1/ad_campaign/${encodeURIComponent(kampagneId)}/bulk_delete_ads_by_listing_id`, { requests: [{ listingId: String(itemId) }] });
    if (r.status !== 200 && r.status !== 207) return { ok: false, meldung: restFehler(r) };
    const a = r.daten?.responses?.[0];
    if (!a || a.statusCode === 200 || a.statusCode === 204) return { ok: true, meldung: `Ad removed from the campaign ${KAMPAGNE}.` };
    if (a.statusCode === 404) return { ok: true, meldung: `The listing was not in the campaign ${KAMPAGNE}, nothing to remove.` };
    return { ok: false, meldung: (a.errors || []).map((e) => e.longMessage || e.message).join(" ") || "eBay answered with status " + a.statusCode };
  }

  // Is the listing already advertised? Asks eBay for all campaigns it is in (also foreign ones, e.g. the shop's own).
  // Running or planned counts as advertised; then it is not eligible for phase 2 (Niko, 20 Nov). Read only.
  // Returns { ok, beworben, kampagnen: [name] } or { ok: false, meldung } (then phase 2 must not be approved).
  async function istBeworben(itemId) {
    if (!konfiguriert()) return { ok: false, meldung: "This computer has no eBay credentials, so the ad status cannot be checked." };
    const r = await rest("GET", "/sell/marketing/v1/ad_campaign/find_campaign_by_ad_reference?listing_id=" + encodeURIComponent(String(itemId)));
    if (r.status === 404 || r.status === 204) return { ok: true, beworben: false, kampagnen: [] };
    if (r.status !== 200) return { ok: false, meldung: "Could not check the ad status on eBay: " + restFehler(r) };
    const laufend = (r.daten?.campaigns || []).filter((c) => ["RUNNING", "SCHEDULED"].includes(String(c.campaignStatus || "").toUpperCase()));
    return { ok: true, beworben: laufend.length > 0, kampagnen: laufend.map((c) => c.campaignName || c.campaignId) };
  }

  // All listings that are in a running or planned campaign right now: { ok, angebote: { listingId: campaign } }.
  // For the display in the funnel ("jumps over phase 2"); before every step istBeworben checks the single listing once more.
  async function beworbeneAngebote() {
    if (!konfiguriert()) return { ok: false, meldung: "This computer has no eBay credentials, so the ad status cannot be checked." };
    const k = await rest("GET", "/sell/marketing/v1/ad_campaign?campaign_status=RUNNING,SCHEDULED&limit=100");
    if (k.status !== 200 && k.status !== 404) return { ok: false, meldung: "Could not read the ad campaigns: " + restFehler(k) };
    const angebote = {};
    for (const c of k.daten?.campaigns || []) {
      for (let offset = 0; offset < 20000; offset += 500) {
        const a = await rest("GET", `/sell/marketing/v1/ad_campaign/${encodeURIComponent(c.campaignId)}/ad?limit=500&offset=${offset}`);
        if (a.status !== 200) break;
        for (const ad of a.daten?.ads || []) if (ad.listingId) angebote[String(ad.listingId)] = c.campaignName || c.campaignId;
        if ((a.daten?.ads || []).length < 500) break;
      }
    }
    return { ok: true, angebote };
  }

  // Changes the title. Never returns anything other than { ok, ack, meldung }.
  async function setzeTitel(itemId, titel) {
    if (!schreibenAn()) return { ok: false, ack: null, meldung: "Writing to eBay is switched off (EBAY_SCHREIBEN is not set to 'an')." };
    const r = await trading("ReviseFixedPriceItem", `<Item><ItemID>${xmlText(itemId)}</ItemID><Title>${xmlText(titel)}</Title></Item>`);
    const meldung = r.fehler.map((f) => (f.code ? `[${f.code}] ` : "") + f.text).join(" ");
    if (r.http === 200 && (r.ack === "Success" || r.ack === "Warning")) return { ok: true, ack: r.ack, meldung };
    return { ok: false, ack: r.ack, meldung: meldung || "eBay answered with HTTP " + r.http };
  }

  return { schreibenAn, werbungAn, preisAn, konfiguriert, lies, setzeTitel, setzePreis, setzeVariantenPreise, setzeWerbung, entferneWerbung, istBeworben, beworbeneAngebote };
}
