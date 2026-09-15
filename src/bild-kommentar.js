const { config } = require('./config');
const { chat } = require('./ollama');
const { getFreeVramMb } = require('./ollama');

// Wenn jemand im Chat ein Bild postet, sagt Ghostxx auch mal was dazu.
//
// Er KANN Bilder lesen - im Logbuch macht er nichts anderes. Im Chat hat er
// bisher darueber hinweggeredet, als waere nichts da. Jemand postet einen
// Screenshot von einem gewonnenen Event und bekommt eine Antwort auf den Text
// daneben.
//
// Drei Bremsen, damit er nicht zur Quasselstrippe wird:
//   - hoechstens alle paar Minuten eins
//   - nie, wenn die Grafikkarte belegt ist (dann spielt jemand GTA)
//   - nie, wenn die Nachricht ohnehin schon eine Antwort bekommt

const ABSTAND_MS = 10 * 60 * 1000;
const PRO_TAG = 8;

const PROMPT = `Jemand aus deiner Familie hat das im Chat gepostet.

Sag EINEN kurzen Satz dazu, wie ein Kumpel im Sprachkanal. Beziehe dich auf
das, was wirklich zu sehen ist.

Kein "Hilf dir gern", keine Nachfrage, keine Emojis. Wenn nichts Interessantes
drauf ist, antworte nur mit: -`;

let zuletzt = 0;
let heute = { tag: '', anzahl: 0 };

function tagesStempel(jetzt = Date.now()) {
  return new Date(jetzt).toISOString().slice(0, 10);
}

/** Darf er gerade was zu einem Bild sagen? */
async function darfKommentieren(jetzt = Date.now()) {
  if (jetzt - zuletzt < ABSTAND_MS) return false;

  const tag = tagesStempel(jetzt);
  if (heute.tag !== tag) heute = { tag, anzahl: 0 };
  if (heute.anzahl >= PRO_TAG) return false;

  // Belegte Grafikkarte heisst meistens: jemand spielt. Dann ist ein
  // Bildkommentar das Letzte, was jemand braucht - er wuerde das Spiel
  // ruckeln lassen.
  const frei = await getFreeVramMb().catch(() => null);
  if (frei !== null && frei < 5000) return false;

  return true;
}

function merkeKommentar(jetzt = Date.now()) {
  zuletzt = jetzt;
  const tag = tagesStempel(jetzt);
  if (heute.tag !== tag) heute = { tag, anzahl: 0 };
  heute.anzahl += 1;
}

/** Nur zum Pruefen im Test. */
function stand() {
  return { zuletzt, heute: { ...heute } };
}

function zuruecksetzen() {
  zuletzt = 0;
  heute = { tag: '', anzahl: 0 };
}

/**
 * Was er zu dem Bild sagt - oder nichts.
 *
 * Gibt einen leeren Text zurueck, wenn nichts Sinnvolles drauf ist. Lieber
 * schweigen als "ein interessantes Bild" sagen.
 */
async function kommentiere(imageBase64, begleittext = '') {
  const inhalt = begleittext
    ? `${PROMPT}\n\nDazu geschrieben wurde: "${begleittext.slice(0, 200)}"`
    : PROMPT;

  const antwort = await chat({
    model: config.ollamaVisionModel,
    messages: [{ role: 'user', content: inhalt, images: [imageBase64] }],
    temperature: 0.6,
    keepAlive: config.ollamaVisionKeepAlive,
  });

  if (!antwort.ok) return '';

  const text = String(antwort.content || '').trim();
  if (!text || text === '-' || text.startsWith('-') && text.length < 4) return '';

  // Ein Satz reicht. Das Modell haengt gern noch eine Frage dran.
  const ersterSatz = text.split(/(?<=[.!?])\s/)[0] || text;
  return ersterSatz.slice(0, 300);
}

module.exports = {
  ABSTAND_MS,
  PRO_TAG,
  darfKommentieren,
  kommentiere,
  merkeKommentar,
  stand,
  zuruecksetzen,
};
