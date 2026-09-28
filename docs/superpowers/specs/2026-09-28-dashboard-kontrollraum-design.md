# Dashboard-Neugestaltung: "Ghost Kontrollraum"

## Zusammenfassung

Das Dashboard (`src/dashboard*.js`) bekommt einen komplett neuen Look nach
einer Vorlage, die Kevin sich von einem anderen Chatbot generieren liess
(`ghost-dashboard.html`, per Prompt + Referenz-Screenshot des heutigen
Dashboards erzeugt, keine Vorlage aus dem Internet). Zusaetzlich bekommt das
Dashboard einen echten, neuen Chat mit Ghostxx.

**Was sich NICHT aendert:** Modelle, Schalter, Datenquellen, Sicherheitsmodell
(nur 127.0.0.1, nur lesend bis auf die inzwischen zwei schreibenden Wege).
**Was sich aendert:** Optik komplett, Layout komplett, ein neuer dritter
schreibender Weg (Chat).

## Ziel

- Die visuelle Sprache der Vorlage uebernehmen: dunkles "Kontrollraum"-Design,
  Schriften Unbounded/Geist, Panels mit technischen Eckmarkierungen,
  Sparkline-Telemetrie, der drehende/pulsierende GHOST-Reaktor als
  Canvas-Animation (Zustand: schneller + wechselt Farbe, wenn wirklich eine
  Ollama-Anfrage laeuft - wie beim heutigen Kern, nur neu gezeichnet).
- Alle heutigen echten Inhalte bleiben erhalten, werden aber neu einsortiert
  (die Vorlage hat nur Platz fuer wenige erfundene Beispielwerte, das echte
  Dashboard zeigt deutlich mehr).
- Chat wandert in die Mitte (Kevins ausdruecklicher Wunsch, weicht von der
  Vorlage ab, die ihn rechts zeigt).
- Ein neuer, echter Chat mit Ghostxx direkt aus dem Dashboard - ueber
  dasselbe lokale Ollama-Modell wie der Discord-Chat.

## Nicht-Ziele (bewusst ausgeklammert, siehe Brainstorming-Verlauf)

- **Kein externer KI-Anbieter.** Die Vorlage zeigt einen Umschalter zwischen
  "Claude" und "GPT" - das war Beiwerk des generierenden Chatbots, keine
  Anforderung. Es bleibt bei genau einem, lokalen Modell (`ollama.js`,
  dieselbe GPU-Auslastungs-Logik wie ueberall im Projekt).
- **Kein "Ghost Code"-Panel mit freiem Prompt fuer einen Coding-Agenten.**
  Die Vorlage zeigt ein Feld, in das man eine beliebige Programmieraufgabe
  eintippt und ein Agent aendert darufhin Dateien. Das waere eine
  Faehigkeit, die selbst das ohnehin schon vorsichtig gebaute
  Selbstverbesserungssystem (`src/selbstverbesserung*.js`, nur automatisch
  bei ERKANNTEN Fehlern, strikte Tabu-Pfade, siehe
  `docs/superpowers/specs/2026-09-17-ghostxx-selbstverbesserung-design.md`)
  bei weitem uebersteigt - ein Freitext-Coding-Agent direkt aus dem
  Dashboard ist eine eigene, spaetere Entscheidung, kein Teil dieser Spec.
- **Keine neuen Modul-Schalter.** Die Vorlage erfindet Schalter, die es
  heute nicht gibt (z.B. "Sprachkanaele", "Audit-Log" als Schalter). Gezeigt
  werden nur die echten, bestehenden Schalter aus `steuerung.js`.
- **Keine Aenderung an Events, Zeitplaner, Auszahlungslogik.** Reines
  Frontend/Anzeige- und ein neues, eng gefasstes Chat-Backend.

## Voraussetzung: baut auf zwei anderen, noch nicht gemergten Branches auf

Zwei parallele Aenderungen sind Teil des Ziel-Zustands, den diese Spec
annimmt (Stand 2026-09-28, jeweils lokal committet, noch nicht in `main`):

- `worktree-ghostxx-fragen-dm`: entfernt die "Er fragt"-Kachel und
  `/api/antwort`, der Bildlesen-Pause-Knopf zieht in die obere Leiste.
- Die "Bilder — was er gelesen hat"-Kachel ist in derselben Branch bereits
  entfernt.

Diese Spec geht davon aus, dass beide Aenderungen vor der Umsetzung dieser
Spec in `main` gelandet sind. Ist das zum Zeitpunkt der Umsetzung noch nicht
der Fall, muss der Implementierungsplan das nachbilden (keine neue
"Er fragt"-Kachel im neuen Layout vorsehen).

## Architektur

Reines Frontend-Redesign (`dashboard-seite.js` komplett neu, `CSS`+`JS` aus
der Vorlage als Ausgangspunkt) plus ein neues, kleines Backend-Stueck fuer
den Chat. `dashboard-daten.js`s `stand()`-Funktion bleibt inhaltlich fast
unveraendert - sie liefert weiterhin dieselben Felder (anmeldungen, logbuch,
fehler, warnungen, system, selbstverbesserung, ...), nur die Darstellung
aendert sich. Der GHOST-Reaktor bekommt weiterhin sein Signal aus
`rechnetGerade()` (bereits vorhanden, zeigt ob gerade eine Ollama-Anfrage
laeuft).

### Layout

- **Links:** Modul-Schalter (echte Schalter aus `steuerung.js`, gruppiert
  wie heute in `SCHALTER_GRUPPEN`) + System-Telemetrie (CPU/RAM/GPU/VRAM/
  Discord-Ping, als Sparkline-Graphen im Stil der Vorlage - Datenquelle
  bleibt `system-werte.js`).
- **Mitte:** GHOST-Reaktor oben (Canvas-Animation aus der Vorlage,
  angeschlossen an `rechnetGerade()` statt an Zufallswerte) + darunter der
  neue Chat (siehe unten).
- **Rechts:** Anmeldungen, Logbuch-Stand, Aktivitaet, Fehler, Warnungen,
  Selbstverbesserung-Uebersicht - als Karten im neuen Stil, untereinander.
  Laenger als in der Vorlage, weil mehr echte Inhalte reinmuessen.
- **Unten:** Statusleiste (CPU/RAM/GPU/Discord-Ping, Terminal-/Neustart-/
  Ausschalten-/Bildlesen-Pause-Knopf) - inhaltlich wie heute, neu gestylt.

## Der neue Chat

### Backend: `POST /api/chat`

Dritter schreibender Weg im Dashboard, bewusst eng gefasst wie die anderen
zwei (`/api/bilder-pause`, `/api/schalter`): nimmt **nur** `{ text }` entgegen,
liefert **nur** `{ antwort }` oder `{ ok:false, grund }` zurueck. Kein
Datei-Upload, keine Werkzeuge, keine Aktionen.

- Nutzt denselben `chat()` aus `ollama.js` wie der Discord-Chat - dieselbe
  GPU-Warteschlange, dieselbe Modellwahl bei voller Grafikkarte
  (`qwen3.5:9b` / `qwen3.5:2b`). Kein zweites, konkurrierendes Modell.
- **Bewusst OHNE** `chat-router.js`/`detectIntent`/Werkzeugaufrufe: der
  Dashboard-Chat ist reines Gespraech, keine Event-Verwaltung. Wer Events
  aendern will, tut das in Discord (dort gibt es Bestaetigungs-Buttons und
  Rechtepruefung - beides fehlt dem Dashboard-Chat bewusst). Stattdessen
  derselbe `SYSTEM_PROMPT`-Stil wie in `message-handler.js`, aber ohne
  Werkzeuge (`askModel({ withTools: false, ... })` oder direkter
  `chat()`-Aufruf mit demselben Prompt-Muster - waehrend der Umsetzung zu
  entscheiden, je nachdem was sich sauberer wiederverwenden laesst).
- Eigener Gespraechsverlauf ueber `memory.js` mit einem neuen, festen
  `historyKey` (z.B. `'dashboard'`) - getrennt vom Discord-Verlauf, damit
  sich beide Kontexte nicht vermischen.
- **Anti-Spam-Bremse:** mindestens 3 Sekunden zwischen zwei Anfragen (server-
  seitig durchgesetzt, nicht nur im Frontend deaktiviert) - schuetzt vor
  versehentlichem Mehrfach-Absenden, kein Limit fuer normales Hin-und-Her.
  Bei Verstoss: `{ ok:false, grund:'zu_schnell' }`, kein Fehler, keine GPU-
  Anfrage ausgeloest.
- Wie jeder Endpunkt hier: darf nie den Server-Prozess crashen. Ollama nicht
  erreichbar -> `{ ok:false, grund:'ollama_nicht_erreichbar' }`, Chat und
  Events im echten Bot bleiben unberuehrt (Grundsatz: Ollama blockiert nie).

### Frontend

Textfeld + Senden-Knopf unter dem Reaktor, Verlauf der aktuellen
Dashboard-Sitzung im Browser (kein Persistieren im Frontend noetig, der
Verlauf liegt serverseitig in `memory.js` und wird bei Seiten-Neuladen aus
`GET /api/chat-verlauf` — oder direkt beim naechsten `/api/stand` — erneut
geholt; Detail fuer die Umsetzung). Kein Streaming noetig (bestehendes
Discord-Chat-Verhalten ist auch nicht gestreamt) - Warten-Anzeige waehrend
der Reaktor "denkt".

## Fehlerbehandlung

- Ollama nicht erreichbar: Chat zeigt eine Fehlermeldung im Chat-Fenster,
  Rest des Dashboards liest weiter normal (unveraendert von heute).
- `/api/chat` mit leerem oder zu langem Text (Obergrenze wie im Discord-Chat
  ueblich, z.B. 2000 Zeichen): `{ ok:false, grund:'ungueltig' }`, kein
  Ollama-Aufruf.
- Ein Fehler beim Zeichnen des neuen Layouts (z.B. Canvas nicht verfuegbar)
  darf die uebrigen Karten nicht mitreissen - wie heute schon ueberall im
  Dashboard durch einzelne try/catch pro Abschnitt abgesichert.

## Testplan

- `tests/dashboard.test.js`: bestehende Pruefungen auf `stand()` bleiben
  gueltig (Datenseite aendert sich inhaltlich nicht). Neue Pruefungen fuer
  die HTML-Struktur (neue IDs statt der alten, Chat-Bereich vorhanden).
- Neue Testdatei fuer das Chat-Backend (z.B. `tests/dashboard-chat.test.js`):
  Anti-Spam-Bremse (zwei Anfragen schnell hintereinander -> zweite abgelehnt),
  leerer Text abgelehnt, Ollama-Fehler wird sauber durchgereicht statt zu
  werfen, eigener `historyKey` wird verwendet (nicht der Discord-Verlauf).
- Manuelle Pruefung nach der Umsetzung (kann nicht automatisiert werden):
  Dashboard im Browser oeffnen, optischer Abgleich mit der Vorlage, echten
  Chat-Austausch fuehren, pruefen dass Discord-Chat und Dashboard-Chat
  getrennte Verlaeufe haben.

## Self-Review

- **Platzhalter-Scan:** keine TBD/TODO offen; die einzige bewusst offene
  Detailfrage (askModel ohne Werkzeuge vs. direkter chat()-Aufruf) ist als
  Umsetzungsentscheidung markiert, nicht als Luecke.
- **Konsistenz:** Nicht-Ziele (kein externer Anbieter, kein Freitext-Agent,
  keine neuen Schalter) stehen im Einklang mit dem Brainstorming-Verlauf und
  wiederholen sich nicht widerspruechlich im Architektur-Abschnitt.
- **Abhaengigkeit klar benannt:** die Annahme, dass die fragen-dm-Branch
  vorher gemergt ist, steht explizit mit Ausweichverhalten, falls nicht.
- **Umfang:** passend fuer einen einzelnen Umsetzungsplan - reines Frontend
  plus ein einzelner neuer, eng gefasster Endpunkt.
