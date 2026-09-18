'use strict';

const sherpaOnnx = require('sherpa-onnx-node');

// Aufwachwort-Erkennung ueber sherpa-onnx's Keyword-Spotting (KWS) -
// erkennt "GHOST" direkt, ganz ohne Konto/Training. Umstieg von
// openWakeWord: das konnte nur ein paar fertige, vortrainierte Woerter
// ("hey jarvis" etc.), kein eigenes. sherpa-onnx's KWS ist "open
// vocabulary" - jedes Wort laesst sich per text2token.py in Tokens
// umwandeln, ohne das Modell neu zu trainieren (siehe werkzeuge/text2token.py
// und werkzeuge/sherpa-kws/keywords.txt). Gemessen mit synthetischer
// Piper-TTS-Sprache: "ghost" wird erkannt, ein komplett anderer Satz nicht
// (siehe Handpruefung/Task 8).

async function ladeAufwachwort({ ordner }) {
  const kws = new sherpaOnnx.KeywordSpotter({
    featConfig: { sampleRate: 16000, featureDim: 80 },
    modelConfig: {
      transducer: {
        encoder: `${ordner}/encoder.onnx`,
        decoder: `${ordner}/decoder.onnx`,
        joiner: `${ordner}/joiner.onnx`,
      },
      tokens: `${ordner}/tokens.txt`,
      numThreads: 2,
      provider: 'cpu',
      debug: 0,
    },
    keywordsFile: `${ordner}/keywords.txt`,
  });

  let stream = kws.createStream();

  // Nimmt ein Audio-Frame (Int16Array, beliebige Laenge) entgegen und gibt
  // true zurueck, sobald "Ghost" darin erkannt wurde. sherpa-onnx erwartet
  // Float32-Samples im Bereich -1..1, pvrecorder liefert Int16 im Bereich
  // -32768..32767 - deshalb hier umgerechnet.
  function verarbeite(frame) {
    const samples = new Float32Array(frame.length);
    for (let i = 0; i < frame.length; i += 1) samples[i] = frame[i] / 32768;
    stream.acceptWaveform({ sampleRate: 16000, samples });

    let erkannt = false;
    while (kws.isReady(stream)) {
      kws.decode(stream);
      const { keyword } = kws.getResult(stream);
      if (keyword !== '') {
        erkannt = true;
        kws.reset(stream);
      }
    }
    return erkannt;
  }

  // Nach einer Erkennung (oder nach der Ruhephase nach dem Sprechen) wird
  // der Stream verworfen und neu erstellt statt nur reset() aufzurufen -
  // damit garantiert kein alter Zustand aus der Zeit vor dem Sprechen noch
  // mit hineinspielt (gleiches Prinzip wie beim kompletten Neuladen bei
  // openWakeWord zuvor).
  function neuStarten() {
    stream = kws.createStream();
  }

  return { verarbeite, neuStarten };
}

module.exports = { ladeAufwachwort };
