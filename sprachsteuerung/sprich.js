require('dotenv').config();
const { spawn } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

// Text-zu-Sprache ueber ein vorkompiliertes Piper-Programm, Wiedergabe ueber
// PowerShells eingebauten Media.SoundPlayer - kein zusaetzliches npm-Paket
// fuer Audiowiedergabe noetig, funktioniert auf jedem Windows-Rechner ohne
// weitere Installation.
//
// Piper bekommt den Text ueber stdin, nicht als Kommandozeilen-Argument -
// laengere Saetze mit Sonderzeichen waeren als Argument fragil.

function echtAusfuehren(cmd, args, { stdin, ...spawnOptions } = {}) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { windowsHide: true, ...spawnOptions });
    let stdout = '';
    let stderr = '';
    if (stdin && p.stdin) {
      // Eigener 'error'-Listener auf dem stdin-Stream selbst noetig - p.on('error', ...)
      // weiter unten deckt NUR Fehler beim Starten/Laufen des Kindprozesses ab, nicht
      // EPIPE/ERR_STREAM_DESTROYED beim Schreiben auf ein bereits kaputtes stdin (z.B.
      // piper.exe startet gar nicht erst). Leerer Handler reicht - der eigentliche
      // Fehler wird ohnehin ueber 'close'/'error' des Kindprozesses sichtbar.
      p.stdin.on('error', () => {});
      p.stdin.write(stdin);
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
  // try/catch um die ganze Funktion: ausfuehren() ist von aussen injizierbar
  // und kann - wie echtAusfuehren() via spawn() bei z.B. fehlender/leerer
  // PIPER_PROGRAMM_PFAD-Umgebungsvariable - auch SYNCHRON werfen, bevor
  // ueberhaupt ein Promise entsteht. sprich() darf trotzdem nie werfen.
  try {
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
  } catch {
    return { ok: false, grund: 'unerwarteter_fehler' };
  } finally {
    // Fuer JEDE gesprochene Antwort (auch jede gesprochene Fehlermeldung) wird
    // eine WAV-Datei erzeugt - ohne Aufraeumen sammeln sich diese in os.tmpdir()
    // unbegrenzt an, bei einem Programm das den ganzen Tag laeuft. Eigenes
    // try/catch (bzw. {force:true}), damit ein Fehlschlagen beim Aufraeumen
    // selbst (z.B. Datei durch einen anderen Prozess gesperrt) nicht die
    // Rueckgabe von sprich() beeinflusst.
    try {
      await fs.promises.rm(ausgabePfad, { force: true });
    } catch {
      // bewusst ignoriert - Aufraeumen ist best effort
    }
  }
}

module.exports = { sprich };
