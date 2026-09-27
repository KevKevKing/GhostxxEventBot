const fs = require('node:fs/promises');
const path = require('node:path');
const { config } = require('./config');
const { writeFileAtomic } = require('./atomic-write');
const { logError } = require('./logger');
const { offeneFragen, merkeGestellt, versucheUmgebungZuVerstehen } = require('./ghostxx-fragen');

// Ersetzt die alte "Er fragt"-Dashboard-Kachel: statt einer Liste zum
// Anklicken bekommt Kevin eine einzelne offene Frage (Ticket ohne Besitzer,
// Event ohne Auszahlungssatz) als echte Discord-DM - gedrosselt, damit es
// nicht nervt. Er antwortet einfach mit normalem Text in derselben DM zurueck
// (siehe message-handler.js), kein Befehl noetig.

const ABSTAND_MS = 6 * 60 * 60 * 1000;
const datei = path.join(config.dataDir, 'frage-erinnerung.json');

async function zuletztGesendetAm() {
  try {
    const roh = await fs.readFile(datei, 'utf8');
    const wert = JSON.parse(roh).zuletztAm;
    return typeof wert === 'string' ? wert : null;
  } catch {
    return null;
  }
}

async function merkeGesendetAm(iso) {
  await writeFileAtomic(datei, JSON.stringify({ zuletztAm: iso }, null, 2)).catch(() => null);
}

/**
 * Einmal pro Takt: erst die Umgebung (Rollen/Kanaele) versuchen zu verstehen
 * (siehe ghostxx-fragen.js - lernt still oder verwirft, fragt nie), dann
 * hoechstens eine echte offene Frage per DM stellen, wenn seit der letzten
 * genug Zeit vergangen ist.
 *
 * Wirft nie: ein Fehler hier darf den Scheduler in index.js nicht stoppen.
 */
async function tick(client, {
  jetzt = Date.now(),
  holeOffeneFragen = offeneFragen,
  umgebungVerstehen = versucheUmgebungZuVerstehen,
  merkeAlsGestellt = merkeGestellt,
} = {}) {
  try {
    await umgebungVerstehen(client).catch(() => null);

    const letzte = await zuletztGesendetAm();
    if (letzte && jetzt - new Date(letzte).getTime() < ABSTAND_MS) return null;

    const fragen = await holeOffeneFragen(client);
    const frage = fragen[0];
    if (!frage) return null;

    const user = await client.users.fetch(config.ownerId).catch(() => null);
    if (!user) return null;

    await user.send(
      `${frage.frage}\n\n_${frage.warum}_\n\nAntworte einfach hier drauf, dann merke ich es mir.`,
    ).catch((error) => {
      throw error;
    });

    merkeAlsGestellt(config.ownerId, frage);
    await merkeGesendetAm(new Date(jetzt).toISOString());
    return frage;
  } catch (error) {
    console.error('Frage-Erinnerung fehlgeschlagen:', error.message);
    logError('Fehler in der Frage-Erinnerung', error);
    return null;
  }
}

function startFrageErinnerung(client, { intervalMs = 30 * 60 * 1000 } = {}) {
  const lauf = () => { tick(client).catch(() => null); };
  lauf();
  return setInterval(lauf, intervalMs);
}

module.exports = {
  ABSTAND_MS,
  startFrageErinnerung,
  tick,
};
