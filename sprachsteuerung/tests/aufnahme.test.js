const { check, finish, section } = require('./lib');
const { berechneLautstaerke, erstelleStilleErkennung } = require('../aufnahme');

function lauterFrame(laenge = 512, amplitude = 10000) {
  const frame = new Int16Array(laenge);
  for (let i = 0; i < laenge; i += 1) frame[i] = i % 2 === 0 ? amplitude : -amplitude;
  return frame;
}

function stillerFrame(laenge = 512) {
  return new Int16Array(laenge);
}

section('berechneLautstaerke');
check('stiller Frame hat Lautstaerke 0', berechneLautstaerke(stillerFrame()) === 0);
check('lauter Frame hat hohe Lautstaerke', berechneLautstaerke(lauterFrame()) > 5000);

section('erstelleStilleErkennung: beendet nach genug leisen Frames');
(() => {
  const erkennung = erstelleStilleErkennung({ schwelle: 500, stilleFramesZumBeenden: 3, maxFrames: 100 });

  check('nach lautem Frame nicht fertig', erkennung.framePruefen(lauterFrame()) === false);
  check('nach 1 leisem Frame noch nicht fertig', erkennung.framePruefen(stillerFrame()) === false);
  check('nach 2 leisen Frames noch nicht fertig', erkennung.framePruefen(stillerFrame()) === false);
  check('nach 3 leisen Frames fertig', erkennung.framePruefen(stillerFrame()) === true);
  check('istFertig() bestaetigt', erkennung.istFertig() === true);
})();

section('erstelleStilleErkennung: lauter Frame zwischendrin setzt zurueck');
(() => {
  const erkennung = erstelleStilleErkennung({ schwelle: 500, stilleFramesZumBeenden: 3, maxFrames: 100 });

  erkennung.framePruefen(stillerFrame());
  erkennung.framePruefen(stillerFrame());
  check('nach erneutem lauten Frame nicht fertig', erkennung.framePruefen(lauterFrame()) === false);
  check('braucht wieder 3 leise Frames', erkennung.framePruefen(stillerFrame()) === false);
  check('noch nicht', erkennung.framePruefen(stillerFrame()) === false);
  check('jetzt fertig', erkennung.framePruefen(stillerFrame()) === true);
})();

section('erstelleStilleErkennung: hartes Limit greift trotz Lautstaerke');
(() => {
  const erkennung = erstelleStilleErkennung({ schwelle: 500, stilleFramesZumBeenden: 1000, maxFrames: 5 });

  let fertig = false;
  for (let i = 0; i < 5; i += 1) {
    fertig = erkennung.framePruefen(lauterFrame());
  }
  check('nach maxFrames lauten Frames trotzdem fertig', fertig === true);
})();

finish();
