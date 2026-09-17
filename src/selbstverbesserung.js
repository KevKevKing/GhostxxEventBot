const { logError } = require('./logger');
const beobachtungEcht = require('./selbstbeobachtung');
const limitEcht = require('./selbstverbesserung-limit');
const sessionEcht = require('./selbstverbesserung-session');
const benachrichtigungEcht = require('./selbstverbesserung-benachrichtigung');
const gedaechtnisEcht = require('./selbstverbesserung-gedaechtnis');

const TICK_MS = 10 * 60 * 1000;

/**
 * Eine Runde: verstehen (Beobachter) -> lernen (Gedaechtnis pruefen,
 * Session starten) -> anwenden bleibt bei Kevin (nur Vorschlag+DM).
 *
 * Alle Abhaengigkeiten per Parameter, damit der Test keine echten
 * Prozesse/Discord-Aufrufe braucht.
 */
async function tick({
  beobachten = beobachtungEcht,
  limit = limitEcht,
  session = sessionEcht,
  benachrichtigung = benachrichtigungEcht,
  gedaechtnis = gedaechtnisEcht,
} = {}) {
  await benachrichtigung.sendeAusstehende();

  const problem = (await beobachten.crashSchleifeErkannt()) || (await beobachten.erkenneProblem());
  if (!problem) return;

  const stand = await limit.darfLaufen();
  if (!stand.erlaubt) return;

  const { id } = await gedaechtnis.neuerEintrag(problem);
  const ergebnis = await session.starteSession(problem);
  await gedaechtnis.vermerkeSession(id, ergebnis);
  await benachrichtigung.benachrichtige({ problem, ergebnis });
  await limit.vermerkeLauf();
}

function startSelbstverbesserung(client) {
  beobachtungEcht.registriereBeobachtung();
  benachrichtigungEcht.setBenachrichtigungClient(client);

  let laeuft = false;
  async function lauf() {
    if (laeuft) return;
    laeuft = true;
    try {
      await tick();
    } catch (error) {
      console.error('Selbstverbesserung-Fehler:', error);
      logError('Fehler in der Selbstverbesserung', error);
    } finally {
      laeuft = false;
    }
  }

  lauf();
  const interval = setInterval(lauf, TICK_MS);
  console.log('Selbstverbesserung laeuft.');
  return interval;
}

module.exports = {
  startSelbstverbesserung,
  tick,
};
