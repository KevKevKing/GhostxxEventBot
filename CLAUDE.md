# Ghostxx

Deutschsprachiger Discord-Bot für die GTA-Roleplay-Familie **Unknown** auf
GrandRP DE01. Verwaltet Event-Anmeldungen, staatliche Meldungen (SK), das
Logbuch mit Bildnachweisen, Auszahlungen und Verlosungen — und redet nebenbei
im Chat.

Läuft dauerhaft auf Kevins Windows-Rechner. Ein Fehler hier trifft keine
Testumgebung, sondern 251 echte Leute und ihre Auszahlungen.

## Sprache

**Alles auf Deutsch**: Antworten an den Benutzer, Code-Kommentare, Commit-Texte,
Testbeschreibungen, Variablennamen in neuen Modulen. Ältere Module mischen noch
Englisch — beim Anfassen nicht flächendeckend umbenennen, nur Neues auf Deutsch.

Umlaute: in **Texten für Discord** ja (`für`, `größer`), in **Code-Kommentaren**
umschrieben (`fuer`, `groesser`). So steht es überall, bitte beibehalten.

## Betrieb

```bash
npm test                    # 29 Testdateien, eigener Läufer ohne Framework
.\scripts\restart-bot.ps1   # Codeänderungen greifen erst nach Neustart
.\scripts\bot-status.ps1    # läuft er? letzte Logzeilen
.\scripts\stop-bot.ps1
```

Gestartet wird über einen Autostart-Watchdog (`scripts/run-bot.ps1`), der bei
Absturz mit steigender Wartezeit neu startet. **Nie** `node src/index.js` von
Hand starten — dann laufen zwei Instanzen und reagieren beide auf jede
Nachricht.

Nach jeder Änderung: erst `npm test`, dann Neustart, dann Ergebnis prüfen.

## Aufbau

63 Module in `src/`, ein Thema pro Datei, kein Framework.

- `index.js` — Start, Ereignisse anmelden
- `handlers.js` — Slash-Commands
- `message-handler.js` — freie Nachrichten; die Reihenfolge der Wege dort ist
  bedeutsam, siehe unten
- `storage.js` / `data/events.json` — Anmeldungen; `archiver.js` räumt auf
- `logbook*.js` — Nachweise, Bilderkennung, Sammelauszahlung
- `ollama.js` — lokales Sprachmodell

`data/` wird täglich nach `backups/JJJJ-MM-TT/` gesichert, 14 Tage Aufbewahrung.

## Die drei Zeichen im Logbuch

Jedes hat **genau eine** Bedeutung — das war nicht immer so, und die Vermischung
hat Geld gekostet:

| Zeichen | Bedeutung |
|---|---|
| `:GTALoading:` | die Linie: bis hierher ist alles angesehen |
| `:delaTeabesttigt:` | gezählt und bezahlt — reine Auskunft, **keine** Linie |
| `:0acrylic_moneybag:` | von Hand als ausgezahlt markiert — zählt wie ein Haken |
| `:AttentionAnimated:` | offenes Problem — **sticht die Linie**, kommt immer wieder |
| `:delaTeaabgelehnt:` | von Hand abgelehnt, zählt nie |

**Gezählt wird genau das, was auch abgehakt wird** — eine Regel, `istGewertet()`
in `logbook.js`. Vorher waren es zwei, und sie widersprachen sich: die Tabelle
nahm alles außer dem Widerlegten, der Haken nur das Bestätigte. Ein
ungeprüfter Nachweis stand damit in der Auszahlung, bekam aber kein Häkchen —
und zählte beim nächsten Lauf **ein zweites Mal**.

Beim `verified`-Feld sind vier Zustände zu unterscheiden, und der Unterschied
zwischen den ersten beiden ist der ganze Punkt:

- `undefined` — gar nicht geprüft (`bilder_pruefen:false`), dann gilt der Text
- `null` — geprüft, aber kein Urteil: unlesbar, zwei Events im Bild, oder
  „noch nicht gelesen". **Kein Ja.**
- `true` / `false` — bestätigt bzw. widerlegt

Vorher zog der **Haken** die Linie und hatte damit zwei Bedeutungen
gleichzeitig. Folge: Lag ein Problem-Beitrag oberhalb eines späteren Hakens,
war er für immer weg — gemessen **39 Nachweise in 16 Tickets**, alle mit
echtem Text und Bild.

Zwei Regeln, die nicht aufgeweicht werden dürfen:

- **Der Marker rückt erst NACH dem Verarbeiten weiter.** Stürzt der Bot
  mittendrin ab (ist am 16.08. passiert), steht er noch auf dem letzten
  fertigen Beitrag. Einer wird doppelt angesehen statt einer verloren.
- **Ein Achtungszeichen ist erst erledigt**, wenn ein Haken oder eine
  Ablehnung dazukommt. Nicht dadurch, dass die Linie darüber hinweggeht.

Tickets von vor der Umstellung haben noch keinen Marker — dort gilt
übergangsweise das letzte Häkchen, sonst würde jedes Ticket komplett neu
aufgerollt.

## Dashboard

`http://localhost:8787`, startet mit dem Bot. **Nur 127.0.0.1** — in den Daten
stehen Namen und Spielernummern, und der Token liegt daneben.

Zeigt: offene Anmeldungen (geplant / selbst erstellt / staatlich), Logbuch-Stand,
laufende Sammelauszahlung, was er in Discord tut, Terminal, Grafikkarte, Fehler,
Warnungen. Ghostxx als leuchtender Kern in der Mitte — dreht grün und schnell,
solange wirklich eine Ollama-Anfrage läuft.

Zwei schreibende Wege, beide bewusst eng gefasst: `POST /api/antwort` legt eine
Antwort auf eine seiner Fragen ins Gedächtnis, `POST /api/bilder-pause` schaltet
nur das Bildlesen an oder aus (Chat und Events laufen unabhängig davon weiter).
Sonst liest das Dashboard nur.

Die Höhen stehen in `vh`, damit auf 1920×1080 alles auf eine Seite passt.

## Was er von sich aus tut

Alles gedeckelt — ein Bot, der zu viel redet, wird stummgeschaltet, und dann ist
auch das Nützliche weg.

| Wann | Modul | Bremse |
|---|---|---|
| Anmeldung fast voll, schließt gleich | `event-erinnerung.js` | ~3×/Tag |
| Meilenstein (10., 25., dann jede 50.) | `meilenstein.js` | 3/Tag, Rest abends |
| Ausblick 10:30, Rückblick 23:15 | `tagesrhythmus.js` | fest |
| Anmeldung war schnell voll | `voll-kommentar.js` | 3/Tag, nur unter 5 Min |
| Bild im Chat | `bild-kommentar.js` | alle 10 Min, 8/Tag, nie bei voller GPU |
| 25 Min vor selbst erstelltem Event | `termin-erinnerung.js` | einmal je Event |

Nachts (2–10 Uhr) sagt er nichts.

## Der wichtigste Grundsatz: erst ablesen, dann raten

**Vor dem Sprachmodell steht immer ein fester Parser.** Was sich eindeutig aus
dem Satz ablesen lässt, wird abgelesen — `intent-parser.js`, `stats-parser.js`,
`sk-meldung.js`, `terminplan-wissen.js`. Das Modell ist nur das Auffangnetz.

Zwei Gründe: die Grafikkarte teilt sich mit GTA und ist manchmal voll, und an
einer Anmeldung hängen zehn Leute. Eine Zahl aus zweitausend Anmeldungen braucht
keine Formulierungshilfe.

Neue Fähigkeiten deshalb zuerst als Parser bauen, nicht als Prompt.

## Der zweite Grundsatz: messen, nicht vermuten

Dieses Projekt hat sich mehrfach an Vermutungen verbrannt. Beispiele, die als
Kommentar im Code stehen und dort bleiben sollen:

- Eine „verbesserte" Bildanweisung senkte die Trefferquote von 72 % auf 20 %
- Die Wiederholungsbremse fürs Bildlesen abzuschalten klang richtig, war aber
  genau falsch herum
- Eine Längengrenze für die Antwort schnitt mitten ins Denken des Modells
- Der Zuschnitt als **erster** Anlauf war schlechter als als zweiter

Bei allem rund um Modelle, Bilder oder Erkennungsraten: gegen eine **feste**
Stichprobe messen, vorher und nachher. Eine bei jedem Lauf neu gezogene
Stichprobe macht zwei Zahlen unvergleichbar.

## Feste Entscheidungen — nicht ohne Rückfrage ändern

- **Der Discord-Token steht im Klartext in `.env.example`.** Kevin will das so.
  Nicht entfernen, nicht zum Zurücksetzen raten.
- **Das Projekt ist bewusst kein Git-Repo.**
- Die nachts leeren 40er-Zeitfenster (05–10 Uhr) bleiben im Zeitplan.
- Auswechselspieler gibt es nur bei staatlichen Meldungen und selbst erstellten
  Anmeldungen — geplante Events haben bewusst keine.
- Die **Visum-Prüfung bleibt auf `qwen3.5:9b`**, obwohl das Bildmodell besser
  läse: dort wartet ein Mensch (15 s statt 47 s), und es gibt keine Wahrheit zum
  Messen. Im Logbuch gibt es die Häkchen, beim Visum nicht.
- **Das Bildlesen bleibt auf `qwen3-vl:8b`, auch bei voller Grafikkarte.**
  `qwen3-vl:4b` würde passen (3143 statt 5856 MB), aber am Bild hängt Geld: fürs
  8b sind 15/15 gemessen, fürs 4b gibt es keine vergleichbare Zahl. Lieber
  warten als still schlechter werden. Beim Chat ist der Wechsel aufs kleine
  Modell dagegen richtig — eine knappere Antwort kostet niemanden etwas.
- **Eventlogik, Zeitplaner und alles dahinter nicht anfassen**, wenn die Aufgabe
  woanders liegt.

## Modelle (Ollama, lokal)

| Zweck | Modell |
|---|---|
| Chat | `qwen3.5:9b`, bei voller Grafikkarte `qwen3.5:2b` |
| Bilder im Logbuch | `qwen3-vl:8b`, zweiter Anlauf mit Zuschnitt des oberen Rands |
| Visum | `qwen3.5:9b` (siehe oben) |

Ollama darf **nie blockieren**: fällt es aus, laufen Events, Commands und Logs
weiter, nur das Chatten fällt aus.

## Fallen, die schon zugeschnappt sind

- **Discord schreibt Kanalnamen klein** und macht aus jedem Leerzeichen einen
  Bindestrich. Deshalb stehen aufgeräumte Ticketnamen in mathematischen
  Fettbuchstaben (`ticket-namen.js`).
- **Wem ein Logbuch-Ticket gehört, steht in den Kanalrechten, nicht im Namen.**
  Der Ticketbot benennt beim Übernehmen um und schiebt den Übernehmer in den
  Namen — einmal trug Saschas Logbuch dadurch Ghosts Namen.
- **Umbenennen ist auf 2 Änderungen pro 10 Minuten und Kanal begrenzt.**
- Im Zuhause-Kanal (`botHomeChannelId`) gilt jede Aussage als Tatsache. Wer dort
  fälschlich landet, bekommt **gar keine Antwort** mehr — deshalb liegen in
  `handleAutoLearn` mehrere Netze übereinander.
- Die **Spielernummer** (`| 266391`) ist der einzige verlässliche Anker für eine
  Person. Anzeigenamen ändern sich ständig.

## Umgangston

Kevin fragt viel und baut wenig auf einmal. **Eine Frage ist kein Bauauftrag** —
erst antworten, umsetzen nur auf klare Ansage. Bei mehreren Fragen in einer
Nachricht: pro Frage ein eigener Abschnitt, nicht vermischen.

Fehler klar benennen, auch eigene. Nichts schönreden — an diesem Bot hängen
echte Auszahlungen.
