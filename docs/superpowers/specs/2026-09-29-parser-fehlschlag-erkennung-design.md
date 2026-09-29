# Selbstverbesserung: Parser-Fehlschläge erkennen — Design

## Zusammenfassung

Die Selbstverbesserung (`src/selbstverbesserung*.js`) erkennt heute nur zwei
Arten von Problemen: Absturzschleifen (`crashSchleifeErkannt()`) und
wiederholte Fehlermeldungen aus dem Log (`erkenneProblem()`), beide in
`selbstbeobachtung.js`. Kevin möchte, dass Ghostxx "mehr sieht" — als
ersten, bewusst kleinen Schritt: wiederholte Fälle, in denen der feste
Parser (`intent-parser.js`) eine Chat-Nachricht nicht erkennt und stattdessen
das Sprachmodell raten muss. Genau das widerspricht dem Grundsatz aus
CLAUDE.md ("erst ablesen, dann raten") und ist ein echtes, messbares Signal
dafür, dass dem Parser eine Formulierung fehlt.

Zwei weitere, von Kevin genannte Signale (stille Fehlvermutungen bei
unbekannten Rollen/Kanälen, unlesbare Logbuch-Bilder) sind bewusst **nicht**
Teil dieser Spec — Reihenfolge laut Kevin: Parser-Fehlschläge zuerst, die
anderen beiden später, jeweils als eigene Runde.

## Ziel

- Jedes Mal, wenn der feste Parser (`detectIntent()` in `chat-router.js`,
  der `parseIntent()` aus `intent-parser.js` kapselt) eine Nachricht nicht
  erkennt, das Sprachmodell aber doch eine Absicht liefert
  (`result.intent` mit `source: 'model'` aus `model-intent.js`,
  `message-handler.js:860`), wird das vermerkt.
- Häuft sich das für dieselbe Aktion (`swap`/`add`/`remove`/`list`) auf
  dieselbe Weise wie heute schon bei Fehlermeldungen (3× in 2 Stunden),
  zählt das als "Problem" und läuft durch die bestehende, unveränderte
  Selbstverbesserungs-Kette: Gedächtnis (`istBekannt`/Signatur), Tageslimit
  (5/Tag), Claude-Code-Session im frischen Klon mit Tabu-Pfaden, DM an
  Kevin.
- Keine neue Sicherheitsschicht — nur eine dritte Eingangstür zur
  bestehenden, bereits einmal real getesteten Kette.

## Nicht-Ziele

- **Kein Text-Ähnlichkeits-Clustering.** Gruppiert wird ausschließlich nach
  der vom Modell erkannten Aktion (`swap`/`add`/`remove`/`list`), nicht nach
  Ähnlichkeit des Nachrichtentexts. Genaueres Clustering wäre unsicherer
  Neuland und für den ersten Schritt nicht nötig — die Aktion allein ist
  schon ein brauchbares, grobes Signal ("Tausch-Formulierungen bereiten dem
  Parser wiederholt Probleme").
- **Keine Änderung am bestehenden Modell-Fallback selbst.** Das Modell darf
  weiterhin raten und die Absicht ausführen (mit Rückgängig-Knopf, siehe
  `needsConfirmation()` in `chat-router.js`) — hier wird nur zusätzlich
  mitgezählt, nicht das Verhalten geändert.
- **Stille Fehlvermutungen und unlesbare Logbuch-Bilder** — siehe oben,
  spätere, eigene Spec.
- **Keine Änderung an `intent-parser.js` selbst.** Diese Spec baut nur die
  *Erkennung*, dass dem Parser etwas fehlt. Was genau ergänzt wird, wenn ein
  Fund auftritt, entscheidet — wie heute auch — die automatisch gestartete
  Claude-Code-Session, nicht dieser Beobachter.

## Architektur-Überblick

```
message-handler.js:860           (Modell hat geraten, Parser nicht)
        |
        v
vermerkeModellFallback(action)   neu, in selbstbeobachtung.js
        |
        v
selbstbeobachtung-fallback.json  neuer, eigener Verlauf (wie selbstbeobachtung-verlauf.json)
        |
        v
parserFehlschlagErkannt()        neu, in selbstbeobachtung.js — {titel, belege} | null
        |
        v
tick() in selbstverbesserung.js  dritter ||-Zweig, sonst unveraendert
        |
        v
   Gedaechtnis -> Tageslimit -> Session -> DM   (alles bestehend, unveraendert)
```

## 1) Vermerken: `vermerkeModellFallback(action)`

Neue Funktion in `selbstbeobachtung.js`, analog zu `registriereBeobachtung()`
(das den `onError`-Listener anmeldet), aber ohne Event-Listener — sie wird
direkt aus `message-handler.js` aufgerufen, an der Stelle, wo heute nur
`console.log('Absicht vom Modell ...')` steht (Zeile 860-861):

```js
if (result.intent) {
  console.log(`Absicht vom Modell (${result.model}): ${JSON.stringify(result.intent)}`);
  await vermerkeModellFallback(result.intent.action).catch(() => null);
  await runIntent(message, client, result.intent, context);
  return;
}
```

`vermerkeModellFallback` haengt einen Eintrag `{ aktion, zeit }` an einen
eigenen Verlauf an (eigene Datei `selbstbeobachtung-fallback.json`,
**nicht** dieselbe wie `selbstbeobachtung-verlauf.json` — andere Art von
Eintrag, eigene Aufbewahrung, soll die bestehende Fehler-Erkennung nicht
durch eine andere Eintragsform verwaessern). Gleiche Aufbewahrungslogik wie
heute: 24h Aufbewahrung, max. 300 Eintraege, atomar geschrieben
(`writeFileAtomic`), einmalig geladen und danach im Speicher gehalten —
`bereinigt()` (Kappung auf 24h/300 Eintraege) wird von beiden Verlaeufen
gemeinsam genutzt, `ladeVerlauf()`/`speichereVerlauf()` selbst aber bewusst
als eigene, fast identische Funktionsgruppe (`ladeFallbackVerlauf()`/
`speichereFallbackVerlauf()`) dupliziert statt parametrisiert: die
Fehler-/Absturz-Erkennung ist bereits real im Einsatz getestet, ein
gemeinsamer Code-Pfad haette jede Aenderung hier zum Risiko fuer sie
gemacht.

**Fehlerbehandlung:** `.catch(() => null)` beim Aufruf aus
`message-handler.js` — das Vermerken darf dem eigentlichen Chat-Fluss
niemals im Weg stehen. Schlaegt das Schreiben fehl, faellt genau dieser eine
Fund unter den Tisch, nichts weiter.

## 2) Erkennen: `parserFehlschlagErkannt()`

Neue Funktion in `selbstbeobachtung.js`, vom Aufbau her fast identisch zu
`erkenneProblem()`:

- Fenster: 2 Stunden (`FENSTER_MS`, bestehende Konstante wiederverwendet).
- Schwelle: 3 (`SCHWELLE`, bestehende Konstante wiederverwendet).
- Gruppierung: nach `aktion` statt nach `titel`.
- Titel des Funds: `` `Parser erkennt "${aktion}" wiederholt nicht` ``
  (z. B. `Parser erkennt "swap" wiederholt nicht`) — landet unveraendert im
  bestehenden Gedaechtnis/DM-Text, genau wie heutige Fund-Titel.
- Gleiche `istBekannt(signatur(titel))`-Pruefung wie heute, damit ein schon
  gemeldeter/laufender Fund nicht doppelt zaehlt.

```js
async function parserFehlschlagErkannt() {
  const eintraege = await ladeFallbackVerlauf();
  const grenze = Date.now() - FENSTER_MS;
  const aktuelle = eintraege.filter((e) => new Date(e.zeit).getTime() >= grenze);

  const proAktion = new Map();
  for (const eintrag of aktuelle) {
    const liste = proAktion.get(eintrag.aktion) || [];
    liste.push(eintrag);
    proAktion.set(eintrag.aktion, liste);
  }

  let bester = null;
  for (const [aktion, belege] of proAktion) {
    if (belege.length < SCHWELLE) continue;
    const titel = `Parser erkennt "${aktion}" wiederholt nicht`;
    if (await istBekannt(signatur(titel))) continue;
    if (!bester || belege.length > bester.belege.length) bester = { titel, belege };
  }

  return bester;
}
```

## 3) Einspeisen: `tick()` in `selbstverbesserung.js`

Ein dritter `||`-Zweig, sonst unveraendert:

```js
const problem = (await beobachten.crashSchleifeErkannt())
  || (await beobachten.erkenneProblem())
  || (await beobachten.parserFehlschlagErkannt());
```

Alles danach — Tageslimit, Gedaechtnis-Eintrag, Session-Start im frischen
Klon, Tabu-Pfad-Pruefung, DM an Kevin — bleibt exakt die bestehende Kette,
keine Verzweigung noetig. Der neue Fund sieht fuer die Kette aus wie jeder
andere auch.

## 4) Sichtbarkeit im Dashboard

Keine Aenderung noetig: `selbstverbesserung-gedaechtnis` (und damit die
"Selbstverbesserung"-Kachel im Dashboard) kennt nur Funde mit `titel` und
`belege`, unabhaengig davon, woher sie kommen. Ein Parser-Fund erscheint
dort automatisch genauso wie ein Fehler-Fund.

## Fehlerbehandlung

- Schreibfehler beim Vermerken: verschluckt (`.catch(() => null)`), der
  Chat-Fluss darf nie davon abhaengen.
- Lesefehler beim Laden des Fallback-Verlaufs (kaputte/fehlende Datei):
  wie heute bei `ladeVerlauf()` — leeres Array, kein Absturz.
- Kein neues Verhalten fuer den Fall, dass `parserFehlschlagErkannt()`
  selbst einen Fehler wirft: `tick()` faengt das nicht extra ab (macht es
  heute bei den anderen beiden Quellen auch nicht) — ein Fehler hier wuerde
  denselben Weg wie jeder andere Fehler in der Kette nehmen (Log, kein
  Absturz des Bots, siehe bestehende Fehlerbehandlung in `tick()`).
- **Erneutes Ausloesen trotz bereits entschiedenem Fund:** `istBekannt()`
  verhindert nur, dass derselbe Fund ein zweites Mal *gemeldet* wird — die
  zugrundeliegenden Eintraege im Fallback-Verlauf zaehlen unabhaengig davon
  bis zu 24 Stunden weiter (ihre Aufbewahrungsdauer). Kommt nach Kevins
  Entscheidung (angenommen oder ignoriert) innerhalb dieser 24 Stunden ein
  weiterer Fallback fuer dieselbe Aktion dazu, kann daraus ein neuer Fund mit
  neuer Signatur entstehen und eine weitere automatische Session anstossen —
  begrenzt nur durch das bestehende Tageslimit von 5 Sessions. Das ist kein
  neues Risiko (`erkenneProblem()` hat dieselbe Eigenschaft), aber hier
  wahrscheinlicher relevant, weil das Signal fortlaufend auftritt statt wie
  ein echter Fehler eher gelegentlich.

## Tests

- `vermerkeModellFallback` schreibt einen Eintrag, der danach im Verlauf
  auftaucht (eigene temporaere Testdatei/`DATA_DIR`, wie bei den
  bestehenden `selbstbeobachtung`-Tests).
- Unter der Schwelle (1-2× dieselbe Aktion in 2h): `parserFehlschlagErkannt()`
  liefert `null`.
- Ab der Schwelle (3× dieselbe Aktion in 2h): liefert `{titel, belege}` mit
  korrektem Titel und 3 Belegen.
- Ausserhalb des 2h-Fensters liegende Eintraege zaehlen nicht mit (wie beim
  bestehenden `erkenneProblem()`-Test).
- Ein schon bekannter Fund (`istBekannt` liefert true) wird nicht erneut
  zurueckgegeben.
- `tick()` in `selbstverbesserung.js`: der neue dritte Zweig wird erreicht,
  wenn die ersten beiden `null` liefern (Mock/Stub wie bei den bestehenden
  `tick()`-Tests).

## Offene Punkte für die Umsetzungsplanung

- Genauer Dateiname/Pfad fuer den neuen Verlauf
  (`selbstbeobachtung-fallback.json` ist ein Vorschlag, kein Muss).
- **Entschieden:** `ladeVerlauf()`/`speichereVerlauf()` wurden nicht
  parametrisiert, sondern als eigene Funktionsgruppe dupliziert
  (`ladeFallbackVerlauf()`/`speichereFallbackVerlauf()`) — Begruendung siehe
  Abschnitt 1 oben.
