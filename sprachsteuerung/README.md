# Ghostxx Sprachsteuerung (Baustein 1)

Eigenstaendiges Programm, komplett getrennt vom Discord-Bot in `src/`.
Sag "Ghost" und dann einen Satz - die Antwort kommt gesprochen zurueck.

Aufwachwort-Weg: Picovoice verlangt bei der Kontoerstellung eine Firmen-Mail
und blockt alle gaengigen kostenlosen Mail-Anbieter, was ohne echte Firma
nicht zu umgehen war - kurzzeitig auf openWakeWord umgestiegen (kein "Ghost"
als fertiges Wort dort, nur ein paar vortrainierte englische Woerter), dann
auf **sherpa-onnx's Keyword-Spotting** (k2-fsa/sherpa-onnx) gewechselt: ein
"open vocabulary" Erkenner, der ein beliebiges Stichwort per `text2token.py`
in Tokens umwandelt, ganz ohne eigenes Training. Damit ist "GHOST" wieder das
echte Aufwachwort.

## Einmalige Einrichtung

1. `npm install` in diesem Ordner.
2. `whisper.cpp` fuer Windows herunterladen (vorkompilierte **CUDA**-Version
   von github.com/ggml-org/whisper.cpp/releases, `whisper-cublas-*-bin-x64.
   zip` passend zur eigenen CUDA-Version - die reine CPU-Version ist auf
   normaler Hardware ca. 12x langsamer, siehe Handpruefung/Task 8) plus ein
   deutschsprachiges Modell (`ggml-base.bin` von huggingface.co/ggerganov/
   whisper.cpp) in einen Ordner `werkzeuge/` legen.
3. `Piper` fuer Windows herunterladen (github.com/rhasspy/piper/releases)
   plus die Stimme `de_DE-karlsson-low` (von huggingface.co/rhasspy/
   piper-voices, per Hoerprobe mit Kevin ausgewaehlt) in denselben
   `werkzeuge/`-Ordner legen.
4. Sherpa-onnx-KWS-Modell (`sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-
   01-01` von github.com/k2-fsa/sherpa-onnx/releases/tag/kws-models)
   herunterladen, `encoder-*.onnx`/`decoder-*.onnx`/`joiner-*.onnx`/
   `tokens.txt` nach `werkzeuge/sherpa-kws/` legen (umbenannt zu
   `encoder.onnx`/`decoder.onnx`/`joiner.onnx`). "GHOST" ist per
   `werkzeuge/sherpa-kws/text2token.py` schon in `keywords.txt` eingetragen -
   fuer ein anderes Wort: `python text2token.py --text datei.txt --tokens
   tokens.txt --tokens-type bpe --bpe-model bpe.model --output ausgabe.txt`
   (braucht `pip install sentencepiece pypinyin sherpa-onnx`, `bpe.model`
   liegt im heruntergeladenen Modellordner).
5. `.env.example` zu `.env` kopieren, Pfade eintragen.
6. `npm start`.

## Testen

`npm test` prueft die Kernlogik (Text rein -> Antwort raus, alle
Fehlerfaelle) ohne echte Hardware. Aufwachwort-Erkennung, Mikrofon und
Lautsprecher-Ausgabe lassen sich nicht automatisiert testen - das prueft
Kevin selbst per Ohr, siehe die manuelle Abnahme am Ende des Umsetzungsplans.

`MINDEST_FRAMES`, `MINDEST_LAUTSTAERKE` und `RUHEPHASE_NACH_ANTWORT_MS` in
`programm.js` sind Startwerte, noch nicht endgueltig am echten Mikrofon/Raum
feinjustiert - gehoert zur manuellen Abnahme dazu.
