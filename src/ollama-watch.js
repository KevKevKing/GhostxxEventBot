const { config } = require('./config');
const { logBotEvent } = require('./logger');
const { isReachable, pickModel } = require('./ollama');

// Behaelt Ollama im Auge.
//
// Faellt es aus, merkt das sonst erst die naechste Person, die schreibt - und
// bekommt "Mein Kopf streikt gerade". Genau so ist es einmal gelaufen: Ollama
// lief nach einem Neustart des Rechners gar nicht, stundenlang, unbemerkt.
//
// Gemeldet wird nur der Wechsel, nicht jeder Durchlauf: sonst stuende alle
// fuenf Minuten dieselbe Zeile im Log.

const INTERVAL_MS = 5 * 60 * 1000;

let warLetzteMalErreichbar = null;

async function pruefe() {
  const erreichbar = await isReachable();

  if (warLetzteMalErreichbar === erreichbar) return erreichbar;

  // Beim allerersten Durchlauf nur melden, wenn etwas nicht stimmt.
  const ersterLauf = warLetzteMalErreichbar === null;
  warLetzteMalErreichbar = erreichbar;

  if (!erreichbar) {
    logBotEvent({
      title: 'Ollama nicht erreichbar',
      color: 'danger',
      description: `Unter ${config.ollamaUrl} antwortet nichts. Chat, Passprüfung und die Bilderkennung im Logbuch fallen aus — Events, Commands und Logs laufen weiter.`,
    });
    return false;
  }

  if (!ersterLauf) {
    const modell = await pickModel();
    logBotEvent({
      title: 'Ollama wieder da',
      color: 'create',
      fields: [{ name: 'Modell', value: modell, inline: true }],
    });
  }

  return true;
}

function startOllamaWatch() {
  pruefe().catch(() => null);

  const interval = setInterval(() => {
    pruefe().catch((error) => console.error('Ollama-Prüfung fehlgeschlagen:', error.message));
  }, INTERVAL_MS);

  interval.unref?.();
  return interval;
}

module.exports = {
  pruefe,
  startOllamaWatch,
};
