const fs = require('node:fs/promises');
const path = require('node:path');
const { onError } = require('./logger');
const { writeFileAtomic } = require('./atomic-write');
const { config } = require('./config');
const { istBekannt, signatur } = require('./selbstverbesserung-gedaechtnis');

const SCHWELLE = 3;
const FENSTER_MS = 2 * 60 * 60 * 1000;
const MAX_VERLAUF = 300;

const verlaufDatei = path.join(config.dataDir, 'selbstbeobachtung-verlauf.json');
let verlauf = null;

async function ladeVerlauf() {
  if (verlauf) return verlauf;
  try {
    const roh = JSON.parse(await fs.readFile(verlaufDatei, 'utf8'));
    verlauf = Array.isArray(roh.eintraege) ? roh.eintraege : [];
  } catch {
    verlauf = [];
  }
  return verlauf;
}

async function speichereVerlauf() {
  const grenze = Date.now() - FENSTER_MS;
  verlauf = verlauf.filter((e) => new Date(e.zeit).getTime() >= grenze).slice(-MAX_VERLAUF);
  await fs.mkdir(config.dataDir, { recursive: true });
  await writeFileAtomic(verlaufDatei, JSON.stringify({ eintraege: verlauf }, null, 2));
}

function registriereBeobachtung() {
  onError((eintrag) => {
    ladeVerlauf().then(async (liste) => {
      liste.push(eintrag);
      await speichereVerlauf();
    }).catch(() => null);
  });
}

async function erkenneProblem() {
  const eintraege = await ladeVerlauf();
  const grenze = Date.now() - FENSTER_MS;
  const aktuelle = eintraege.filter((e) => new Date(e.zeit).getTime() >= grenze);

  const proTitel = new Map();
  for (const eintrag of aktuelle) {
    const liste = proTitel.get(eintrag.titel) || [];
    liste.push(eintrag);
    proTitel.set(eintrag.titel, liste);
  }

  let bester = null;
  for (const [titel, belege] of proTitel) {
    if (belege.length < SCHWELLE) continue;
    if (await istBekannt(signatur(titel))) continue;
    if (!bester || belege.length > bester.belege.length) bester = { titel, belege };
  }

  return bester;
}

async function leseBotLog() {
  const datei = path.join(path.dirname(config.dataDir), 'logs', 'bot.log');
  try {
    const roh = await fs.readFile(datei);
    const ohneNull = roh.filter((byte) => byte !== 0);
    return Buffer.from(ohneNull).toString('utf8').split(/\r?\n/);
  } catch {
    return [];
  }
}

const CRASH_ZEILE = /^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\] Bot beendet nach/;

async function crashSchleifeErkannt() {
  const zeilen = await leseBotLog();
  const grenze = Date.now() - FENSTER_MS;

  const crashes = zeilen
    .map((zeile) => zeile.match(CRASH_ZEILE))
    .filter(Boolean)
    .map((treffer) => ({ zeit: new Date(treffer[1].replace(' ', 'T')).toISOString(), grund: treffer[0] }))
    .filter((eintrag) => new Date(eintrag.zeit).getTime() >= grenze);

  if (crashes.length < SCHWELLE) return null;
  if (await istBekannt(signatur('Wiederholte Abstuerze'))) return null;

  return { titel: 'Wiederholte Abstuerze', belege: crashes };
}

module.exports = {
  crashSchleifeErkannt,
  erkenneProblem,
  registriereBeobachtung,
};
