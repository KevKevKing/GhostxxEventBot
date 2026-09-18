# Sprachsteuerung für Ghostxx — Design (Baustein 1: Aufwachwort + freies Reden)

Stand: 2026-09-18 · Status: von Kevin freigegeben, bereit für Umsetzungsplanung

## Ziel

Kevin soll mit Ghostxx per Sprache reden können, so wie mit einem Alexa-Gerät:
das Aufwachwort **"Ghost"** sagen, dann eine Frage oder einen Satz sprechen,
und eine gesprochene Antwort zurückbekommen — komplett lokal, ohne dass
Sprachdaten den Rechner verlassen (bis auf den einmaligen, unten beschriebenen
Einrichtungsschritt).

Dies ist bewusst **Baustein 1** eines größeren, von Kevin gewünschten Vorhabens
("Ghost soll wie eine Alexa alles können"). Baustein 1 liefert nur Wecken +
freies Reden — spätere Bausteine (Programme starten, Smart Home) bauen darauf
auf, sind aber nicht Teil dieser Spec.

## Nicht-Ziele (bewusst ausgeklammert)

- **Programme/Spiele per Sprache starten** (z. B. "Ghost, starte Valorant") —
  eigener, späterer Baustein 2, obendrauf auf diesem hier.
- **Smart-Home-Steuerung** (WLAN-Steckdosen, Licht) — von Kevin selbst als
  "bald, irgendwann" eingestuft, nicht jetzt.
- **Ghostxx lernt selbst von anderen Agent-Projekten** (OpenCode, Claude Code,
  Codex, OpenHands, …) — das ist Phase 2 der Selbstverbesserung, ein
  komplett anderes, bereits separat zurückgestelltes Vorhaben. Wird hier
  nicht mit hineingemischt.
- **Zugriff auf Discord-/Event-Daten während des Sprachgesprächs** — Baustein
  1 ist ein rein lokales Gespräch, unabhängig vom laufenden Discord-Bot.
  Nur die "Persönlichkeit" (dasselbe lokale Ollama-Modell, ähnlicher
  System-Prompt) wird geteilt, keine Live-Daten.
- **Echte Selbst-Introspektion** ("wie geht's dir" mit echten Problemen/
  Wünschen aus den tatsächlichen Bot-Daten) — gute, separate Idee, die an
  `self-knowledge.js`s bestehendes Prinzip anknüpfen könnte (Antworten aus
  echten Daten statt vom Modell erfunden), aber ein eigener Baustein, nicht
  Teil dieser Spec.

## Architektur-Überblick

```
Mikrofon (dauerhaft, nur lokal)
        │
        ▼
   Porcupine (Aufwachwort "Ghost")
        │  (Wort erkannt)
        ▼
   Kurzaufnahme bis Sprechpause/Timeout
        │
        ▼
   faster-whisper (Sprache → Text, lokal)
        │
        ▼
   Ollama-Anfrage (dasselbe lokale Modell wie der Bot, eigener HTTP-Aufruf)
        │
        ▼
   Piper (Text → Sprache, lokal)
        │
        ▼
   Ausgabe über die Lautsprecher
```

Läuft als **eigenständiges Programm**, komplett getrennt vom
GhostxxEventBot-Discord-Prozess. Ein Absturz oder Ressourcenproblem hier
kann den produktiven Bot (echte Auszahlungen für 251 Leute) nicht
mitreißen.

## 1) Wo der Code liegt

Neuer Ordner `sprachsteuerung/` im selben Repo, mit eigenem `package.json`
und eigenen Abhängigkeiten (getrennt von den Bot-Abhängigkeiten in
`package.json` im Repo-Wurzelverzeichnis). Wird **nie** von `src/`
importiert, importiert **nie** etwas aus `src/` — die einzige geteilte
Sache ist die Ollama-URL/-Modellwahl als Konfigurationswert, nicht als
Code-Abhängigkeit.

## 2) Komponenten

- **Aufwachwort:** Picovoice Porcupine, trainiert auf "Ghost". Einmaliger,
  kostenloser externer Account nur zum Trainieren des Wortes — danach läuft
  die Erkennung komplett lokal und offline, ohne weitere Netzwerkaufrufe.
  Dies ist der einzige Punkt im ganzen Baustein, an dem ein externer Dienst
  überhaupt beteiligt ist, und das nur einmalig beim Einrichten.
- **Sprache → Text:** faster-whisper, lokal, deutschsprachig. Modellgröße
  (tiny/base/small) wird in der Umsetzungsplanung anhand einer echten
  Messung entschieden (Erkennungsqualität vs. Geschwindigkeit auf Kevins
  Rechner, unter Berücksichtigung der mit GTA geteilten Grafikkarte).
- **Antwort-Erzeugung:** Direkter HTTP-Aufruf an dasselbe lokale
  Ollama (`OLLAMA_URL`, Standard `http://127.0.0.1:11434`), mit einem an den
  Sprachkontext angepassten System-Prompt (kürzere, gesprochen-taugliche
  Antworten — eine lange Textantwort liest sich schlecht vor). Modellwahl
  folgt demselben Prinzip wie beim Bot: bei knapper Grafikkarte automatisch
  das kleinere Modell, dieselbe Logik wie in `src/ollama.js`s
  `pickModel()`, aber als eigener, unabhängiger Code (kein Import).
- **Text → Sprache:** Piper, lokal, deutsche Stimme. Konkrete Stimmauswahl
  wird in der Umsetzungsplanung anhand einer kurzen Hörprobe entschieden.

## 3) Ablauf

1. Porcupine lauscht dauerhaft (minimale Rechenlast) auf das Wort "Ghost".
   Vor der Erkennung wird nichts aufgezeichnet oder verarbeitet.
2. Nach Erkennung: Aufnahme beginnt, endet nach einer Sprechpause (Stille für
   einen festen Zeitraum, Details in der Umsetzungsplanung) oder einem
   harten Zeit-Limit.
3. faster-whisper wandelt die Aufnahme in Text um.
4. Der Text geht an Ollama, mit dem angepassten System-Prompt.
5. Die Textantwort geht durch Piper, die erzeugte Sprachdatei wird über die
   Standard-Audioausgabe abgespielt.
6. Zurück in den Wartezustand (Schritt 1).

## 4) Fehlerbehandlung

- **Ollama nicht erreichbar oder Grafikkarte durch GTA belegt:** feste,
  kurze gesprochene Ansage (z. B. "Ich bin gerade beschäftigt"), kein
  Hängenbleiben, kein Absturz. Folgt demselben Grundsatz wie beim Bot:
  Ollama darf nie blockieren.
- **Whisper erkennt nichts Sinnvolles** (Stille, reines Rauschen): kurze
  Rückfrage statt einer erfundenen Antwort — keine Fantasie-Antwort auf
  unklaren Input.
- **Porcupine erkennt fälschlich "Ghost"** (Hintergrundgeräusch): folgt
  keine erkennbare Sprache innerhalb weniger Sekunden, geht das Programm
  ohne Aktion zurück in den Wartezustand.
- **Piper schlägt fehl:** Antwort wird nicht vorgelesen, aber das Programm
  bleibt am Leben und wartet auf das nächste Aufwachwort (kein Absturz durch
  einen Ausgabe-Fehler).

## 5) Testen

Die Kernlogik (Text rein → Antwort raus, Fehlerfälle wie oben) wird wie im
restlichen Projekt per TDD gebaut und automatisiert getestet — das lässt
sich ohne echtes Mikrofon/Lautsprecher prüfen. Die restlichen Teile
(Aufwachwort-Erkennung, echte Audioaufnahme, echte Sprachausgabe) sind
Hardware-nah und lassen sich nicht sinnvoll automatisiert testen — die
gelten erst als fertig, wenn Kevin sie selbst per Ohr abgenommen hat.

## Offene Punkte für die Umsetzungsplanung

- Genaue faster-whisper-Modellgröße (gemessen, nicht vermutet: Qualität vs.
  Geschwindigkeit auf Kevins Rechner, GPU-Situation berücksichtigen).
- Genaue Piper-Stimme (kurze Hörprobe mit Kevin).
- Genauer Stille-Timeout für das Ende einer Aufnahme.
- Genauer System-Prompt für gesprochen-taugliche, kürzere Antworten.
- Genaue Schritte für das einmalige Picovoice-Setup (Account, Trainieren
  des Worts "Ghost", Zugriffsschlüssel sicher ablegen — nicht im Repo).
- Wie das Programm gestartet wird (manuell, Windows-Autostart, o. ä.) —
  bewusst nicht Teil dieser Spec, da unabhängig vom Discord-Bot-Autostart.
