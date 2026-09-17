const fs = require('node:fs/promises');
const path = require('node:path');
const { onError } = require('./logger');
const { writeFileAtomic } = require('./atomic-write');
const { config } = require('./config');
const { istBekannt, signatur } = require('./selbstverbesserung-gedaechtnis');

const SCHWELLE = 3;
// Erkennungsfenster: wie lange ein Fehler zurueckliegen darf, um noch als
// Teil desselben Musters zu zaehlen (siehe erkenneProblem/crashSchleifeErkannt).
const FENSTER_MS = 2 * 60 * 60 * 1000;
// Aufbewahrungsdauer: wie lange ein Eintrag ueberhaupt in der Historie
// bleibt, unabhaengig vom Erkennungsfenster. Bewusst getrennt - eine kurze
// Aufbewahrung wuerde die 2h-Fenster-Pruefung selbst kaputt machen.
const AUFBEWAHRUNG_MS = 24 * 60 * 60 * 1000;
const MAX_VERLAUF = 300;

// Fehler, die aus der Selbstverbesserung SELBST kommen. Wuerden sie mitgezaehlt,
// erkennt sich die Selbstverbesserung nach drei eigenen Fehlern in 2 Stunden
// als "wiederkehrendes Problem" und startet eine Session gegen sich selbst -
// die dann wieder scheitert und wieder loggt. Bewusst eine kurze Liste
// konkreter Titel statt einer generischen Regel: sie soll beim Lesen sofort
// erklaerbar sein.
const EIGENE_FEHLER = [
  'Fehler in der Selbstverbesserungs-Kette',
  'Fehler in der Selbstverbesserung',
];

const verlaufDatei = path.join(config.dataDir, 'selbstbeobachtung-verlauf.json');
let verlauf = null;
let ladenPromise = null;

/**
 * Aeltere als 24h raus, auf 300 Eintraege kappen (behaelt die neuesten) -
 * wie im Brief gefordert. Eine einzige Stelle fuer beide Aufrufer: beim
 * Laden (einmalig) UND bei jedem Speichern - der Bot laeuft wochenlang
 * durch, ohne die Kappung bei jedem Schreiben wuerde data/selbstbeobach-
 * tung-verlauf.json (und das Array im Speicher) im Betrieb unbegrenzt
 * weiterwachsen, das 300er-Limit wuerde erst beim naechsten Neustart wieder
 * gelten.
 */
function bereinigt(eintraege) {
  const grenze = Date.now() - AUFBEWAHRUNG_MS;
  return eintraege
    .filter((e) => new Date(e.zeit).getTime() >= grenze)
    .slice(-MAX_VERLAUF);
}

/** Laedt die Historie einmalig und haelt sie danach im Speicher. */
async function ladeVerlauf() {
  if (verlauf) return verlauf;
  if (!ladenPromise) {
    ladenPromise = (async () => {
      let geladen;
      try {
        const roh = JSON.parse(await fs.readFile(verlaufDatei, 'utf8'));
        geladen = Array.isArray(roh.eintraege) ? roh.eintraege : [];
      } catch {
        geladen = [];
      }
      verlauf = bereinigt(geladen);
      return verlauf;
    })();
  }
  return ladenPromise;
}

async function speichereVerlauf() {
  verlauf = bereinigt(verlauf);
  await fs.mkdir(config.dataDir, { recursive: true });
  await writeFileAtomic(verlaufDatei, JSON.stringify({ eintraege: verlauf }, null, 2));
}

let angemeldet = false;

function registriereBeobachtung() {
  // Seit logger.onError mehrere Zuhoerer haelt (statt den vorherigen still zu
  // ersetzen), wuerde ein zweiter Aufruf jeden Fehler doppelt in die Historie
  // schreiben - und die Schwelle von 3 waere schon bei 2 Fehlern erreicht.
  if (angemeldet) return;
  angemeldet = true;

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
  const aktuelle = eintraege.filter(
    (e) => new Date(e.zeit).getTime() >= grenze && !EIGENE_FEHLER.includes(e.titel),
  );

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
