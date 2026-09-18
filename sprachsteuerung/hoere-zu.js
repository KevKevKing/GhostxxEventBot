require('dotenv').config();
const { spawn } = require('node:child_process');
const fs = require('node:fs');

// Sprache-zu-Text ueber ein vorkompiliertes whisper.cpp-Programm, per
// child_process wie das Hauptprojekt bereits externe Werkzeuge einbindet
// (siehe src/system-werte.js fuer nvidia-smi). Kein Python noetig, keine
// native Kompilierung in diesem Projekt - nur ein fertiges .exe aufrufen.

function echtAusfuehren(cmd, args) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    p.stdout?.on('data', (d) => { stdout += d; });
    p.stderr?.on('data', (d) => { stderr += d; });
    p.on('error', () => resolve({ code: -1, stdout, stderr: 'Prozess konnte nicht gestartet werden' }));
    p.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

async function transkribiere(wavPfad, { ausfuehren = echtAusfuehren, dateiLesen = fs.promises.readFile } = {}) {
  const ausgabeOhneEndung = wavPfad.replace(/\.wav$/i, '');

  const lauf = await ausfuehren(process.env.WHISPER_PROGRAMM_PFAD, [
    '-m', process.env.WHISPER_MODELL_PFAD,
    '-f', wavPfad,
    '-l', 'de',
    '--no-timestamps',
    '--output-txt',
    '--output-file', ausgabeOhneEndung,
  ]);

  if (lauf.code !== 0) {
    return { ok: false, grund: 'fehlgeschlagen' };
  }

  let inhalt;
  try {
    inhalt = (await dateiLesen(`${ausgabeOhneEndung}.txt`)).toString('utf8').trim();
  } catch {
    return { ok: false, grund: 'fehlgeschlagen' };
  }

  if (!inhalt) return { ok: false, grund: 'kein_text' };

  return { ok: true, text: inhalt };
}

module.exports = { transkribiere };
