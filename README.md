# Ghostxx EventBot

Node.js Discord-Bot fuer die Familie Unknown: Event-Anmeldungen, staatliche
Meldungen, Logbuch-Auszahlungen, Server-Logging und ein lokaler Chatbot ueber
Ollama. Nichts davon verlaesst diesen Rechner.

Was er kann, im Ueberblick:

| Bereich | Wo es steht |
| --- | --- |
| Automatische Anmeldungen nach Terminplan | [Automatische Event-Schleife](#automatische-event-schleife) |
| Slash-Commands | [Commands](#commands) |
| Wer darf was | [Rechte](#rechte) |
| Chatten, verstehen, ausfuehren | [Chatbot](#chatbot) |
| Sachen beibringen, die er behaelt | [Wissen](#wissen) |
| Nachschlagen in alten Anmeldungen | [Nachschlagen](#nachschlagen) |
| Logbuch pruefen und auszahlen | [Auszahlung](#auszahlung) |
| Server- und Bot-Logs | [Logging](#logging) |
| Taegliche Sicherung | [Sicherungen](#sicherungen) |

## Start

1. Token in `.env` eintragen:

```env
DISCORD_TOKEN=dein-neuer-bot-token
```

Die vorhandene Datei `env` mit einem reinen Token wird ebenfalls unterstuetzt.

2. Commands registrieren und Bot starten:

```powershell
npm run deploy
npm start
```

`npm start` registriert die Slash-Commands automatisch und startet danach die Event-Schleife.

## Bot steuern

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\bot-status.ps1    # laeuft er?
powershell -ExecutionPolicy Bypass -File .\scripts\restart-bot.ps1   # neu starten
powershell -ExecutionPolicy Bypass -File .\scripts\stop-bot.ps1      # anhalten
```

Der Bot laeuft versteckt im Hintergrund, es gibt also kein Fenster zum Schliessen.
`stop-bot.ps1` beendet zuerst den Watchdog, sonst startet der den Bot sofort neu.
Aenderungen an `src/` greifen erst nach einem Neustart.

## Tests

```powershell
npm test
```

Faehrt alles in `tests/`. Einzelne Bereiche mit `npm test event-actions` oder
`npm test permissions`. Die Tests benutzen ein eigenes Datenverzeichnis und
fassen `data/events.json` nie an.

Der Modelltest wird uebersprungen, wenn Ollama nicht laeuft.

17 Testdateien, 492 Pruefungen. Abgedeckt sind vor allem die Stellen, an denen
schon einmal etwas kaputt war: der Platztausch bei voller Liste, die
Rechtematrix, die Karteileichen-Erkennung, die Buendelung der Logs, die
Aufnahmeregeln fuer Paesse, die Haken-Linie im Logbuch und die Frage, ob der
Nachschlage-Parser normales Gerede in Ruhe laesst.

## Windows-Autostart

Der Autostart nutzt eine Verknuepfung im Benutzer-Autostart. Sie startet `scripts/run-bot.ps1` versteckt beim Login. Logs landen in `logs/bot.log`.

Autostart erneut anlegen:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-autostart.ps1
```

## Automatische Event-Schleife

Der Bot prueft alle 30 Sekunden die Berlin-Zeit. Wenn ein Anmeldefenster beginnt, postet er die Anmeldung in `1503123644321366268`. Wenn das Fenster endet, schliesst er die Anmeldung und deaktiviert die Buttons.

- Normaler Event-Ping: `1511343501709676746`
- 40er-Ping: `1511358566248743042`
- 40er nutzt nur den 40er-Ping, nicht den normalen Event-Ping.

Aktuelle feste Events:

- `40er`: stuendlich, Start `:40`, Anmeldung `:30` bis `:45`
- `50er`: Start `20:50`, Anmeldung `20:25` bis `20:55`
- `Angriff auf das Gefaengnis`: freitags, Start `20:20`, Anmeldung `19:55` bis `20:25`
- `Bank-Event`: montags, mittwochs, samstags, Start `21:30`, Anmeldung `21:05` bis `21:35`
- `BizWar`: Start `01:05` und `19:05`, Anmeldung jeweils `00:40`/`18:40` bis `01:10`/`19:10`
- `Flugzeugtraeger`: dienstags, donnerstags, freitags, sonntags, Start `21:30`, Anmeldung `21:05` bis `21:35`
- `Giesserei`: Start `14:20`, Anmeldung `13:55` bis `14:25`
- `Hotel`: Start `02:20`, Anmeldung `01:55` bis `02:25`
- `RP-Fabrik`: Anmeldung `10:15`, `16:15`, `22:15`; Start jeweils `:30`; Inkzeit bis `:45`; Anmeldung schliesst beim Start
- `Waffenfabrik`: Start `03:20`, `07:20`, `10:20`, `22:20`, Anmeldung jeweils 25 Minuten vorher bis 5 Minuten danach
- `Waffenteile Event`: Start `20:30`, Anmeldung `20:05` bis `20:35`
- `Weinberge`: Start `20:15`, Anmeldung `19:50` bis `20:20`

## Commands

Anmeldungen:

- `/event erstellen` postet eine Event-Anmeldung in `1503123644321366268`.
- `/event liste` zeigt offene/geplante Events.
- `/event teilnehmer` zeigt die Teilnehmer eines Events.
- `/event schliessen` schliesst die Anmeldung.
- `/event absagen` sagt ein Event ab.
- `/eintragen` und `/austragen` setzen jemanden in eine Liste oder nehmen ihn raus.
- `/bearbeiten` aendert eine bereits gepostete Anmeldung nachtraeglich.
- `/angriff` und `/verteidigung` nur in `1478179319980363847`.

Auswertung:

- `/top` Rangliste der fleissigsten Anmelder, mit Blaetterknoepfen. Darf jeder.
- `/auszahlen` prueft einen Logbuch-Thread und rechnet ab.
- `/sammelauszahlung` macht dasselbe fuer alle Threads auf einmal.

Schreiben und aufraeumen:

- `/say` und `/embed` schreiben im Namen des Bots.
- `/verlosung` startet eine Verlosung mit Auslosung.
- `/purge` loescht bis zu 100 Nachrichten. Nicht rueckgaengig zu machen.

Rechte:

- `/admin hinzufuegen|entfernen|liste` verwaltet Admins. Nur Owner und Co-Owner.
- `/editor hinzufuegen|entfernen|liste` verwaltet Editoren.

## Rechte

Vier Stufen, von oben nach unten:

| Stufe | Wird gesetzt | Darf |
| --- | --- | --- |
| Owner, Co-Owner | in der `.env`, nicht aenderbar | alles, inklusive `/purge` und `/admin` |
| Admin | per `/admin` | alles ausser `/purge` und `/admin` |
| Editor | per `/editor` | normale Commands, dazu `/say` und `/embed` |
| Befehlsrollen | Discord-Rollen | Anmeldungen verwalten |

`/purge` und `/admin` bleiben bewusst ganz oben: das eine loescht unwiderruflich,
das andere vergibt Rechte. `/top` darf jeder.

Dieselbe Pruefung gilt fuer Slash-Commands und fuer Anweisungen im Chat — vorher
waren das zwei getrennte Regeln, und dieselbe Person durfte im Chat tauschen,
kam aber an `/eintragen` nicht ran.

Manuell erstellte Events pingen standardmaessig die Rolle `1511343501709676746`. Beim Erstellen kann `ping:false` gesetzt werden.

Staatliche Meldungen haben eigene Buttons:

- Teilnehmer: `0/10`
- Auswechselspieler: `0/3`
- Button `Anmelden` traegt nur normale Teilnehmer ein.
- Button `Auswechselspieler` traegt nur Auswechselspieler ein.
- Button `Abmelden` entfernt den Nutzer aus der Liste, in der er steht.
- Wenn ein normaler Teilnehmer sich abmeldet, rutscht kein Auswechselspieler automatisch nach.
- `details` ist frei formulierbar.
- Inkzeit wird automatisch als 30 Minuten nach der angegebenen Startzeit berechnet.
- Interne IDs werden im Embed nicht angezeigt.

## Chatbot

Der Bot antwortet auf `Ghost?`, auf `@Ghostxx` und in DMs. Alles laeuft ueber ein
lokales Ollama, nichts geht ins Netz.

Er versteht nicht nur, er handelt auch: *"Tausche im 40er @GhostMuffiin gegen
@Pascal"* fuehrt er aus. Der Weg dahin ist bewusst zweistufig:

1. **Erst ein Parser ohne Modell.** Klar formulierte Anweisungen erkennt er in
   unter einer Millisekunde — auch ohne @Erwaehnungen ("tausche Ghost und
   johannes"). Das funktioniert auch, wenn die Grafikkarte von GTA belegt ist.
2. **Dann das Modell als Auffangnetz.** Es *fuehrt nie etwas aus*, es meldet nur
   eine Absicht. Die laeuft danach durch dieselbe Rechtepruefung und
   Namensaufloesung wie alles andere — und bekommt immer einen
   Bestaetigungsknopf. Ein Fehlgriff des Modells kann so nie still eine Liste
   veraendern.

Was der **Parser** erkannt hat, wird ohne Rueckfrage ausgefuehrt: an dieser
Stelle sind Person und Anmeldung bereits aufgeloest, und war etwas unklar, hat
er von sich aus zurueckgefragt. Stattdessen haengt an jeder Aenderung ein
**Rueckgaengig**-Knopf. Vorher zu fragen kostete jeden Tausch zwei Klicks, auch
den eindeutigsten; so kostet nur der Fehler einen.

Beim Zuruecknehmen eines Tauschs bleiben die Listenpositionen erhalten — der
Tausch ist positionstreu gebaut. Ein zurueckgenommener Austrag landet dagegen
hinten in der Liste, denn die Position ist beim Entfernen weg.

Das Modell wechselt selbst nach freiem Grafikspeicher: laeuft ein Spiel, nimmt
er das kleine Modell auf der GPU statt des grossen auf der CPU — das ist
schneller *und* sparsamer. Faellt Ollama ganz aus, laufen Events,
Slash-Commands und Logging normal weiter, nur das Chatten faellt aus.

## Wissen

Was man ihm beibringt, behaelt er (`data/knowledge.json`).

- Ueberall: `merk dir …`, `vergiss …`, `was weisst du ueber …`
- In seinem Zuhause `1535058479172157520` reicht es, es einfach zu **sagen** —
  jede Aussage von jemandem mit Rechten wird als Fakt uebernommen. Fragen,
  Begruessungen und Zurufe nicht, sonst stuende dort bald "hallo".

Beruehrt eine neue Aussage ein Thema, zu dem schon etwas gespeichert ist, fragt
er per Knopf nach: neu, alt oder beides behalten. Die Erkennung dafuer ist
bewusst **ohne** Sprachmodell gebaut — das Modell antwortete im Test
"NEIN WIDERSPRUCH KEITER", weder Format noch Inhalt stimmten. Jetzt wird nur
gemessen, ob es um dieselbe Sache geht; entscheiden tut ein Mensch.

Beibringen darf, wer Anmeldungen verwalten darf. Fragen darf jeder.

## Nachschlagen

Fragen zu vergangenen Anmeldungen beantwortet er direkt aus den Daten — ueber
alles Aktive **und** das Archiv:

- "wie oft war ich diesen Monat dabei?"
- "wie oft war @Pascal im 40er dabei?"
- "wann war ich zuletzt dabei?"
- "wer war diesen Monat am haeufigsten dabei?"
- "welche Events gab es letzten Monat?"

Zeitraeume: diese Woche, diesen Monat, letzten Monat, dieses Jahr, insgesamt.
"Diesen Monat" heisst Kalendermonat ab dem Ersten, nicht die letzten 30 Tage.

Auch das laeuft ohne Sprachmodell. Eine Zahl aus zweitausend Anmeldungen braucht
keine Formulierungshilfe — und kommt so auch an, wenn die Grafikkarte voll ist.

## Auszahlung

Im Logbuch-Forum `1431712636227031130` prueft er Nachweise und rechnet ab.

- `/auszahlen` in einem Thread, `/sammelauszahlung` fuer alle Threads.
- Er liest die Screenshots **und** vergleicht sie mit dem Text: `Event | Lose | Win`.
- Ausgewertet wird ab dem letzten :delaTeabesttigt: — der Haken ist eine
  **Linie**, nicht eine Markierung pro Bild. Alles darueber gilt als erledigt.
- Erkennt er auf einem Bild nichts, wird der Eintrag trotzdem gezaehlt und als
  unklar markiert. Lieber einmal zu viel gezahlt als jemanden falsch beschuldigt —
  in einem frueheren Durchlauf traf das vier Leute zu Unrecht.
- "Ueberfall auf die Militaerbasis" wird ignoriert, das ist ein Anzeigefehler
  im Spiel.

## Logging

Zwei getrennte Kanaele, damit technische Meldungen nicht zwischen der
Serveraktivitaet untergehen:

- **Server-Log** `1535269549417693214`: beitreten, verlassen, Rollen, Kick, Bann,
  Stumm, Sprachkanaele, Nachricht bearbeitet oder geloescht (mit Vorher/Nachher),
  Kanaele angelegt und geaendert.
- **Bot-Log** `1535377104877649980`: Start, Fehler, Ollama weg oder wieder da,
  Rechteaenderungen, Sicherungen.

Eigene geloeschte Nachrichten erzeugen keinen Audit-Eintrag bei Discord — die
kommen ueber das Gateway-Ereignis rein.

## Speicher

Alles liegt lokal in `data/`:

| Datei | Inhalt |
| --- | --- |
| `events.json` | offene und geplante Anmeldungen |
| `archive/` | abgeschlossene Anmeldungen, nach Monat |
| `knowledge.json` | was man ihm beigebracht hat |
| `permissions.json` | Admins und Editoren |
| `giveaways.json` | Verlosungen und Gewinner |
| `chat-memory.json` | kurzer Gespraechsverlauf |

Geschrieben wird immer ueber `atomic-write`: erst daneben schreiben, dann
umbenennen, unter Windows mit Wiederholung bei `EPERM`. Ohne das bleibt bei
einem blockierten Zugriff eine halbe `.tmp` liegen und die Aenderung geht
verloren — genau das ist beim Archivieren einmal passiert.

## Sicherungen

Einmal taeglich kopiert er `data/` nach `backups/JJJJ-MM-TT/` und haelt die
letzten **14 Tage** vor. Geprueft wird alle sechs Stunden; der Tagesordner
verhindert doppelte Kopien.

Zurueckholen geht per Hand — deshalb wird bewusst nicht gepackt:

```powershell
Copy-Item .\backups\2026-08-09\* .\data\ -Recurse -Force
```

Der Grund: Verlosungsgewinner, Rechte und beigebrachtes Wissen sind nirgends
sonst ableitbar. Das Eventarchiv auch nicht.
