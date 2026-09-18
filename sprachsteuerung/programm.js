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

// Spricht eine feste Antwort, faengt aber selbst einen Wurf dabei ab - ein
// zweiter Fehler beim Melden des ersten Fehlers darf die Kette nicht
// zusaetzlich zum Absturz bringen.
async function sprechenOhneWurf(sprechen, text) {
  try {
    return await sprechen(text);
  } catch {
    return { ok: false };
  }
}

async function verarbeiteAeusserung(wavPfad, {
  transkribieren = transkribierenEcht,
  antworten = antwortenEcht,
  sprechen = sprechenEcht,
  ollamaTimeoutMs = OLLAMA_TIMEOUT_MS,
} = {}) {
  try {
    const gehoert = await transkribieren(wavPfad);
    if (!gehoert || !gehoert.ok) {
      const grund = gehoert && gehoert.grund;
      await sprechenOhneWurf(sprechen, textFuer(grund));
      return { ok: false, gesagt: textFuer(grund) };
    }

    const antwort = await mitTimeout(
      (async () => antworten(gehoert.text))(),
      ollamaTimeoutMs,
    );
    if (!antwort || !antwort.ok) {
      const grund = antwort && antwort.grund;
      await sprechenOhneWurf(sprechen, textFuer(grund));
      return { ok: false, gesagt: textFuer(grund) };
    }

    const gesprochen = await sprechenOhneWurf(sprechen, antwort.text);
    if (!gesprochen || !gesprochen.ok) {
      return { ok: false, gesagt: '' };
    }
    return { ok: true, gesagt: antwort.text };
  } catch {
    // Jeder synchrone oder asynchrone Wurf aus transkribieren/antworten/
    // sprechen landet hier - das Dauerprogramm muss danach sofort wieder
    // auf das naechste Aufwachwort warten koennen statt stehenzubleiben.
    await sprechenOhneWurf(sprechen, textFuer('unerwarteter_fehler'));
    return { ok: false, gesagt: textFuer('unerwarteter_fehler') };
  }
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
      // Ein einzelner Fehler (z.B. recorder.read(), das laut pvrecorder
      // explizit rejecten kann, oder eine fehlende Umgebungsvariable
      // irgendwo in der Kette) darf diese Dauerschleife nicht beenden -
      // sonst reagiert "Ghost" danach ueberhaupt nicht mehr, ohne dass es
      // auffaellt.
      try {
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
      } catch (fehler) {
        console.error('Fehler in der Aufnahme-Schleife, mache weiter:', fehler);
        inAufnahme = false;
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
