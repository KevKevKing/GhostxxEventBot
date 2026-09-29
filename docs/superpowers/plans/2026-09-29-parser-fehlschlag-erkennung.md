# Selbstverbesserung: Parser-Fehlschläge erkennen — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ghostxx erkennt zusätzlich zu Absturzschleifen und Fehler-Logs eine dritte Art von Problem: wiederholte Fälle, in denen der feste Parser eine Chat-Nachricht nicht versteht und das Sprachmodell raten muss.

**Architecture:** Ein neuer, eigener Verlauf (analog zum bestehenden Fehler-Verlauf in `selbstbeobachtung.js`, aber bewusst eine eigene Datei) sammelt Fälle, in denen das Modell statt des Parsers eine Absicht geliefert hat. Eine neue Erkennungsfunktion gruppiert diese nach Aktionsart und meldet ab 3 Treffern in 2 Stunden einen Fund — mit exakt derselben Rückgabeform wie die bestehenden zwei Quellen. `tick()` in `selbstverbesserung.js` bekommt einen dritten `||`-Zweig; alles danach (Gedächtnis, Tageslimit, Session, DM) bleibt unverändert.

**Tech Stack:** Node.js, kein Framework, eigener Test-Läufer (`tests/lib.js`), keine neuen Abhängigkeiten.

**Spec:** `docs/superpowers/specs/2026-09-29-parser-fehlschlag-erkennung-design.md`

## Global Constraints

- Bewusst **kein** Text-Ähnlichkeits-Clustering — Gruppierung nur nach Aktionsart (`swap`/`add`/`remove`/`list`).
- Bewusst **keine** Änderung an `intent-parser.js` selbst und **keine** Änderung am Modell-Fallback-Verhalten (das Modell darf weiter raten und ausführen, mit Undo-Knopf).
- Gleiche Schwelle/Fenster wie die bestehende Fehler-Erkennung: 3 Treffer in 2 Stunden (`SCHWELLE`, `FENSTER_MS` in `selbstbeobachtung.js`).
- Neuer Verlauf bewusst als **eigene, duplizierte** kleine Funktionsgruppe statt Refactor der bestehenden `ladeVerlauf`/`speichereVerlauf`/`bereinigt`-Funktionen: die bestehende Absturz-/Fehler-Erkennung ist bereits real im Einsatz getestet, ein gemeinsamer Code-Pfad wäre ein unnötiges Risiko für sie gewesen (siehe "Offene Punkte" in der Spec).
- Alles auf Deutsch (Texte, Kommentare mit umschriebenen Umlauten, Variablennamen), siehe CLAUDE.md.

---

## Datei-Überblick

- **Modify:** `src/selbstbeobachtung.js` — neue Funktionen `vermerkeModellFallback(aktion)` und `parserFehlschlagErkannt()`, neuer eigener Verlauf.
- **Modify:** `src/message-handler.js` — ein neuer Aufruf an der Stelle, wo heute nur `console.log('Absicht vom Modell ...')` steht.
- **Modify:** `src/selbstverbesserung.js` — `tick()` bekommt einen dritten `||`-Zweig.
- **Modify:** `tests/selbstbeobachtung.test.js` — neue Testfälle für die neuen Funktionen.
- **Modify:** `tests/selbstverbesserung.test.js` — ein neuer Testfall für den dritten Zweig.

---

### Task 1: Neue Erkennungsquelle in `selbstbeobachtung.js`

**Files:**
- Modify: `src/selbstbeobachtung.js`
- Test: `tests/selbstbeobachtung.test.js`

**Interfaces:**
- Consumes: `bereinigt(eintraege)` (bestehende Funktion, Zeile 42 in `src/selbstbeobachtung.js`), `SCHWELLE`/`FENSTER_MS` (bestehende Konstanten), `istBekannt`/`signatur` aus `../selbstverbesserung-gedaechtnis` (bereits importiert), `config.dataDir` aus `./config` (bereits importiert), `writeFileAtomic` aus `./atomic-write` (bereits importiert).
- Produces: `vermerkeModellFallback(aktion: string): Promise<void>` und `parserFehlschlagErkannt(): Promise<{titel: string, belege: Array<{aktion: string, zeit: string}>} | null>` — beide neu exportiert aus `src/selbstbeobachtung.js`, genutzt von Task 2 und Task 3.

- [ ] **Step 1: Test schreiben (schlägt fehl, weil die Funktionen noch nicht existieren)**

Füge in `tests/selbstbeobachtung.test.js` **vor** `temp.cleanup(); finish();` (also vor Zeile 112) folgende neue Abschnitte ein:

```js
  section('Parser-Fehlschlaege: kein Problem ohne Wiederholung');
  await beobachtung.vermerkeModellFallback('swap');
  check('Einzelner Fallback ergibt kein Problem', (await beobachtung.parserFehlschlagErkannt()) === null);

  section('Parser-Fehlschlaege: drei gleiche Aktionen ergeben ein Problem');
  await beobachtung.vermerkeModellFallback('swap');
  await beobachtung.vermerkeModellFallback('swap');
  const parserProblem = await beobachtung.parserFehlschlagErkannt();
  check('Problem erkannt', parserProblem?.titel === 'Parser erkennt "swap" wiederholt nicht');
  check('Belege gesammelt', parserProblem?.belege?.length >= 3);

  section('Parser-Fehlschlaege: bereits bekanntes Problem wird nicht erneut gemeldet');
  await gedaechtnis.neuerEintrag({ titel: parserProblem.titel, belege: parserProblem.belege });
  check('Kein erneuter Fund', (await beobachtung.parserFehlschlagErkannt()) === null);

  section('Parser-Fehlschlaege: andere Aktionen zaehlen getrennt und brauchen eigene Wiederholung');
  await beobachtung.vermerkeModellFallback('add');
  await beobachtung.vermerkeModellFallback('add');
  check('Zwei "add"-Fallbacks reichen noch nicht', (await beobachtung.parserFehlschlagErkannt()) === null);
```

`gedaechtnis` ist in dieser Datei bereits als lokale Variable vorhanden (siehe Zeile 52, `const gedaechtnis = require('../src/selbstverbesserung-gedaechtnis');`) — nicht erneut deklarieren, nur weiterverwenden.

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

Run: `node tests/selbstbeobachtung.test.js`
Expected: FAIL — `beobachtung.vermerkeModellFallback is not a function`

- [ ] **Step 3: Funktionen implementieren**

In `src/selbstbeobachtung.js`, füge **nach** der bestehenden `crashSchleifeErkannt()`-Funktion (nach Zeile 142, vor `module.exports`) Folgendes ein:

```js
// Zweiter, eigener Verlauf fuer Parser-Fehlschlaege - bewusst getrennt vom
// Fehler-Verlauf oben. Andere Art von Eintrag (kein echter Fehler, sondern
// ein Fall, in dem das Modell fuer den festen Parser einspringen musste),
// eigene Aufbewahrung. Absichtlich als eigene, kleine Funktionsgruppe
// dupliziert statt die obigen Funktionen zu parametrisieren: die
// Fehler-/Absturz-Erkennung oben ist bereits real im Einsatz getestet, ein
// gemeinsamer Code-Pfad haette jede Aenderung hier zum Risiko fuer sie
// gemacht.
const fallbackDatei = path.join(config.dataDir, 'selbstbeobachtung-fallback.json');
let fallbackVerlauf = null;
let fallbackLadenPromise = null;

async function ladeFallbackVerlauf() {
  if (fallbackVerlauf) return fallbackVerlauf;
  if (!fallbackLadenPromise) {
    fallbackLadenPromise = (async () => {
      let geladen;
      try {
        const roh = JSON.parse(await fs.readFile(fallbackDatei, 'utf8'));
        geladen = Array.isArray(roh.eintraege) ? roh.eintraege : [];
      } catch {
        geladen = [];
      }
      fallbackVerlauf = bereinigt(geladen);
      return fallbackVerlauf;
    })();
  }
  return fallbackLadenPromise;
}

async function speichereFallbackVerlauf() {
  fallbackVerlauf = bereinigt(fallbackVerlauf);
  await fs.mkdir(config.dataDir, { recursive: true });
  await writeFileAtomic(fallbackDatei, JSON.stringify({ eintraege: fallbackVerlauf }, null, 2));
}

/**
 * Vermerkt, dass der feste Parser eine Nachricht nicht erkannt hat und das
 * Modell stattdessen eine Absicht geliefert hat (siehe message-handler.js,
 * Stelle "Absicht vom Modell"). Der Aufrufer haengt selbst ein .catch() an -
 * das Vermerken darf den Chat-Fluss nie aufhalten oder abbrechen lassen.
 */
async function vermerkeModellFallback(aktion) {
  const liste = await ladeFallbackVerlauf();
  liste.push({ aktion, zeit: new Date().toISOString() });
  await speichereFallbackVerlauf();
}

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

Und ergänze `module.exports` (aktuell Zeile 144-148) um die beiden neuen Funktionen:

```js
module.exports = {
  crashSchleifeErkannt,
  erkenneProblem,
  parserFehlschlagErkannt,
  registriereBeobachtung,
  vermerkeModellFallback,
};
```

- [ ] **Step 4: Test laufen lassen, Erfolg bestätigen**

Run: `node tests/selbstbeobachtung.test.js`
Expected: PASS — alle Checks `OK`, inklusive der vier neuen Abschnitte.

- [ ] **Step 5: Ganze Testsuite laufen lassen (Regressionscheck für den unveränderten Teil der Datei)**

Run: `npm test`
Expected: PASS — alle 53 (nach diesem Task weiterhin 53, keine neue Datei) Testdateien grün.

- [ ] **Step 6: Commit**

```bash
git add src/selbstbeobachtung.js tests/selbstbeobachtung.test.js
git commit -m "Selbstbeobachtung: neue Erkennungsquelle fuer Parser-Fehlschlaege

Eigener Verlauf (selbstbeobachtung-fallback.json), gruppiert nach
Aktionsart, gleiche Schwelle/Fenster wie die bestehende Fehler-
Erkennung. Noch nicht angebunden - folgt in den naechsten Tasks."
```

---

### Task 2: Fallback-Fall in `message-handler.js` vermerken

**Files:**
- Modify: `src/message-handler.js`

**Interfaces:**
- Consumes: `vermerkeModellFallback(aktion: string): Promise<void>` aus Task 1 (`./selbstbeobachtung`).
- Produces: nichts Neues für andere Tasks — reiner Aufruf-Punkt.

**Hinweis zum Testen:** `message-handler.js` hat in diesem Projekt keine eigene Testdatei (es gibt kein `tests/message-handler.test.js`) — die Datei ist eng an einen echten Discord-Client gekoppelt und wird, wie auch andere Discord-gebundene Module (z. B. `dashboard.js`), nicht mit dem eigenen Test-Läufer unit-getestet. Dieser Task hat deshalb keinen automatisierten Test-Schritt; die Änderung ist eine einzelne, durch `.catch()` abgesicherte Zeile und wird nach dem Merge live beobachtet (siehe Step 3).

- [ ] **Step 1: Import ergänzen**

In `src/message-handler.js`, suche die bestehende Import-Zeile für `intent-parser` (Zeile 20: `const { looksLikeCommand } = require('./intent-parser');`) und füge direkt danach eine neue Zeile ein:

```js
const { vermerkeModellFallback } = require('./selbstbeobachtung');
```

- [ ] **Step 2: Aufruf an der Fallback-Stelle einfügen**

Suche in `src/message-handler.js` (aktuell um Zeile 860-863):

```js
  if (result.intent) {
    console.log(`Absicht vom Modell (${result.model}): ${JSON.stringify(result.intent)}`);
    await runIntent(message, client, result.intent, context);
    return;
  }
```

Ersetze durch:

```js
  if (result.intent) {
    console.log(`Absicht vom Modell (${result.model}): ${JSON.stringify(result.intent)}`);
    await vermerkeModellFallback(result.intent.action).catch(() => null);
    await runIntent(message, client, result.intent, context);
    return;
  }
```

- [ ] **Step 3: Syntax-Check und volle Testsuite laufen lassen**

Run: `node -c src/message-handler.js`
Expected: kein Fehler (reiner Syntax-Check, da keine dedizierten Tests existieren).

Run: `npm test`
Expected: PASS — alle 53 Testdateien grün (message-handler.js wird indirekt von keinem Test importiert, das ist also ein reiner Sicherheitscheck, dass nichts anderes kaputtgegangen ist).

- [ ] **Step 4: Commit**

```bash
git add src/message-handler.js
git commit -m "message-handler: Parser-Fehlschlag beim Modell-Fallback vermerken

Genau die Stelle, an der heute nur geloggt wird, dass der Parser eine
Nachricht nicht erkannt hat und das Modell raten musste - jetzt zusaetzlich
per selbstbeobachtung.vermerkeModellFallback() gezaehlt."
```

---

### Task 3: Dritte Erkennungsquelle in `tick()` einspeisen

**Files:**
- Modify: `src/selbstverbesserung.js`
- Test: `tests/selbstverbesserung.test.js`

**Interfaces:**
- Consumes: `parserFehlschlagErkannt(): Promise<{titel, belege} | null>` aus Task 1, über das bestehende `beobachten`-Parameterobjekt von `tick()` (Default: `beobachtungEcht`, also `require('./selbstbeobachtung')`).
- Produces: nichts Neues für andere Tasks — Endpunkt der Kette.

- [ ] **Step 1: Test schreiben (schlägt fehl)**

Füge in `tests/selbstverbesserung.test.js` **vor** `finish();` (aktuell Zeile 139) folgenden neuen Abschnitt ein:

```js
  section('Kein Fehler/Absturz, aber Parser-Fund -> volle Kette laeuft trotzdem');
  const aufrufe5 = [];
  await tick({
    schalterAn: () => true,
    beobachten: {
      erkenneProblem: async () => null,
      crashSchleifeErkannt: async () => null,
      parserFehlschlagErkannt: async () => ({ titel: 'Parser erkennt "swap" wiederholt nicht', belege: [] }),
    },
    limit: { darfLaufen: async () => ({ erlaubt: true }), vermerkeLauf: async () => aufrufe5.push('vermerkeLauf') },
    session: { starteSession: async (problem) => { aufrufe5.push(`starteSession:${problem.titel}`); return { ok: true, branch: 'b', zusammenfassung: 'z' }; } },
    benachrichtigung: { benachrichtige: async () => aufrufe5.push('benachrichtige'), sendeAusstehende: async () => 0 },
    gedaechtnis: { neuerEintrag: async () => { aufrufe5.push('neuerEintrag'); return { id: '77' }; }, vermerkeSession: async (id) => aufrufe5.push(`vermerkeSession:${id}`) },
  });
  check('Dritte Quelle wird abgefragt und ausgeloest', aufrufe5.includes('starteSession:Parser erkennt "swap" wiederholt nicht'));
  check('Laeuft durch dieselbe Kette wie die anderen beiden Quellen', aufrufe5.includes('neuerEintrag') && aufrufe5.includes('benachrichtige'));
```

Beachte: alle bisherigen `beobachten`-Objekte in dieser Datei (Zeilen 9-11, 28, 40, 56, 71, 86, 113, 131) haben **kein** `parserFehlschlagErkannt` — die müssen in Step 3 alle ergänzt werden, sonst wirft `tick()` dort `beobachten.parserFehlschlagErkannt is not a function`.

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

Run: `node tests/selbstverbesserung.test.js`
Expected: FAIL — entweder der neue Check schlägt fehl (weil `tick()` die dritte Quelle noch nicht abfragt) oder ein `TypeError`, je nachdem in welcher Reihenfolge die folgenden Schritte gemacht werden. Bei einem `TypeError` aus einem der **bestehenden** Abschnitte: das ist erwartet, siehe Step 3.

- [ ] **Step 3: `tick()` erweitern UND alle bestehenden Test-Objekte ergänzen**

In `src/selbstverbesserung.js`, ändere (aktuell Zeile 48):

```js
  const problem = (await beobachten.crashSchleifeErkannt()) || (await beobachten.erkenneProblem());
```

zu:

```js
  const problem = (await beobachten.crashSchleifeErkannt())
    || (await beobachten.erkenneProblem())
    || (await beobachten.parserFehlschlagErkannt());
```

Ergänze danach in **jedem** bestehenden `beobachten: { ... }`-Objekt in `tests/selbstverbesserung.test.js` (alle bis auf den in Step 1 neu hinzugefügten, der ihn schon hat) ein `parserFehlschlagErkannt: async () => null,` — z. B. wird aus:

```js
    beobachten: { erkenneProblem: async () => null, crashSchleifeErkannt: async () => null },
```

Dies:

```js
    beobachten: { erkenneProblem: async () => null, crashSchleifeErkannt: async () => null, parserFehlschlagErkannt: async () => null },
```

Das betrifft jedes Vorkommen von `beobachten: {` in der Datei außer dem in Step 1 ergänzten.

- [ ] **Step 4: Test laufen lassen, Erfolg bestätigen**

Run: `node tests/selbstverbesserung.test.js`
Expected: PASS — alle Checks `OK`, inklusive des neuen Abschnitts.

- [ ] **Step 5: Ganze Testsuite laufen lassen**

Run: `npm test`
Expected: PASS — alle 53 Testdateien grün.

- [ ] **Step 6: Commit**

```bash
git add src/selbstverbesserung.js tests/selbstverbesserung.test.js
git commit -m "Selbstverbesserung: dritte Erkennungsquelle (Parser-Fehlschlaege) angebunden

tick() fragt jetzt zusaetzlich parserFehlschlagErkannt() ab, gleiche Kette
wie bei den anderen beiden Quellen (Gedaechtnis, Tageslimit, Session, DM) -
keine neue Verzweigung noetig."
```

---

## Nach der Umsetzung

- Live beobachten, ob im Dashboard ("Selbstverbesserung"-Kachel) irgendwann ein Fund mit dem Titel `Parser erkennt "..." wiederholt nicht` auftaucht — das ist der erste echte End-to-End-Beweis, dass die neue Quelle funktioniert (analog zur bereits gemachten Handprüfung für die ursprüngliche Selbstverbesserung).
- Die beiden zurückgestellten Signale (stille Fehlvermutungen, unlesbare Logbuch-Bilder) sind eigene, spätere Specs — nicht Teil dieses Plans.
