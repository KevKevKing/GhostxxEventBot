// sprachsteuerung/tests/programm-starter.test.js
const { check, finish, section } = require('./lib');
const { starteProgramm, istUri } = require('../programm-starter');

section('istUri');
(() => {
  check('URI erkannt', istUri('steam://rungameid/12345') === true);
  check('normaler Pfad nicht als URI erkannt', istUri('C:/Spiele/Valorant.exe') === false);
})();

(async () => {
  section('Datei-Pfad wird direkt ausgefuehrt');
  let aufgerufenMit = null;
  let ergebnis = await starteProgramm(
    { name: 'Valorant', pfad: 'C:/Spiele/Valorant.exe' },
    { ausfuehren: async (cmd, args) => { aufgerufenMit = { cmd, args }; return { ok: true }; } },
  );
  check('ok', ergebnis.ok === true);
  check('cmd ist der Datei-Pfad direkt', aufgerufenMit.cmd === 'C:/Spiele/Valorant.exe');

  section('URI wird ueber "start" geoeffnet');
  aufgerufenMit = null;
  ergebnis = await starteProgramm(
    { name: 'Steam-Spiel', pfad: 'steam://rungameid/12345' },
    { ausfuehren: async (cmd, args) => { aufgerufenMit = { cmd, args }; return { ok: true }; } },
  );
  check('ok', ergebnis.ok === true);
  check('cmd ist cmd.exe', aufgerufenMit.cmd === 'cmd');
  check('args enthalten die URI', aufgerufenMit.args.includes('steam://rungameid/12345'));

  section('ausfuehren meldet Fehlschlag -> ok:false mit grund');
  ergebnis = await starteProgramm(
    { name: 'Valorant', pfad: 'C:/Spiele/Valorant.exe' },
    { ausfuehren: async () => ({ ok: false }) },
  );
  check('nicht ok', ergebnis.ok === false);
  check('grund gesetzt', ergebnis.grund === 'programm_fehlgeschlagen');

  section('ausfuehren wirft synchron -> kein Absturz, ok:false');
  ergebnis = await starteProgramm(
    { name: 'Valorant', pfad: 'C:/Spiele/Valorant.exe' },
    { ausfuehren: () => { throw new Error('kaputt'); } },
  );
  check('nicht ok', ergebnis.ok === false);
  check('grund gesetzt', ergebnis.grund === 'programm_fehlgeschlagen');

  section('echter Programmstart gegen nicht existierende Datei -> ok:false (kein falsches ok:true)');
  ergebnis = await starteProgramm({ name: 'Nicht Vorhanden', pfad: 'C:/diese/datei/gibt/es/wirklich/nicht.exe' });
  check('nicht ok', ergebnis.ok === false);
  check('grund gesetzt', ergebnis.grund === 'programm_fehlgeschlagen');

  section('.lnk-Datei wird wie eine URI ueber "start" geoeffnet');
  aufgerufenMit = null;
  ergebnis = await starteProgramm(
    { name: 'Verknuepfung', pfad: 'C:/Spiele/Valorant.lnk' },
    { ausfuehren: async (cmd, args) => { aufgerufenMit = { cmd, args }; return { ok: true }; } },
  );
  check('ok', ergebnis.ok === true);
  check('cmd ist cmd.exe', aufgerufenMit.cmd === 'cmd');

  section('Datei-Pfad bekommt sein eigenes Verzeichnis als cwd');
  let aufgerufenMitOptionen = null;
  await starteProgramm(
    { name: 'Valorant', pfad: 'C:/Spiele/Valorant/Valorant.exe' },
    { ausfuehren: async (cmd, args, optionen) => { aufgerufenMitOptionen = optionen; return { ok: true }; } },
  );
  check('cwd ist das Verzeichnis der exe', aufgerufenMitOptionen.cwd === 'C:/Spiele/Valorant');

  finish();
})();
