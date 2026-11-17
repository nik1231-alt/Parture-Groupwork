// Benachrichtigung an den Admin über Telegram: neuer Vorschlag wartet, Import oder Sicherung fehlgeschlagen.
// Nur aktiv, wenn TELEGRAM_BOT_TOKEN und TELEGRAM_CHAT_ID in der .env des Servers stehen. Sonst passiert nichts.
// Eine Meldung darf die App nie stören: Fehler werden verschluckt (und höchstens auf der Konsole vermerkt).
// In die Nachricht kommen nur Namen und Zahlen, nie Zugangsdaten.
export function erzeuge({ env = process.env, fetchFn = fetch, log = console.warn } = {}) {
  const token = String(env.TELEGRAM_BOT_TOKEN || "").trim();
  const chat = String(env.TELEGRAM_CHAT_ID || "").trim();
  const konfiguriert = () => !!token && !!chat;
  const kurz = (t) => String(t).replace(/\s+/g, " ").slice(0, 900);
  // Telegram-Fehlermeldungen enthalten die URL mit dem Token nicht, aber sicherheitshalber wird der Token nie weitergegeben
  const ohneToken = (t) => (token ? String(t).split(token).join("***") : String(t));
  async function sende(text) {
    if (!konfiguriert()) return false;
    try {
      const r = await fetchFn(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chat, text: kurz(text), disable_web_page_preview: true }), signal: AbortSignal.timeout(10000),
      });
      if (!r.ok) { log("Benachrichtigung fehlgeschlagen: HTTP " + r.status); return false; }
      return true;
    } catch (e) { log("Benachrichtigung fehlgeschlagen: " + ohneToken(e.message)); return false; }
  }
  return {
    konfiguriert, sende,
    vorschlag: (wer, anzahl, testName, link) => sende(`Parture: ${wer} schlägt ${anzahl} Titeländerung${anzahl === 1 ? "" : "en"} vor (Test „${testName}“). Wartet auf deine Freigabe.${link ? "\n" + link : ""}`),
    fehler: (was, grund) => sende(`Parture: ${was} fehlgeschlagen. ${grund || ""}`),
  };
}
