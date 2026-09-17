const fs = require('node:fs');
const path = require('node:path');
const { check, finish, section, useTempData } = require('./lib');

const temp = useTempData();
process.env.GEDAECHTNIS_ROOT = temp.dir;
// DATA_DIR bewusst auf ein Unterverzeichnis von temp.dir legen: der Code
// erwartet logs/bot.log NEBEN dataDir (path.dirname(config.dataDir)), bei
// DATA_DIR = temp.dir waere das der geteilte System-Temp-Ordner. So bleibt
// alles - Daten UND Log - unter temp.dir und wird von temp.cleanup() erfasst.
process.env.DATA_DIR = path.join(temp.dir, 'data');

const { logError } = require('../src/logger');
const { config } = require('../src/config');
const beobachtung = require('../src/selbstbeobachtung');

const botLogDatei = path.join(path.dirname(config.dataDir), 'logs', 'bot.log');

// crashSchleifeErkannt() parst die Zeitangabe in der Logzeile OHNE
// Zeitzonen-Suffix - JS interpretiert das dann als lokale Zeit. Die Zeile
// muss deshalb mit lokalen Datumsteilen gebaut werden, nicht mit
// toISOString() (UTC) - sonst faellt der Zeitpunkt je nach Systemzeitzone
// aus dem 2h-Fenster.
function alsLokaleZeit(datum) {
  const teil = (n) => String(n).padStart(2, '0');
  return `${datum.getFullYear()}-${teil(datum.getMonth() + 1)}-${teil(datum.getDate())} `
    + `${teil(datum.getHours())}:${teil(datum.getMinutes())}:${teil(datum.getSeconds())}`;
}

function schreibeBotLog(zeitpunkte) {
  const zeilen = zeitpunkte.map((zeit) => `[${alsLokaleZeit(zeit)}] Bot beendet nach 12s Laufzeit, Neustart in 5s`);
  fs.mkdirSync(path.dirname(botLogDatei), { recursive: true });
  fs.writeFileSync(botLogDatei, `${zeilen.join('\n')}\n`, 'utf8');
}

section('Kein Problem ohne Wiederholung');
beobachtung.registriereBeobachtung();

(async () => {
  logError('Einzelfehler', new Error('einmalig'));
  check('Einzelfehler ergibt kein Problem', (await beobachtung.erkenneProblem()) === null);

  section('Drei gleiche Fehler ergeben ein Problem');
  for (let i = 0; i < 3; i += 1) {
    logError('Wiederholter Fehler', new Error(`Versuch ${i}`));
  }
  const problem = await beobachtung.erkenneProblem();
  check('Problem erkannt', problem?.titel === 'Wiederholter Fehler');
  check('Belege gesammelt', problem?.belege?.length >= 3);

  section('Bereits bekanntes Problem wird nicht erneut gemeldet');
  const gedaechtnis = require('../src/selbstverbesserung-gedaechtnis');
  await gedaechtnis.neuerEintrag({ titel: 'Wiederholter Fehler', belege: problem.belege });
  check('Kein erneuter Fund', (await beobachtung.erkenneProblem()) === null);

  section('Crashschleife aus logs/bot.log erkennen');
  const jetzt = Date.now();
  schreibeBotLog([
    new Date(jetzt - 60 * 60 * 1000),
    new Date(jetzt - 30 * 60 * 1000),
    new Date(jetzt - 5 * 60 * 1000),
  ]);
  const crashProblem = await beobachtung.crashSchleifeErkannt();
  check('Crashschleife erkannt', crashProblem?.titel === 'Wiederholte Abstuerze');
  check('Belege aus bot.log gesammelt', crashProblem?.belege?.length >= 3);

  section('Bereits bekannte Crashschleife wird nicht erneut gemeldet');
  await gedaechtnis.neuerEintrag({ titel: 'Wiederholte Abstuerze', belege: crashProblem.belege });
  check('Kein erneuter Fund bei Crashschleife', (await beobachtung.crashSchleifeErkannt()) === null);

  temp.cleanup();
  finish();
})();
