// Auswertung eines Tests für die Diagramme: Zahlen je Gruppe und die Veränderung jedes einzelnen Angebots.
// Reine Rechnung ohne Datenbank. Das Urteil selbst (besser / kein Unterschied / schlechter) bleibt in experimente.mjs (urteile);
// hier geht es darum zu zeigen, WORAUS es entsteht, damit man ihm nicht blind glauben muss: Summen vorher und nachher,
// der Nettoeffekt gegen die Kontrollgruppe und die Streuung über die einzelnen Angebote (ein Ausreißer allein soll kein Urteil tragen).

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

// Nettoeffekt wie in experimente.urteile: (Testgruppe nachher/vorher) / (Kontrolle nachher/vorher) - 1.
// Ist die Kontrolle unbrauchbar (Ausgangswert 0), zählt die Rohveränderung der Testgruppe.
export function netto(test, kontrolle) {
  const eigen = test.vorher > 0 ? test.nachher / test.vorher : test.nachher > 0 ? Infinity : 1;
  let ctrl = kontrolle.vorher > 0 ? kontrolle.nachher / kontrolle.vorher : kontrolle.nachher > 0 ? Infinity : 1;
  if (!Number.isFinite(ctrl) || ctrl === 0) ctrl = 1;
  return zahlOderNull(eigen / ctrl - 1);
}

// zeilen: [{ number, gruppe: "test" | "kontrolle", vorher: {imp,auf,trans} | null, nachher: {imp,auf,trans} | null }]
// Angebote ohne Ausgangszahlen oder ohne aktuelle Zahlen (z. B. nicht mehr bei eBay gelistet) zählen nicht mit und werden gemeldet.
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
