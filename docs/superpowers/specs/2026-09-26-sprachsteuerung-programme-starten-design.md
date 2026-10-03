# Sprachsteuerung für Ghostxx — Design (Baustein 2: Programme starten)

Stand: 2026-09-26 · Status: von Kevin freigegeben, bereit für Umsetzungsplanung

## Ziel

Kevin soll per Sprache ("Ghost, starte Valorant") ein Programm/Spiel von einer
vorher festgelegten Liste aus starten können — obendrauf auf Baustein 1
(Aufwachwort + freies Reden), ohne dessen Verhalten zu verändern.

## Nicht-Ziele (bewusst ausgeklammert)

- **Beliebige, unbekannte Programmnamen erraten** — Kevin will explizit
  keine Erfindungen. Nur was auf der Liste steht, lässt sich starten.
- **Dashboard mit Live-Status** (hört zu → versteht → denkt → spricht) —
  gute, separate Idee, eigenes späteres Thema, nicht Teil dieser Spec.
- **Smart-Home-Steuerung** (Baustein 3) — weiterhin zurückgestellt.
- **Alexa/Echo-Dot-Integration** — kurz besprochen, bewusst verworfen: würde
  Sprachdaten über Amazons Cloud schicken, genau das Gegenteil vom Grund,
  warum Ghostxx' Sprachsteuerung lokal gebaut wurde.
- **Programme beenden, Fenster wechseln, o.ä.** — nur Starten, sonst nichts.

## Architektur-Überblick

Baut auf der bestehenden Kette aus Baustein 1 auf
(`sprachsteuerung/programm.js`, `verarbeiteAeusserung()`), fügt aber einen
**Parser vor Ollama** ein — folgt dem Grundsatz aus `CLAUDE.md`: "erst
ablesen, dann raten". Ein Programmname ist eindeutig aus dem gesprochenen
Text ablesbar (steht wortwörtlich auf einer festen Liste), braucht also kein
Sprachmodell.

```
Text von Whisper
        │
        ▼
  Programm-Parser (neu)
        │
   ┌────┴─────┐
   │ Treffer   │ kein Start-Wort erkannt
   │(Startwort │
   │+ Name)    │
   ▼           ▼
Programm    weiter wie bisher:
starten,    Ollama-Anfrage (Baustein 1)
feste
Ansage
   │
   ▼
Startwort erkannt,
aber Name nicht
auf der Liste
   │
   ▼
feste Ansage
"kenn ich nicht"
```

## Komponenten

- **Programmliste** (`sprachsteuerung/programme.json` o. ä., von Kevin selbst
  gepflegt): Liste aus `{ name, pfad }`-Einträgen. `name` ist das gesprochene
  Wort (z. B. "Valorant"), `pfad` ist entweder ein Datei-Pfad (`.exe`) oder
  eine URI (z. B. `steam://rungameid/...` für Spiele, die über einen
  Launcher/Anti-Cheat starten müssen, nicht direkt über eine `.exe`) —
  genaues Format wird in der Umsetzungsplanung festgelegt.
- **Programm-Parser** (neues Modul, eigenständig wie die übrigen
  Sprachsteuerungs-Module, kein Import aus `src/`): prüft, ob der erkannte
  Text ein Start-Wort ("starte", "öffne", "mach ... an", ggf. weitere
  Konjugationen) **und** einen Namen aus der Liste enthält (Groß-/
  Kleinschreibung egal, Reihenfolge/Umschreibung egal). Reine Textprüfung,
  kein Sprachmodell.
- **Programm-Starter** (neues Modul): startet das Programm über den
  hinterlegten Pfad/die URI (`child_process.spawn`/`start`, wie das Projekt
  bereits externe Programme aufruft, z. B. Piper/whisper.cpp), unabhängig
  vom Ausgang meldet es Erfolg/Fehlschlag zurück — folgt demselben
  `{ok, grund}`-Muster wie die übrigen Module.

## Ablauf

1. Whisper liefert wie bisher den erkannten Text.
2. Der Programm-Parser prüft zuerst: Start-Wort + bekannter Name?
   - **Ja:** Programm wird gestartet, feste gesprochene Bestätigung
     ("Starte Valorant."), **kein** Ollama-Aufruf.
   - **Start-Wort ja, Name nicht in der Liste:** feste Ansage ("Das kenne
     ich nicht, das musst du erst zur Liste hinzufügen."), kein Start, kein
     Ollama-Aufruf.
   - **Kein Start-Wort erkannt:** Text geht unverändert in die bestehende
     Kette aus Baustein 1 (Ollama-Chat).

## Bekannter Sonderfall (bewusst akzeptiert)

Ein Satz, der zufällig ein Start-Wort enthält, aber keinen Programmbefehl
meint (z. B. "Wie starte ich am besten in den Tag?"), würde fälschlich als
"kenne ich nicht" behandelt statt normal beantwortet zu werden. Mit Kevin
besprochen und als seltener, hinnehmbarer Sonderfall akzeptiert — keine
weitere Absicherung dagegen in diesem Baustein.

## Fehlerbehandlung

- Programm nicht in der Liste → feste Ansage, kein Absturz.
- Start schlägt technisch fehl (Pfad existiert nicht mehr, Datei verschoben
  o. ä.) → feste Ansage ("Das hat nicht geklappt."), Programm bleibt am
  Leben und wartet weiter aufs Aufwachwort — folgt demselben Grundsatz wie
  der Rest der Sprachsteuerung: kein Fehler darf das Dauerprogramm stoppen.

## Testen

Der Programm-Parser (Text rein → Treffer/kein Treffer/unbekannt raus) ist
reine Textverarbeitung, automatisiert testbar ohne Hardware — wie die
übrige Kernlogik aus Baustein 1. Das tatsächliche Starten eines echten
Programms ist hardwarenah (echte Datei, echter Prozess) und wird wie bei
Baustein 1 per Handprüfung mit Kevin abgenommen.

## Offene Punkte für die Umsetzungsplanung

- Genaues Dateiformat der Programmliste (JSON-Struktur, Speicherort).
- Genaue Liste der erkannten Start-Wörter/Konjugationen.
- Wie eine URI (Steam-Spiele) vs. ein direkter Datei-Pfad unterschieden und
  jeweils gestartet wird.
- Genauer Wortlaut der festen Ansagen (Bestätigung, "kenne ich nicht",
  Fehlschlag).
