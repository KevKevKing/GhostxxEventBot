# Sprachsteuerung Baustein 2 (Programme starten) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Kevin kann per Sprache ("Ghost, starte Valorant") ein Programm/Spiel
von einer festen, selbst gepflegten Liste starten.

**Architecture:** Ein neuer, fester Text-Parser (kein Sprachmodell) prüft den
von Whisper erkannten Text auf ein Start-Wort + einen Namen aus einer
JSON-Liste. Läuft in `verarbeiteAeusserung()` VOR dem Ollama-Aufruf. Trifft
er zu, wird das Programm gestartet und Ollama gar nicht erst gefragt.

**Tech Stack:** Node.js (CommonJS, kein Framework), `node:child_process` für
den Programmstart, JSON-Datei für die Liste - identische Konventionen wie
die restliche `sprachsteuerung/`.

**Spec:** `docs/superpowers/specs/2026-09-26-sprachsteuerung-programme-starten-design.md`

## Global Constraints

- `sprachsteuerung/` importiert NIE etwas aus `src/` oder `tests/` des
  Haupt-Bots, und umgekehrt - komplett eigenständiger Code.
- Jede neue Funktion, die von außen kommende/unsichere Eingaben verarbeitet
  oder einen Prozess startet, muss die ganze Funktion in try/catch wrappen
  und darf NIE werfen - Rückgabe immer `{ok, grund}` bzw. `{ok, ...}`, wie
  in `sprich.js`/`hoere-zu.js`/`ollama-client.js` bereits durchgehend so
  gemacht.
- Gesprochene Fehlermeldungen kommen ausschließlich aus
  `feste-antworten.js` (`textFuer(grund)`) - nie vom Sprachmodell erfunden.
- Kein unbekannter Programmname wird geraten - nur exakte Treffer aus der
  Liste (Groß-/Kleinschreibung egal) zählen als Treffer.
- Alle neuen reinen Funktionen (Parser, Listen-Loader) müssen ohne echte
  Hardware/externe Prozesse automatisiert testbar sein - wie der Rest von
  Baustein 1.
- Deutsche Bezeichner, deutsche Kommentare (nur "warum", nicht "was") -
  bestehende Konvention in `sprachsteuerung/`.

---

## Datei-Übersicht

- **Neu:** `sprachsteuerung/programmliste.js` - lädt/validiert die JSON-Liste.
- **Neu:** `sprachsteuerung/programm-parser.js` - reine Texterkennung
  (Start-Wort + Name).
- **Neu:** `sprachsteuerung/programm-starter.js` - startet ein Programm
  (Datei-Pfad oder URI).
- **Neu:** `sprachsteuerung/programme.example.json` - Beispiel-Liste, im Git
  getrackt.
- **Neu:** `sprachsteuerung/tests/programmliste.test.js`
- **Neu:** `sprachsteuerung/tests/programm-parser.test.js`
- **Neu:** `sprachsteuerung/tests/programm-starter.test.js`
- **Ändern:** `sprachsteuerung/feste-antworten.js` - zwei neue `grund`-Werte.
- **Ändern:** `sprachsteuerung/tests/feste-antworten.test.js` - Tests dafür.
- **Ändern:** `sprachsteuerung/programm.js` - `verarbeiteAeusserung()` ruft
  den Parser vor Ollama auf.
- **Ändern:** `sprachsteuerung/tests/programm.test.js` - neue Fälle, plus
  `programmListe: []` bei den bestehenden Fällen ergänzt (Isolation von
  Baustein 2).
- **Ändern:** `sprachsteuerung/.env.example`, `sprachsteuerung/.env` -
  `PROGRAMMLISTE_PFAD` ergänzt.
- **Ändern:** `sprachsteuerung/.gitignore` - `programme.json` ausschließen
  (Pfade sind maschinenspezifisch, wie bei `.env`).
- **Ändern:** `sprachsteuerung/README.md` - Einrichtung dokumentiert.

---

### Task 1: Programmliste laden

**Files:**
- Create: `sprachsteuerung/programmliste.js`
- Test: `sprachsteuerung/tests/programmliste.test.js`

**Interfaces:**
- Produces: `ladeProgrammliste(pfad?: string) -> Array<{name: string, pfad: string}>`
  - Ohne Argument: liest `process.env.PROGRAMMLISTE_PFAD`.
  - Fehlende Datei, kaputtes JSON, oder JSON das kein Array ist -> `[]`
    (kein Wurf).
  - Einträge ohne string-`name`/string-`pfad` werden rausgefiltert.

- [ ] **Step 1: Write the failing test**

```js
// sprachsteuerung/tests/programmliste.test.js
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { check, equal, finish, section } = require('./lib');
const { ladeProgrammliste } = require('../programmliste');

function temporaereDatei(inhalt) {
  const pfad = path.join(os.tmpdir(), `ghostxx-programmliste-test-${Date.now()}-${Math.random()}.json`);
  fs.writeFileSync(pfad, inhalt, 'utf8');
  return pfad;
}

section('ladeProgrammliste: gueltige Liste');
(() => {
  const pfad = temporaereDatei(JSON.stringify([
    { name: 'Valorant', pfad: 'C:/Spiele/Valorant.exe' },
    { name: 'Minecraft', pfad: 'C:/Spiele/Minecraft.exe' },
  ]));
  const liste = ladeProgrammliste(pfad);
  equal('zwei Eintraege geladen', liste.length, 2);
  equal('erster Eintrag Name', liste[0].name, 'Valorant');
  fs.rmSync(pfad, { force: true });
})();

section('ladeProgrammliste: Datei existiert nicht -> leere Liste, kein Wurf');
(() => {
  let liste;
  let geworfen = false;
  try {
    liste = ladeProgrammliste('C:/diese/datei/gibt/es/nicht.json');
  } catch {
    geworfen = true;
  }
  check('kein Wurf', geworfen === false);
  equal('leere Liste', liste, []);
})();

section('ladeProgrammliste: kaputtes JSON -> leere Liste, kein Wurf');
(() => {
  const pfad = temporaereDatei('{ das ist kein json');
  let liste;
  let geworfen = false;
  try {
    liste = ladeProgrammliste(pfad);
  } catch {
    geworfen = true;
  }
  check('kein Wurf', geworfen === false);
  equal('leere Liste', liste, []);
  fs.rmSync(pfad, { force: true });
})();

section('ladeProgrammliste: JSON ist kein Array -> leere Liste');
(() => {
  const pfad = temporaereDatei(JSON.stringify({ name: 'Valorant' }));
  equal('leere Liste', ladeProgrammliste(pfad), []);
  fs.rmSync(pfad, { force: true });
})();

section('ladeProgrammliste: ungueltige Eintraege werden rausgefiltert');
(() => {
  const pfad = temporaereDatei(JSON.stringify([
    { name: 'Valorant', pfad: 'C:/x.exe' },
    { name: 'Ohne Pfad' },
    { pfad: 'C:/ohne-namen.exe' },
    'kein objekt',
    null,
  ]));
  const liste = ladeProgrammliste(pfad);
  equal('nur der gueltige Eintrag bleibt', liste.length, 1);
  equal('der gueltige Eintrag', liste[0].name, 'Valorant');
  fs.rmSync(pfad, { force: true });
})();

finish();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd sprachsteuerung && node tests/programmliste.test.js`
Expected: FAIL/Absturz - `../programmliste` existiert noch nicht (`Cannot find module`).

- [ ] **Step 3: Write minimal implementation**

```js
// sprachsteuerung/programmliste.js
const fs = require('node:fs');

// Laedt die von Kevin gepflegte Liste startbarer Programme aus einer JSON-
// Datei ({ name, pfad }-Eintraege). Bewusst synchron (kleine Datei, wird bei
// jeder Aeusserung frisch gelesen, damit Aenderungen an der Liste ohne
// Neustart wirken) und bewusst fehlertolerant: eine fehlende oder kaputte
// Datei fuehrt zu einer leeren Liste statt zu einem Absturz - dann matcht
// nie ein Programmbefehl, die Sprachsteuerung faellt einfach auf normalen
// Chat zurueck (siehe programm-parser.js).
function ladeProgrammliste(pfad = process.env.PROGRAMMLISTE_PFAD) {
  try {
    const inhalt = fs.readFileSync(pfad, 'utf8');
    const geparst = JSON.parse(inhalt);
    if (!Array.isArray(geparst)) return [];
    return geparst.filter(
      (eintrag) => eintrag
        && typeof eintrag === 'object'
        && typeof eintrag.name === 'string'
        && typeof eintrag.pfad === 'string',
    );
  } catch {
    return [];
  }
}

module.exports = { ladeProgrammliste };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd sprachsteuerung && node tests/programmliste.test.js`
Expected: `0 fehlgeschlagen`

- [ ] **Step 5: Commit**

```bash
git add sprachsteuerung/programmliste.js sprachsteuerung/tests/programmliste.test.js
git commit -m "Sprachsteuerung: Programmliste laden (Baustein 2, Task 1)"
```

---

### Task 2: Programm-Parser (Text -> Startbefehl erkennen)

**Files:**
- Create: `sprachsteuerung/programm-parser.js`
- Test: `sprachsteuerung/tests/programm-parser.test.js`

**Interfaces:**
- Consumes: `liste: Array<{name: string, pfad: string}>` (Form aus Task 1,
  aber hier nur als einfaches Array-Argument benutzt - kein Import aus
  `programmliste.js` noetig).
- Produces: `erkenneProgrammBefehl(text: string, liste: Array<{name, pfad}>) ->`
  - `{ art: 'start', eintrag: {name, pfad} }`
  - `{ art: 'unbekannt' }`
  - `{ art: 'kein_befehl' }`

- [ ] **Step 1: Write the failing test**

```js
// sprachsteuerung/tests/programm-parser.test.js
const { check, finish, section } = require('./lib');
const { erkenneProgrammBefehl } = require('../programm-parser');

const LISTE = [
  { name: 'Valorant', pfad: 'C:/Spiele/Valorant.exe' },
  { name: 'Minecraft', pfad: 'C:/Spiele/Minecraft.exe' },
];

section('erkennt einen klaren Startbefehl');
(() => {
  const ergebnis = erkenneProgrammBefehl('starte valorant', LISTE);
  check('art ist start', ergebnis.art === 'start');
  check('richtiger Eintrag', ergebnis.eintrag.name === 'Valorant');
})();

section('Gross-/Kleinschreibung spielt keine Rolle');
(() => {
  const ergebnis = erkenneProgrammBefehl('STARTE VALORANT', LISTE);
  check('art ist start', ergebnis.art === 'start');
})();

section('andere Formulierung mit demselben Startwort und Namen');
(() => {
  const ergebnis = erkenneProgrammBefehl('mach mal valorant an bitte', LISTE);
  check('art ist start', ergebnis.art === 'start');
  check('richtiger Eintrag', ergebnis.eintrag.name === 'Valorant');
})();

section('anderes Startwort ("oeffne")');
(() => {
  const ergebnis = erkenneProgrammBefehl('öffne minecraft', LISTE);
  check('art ist start', ergebnis.art === 'start');
  check('richtiger Eintrag', ergebnis.eintrag.name === 'Minecraft');
})();

section('Startwort da, aber Name nicht auf der Liste -> unbekannt');
(() => {
  const ergebnis = erkenneProgrammBefehl('starte firefox', LISTE);
  check('art ist unbekannt', ergebnis.art === 'unbekannt');
})();

section('kein Startwort -> kein_befehl (normaler Chat)');
(() => {
  const ergebnis = erkenneProgrammBefehl('wie geht es dir?', LISTE);
  check('art ist kein_befehl', ergebnis.art === 'kein_befehl');
})();

section('bekannter Sonderfall: Startwort zufaellig im Satz, kein echter Befehl -> unbekannt (siehe Spec)');
(() => {
  // Bewusst akzeptierter Sonderfall aus der Spec - dieser Test dokumentiert
  // das Verhalten, ist kein Bugreport.
  const ergebnis = erkenneProgrammBefehl('wie starte ich am besten in den tag?', LISTE);
  check('art ist unbekannt (dokumentierter Sonderfall)', ergebnis.art === 'unbekannt');
})();

section('leere Liste -> nie start, aber Startwort fuehrt zu unbekannt');
(() => {
  const ergebnis = erkenneProgrammBefehl('starte valorant', []);
  check('art ist unbekannt', ergebnis.art === 'unbekannt');
})();

finish();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd sprachsteuerung && node tests/programm-parser.test.js`
Expected: FAIL - `Cannot find module '../programm-parser'`

- [ ] **Step 3: Write minimal implementation**

```js
// sprachsteuerung/programm-parser.js

// Erkennt einen Programm-Startbefehl direkt aus dem erkannten Text - kein
// Sprachmodell noetig, ein Programmname ist eindeutig ablesbar (siehe
// CLAUDE.md: "erst ablesen, dann raten"). Liefert eines von drei
// Ergebnissen: 'start' (Startwort + bekannter Name), 'unbekannt' (Startwort
// da, aber kein bekannter Name) oder 'kein_befehl' (kein Startwort - Text
// soll normal an Ollama gehen).
//
// Bekannter, bewusst akzeptierter Sonderfall (siehe Spec): ein Satz, der
// zufaellig ein Startwort enthaelt, aber keinen Programmbefehl meint (z.B.
// "wie starte ich am besten in den tag?"), wird faelschlich als 'unbekannt'
// gewertet statt normal beantwortet. Selten genug, um hinzunehmen.
const STARTWOERTER = ['starte', 'start ', 'öffne', 'öffnen', 'mach'];

function erkenneProgrammBefehl(text, liste) {
  const klein = text.toLowerCase();
  const hatStartwort = STARTWOERTER.some((wort) => klein.includes(wort));

  if (!hatStartwort) return { art: 'kein_befehl' };

  const treffer = liste.find((eintrag) => klein.includes(eintrag.name.toLowerCase()));
  if (treffer) return { art: 'start', eintrag: treffer };

  return { art: 'unbekannt' };
}

module.exports = { erkenneProgrammBefehl };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd sprachsteuerung && node tests/programm-parser.test.js`
Expected: `0 fehlgeschlagen`

- [ ] **Step 5: Commit**

```bash
git add sprachsteuerung/programm-parser.js sprachsteuerung/tests/programm-parser.test.js
git commit -m "Sprachsteuerung: Programm-Parser (Baustein 2, Task 2)"
```

---

### Task 3: Programm-Starter (Programm tatsaechlich starten)

**Files:**
- Create: `sprachsteuerung/programm-starter.js`
- Test: `sprachsteuerung/tests/programm-starter.test.js`

**Interfaces:**
- Consumes: `eintrag: {name: string, pfad: string}` (Form aus Task 1/2).
- Produces:
  - `starteProgramm(eintrag, {ausfuehren?}) -> Promise<{ok: true} | {ok: false, grund: 'programm_fehlgeschlagen'}>`
  - `istUri(pfad: string) -> boolean` (auch exportiert, fuer Tests/Klarheit)

- [ ] **Step 1: Write the failing test**

```js
// sprachsteuerung/tests/programm-starter.test.js
const { check, finish, section } = require('./lib');
const { starteProgramm, istUri } = require('../programm-starter');

section('istUri');
(() => {
  check('URI erkannt', istUri('steam://rungameid/12345') === true);
  check('normaler Pfad nicht als URI erkannt', istUri('C:/Spiele/Valorant.exe') === false);
})();

section('Datei-Pfad wird direkt ausgefuehrt');
(async () => {
  let aufgerufenMit = null;
  const ergebnis = await starteProgramm(
    { name: 'Valorant', pfad: 'C:/Spiele/Valorant.exe' },
    { ausfuehren: async (cmd, args) => { aufgerufenMit = { cmd, args }; return { ok: true }; } },
  );
  check('ok', ergebnis.ok === true);
  check('cmd ist der Datei-Pfad direkt', aufgerufenMit.cmd === 'C:/Spiele/Valorant.exe');
})();

section('URI wird ueber "start" geoeffnet');
(async () => {
  let aufgerufenMit = null;
  const ergebnis = await starteProgramm(
    { name: 'Steam-Spiel', pfad: 'steam://rungameid/12345' },
    { ausfuehren: async (cmd, args) => { aufgerufenMit = { cmd, args }; return { ok: true }; } },
  );
  check('ok', ergebnis.ok === true);
  check('cmd ist cmd.exe', aufgerufenMit.cmd === 'cmd');
  check('args enthalten die URI', aufgerufenMit.args.includes('steam://rungameid/12345'));
})();

section('ausfuehren meldet Fehlschlag -> ok:false mit grund');
(async () => {
  const ergebnis = await starteProgramm(
    { name: 'Valorant', pfad: 'C:/Spiele/Valorant.exe' },
    { ausfuehren: async () => ({ ok: false }) },
  );
  check('nicht ok', ergebnis.ok === false);
  check('grund gesetzt', ergebnis.grund === 'programm_fehlgeschlagen');
})();

section('ausfuehren wirft synchron -> kein Absturz, ok:false');
(async () => {
  const ergebnis = await starteProgramm(
    { name: 'Valorant', pfad: 'C:/Spiele/Valorant.exe' },
    { ausfuehren: () => { throw new Error('kaputt'); } },
  );
  check('nicht ok', ergebnis.ok === false);
  check('grund gesetzt', ergebnis.grund === 'programm_fehlgeschlagen');
})();

finish();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd sprachsteuerung && node tests/programm-starter.test.js`
Expected: FAIL - `Cannot find module '../programm-starter'`

- [ ] **Step 3: Write minimal implementation**

```js
// sprachsteuerung/programm-starter.js
const { spawn } = require('node:child_process');

// Startet ein Programm/Spiel aus der Programmliste - entweder einen echten
// Datei-Pfad (.exe) direkt, oder eine URI (z.B. "steam://rungameid/...",
// fuer Spiele die ueber einen Launcher/Anti-Cheat starten muessen statt
// direkt per .exe) ueber Windows' eingebauten "start"-Befehl, der jede
// registrierte URI an das richtige Programm weiterreicht.
function istUri(pfad) {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(pfad);
}

function echtAusfuehren(cmd, args) {
  return new Promise((resolve) => {
    try {
      const p = spawn(cmd, args, { windowsHide: true, detached: true, stdio: 'ignore' });
      p.on('error', () => resolve({ ok: false }));
      p.unref();
      resolve({ ok: true });
    } catch {
      resolve({ ok: false });
    }
  });
}

// try/catch um die ganze Funktion: ausfuehren() ist von aussen injizierbar
// und darf - wie die uebrigen Module dieser Art - nie werfen, auch wenn die
// injizierte Funktion selbst synchron wirft.
async function starteProgramm(eintrag, { ausfuehren = echtAusfuehren } = {}) {
  try {
    const ergebnis = istUri(eintrag.pfad)
      ? await ausfuehren('cmd', ['/c', 'start', '""', eintrag.pfad])
      : await ausfuehren(eintrag.pfad, []);

    if (!ergebnis || !ergebnis.ok) {
      return { ok: false, grund: 'programm_fehlgeschlagen' };
    }
    return { ok: true };
  } catch {
    return { ok: false, grund: 'programm_fehlgeschlagen' };
  }
}

module.exports = { starteProgramm, istUri };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd sprachsteuerung && node tests/programm-starter.test.js`
Expected: `0 fehlgeschlagen`

- [ ] **Step 5: Commit**

```bash
git add sprachsteuerung/programm-starter.js sprachsteuerung/tests/programm-starter.test.js
git commit -m "Sprachsteuerung: Programm-Starter (Baustein 2, Task 3)"
```

---

### Task 4: Feste Antworten erweitern

**Files:**
- Modify: `sprachsteuerung/feste-antworten.js`
- Modify: `sprachsteuerung/tests/feste-antworten.test.js`

**Interfaces:**
- Produces: zwei neue `grund`-Schluessel in `textFuer()`:
  `programm_unbekannt`, `programm_fehlgeschlagen` (letzterer wird von
  `programm-starter.js` aus Task 3 zurueckgegeben).

- [ ] **Step 1: Write the failing test**

Aktuellen Inhalt von `sprachsteuerung/tests/feste-antworten.test.js` lesen
und folgende Zeilen vor dem abschliessenden `finish();`-Aufruf einfuegen:

```js
section('neue Grund-Werte fuer Baustein 2 (Programme starten)');
check('programm_unbekannt hat einen Text', textFuer('programm_unbekannt').length > 0);
check('programm_unbekannt ist nicht der Standard-Fallback', textFuer('programm_unbekannt') !== textFuer('ein-grund-den-es-nicht-gibt'));
check('programm_fehlgeschlagen hat einen Text', textFuer('programm_fehlgeschlagen').length > 0);
check('programm_fehlgeschlagen ist nicht der Standard-Fallback', textFuer('programm_fehlgeschlagen') !== textFuer('ein-grund-den-es-nicht-gibt'));
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd sprachsteuerung && node tests/feste-antworten.test.js`
Expected: FAIL - beide neuen `grund`-Werte fallen aktuell auf `STANDARD`
zurueck, `programm_unbekannt !== STANDARD`-Vergleich schlaegt fehl (die
beiden Checks mit "ist nicht der Standard-Fallback" werden FAIL zeigen, da
aktuell auch der neue Grund den Standardtext liefert und der Vergleich mit
sich selbst zwar `true` waere - **wichtig:** um das wirklich fehlschlagen zu
lassen, wird gegen `textFuer('ein-grund-den-es-nicht-gibt')` verglichen, das
IMMER der Standard-Fallback ist. Vor der Implementierung liefert
`textFuer('programm_unbekannt')` ebenfalls den Standard-Fallback, der
Vergleich `!==` schlaegt also korrekt fehl.)

- [ ] **Step 3: Write minimal implementation**

In `sprachsteuerung/feste-antworten.js` das `TEXTE`-Objekt erweitern:

```js
const TEXTE = {
  nicht_erreichbar: 'Ich bin gerade nicht erreichbar, mein Sprachmodell antwortet nicht.',
  zeitueberschreitung: 'Das dauert mir gerade zu lange, frag mich gleich nochmal.',
  timeout_ollama: 'Ich brauche gerade zu lange zum Nachdenken, versuch es gleich nochmal.',
  leer: 'Dazu fällt mir gerade nichts ein.',
  fehlgeschlagen: 'Ich habe dich leider nicht verstanden.',
  kein_text: 'Ich habe nichts verstanden, war das leise oder undeutlich?',
  piper_fehlgeschlagen: 'Ich kann das gerade nicht aussprechen.',
  wiedergabe_fehlgeschlagen: 'Ich kann gerade nicht über die Lautsprecher sprechen.',
  unerwarteter_fehler: 'Da ist unterwegs etwas schiefgelaufen.',
  programm_unbekannt: 'Das kenne ich nicht, das musst du erst zur Liste hinzufügen.',
  programm_fehlgeschlagen: 'Das hat leider nicht geklappt.',
};
```

(Rest der Datei unveraendert.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd sprachsteuerung && node tests/feste-antworten.test.js`
Expected: `0 fehlgeschlagen`

- [ ] **Step 5: Commit**

```bash
git add sprachsteuerung/feste-antworten.js sprachsteuerung/tests/feste-antworten.test.js
git commit -m "Sprachsteuerung: feste Antworten fuer Programmbefehle (Baustein 2, Task 4)"
```

---

### Task 5: In programm.js verdrahten

**Files:**
- Modify: `sprachsteuerung/programm.js`
- Modify: `sprachsteuerung/tests/programm.test.js`

**Interfaces:**
- Consumes:
  - `erkenneProgrammBefehl` aus Task 2 (`./programm-parser`)
  - `starteProgramm` aus Task 3 (`./programm-starter`)
  - `ladeProgrammliste` aus Task 1 (`./programmliste`)
  - `textFuer('programm_unbekannt')`, `textFuer('programm_fehlgeschlagen')`
    aus Task 4
- Produces: `verarbeiteAeusserung()` bekommt drei neue, optionale
  Injektions-Parameter: `erkenneProgramm`, `starteProgrammFn`,
  `programmListe` (Default: echte Implementierungen/echte Liste).

**Wichtig fuer diesen Task:** Die bestehenden 9 Testfaelle in
`programm.test.js` rufen `verarbeiteAeusserung()` ohne `programmListe` auf.
Ohne Gegenmassnahme wuerde das Default-Argument `ladeProgrammliste()` dann
versuchen, die ECHTE `PROGRAMMLISTE_PFAD`-Datei zu lesen (falls sie
zufaellig auf der Maschine existiert) - das waere eine unsichtbare
Kopplung an den Dateisystem-Zustand der Test-Maschine. Deshalb bekommen
ALLE bestehenden Aufrufe zusaetzlich `programmListe: []` in ihr
Optionen-Objekt, damit sie von Baustein 2 komplett isoliert bleiben.

- [ ] **Step 1: Write the failing tests**

Zuerst die 9 BESTEHENDEN `verarbeiteAeusserung(...)`-Aufrufe in
`sprachsteuerung/tests/programm.test.js` anpassen: bei jedem Aufruf im
Optionen-Objekt (das Objekt mit `transkribieren`/`antworten`/`sprechen`)
zusaetzlich die Zeile `programmListe: [],` ergaenzen. Beispiel fuer den
ersten Aufruf (alle anderen analog, jeweils dasselbe Muster):

```js
const ergebnis = await verarbeiteAeusserung('C:/temp/aufnahme.wav', {
  transkribieren: async () => ({ ok: true, text: 'Wie geht es dir?' }),
  antworten: async (text) => {
    check('Text kommt bei antworten() an', text === 'Wie geht es dir?');
    return { ok: true, text: 'Mir geht es gut.' };
  },
  sprechen: async (text) => { gesprochen.push(text); return { ok: true }; },
  programmListe: [],
});
```

Dann VOR dem abschliessenden `finish();`-Aufruf folgende drei neuen
Abschnitte einfuegen:

```js
section('Programmbefehl erkannt -> Programm wird gestartet, Ollama wird NICHT gefragt');
(async () => {
  let ollamaAufgerufen = false;
  let gestartetMit = null;
  const gesprochenP1 = [];
  const ergebnisP1 = await verarbeiteAeusserung('C:/temp/aufnahme.wav', {
    transkribieren: async () => ({ ok: true, text: 'Ghost, starte valorant' }),
    antworten: async () => { ollamaAufgerufen = true; return { ok: true, text: 'x' }; },
    sprechen: async (text) => { gesprochenP1.push(text); return { ok: true }; },
    programmListe: [{ name: 'Valorant', pfad: 'C:/Spiele/Valorant.exe' }],
    starteProgrammFn: async (eintrag) => { gestartetMit = eintrag; return { ok: true }; },
  });
  check('ok', ergebnisP1.ok === true);
  check('Ollama wird NICHT aufgerufen', ollamaAufgerufen === false);
  check('richtiges Programm gestartet', gestartetMit.name === 'Valorant');
  equal('Bestaetigung gesprochen', gesprochenP1[0], 'Starte Valorant.');
})();

section('Programmbefehl mit unbekanntem Namen -> feste Antwort, kein Start, kein Ollama');
(async () => {
  let ollamaAufgerufen = false;
  let starterAufgerufen = false;
  const gesprochenP2 = [];
  const ergebnisP2 = await verarbeiteAeusserung('C:/temp/aufnahme.wav', {
    transkribieren: async () => ({ ok: true, text: 'starte firefox' }),
    antworten: async () => { ollamaAufgerufen = true; return { ok: true, text: 'x' }; },
    sprechen: async (text) => { gesprochenP2.push(text); return { ok: true }; },
    programmListe: [{ name: 'Valorant', pfad: 'C:/Spiele/Valorant.exe' }],
    starteProgrammFn: async () => { starterAufgerufen = true; return { ok: true }; },
  });
  check('nicht ok', ergebnisP2.ok === false);
  check('Ollama wird NICHT aufgerufen', ollamaAufgerufen === false);
  check('Starter wird NICHT aufgerufen', starterAufgerufen === false);
  equal('feste Antwort fuer programm_unbekannt', gesprochenP2[0], require('../feste-antworten').textFuer('programm_unbekannt'));
})();

section('Programmstart schlaegt fehl -> feste Fehlerantwort');
(async () => {
  const gesprochenP3 = [];
  const ergebnisP3 = await verarbeiteAeusserung('C:/temp/aufnahme.wav', {
    transkribieren: async () => ({ ok: true, text: 'starte valorant' }),
    antworten: async () => ({ ok: true, text: 'x' }),
    sprechen: async (text) => { gesprochenP3.push(text); return { ok: true }; },
    programmListe: [{ name: 'Valorant', pfad: 'C:/Spiele/Valorant.exe' }],
    starteProgrammFn: async () => ({ ok: false, grund: 'programm_fehlgeschlagen' }),
  });
  check('nicht ok', ergebnisP3.ok === false);
  equal('feste Antwort fuer programm_fehlgeschlagen', gesprochenP3[0], require('../feste-antworten').textFuer('programm_fehlgeschlagen'));
})();

section('kein Startwort -> normaler Chat laeuft weiter wie in Baustein 1');
(async () => {
  const gesprochenP4 = [];
  const ergebnisP4 = await verarbeiteAeusserung('C:/temp/aufnahme.wav', {
    transkribieren: async () => ({ ok: true, text: 'Wie ist das Wetter?' }),
    antworten: async () => ({ ok: true, text: 'Sonnig.' }),
    sprechen: async (text) => { gesprochenP4.push(text); return { ok: true }; },
    programmListe: [{ name: 'Valorant', pfad: 'C:/Spiele/Valorant.exe' }],
  });
  check('ok', ergebnisP4.ok === true);
  equal('normale Antwort gesprochen', gesprochenP4[0], 'Sonnig.');
})();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd sprachsteuerung && node tests/programm.test.js`
Expected: FAIL - die vier neuen Abschnitte scheitern (z.B. weil
`erkenneProgrammBefehl` in `programm.js` noch nicht aufgerufen wird, Ollama
also in den ersten beiden neuen Faellen trotzdem aufgerufen wird und
`ollamaAufgerufen === false` fehlschlaegt). Die BESTEHENDEN 9 Faelle
muessen weiterhin bestehen bleiben (mit `programmListe: []` sollte sich an
ihrem Verhalten nichts aendern).

- [ ] **Step 3: Write minimal implementation**

In `sprachsteuerung/programm.js`, direkt unter den bestehenden `require`-
Zeilen ganz oben, drei neue Imports ergaenzen:

```js
const { erkenneProgrammBefehl } = require('./programm-parser');
const { starteProgramm } = require('./programm-starter');
const { ladeProgrammliste } = require('./programmliste');
```

Die Signatur von `verarbeiteAeusserung()` erweitern (bestehende Parameter
bleiben, drei neue dazu):

```js
async function verarbeiteAeusserung(wavPfad, {
  transkribieren = transkribierenEcht,
  antworten = antwortenEcht,
  sprechen = sprechenEcht,
  ollamaTimeoutMs = OLLAMA_TIMEOUT_MS,
  erkenneProgramm = erkenneProgrammBefehl,
  starteProgrammFn = starteProgramm,
  programmListe = ladeProgrammliste(),
} = {}) {
```

Direkt nach der Zeile `console.log(\`  -> verstanden: "${gehoert.text}"\`);`
und VOR der Zeile `console.log('  -> denke nach...');` folgenden Block
einfuegen:

```js
    const befehl = erkenneProgramm(gehoert.text, programmListe);
    if (befehl.art === 'start') {
      console.log(`  -> Programmbefehl erkannt: ${befehl.eintrag.name}`);
      const startErgebnis = await starteProgrammFn(befehl.eintrag);
      const text = startErgebnis.ok
        ? `Starte ${befehl.eintrag.name}.`
        : textFuer(startErgebnis.grund);
      await sprechenOhneWurf(sprechen, text);
      return { ok: startErgebnis.ok, gesagt: text };
    }
    if (befehl.art === 'unbekannt') {
      console.log('  -> Programmbefehl erkannt, aber kein bekannter Name');
      const text = textFuer('programm_unbekannt');
      await sprechenOhneWurf(sprechen, text);
      return { ok: false, gesagt: text };
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd sprachsteuerung && node tests/programm.test.js`
Expected: `0 fehlgeschlagen` (alle 13 Abschnitte: die urspruenglichen 9 plus
die 4 neuen).

Danach zusaetzlich die komplette Suite laufen lassen:
Run: `cd sprachsteuerung && npm test`
Expected: alle Testdateien gruen.

- [ ] **Step 5: Commit**

```bash
git add sprachsteuerung/programm.js sprachsteuerung/tests/programm.test.js
git commit -m "Sprachsteuerung: Programmbefehle in verarbeiteAeusserung verdrahtet (Baustein 2, Task 5)"
```

---

### Task 6: Konfiguration, Beispiel-Datei, Dokumentation

**Files:**
- Create: `sprachsteuerung/programme.example.json`
- Modify: `sprachsteuerung/.env.example`
- Modify: `sprachsteuerung/.env`
- Modify: `sprachsteuerung/.gitignore`
- Modify: `sprachsteuerung/README.md`

**Interfaces:**
- Produces: `PROGRAMMLISTE_PFAD` Umgebungsvariable, die Task 1's
  `ladeProgrammliste()` (ohne Argument) liest.

Kein TDD-Zyklus hier (reine Konfiguration/Doku, keine Logik) - nur die
Dateien anlegen/anpassen und mit `npm test` gegenpruefen, dass nichts
kaputtgeht.

- [ ] **Step 1: Beispiel-Datei anlegen**

```json
[
  { "name": "Valorant", "pfad": "C:/Riot Games/VALORANT/live/VALORANT.exe" },
  { "name": "Minecraft", "pfad": "steam://rungameid/0000000" }
]
```

Speichern als `sprachsteuerung/programme.example.json`.

- [ ] **Step 2: `.gitignore` ergaenzen**

In `sprachsteuerung/.gitignore` folgende Zeile ergaenzen (Pfade sind
maschinenspezifisch, genau wie bei `.env`):

```
programme.json
```

- [ ] **Step 3: `.env.example` ergaenzen**

In `sprachsteuerung/.env.example`, nach dem Ollama-Abschnitt, ergaenzen:

```
# Liste startbarer Programme/Spiele fuer Baustein 2 ("Ghost, starte X") -
# von Kevin selbst gepflegt, siehe programme.example.json als Vorlage.
PROGRAMMLISTE_PFAD=./programme.json
```

- [ ] **Step 4: `.env` ergaenzen**

In `sprachsteuerung/.env` dieselbe Zeile ergaenzen wie in Step 3:

```
PROGRAMMLISTE_PFAD=./programme.json
```

- [ ] **Step 5: README ergaenzen**

In `sprachsteuerung/README.md` nach dem bestehenden Einrichtungs-Abschnitt
einen neuen Abschnitt ergaenzen:

```markdown
## Baustein 2: Programme starten

"Ghost, starte <Name>" startet ein Programm/Spiel aus einer festen, von
dir gepflegten Liste - unbekannte Namen werden NICHT geraten, sondern
explizit abgelehnt.

1. `programme.example.json` nach `programme.json` kopieren.
2. Eigene Eintraege eintragen: `name` ist das gesprochene Wort, `pfad` ist
   entweder ein direkter Datei-Pfad (`.exe`) oder eine URI (z.B.
   `steam://rungameid/<ID>` fuer Spiele, die ueber Steam/einen Launcher
   starten muessen - die Rungame-ID findet man z.B. in den
   Spiel-Eigenschaften bei Steam oder online).
3. Neue Eintraege wirken sofort, kein Neustart noetig (die Liste wird bei
   jeder Aeusserung neu gelesen).

Bekannter, akzeptierter Sonderfall: ein Satz, der zufaellig ein Startwort
("starte"/"öffne"/"mach") enthaelt, aber keinen Programmbefehl meint (z.B.
"wie starte ich am besten in den Tag?"), wird faelschlich als "kenne ich
nicht" behandelt statt normal beantwortet - siehe Spec.
```

- [ ] **Step 6: Gegenpruefen, dass nichts kaputtgeht**

Run: `cd sprachsteuerung && npm test`
Expected: alle Testdateien weiterhin gruen (Konfigurationsaenderungen
beeinflussen die Tests nicht, da alle Tests `programmListe` explizit
injizieren).

- [ ] **Step 7: Commit**

```bash
git add sprachsteuerung/programme.example.json sprachsteuerung/.env.example sprachsteuerung/.env sprachsteuerung/.gitignore sprachsteuerung/README.md
git commit -m "Sprachsteuerung: Konfiguration und Doku fuer Programme starten (Baustein 2, Task 6)"
```

---

## Nach der Umsetzung (nicht Teil der automatisierten Tasks)

- **Handpruefung mit Kevin:** echten `programme.json` mit mindestens einem
  echten Programm anlegen, "Ghost, starte X" wirklich sprechen, hoeren ob
  das Programm startet und die Bestaetigung korrekt gesprochen wird. Genau
  wie bei Baustein 1 nicht automatisiert testbar (echter Prozess-Start).
- Whole-Branch-Review ueber den kompletten Diff dieses Plans, wie bei
  Baustein 1.
