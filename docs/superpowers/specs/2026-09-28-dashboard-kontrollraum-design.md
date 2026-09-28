# Dashboard-Neugestaltung: "Ghost Kontrollraum"

## Zusammenfassung

Das Dashboard (`src/dashboard*.js`) bekommt einen komplett neuen Look nach
einer Vorlage, die Kevin sich von einem anderen Chatbot generieren liess
(`ghost-dashboard.html`, per Prompt + Referenz-Screenshot des heutigen
Dashboards erzeugt, keine Vorlage aus dem Internet).

**Korrektur gegenueber der ersten Fassung dieser Spec:** Darin stand
faelschlich, das Dashboard bekaeme einen "neuen, dritten schreibenden Weg"
fuer einen Chat. Das war ein Rechercheversuch, der eine bereits bestehende
Kachel uebersehen hat: **"GhostxxCode — Coding-Helfer"** existiert bereits
(`POST /api/chat` in `dashboard.js`, eigenes Modell `qwen2.5-coder:7b`, siehe
Code-Kommentar dort "seit dem 16.09."), sitzt aktuell links neben
"Steuerzentrale". Nach Ruecksprache mit Kevin: **keine neue Chat-Funktion,
nur diese bestehende Kachel umziehen** - siehe "Coding-Helfer umziehen"
unten. Dieser Abschnitt ersetzt den fruehereren "Der neue Chat"-Abschnitt
vollstaendig.

**Was sich NICHT aendert:** Modelle, Schalter, Datenquellen, Sicherheitsmodell
(nur 127.0.0.1), die schreibenden Wege (`/api/bilder-pause`, `/api/schalter`,
`/api/chat` - alle drei bereits vorhanden, keiner davon neu).
**Was sich aendert:** Optik komplett, Layout komplett - reine Anzeige- und
Anordnungs-Aenderung, kein neues Backend-Verhalten.

## Ziel

- Die visuelle Sprache der Vorlage uebernehmen: dunkles "Kontrollraum"-Design,
  Schriften Unbounded/Geist, Panels mit technischen Eckmarkierungen,
  Sparkline-Telemetrie, der drehende/pulsierende GHOST-Reaktor als
  Canvas-Animation (Zustand: schneller + wechselt Farbe, wenn wirklich eine
  Ollama-Anfrage laeuft - wie beim heutigen Kern, nur neu gezeichnet).
- Alle heutigen echten Inhalte bleiben erhalten, werden aber neu einsortiert
  (die Vorlage hat nur Platz fuer wenige erfundene Beispielwerte, das echte
  Dashboard zeigt deutlich mehr).
- Die bestehende "GhostxxCode"-Kachel wandert in die Mitte, unter den
  GHOST-Reaktor (Kevins ausdruecklicher Wunsch: "der Chat sollte mittig
  sein" - weicht von der Vorlage ab, die ihren Chat rechts zeigt).

## Nicht-Ziele (bewusst ausgeklammert, siehe Brainstorming-Verlauf)

- **Kein zweiter Chat.** Kevin ausdruecklich gefragt (siehe Korrektur oben):
  "nur umziehen, kein zweiter chat" - die bestehende "GhostxxCode"-Kachel
  wird verschoben und neu gestylt, nicht dupliziert, nicht durch einen
  zweiten, allgemeinen Ghostxx-Chat ergaenzt.
- **Keine Verhaltensaenderung am bestehenden Chat.** Modell
  (`qwen2.5-coder:7b`), Systemprompt, Zeichenlimit (1200), fehlende
  Anti-Spam-Bremse, fehlende Verlaufs-Persistenz uebers Neuladen hinaus -
  alles bleibt exakt wie es ist. Nur Ort und Optik aendern sich.
- **Kein externer KI-Anbieter.** Die Vorlage zeigt einen Umschalter zwischen
  "Claude" und "GPT" - das war Beiwerk des generierenden Chatbots, keine
  Anforderung. Es bleibt bei den lokalen Ollama-Modellen wie bisher.
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
der Vorlage als Ausgangspunkt). **Kein Backend-Stueck kommt neu dazu.**
`dashboard-daten.js`s `stand()`-Funktion bleibt inhaltlich unveraendert - sie
liefert weiterhin dieselben Felder (anmeldungen, logbuch, fehler, warnungen,
system, selbstverbesserung, ...), nur die Darstellung aendert sich.
`dashboard.js`s Endpunkte (`/api/stand`, `/api/chat`, `/api/bilder-pause`,
`/api/schalter`, `/api/neustart`, `/api/aus`) bleiben alle unveraendert -
die neue Seite ruft sie exakt so auf wie die alte. Der GHOST-Reaktor bekommt
sein Signal weiterhin aus `rechnetGerade()` (bereits vorhanden, zeigt ob
gerade eine Ollama-Anfrage laeuft).

### Layout

- **Links:** Modul-Schalter (echte Schalter aus `steuerung.js`, gruppiert
  wie heute in `SCHALTER_GRUPPEN`) + System-Telemetrie (CPU/RAM/GPU/VRAM/
  Discord-Ping, als Sparkline-Graphen im Stil der Vorlage - Datenquelle
  bleibt `system-werte.js`).
- **Mitte:** GHOST-Reaktor oben (Canvas-Animation aus der Vorlage,
  angeschlossen an `rechnetGerade()` statt an Zufallswerte) + darunter die
  bestehende "GhostxxCode"-Kachel (siehe unten).
- **Rechts:** Anmeldungen, Logbuch-Stand, Aktivitaet, Fehler, Warnungen,
  Selbstverbesserung-Uebersicht - als Karten im neuen Stil, untereinander.
  Laenger als in der Vorlage, weil mehr echte Inhalte reinmuessen.
- **Unten:** Statusleiste (CPU/RAM/GPU/Discord-Ping, Terminal-/Neustart-/
  Ausschalten-/Bildlesen-Pause-Knopf) - inhaltlich wie heute, neu gestylt.

## Coding-Helfer umziehen

Die bestehende Kachel "GhostxxCode — Coding-Helfer"
(`dashboard-seite.js`: `#chatverlauf`, `#chatformular`, `#chattext`,
`zeichneDashboardChat()`, der `submit`-Handler gegen `POST /api/chat`) wird
**unveraendert uebernommen** - derselbe Endpunkt, dieselbe Anfrage/Antwort-
Form (`{text}` rein, `{ok, text}` raus), dasselbe Zeichenlimit (1200),
dasselbe Verhalten bei pausiertem Chat-Schalter oder Ollama-Fehler. Es
aendert sich nur:

- **Ort:** von der linken Spalte in die Mitte, unter den GHOST-Reaktor.
- **Optik:** Karte, Eingabefeld und Verlaufsliste im neuen "Kontrollraum"-
  Stil (Panel mit Eckmarkierungen, `--mono`-Schrift fuer die Kopfzeile,
  Farben aus der Vorlage) statt im heutigen Stil.

Keine Aenderung an `dashboard.js` (Server) noetig fuer diesen Teil - reines
Verschieben von Markup/CSS/dem bereits bestehenden Client-Skript.

## Fehlerbehandlung

- Ollama nicht erreichbar: Coding-Helfer zeigt weiterhin dieselbe
  Fehlermeldung wie heute ("Mein Kopf streikt gerade." /
  "Ich brauche gerade zu lange zum Denken."), unveraendert. Rest des
  Dashboards liest weiter normal.
- Ein Fehler beim Zeichnen des neuen Layouts (z.B. Canvas nicht verfuegbar)
  darf die uebrigen Karten nicht mitreissen - wie heute schon ueberall im
  Dashboard durch einzelne try/catch pro Abschnitt abgesichert.

## Testplan

- `tests/dashboard.test.js`: bestehende Pruefungen auf `stand()` bleiben
  gueltig (Datenseite aendert sich inhaltlich nicht). Neue Pruefungen fuer
  die HTML-Struktur (neue IDs statt der alten IDs aus der aktuellen Seite).
- Keine neue Testdatei fuer den Coding-Helfer noetig - sein Verhalten aendert
  sich nicht, nur sein Markup/CSS-Ort. Bestehende Tests, die ihn pruefen
  (falls vorhanden), muessen nur auf ggf. neue IDs angepasst werden.
- Manuelle Pruefung nach der Umsetzung (kann nicht automatisiert werden):
  Dashboard im Browser oeffnen, optischer Abgleich mit der Vorlage, eine
  echte Coding-Frage stellen und pruefen dass sie wie gewohnt beantwortet
  wird.

## Self-Review

- **Platzhalter-Scan:** keine TBD/TODO offen.
- **Konsistenz:** Nicht-Ziele (kein zweiter Chat, keine Verhaltensaenderung
  am Coding-Helfer, kein externer Anbieter, kein Freitext-Agent, keine neuen
  Schalter) stehen im Einklang mit dem Architektur-Abschnitt - insbesondere
  wird nirgends mehr ein neuer Endpunkt erwaehnt.
- **Abhaengigkeit klar benannt:** die Annahme, dass die fragen-dm-Branch
  vorher gemergt ist, steht explizit mit Ausweichverhalten, falls nicht.
- **Umfang:** passend fuer einen einzelnen Umsetzungsplan - reines Frontend,
  kein Backend-Task mehr noetig.
