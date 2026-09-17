const fs = require('node:fs/promises');
const path = require('node:path');
const { config } = require('./config');
const { writeFileAtomic } = require('./atomic-write');

// Die Schalter im Dashboard. Alle laufen standardmaessig weiter; nur Kevin
// entscheidet bewusst, was eine Pause macht. Der Speicher liegt getrennt von
// den Fach-Daten, damit kein Event und kein Logbuch davon beruehrt wird.
const datei = path.join(config.dataDir, 'steuerung.json');

const STANDARD = {
  eventScheduler: true,
  terminErinnerungen: true,
  chat: true,
  commands: true,
  visaBilder: true,
  chatBilder: true,
  logbuchSortieren: true,
  auditLog: true,
  logNachrichten: true,
  logMitglieder: true,
  logSprache: true,
  logSelbststumm: true,
  logKanaele: true,
  botLog: true,
  fehlerLog: true,
  // Einziger Schalter, der bewusst AUS startet: die Selbstverbesserung
  // startet echte Claude-Code-Sessions auf Kevins Rechner. Der Plan verlangt
  // drei manuelle Schritte, bevor das zum ersten Mal von allein laufen darf
  // (CLI pruefen, einmal von Hand testen, dann scharf schalten). Ohne diesen
  // Schalter waere der erste automatische Lauf der erste Test ueberhaupt.
  selbstverbesserung: false,
};

let cache = { ...STANDARD };
let geladen = false;
let schreiben = Promise.resolve();

function saeubere(roh = {}) {
  const sauber = { ...STANDARD };
  for (const key of Object.keys(STANDARD)) {
    if (typeof roh[key] === 'boolean') sauber[key] = roh[key];
  }
  return sauber;
}

async function ladeSteuerung() {
  if (geladen) return cache;
  try {
    cache = saeubere(JSON.parse(await fs.readFile(datei, 'utf8')));
  } catch {
    cache = { ...STANDARD };
  }
  geladen = true;
  return cache;
}

function istAn(key) {
  return cache[key] !== false;
}

async function setzeSchalter(key, an) {
  if (!(key in STANDARD)) return null;
  await ladeSteuerung();
  cache = { ...cache, [key]: Boolean(an) };
  schreiben = schreiben.then(async () => {
    await fs.mkdir(config.dataDir, { recursive: true });
    await writeFileAtomic(datei, JSON.stringify(cache, null, 2));
  });
  await schreiben;
  return cache;
}

function alleSchalter() {
  return { ...cache };
}

module.exports = { STANDARD, alleSchalter, istAn, ladeSteuerung, setzeSchalter };
