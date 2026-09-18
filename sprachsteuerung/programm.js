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
  } catch (fehler) {
    // Jeder synchrone oder asynchrone Wurf aus transkribieren/antworten/
    // sprechen landet hier - das Dauerprogramm muss danach sofort wieder
    // auf das naechste Aufwachwort warten koennen statt stehenzubleiben.
    // console.error hier ist wichtig: ohne Log-Zeile waere ein echter Bug in
    // der Kette nur noch als gesprochener Satz erkennbar - bei einem
    // Programm, dessen ganze Schnittstelle Audio ist, die schlechteste
    // denkbare Debugging-Situation.
    console.error('Fehler in verarbeiteAeusserung:', fehler);
    await sprechenOhneWurf(sprechen, textFuer('unerwarteter_fehler'));
    return { ok: false, gesagt: textFuer('unerwarteter_fehler') };
  }
}

/**
 * Echte Verdrahtung mit Mikrofon und Aufwachwort - NICHT automatisiert
 * getestet (echte Hardware). Siehe Umsetzungsplan, manuelle Abnahme.
 */
// Schwellwert fuer "Aufwachwort erkannt" - am echten Mikrofon gemessen
// (Handpruefung 2026-09-18): echtes "Hey Jarvis" schlaegt zuverlaessig auf
// 0.8-0.99 aus, Hintergrund/andere Woerter blieben meist unter 0.5.
const AUFWACHWORT_SCHWELLE = 0.5;

async function starteProgramm() {
  // Erst hier (nicht am Dateianfang) importiert, damit die reine
  // Verarbeitungskette oben ohne installierte native Pakete testbar bleibt,
  // falls @picovoice/pvrecorder-node oder onnxruntime-node auf einem
  // CI-Rechner ohne Audiogeraet nicht laedt.
  const { PvRecorder } = require('@picovoice/pvrecorder-node');
  const { ladeAufwachwort } = require('./aufwachwort');
  const fs = require('node:fs');

  const aufwachwort = await ladeAufwachwort({
    modellPfad: process.env.AUFWACHWORT_MODELL_PFAD,
    melspectrogrammPfad: process.env.AUFWACHWORT_MELSPEKTROGRAMM_PFAD,
    embeddingPfad: process.env.AUFWACHWORT_EMBEDDING_PFAD,
  });

  const FRAME_LAENGE = 512;
  // -1 = Windows-Standardgeraet. Kann ueber MIKROFON_GERAETE_INDEX auf ein
  // bestimmtes Geraet festgelegt werden (siehe geraete-auflisten.js) - z.B.
  // auf ein Geraet mit Rauschunterdrueckung statt einen Mix-Kanal, der auch
  // Spiel-/Musik-/Discord-Ton mit aufnehmen kann.
  const geraeteIndex = process.env.MIKROFON_GERAETE_INDEX
    ? Number.parseInt(process.env.MIKROFON_GERAETE_INDEX, 10)
    : -1;
  const recorder = new PvRecorder(FRAME_LAENGE, geraeteIndex);
  recorder.start();
  console.log('Mikrofon:', recorder.getSelectedDevice());
  console.log('Sprachsteuerung laeuft. Sag "Hey Jarvis" zum Starten.');

  let inAufnahme = false;
  let erkennung = null;
  let frames = [];
  let aufeinanderfolgendeFehler = 0;

  // Sauberes Beenden: recorder gibt natives (Mikrofon-)Handle frei statt es
  // beim Beenden des Prozesses offen zu lassen.
  process.on('SIGINT', () => {
    try {
      recorder.release();
    } catch (fehler) {
      console.error('Fehler beim Freigeben des Recorders:', fehler);
    }
    process.exit(0);
  });

  (async () => {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      // Ein einzelner Fehler (z.B. recorder.read(), das laut pvrecorder
      // explizit rejecten kann, oder eine fehlende Umgebungsvariable
      // irgendwo in der Kette) darf diese Dauerschleife nicht beenden -
      // sonst reagiert "Hey Jarvis" danach ueberhaupt nicht mehr, ohne dass
      // es auffaellt.
      try {
        const frame = await recorder.read();
        aufeinanderfolgendeFehler = 0;

        if (!inAufnahme) {
          const punktzahl = await aufwachwort.verarbeite(frame);
          if (punktzahl >= AUFWACHWORT_SCHWELLE) {
            console.log('Aufwachwort erkannt, ich höre zu...');
            inAufnahme = true;
            erkennung = erstelleStilleErkennung();
            frames = [];
          }
          continue;
        }

        frames.push(Buffer.from(frame.buffer, frame.byteOffset, frame.byteLength));
        const fertig = erkennung.framePruefen(frame);

        if (fertig) {
          inAufnahme = false;
          const wavPfad = path.join(os.tmpdir(), `ghostxx-sprachsteuerung-${Date.now()}.wav`);
          schreibeWav(wavPfad, Buffer.concat(frames), recorder.sampleRate);
          await verarbeiteAeusserung(wavPfad);
          fs.rm(wavPfad, { force: true }, () => {});

          // Waehrend Ghost per Lautsprecher antwortet, wird recorder.read()
          // hier nicht aufgerufen - das native Mikrofon-Ringpuffer sammelt
          // aber trotzdem weiter. Ohne Kopfhoerer faengt das Mikrofon dabei
          // Ghosts eigene Stimme ueber die Lautsprecher auf. Ohne Reset wird
          // dieser aufgestaute Rueckstand beim naechsten read() als ein
          // Schwall verarbeitet und loest das Aufwachwort mehrfach
          // hintereinander erneut aus, obwohl niemand gesprochen hat
          // (gemessen in der Handpruefung/Task 8: 3-4 Ausloesungen in
          // Folge direkt nach einer Antwort). Neustart des Recorders
          // verwirft den angesammelten Rueckstand.
          try {
            recorder.stop();
            recorder.start();
          } catch (fehler) {
            console.error('Fehler beim Zuruecksetzen des Mikrofonpuffers:', fehler);
          }
        }
      } catch (fehler) {
        console.error('Fehler in der Aufnahme-Schleife, mache weiter:', fehler);
        inAufnahme = false;
        aufeinanderfolgendeFehler += 1;
        // Ansteigender Backoff mit Obergrenze: ein dauerhaft fehlschlagendes
        // recorder.read() (z.B. abgestecktes Mikrofon) soll nicht in einer
        // engen Schleife bei jedem Durchlauf sofort erneut versuchen und
        // dabei die CPU/das Log fluten - auf einem Rechner, der sich GPU/CPU
        // mit GTA teilt.
        await new Promise((r) => setTimeout(r, Math.min(5000, 100 * aufeinanderfolgendeFehler)));
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
  // starteProgramm() ist jetzt async (laedt die ONNX-Modelle vor dem Start) -
  // ein Fehler dabei (z.B. fehlender Modellpfad) muss als klare Meldung
  // enden statt als unhandled rejection.
  starteProgramm().catch((fehler) => {
    console.error('Sprachsteuerung konnte nicht gestartet werden:', fehler);
    process.exit(1);
  });
}

module.exports = { starteProgramm, verarbeiteAeusserung };
