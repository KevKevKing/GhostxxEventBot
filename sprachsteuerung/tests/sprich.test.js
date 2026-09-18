const { check, equal, finish, section } = require('./lib');

process.env.PIPER_PROGRAMM_PFAD = 'C:/werkzeuge/piper.exe';
process.env.PIPER_STIMME_PFAD = 'C:/werkzeuge/de_DE-thorsten-medium.onnx';

const { sprich } = require('../sprich');

section('Erfolgreiche Sprachausgabe');
(async () => {
  const aufrufe = [];
  const fakeAusfuehren = async (cmd, args) => {
    aufrufe.push([cmd, ...args].join(' '));
    return { code: 0, stdout: '', stderr: '' };
  };

  const ergebnis = await sprich('Mir geht es gut.', { ausfuehren: fakeAusfuehren, ausgabePfad: 'C:/temp/antwort.wav' });

  check('ok', ergebnis.ok === true);
  check('zwei Aufrufe: Piper und Wiedergabe', aufrufe.length === 2);
  check('erster Aufruf ist Piper', aufrufe[0].includes('piper.exe'));
  check('Piper bekommt die Stimme', aufrufe[0].includes('de_DE-thorsten-medium.onnx'));
  check('Piper bekommt die Ausgabedatei', aufrufe[0].includes('antwort.wav'));
  check('zweiter Aufruf ist powershell', aufrufe[1].toLowerCase().includes('powershell'));
  check('Wiedergabe nutzt dieselbe Datei', aufrufe[1].includes('antwort.wav'));

  section('Piper schlaegt fehl');
  const aufrufePiperFehler = [];
  const fakePiperFehler = async (cmd, args) => {
    aufrufePiperFehler.push(cmd);
    if (cmd.includes('piper')) return { code: 1, stdout: '', stderr: 'Stimme nicht gefunden' };
    return { code: 0, stdout: '', stderr: '' };
  };
  const fehlerErgebnis = await sprich('Test', { ausfuehren: fakePiperFehler, ausgabePfad: 'C:/temp/antwort.wav' });
  check('nicht ok', fehlerErgebnis.ok === false);
  equal('Grund piper_fehlgeschlagen', fehlerErgebnis.grund, 'piper_fehlgeschlagen');
  check('Wiedergabe wird bei Piper-Fehler nicht versucht', !aufrufePiperFehler.some((c) => c.toLowerCase().includes('powershell')));

  section('Wiedergabe schlaegt fehl, Piper aber erfolgreich');
  const fakeWiedergabeFehler = async (cmd) => {
    if (cmd.includes('piper')) return { code: 0, stdout: '', stderr: '' };
    return { code: 1, stdout: '', stderr: 'Kein Audiogeraet' };
  };
  const wiedergabeFehlerErgebnis = await sprich('Test', { ausfuehren: fakeWiedergabeFehler, ausgabePfad: 'C:/temp/antwort.wav' });
  check('nicht ok', wiedergabeFehlerErgebnis.ok === false);
  equal('Grund wiedergabe_fehlgeschlagen', wiedergabeFehlerErgebnis.grund, 'wiedergabe_fehlgeschlagen');

  finish();
})();
