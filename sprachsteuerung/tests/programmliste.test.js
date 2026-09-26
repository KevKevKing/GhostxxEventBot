const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { check, equal, finish, section } = require('./lib');
const { ladeProgrammliste } = require('../programmliste');

function temporaereDatei(inhalt) {
  const pfad = path.join(os.tmpdir(), `ghostxx-programmliste-test-${Date.now()}-${Math.random()}.json`);
  fs.writeFileSync(pfad, inhalt, 'utf8');
  return pfad;
}

section('ladeProgrammliste: gueltige Liste');
(() => {
  const pfad = temporaereDatei(JSON.stringify([
    { name: 'Valorant', pfad: 'C:/Spiele/Valorant.exe' },
    { name: 'Minecraft', pfad: 'C:/Spiele/Minecraft.exe' },
  ]));
  const liste = ladeProgrammliste(pfad);
  equal('zwei Eintraege geladen', liste.length, 2);
  equal('erster Eintrag Name', liste[0].name, 'Valorant');
  fs.rmSync(pfad, { force: true });
})();

section('ladeProgrammliste: Datei existiert nicht -> leere Liste, kein Wurf');
(() => {
  let liste;
  let geworfen = false;
  try {
    liste = ladeProgrammliste('C:/diese/datei/gibt/es/nicht.json');
  } catch {
    geworfen = true;
  }
  check('kein Wurf', geworfen === false);
  equal('leere Liste', liste, []);
})();

section('ladeProgrammliste: kaputtes JSON -> leere Liste, kein Wurf');
(() => {
  const pfad = temporaereDatei('{ das ist kein json');
  let liste;
  let geworfen = false;
  try {
    liste = ladeProgrammliste(pfad);
  } catch {
    geworfen = true;
  }
  check('kein Wurf', geworfen === false);
  equal('leere Liste', liste, []);
  fs.rmSync(pfad, { force: true });
})();

section('ladeProgrammliste: JSON ist kein Array -> leere Liste');
(() => {
  const pfad = temporaereDatei(JSON.stringify({ name: 'Valorant' }));
  equal('leere Liste', ladeProgrammliste(pfad), []);
  fs.rmSync(pfad, { force: true });
})();

section('ladeProgrammliste: ungueltige Eintraege werden rausgefiltert');
(() => {
  const pfad = temporaereDatei(JSON.stringify([
    { name: 'Valorant', pfad: 'C:/x.exe' },
    { name: 'Ohne Pfad' },
    { pfad: 'C:/ohne-namen.exe' },
    'kein objekt',
    null,
  ]));
  const liste = ladeProgrammliste(pfad);
  equal('nur der gueltige Eintrag bleibt', liste.length, 1);
  equal('der gueltige Eintrag', liste[0].name, 'Valorant');
  fs.rmSync(pfad, { force: true });
})();

finish();
