const fs = require('node:fs/promises');
const path = require('node:path');
const { config } = require('./config');
const { writeFileAtomic } = require('./atomic-write');
const { logError } = require('./logger');
const { remember } = require('./memory');
const { neueMeilensteine, satz } = require('./meilenstein');
const { ABENDS, MORGENS, abendRueckblick, morgenText } = require('./tagesrhythmus');
const { getBerlinDateStamp, berlinTimeToDate } = require('./time');

// Der Taktgeber fuer alles, was Ghostxx von sich aus sagt.
//
// Drei Sachen, alle in den Chat-Kanal:
//   - Meilensteine, sobald sie anfallen (hoechstens drei am Tag)
//   - morgens ein Ausblick auf den Tag
//   - abends ein Rueckblick, dazu die Meilensteine, die tagsueber nicht passten
//
// Warum ein eigener Taktgeber und kein Einhaengen in die Anmeldung: die
// Eventlogik wird nicht angefasst. Hier wird nur gelesen und gerechnet - geht
// hier etwas schief, laeuft der Rest unveraendert weiter.

const TAKT_MS = 5 * 60 * 1000;

// Nachts sagt er nichts. Zwischen zwei und zehn ist der Server leer - das
// steht so auch im Zeitplan, wo die 40er-Fenster von 05 bis 10 tot sind.
const RUHE_VON = 2;
const RUHE_BIS = 10;

const datei = path.join(config.dataDir, 'praesenz.json');

async function laden() {
  try {
    return JSON.parse(await fs.readFile(datei, 'utf8'));
  } catch {
    return { morgenAm: '', abendAm: '' };
  }
}

async function speichern(stand) {
  await writeFileAtomic(datei, JSON.stringify(stand, null, 2));
}

/**
 * Sendet in den Chat - und merkt es sich.
 *
 * Das Merken ist nicht nebensaechlich: Ghostxx schrieb "war zum 25. Mal dabei",
 * und auf die Rueckfrage "und wobei?" kam Unsinn. Er wusste nicht, dass die
 * Meldung von ihm war - sie stand nirgends in seinem Gespraechsgedaechtnis.
 * Von sich aus reden heisst auch, sich daran zu erinnern.
 */
async function sende(client, text) {
  if (!text) return false;
  const kanal = await client.channels.fetch(config.chatChannelId).catch(() => null);
  if (!kanal?.isTextBased()) return false;

  await kanal.send({ content: text, allowedMentions: { users: [] } });
  await remember(`ch:${config.chatChannelId}`, 'assistant', text.slice(0, 600)).catch(() => null);
  return true;
}

function stundeIn(datum) {
  return Number(new Intl.DateTimeFormat('de-DE', {
    timeZone: 'Europe/Berlin', hour: '2-digit', hour12: false,
  }).format(datum));
}

/** Ist die Uhrzeit vorbei, aber noch nicht lange her? */
function faellig(datum, uhrzeit, jetzt) {
  const ziel = berlinTimeToDate(datum, uhrzeit).getTime();
  const rest = jetzt - ziel;
  // Bis zu zwei Stunden Nachlauf: war der Bot um halb elf aus, holt er den
  // Ausblick nach. Nach zwei Stunden ist er nichts mehr wert.
  return rest >= 0 && rest < 2 * 60 * 60 * 1000;
}

/**
 * Ein Durchgang. Wirft nie - ein Fehler beim Plaudern darf nichts anderes
 * anhalten.
 */
async function durchgang(client, jetzt = Date.now()) {
  const getan = [];

  try {
    const stunde = stundeIn(new Date(jetzt));
    if (stunde >= RUHE_VON && stunde < RUHE_BIS) return getan;

    const heute = getBerlinDateStamp(new Date(jetzt));
    const stand = await laden();

    // 1. Morgens: was ist heute los?
    if (stand.morgenAm !== heute && faellig(heute, MORGENS, jetzt)) {
      if (await sende(client, morgenText(heute))) {
        stand.morgenAm = heute;
        await speichern(stand);
        getan.push('morgen');
      }
    }

    // 2. Meilensteine, sobald sie anfallen.
    const { sofort } = await neueMeilensteine(jetzt);
    if (sofort.length) {
      const text = sofort.length === 1
        ? satz(sofort[0])
        : sofort.map((m) => `• ${satz(m)}`).join('\n');
      if (await sende(client, text)) getan.push(`meilenstein:${sofort.length}`);
    }

    // 3. Abends: was lief heute, plus was tagsueber nicht mehr passte.
    if (stand.abendAm !== heute && faellig(heute, ABENDS, jetzt)) {
      const text = await abendRueckblick(heute, jetzt);
      // Auch an einem leeren Tag wird vermerkt, dass der Abend durch ist -
      // sonst versucht er es alle fuenf Minuten weiter.
      stand.abendAm = heute;
      await speichern(stand);
      if (await sende(client, text)) getan.push('abend');
    }
  } catch (error) {
    logError('Praesenz fehlgeschlagen', error);
  }

  return getan;
}

function startPraesenz(client) {
  const takt = setInterval(() => {
    durchgang(client).catch(() => null);
  }, TAKT_MS);

  takt.unref?.();
  console.log('Praesenz laeuft (Meilensteine, Tagesrhythmus).');
  return takt;
}

module.exports = { RUHE_BIS, RUHE_VON, durchgang, faellig, startPraesenz };
