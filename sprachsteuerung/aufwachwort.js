'use strict';

const ort = require('onnxruntime-node');

// Nachbau der openWakeWord-Erkennung (Mel-Spektrogramm -> Embedding ->
// Klassifikator ueber ein gleitendes Zeitfenster) fuer Node. Das einzige
// fertige npm-Paket dafuer (openwakeword-js) ist fuer den Browser gebaut und
// stuerzt in Node beim Laden des onnxruntime-web-Backends ab ("Dynamic
// require of node:os is not supported") - deshalb hier direkt gegen
// onnxruntime-node, dem echten Node-Paket. Rechenweg 1:1 nach der
// Referenzimplementierung von github.com/dscripka/openWakeWord uebernommen,
// nicht selbst erfunden.

const CHUNK_GROESSE = 1280; // 80ms bei 16kHz, von openWakeWord vorgegeben
const MEL_KONTEXT = 480;
const MEL_BAENDER = 32;
const FRAMES_PRO_CHUNK = 8;
const MEL_FENSTER = 76;
const EMBEDDING_FENSTER_STANDARD = 24;
const MAX_MEL_FRAMES = 970;
const ANLAUF_FRAMES_UNTERDRUECKEN = 5;
const VORHERSAGE_PUFFER_MAX = 30;
const MAX_EMBEDDING_PUFFER = 50;

async function ladeAufwachwort({ modellPfad, melspectrogrammPfad, embeddingPfad }) {
  const melSession = await ort.InferenceSession.create(melspectrogrammPfad);
  const embeddingSession = await ort.InferenceSession.create(embeddingPfad);
  const klassifikator = await ort.InferenceSession.create(modellPfad);

  // Verschiedene Aufwachwort-Modelle erwarten unterschiedlich lange
  // Embedding-Fenster (hey_jarvis z.B. 16 statt der ueblichen 24) - per
  // absichtlich fehlschlagendem Probelauf herausfinden statt zu raten, die
  // Fehlermeldung von onnxruntime nennt die erwartete Groesse.
  let embeddingFenster = EMBEDDING_FENSTER_STANDARD;
  try {
    const probeTensor = new ort.Tensor('float32', new Float32Array(EMBEDDING_FENSTER_STANDARD * 96), [1, EMBEDDING_FENSTER_STANDARD, 96]);
    await klassifikator.run({ [klassifikator.inputNames[0]]: probeTensor });
  } catch (fehler) {
    const treffer = String(fehler).match(/Expected:\s*(\d+)/);
    if (treffer) embeddingFenster = Number.parseInt(treffer[1], 10);
  }

  let melPuffer = Array.from({ length: MEL_FENSTER }, () => new Float32Array(MEL_BAENDER).fill(1));
  let embeddingPuffer = [];
  let vorhersagePuffer = [];
  let restAudio = new Float32Array(0);
  let melKontext = new Float32Array(MEL_KONTEXT);

  async function melSpektrogrammLauf(input) {
    const tensor = new ort.Tensor('float32', input, [1, input.length]);
    const ergebnis = await melSession.run({ [melSession.inputNames[0]]: tensor });
    return ergebnis[melSession.outputNames[0]].data;
  }

  async function embeddingLauf() {
    const fensterDaten = new Float32Array(MEL_FENSTER * MEL_BAENDER);
    const start = melPuffer.length - MEL_FENSTER;
    for (let t = 0; t < MEL_FENSTER; t++) {
      fensterDaten.set(melPuffer[start + t], t * MEL_BAENDER);
    }
    const tensor = new ort.Tensor('float32', fensterDaten, [1, MEL_FENSTER, MEL_BAENDER, 1]);
    const ergebnis = await embeddingSession.run({ [embeddingSession.inputNames[0]]: tensor });
    const ausgabe = ergebnis[embeddingSession.outputNames[0]].data;
    const embedding = new Float32Array(96);
    for (let i = 0; i < 96; i++) {
      const wert = ausgabe[i];
      embedding[i] = Number.isFinite(wert) ? wert : 0;
    }
    return embedding;
  }

  async function klassifiziere() {
    const daten = new Float32Array(embeddingFenster * 96);
    const start = embeddingPuffer.length - embeddingFenster;
    for (let t = 0; t < embeddingFenster; t++) {
      daten.set(embeddingPuffer[start + t], t * 96);
    }
    const tensor = new ort.Tensor('float32', daten, [1, embeddingFenster, 96]);
    const ergebnis = await klassifikator.run({ [klassifikator.inputNames[0]]: tensor });
    return ergebnis[klassifikator.outputNames[0]].data[0];
  }

  // Fuellt Mel- und Embedding-Puffer fuer einen Chunk, OHNE den Klassifikator
  // aufzurufen - der braucht ein bereits gefuelltes Embedding-Fenster
  // (EMBEDDING_FENSTER Eintraege), das beim Vorwaermen noch nicht existiert.
  async function melUndEmbeddingVerarbeiten(chunk) {
    const melInput = new Float32Array(CHUNK_GROESSE + MEL_KONTEXT);
    melInput.set(melKontext);
    melInput.set(chunk, MEL_KONTEXT);
    melKontext = chunk.slice(chunk.length - MEL_KONTEXT);

    const melAusgabe = await melSpektrogrammLauf(melInput);
    for (let f = 0; f < FRAMES_PRO_CHUNK; f++) {
      const frame = new Float32Array(MEL_BAENDER);
      for (let b = 0; b < MEL_BAENDER; b++) {
        frame[b] = melAusgabe[f * MEL_BAENDER + b] / 10 + 2;
      }
      melPuffer.push(frame);
    }
    while (melPuffer.length > MAX_MEL_FRAMES) melPuffer.shift();

    const embedding = await embeddingLauf();
    embeddingPuffer.push(embedding);
    while (embeddingPuffer.length > MAX_EMBEDDING_PUFFER) embeddingPuffer.shift();
  }

  async function chunkVerarbeiten(chunk) {
    await melUndEmbeddingVerarbeiten(chunk);

    const punktzahl = await klassifiziere();
    vorhersagePuffer.push(punktzahl);
    while (vorhersagePuffer.length > VORHERSAGE_PUFFER_MAX) vorhersagePuffer.shift();

    // Die ersten paar Frames nach dem Start (oder nach einer Pause) liefern
    // verzerrte Werte, weil das Embedding-Fenster noch nicht mit echtem
    // Audio gefuellt ist - wie im Original wird das hier unterdrueckt statt
    // als Fehlalarm gewertet.
    if (vorhersagePuffer.length < ANLAUF_FRAMES_UNTERDRUECKEN) return 0;
    return punktzahl;
  }

  // Vorwaermen mit Rauschen: ohne echten Vorlauf liefert der Klassifikator
  // die ersten Sekunden lang verzerrte Werte, weil sein gleitendes
  // Embedding-Fenster auf Vorgeschichte angewiesen ist (siehe Original).
  // Ruft bewusst nur Mel+Embedding auf, keinen Klassifikator (siehe oben).
  const rauschen = new Float32Array(16000 * 4);
  for (let i = 0; i < rauschen.length; i++) rauschen[i] = Math.random() * 2000 - 1000;
  for (let i = 0; i + CHUNK_GROESSE <= rauschen.length; i += CHUNK_GROESSE) {
    await melUndEmbeddingVerarbeiten(rauschen.subarray(i, i + CHUNK_GROESSE));
  }

  // Nimmt ein Audio-Frame (Int16Array, beliebige Laenge) entgegen und gibt
  // die hoechste Erkennungs-Punktzahl (0..1) aus den darin enthaltenen
  // 80ms-Abschnitten zurueck. Puffert intern ueberschuessiges Audio, ein
  // Aufrufer muss sich nicht um die feste Chunk-Groesse kuemmern.
  async function verarbeite(frame) {
    const pcm = new Float32Array(frame.length);
    for (let i = 0; i < frame.length; i++) pcm[i] = frame[i];

    const kombiniert = new Float32Array(restAudio.length + pcm.length);
    kombiniert.set(restAudio);
    kombiniert.set(pcm, restAudio.length);

    let hoechsterWert = 0;
    let versatz = 0;
    while (versatz + CHUNK_GROESSE <= kombiniert.length) {
      const chunk = kombiniert.subarray(versatz, versatz + CHUNK_GROESSE);
      versatz += CHUNK_GROESSE;
      const wert = await chunkVerarbeiten(chunk);
      if (wert > hoechsterWert) hoechsterWert = wert;
    }
    restAudio = kombiniert.slice(versatz);
    return hoechsterWert;
  }

  return { verarbeite };
}

module.exports = { ladeAufwachwort };
