# Code-Recherche (Prototyp)

Kleiner, isolierter Testbaustein: kann Ghostxx bei Coding-Fragen echte
Infos aus dem Web nachschlagen? **Nicht an den Bot angeschlossen** — kein
Import von/nach `src/`, nirgendwo in `message-handler.js` oder `ollama.js`
verdrahtet. Ein Fehler hier kann den produktiven Bot nicht beruehren.

## Warum das existiert

Ghostxx hat bereits ein Selbstverbesserungs-System (`src/selbstverbesserung*.js`),
das eigene Fehler erkennt und automatisch eine Claude-Code-Session zum Fixen
anstoesst. Die hier getestete Idee geht weiter: koennte Ghostxx (im Chat oder
in einer solchen Session) auch aktiv im Web nachschlagen, statt nur zu raten?
Dieser Prototyp klaert nur die technische Machbarkeit, nichts davon ist
bereits angebunden.

## Was es tut

`sucheCode(anfrage)` fragt DuckDuckGos Instant-Answer-API ab (`websuche.js`) —
bewusst gewaehlt, weil sie **ohne Konto/Schluessel** funktioniert, also keine
Anmeldedaten irgendwo hinterlegt werden muessen. Nachteil: liefert nur kurze
Zusammenfassungen, keine vollstaendige Suchergebnisliste — fuer einen echten
Einsatz muesste man das gegen eine bessere (dann aber schluesselpflichtige)
Such-API messen.

Nur lesend. Kein Ausfuehren von Code, kein Zugriff auf GitHub-Schreibrechte,
kein eigener Speicher.

## Testen

```bash
npm test -- code-recherche
```

## Gemessener Befund: DuckDuckGo reicht nicht

Zwei echte Testabfragen gegen die echte API (nicht gemockt):

- `"Node.js"` → gute, brauchbare Zusammenfassung (Wikipedia-gestuetzt)
- `"TypeError cannot read properties of undefined"` → **keine Antwort**
  (`keine_antwort_gefunden`)

Die zweite Art Frage ist genau der Fall, fuer den eine Coding-Hilfe eigentlich
gebraucht wuerde (ein echter Fehlertext, keine Begriffserklaerung). Die
Instant-Answer-API ist fuer Lexikon-Wissen gebaut, nicht fuer Fehlersuche.
**Ergebnis: mit dieser schluessellosen API allein laesst sich die eigentliche
Idee nicht sinnvoll umsetzen.** Fuer echte Coding-Fragen braeuchte es eine
richtige Such-API (z.B. Bing/Google/Serper) oder eine GitHub-Code-Suche -
beide brauchen einen API-Schluessel, den ich nicht ohne Ruecksprache anlege.

## Offene Fragen, bevor daraus mehr wird

- Welche Such-API (mit Schluessel) waere es, und wer legt den Zugang an?
- Wo waere der feste Parser ("erst ablesen, dann raten"), der entscheidet,
  wann ueberhaupt nachgeschlagen wird?
- Soll das in den normalen Chat (`ollama.js`) oder nur in
  Selbstverbesserungs-Sessions einfliessen?

Das sind Kevins Entscheidungen, keine technischen.
