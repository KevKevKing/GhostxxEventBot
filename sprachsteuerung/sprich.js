require('dotenv').config();
const { spawn } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');

// Text-zu-Sprache ueber ein vorkompiliertes Piper-Programm, Wiedergabe ueber
// PowerShells eingebauten Media.SoundPlayer - kein zusaetzliches npm-Paket
// fuer Audiowiedergabe noetig, funktioniert auf jedem Windows-Rechner ohne
// weitere Installation.
//
// Piper bekommt den Text ueber stdin, nicht als Kommandozeilen-Argument -
// laengere Saetze mit Sonderzeichen waeren als Argument fragil.

function echtAusfuehren(cmd, args, options = {}) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { windowsHide: true, ...options });
    let stdout = '';
    let stderr = '';
    if (options.stdin) {
      p.stdin.write(options.stdin);
      p.stdin.end();
    }
    p.stdout?.on('data', (d) => { stdout += d; });
    p.stderr?.on('data', (d) => { stderr += d; });
    p.on('error', () => resolve({ code: -1, stdout, stderr: 'Prozess konnte nicht gestartet werden' }));
    p.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

function pfadFuerTemp() {
  return path.join(os.tmpdir(), `ghostxx-sprich-${Date.now()}.wav`);
}

async function sprich(text, { ausfuehren = echtAusfuehren, ausgabePfad = pfadFuerTemp() } = {}) {
  const piperLauf = await ausfuehren(process.env.PIPER_PROGRAMM_PFAD, [
    '--model', process.env.PIPER_STIMME_PFAD,
    '--output_file', ausgabePfad,
  ], { stdin: text });

  if (piperLauf.code !== 0) {
    return { ok: false, grund: 'piper_fehlgeschlagen' };
  }

  // PowerShell-Escaping: einfache Anfuehrungszeichen im Pfad verdoppeln -
  // in der Praxis unwahrscheinlich (Temp-Pfade), aber billig abzusichern.
  const sichererPfad = ausgabePfad.replace(/'/g, "''");
  const wiedergabeLauf = await ausfuehren('powershell', [
    '-NoProfile',
    '-Command',
    `(New-Object Media.SoundPlayer '${sichererPfad}').PlaySync()`,
  ]);

  if (wiedergabeLauf.code !== 0) {
    return { ok: false, grund: 'wiedergabe_fehlgeschlagen' };
  }

  return { ok: true, grund: '' };
}

module.exports = { sprich };
