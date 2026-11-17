// Demo: drei Beispiel-Urteile mit ERFUNDENEN Zahlen, berechnet mit der echten Urteilsfunktion und den echten Einstellungen.
// Ein echtes Urteil braucht mindestens eine Prüfzeit (Standard 30 Tage) plus Datenverzug. Zur Vorführung zeigt die App deshalb,
// wie ein Urteil aussieht und gelesen wird. Die Beispiele sind in der Oberfläche als Beispiel gekennzeichnet, sie berühren keine echten Tests.
import { urteile } from "./experimente.mjs";

const g = (imp, auf, trans) => ({ imp, auf, trans });
const FAELLE = [
  { schluessel: "better", titel: "Example A: the new titles helped", test: { vorher: g(1200, 30, 4), nachher: g(2100, 52, 5) }, kontrolle: { vorher: g(1250, 31, 4), nachher: g(1300, 32, 4) } },
  { schluessel: "no_difference", titel: "Example B: no difference proven", test: { vorher: g(1180, 29, 4), nachher: g(1290, 31, 4) }, kontrolle: { vorher: g(1200, 30, 4), nachher: g(1280, 31, 4) } },
  { schluessel: "worse", titel: "Example C: impressions rose, but sales fell", test: { vorher: g(1200, 30, 6), nachher: g(2000, 50, 2) }, kontrolle: { vorher: g(1250, 31, 5), nachher: g(1300, 32, 5) } },
];

export function baueDemo(einst) {
  return {
    beispiel: true,
    hinweis: "Invented numbers to show how a verdict looks. They are not from your shop and no real test is affected.",
    faelle: FAELLE.map(({ schluessel, titel, test, kontrolle }) => ({ schluessel, titel, urteil: urteile(test, kontrolle, einst) })),
  };
}
