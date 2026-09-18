require('dotenv').config();
const path = require('node:path');
const os = require('node:os');
const { antworte: antwortenEcht } = require('./ollama-client');
const { transkribiere: transkribierenEcht } = require('./hoere-zu');
const { sprich: sprechenEcht } = require('./sprich');
const { erstelleStilleErkennung, berechneLautstaerke } = require('./aufnahme');
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
    console.log('  -> verstehe... (t0)');
    const t0 = Date.now();
    const gehoert = await transkribieren(wavPfad);
    console.log(`  -> verstehen dauerte ${Date.now() - t0}ms`);
    if (!gehoert || !gehoert.ok) {
      const grund = gehoert && gehoert.grund;
      console.log(`  -> nichts verstanden (${grund || 'unbekannt'})`);
      await sprechenOhneWurf(sprechen, textFuer(grund));
      return { ok: false, gesagt: textFuer(grund) };
    }

    console.log(`  -> verstanden: "${gehoert.text}"`);
    console.log('  -> denke nach...');
    const t1 = Date.now();
    const antwort = await mitTimeout(
      (async () => antworten(gehoert.text))(),
      ollamaTimeoutMs,
    );
    console.log(`  -> denken dauerte ${Date.now() - t1}ms`);
    if (!antwort || !antwort.ok) {
      const grund = antwort && antwort.grund;
      console.log(`  -> keine Antwort (${grund || 'unbekannt'})`);
      await sprechenOhneWurf(sprechen, textFuer(grund));
      return { ok: false, gesagt: textFuer(grund) };
    }

    console.log(`  -> antworte: "${antwort.text}"`);
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
// Mindestanzahl Frames nach dem Aufwachwort, bevor ueberhaupt transkribiert
// wird - eine echte Aeusserung braucht neben den stilleFramesZumBeenden
// (12, siehe aufnahme.js) noch ein paar echte Sprach-Frames davor. Ohne
// diese Grenze wertet der Code eine sofortige Stille (z.B. Nachhall von
// Ghosts eigener Stimme durch den Lautsprecher, ohne Kopfhoerer) als echte,
// aber leere Aeusserung - Whisper "erfindet" dann Text daraus, Ollama
// antwortet normal darauf, die Antwort wird selbst wieder gehoert usw.
// (gemessen in der Handpruefung/Task 8: 12-Frame-"Aeusserungen" in einer
// sich selbst antreibenden Kette). Startwert, noch nicht feinjustiert.
const MINDEST_FRAMES = 20;

// Durchschnittliche Lautstaerke (RMS, wie aufnahme.js's schwelle) ueber die
// GESAMTE Aufnahme, die eine echte Aeusserung mindestens haben muss - fischt
// vor allem den Fall raus, in dem eine Aufnahme knapp ueber MINDEST_FRAMES
// kommt, aber ueberwiegend aus der erzwungenen Stille am Ende besteht
// (gemessen: solche Aufnahmen liess Whisper trotzdem nicht leer, sondern hat
// Text erfunden). Trennt NICHT laute Klopf-/Stoss-Geraeusche von echter
// Sprache - beide sind laut. Startwert, noch nicht feinjustiert.
const MINDEST_LAUTSTAERKE = 300;

// Ruhephase nach dem Sprechen, bevor wieder auf das Aufwachwort gehoert
// wird - Raumhall von Ghosts eigener Stimme (ohne Kopfhoerer) klingt sonst
// noch kurz nach und kann sofort wieder als Sprache gewertet werden.
// Startwert, noch nicht am echten Raum gemessen.
const RUHEPHASE_NACH_ANTWORT_MS = 2000;

async function starteProgramm() {
  // Erst hier (nicht am Dateianfang) importiert, damit die reine
  // Verarbeitungskette oben ohne installierte native Pakete testbar bleibt,
  // falls @picovoice/pvrecorder-node oder onnxruntime-node auf einem
  // CI-Rechner ohne Audiogeraet nicht laedt.
  const { PvRecorder } = require('@picovoice/pvrecorder-node');
  const { ladeAufwachwort } = require('./aufwachwort');
  const fs = require('node:fs');

  const aufwachwort = await ladeAufwachwort({
    ordner: process.env.AUFWACHWORT_MODELL_ORDNER,
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
  console.log('Sprachsteuerung laeuft. Sag "Ghost" zum Starten.');

  let inAufnahme = false;
  let erkennung = null;
  let frames = [];
  let lautstaerkeSumme = 0;
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

  // Waehrend Ghost per Lautsprecher redet, wird recorder.read() nicht
  // aufgerufen - das native Mikrofon-Ringpuffer sammelt aber trotzdem
  // weiter, und ohne Kopfhoerer faengt das Mikrofon dabei Ghosts eigene
  // Stimme ueber die Lautsprecher auf (plus Raumhall danach). Rueckstand
  // durch Lesen+Verwerfen abbauen UND den Aufwachwort-Stream neu erstellen,
  // damit garantiert kein alter Zustand aus der Zeit vor dem Sprechen noch
  // mit hineinspielt.
  async function ruheUndNeuLaden() {
    const ruhephaseEnde = Date.now() + RUHEPHASE_NACH_ANTWORT_MS;
    while (Date.now() < ruhephaseEnde) {
      await recorder.read().catch(() => {});
    }
    aufwachwort.neuStarten();
  }

  (async () => {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      // Ein einzelner Fehler (z.B. recorder.read(), das laut pvrecorder
      // explizit rejecten kann, oder eine fehlende Umgebungsvariable
      // irgendwo in der Kette) darf diese Dauerschleife nicht beenden -
      // sonst reagiert "Ghost" danach ueberhaupt nicht mehr, ohne dass
      // es auffaellt.
      try {
        const frame = await recorder.read();
        aufeinanderfolgendeFehler = 0;

        if (!inAufnahme) {
          const erkannt = aufwachwort.verarbeite(frame);
          if (erkannt) {
            console.log('\n"Ghost" erkannt - ich höre zu...');
            // Eine sofortige gesprochene "Ja?"-Rueckmeldung wurde hier
            // ausprobiert (wie der Signalton bei Alexa/Google), aber wieder
            // entfernt: da man erfahrungsgemaess nicht auf sie wartet und
            // einfach weiterredet, sammelte sich waehrend ihrer Wiedergabe
            // ein Mikrofon-Rueckstand an, der den Anfang der echten Aufnahme
            // verschluckte oder verfaelschte (gemessen in der
            // Handpruefung/Task 8).
            inAufnahme = true;
            erkennung = erstelleStilleErkennung();
            // Kein Vorpuffer mehr (frueher hier ausprobiert): der sollte den
            // Satzanfang direkt nach "Ghost" retten, hat aber
            // stattdessen den Wortschwanz von "...arvis" mit in die Aufnahme
            // gezogen - Whisper hat daraus ein falsches Fuellwort erfunden
            // ("Der Javis, wie ist...", "es wie geht's dir?"). Das eigentliche
            // Problem (keine Zeit zum Reden) loest stattdessen aufnahme.js's
            // Regel, dass Stille erst nach der ersten echten Sprache zaehlt.
            frames = [];
            lautstaerkeSumme = 0;
            continue;
          }
          continue;
        }

        frames.push(Buffer.from(frame.buffer, frame.byteOffset, frame.byteLength));
        lautstaerkeSumme += berechneLautstaerke(frame);
        const fertig = erkennung.framePruefen(frame);

        if (fertig) {
          inAufnahme = false;
          const durchschnittsLautstaerke = lautstaerkeSumme / frames.length;

          // Zu kurz oder im Schnitt zu leise fuer eine echte Aeusserung
          // (siehe MINDEST_FRAMES/MINDEST_LAUTSTAERKE oben) - vermutlich ein
          // Fehlalarm ohne echte Sprache danach (z.B. kurzes Klopfen am
          // Mikrofon, das das Aufwachwort ausgeloest hat, aber danach nur
          // Stille/Rauschen folgt). Bewusst NICHTS antworten (auch keine
          // feste Fehlerantwort, Whisper wuerde sonst oft Text aus dem
          // Rauschen erfinden statt "nichts verstanden" zu sagen) und still
          // weiterhoeren - jede gesprochene Antwort koennte selbst wieder
          // als Aufwachwort gewertet werden und die Kette fortsetzen.
          console.log(`  -> Aufnahme: ${frames.length} Frames (~${(frames.length * 32).toFixed(0)}ms), Lautstaerke ${durchschnittsLautstaerke.toFixed(0)}`);
          if (frames.length < MINDEST_FRAMES || durchschnittsLautstaerke < MINDEST_LAUTSTAERKE) {
            console.log('  -> zu kurz oder zu leise, war wohl nichts - ich höre weiter zu.');
            frames = [];
            // Die sofortige "Ja?"-Rueckmeldung wurde bereits gesprochen,
            // bevor klar war, dass diese Aufnahme zu kurz/leise ist - ohne
            // die gleiche Ruhephase+Neuladen wie unten wuerde ihr eigener
            // Nachhall sich sofort wieder selbst ausloesen (gemessen: genau
            // das ist passiert, "Ja?" in einer Dauerschleife).
            await ruheUndNeuLaden();
            continue;
          }

          const wavPfad = path.join(os.tmpdir(), `ghostxx-sprachsteuerung-${Date.now()}.wav`);
          schreibeWav(wavPfad, Buffer.concat(frames), recorder.sampleRate);
          await verarbeiteAeusserung(wavPfad);
          fs.rm(wavPfad, { force: true }, () => {});
          await ruheUndNeuLaden();
          console.log('Ich höre wieder zu (sag "Ghost").');
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
