const fs = require('node:fs');
const path = require('node:path');
const { check, finish, section, useTempData } = require('./lib');

const temp = useTempData();
process.env.GEDAECHTNIS_ROOT = temp.dir;

const { logError } = require('../src/logger');
const beobachtung = require('../src/selbstbeobachtung');

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

  temp.cleanup();
  finish();
})();
