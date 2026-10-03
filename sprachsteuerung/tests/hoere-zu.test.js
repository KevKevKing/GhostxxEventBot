const { check, equal, finish, section } = require('./lib');

process.env.WHISPER_PROGRAMM_PFAD = 'C:/werkzeuge/whisper-cli.exe';
process.env.WHISPER_MODELL_PFAD = 'C:/werkzeuge/ggml-base.bin';

const { transkribiere } = require('../hoere-zu');

section('Erfolgreiche Transkription');
(async () => {
  const aufrufe = [];
  const fakeAusfuehren = async (cmd, args) => {
    aufrufe.push([cmd, ...args].join(' '));
    return { code: 0, stdout: '', stderr: '' };
  };
  const fakeDateiLesen = async () => Buffer.from('Wie geht es dir heute?\n');

  const ergebnis = await transkribiere('C:/temp/aufnahme.wav', { ausfuehren: fakeAusfuehren, dateiLesen: fakeDateiLesen });

  check('ok', ergebnis.ok === true);
  equal('Text getrimmt', ergebnis.text, 'Wie geht es dir heute?');
  check('ruft whisper-cli auf', aufrufe[0].includes('whisper-cli.exe'));
  check('uebergibt Modell', aufrufe[0].includes('ggml-base.bin'));
  check('uebergibt WAV-Datei', aufrufe[0].includes('aufnahme.wav'));
  check('deutsche Sprache erzwungen', aufrufe[0].includes('-l de'));

  section('whisper-cli meldet Fehler');
  const fakeFehler = async () => ({ code: 1, stdout: '', stderr: 'Modell nicht gefunden' });
  const fehlerErgebnis = await transkribiere('C:/temp/aufnahme.wav', { ausfuehren: fakeFehler, dateiLesen: fakeDateiLesen });
  check('nicht ok', fehlerErgebnis.ok === false);
  equal('Grund fehlgeschlagen', fehlerErgebnis.grund, 'fehlgeschlagen');

  section('Leere/nur Stille erkannte Transkription');
  const fakeLeereDatei = async () => Buffer.from('   \n');
  const leerErgebnis = await transkribiere('C:/temp/aufnahme.wav', { ausfuehren: fakeAusfuehren, dateiLesen: fakeLeereDatei });
  check('nicht ok bei leerem Text', leerErgebnis.ok === false);
  equal('Grund kein_text', leerErgebnis.grund, 'kein_text');

  section('dateiLesen wirft Fehler (z.B. ENOENT)');
  const fakeWerfendeeDatei = async () => { throw new Error('ENOENT: Datei nicht gefunden'); };
  const werfFehlerErgebnis = await transkribiere('C:/temp/aufnahme.wav', { ausfuehren: fakeAusfuehren, dateiLesen: fakeWerfendeeDatei });
  check('nicht ok bei Datei-Fehler', werfFehlerErgebnis.ok === false);
  equal('Grund fehlgeschlagen', werfFehlerErgebnis.grund, 'fehlgeschlagen');

  finish();
})();
