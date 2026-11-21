// Evaluation of a test for the charts: figures per group and the change of every single listing.
// Pure calculation without a database. The verdict itself (better / no difference / worse) stays in experimente.mjs (urteile);
// this file is about showing WHAT it is made of, so that nobody has to believe it blindly: sums before and after,
// the net effect against the control group and the spread over the single listings (one outlier alone must not carry a verdict).

const leer = () => ({ imp: 0, auf: 0, trans: 0 });
const addiere = (a, b) => ({ imp: a.imp + b.imp, auf: a.auf + b.auf, trans: a.trans + b.trans });
const zahlOderNull = (x) => (Number.isFinite(x) ? x : null);
const veraenderung = (vorher, nachher) => (vorher > 0 ? nachher / vorher - 1 : null);

export function median(werte) {
  const w = werte.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!w.length) return null;
  const m = Math.floor(w.length / 2);
  return w.length % 2 ? w[m] : (w[m - 1] + w[m]) / 2;
}

// Net effect as in experimente.urteile: (test group after/before) / (control after/before) - 1.
// If the control is unusable (starting value 0), the raw change of the test group counts.
export function netto(test, kontrolle) {
  const eigen = test.vorher > 0 ? test.nachher / test.vorher : test.nachher > 0 ? Infinity : 1;
  let ctrl = kontrolle.vorher > 0 ? kontrolle.nachher / kontrolle.vorher : kontrolle.nachher > 0 ? Infinity : 1;
  if (!Number.isFinite(ctrl) || ctrl === 0) ctrl = 1;
  return zahlOderNull(eigen / ctrl - 1);
}

// zeilen: [{ number, gruppe: "test" | "kontrolle", vorher: {imp,auf,trans} | null, nachher: {imp,auf,trans} | null }]
// Listings without starting figures or without current figures (e.g. no longer listed on eBay) are not counted and are reported.
export function baueAuswertung(zeilen, einst) {
  const gruppe = (name) => {
    const dabei = zeilen.filter((z) => z.gruppe === name && z.vorher && z.nachher);
    const vorher = dabei.reduce((s, z) => addiere(s, z.vorher), leer());
    const nachher = dabei.reduce((s, z) => addiere(s, z.nachher), leer());
    const punkte = dabei.map((z) => ({ number: z.number, vorher: z.vorher.imp, nachher: z.nachher.imp, aenderung: zahlOderNull(veraenderung(z.vorher.imp, z.nachher.imp)) }));
    const mitWert = punkte.filter((p) => p.aenderung !== null);
    return {
      anzahl: dabei.length,
      ausgelassen: zeilen.filter((z) => z.gruppe === name).length - dabei.length,
      vorher, nachher,
      aenderung: { imp: zahlOderNull(veraenderung(vorher.imp, nachher.imp)), trans: zahlOderNull(veraenderung(vorher.trans, nachher.trans)) },
      median: median(mitWert.map((p) => p.aenderung)),
      anteilBesser: mitWert.length ? mitWert.filter((p) => p.aenderung > 0).length / mitWert.length : null,
      punkte,
    };
  }
  const test = gruppe("test"), kontrolle = gruppe("kontrolle");
  return {
    test, kontrolle,
    netto: { imp: netto({ vorher: test.vorher.imp, nachher: test.nachher.imp }, { vorher: kontrolle.vorher.imp, nachher: kontrolle.nachher.imp }), trans: netto({ vorher: test.vorher.trans, nachher: test.nachher.trans }, { vorher: kontrolle.vorher.trans, nachher: kontrolle.nachher.trans }) },
    skala: { besserAb: einst.besserAb, schutzGrenze: einst.schutzGrenze, mindestImpressionen: einst.mindestImpressionen30 },
  };
}
