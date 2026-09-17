# Ghostxx Selbstverbesserung — Design (Phase 1: eigener Code)

Stand: 2026-09-17 · Status: von Kevin freigegeben, bereit für Umsetzungsplanung

## Ziel

Ghostxx soll eigene Probleme in seinem eigenen Code erkennen, verstehen und
einen Lösungsvorschlag erarbeiten lassen — im Rhythmus **verstehen → lernen →
anwenden**. Der "anwenden"-Schritt bleibt dabei immer ein Vorschlag: Kevin
entscheidet, mergt und startet den Bot neu, nie Ghostxx selbst.

## Nicht-Ziel (Phase 2, später)

Das Durchsuchen und Lernen von externen Agent-Projekten (OpenCode, Claude
Code, Codex, OpenHands, …), um sich Fähigkeiten wie besseres Reden oder
Rechnen abzuschauen. Das ist ein eigenständiges, offenes Rechercheprojekt und
wird bewusst nicht in diese Phase gemischt. Erst wenn Phase 1 läuft und sich
bewährt hat, wird das als eigene Spec angegangen.

## Architektur-Überblick

```
Logs (logger.js, audit-log.js, server-log.js, Watchdog-Historie)
        │
        ▼
   Beobachter  ──liest/schreibt──▶  Gedächtnis/
        │  (neues, echtes Problem gefunden)
        ▼
  Claude-Code-Session (non-interaktiv, eigener Branch)
        │
        ├─▶ Dashboard: Live-Ansicht der laufenden Session
        └─▶ Discord-DM an Kevin, sobald fertig
                        │
                        ▼
              Kevin prüft Vorschlag/Branch
                        │
              ┌─────────┴─────────┐
              ▼                   ▼
          annehmen            ablehnen
      (merge + restart-bot.ps1   (Grund im Gedächtnis
       von Hand durch Kevin)      vermerkt, nicht wiederholen)
```

## 1) Beobachter

Neues Modul (Arbeitstitel `src/selbstbeobachtung.js`), läuft in einem festen,
gedeckelten Rhythmus (Details in der Umsetzungsplanung — passend zum
"Alles gedeckelt"-Prinzip der bestehenden proaktiven Module).

- Liest bestehende Logquellen: `logger.js`, `audit-log.js`, `server-log.js`,
  sowie die Watchdog-Historie aus `run-bot.ps1` (Abstürze/Neustarts).
- Zählt **Wiederholungen**, keine Einzelfälle: ein Fehler/Muster gilt erst als
  "echtes Problem", wenn er mehrfach in kurzer Zeit auftritt (genauer Schwellwert
  Teil der Umsetzungsplanung, folgt dem "messen, nicht vermuten"-Grundsatz).
- Beispiel aus der Praxis: das Chat-Modell "dreht abends durch", wenn es
  lange durchgelaufen ist — das wäre über Antwortfehler/Auffälligkeiten in
  den Logs messbar, nicht über eine Vermutung.
- Bevor ein neues Problem an die Session weitergegeben wird, prüft der
  Beobachter im Gedächtnis, ob genau das schon einmal versucht und abgelehnt
  oder ergebnislos war — dann wird es nicht erneut angestoßen.

## 2) Gedächtnis/-Ordner

Neuer Ordner `Gedächtnis/` im Repo-Wurzelverzeichnis, git-versioniert wie
alles andere. Ein Eintrag pro erkanntem Problem, mindestens mit:

- Was beobachtet wurde: Belege (Log-Auszüge, Zeitpunkte, Häufigkeit)
- Ob/wann eine Claude-Code-Session losgeschickt wurde
- **Worauf die Session Zugriff hatte** (Tools, Leitplanken, welche Dateien/
  Bereiche erlaubt waren) — damit das später nachvollziehbar ist, auch für
  eine spätere Claude-Code-Session, die sich das ansieht, wenn Kevin danach
  fragt
- Was die Session vorgeschlagen hat (Branch-Name, Zusammenfassung)
- Kevins Entscheidung: angenommen / abgelehnt / ignoriert, mit Grund
- Bei Annahme: was danach passiert ist (z. B. "gemergt am ..., seitdem kein
  Wiederauftreten")

Format (Detail der Umsetzungsplanung): vermutlich ein Markdown- oder
JSON-Dokument pro Problem, damit sowohl Menschen als auch eine spätere
Session es einfach lesen können.

## 3) Auslösen der Claude-Code-Session

Findet der Beobachter ein neues, unbehandeltes Problem, startet er
automatisch eine **non-interaktive Claude-Code-Session** auf einem neuen
Branch, mit einer vorformulierten Aufgabenbeschreibung: Belege, betroffene
Datei(en)/Module, die Leitplanken aus Abschnitt 4.

- **Rate-Limit:** maximal 5 automatisch gestartete Sessions pro Tag. Für
  eine 6. an einem Tag fragt Ghostxx per Discord-DM vorher nach, statt
  einfach loszulegen.
- **Nachtruhe:** Analyse darf im Hintergrund laufen, aber eine Discord-DM an
  Kevin während der bestehenden Ruhezeit (2–10 Uhr) wird zurückgehalten und
  erst danach zugestellt — passend zum bestehenden "nachts sagt er nichts"-
  Prinzip. (Zur Bestätigung in der Umsetzungsplanung.)

## 4) Sichtbarkeit

- **Dashboard:** neue Live-Ansicht, die zeigt, ob gerade eine
  Selbstverbesserungs-Session läuft, an welchem Problem, und einen laufenden
  Mitschnitt dessen, was die Session tut (les- aber nicht schreibbar, analog
  zum bestehenden "Dashboard liest nur"-Prinzip).
- **Discord-DM:** sobald die Session fertig ist, bekommt Kevin persönlich
  eine Nachricht mit Zusammenfassung, Branch-Name/Diff-Verweis.

## 5) Leitplanken für die automatische Session

Fest codiert, nicht verhandelbar durch die Session selbst:

1. **Nie auf `main`.** Jede Änderung landet auf einem neuen, eigenen Branch.
   Kein Merge, kein Push zu `main` durch die Session.
2. **Event-/Zeitplan-/Auszahlungscode tabu.** Insbesondere: Eventlogik,
   Scheduler, `logbook.js`/`istGewertet()`, `logbuch-zahlen.js`,
   `logbook-batch.js`, `auszahlung-saetze.js`. Die Session darf dort
   höchstens etwas *melden* ("mir ist hier was aufgefallen"), nie ändern.
3. **Nie `restart-bot.ps1` oder `stop-bot.ps1` ausführen.** Neustart bleibt
   ausschließlich Kevins Handlung.
4. **Nie `.env` lesen oder schreiben** (das echte, nicht `.env.example`).
5. **Ein Problem pro Session/Branch.** Keine Sammel-Commits.

## 6) Ablauf nach Fertigstellung

1. Kevin bekommt DM + sieht Details im Dashboard.
2. Kevin prüft Zusammenfassung/Diff, entscheidet.
3. Bei Annahme: Kevin merged von Hand, startet mit `restart-bot.ps1` neu.
4. Ergebnis (angenommen/abgelehnt/Ausgang) wird im Gedächtnis-Eintrag
   nachgetragen.

## Offene Punkte für die Umsetzungsplanung

- Genauer Schwellwert für "echtes Problem" (wie oft/in welchem Zeitraum).
- Technischer Weg, wie Ghostxx eine Claude-Code-Session non-interaktiv
  anstößt (CLI-Aufruf als Kindprozess, erwartete Laufzeit, Fehlerfall wenn
  die Session selbst abstürzt oder hängt).
- Genaues Format der Gedächtnis-Einträge (Markdown vs. JSON, Dateibenennung).
- Wie die Dashboard-Live-Ansicht technisch an die laufende Session
  angebunden wird (Polling vs. Streaming).
- Ob/wie der Rhythmus des Beobachters (wie oft er Logs prüft) gedeckelt wird.
