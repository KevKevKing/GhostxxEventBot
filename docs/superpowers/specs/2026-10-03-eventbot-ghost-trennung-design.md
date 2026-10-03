# Event-Bot von KI und Logbuch befreien — Design

## Zusammenfassung

`GhostxxEventBot` wird ein **reiner Event-Bot**: Slash-Commands, Anmeldungen,
Scheduler, SK, Erinnerungen. Alles, was KI, Ollama, freier Chat, Bilder,
Selbstverbesserung oder Logbuch/Auszahlung ist, wird **aus dem Code gelöscht**.
Es bleibt nichts davon im Event-Bot: kein Ollama, kein Modell-Aufruf, kein
Bild, kein Logbuch.

`C:\Users\kevin\Desktop\Ghost` wird **nicht jetzt** angelegt. Kevin baut Ghost
später in einer **neuen Claude-Sitzung** frisch auf. Dafür wird hier nichts
kopiert; die Übergabe läuft über den Git-Verlauf (siehe "Übergabe").

Kevins Vorgaben (3.10.2026, sinngemäß): "nichts mehr mit KI", "kein Bild
erkennen, kein Bild irgendwas, kein Chat mit anderen", "kein Logbuch, keine
Selbstverbesserung mehr, nur noch Event", "tausche X gegen Y bleibt, das geht
auch ohne Ollama", "der Bot kann dafür aus sein", "kann alles raus, wir
machen einen neuen Ordner in einer neuen Claude-Sitzung".

## Wichtig vorab: was danach nicht mehr läuft

Nach dem Umbau gibt es **nirgends** mehr: Ghost-Chat, Bildlesen,
Bildkommentare, Visum-Prüfung, Meilensteine und Tagestexte,
Selbstverbesserung, Code-Vorschläge, Rückfrage-DMs, und im Event-Bot kein
Logbuch und keine Sammelauszahlung, bis Ghost neu aufgebaut ist.

**Vor dem Umschalten** muss die letzte Sammelauszahlung gelaufen sein, denn
danach gibt es im Bot keine Auszahlungs-Auswertung mehr.

## Zielbild

### Bleibt im Event-Bot (44 von 89 Modulen in `src/`)

Slash-Commands `/event` (erstellen, liste, teilnehmer, schliessen, absagen),
`/eintragen`, `/austragen`, `/bearbeiten`, `/angriff`, `/verteidigung`,
`/verlosung`, `/top`, `/say`, `/embed`, `/purge`, `/editor`, `/admin` und das
Kontextmenü "Info". Anmeldungen und Buttons, Scheduler, Termin- und
Anmelde-Erinnerungen, SK (Meldungen und die Satz-Erkennung "wir haben
angegriffen um 21:07 gegen Nemesis"), die Text-Befehle "tausche X gegen Y /
trag mich ein / aus" (reiner Parser `intent-parser.js` plus `chat-router.js`,
**ohne** Modell-Auffangnetz), Verlosungen, Archivierer, Backup, Rechte,
Audit-Log, Server-Log, Beitritts-Statistik, Familien-Mitgliederliste, das
Dashboard (entschlackt, siehe unten) und `steuerung.js` (die Dashboard-
Schalter, die auch den Scheduler pausieren).

### Wird gelöscht (45 Module)

| Gruppe | Module |
|---|---|
| KI und Chat | `ollama`, `ollama-watch`, `model-intent`, `auto-learn`, `knowledge`, `memory`, `self-knowledge`, `server-wissen`, `teach-parser`, `ghostxx-fragen`, `frage-erinnerung`, `stats-parser`, `stats-answer`, `stats`, `terminplan-wissen`, `bot-settings` |
| Selbstverbesserung | `selbstverbesserung`, `-session`, `-limit`, `-gedaechtnis`, `-benachrichtigung`, `selbstbeobachtung`, `code-vorschlag` |
| Bilder | `bild-kommentar`, `bild-uhrzeit`, `bild-vorablesen`, `bild-gedaechtnis`, `bild-laden`, `bild-zuschnitt`, `visa` |
| Logbuch und Auszahlung | `logbook`, `logbook-batch`, `logbook-command`, `logbook-events`, `logbook-vision`, `logbuch-tickets`, `logbuch-zahlen`, `auszahlung-saetze`, `ticket-namen`, `ticket-aufraeumer`, `namens-gedaechtnis`, `lauf-stand` |
| Redet von selbst | `meilenstein`, `tagesrhythmus`, `voll-kommentar`, `praesenz` |

Dazu die Slash-Commands `/auszahlen`, `/sammelauszahlung`,
`/sammelauswertung` (verschwinden von selbst: `register-commands.js`
überschreibt die Server-Befehle beim Start komplett), der Ordner
`code-recherche/` und die Tests dieser Module.

Ermittelt per Abhängigkeitsanalyse der `require`-Verbindungen, nicht
geschätzt: Nach dem Entfernen bleiben genau die fünf Stellen unten als
Schnittstellen zu gelöschten Modulen übrig, sonst keine.

## Die fünf Chirurgie-Stellen

Alles andere lässt sich am Stück löschen. Hier muss Code umgebaut werden:

1. **`message-handler.js`** (17 Verbindungen zur KI-Seite): bleibt
   schlank. Bleiben: Kanalfilter, `detectIntent` → `runIntent`
   (Text-Befehle mit Rückgängig-Knopf), `behandleSkMeldung`. Fallen weg:
   freier Chat, Modell-Absicht, Visum, Bildkommentare, Nachschlagen,
   Terminfrage, Lernen/Merken, Rückfrage- und Code-Vorschlag-DMs,
   `shouldRedirectToChat`.
2. **`index.js`**: startet nur noch Event-Teile. Fallen weg: Ollama-Prüfung
   und -Wächter, Selbstverbesserung, Code-Vorschlag, Frage-Erinnerung,
   Bild-Vorablesen, Praesenz, Namens-Gedächtnis, Ticket-Aufräumer.
3. **`handlers.js`**: die Handler für die drei Logbuch-Commands fallen weg
   (`commands.js` verliert die Definitionen).
4. **`termin-erinnerung.js`**: startet nur noch die Termin-Erinnerung, ohne
   den Voll-Kommentar.
5. **Dashboard** (`dashboard.js`, `dashboard-daten.js`,
   `dashboard-seite.js`, `tests/dashboard.test.js`): größter Umfang, aber
   rein Entfernen von Kacheln und Datenquellen.

**Dashboard nachher:** bleibt, zeigt Offene Anmeldungen (mit dem
Absagen-Knopf), Steuerzentrale (Schalter), Aktivität, Letzte Fehler,
Rechner-Werte, Statusleiste mit Neustart/Ausschalten. Es entfallen:
Logbuch- und Sammelauszahlungs-Kachel, Selbstverbesserungs-Kachel,
GhostxxCode-Chat, Bilder-Pause, Ollama-Anzeige. Der Reaktor in der Mitte
bleibt als reine Optik ohne KI-Bezug.

`steuerung.js` verliert die Schalter `chat`, `visaBilder`, `chatBilder`,
`logbuchSortieren`, `selbstverbesserung`.

## Übergabe an die neue Ghost-Sitzung

- **Git-Tag `vor-trennung-2026-10-03`** auf dem letzten Stand vor dem Umbau:
  der komplette Code von Ghost, Logbuch, Selbstverbesserung, Bildlesen und
  dem alten `CLAUDE.md` bleibt dort jederzeit les- und wiederherstellbar
  (`git show vor-trennung-2026-10-03:src/ollama.js` usw.).
- **Übergabe-Notiz `docs/ghost-uebergabe.md`** (kurz): der Tag-Name, die Liste
  der gelöschten Module, wo die Daten liegen, und die KI-Erkenntnisse aus dem
  alten `CLAUDE.md` (Modell-Tabelle, "erst ablesen, dann raten", die
  gemessenen Fehlschläge), damit eine neue Sitzung nicht bei null anfängt.
- **`data/` und `Gedächtnis/` werden nicht angefasst.** Alle KI- und
  Logbuch-Dateien bleiben liegen und werden nur nicht mehr gelesen
  (Echtdaten, nicht in Git, das tägliche Backup läuft weiter). Gelöscht wird
  nur **Code**.
- **`.env` bleibt unangetastet.** Ollama-, Tavily- und Claude-Zugangsdaten
  gehören später in die `.env` von Ghost; das macht Kevin von Hand.

## Ablauf

Entwickelt wird in einem eigenen Worktree und Branch, der laufende Bot bleibt
bis zum Umschalten unberührt. Kleine, einzeln prüfbare Commits:

1. Tag setzen, Übergabe-Notiz schreiben.
2. Selbstverbesserung, KI, Chat und Bilder löschen (`message-handler.js`,
   `index.js`, `steuerung.js`, Module, Tests).
3. Logbuch und Auszahlung löschen (`handlers.js`, `commands.js`, Module, Tests).
4. Dashboard entschlacken.
5. `CLAUDE.md` und `README.md` des Event-Bots auf den neuen Stand bringen
   (Modelle, Ollama, Logbuch-Abschnitte raus).

Dann **eine** Ganz-Branch-Review, `npm test`, CI, Merge. **Umschalten:**
letzte Sammelauszahlung, Bot stoppen (Kevin hat das ausdrücklich erlaubt),
`main` ziehen, Bot starten.

## Nach dem Umschalten: Live-Prüfliste

Für `message-handler.js` und `index.js` gibt es keine automatischen Tests (an
Discord gekoppelt), deshalb prüft Kevin nach dem Start von Hand, was an
echten Anmeldungen hängt: `/event erstellen`, Anmelden per Button,
`/eintragen`, `/austragen`, "tausche A gegen B" im Text mit Rückgängig-Knopf,
`/angriff` und eine SK-Meldung als Satz, `/verlosung`, `/top`, das Dashboard
und der Absagen-Knopf. Zusätzlich: die drei Logbuch-Commands sind in Discord
verschwunden, im Log steht kein Ollama-Eintrag mehr.

## Nicht-Ziele

- Den Ordner `Ghost` jetzt anlegen oder befüllen: macht Kevin später in einer
  neuen Claude-Sitzung.
- Neue Fähigkeiten für den Event-Bot.
- `config.js` aufräumen: die nicht mehr genutzten Ollama- und
  Logbuch-Einstellungen bleiben vorerst stehen, sie schaden nicht.
- Automatische Tests für `message-handler.js` und `index.js` neu schreiben
  (es gab nie welche; die Prüfliste oben ersetzt das).
- Daten verschieben oder löschen.
- Alte Specs und Pläne unter `docs/superpowers/` löschen: sie bleiben als
  Geschichte liegen.

## Annahmen, bitte beim Lesen prüfen

1. **Verlosungen** (`/verlosung`) bleiben im Event-Bot.
2. Die **Familien-Mitgliederliste** (`familien-liste.js`, liest die Rangrollen
   aus Discord) bleibt im Event-Bot.
3. Das **Dashboard bleibt** im Event-Bot, entschlackt, und der Reaktor bleibt
   als Optik.
4. Das **Logbuch wird gelöscht** und ist danach nur noch im Git-Tag zu finden,
   die Daten bleiben liegen.
5. Die Satz-Erkennung für **SK-Meldungen im Chat** bleibt, weil SK ausdrücklich
   zum Event-Bot gehört.
6. Der "redet von selbst"-Block (Meilensteine, Morgen-/Abendtext,
   Voll-Kommentar, Präsenz) wird gelöscht, weil das "Reden" ist, obwohl er
   keine KI benutzt.
