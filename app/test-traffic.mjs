// Tests für den Traffic-Import (traffic.mjs). Kein Netz: eBay wird durch eine Ersatzfunktion nachgestellt.
import test from "node:test";
import assert from "node:assert/strict";
import { laDatum, addTage, tageListe, planeTage, zaehleAbweichungen, fensterSummen, abdeckung, holeTag, holeZeitraum, holeKontrolle, LimitFehler } from "./traffic.mjs";

const w = (imp, auf = 0, trans = 0) => ({ imp, auf, trans });
const tag = (o) => new Map(Object.entries(o));

test("Date: Los Angeles time, month boundaries, day lists", () => {
  assert.equal(laDatum(new Date("2026-11-17T03:00:00Z")), "2026-11-16", "morgens in Deutschland ist es in LA noch der Vortag");
  assert.equal(laDatum(new Date("2026-11-17T20:00:00Z"), 3), "2026-11-14");
  assert.equal(addTage("2026-11-01", -1), "2026-10-31");
  assert.equal(addTage("2026-12-31", 1), "2027-01-01");
  assert.deepEqual(tageListe("2026-11-14", 3), ["2026-11-12", "2026-11-13", "2026-11-14"]);
  assert.equal(tageListe("2026-11-14", 90).length, 90);
});

test("Planning: missing days and the last three days are fetched, the rest not", () => {
  const alle = tageListe("2026-11-14", 10); // 05. bis 14.
  const vorhanden = alle.filter((d) => d !== "2026-11-08"); // der 08. fehlt
  assert.deepEqual(planeTage(vorhanden, alle, 3), ["2026-11-08", "2026-11-12", "2026-11-13", "2026-11-14"]);
  assert.deepEqual(planeTage([], alle, 3), alle, "ganz ohne Daten wird alles geholt");
  assert.deepEqual(planeTage(alle, alle, 3), ["2026-11-12", "2026-11-13", "2026-11-14"], "nur die Nachprüfung");
});

test("Re-check: later changes by eBay are counted", () => {
  const alt = tag({ a: w(10, 2, 1), b: w(5) });
  assert.equal(zaehleAbweichungen(alt, tag({ a: w(10, 2, 1), b: w(5) })), 0);
  assert.equal(zaehleAbweichungen(alt, tag({ a: w(12, 2, 1), b: w(5) })), 1, "geänderte Zahl");
  assert.equal(zaehleAbweichungen(alt, tag({ a: w(10, 2, 1), b: w(5), c: w(1) })), 1, "neue Zeile");
  assert.equal(zaehleAbweichungen(alt, tag({ a: w(10, 2, 1) })), 1, "weggefallene Zeile");
  assert.equal(zaehleAbweichungen(undefined, tag({ a: w(1) })), 0, "ohne gespeicherten Tag gibt es nichts zu vergleichen");
});

test("Window: sums exactly over the last N days up to the cut-off day, known listings only", () => {
  const tage = new Map([["2026-11-10", tag({ a: w(1, 1, 0) })], ["2026-11-11", tag({ a: w(2, 1, 1), b: w(7) })], ["2026-11-12", tag({ a: w(4, 2, 0) })], ["2026-11-13", tag({ a: w(100) })]]);
  const f = fensterSummen(tage, "2026-11-12", 2); // 11. und 12.
  assert.deepEqual(f.get("a"), { imp: 6, auf: 3, trans: 1 });
  assert.deepEqual(f.get("b"), { imp: 7, auf: 0, trans: 0 });
  assert.equal(fensterSummen(tage, "2026-11-12", 3).get("a").imp, 7, "mit drei Tagen kommt der 10. dazu, der 13. nie (nach dem Stichtag)");
  assert.equal(fensterSummen(tage, "2026-11-12", 2, new Set(["a"])).has("b"), false);
});

test("Control: share of the account total that the listings explain", () => {
  const tage = new Map([["2026-11-10", tag({ a: w(90), b: w(10) })], ["2026-11-11", tag({ a: w(50) })]]);
  const kontrolle = new Map([["2026-11-10", w(100)], ["2026-11-11", w(100)]]);
  const a = abdeckung(tage, kontrolle, ["2026-11-10", "2026-11-11"]);
  assert.equal(a.min, 0.5); assert.equal(a.mittel, 0.75); assert.equal(a.schlechtester, "2026-11-11");
  assert.equal(abdeckung(tage, null, ["2026-11-10"]), null);
});

// ---------- Abruf mit Ersatz für eBay ----------
const antwort = (daten, status = 200) => ({ ok: status === 200, status, json: async () => daten });
const bericht = (zeilen) => ({ header: { metrics: [{ key: "TOTAL_IMPRESSION_TOTAL" }, { key: "LISTING_VIEWS_TOTAL" }, { key: "TRANSACTION" }] }, records: zeilen.map(([id, i, a, t]) => ({ dimensionValues: [{ value: id }], metricValues: [{ value: i }, { value: a }, { value: t }] })) });

test("Fetch: the listing ids are requested in batches of 200, the filter names exactly this one day", async () => {
  const urls = [];
  const fetchFn = async (url) => { urls.push(decodeURIComponent(String(url))); return antwort(bericht([["1", 10, 2, 1]])); };
  const ids = Array.from({ length: 450 }, (_, i) => String(100000 + i));
  const m = await holeTag("t", "2026-11-12", ids, { fetchFn });
  assert.equal(urls.length, 3);
  for (const u of urls) { assert.match(u, /date_range:\[20261112\.\.20261112\]/); assert.match(u, /dimension=LISTING/); }
  assert.deepEqual(m.get("1"), { imp: 10, auf: 2, trans: 1 });
});

test("Fetch: a short error is retried, a lasting error aborts instead of delivering half a day", async () => {
  let n = 0;
  const wackelig = async () => (++n < 3 ? antwort({}, 500) : antwort(bericht([["1", 1, 1, 0]])));
  assert.equal((await holeTag("t", "2026-11-12", ["1"], { fetchFn: wackelig, pauseMs: 1 })).size, 1);
  assert.equal(n, 3);
  await assert.rejects(holeTag("t", "2026-11-12", ["1"], { fetchFn: async () => antwort({}, 500), pauseMs: 1 }), /HTTP 500/);
  let k = 0;
  await assert.rejects(holeTag("t", "2026-11-12", ["1"], { fetchFn: async () => { k++; return antwort({}, 403); }, pauseMs: 1 }), /HTTP 403/);
  assert.equal(k, 1, "bei 4xx wird nicht wiederholt");
});

test("Control sum: eBay's date format (yyyymmdd) is read, on errors null comes back", async () => {
  const k = await holeKontrolle("t", "2026-11-10", "2026-11-11", { fetchFn: async () => antwort(bericht([["20261110", 100, 5, 2], ["20261111", 90, 4, 1]])) });
  assert.deepEqual(k.get("2026-11-10"), { imp: 100, auf: 5, trans: 2 });
  assert.equal(await holeKontrolle("t", "2026-11-10", "2026-11-11", { fetchFn: async () => antwort({}, 500), pauseMs: 1 }), null);
});

test("eBay limit (HTTP 429): a second attempt after the pause, then a LimitFehler instead of retrying forever", async () => {
  let n = 0;
  await assert.rejects(holeTag("t", "2026-11-12", ["1"], { fetchFn: async () => { n++; return antwort({}, 429); }, limitPauseMs: 1 }), (e) => e instanceof LimitFehler && e.limit === true);
  assert.equal(n, 2, "genau zwei Anfragen, dann Schluss");
  let k = 0;
  const danach = async () => (++k === 1 ? antwort({}, 429) : antwort(bericht([["1", 5, 1, 0]])));
  assert.equal((await holeTag("t", "2026-11-12", ["1"], { fetchFn: danach, limitPauseMs: 1 })).get("1").imp, 5, "ein kurzer Engpass wird überbrückt");
});

test("Period: a period of several days is in the filter (for the sums while daily values are missing)", async () => {
  const urls = [];
  await holeZeitraum("t", "2026-10-16", "2026-11-14", ["1"], { fetchFn: async (u) => { urls.push(decodeURIComponent(String(u))); return antwort(bericht([])); } });
  assert.match(urls[0], /date_range:\[20261016\.\.20261114\]/);
});
