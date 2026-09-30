# Code-Vorschlag: automatische Umsetzung bei Gate-2-"Ja" — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ein "Ja" auf den fertigen Code-Vorschlag (Gate 2) startet ab jetzt dieselbe echte, code-schreibende Selbstverbesserungs-Kette wie ein automatisch erkanntes Problem — geteiltes 5/Tag-Limit, keine zwei echten Sessions gleichzeitig.

**Architecture:** Der bestehende Kern von `tick()` in `selbstverbesserung.js` wird als eigene, exportierte Funktion `bearbeiteProblem(problem)` herausgezogen (reine Verschiebung plus eine neue Reentrancy-Sperre). `code-vorschlag.js` bekommt eine neue Funktion `setzeVorschlagUm(ausstehend)`, die aus dem angenommenen Vorschlag ein `problem`-Objekt baut und `bearbeiteProblem` aufruft. `message-handler.js`s Gate-2-Zweig ruft sie bei "ja" im Hintergrund auf.

**Tech Stack:** Node.js, kein Framework, eigener Test-Läufer (`tests/lib.js`), keine neuen Abhängigkeiten.

**Spec:** `docs/superpowers/specs/2026-09-30-code-vorschlag-automatische-umsetzung-design.md`

## Global Constraints

- Gate 1 ("darf ich schauen?") ändert sich nicht — nur Gate 2 (Zustimmung
  zum fertigen Vorschlag) bekommt eine echte Wirkung.
- Geteiltes 5/Tag-Limit mit den automatisch erkannten Problemen — kein
  eigener, zweiter Zähler (Kevins ausdrückliche Entscheidung).
- Keine zwei echten, code-schreibenden Sessions gleichzeitig, unabhängig
  vom Auslöser (automatische Erkennung oder angenommener Vorschlag).
- `tick()`s äußeres Verhalten bleibt für alle bestehenden Tests identisch
  — die Umsetzung ist eine reine Verschiebung des bestehenden Kettenkerns
  in eine eigene, wiederverwendbare Funktion, keine Verhaltensänderung an
  der automatischen Erkennung selbst.
- Alles auf Deutsch (Kommentare mit umschriebenen Umlauten, deutsche
  Variablennamen), siehe CLAUDE.md.

## Review Focus

- **Zwei fast gleichzeitige echte Anlässe** (ein automatisch erkanntes
  Problem und ein angenommener Vorschlag innerhalb weniger Sekunden) —
  ein Nutzer würde erwarten, dass nie zwei Claude-Code-Sessions parallel
  laufen, egal welche Kombination von Auslösern. Test in Task 1.
- **Ein abgelehnter zweiter Aufruf verliert seinen Fund nicht spurlos** —
  bei `bearbeiteProblem`s Reentrancy-Ablehnung darf kein Gedächtnis-
  Eintrag ins Leere laufen oder eine bestehende `istBekannt()`-Sperre
  auslösen, die den Fund für 14 Tage verschluckt. Task 1 prüft, dass der
  abgelehnte zweite Aufruf `gedaechtnis.neuerEintrag` gar nicht erst
  aufruft.
- **Gate 1 darf durch diese Änderung nicht plötzlich Code schreiben** —
  ein Leser könnte befürchten, dass die neue Verdrahtung versehentlich
  auch die rein lesende Anfrage-Session (Gate 1) an `bearbeiteProblem`
  anschließt. Task 3 bestätigt inline, dass nur der `art === 'vorschlag'`-
  Zweig geändert wird, der `art === 'anfrage'`-Zweig (Gate 1) unangetastet
  bleibt.
- **Ein abgelehnter Vorschlag (Gate 2 "nein") darf nie umgesetzt werden** —
  offensichtlich, aber genau deshalb in Task 3 explizit durch einen
  `if (istJa)`-Zweig sichtbar gemacht statt implizit vorausgesetzt.
- **Die Umsetzung darf die DM-Antwort nicht blockieren** — wie bei Gate 1
  bereits gelöst (Hintergrundaufruf mit `.catch(() => null)`, kein
  `await` im Handler) — Task 3 übernimmt exakt dasselbe Muster, keine neue
  Lösung nötig, aber ein Leser könnte übersehen, dass das hier genauso
  wichtig ist wie bei Gate 1 (Session dauert bis zu 20 Minuten).

---

## Datei-Überblick

- **Modify:** `src/selbstverbesserung.js` — `bearbeiteProblem(problem, deps)` neu, exportiert; `tick()` wird zum schlanken Aufrufer.
- **Modify:** `src/code-vorschlag.js` — neue Funktion `setzeVorschlagUm(ausstehend, opts)`.
- **Modify:** `src/selbstbeobachtung.js` — dritter Titel auf der `EIGENE_FEHLER`-Liste.
- **Modify:** `src/message-handler.js` — Gate-2-Zweig ruft bei "ja" `setzeVorschlagUm` im Hintergrund auf.
- **Modify:** `tests/selbstverbesserung.test.js` — ein neuer Testfall für die Reentrancy-Sperre (bestehende Tests bleiben unverändert, siehe Begründung in Task 1).
- **Modify:** `tests/code-vorschlag.test.js` — neue Tests für `setzeVorschlagUm`.

---

### Task 1: `bearbeiteProblem()` aus `tick()` herausziehen, Reentrancy-Sperre ergänzen

**Files:**
- Modify: `src/selbstverbesserung.js`
- Test: `tests/selbstverbesserung.test.js`

**Interfaces:**
- Consumes: nichts Neues — nutzt dieselben modul-internen Standard-Implementierungen (`beobachtungEcht`, `limitEcht`, `sessionEcht`, `benachrichtigungEcht`, `gedaechtnisEcht`) und die bestehenden modul-internen Variablen `laufendesProblem`/`laufSeit`.
- Produces: `bearbeiteProblem(problem: {titel, belege}, {limit?, session?, benachrichtigung?, gedaechtnis?}): Promise<{ok, uebersprungen?, branch?, zusammenfassung?, fehler?}>` — neu exportiert aus `src/selbstverbesserung.js`, genutzt von Task 2.

- [ ] **Step 1: Test schreiben (schlägt fehl, weil `bearbeiteProblem` noch nicht existiert)**

Füge in `tests/selbstverbesserung.test.js` **vor** `finish();` (aktuell
Zeile 157) folgenden neuen Abschnitt ein:

```js
  section('bearbeiteProblem(): zwei echte Anlaesse gleichzeitig -> der zweite wird abgelehnt');
  const { bearbeiteProblem } = require('../src/selbstverbesserung');
  let ergebnisZweiter = null;
  const gedaechtnisAufrufeZweiter = [];
  const ergebnisErster = await bearbeiteProblem(
    { titel: 'Erstes Problem', belege: [] },
    {
      limit: { darfLaufen: async () => ({ erlaubt: true }), vermerkeLauf: async () => {} },
      session: {
        starteSession: async () => {
          // Waehrend die erste Session "laeuft" (laufendesProblem ist
          // gesetzt), einen zweiten echten Anlass simulieren - egal ob der
          // in Wirklichkeit von tick() oder von einem angenommenen
          // Code-Vorschlag kaeme, bearbeiteProblem darf ihn nicht parallel
          // durchlassen.
          ergebnisZweiter = await bearbeiteProblem(
            { titel: 'Zweites Problem', belege: [] },
            {
              limit: { darfLaufen: async () => ({ erlaubt: true }), vermerkeLauf: async () => {} },
              session: { starteSession: async () => { gedaechtnisAufrufeZweiter.push('starteSession'); return { ok: true }; } },
              benachrichtigung: { benachrichtige: async () => {}, sendeAusstehende: async () => 0 },
              gedaechtnis: { neuerEintrag: async () => { gedaechtnisAufrufeZweiter.push('neuerEintrag'); return { id: 'z' }; }, vermerkeSession: async () => {} },
            },
          );
          return { ok: true, branch: 'b', zusammenfassung: 'z' };
        },
      },
      benachrichtigung: { benachrichtige: async () => {}, sendeAusstehende: async () => 0 },
      gedaechtnis: { neuerEintrag: async () => ({ id: 'e' }), vermerkeSession: async () => {} },
    },
  );
  check('Erster Aufruf laeuft normal durch', ergebnisErster.ok === true);
  check('Zweiter Aufruf sofort abgelehnt', ergebnisZweiter?.ok === false && ergebnisZweiter?.uebersprungen === true);
  check('Zweiter Aufruf legt keinen Gedaechtnis-Eintrag an', !gedaechtnisAufrufeZweiter.includes('neuerEintrag'));
  check('Zweiter Aufruf startet keine Session', !gedaechtnisAufrufeZweiter.includes('starteSession'));
  check('Nach beiden Aufrufen wieder nichts am Laufen', aktuellerLauf().laeuft === false);
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

Run: `node tests/selbstverbesserung.test.js`
Expected: FAIL — entweder ein Import-Fehler (`bearbeiteProblem` ist noch
kein Export) oder `ergebnisZweiter` bleibt `null`, weil die alte `tick()`-
Struktur die neue Funktion gar nicht kennt.

- [ ] **Step 3: `bearbeiteProblem` herausziehen und exportieren**

In `src/selbstverbesserung.js`, ersetze den kompletten Inhalt der Datei
zwischen der `aktuellerLauf()`-Funktion (endet aktuell bei Zeile 23) und
`function startSelbstverbesserung(client) {` (aktuell Zeile 121) — das
sind der Doc-Kommentar über `tick()` und die komplette `tick()`-Funktion
(aktuell Zeile 25-119) — durch:

```js
/**
 * Der eigentliche Kern: Tageslimit pruefen, Gedaechtnis-Eintrag anlegen,
 * die echte, code-schreibende Session starten, Ergebnis vermerken und
 * per DM melden. Fruehe frueher Teil von tick() - jetzt eigenstaendig,
 * weil es zwei Aufrufer gibt: tick() selbst (automatisch erkannte
 * Probleme) und ein angenommener Code-Vorschlag (siehe code-vorschlag.js,
 * setzeVorschlagUm()). Beide teilen sich dieselbe Sicherheitskette,
 * dasselbe Tageslimit und dieselbe Sperre gegen zwei gleichzeitig
 * laufende echte Sessions.
 */
async function bearbeiteProblem(problem, {
  limit = limitEcht,
  session = sessionEcht,
  benachrichtigung = benachrichtigungEcht,
  gedaechtnis = gedaechtnisEcht,
} = {}) {
  // Nur EIN Aufrufer der Kette hatte es bisher gegeben (tick() selbst,
  // schon durch die eigene laeuft-Waechtervariable in
  // startSelbstverbesserung() gegen Ueberlappung mit sich selbst
  // geschuetzt). Mit einem zweiten Aufrufer (ein angenommener
  // Code-Vorschlag) reicht das nicht mehr - diese Pruefung muss hier,
  // im gemeinsamen Kern, stehen.
  if (laufendesProblem) {
    return { ok: false, uebersprungen: true };
  }

  const stand = await limit.darfLaufen();
  if (!stand.erlaubt) {
    // Frueher: einfach return. Damit wurde derselbe Fund alle 10 Minuten neu
    // erkannt und lautlos weggeworfen - Kevin erfuhr nie, dass Ghostxx etwas
    // gesehen hat. Jetzt gibt es einen Gedaechtnis-Eintrag (Status 'offen',
    // damit istBekannt() das Nachfragen auf EINMAL begrenzt) und genau eine
    // DM. Gestartet wird nichts, also wird auch kein Lauf vermerkt.
    try {
      const { id } = await gedaechtnis.neuerEintrag(problem);
      const ergebnis = {
        ok: false,
        branch: '',
        zusammenfassung: '',
        fehler: 'Tageslimit erreicht (5/Tag) - nicht automatisch bearbeitet.',
      };
      await gedaechtnis.vermerkeSession(id, ergebnis);
      await benachrichtigung.benachrichtige({ problem, ergebnis });
    } catch (error) {
      console.error('Selbstverbesserung: Tageslimit-Meldung fehlgeschlagen:', error);
      logError('Fehler in der Selbstverbesserungs-Kette', error);
    }
    return { ok: false, fehler: 'tageslimit' };
  }

  // Ab hier haengt am Gedaechtnis-Eintrag (Status 'offen') die 14-Tage-Sperre
  // von istBekannt(): stuerzt irgendein Schritt hier ab, MUSS der Eintrag auf
  // 'ignoriert' gesetzt werden - sonst gilt ein echtes, wiederkehrendes
  // Problem 14 Tage lang lautlos als "schon bekannt" und wird nie wieder
  // gemeldet. 'abgelehnt' waere hier falsch, das blockiert genauso wie
  // 'offen' - es war aber kein echtes Ablehnen, nur ein interner Fehler.
  let id;
  try {
    ({ id } = await gedaechtnis.neuerEintrag(problem));

    // Der VERSUCH zaehlt, nicht der Erfolg - und er zaehlt, bevor er beginnt.
    // Frueher stand das am Ende der Kette: ein dauerhafter Fehler (kaputte
    // JSON-Datei o.ae.) liess damit endlos ungezaehlte 20-Minuten-Sessions
    // alle 10 Minuten laufen, ohne je das Tageslimit zu erreichen. Das ist
    // die richtige Semantik fuer einen Drosselzaehler.
    await limit.vermerkeLauf();

    let ergebnis;
    laufendesProblem = problem.titel;
    laufSeit = Date.now();
    try {
      ergebnis = await session.starteSession(problem);
    } finally {
      // Egal ob Erfolg, Fehler oder Zeitueberschreitung: die Anzeige darf
      // nicht haengen bleiben, sonst behauptet das Dashboard stundenlang
      // einen Lauf, den es nicht mehr gibt.
      laufendesProblem = null;
      laufSeit = null;
    }

    await gedaechtnis.vermerkeSession(id, ergebnis);
    await benachrichtigung.benachrichtige({ problem, ergebnis });
    return ergebnis;
  } catch (error) {
    console.error('Selbstverbesserung-Fehler in der Kette:', error);
    logError('Fehler in der Selbstverbesserungs-Kette', error);
    if (id) {
      await gedaechtnis.vermerkeEntscheidung(id, {
        status: 'ignoriert',
        grund: 'Interner Fehler waehrend der Selbstverbesserung: ' + error.message,
      });
    }
    return { ok: false, fehler: error.message };
  }
}

/**
 * Eine Runde: verstehen (Beobachter) -> lernen (Gedaechtnis pruefen,
 * Session starten) -> anwenden bleibt bei Kevin (nur Vorschlag+DM).
 *
 * Alle Abhaengigkeiten per Parameter, damit der Test keine echten
 * Prozesse/Discord-Aufrufe braucht.
 */
async function tick({
  beobachten = beobachtungEcht,
  limit = limitEcht,
  session = sessionEcht,
  benachrichtigung = benachrichtigungEcht,
  gedaechtnis = gedaechtnisEcht,
  schalterAn = istAn,
} = {}) {
  // Der Schalter steht standardmaessig auf AUS (siehe steuerung.js). Solange
  // er aus ist, passiert hier gar nichts - auch keine nachgereichten DMs.
  // Kevin schaltet ihn im Dashboard ein, wenn er die drei Handpruefungen
  // aus dem Plan gemacht hat.
  if (!schalterAn('selbstverbesserung')) return;

  await benachrichtigung.sendeAusstehende();

  const problem = (await beobachten.crashSchleifeErkannt())
    || (await beobachten.erkenneProblem())
    || (await beobachten.parserFehlschlagErkannt());
  if (!problem) return;

  await bearbeiteProblem(problem, { limit, session, benachrichtigung, gedaechtnis });
}
```

**Wichtig:** das ist eine reine Verschiebung des bestehenden Codes
(jede Zeile davon existiert heute schon in `tick()`) plus genau EINE neue
Zeile (die `if (laufendesProblem) { return {...}; }`-Sperre ganz am
Anfang von `bearbeiteProblem`) plus zwei geänderte Rückgabewerte im
Tageslimit-Zweig und im catch-Block (`return {ok:false, ...}` statt
implizitem `return;` — nötig, damit `bearbeiteProblem`s Rückgabewert für
Task 2 auswertbar ist; `tick()` selbst wertet den Rückgabewert nicht aus
und verhält sich dadurch nach außen identisch zu vorher).

Ergänze `module.exports` (aktuell Zeile 154-158) um `bearbeiteProblem`:

```js
module.exports = {
  aktuellerLauf,
  bearbeiteProblem,
  startSelbstverbesserung,
  tick,
};
```

- [ ] **Step 4: Test laufen lassen, Erfolg bestätigen**

Run: `node tests/selbstverbesserung.test.js`
Expected: PASS — alle Checks `OK`, inklusive des neuen Abschnitts UND
aller bestehenden Abschnitte (die bestehenden `tick()`-Tests brauchen
keine Änderung: `tick()` reicht `limit`/`session`/`benachrichtigung`/
`gedaechtnis` unverändert an `bearbeiteProblem` durch, jeder bestehende
Test bleibt also gültig).

- [ ] **Step 5: Ganze Testsuite laufen lassen**

Run: `npm test`
Expected: PASS — alle 54 Testdateien grün.

- [ ] **Step 6: Commit**

```bash
git add src/selbstverbesserung.js tests/selbstverbesserung.test.js
git commit -m "Selbstverbesserung: bearbeiteProblem() als eigenstaendige Funktion

Der bisherige Kern von tick() (Tageslimit, Gedaechtnis, Session, DM) ist
jetzt eine eigene, exportierte Funktion - reine Verschiebung, plus eine
neue Sperre gegen zwei gleichzeitig laufende echte Sessions, noetig weil
es ab jetzt einen zweiten Aufrufer gibt (angenommene Code-Vorschlaege,
folgt in den naechsten Tasks). Noch nicht angebunden."
```

---

### Task 2: `setzeVorschlagUm()` in `code-vorschlag.js`

**Files:**
- Modify: `src/code-vorschlag.js`
- Modify: `src/selbstbeobachtung.js` (EIGENE_FEHLER-Liste, dritter Titel)
- Test: `tests/code-vorschlag.test.js`

**Interfaces:**
- Consumes: `bearbeiteProblem(problem, deps): Promise<{ok, uebersprungen?, ...}>` aus Task 1 (`./selbstverbesserung`).
- Produces: `setzeVorschlagUm(ausstehend: {datei, vorschlag, gesendetAm}, {bearbeiteProblem?}): Promise<void>` — neu exportiert, genutzt von Task 3.

- [ ] **Step 1: Test schreiben (schlägt fehl)**

Füge in `tests/code-vorschlag.test.js` einen neuen Abschnitt ein (nach
den bestehenden `vermerkeEntscheidung`-Tests ist ein guter Platz, muss
aber vor `temp.cleanup(); finish();` stehen):

```js
  section('setzeVorschlagUm: baut aus dem Vorschlag ein problem-Objekt und ruft bearbeiteProblem auf');
  const aufrufeUmsetzen = [];
  await codeVorschlag.setzeVorschlagUm(
    { datei: 'src/archiver.js', vorschlag: 'Testabdeckung fuer pruneEvents ergaenzen.', gesendetAm: '2026-09-30T10:00:00.000Z' },
    {
      bearbeiteProblem: async (problem) => {
        aufrufeUmsetzen.push(problem);
        return { ok: true, branch: 'b', zusammenfassung: 'z' };
      },
    },
  );
  equal('genau ein Aufruf', aufrufeUmsetzen.length, 1);
  check('Titel nennt die Datei', aufrufeUmsetzen[0].titel.includes('src/archiver.js'));
  equal('Beleg enthaelt den Vorschlagstext als Grund', aufrufeUmsetzen[0].belege[0].grund, 'Testabdeckung fuer pruneEvents ergaenzen.');
  equal('Beleg-Zeitpunkt ist der Versandzeitpunkt', aufrufeUmsetzen[0].belege[0].zeit, '2026-09-30T10:00:00.000Z');

  section('setzeVorschlagUm: wirft nie, auch wenn bearbeiteProblem wirft');
  let hatGeworfen = false;
  try {
    await codeVorschlag.setzeVorschlagUm(
      { datei: 'src/xyz.js', vorschlag: 'x', gesendetAm: '2026-09-30T10:00:00.000Z' },
      { bearbeiteProblem: async () => { throw new Error('kaputt'); } },
    );
  } catch {
    hatGeworfen = true;
  }
  check('setzeVorschlagUm faengt Fehler intern ab', !hatGeworfen);
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

Run: `node tests/code-vorschlag.test.js`
Expected: FAIL — `codeVorschlag.setzeVorschlagUm is not a function`

- [ ] **Step 3: Funktion implementieren**

In `src/code-vorschlag.js`, ergänze den Import (aktuell Zeile 8):

```js
const { aktuellerLauf, bearbeiteProblem: bearbeiteProblemEcht } = require('./selbstverbesserung');
```

(ersetzt die bisherige Zeile `const { aktuellerLauf } = require('./selbstverbesserung');`)

Füge **nach** der bestehenden `vermerkeEntscheidung()`-Funktion (endet
aktuell bei Zeile 205, direkt vor `async function tick() {`) folgende neue
Funktion ein:

```js
/**
 * Kevin hat "ja" zum fertigen Vorschlag (Gate 2) gesagt: das setzt ihn
 * jetzt tatsaechlich um, ueber dieselbe gehaertete Kette wie ein
 * automatisch erkanntes Problem (Tabu-Pfade, Tests, Branch, Push,
 * geteiltes 5/Tag-Limit). Der Vorschlagstext wird dabei zum "Beleg" -
 * bearbeiteProblem() kennt den Unterschied zwischen "Auslöser war ein
 * echter Fehler" und "Auslöser war ein angenommener Vorschlag" nicht,
 * es ist fuer sie einfach ein problem-Objekt. Wirft nie - Aufrufer
 * (message-handler.js) ruft das per .catch(() => null) im Hintergrund auf.
 */
async function setzeVorschlagUm(ausstehend, { bearbeiteProblem = bearbeiteProblemEcht } = {}) {
  try {
    await bearbeiteProblem({
      titel: `Vorschlag umsetzen: ${ausstehend.datei}`,
      belege: [{ zeit: ausstehend.gesendetAm, grund: ausstehend.vorschlag }],
    });
  } catch (error) {
    console.error('Code-Vorschlag (Umsetzung) fehlgeschlagen:', error.message);
    logError('Fehler beim Code-Vorschlag (Umsetzung)', error);
  }
}
```

Ergänze `module.exports` (aktuell Zeile 239-252) um `setzeVorschlagUm`:

```js
module.exports = {
  ANFRAGE_ABSTAND_MS,
  darfFragen,
  holeAusstehend,
  laeuftGerade,
  naechsteDatei,
  sendeAnfrage,
  setClient,
  setzeVorschlagUm,
  startCodeVorschlag,
  starteUndSendeVorschlag,
  vermerkeAbgelehnteAnfrage,
  vermerkeEntscheidung,
  werteAntwortAus,
};
```

**Zusätzliche Änderung in `src/selbstbeobachtung.js`:** die neue
`logError()`-Titelzeile `'Fehler beim Code-Vorschlag (Umsetzung)'` ist
eine dritte eigene Fehlerquelle dieses Features (neben den beiden
bestehenden, bereits auf der `EIGENE_FEHLER`-Liste stehenden Titeln) —
ohne sie könnte ein wiederholter interner Fehler bei der
Vorschlags-Umsetzung selbst als "wiederkehrendes Problem" erkannt werden
und eine echte Reparatur-Session gegen dieses Feature auslösen (derselbe
Rückkopplungs-Fall, den die Liste verhindern soll). Ändere in
`src/selbstbeobachtung.js` (aktuell Zeile 24-33):

```js
const EIGENE_FEHLER = [
  'Fehler in der Selbstverbesserungs-Kette',
  'Fehler in der Selbstverbesserung',
  // Code-Vorschlaege (src/code-vorschlag.js) sind derselbe Mechanismus mit
  // demselben Risiko: ohne diese beiden Titel wuerden wiederholte eigene
  // Fehler beim Vorschlagen eine echte, code-schreibende Session gegen sich
  // selbst ausloesen - genau das, wovor diese Liste schon die echte
  // Selbstverbesserung schuetzt.
  'Fehler beim Code-Vorschlag',
  'Fehler beim Code-Vorschlag (Session)',
];
```

zu:

```js
const EIGENE_FEHLER = [
  'Fehler in der Selbstverbesserungs-Kette',
  'Fehler in der Selbstverbesserung',
  // Code-Vorschlaege (src/code-vorschlag.js) sind derselbe Mechanismus mit
  // demselben Risiko: ohne diese Titel wuerden wiederholte eigene Fehler
  // beim Vorschlagen oder beim Umsetzen eine echte, code-schreibende
  // Session gegen sich selbst ausloesen - genau das, wovor diese Liste
  // schon die echte Selbstverbesserung schuetzt.
  'Fehler beim Code-Vorschlag',
  'Fehler beim Code-Vorschlag (Session)',
  'Fehler beim Code-Vorschlag (Umsetzung)',
];
```

- [ ] **Step 4: Test laufen lassen, Erfolg bestätigen**

Run: `node tests/code-vorschlag.test.js`
Expected: PASS — alle Checks `OK`.

- [ ] **Step 5: Ganze Testsuite laufen lassen**

Run: `npm test`
Expected: PASS — alle 54 Testdateien grün.

- [ ] **Step 6: Commit**

```bash
git add src/code-vorschlag.js src/selbstbeobachtung.js tests/code-vorschlag.test.js
git commit -m "Code-Vorschlag: setzeVorschlagUm() ruft die echte Kette auf

Baut aus einem angenommenen Vorschlag ein problem-Objekt und reicht es an
bearbeiteProblem() weiter - dieselbe gehaertete Kette wie bei automatisch
erkannten Problemen. Dritter EIGENE_FEHLER-Eintrag ergaenzt. Noch nicht
angebunden - folgt in Task 3."
```

---

### Task 3: Gate 2 "Ja" in `message-handler.js` löst die Umsetzung aus

**Files:**
- Modify: `src/message-handler.js`

**Interfaces:**
- Consumes: `setzeVorschlagUm(ausstehend, opts): Promise<void>` aus Task 2 (`./code-vorschlag`, bereits als `codeVorschlag` importiert).
- Produces: nichts Neues — Endpunkt der Kette.

**Hinweis zum Testen:** `message-handler.js` hat keine eigene Testdatei
in diesem Projekt (siehe frühere Erweiterungen desselben Blocks). Dieser
Task wird über einen Syntax-Check und die volle Testsuite verifiziert.

- [ ] **Step 1: Gate-2-Zweig ändern**

Suche in `src/message-handler.js` den bestehenden Block (aktuell Zeile
689-691):

```js
      await codeVorschlag.vermerkeEntscheidung(istJa ? 'angenommen' : 'abgelehnt');
      await reply(message, istJa ? 'Gemerkt, danke.' : 'Auch gut, verworfen.');
      return;
```

Ersetze durch:

```js
      await codeVorschlag.vermerkeEntscheidung(istJa ? 'angenommen' : 'abgelehnt');
      if (istJa) {
        // Setzt den Vorschlag ueber dieselbe echte Kette um wie ein
        // automatisch erkanntes Problem (siehe selbstverbesserung.js,
        // bearbeiteProblem()) - laeuft bis zu 20 Minuten, deshalb wie bei
        // Gate 1 im Hintergrund, die DM-Antwort darf nicht darauf warten.
        await reply(message, 'Gemerkt, ich setz das gleich um.');
        codeVorschlag.setzeVorschlagUm(ausstehend).catch(() => null);
      } else {
        await reply(message, 'Auch gut, verworfen.');
      }
      return;
```

**Beachte:** der `ausstehend.art === 'anfrage'`-Zweig darüber (Gate 1,
aktuell Zeile 666-687) bleibt komplett unverändert — dort löst "Ja"
weiterhin nur die rein lesende `starteUndSendeVorschlag()` aus, nie
`bearbeiteProblem`/`setzeVorschlagUm`.

- [ ] **Step 2: Syntax-Check und volle Testsuite laufen lassen**

Run: `node -c src/message-handler.js`
Expected: kein Fehler.

Run: `npm test`
Expected: PASS — alle 54 Testdateien grün.

- [ ] **Step 3: Commit**

```bash
git add src/message-handler.js
git commit -m "Code-Vorschlag: Gate-2-Ja setzt den Vorschlag jetzt um

Ein 'Ja' auf den fertigen Vorschlag startet jetzt setzeVorschlagUm() im
Hintergrund - dieselbe echte, code-schreibende Kette wie ein automatisch
erkanntes Problem, geteiltes 5/Tag-Limit. Gate 1 (darf ich schauen?)
bleibt unveraendert rein lesend."
```

---

## Nach der Umsetzung

- Live beobachten: der nächste angenommene Vorschlag sollte im Dashboard
  unter "Selbstverbesserung" auftauchen (Titel `Vorschlag umsetzen: ...`)
  und, bei Erfolg, einen echten Branch anlegen — das ist der erste echte
  End-zu-Ende-Beweis für diese Erweiterung.
