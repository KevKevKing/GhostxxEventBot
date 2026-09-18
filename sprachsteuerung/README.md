# Ghostxx Sprachsteuerung (Baustein 1)

Eigenstaendiges Programm, komplett getrennt vom Discord-Bot in `src/`.
Sag "Hey Jarvis" und dann einen Satz - die Antwort kommt gesprochen zurueck.

Aufwachwort urspruenglich als "Ghost" ueber Picovoice geplant - Picovoice
verlangt bei der Kontoerstellung aber eine Firmen-Mail und blockt alle
gaengigen kostenlosen Mail-Anbieter, was ohne echte Firma nicht zu umgehen
war. Umgestiegen auf **openWakeWord**, komplett lokal, ohne Konto oder
Zugriffsschluessel. Dafuer gibt es dort kein "Ghost" als fertiges Wort,
nur ein paar vortrainierte ("alexa", "hey mycroft", "hey jarvis",
"hey rhasspy") - eigenes Wort trainieren waere ein eigenes, groesseres
Vorhaben. "Hey Jarvis" kam der Sache am naechsten.

## Einmalige Einrichtung

1. `npm install` in diesem Ordner.
2. `whisper.cpp` fuer Windows herunterladen (vorkompilierte Version von
   github.com/ggml-org/whisper.cpp/releases) plus ein deutschsprachiges
   Modell (`ggml-base.bin` von huggingface.co/ggerganov/whisper.cpp) in
   einen Ordner `werkzeuge/` legen.
3. `Piper` fuer Windows herunterladen (github.com/rhasspy/piper/releases)
   plus die Stimme `de_DE-karlsson-low` (von huggingface.co/rhasspy/
   piper-voices, per Hoerprobe mit Kevin ausgewaehlt) in denselben
   `werkzeuge/`-Ordner legen.
4. Die drei openWakeWord-Modelldateien (`melspectrogram.onnx`,
   `embedding_model.onnx`, `hey_jarvis.onnx`) nach
   `werkzeuge/openwakeword/` legen - Quellen: `melspectrogram.onnx` und
   `embedding_model.onnx` vom offiziellen Python-Paket (z. B. ueber
   `npx openwakeword-js-setup` mitgeliefert), `hey_jarvis.onnx` aus den
   GitHub-Releases von github.com/dscripka/openWakeWord (Release v0.5.1,
   Datei `hey_jarvis_v0.1.onnx`). Kein Konto noetig.
5. `.env.example` zu `.env` kopieren, Pfade eintragen.
6. `npm start`.

## Testen

`npm test` prueft die Kernlogik (Text rein -> Antwort raus, alle
Fehlerfaelle) ohne echte Hardware. Aufwachwort-Erkennung, Mikrofon und
Lautsprecher-Ausgabe lassen sich nicht automatisiert testen - das prueft
Kevin selbst per Ohr, siehe die manuelle Abnahme am Ende des Umsetzungsplans.

Die Aufwachwort-Schwelle (`AUFWACHWORT_SCHWELLE` in `programm.js`, aktuell
0.5) ist ein Startwert, noch nicht am echten Mikrofon gemessen - gehoert zur
manuellen Abnahme dazu.
