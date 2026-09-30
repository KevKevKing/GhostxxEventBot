const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { check, finish, section, useTempData } = require('./lib');

const temp = useTempData();
const { writeFileAtomic } = require('../src/atomic-write');

const ziel = path.join(temp.dir, 'daten.json');

(async () => {
  section('Normalfall');
  await writeFileAtomic(ziel, '{"a":1}');
  check('Datei geschrieben', fs.readFileSync(ziel, 'utf8') === '{"a":1}');
  check('keine .tmp uebrig', !fs.existsSync(`${ziel}.tmp`));

  await writeFileAtomic(ziel, '{"a":2}');
  check('ersetzt sauber', fs.readFileSync(ziel, 'utf8') === '{"a":2}');

  section('Windows-Sperre wird ueberstanden');
  // Genau der Fehler aus dem Log: EPERM beim Umbenennen, weil ein anderer
  // Prozess die Zieldatei kurz offen hat. Nach ein paar Versuchen klappt es.
  const echtesRename = fsp.rename;
  let versuche = 0;
  fsp.rename = async (from, to) => {
    versuche += 1;
    if (versuche <= 2) {
      const fehler = new Error('EPERM: operation not permitted, rename');
      fehler.code = 'EPERM';
      throw fehler;
    }
    return echtesRename(from, to);
  };

  await writeFileAtomic(ziel, '{"a":3}');
  check(`nach ${versuche} Versuchen geschrieben`, fs.readFileSync(ziel, 'utf8') === '{"a":3}');
  check('  keine .tmp uebrig', !fs.existsSync(`${ziel}.tmp`));

  section('Dauerhafter Fehler wird gemeldet');
  // Wichtig: nicht still schlucken. Sonst meldet der Bot Erfolg, waehrend
  // nichts gespeichert wurde.
  fsp.rename = async () => {
    const fehler = new Error('EPERM: operation not permitted, rename');
    fehler.code = 'EPERM';
    throw fehler;
  };

  let geworfen = false;
  try {
    await writeFileAtomic(ziel, '{"a":4}');
  } catch {
    geworfen = true;
  }
  check('Fehler kommt durch', geworfen);
  check('alter Inhalt unversehrt', fs.readFileSync(ziel, 'utf8') === '{"a":3}');
  check('keine verwaiste .tmp', !fs.existsSync(`${ziel}.tmp`));

  fsp.rename = echtesRename;

  section('Andere Fehler werden nicht wiederholt');
  fsp.rename = async () => {
    const fehler = new Error('ENOSPC: no space left on device');
    fehler.code = 'ENOSPC';
    throw fehler;
  };
  const start = Date.now();
  try {
    await writeFileAtomic(ziel, '{"a":5}');
  } catch { /* erwartet */ }
  check('sofort aufgegeben', Date.now() - start < 100, `${Date.now() - start}ms`);
  fsp.rename = echtesRename;

  section('Zwei gleichzeitige Aufrufe fuer denselben Pfad schreiben nacheinander, nicht gegeneinander');
  // Ghosts eigener Code-Vorschlag (30.09.): vorher haengte der Name der
  // .tmp-Datei nur vom Zielpfad ab - zwei gleichzeitige Aufrufe teilten sich
  // dieselbe .tmp, und wer zuerst umbenannte, liess den anderen mit ENOENT
  // scheitern. Verzoegertes fs.writeFile simuliert echte Ueberlappung.
  const echtesWriteFile = fsp.writeFile;
  let aktiveSchreibvorgaenge = 0;
  let maxGleichzeitig = 0;
  fsp.writeFile = async (ziel2, inhalt) => {
    aktiveSchreibvorgaenge += 1;
    maxGleichzeitig = Math.max(maxGleichzeitig, aktiveSchreibvorgaenge);
    await new Promise((resolve) => { setTimeout(resolve, 20); });
    aktiveSchreibvorgaenge -= 1;
    return echtesWriteFile(ziel2, inhalt);
  };

  const gleichzeitigerPfad = path.join(temp.dir, 'gleichzeitig.json');
  const [ergebnisA, ergebnisB] = await Promise.allSettled([
    writeFileAtomic(gleichzeitigerPfad, '{"wer":"a"}'),
    writeFileAtomic(gleichzeitigerPfad, '{"wer":"b"}'),
  ]);
  fsp.writeFile = echtesWriteFile;

  check('kein echtes Ueberlappen der Schreibvorgaenge', maxGleichzeitig === 1, `max ${maxGleichzeitig}`);
  check('erster Aufruf erfolgreich', ergebnisA.status === 'fulfilled');
  check('zweiter Aufruf erfolgreich', ergebnisB.status === 'fulfilled');
  check('Ergebnis ist gueltiges JSON (kein Mix aus beiden)', (() => {
    try { JSON.parse(fs.readFileSync(gleichzeitigerPfad, 'utf8')); return true; } catch { return false; }
  })());
  check('keine verwaiste .tmp', !fs.existsSync(`${gleichzeitigerPfad}.tmp`));

  temp.cleanup();
  finish();
})();
