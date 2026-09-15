# Ghostxx Dashboard — Jarvis-KI Design System

## Produktkontext

Ghostxx ist ein deutschsprachiger Discord-Bot fuer eine GTA-Roleplay-Familie.
Er verwaltet Event-Anmeldungen, staatliche Meldungen, ein Logbuch mit
Bildnachweisen, Auszahlungen und Verlosungen — und redet nebenbei im Chat
mit den Mitgliedern. Das Dashboard ist eine reine Beobachtungskonsole fuer
den Betreiber (nur 127.0.0.1 erreichbar, kein Login noetig): es zeigt live,
was der Bot gerade tut, denkt und liest.

Ziel: ein Interface, das wirkt wie J.A.R.V.I.S. aus Iron Man — eine wache,
denkende KI, die man beim Arbeiten beobachten kann. Keine Marketing-Seite,
kein SaaS-Onboarding — ein Operator-Cockpit, das rund um die Uhr auf einem
Monitor steht.

## Farbsystem (verbindlich, nicht veraendern)

Das bestehende Dashboard hat schon eine funktionierende, gemessene Cyan/Navy-
Palette. Sie bleibt die Basis — kein Gold, kein Lila, kein generisches
Tech-Blau-Violett-Gradient.

```
--bg:        #060d18   (Seite, fast schwarz mit Navy-Stich)
--karte:     #0c1826   (Kartenflaeche)
--rand:      #16344d   (Rahmen, ruhig)
--text:      #dceaf5   (Haupttext, warmes Weiss-Blau)
--leise:     #6f93ad   (gedaempfter Text, Meta-Infos)
--akzent:    #22d3ee   (Cyan — Ghostxx' Leitfarbe, fuer Fokus & Aktivitaet)
--gut:       #35e08a   (Gruen — laeuft, bestaetigt, online)
--warn:      #f0b429   (Amber — Achtung, wartet)
--schlecht:  #ff5f6d   (Rot — Fehler, aus, abgelehnt)
```

Sekundaerakzente aus derselben Cyan-Familie sind erlaubt, wenn mehr
Abstufung gebraucht wird (z.B. #38bdf8, #0ea5e9, rgba(103,232,249,.7)) —
das nutzt das bestehende Dashboard schon fuer die Ring-Animation des Kerns.

## Stilrichtung: "Neural HUD", nicht "Luxus-Glas"

Von einer Referenz ("Neural Noir Interface Style") wird NUR die Technik
uebernommen, NICHT die Farbe (die war Gold/Bronze — passt nicht zu Jarvis):

- **Glasmorphismus**: Kartenflaechen mit leichter Transparenz und
  `backdrop-filter: blur(8–12px)`, dezente 1px-Rahmen in `--rand` mit
  niedriger Deckkraft, keine harten Schatten.
- **Leucht-Effekte**: `box-shadow`/`text-shadow` in Cyan um aktive Elemente
  (Kern, aktive Werte, laufende Prozesse) — Ruhe im Rand, Leuchten im
  Zentrum. Ein zentraler Glow-Effekt hinter dem Ghostxx-Kern (radialer
  Farbverlauf, verblasst nach aussen).
  radialer Punktraster-Hintergrund (bg-dots), sehr niedrige Deckkraft
  (< 8%), NICHT ablenkend — reine Textur, kein Muster im Vordergrund.
- **Neural-Verbindungslinien**: duenne, geschwungene SVG-Linien (Cyan,
  Farbverlauf zu transparent), die den Ghostxx-Kern optisch mit den
  umliegenden Karten verbinden — als Hinweis, dass alles vom Kern ausgeht.
  Gedaempfte Pulsanimation der Linien-Deckkraft (0.3 → 0.6), nicht grell.
- **Lebendige Statusanzeige**: kleine "LIVE"-Pille mit pulsierendem Punkt
  (Cyan/Gruen je nach Status) fuer laufende Prozesse (Bildlesen, Chat).
- **Bewegung sparsam einsetzen**: der Kern dreht sich nur, solange wirklich
  Daten reinkommen (bestehendes Verhalten beibehalten) — Bewegung bedeutet
  hier immer "der Bot arbeitet gerade wirklich", nie reine Dekoration.

## Typografie

- UI-Schrift: Inter oder vergleichbare geometrische Sans-Serif — bestehende
  Wahl beibehalten, keine Serifen, kein "editorial" Stil (das waere zu
  luxurioes/Magazin-artig fuer ein Operator-Cockpit).
  Ueberschriften der Karten: klein, Grossbuchstaben, weiter Buchstabenabstand
  (wie im bestehenden Dashboard: 12px, uppercase, letter-spacing .08em).
- Zahlen/Messwerte (CPU, RAM, Ping etc.): tabellarische Ziffern
  (`font-variant-numeric: tabular-nums`), damit sie beim Live-Update nicht
  wackeln.

## Layout-Vorgaben (hart, nicht verhandelbar)

- Zielgroesse 1920×1080, **die Gesamtseite darf NICHT scrollen**. Einzelne
  Karten duerfen intern scrollen (eigene `max-height` + `overflow-y: auto`).
- Drei-Spalten-Raster:
  - **Links**: offene Anmeldungen, Terminuebersicht/Ausblick-Rueckblick,
    Meilenstein-Naehe, Terminal-Log.
  - **Mitte**: Ghostxx-Kern (visuelles Zentrum, groesser/praesenter als
    alles andere), darunter "was er in Discord tut" (Aktivitaetsstream)
    und "Logbuch — wartet auf Auszahlung".
  - **Rechts**: offene Fragen ans Sprachmodell (mit Eingabefeld + Merken-
    Knopf), Bilder-Uebersicht ("was er gelesen hat"), letzte Fehler.
  - **Unten**: schmale Statusleiste mit CPU/RAM/GPU/VRAM/Platte/Discord-Ping
    als kompakte Messwerte, Uhrzeit rechts.
- Der Ghostxx-Kern ist der visuelle Ankerpunkt der ganzen Seite — er darf
  klar der groesste/hellste Punkt sein, ohne die Lesbarkeit der Datenkarten
  drumherum zu beeintraechtigen.
- Alle Texte bleiben Deutsch, alle Icons sind schematisch/geometrisch
  (keine Emojis, kein verspieltes Iconset) — Instrumenten-Charakter, nicht
  Consumer-App.

## Was NICHT passiert

- Kein Login/Auth-UI (das Dashboard ist bewusst nur lokal erreichbar).
- Keine Marketing-Elemente (kein Hero mit CTA-Buttons, keine Preistabelle,
  kein Testimonial-Bereich) — das ist ein Cockpit, kein Produkt zum Verkaufen.
- Keine neuen Farben ausserhalb der oben genannten Cyan/Navy-Familie plus
  den drei Status-Farben (gut/warn/schlecht).
