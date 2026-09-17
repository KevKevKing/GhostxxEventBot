const { check, equal, finish, section, useTempData } = require('./lib');

const temp = useTempData();
const limit = require('../src/selbstverbesserung-limit');

section('Nachtruhe');
check('3 Uhr ist Nachtruhe', limit.istNachtruhe(new Date('2026-09-17T02:00:00+02:00')));
check('11 Uhr ist keine Nachtruhe', !limit.istNachtruhe(new Date('2026-09-17T11:00:00+02:00')));

section('Tageslimit');
(async () => {
  for (let i = 0; i < 5; i += 1) {
    const stand = await limit.darfLaufen();
    check(`Lauf ${i + 1} erlaubt`, stand.erlaubt === true);
    await limit.vermerkeLauf();
  }

  const sechster = await limit.darfLaufen();
  check('6. Lauf am selben Tag nicht mehr erlaubt', sechster.erlaubt === false);
  equal('Grund ist Tageslimit', sechster.grund, 'tageslimit');

  equal('Heutige Anzahl ist 5', await limit.heutigeAnzahl(), 5);

  temp.cleanup();
  finish();
})();
