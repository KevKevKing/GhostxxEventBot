# Code-Vorschlag: angenommener Vorschlag wird automatisch umgesetzt — Design

## Zusammenfassung

**Ändert eine explizite Nicht-Ziel-Festlegung aus
`docs/superpowers/specs/2026-09-29-code-vorschlaege-design.md`:** dort
stand "keine automatische Umsetzung bei 'ja', auf keiner der beiden
Zustimmungsstufen" — bewusst so, bis Kevin ein paar echte Vorschläge
gesehen und für gut befunden hat. Das ist jetzt passiert (erster echter
Vorschlag zu `src/archiver.js`, von Kevin als gut bewertet). Diese Spec
ändert **nur** Gate 2 (Zustimmung zum fertigen Vorschlag): ein "Ja" dort
löst ab jetzt dieselbe echte, code-schreibende Session aus wie ein
automatisch erkanntes Problem. Gate 1 ("darf ich schauen?") bleibt
unverändert — dort löst "Ja" weiterhin nur die lesende
`starteVorschlagsSession()` aus, nie eine Code-Änderung.

## Ziel

- Ein "Ja" auf den fertigen Vorschlag (Gate 2) startet dieselbe,
  bereits gehärtete Selbstverbesserungs-Kette wie ein automatisch
  erkanntes Problem: Tageslimit-Prüfung, Gedächtnis-Eintrag,
  `starteSession()` (Klon, Branch, Tabu-Prüfung, Tests, Push), Vermerk des
  Ergebnisses, DM an Kevin.
- **Geteiltes Tageslimit** (Kevins ausdrückliche Entscheidung): eine
  umgesetzte Vorschlags-Session zählt gegen dasselbe 5/Tag-Limit wie
  echte Fehler-Fixes — kein eigener, zweiter Topf.
- **Keine zwei echten Sessions gleichzeitig**, egal ob beide durch
  automatische Erkennung, beide durch angenommene Vorschläge, oder eine
  von jedem ausgelöst wurden — siehe Abschnitt 2.

## Nicht-Ziele

- **Gate 1 ändert sich nicht.** "Darf ich mir X anschauen?" löst
  weiterhin nur die rein lesende `starteVorschlagsSession()` aus, nie
  eine Code-Änderung. Nur das JA/NEIN auf den **fertigen Vorschlag**
  (Gate 2) bekommt jetzt eine echte Wirkung.
- **Kein neuer Aufgaben-Text-Baustein.** Die Umsetzung nutzt
  `baueAufgabe()`/`starteSession()` unverändert — der Vorschlagstext wird
  einfach als `belege[0].grund` übergeben, genau wie ein Fehlerbefund
  heute schon als `grund` ankommt.
- **Kein Rückgängig-Mechanismus für ein versehentliches "Ja".** Genau wie
  bei einem automatisch erkannten Problem heute auch: einmal gestartet,
  läuft die Session bis zum Ende (max. 20 Minuten). Das ist bestehendes
  Verhalten, keine neue Einschränkung durch diese Spec.

## Architektur-Überblick

```
Vorher (zwei getrennte Aufrufer der Sicherheitskette gab es nicht):

  tick() (Selbstverbesserung, alle 10 Min)
     -> erkennt Problem -> [Tageslimit -> Gedaechtnis -> starteSession -> DM] (inline in tick())

Nachher (gemeinsame Funktion, zwei Aufrufer):

  tick() (Selbstverbesserung, alle 10 Min)
     -> erkennt Problem -> bearbeiteProblem(problem)
                                  |
  Gate 2 "Ja" (code-vorschlag.js) -> bearbeiteProblem(problem)
                                  |
                                  v
                    [laeuft schon eine echte Session? -> ablehnen]
                    [Tageslimit -> Gedaechtnis -> starteSession -> vermerkeSession -> DM]
```

## 1) `bearbeiteProblem(problem)`: der bestehende Kern von `tick()`, extrahiert

In `src/selbstverbesserung.js` wird der Teil von `tick()` ab
`const stand = await limit.darfLaufen();` bis zum Ende der bestehenden
Funktion (aktuell Zeile 53-118) **unverändert im Verhalten**, aber als
eigene, exportierte Funktion `bearbeiteProblem(problem, deps)`
herausgezogen. `tick()` selbst wird dadurch kürzer:

```js
async function tick({
  beobachten = beobachtungEcht,
  limit = limitEcht,
  session = sessionEcht,
  benachrichtigung = benachrichtigungEcht,
  gedaechtnis = gedaechtnisEcht,
  schalterAn = istAn,
} = {}) {
  if (!schalterAn('selbstverbesserung')) return;
  await benachrichtigung.sendeAusstehende();

  const problem = (await beobachten.crashSchleifeErkannt())
    || (await beobachten.erkenneProblem())
    || (await beobachten.parserFehlschlagErkannt());
  if (!problem) return;

  await bearbeiteProblem(problem, { limit, session, benachrichtigung, gedaechtnis });
}
```

`bearbeiteProblem` bekommt **eine neue, zusätzliche Prüfung ganz am
Anfang** (siehe Abschnitt 2) — das ist die einzige Verhaltensänderung
gegenüber dem bisherigen `tick()`-Code, alles andere ist eine reine
Verschiebung.

## 2) Keine zwei echten Sessions gleichzeitig

Bisher gab es nur einen Aufrufer der Kette (`tick()`, selbst durch die
`laeuft`-Wächter-Variable in `startSelbstverbesserung()` vor
Überlappung mit sich selbst geschützt). Mit einem zweiten Aufrufer (Gate
2 aus `code-vorschlag.js`) reicht das nicht mehr — `bearbeiteProblem`
selbst muss die Sperre kennen:

```js
async function bearbeiteProblem(problem, { limit, session, benachrichtigung, gedaechtnis }) {
  if (laufendesProblem) {
    // Schon eine echte Session aktiv (egal ob durch tick() oder durch
    // einen angenommenen Vorschlag ausgeloest) - nicht ueberlappen.
    return { ok: false, uebersprungen: true };
  }
  // ... bisheriger Koerper von tick() ab "const stand = await limit.darfLaufen();"
}
```

`aktuellerLauf()` (bereits vorhanden, liest `laufendesProblem`/`laufSeit`)
bleibt unverändert — sie zeigt jetzt einfach beide Arten von Läufen gleich
an, was für das Dashboard korrekt ist: für Kevin ist "eine echte Session
läuft" dieselbe Information, unabhängig vom Auslöser.

## 3) Gate 2 "Ja" in `code-vorschlag.js`

Der bestehende Zweig `ausstehend.art === 'vorschlag'` in
`message-handler.js` (aktuell: ruft bei "ja"/"nein" nur
`codeVorschlag.vermerkeEntscheidung(status)` auf) bekommt bei "ja"
zusätzlich einen Aufruf einer neuen Funktion in `code-vorschlag.js`,
`setzeVorschlagUm(ausstehend)`:

```js
async function setzeVorschlagUm(ausstehend, { bearbeiteProblem = bearbeiteProblemEcht } = {}) {
  const problem = {
    titel: `Vorschlag umsetzen: ${ausstehend.datei}`,
    belege: [{ zeit: ausstehend.gesendetAm, grund: ausstehend.vorschlag }],
  };
  await bearbeiteProblem(problem);
}
```

Wie beim bestehenden Gate-1-"Ja" (Start der lesenden Session) läuft das
**im Hintergrund** (`.catch(() => null)`, kein `await` im
DM-Antwort-Handler) — eine echte Session kann bis zu 20 Minuten dauern,
die DM-Antwort darf darauf nicht warten. Kevin bekommt stattdessen sofort
eine kurze Bestätigung ("Gemerkt, ich setz das gleich um.") und danach,
wie bei jeder Selbstverbesserungs-Session, die reguläre
Ergebnis-DM über `benachrichtigung.benachrichtige()`.

```js
if (ausstehend.art === 'vorschlag') {
  await codeVorschlag.vermerkeEntscheidung(istJa ? 'angenommen' : 'abgelehnt');
  if (istJa) {
    await reply(message, 'Gemerkt, ich setz das gleich um.');
    codeVorschlag.setzeVorschlagUm(ausstehend).catch(() => null);
  } else {
    await reply(message, 'Auch gut, verworfen.');
  }
  return;
}
```

## Fehlerbehandlung

- Lehnt `bearbeiteProblem` wegen einer schon laufenden Session ab
  (`uebersprungen: true`), bekommt Kevin **keine** zusätzliche DM darüber
  — das wäre Rauschen. Der Vorschlag ist bereits als "angenommen"
  vermerkt (siehe `vermerkeEntscheidung` oben, läuft unabhängig davon);
  die Umsetzung selbst geht für diesen Versuch verloren, ohne erneuten
  eigenen Anlauf. Für Version 1 akzeptiert — dieselbe Situation (zwei
  echte Anlässe fast gleichzeitig) ist bei der reinen Fehler-Erkennung
  heute schon extrem selten, und eine Warteschlange wäre unnötige
  Komplexität für einen Randfall.
- Schlägt `starteSession()` innerhalb von `bearbeiteProblem` fehl (Klon-
  Fehler, Tabu-Verstoß, Timeout), passiert exakt das, was heute bei einem
  automatisch erkannten Problem auch passiert: Ergebnis wird vermerkt,
  Kevin bekommt eine DM mit dem Fehlertext. Kein Sonderfall für
  Vorschlags-Umsetzungen nötig — `bearbeiteProblem` kennt den Unterschied
  zwischen "Auslöser war ein echter Fehler" und "Auslöser war ein
  angenommener Vorschlag" nach dem Start gar nicht mehr, es ist einfach
  ein `problem`-Objekt.

## Tests

- `bearbeiteProblem()`: alle bestehenden `tick()`-Testfälle (Tageslimit
  erreicht, Problem gefunden und Limit erlaubt, Session wirft, Dashboard
  sieht die laufende Session) wandern eins zu eins auf `bearbeiteProblem`
  um — reine Verschiebung, gleiche Erwartungen.
- **Neu:** ruft man `bearbeiteProblem` ein zweites Mal auf, während die
  erste (gemockte, langsame) Session noch läuft, liefert der zweite Aufruf
  sofort `{ok:false, uebersprungen:true}`, ohne `limit.darfLaufen`,
  `gedaechtnis.neuerEintrag` oder `session.starteSession` ein zweites Mal
  aufzurufen.
- `tick()`: neuer, schlanker Test, der nur noch prüft, dass bei
  gefundenem Problem `bearbeiteProblem` mit dem richtigen Problem
  aufgerufen wird (die Detail-Fälle sind jetzt `bearbeiteProblem`s
  Verantwortung, nicht mehr `tick()`s).
- `setzeVorschlagUm()`: baut aus einem `ausstehend`-Objekt das korrekte
  `problem`-Objekt (`titel` enthält die Datei, `belege[0].grund` ist der
  Vorschlagstext) und ruft `bearbeiteProblem` genau einmal damit auf.

## Offene Punkte für die Umsetzungsplanung

- Exakte Formulierung von `problem.titel` (`"Vorschlag umsetzen: ${datei}"`
  ist ein Vorschlag) — wie er im Dashboard/Gedächtnis erscheint, ist ein
  Detail für die Implementierung.
- Ob `bearbeiteProblem` als eigener, benannter Export
  (`module.exports.bearbeiteProblem`) oder nur intern verfügbar gemacht
  wird — muss exportiert sein, damit `code-vorschlag.js` sie nutzen kann,
  aber der genaue Name ist kein inhaltlicher Punkt.
