const fs = require('node:fs/promises');
const path = require('node:path');
const { writeFileAtomic } = require('./atomic-write');
const { config } = require('./config');
const { getBerlinDateStamp, getBerlinParts } = require('./time');

// Deckelt die automatisch gestarteten Selbstverbesserungs-Sessions auf 5 pro
// Tag - passend zum "Alles gedeckelt"-Prinzip der anderen proaktiven Module
// (event-erinnerung.js, meilenstein.js, ...). Ab dem 6. muss Ghostxx erst
// nachfragen, statt einfach weiterzumachen.

const MAX_PRO_TAG = 5;
const datei = path.join(config.dataDir, 'selbstverbesserung-limit.json');

function istNachtruhe(now = new Date()) {
  const { hour } = getBerlinParts(now);
  return hour >= 2 && hour < 10;
}

async function ladeStand() {
  const heute = getBerlinDateStamp();
  try {
    const roh = JSON.parse(await fs.readFile(datei, 'utf8'));
    if (roh.datum === heute) return roh;
  } catch {
    // Keine oder kaputte Datei - bei null startet der Tag bei 0.
  }
  return { datum: heute, anzahl: 0 };
}

async function heutigeAnzahl() {
  return (await ladeStand()).anzahl;
}

async function darfLaufen() {
  const stand = await ladeStand();
  if (stand.anzahl >= MAX_PRO_TAG) return { erlaubt: false, grund: 'tageslimit' };
  return { erlaubt: true };
}

async function vermerkeLauf() {
  const stand = await ladeStand();
  stand.anzahl += 1;
  await fs.mkdir(config.dataDir, { recursive: true });
  await writeFileAtomic(datei, JSON.stringify(stand, null, 2));
}

module.exports = {
  darfLaufen,
  heutigeAnzahl,
  istNachtruhe,
  vermerkeLauf,
};
