# Ghostxx Sprachsteuerung (Baustein 1)

Eigenstaendiges Programm, komplett getrennt vom Discord-Bot in `src/`.
Sag "Ghost" und dann einen Satz - die Antwort kommt gesprochen zurueck.

## Einmalige Einrichtung

1. `npm install` in diesem Ordner.
2. Kostenloses Konto unter console.picovoice.ai anlegen, das Wort "Ghost"
   als eigenes Aufwachwort trainieren (Sprache: Deutsch, Plattform:
   Windows), die erzeugte `.ppn`-Datei hier ablegen.
3. `whisper.cpp` fuer Windows herunterladen (vorkompilierte Version von
   github.com/ggml-org/whisper.cpp/releases) plus ein deutschsprachiges
   Modell (`ggml-base.bin` von huggingface.co/ggerganov/whisper.cpp) in
   einen Ordner `werkzeuge/` legen.
4. `Piper` fuer Windows herunterladen (github.com/rhasspy/piper/releases)
   plus eine deutsche Stimme (`de_DE-thorsten-medium`, ebenfalls von den
   Piper-Releases) in denselben `werkzeuge/`-Ordner legen.
5. `.env.example` zu `.env` kopieren, Pfade und den Picovoice-Schluessel
   eintragen.
6. `npm start`.

## Testen

`npm test` prueft die Kernlogik (Text rein -> Antwort raus, alle
Fehlerfaelle) ohne echte Hardware. Aufwachwort-Erkennung, Mikrofon und
Lautsprecher-Ausgabe lassen sich nicht automatisiert testen - das prueft
Kevin selbst per Ohr, siehe die manuelle Abnahme am Ende des Umsetzungsplans.
