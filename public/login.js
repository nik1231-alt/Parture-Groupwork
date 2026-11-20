// Login page. The password goes only by POST to /api/login and is stored nowhere.
const $ = (s) => document.querySelector(s);

function zeigeFehler(text) {
  const box = $("#fehler");
  box.textContent = text; box.hidden = false;
}

// To the app: if the login page was shown at "/" because the session had expired, the old address (e.g. #tests/5) is still
// in the address bar. A reload then opens exactly this place of the app (unsaved titles wait there too, see app.js "entwurf").
const zurApp = () => (location.pathname === "/" ? location.reload() : location.replace("/"));

async function start() {
  try {
    const r = await fetch("/api/ich");
    const j = await r.json();
    if (j.ok && j.daten.angemeldet) { zurApp(); return; }
    if (j.ok && j.daten.keineBenutzer) $("#ersteinrichtung").hidden = false;
  } catch { /* die Seite bleibt benutzbar, Fehler zeigt das Formular beim Absenden */ }
}

$("#formular").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("#fehler").hidden = true;
  const name = $("#name").value.trim();
  const passwort = $("#passwort").value;
  if (!name || !passwort) return zeigeFehler("Please enter your username and password.");
  const knopf = $("#senden");
  knopf.disabled = true;
  try {
    const r = await fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, passwort }) });
    let j;
    try { j = await r.json(); } catch { throw new Error("Unexpected response from the server."); }
    if (!j.ok) { $("#passwort").value = ""; $("#passwort").focus(); throw new Error(j.error || "Sign-in failed."); }
    zurApp();
  } catch (err) {
    zeigeFehler(err.message);
  } finally {
    knopf.disabled = false;
  }
});

start();
