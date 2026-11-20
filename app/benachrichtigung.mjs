// Notification to the admin through Telegram: a new suggestion is waiting, an import or backup failed.
// Only active if TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are in the server's .env. Otherwise nothing happens.
// A message must never disturb the app: errors are swallowed (and at most noted on the console).
// Only names and numbers go into the message, never credentials.
export function erzeuge({ env = process.env, fetchFn = fetch, log = console.warn } = {}) {
  const token = String(env.TELEGRAM_BOT_TOKEN || "").trim();
  const chat = String(env.TELEGRAM_CHAT_ID || "").trim();
  const konfiguriert = () => !!token && !!chat;
  const kurz = (t) => String(t).replace(/\s+/g, " ").slice(0, 900);
  // Telegram error messages do not contain the URL with the token, but to be safe the token is never passed on
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
    } catch (e) { log("Notification failed: " + ohneToken(e.message)); return false; }
  }
  return {
    konfiguriert, sende,
    vorschlag: (wer, anzahl, testName, link) => sende(`Parture: ${wer} proposes ${anzahl} title change${anzahl === 1 ? "" : "s"} (test “${testName}”). Waiting for your approval.${link ? "\n" + link : ""}`),
    fehler: (was, grund) => sende(`Parture: ${was} failed. ${grund || ""}`),
  };
}
