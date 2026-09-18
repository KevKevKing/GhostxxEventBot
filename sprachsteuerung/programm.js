require('dotenv').config();
const path = require('node:path');
const os = require('node:os');
const { antworte: antwortenEcht } = require('./ollama-client');
const { transkribiere: transkribierenEcht } = require('./hoere-zu');
const { sprich: sprechenEcht } = require('./sprich');
const { erstelleStilleErkennung } = require('./aufnahme');
const { textFuer } = require('./feste-antworten');

// Verbindet die einzelnen Schritte zur kompletten Kette: Aufnahme (WAV) ->
// Text -> Antwort -> Sprache. Jeder Fehlerfall fuehrt zu einer festen,
// gesprochenen Antwort statt eines Absturzes - das Programm muss nach
// jedem Fehler sofort wieder auf das naechste Aufwachwort warten koennen.

const OLLAMA_TIMEOUT_MS = 15 * 1000;

function mitTimeout(versprechen, timeoutMs) {
  return Promise.race([
    versprechen,
    new Promise((resolve) => setTimeout(() => resolve({ ok: false, grund: 'timeout_ollama' }), timeoutMs)),
  ]);
}

async function verarbeiteAeusserung(wavPfad, {
  transkribieren = transkribierenEcht,
  antworten = antwortenEcht,
  sprechen = sprechenEcht,
  ollamaTimeoutMs = OLLAMA_TIMEOUT_MS,
} = {}) {
  const gehoert = await transkribieren(wavPfad);
  if (!gehoert.ok) {
    await sprechen(textFuer(gehoert.grund));
    return { ok: false, gesagt: textFuer(gehoert.grund) };
  }

  const antwort = await mitTimeout(antworten(gehoert.text), ollamaTimeoutMs);
  if (!antwort.ok) {
    await sprechen(textFuer(antwort.grund));
    return { ok: false, gesagt: textFuer(antwort.grund) };
  }

  await sprechen(antwort.text);
  return { ok: true, gesagt: antwort.text };
}

/**
 * Echte Verdrahtung mit Mikrofon und Aufwachwort - NICHT automatisiert
 * getestet (echte Hardware). Siehe Umsetzungsplan, manuelle Abnahme.
 */
function starteProgramm() {
  // Erst hier (nicht am Dateianfang) importiert, damit die reine
  // Verarbeitungskette oben ohne installierte native Pakete testbar bleibt,
  // falls @picovoice/* auf einem CI-Rechner ohne Audiogeraet nicht laedt.
  const { Porcupine } = require('@picovoice/porcupine-node');
  const { PvRecorder } = require('@picovoice/pvrecorder-node');
  const fs = require('node:fs');

  const porcupine = new Porcupine(
    process.env.PICOVOICE_ACCESS_KEY,
    [process.env.PORCUPINE_KEYWORD_PFAD],
    [0.5],
  );

  const recorder = new PvRecorder(porcupine.frameLength, -1);
  recorder.start();
  console.log('Sprachsteuerung laeuft. Sag "Ghost" zum Starten.');

  let inAufnahme = false;
  let erkennung = null;
  let frames = [];

  (async () => {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const frame = await recorder.read();

      if (!inAufnahme) {
        const treffer = porcupine.process(frame);
        if (treffer !== -1) {
          console.log('Aufwachwort erkannt, ich höre zu...');
          inAufnahme = true;
          erkennung = erstelleStilleErkennung();
          frames = [];
        }
        continue;
      }

      frames.push(Buffer.from(frame.buffer));
      const fertig = erkennung.framePruefen(frame);

      if (fertig) {
        inAufnahme = false;
        const wavPfad = path.join(os.tmpdir(), `ghostxx-sprachsteuerung-${Date.now()}.wav`);
        schreibeWav(wavPfad, Buffer.concat(frames), recorder.sampleRate);
        await verarbeiteAeusserung(wavPfad);
        fs.rm(wavPfad, { force: true }, () => {});
      }
    }
  })();
}

/** Minimaler WAV-Header fuer 16-Bit-Mono-PCM - keine externe Bibliothek noetig. */
function schreibeWav(pfad, pcmDaten, sampleRate) {
  const fs = require('node:fs');
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcmDaten.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcmDaten.length, 40);
  fs.writeFileSync(pfad, Buffer.concat([header, pcmDaten]));
}

if (require.main === module) {
  starteProgramm();
}

module.exports = { starteProgramm, verarbeiteAeusserung };
