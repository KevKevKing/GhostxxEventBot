const fs = require('node:fs/promises');
const path = require('node:path');
const { config } = require('./config');
const { writeFileAtomic } = require('./atomic-write');
const { alleEvents, eventZeit, teilnehmer } = require('./event-history');

// "Danny war heute zum 100. Mal dabei."
//
// Die Zahlen liegen seit Monaten in events.json, benutzt hat sie nie jemand von
// selbst. Ein Bot, der nur antwortet, wenn man ihn ruft, wirkt tot.
//
// Wo die Schwellen herkommen - gerechnet ueber 2513 Anmeldungen aus 71 Tagen,
// 125 verschiedene Leute:
//
//   jede 25.    1.7 pro Tag, Spitze 11 an einem Tag   zu viel
//   jede 50.    0.7 pro Tag, Spitze  5                zu wenig, Kevin will praesenter
//   10/25/+50   2.3 pro Tag, Spitze 10                mit Bremse genau richtig
//
// Genommen: 10, 25, danach jede 50. Mit der Tagesbremse bleiben 1.5 Meldungen
// pro Tag uebrig, ein Drittel wandert in den Abendrueckblick. An 27 von 71
// Tagen sagt er gar nichts - das soll auch so sein.
const ERSTE = [10, 25];
const SCHRITT = 50;

// Mehr als drei an einem Tag liest niemand mehr, das wird zur Tapete. Was
// drueber liegt, geht nicht verloren, sondern kommt abends gesammelt.
const PRO_TAG = 3;

const datei = path.join(config.dataDir, 'meilensteine.json');

function istMeilenstein(anzahl) {
  if (ERSTE.includes(anzahl)) return true;
  return anzahl >= SCHRITT && anzahl % SCHRITT === 0;
}

/** Der hoechste Meilenstein, der bei dieser Anzahl schon erreicht ist. */
function hoechsterBis(anzahl) {
  if (anzahl >= SCHRITT) return Math.floor(anzahl / SCHRITT) * SCHRITT;
  if (anzahl >= 25) return 25;
  if (anzahl >= 10) return 10;
  return 0;
}

async function laden() {
  try {
    const roh = await fs.readFile(datei, 'utf8');
    const daten = JSON.parse(roh);
    return {
      leute: new Map(Object.entries(daten.leute || {})),
      offen: Array.isArray(daten.offen) ? daten.offen : [],
      grundstandAm: daten.grundstandAm || '',
    };
  } catch {
    return { leute: new Map(), offen: [], grundstandAm: '' };
  }
}

async function speichern(stand) {
  await writeFileAtomic(datei, JSON.stringify({
    leute: Object.fromEntries(stand.leute),
    offen: stand.offen,
    grundstandAm: stand.grundstandAm,
  }, null, 2));
}

/** Wie oft war jede Person bisher dabei? */
async function teilnahmenJePerson(now = Date.now()) {
  const events = (await alleEvents(now)).filter((event) => event.status !== 'cancelled');
  const zaehler = new Map();

  for (const event of events) {
    if (!eventZeit(event)) continue;
    for (const id of teilnehmer(event)) {
      zaehler.set(id, (zaehler.get(id) || 0) + 1);
    }
  }

  return zaehler;
}

/** Bei welcher Eventart war jemand am haeufigsten dabei? */
async function haeufigsteArt(userId, now = Date.now()) {
  const events = (await alleEvents(now)).filter((event) => event.status !== 'cancelled');
  const proArt = new Map();

  for (const event of events) {
    if (!eventZeit(event)) continue;
    if (!teilnehmer(event).includes(userId)) continue;
    const label = event.title || 'Anmeldung';
    proArt.set(label, (proArt.get(label) || 0) + 1);
  }

  const beste = [...proArt.entries()].sort((a, b) => b[1] - a[1])[0];
  return beste ? { key: beste[0], label: beste[0], anzahl: beste[1] } : null;
}

/**
 * Welche Meilensteine sind seit dem letzten Blick dazugekommen?
 *
 * Beim allerersten Lauf wird nur der Stand festgehalten und nichts gemeldet -
 * sonst haette Ghostxx beim ersten Start 125 Leuten auf einmal gratuliert.
 */
async function neueMeilensteine(now = Date.now()) {
  const stand = await laden();
  const zaehler = await teilnahmenJePerson(now);

  const erstmals = !stand.grundstandAm;
  const gefunden = [];

  for (const [id, anzahl] of zaehler) {
    const zuletzt = Number(stand.leute.get(id) || 0);
    const jetzt = hoechsterBis(anzahl);
    if (jetzt > zuletzt) {
      stand.leute.set(id, jetzt);
      if (!erstmals && istMeilenstein(jetzt)) gefunden.push({ id, anzahl: jetzt });
    } else if (!stand.leute.has(id)) {
      stand.leute.set(id, jetzt);
    }
  }

  if (erstmals) stand.grundstandAm = new Date(now).toISOString();

  // Die groessten zuerst - der 500. ist mehr wert als der 50.
  gefunden.sort((a, b) => b.anzahl - a.anzahl);

  const sofort = gefunden.slice(0, PRO_TAG);
  const spaeter = gefunden.slice(PRO_TAG);

  // Nur fuer die, die sofort gemeldet werden - fuer die Nachzuegler abends
  // waere das dreissigmal dieselbe Rechnerei.
  for (const m of sofort) {
    m.top = await haeufigsteArt(m.id, now).catch(() => null);
  }

  stand.offen = [...stand.offen, ...spaeter];
  await speichern(stand);

  return { sofort, gesammelt: stand.offen.length, erstmals };
}

/** Was abends nachgereicht wird - und danach ist die Liste leer. */
async function offeneAbholen() {
  const stand = await laden();
  const offen = stand.offen;
  if (!offen.length) return [];

  stand.offen = [];
  await speichern(stand);
  return offen;
}

/**
 * Der Satz zum Meilenstein.
 *
 * "war zum 25. Mal dabei" hat im Chat die Rueckfrage "und wobei?" ausgeloest -
 * zu Recht. Wobei stand nirgends. Seitdem steht das Wort "Anmeldung" drin, und
 * wenn eine Eventart klar ueberwiegt, wird sie genannt.
 */
function satz({ id, anzahl, top }) {
  const wobei = top?.key && top.anzahl >= 3
    ? ` Meistens ${top.label} (${top.anzahl}×).`
    : '';

  if (anzahl >= 500) return `<@${id}> war zum **${anzahl}.** Mal bei einer Anmeldung dabei. Wahnsinn.${wobei}`;
  if (anzahl >= 250) return `<@${id}> steht bei **${anzahl}** Anmeldungen.${wobei}`;
  if (anzahl >= 100) return `<@${id}> hat **${anzahl}** Anmeldungen voll.${wobei}`;
  if (anzahl === 25) return `<@${id}> war zum **25.** Mal bei einer Anmeldung dabei.${wobei}`;
  if (anzahl === 10) return `<@${id}> war zum **10.** Mal bei einer Anmeldung dabei.${wobei}`;
  return `<@${id}> steht bei **${anzahl}** Anmeldungen.${wobei}`;
}

module.exports = {
  PRO_TAG,
  haeufigsteArt,
  hoechsterBis,
  istMeilenstein,
  neueMeilensteine,
  offeneAbholen,
  satz,
  teilnahmenJePerson,
};
