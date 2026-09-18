# Sprachsteuerung Baustein 1 (Aufwachwort + freies Reden) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ein eigenständiges Node.js-Programm, mit dem Kevin per Sprache ("Ghost, ...") mit demselben lokalen Sprachmodell reden kann wie der Discord-Bot — komplett getrennt vom Bot-Prozess, sodass ein Fehler hier niemals den produktiven Bot (echte Auszahlungen für 251 Leute) beeinflussen kann.

**Architecture:** Picovoice Porcupine lauscht dauerhaft auf das Aufwachwort "Ghost" (minimale Rechenlast). Nach Erkennung nimmt dieselbe Mikrofon-Bibliothek (`pvrecorder`) die folgende Äußerung auf, bis eine einfache Lautstärke-basierte Stille-Erkennung das Ende erkennt oder ein hartes Zeitlimit greift. Ein vorkompiliertes `whisper.cpp`-Programm wandelt die Aufnahme in Text um (per `child_process`, wie das Hauptprojekt bereits externe Werkzeuge wie `nvidia-smi` einbindet). Der Text geht per HTTP direkt an dasselbe lokale Ollama wie der Bot. Die Textantwort geht durch ein vorkompiliertes `Piper`-Programm (ebenfalls per `child_process`) zurück in eine WAV-Datei, die über PowerShells `Media.SoundPlayer` abgespielt wird.

**Tech Stack:** Node.js (eigenes `package.json`, getrennt vom Bot), `@picovoice/porcupine-node` + `@picovoice/pvrecorder-node` (Aufwachwort + Mikrofon), vorkompiliertes `whisper.cpp` (Sprache→Text, per `child_process`), vorkompiliertes `Piper` (Text→Sprache, per `child_process`), PowerShell `Media.SoundPlayer` (Wiedergabe, per `child_process`), `node:http`/`fetch` für Ollama.

**Spec:** [docs/superpowers/specs/2026-09-18-sprachsteuerung-design.md](../specs/2026-09-18-sprachsteuerung-design.md)

## Global Constraints

- Alles auf Deutsch: Variablennamen, Kommentare (Umlaute umschrieben: `fuer`, `groesser`), gesprochene/Ausgabetexte (Umlaute normal: `für`).
- `sprachsteuerung/` importiert **nie** etwas aus `src/`, und `src/` importiert **nie** etwas aus `sprachsteuerung/`. Getrennte `package.json`, getrennte `node_modules`, getrennter Testlauf. Die einzige geteilte Sache ist der Konfigurationswert `OLLAMA_URL` (als eigener Wert in `sprachsteuerung/.env`, nicht als Code-Import).
- Jeder externe Prozessaufruf (`whisper.cpp`, `Piper`, PowerShell-Wiedergabe) läuft über eine injizierbare `ausfuehren`-Funktion, damit die Kernlogik ohne echte Hardware/Binärdateien testbar ist — genau das Muster aus `src/selbstverbesserung-session.js`.
- Kein Fehler in einer Komponente darf das ganze Programm zum Absturz bringen — jeder Schritt (Ollama, Whisper, Piper, Wiedergabe) fängt seine eigenen Fehler ab und führt zu einer festen, verständlichen Reaktion statt eines Absturzes.
- Kein neues Paket im **Bot-eigenen** `package.json` (Projekt-Wurzel) — alle neuen Abhängigkeiten kommen ausschließlich in `sprachsteuerung/package.json`.
- Testrunner im Stil von `tests/lib.js`/`tests/run.js` (kein Test-Framework), aber als eigene Kopie unter `sprachsteuerung/tests/`, nicht als Import aus dem Bot-Testordner.
- `npm test` in `sprachsteuerung/` muss nach jedem Task grün sein, bevor committet wird.

---

### Task 1: Projekt-Grundgerüst

**Files:**
- Create: `sprachsteuerung/package.json`
- Create: `sprachsteuerung/.env.example`
- Create: `sprachsteuerung/.gitignore`
- Create: `sprachsteuerung/tests/lib.js`
- Create: `sprachsteuerung/tests/run.js`
- Create: `sprachsteuerung/README.md`

**Interfaces:**
- Produces: `check(name, condition, detail)`, `equal(name, actual, expected)`, `section(title)`, `finish()` — exakt dieselbe Signatur wie `tests/lib.js` im Hauptprojekt, damit spätere Tasks sie identisch nutzen können.

- [ ] **Step 1: `package.json` anlegen**

Create `sprachsteuerung/package.json`:

```json
{
  "name": "ghostxx-sprachsteuerung",
  "version": "0.1.0",
  "description": "Eigenstaendiges Sprachsteuerungs-Programm fuer Ghostxx - komplett getrennt vom Discord-Bot.",
  "main": "programm.js",
  "scripts": {
    "start": "node programm.js",
    "test": "node tests/run.js"
  },
  "dependencies": {
    "@picovoice/porcupine-node": "^3.0.0",
    "@picovoice/pvrecorder-node": "^1.2.0",
    "dotenv": "^17.4.2"
  }
}
```

- [ ] **Step 2: `.env.example` anlegen**

Create `sprachsteuerung/.env.example`:

```bash
# Picovoice-Zugriffsschluessel - kostenlos unter console.picovoice.ai erzeugt,
# nur fuer das einmalige Trainieren des Aufwachworts "Ghost" noetig. Laeuft
# danach komplett lokal und offline.
PICOVOICE_ACCESS_KEY=dein-picovoice-schluessel-hier

# Pfad zur trainierten .ppn-Datei des Worts "Ghost" (Download aus der
# Picovoice-Konsole nach dem Trainieren).
PORCUPINE_KEYWORD_PFAD=./ghost.ppn

# Wo whisper.cpp liegt (vorkompiliertes Programm, siehe README.md).
WHISPER_PROGRAMM_PFAD=./werkzeuge/whisper-cli.exe
WHISPER_MODELL_PFAD=./werkzeuge/ggml-base.bin

# Wo Piper liegt (vorkompiliertes Programm, siehe README.md).
PIPER_PROGRAMM_PFAD=./werkzeuge/piper.exe
PIPER_STIMME_PFAD=./werkzeuge/de_DE-thorsten-medium.onnx

# Dasselbe lokale Ollama wie der Discord-Bot.
OLLAMA_URL=http://127.0.0.1:11434
OLLAMA_MODELL=qwen3.5:9b
OLLAMA_MODELL_KLEIN=qwen3.5:2b
```

- [ ] **Step 3: `.gitignore` anlegen**

Create `sprachsteuerung/.gitignore`:

```
node_modules/
.env
werkzeuge/
*.ppn
*.wav
```

- [ ] **Step 4: Testhilfe kopieren**

Create `sprachsteuerung/tests/lib.js` (identischer Inhalt wie `tests/lib.js` im Hauptprojekt, ohne die Ollama-Erreichbarkeits-Hilfsfunktion, die hier nicht gebraucht wird):

```js
// Winzige Testhilfe ohne Fremdpakete - dieselbe Konvention wie im
// Hauptprojekt (tests/lib.js), als eigene Kopie, weil sprachsteuerung/ nie
// etwas aus src/ oder tests/ des Bots importiert.

let failed = 0;
let passed = 0;

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  OK   ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${name}${detail ? `  -> ${detail}` : ''}`);
  }
  return Boolean(condition);
}

function equal(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  return check(name, a === e, `erwartet ${e}, war ${a}`);
}

function section(title) {
  console.log(`\n${title}`);
}

function finish() {
  console.log(`\n${passed} bestanden, ${failed} fehlgeschlagen`);
  process.exit(failed ? 1 : 0);
}

module.exports = { check, equal, finish, section };
```

- [ ] **Step 5: Testrunner kopieren**

Create `sprachsteuerung/tests/run.js` (identischer Inhalt wie `tests/run.js` im Hauptprojekt, Pfade beziehen sich auf `sprachsteuerung/tests/`):

```js
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

// Faehrt alle *.test.js nacheinander und fasst zusammen - identischer Stil
// wie tests/run.js im Hauptprojekt.

const testDir = __dirname;
const files = fs.readdirSync(testDir)
  .filter((name) => name.endsWith('.test.js'))
  .sort();

const nurDiese = process.argv.slice(2);
const auswahl = nurDiese.length
  ? files.filter((name) => nurDiese.some((wunsch) => name.includes(wunsch)))
  : files;

if (!auswahl.length) {
  console.error(nurDiese.length ? `Keine Tests gefunden für: ${nurDiese.join(', ')}` : 'Keine Tests gefunden.');
  process.exit(1);
}

const gescheitert = [];
const start = Date.now();

for (const name of auswahl) {
  console.log(`\n${'='.repeat(60)}\n${name}\n${'='.repeat(60)}`);

  const result = spawnSync(process.execPath, [path.join(testDir, name)], {
    stdio: 'inherit',
    env: process.env,
  });

  if (result.status !== 0) gescheitert.push(name);
}

const dauer = ((Date.now() - start) / 1000).toFixed(1);
console.log(`\n${'='.repeat(60)}`);

if (gescheitert.length) {
  console.log(`FEHLGESCHLAGEN nach ${dauer}s: ${gescheitert.join(', ')}`);
  process.exit(1);
}

console.log(`Alle ${auswahl.length} Testdateien bestanden (${dauer}s).`);
```

- [ ] **Step 6: README anlegen**

Create `sprachsteuerung/README.md`:

```markdown
# Ghostxx Sprachsteuerung (Baustein 1)

Eigenstaendiges Programm, komplett getrennt vom Discord-Bot in `src/`.
Sag "Ghost" und dann einen Satz - die Antwort kommt gesprochen zurueck.

## Einmalige Einrichtung

1. `npm install` in diesem Ordner.
2. Kostenloses Konto unter console.picovoice.ai anlegen, das Wort "Ghost"
   als eigenes Aufwachwort trainieren (Sprache: Deutsch, Plattform:
   Windows), die erzeugte `.ppn`-Datei hier ablegen.
3. `whisper.cpp` fuer Windows herunterladen (vorkompilierte Version von
   github.com/ggml-org/whisper.cpp/releases) plus ein deutschsprachiges
   Modell (`ggml-base.bin` von huggingface.co/ggerganov/whisper.cpp) in
   einen Ordner `werkzeuge/` legen.
4. `Piper` fuer Windows herunterladen (github.com/rhasspy/piper/releases)
   plus eine deutsche Stimme (`de_DE-thorsten-medium`, ebenfalls von den
   Piper-Releases) in denselben `werkzeuge/`-Ordner legen.
5. `.env.example` zu `.env` kopieren, Pfade und den Picovoice-Schluessel
   eintragen.
6. `npm start`.

## Testen

`npm test` prueft die Kernlogik (Text rein -> Antwort raus, alle
Fehlerfaelle) ohne echte Hardware. Aufwachwort-Erkennung, Mikrofon und
Lautsprecher-Ausgabe lassen sich nicht automatisiert testen - das prueft
Kevin selbst per Ohr, siehe die manuelle Abnahme am Ende des Umsetzungsplans.
```

- [ ] **Step 7: Abhängigkeiten installieren und Testlauf prüfen**

Run: `cd sprachsteuerung && npm install`
Run: `npm test`
Expected: `Keine Tests gefunden.` (Exit-Code 1) — das ist an dieser Stelle korrekt, es gibt noch keine `*.test.js`-Datei. Kein Grund zur Sorge, wird in Task 2 behoben.

- [ ] **Step 8: Commit**

```bash
git add sprachsteuerung/package.json sprachsteuerung/.env.example sprachsteuerung/.gitignore sprachsteuerung/tests/lib.js sprachsteuerung/tests/run.js sprachsteuerung/README.md
git commit -m "$(cat <<'EOF'
Sprachsteuerung: Projekt-Grundgeruest

Eigener Ordner, eigenes package.json, eigener Testlaeufer im Stil des
Hauptprojekts (tests/lib.js, tests/run.js), komplett getrennt von src/ -
kein gegenseitiger Import. README beschreibt die einmalige Einrichtung
(Picovoice-Konto, whisper.cpp, Piper).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Ollama-Anbindung

**Files:**
- Create: `sprachsteuerung/ollama-client.js`
- Test: `sprachsteuerung/tests/ollama-client.test.js`

**Interfaces:**
- Produces:
  - `async pickModel({ fetchImpl = fetch } = {}): Promise<string>` — liefert `process.env.OLLAMA_MODELL_KLEIN`, wenn der GPU-Test (`/api/ps`) zeigt, dass ein bereits geladenes Modell zu weniger als 60% auf der Grafikkarte liegt (dieselbe Kennzahl wie `src/ollama.js`s `pickModel()`), sonst `process.env.OLLAMA_MODELL`. Bei nicht erreichbarem Ollama: `process.env.OLLAMA_MODELL` (optimistischer Standard, der eigentliche Fehler zeigt sich beim Chat-Aufruf selbst).
  - `async antworte(text: string, { fetchImpl = fetch } = {}): Promise<{ ok: true, text: string } | { ok: false, grund: 'nicht_erreichbar' | 'zeitueberschreitung' | 'leer' }>` — schickt `text` mit einem festen, auf gesprochene Antworten zugeschnittenen System-Prompt an Ollama, gibt eine kurze Antwort zurück.

- [ ] **Step 1: Fehlschlagenden Test schreiben**

Create `sprachsteuerung/tests/ollama-client.test.js`:

```js
const { check, equal, finish, section } = require('./lib');

process.env.OLLAMA_URL = 'http://127.0.0.1:11434';
process.env.OLLAMA_MODELL = 'qwen3.5:9b';
process.env.OLLAMA_MODELL_KLEIN = 'qwen3.5:2b';

const { antworte, pickModel } = require('../ollama-client');

section('pickModel: waehlt nach Grafikkarten-Auslastung');
(async () => {
  const grossesModellVoll = async (url) => {
    if (String(url).includes('/api/ps')) {
      return {
        ok: true,
        json: async () => ({
          models: [{ name: 'qwen3.5:9b', size: 1000, size_vram: 900 }],
        }),
      };
    }
    return { ok: true, json: async () => ({}) };
  };
  equal('bleibt beim grossen Modell (90% auf GPU)', await pickModel({ fetchImpl: grossesModellVoll }), 'qwen3.5:9b');

  const grossesModellVerdraengt = async (url) => {
    if (String(url).includes('/api/ps')) {
      return {
        ok: true,
        json: async () => ({
          models: [{ name: 'qwen3.5:9b', size: 1000, size_vram: 300 }],
        }),
      };
    }
    return { ok: true, json: async () => ({}) };
  };
  equal('wechselt zum kleinen Modell (30% auf GPU)', await pickModel({ fetchImpl: grossesModellVerdraengt }), 'qwen3.5:2b');

  const nichtsGeladen = async () => ({ ok: true, json: async () => ({ models: [] }) });
  equal('bleibt beim grossen Modell ohne geladenes Modell', await pickModel({ fetchImpl: nichtsGeladen }), 'qwen3.5:9b');

  const nichtErreichbar = async () => { throw new Error('ECONNREFUSED'); };
  equal('bleibt beim grossen Modell wenn Ollama nicht antwortet', await pickModel({ fetchImpl: nichtErreichbar }), 'qwen3.5:9b');

  section('antworte: echte Antwort');
  const echteAntwort = async (url) => {
    if (String(url).includes('/api/ps')) return { ok: true, json: async () => ({ models: [] }) };
    return { ok: true, json: async () => ({ message: { content: 'Mir geht es gut.' } }) };
  };
  const ergebnis = await antworte('Wie geht es dir?', { fetchImpl: echteAntwort });
  check('ok', ergebnis.ok === true);
  equal('Text kommt durch', ergebnis.text, 'Mir geht es gut.');

  section('antworte: Ollama nicht erreichbar');
  const nichtErreichbar2 = async () => { throw new Error('ECONNREFUSED'); };
  const fehlerErgebnis = await antworte('Test', { fetchImpl: nichtErreichbar2 });
  check('nicht ok', fehlerErgebnis.ok === false);
  equal('Grund ist nicht_erreichbar', fehlerErgebnis.grund, 'nicht_erreichbar');

  section('antworte: leere Antwort vom Modell');
  const leereAntwort = async (url) => {
    if (String(url).includes('/api/ps')) return { ok: true, json: async () => ({ models: [] }) };
    return { ok: true, json: async () => ({ message: { content: '   ' } }) };
  };
  const leerErgebnis = await antworte('Test', { fetchImpl: leereAntwort });
  check('nicht ok bei leerer Antwort', leerErgebnis.ok === false);
  equal('Grund ist leer', leerErgebnis.grund, 'leer');

  finish();
})();
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

Run: `cd sprachsteuerung && node tests/ollama-client.test.js`
Expected: FAIL — `Cannot find module '../ollama-client'`

- [ ] **Step 3: Modul implementieren**

Create `sprachsteuerung/ollama-client.js`:

```js
require('dotenv').config();

// Eigenstaendige Ollama-Anbindung fuer die Sprachsteuerung - bewusst KEIN
// Import aus src/ollama.js (sprachsteuerung/ darf nie vom Bot-Code
// abhaengen). Dieselbe Modellwahl-Logik wie src/ollama.js's pickModel()
// (60%-GPU-Schwelle), aber unabhaengiger Code.

const GPU_SCHWELLE = 0.6;

// Kurze, gesprochen-taugliche Antworten: eine lange Textantwort liest sich
// schlecht vor, und niemand will einer Sprachausgabe fuenf Saetze zuhoeren,
// die man eigentlich nur ueberfliegen wuerde.
const SYSTEM_PROMPT = 'Du bist Ghostxx, ein deutschsprachiger Assistent. '
  + 'Deine Antworten werden laut vorgelesen, deshalb: kurz (1-2 Saetze), '
  + 'keine Aufzaehlungen, keine Formatierung, keine Emojis, normal '
  + 'gesprochene Sprache statt Schriftsprache.';

async function pickModel({ fetchImpl = fetch } = {}) {
  const gross = process.env.OLLAMA_MODELL;
  const klein = process.env.OLLAMA_MODELL_KLEIN;

  try {
    const res = await fetchImpl(`${process.env.OLLAMA_URL}/api/ps`);
    if (!res.ok) return gross;
    const daten = await res.json();
    const geladen = (daten.models || []).find((m) => m.name === gross);
    if (!geladen || !geladen.size) return gross;

    const anteil = geladen.size_vram / geladen.size;
    return anteil < GPU_SCHWELLE ? klein : gross;
  } catch {
    // Nicht erreichbar - der eigentliche Fehler zeigt sich gleich beim
    // Chat-Aufruf selbst, hier optimistisch beim grossen Modell bleiben.
    return gross;
  }
}

async function antworte(text, { fetchImpl = fetch } = {}) {
  const modell = await pickModel({ fetchImpl });

  let res;
  try {
    res = await fetchImpl(`${process.env.OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modell,
        stream: false,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: text },
        ],
      }),
    });
  } catch {
    return { ok: false, grund: 'nicht_erreichbar' };
  }

  if (!res.ok) return { ok: false, grund: 'nicht_erreichbar' };

  const daten = await res.json();
  const antwortText = String(daten.message?.content || '').trim();
  if (!antwortText) return { ok: false, grund: 'leer' };

  return { ok: true, text: antwortText };
}

module.exports = { antworte, pickModel };
```

Hinweis: der Test injiziert `fetchImpl` und ruft NIE echtes `fetch` auf - in Step 1 wird kein `AbortSignal.timeout` benutzt, weil die Fakes sofort antworten oder werfen. Eine echte Zeitüberschreitung wird in Task 7 (Orchestrator) über einen äußeren Timeout abgesichert, nicht hier - andernfalls müsste jeder Test hier künstlich Zeit vergehen lassen.

- [ ] **Step 4: Test laufen lassen, Erfolg bestätigen**

Run: `node tests/ollama-client.test.js`
Expected: PASS

- [ ] **Step 5: Ganze Testsuite laufen lassen**

Run: `npm test`
Expected: alle Testdateien bestehen (1 jetzt).

- [ ] **Step 6: Commit**

```bash
git add sprachsteuerung/ollama-client.js sprachsteuerung/tests/ollama-client.test.js
git commit -m "$(cat <<'EOF'
Sprachsteuerung: Ollama-Anbindung

Eigenstaendiger HTTP-Aufruf an dasselbe lokale Ollama wie der Bot, mit
derselben GPU-Auslastungs-Schwelle (60%) zur Modellwahl wie
src/ollama.js's pickModel() - aber unabhaengiger Code, kein Import aus
src/. Fester System-Prompt fuer kurze, gesprochen-taugliche Antworten.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Stille-Erkennung für die Aufnahme

**Files:**
- Create: `sprachsteuerung/aufnahme.js`
- Test: `sprachsteuerung/tests/aufnahme.test.js`

**Interfaces:**
- Produces:
  - `berechneLautstaerke(frame: Int16Array): number` — quadratischer Mittelwert (RMS) der Samples in einem PCM-Frame.
  - `erstelleStilleErkennung({ schwelle = 500, stilleFramesZumBeenden = 12, maxFrames = 500 } = {}): { framePruefen(frame: Int16Array): boolean, istFertig(): boolean }` — `framePruefen()` nimmt einen Frame entgegen und gibt `true` zurück, sobald genug aufeinanderfolgende leise Frames erkannt wurden ODER `maxFrames` erreicht ist (hartes Limit). `istFertig()` liefert denselben Zustand ohne einen neuen Frame zu prüfen.

Zahlen-Begründung: `pvrecorder` liefert Frames zu 512 Samples bei 16kHz, also ~32ms pro Frame. `stilleFramesZumBeenden: 12` entspricht damit ~384ms Stille zum Beenden - kurz genug um responsiv zu wirken, lang genug um eine normale Sprechpause mitten im Satz nicht faelschlich als Ende zu werten. `maxFrames: 500` entspricht ~16 Sekunden hartem Limit. Der Schwellwert `500` ist ein Startwert fuer 16-Bit-PCM (Bereich -32768..32767) - die tatsaechlich richtige Zahl haengt vom Mikrofon ab und wird in der manuellen Abnahme (letzter Task) nachjustiert, siehe Kommentar im Code.

- [ ] **Step 1: Fehlschlagenden Test schreiben**

Create `sprachsteuerung/tests/aufnahme.test.js`:

```js
const { check, equal, finish, section } = require('./lib');
const { berechneLautstaerke, erstelleStilleErkennung } = require('../aufnahme');

function lauterFrame(laenge = 512, amplitude = 10000) {
  const frame = new Int16Array(laenge);
  for (let i = 0; i < laenge; i += 1) frame[i] = i % 2 === 0 ? amplitude : -amplitude;
  return frame;
}

function stillerFrame(laenge = 512) {
  return new Int16Array(laenge);
}

section('berechneLautstaerke');
check('stiller Frame hat Lautstaerke 0', berechneLautstaerke(stillerFrame()) === 0);
check('lauter Frame hat hohe Lautstaerke', berechneLautstaerke(lauterFrame()) > 5000);

section('erstelleStilleErkennung: beendet nach genug leisen Frames');
(() => {
  const erkennung = erstelleStilleErkennung({ schwelle: 500, stilleFramesZumBeenden: 3, maxFrames: 100 });

  check('nach lautem Frame nicht fertig', erkennung.framePruefen(lauterFrame()) === false);
  check('nach 1 leisem Frame noch nicht fertig', erkennung.framePruefen(stillerFrame()) === false);
  check('nach 2 leisen Frames noch nicht fertig', erkennung.framePruefen(stillerFrame()) === false);
  check('nach 3 leisen Frames fertig', erkennung.framePruefen(stillerFrame()) === true);
  check('istFertig() bestaetigt', erkennung.istFertig() === true);
})();

section('erstelleStilleErkennung: lauter Frame zwischendrin setzt zurueck');
(() => {
  const erkennung = erstelleStilleErkennung({ schwelle: 500, stilleFramesZumBeenden: 3, maxFrames: 100 });

  erkennung.framePruefen(stillerFrame());
  erkennung.framePruefen(stillerFrame());
  check('nach erneutem lauten Frame nicht fertig', erkennung.framePruefen(lauterFrame()) === false);
  check('braucht wieder 3 leise Frames', erkennung.framePruefen(stillerFrame()) === false);
  check('noch nicht', erkennung.framePruefen(stillerFrame()) === false);
  check('jetzt fertig', erkennung.framePruefen(stillerFrame()) === true);
})();

section('erstelleStilleErkennung: hartes Limit greift trotz Lautstaerke');
(() => {
  const erkennung = erstelleStilleErkennung({ schwelle: 500, stilleFramesZumBeenden: 1000, maxFrames: 5 });

  let fertig = false;
  for (let i = 0; i < 5; i += 1) {
    fertig = erkennung.framePruefen(lauterFrame());
  }
  check('nach maxFrames lauten Frames trotzdem fertig', fertig === true);
})();

finish();
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

Run: `node tests/aufnahme.test.js`
Expected: FAIL — `Cannot find module '../aufnahme'`

- [ ] **Step 3: Modul implementieren**

Create `sprachsteuerung/aufnahme.js`:

```js
// Stille-Erkennung fuer die Aufnahme nach dem Aufwachwort - rein
// funktional, ohne Mikrofon-Zugriff, damit es ohne echte Hardware testbar
// ist. pvrecorder liefert Frames zu 512 Samples bei 16kHz (~32ms/Frame).

function berechneLautstaerke(frame) {
  let summe = 0;
  for (let i = 0; i < frame.length; i += 1) summe += frame[i] * frame[i];
  return Math.sqrt(summe / frame.length);
}

/**
 * schwelle: RMS-Schwellwert fuer "leise" (16-Bit-PCM, Bereich -32768..32767).
 *   Startwert 500 - haengt vom Mikrofon ab, wird bei der manuellen Abnahme
 *   (siehe Umsetzungsplan) nachjustiert, gemessen statt vermutet.
 * stilleFramesZumBeenden: 12 Frames = ~384ms Stille beendet die Aufnahme -
 *   kurz genug fuer Reaktionsfreude, lang genug um eine normale
 *   Sprechpause mitten im Satz nicht faelschlich als Ende zu werten.
 * maxFrames: 500 Frames = ~16s hartes Limit, falls nie richtig still wird.
 */
function erstelleStilleErkennung({ schwelle = 500, stilleFramesZumBeenden = 12, maxFrames = 500 } = {}) {
  let stilleZaehler = 0;
  let frameZaehler = 0;
  let fertig = false;

  function framePruefen(frame) {
    if (fertig) return true;

    frameZaehler += 1;
    const lautstaerke = berechneLautstaerke(frame);

    if (lautstaerke < schwelle) {
      stilleZaehler += 1;
    } else {
      stilleZaehler = 0;
    }

    if (stilleZaehler >= stilleFramesZumBeenden || frameZaehler >= maxFrames) {
      fertig = true;
    }

    return fertig;
  }

  function istFertig() {
    return fertig;
  }

  return { framePruefen, istFertig };
}

module.exports = { berechneLautstaerke, erstelleStilleErkennung };
```

- [ ] **Step 4: Test laufen lassen, Erfolg bestätigen**

Run: `node tests/aufnahme.test.js`
Expected: PASS

- [ ] **Step 5: Ganze Testsuite laufen lassen**

Run: `npm test`
Expected: alle Testdateien bestehen (2 jetzt).

- [ ] **Step 6: Commit**

```bash
git add sprachsteuerung/aufnahme.js sprachsteuerung/tests/aufnahme.test.js
git commit -m "$(cat <<'EOF'
Sprachsteuerung: Stille-Erkennung fuer die Aufnahme

Rein funktionale RMS-basierte Erkennung, wann eine Aufnahme nach dem
Aufwachwort enden soll (~384ms Stille oder ~16s hartes Limit) - ohne
Mikrofon-Zugriff, deshalb ohne echte Hardware testbar. Der Schwellwert ist
ein Startwert, wird in der manuellen Abnahme am echten Mikrofon
nachjustiert.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Sprache-zu-Text (whisper.cpp)

**Files:**
- Create: `sprachsteuerung/hoere-zu.js`
- Test: `sprachsteuerung/tests/hoere-zu.test.js`

**Interfaces:**
- Consumes: `process.env.WHISPER_PROGRAMM_PFAD`, `process.env.WHISPER_MODELL_PFAD`.
- Produces: `async transkribiere(wavPfad: string, { ausfuehren = echtAusfuehren, dateiLesen = fs.promises.readFile } = {}): Promise<{ ok: true, text: string } | { ok: false, grund: 'fehlgeschlagen' | 'kein_text' }>`

**Ablauf (real):** ruft `whisper-cli.exe -m <modell> -f <wav> -l de --no-timestamps --output-txt --output-file <wav-ohne-endung>` auf, liest danach `<wav-ohne-endung>.txt`.

- [ ] **Step 1: Fehlschlagenden Test schreiben**

Create `sprachsteuerung/tests/hoere-zu.test.js`:

```js
const { check, equal, finish, section } = require('./lib');

process.env.WHISPER_PROGRAMM_PFAD = 'C:/werkzeuge/whisper-cli.exe';
process.env.WHISPER_MODELL_PFAD = 'C:/werkzeuge/ggml-base.bin';

const { transkribiere } = require('../hoere-zu');

section('Erfolgreiche Transkription');
(async () => {
  const aufrufe = [];
  const fakeAusfuehren = async (cmd, args) => {
    aufrufe.push([cmd, ...args].join(' '));
    return { code: 0, stdout: '', stderr: '' };
  };
  const fakeDateiLesen = async () => Buffer.from('Wie geht es dir heute?\n');

  const ergebnis = await transkribiere('C:/temp/aufnahme.wav', { ausfuehren: fakeAusfuehren, dateiLesen: fakeDateiLesen });

  check('ok', ergebnis.ok === true);
  equal('Text getrimmt', ergebnis.text, 'Wie geht es dir heute?');
  check('ruft whisper-cli auf', aufrufe[0].includes('whisper-cli.exe'));
  check('uebergibt Modell', aufrufe[0].includes('ggml-base.bin'));
  check('uebergibt WAV-Datei', aufrufe[0].includes('aufnahme.wav'));
  check('deutsche Sprache erzwungen', aufrufe[0].includes('-l de'));

  section('whisper-cli meldet Fehler');
  const fakeFehler = async () => ({ code: 1, stdout: '', stderr: 'Modell nicht gefunden' });
  const fehlerErgebnis = await transkribiere('C:/temp/aufnahme.wav', { ausfuehren: fakeFehler, dateiLesen: fakeDateiLesen });
  check('nicht ok', fehlerErgebnis.ok === false);
  equal('Grund fehlgeschlagen', fehlerErgebnis.grund, 'fehlgeschlagen');

  section('Leere/nur Stille erkannte Transkription');
  const fakeLeereDatei = async () => Buffer.from('   \n');
  const leerErgebnis = await transkribiere('C:/temp/aufnahme.wav', { ausfuehren: fakeAusfuehren, dateiLesen: fakeLeereDatei });
  check('nicht ok bei leerem Text', leerErgebnis.ok === false);
  equal('Grund kein_text', leerErgebnis.grund, 'kein_text');

  finish();
})();
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

Run: `node tests/hoere-zu.test.js`
Expected: FAIL — `Cannot find module '../hoere-zu'`

- [ ] **Step 3: Modul implementieren**

Create `sprachsteuerung/hoere-zu.js`:

```js
require('dotenv').config();
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

// Sprache-zu-Text ueber ein vorkompiliertes whisper.cpp-Programm, per
// child_process wie das Hauptprojekt bereits externe Werkzeuge einbindet
// (siehe src/system-werte.js fuer nvidia-smi). Kein Python noetig, keine
// native Kompilierung in diesem Projekt - nur ein fertiges .exe aufrufen.

function echtAusfuehren(cmd, args) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    p.stdout?.on('data', (d) => { stdout += d; });
    p.stderr?.on('data', (d) => { stderr += d; });
    p.on('error', () => resolve({ code: -1, stdout, stderr: 'Prozess konnte nicht gestartet werden' }));
    p.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

async function transkribiere(wavPfad, { ausfuehren = echtAusfuehren, dateiLesen = fs.promises.readFile } = {}) {
  const ausgabeOhneEndung = wavPfad.replace(/\.wav$/i, '');

  const lauf = await ausfuehren(process.env.WHISPER_PROGRAMM_PFAD, [
    '-m', process.env.WHISPER_MODELL_PFAD,
    '-f', wavPfad,
    '-l', 'de',
    '--no-timestamps',
    '--output-txt',
    '--output-file', ausgabeOhneEndung,
  ]);

  if (lauf.code !== 0) {
    return { ok: false, grund: 'fehlgeschlagen' };
  }

  const inhalt = (await dateiLesen(`${ausgabeOhneEndung}.txt`)).toString('utf8').trim();
  if (!inhalt) return { ok: false, grund: 'kein_text' };

  return { ok: true, text: inhalt };
}

module.exports = { transkribiere };
```

- [ ] **Step 4: Test laufen lassen, Erfolg bestätigen**

Run: `node tests/hoere-zu.test.js`
Expected: PASS

- [ ] **Step 5: Ganze Testsuite laufen lassen**

Run: `npm test`
Expected: alle Testdateien bestehen (3 jetzt).

- [ ] **Step 6: Commit**

```bash
git add sprachsteuerung/hoere-zu.js sprachsteuerung/tests/hoere-zu.test.js
git commit -m "$(cat <<'EOF'
Sprachsteuerung: Sprache-zu-Text ueber whisper.cpp

Ruft ein vorkompiliertes whisper.cpp-Programm per child_process auf
(kein Python, keine native Kompilierung in diesem Projekt), erzwingt
Deutsch, liest die Textausgabe aus einer Datei statt Stdout zu parsen -
robuster gegen zusaetzliche Log-Ausgaben des Programms.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Text-zu-Sprache (Piper) und Wiedergabe

**Files:**
- Create: `sprachsteuerung/sprich.js`
- Test: `sprachsteuerung/tests/sprich.test.js`

**Interfaces:**
- Consumes: `process.env.PIPER_PROGRAMM_PFAD`, `process.env.PIPER_STIMME_PFAD`.
- Produces: `async sprich(text: string, { ausfuehren = echtAusfuehren, ausgabePfad = pfadFuerTemp() } = {}): Promise<{ ok: boolean, grund: string }>` — synthetisiert `text` per Piper in eine WAV-Datei, spielt sie über PowerShell ab. Gibt `{ok:true}` bei Erfolg zurück; bei einem Fehler in Piper ODER der Wiedergabe `{ok:false, grund}`, OHNE zu werfen (das Programm muss weiterlaufen können, siehe Spec-Fehlerbehandlung "Piper schlägt fehl: Programm bleibt am Leben").

- [ ] **Step 1: Fehlschlagenden Test schreiben**

Create `sprachsteuerung/tests/sprich.test.js`:

```js
const { check, equal, finish, section } = require('./lib');

process.env.PIPER_PROGRAMM_PFAD = 'C:/werkzeuge/piper.exe';
process.env.PIPER_STIMME_PFAD = 'C:/werkzeuge/de_DE-thorsten-medium.onnx';

const { sprich } = require('../sprich');

section('Erfolgreiche Sprachausgabe');
(async () => {
  const aufrufe = [];
  const fakeAusfuehren = async (cmd, args) => {
    aufrufe.push([cmd, ...args].join(' '));
    return { code: 0, stdout: '', stderr: '' };
  };

  const ergebnis = await sprich('Mir geht es gut.', { ausfuehren: fakeAusfuehren, ausgabePfad: 'C:/temp/antwort.wav' });

  check('ok', ergebnis.ok === true);
  check('zwei Aufrufe: Piper und Wiedergabe', aufrufe.length === 2);
  check('erster Aufruf ist Piper', aufrufe[0].includes('piper.exe'));
  check('Piper bekommt die Stimme', aufrufe[0].includes('de_DE-thorsten-medium.onnx'));
  check('Piper bekommt die Ausgabedatei', aufrufe[0].includes('antwort.wav'));
  check('zweiter Aufruf ist powershell', aufrufe[1].toLowerCase().includes('powershell'));
  check('Wiedergabe nutzt dieselbe Datei', aufrufe[1].includes('antwort.wav'));

  section('Piper schlaegt fehl');
  const aufrufePiperFehler = [];
  const fakePiperFehler = async (cmd, args) => {
    aufrufePiperFehler.push(cmd);
    if (cmd.includes('piper')) return { code: 1, stdout: '', stderr: 'Stimme nicht gefunden' };
    return { code: 0, stdout: '', stderr: '' };
  };
  const fehlerErgebnis = await sprich('Test', { ausfuehren: fakePiperFehler, ausgabePfad: 'C:/temp/antwort.wav' });
  check('nicht ok', fehlerErgebnis.ok === false);
  equal('Grund piper_fehlgeschlagen', fehlerErgebnis.grund, 'piper_fehlgeschlagen');
  check('Wiedergabe wird bei Piper-Fehler nicht versucht', !aufrufePiperFehler.some((c) => c.toLowerCase().includes('powershell')));

  section('Wiedergabe schlaegt fehl, Piper aber erfolgreich');
  const fakeWiedergabeFehler = async (cmd) => {
    if (cmd.includes('piper')) return { code: 0, stdout: '', stderr: '' };
    return { code: 1, stdout: '', stderr: 'Kein Audiogeraet' };
  };
  const wiedergabeFehlerErgebnis = await sprich('Test', { ausfuehren: fakeWiedergabeFehler, ausgabePfad: 'C:/temp/antwort.wav' });
  check('nicht ok', wiedergabeFehlerErgebnis.ok === false);
  equal('Grund wiedergabe_fehlgeschlagen', wiedergabeFehlerErgebnis.grund, 'wiedergabe_fehlgeschlagen');

  finish();
})();
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

Run: `node tests/sprich.test.js`
Expected: FAIL — `Cannot find module '../sprich'`

- [ ] **Step 3: Modul implementieren**

Create `sprachsteuerung/sprich.js`:

```js
require('dotenv').config();
const { spawn } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');

// Text-zu-Sprache ueber ein vorkompiliertes Piper-Programm, Wiedergabe ueber
// PowerShells eingebauten Media.SoundPlayer - kein zusaetzliches npm-Paket
// fuer Audiowiedergabe noetig, funktioniert auf jedem Windows-Rechner ohne
// weitere Installation.
//
// Piper bekommt den Text ueber stdin, nicht als Kommandozeilen-Argument -
// laengere Saetze mit Sonderzeichen waeren als Argument fragil.

function echtAusfuehren(cmd, args, options = {}) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { windowsHide: true, ...options });
    let stdout = '';
    let stderr = '';
    if (options.stdin) {
      p.stdin.write(options.stdin);
      p.stdin.end();
    }
    p.stdout?.on('data', (d) => { stdout += d; });
    p.stderr?.on('data', (d) => { stderr += d; });
    p.on('error', () => resolve({ code: -1, stdout, stderr: 'Prozess konnte nicht gestartet werden' }));
    p.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

function pfadFuerTemp() {
  return path.join(os.tmpdir(), `ghostxx-sprich-${Date.now()}.wav`);
}

async function sprich(text, { ausfuehren = echtAusfuehren, ausgabePfad = pfadFuerTemp() } = {}) {
  const piperLauf = await ausfuehren(process.env.PIPER_PROGRAMM_PFAD, [
    '--model', process.env.PIPER_STIMME_PFAD,
    '--output_file', ausgabePfad,
  ], { stdin: text });

  if (piperLauf.code !== 0) {
    return { ok: false, grund: 'piper_fehlgeschlagen' };
  }

  // PowerShell-Escaping: einfache Anfuehrungszeichen im Pfad verdoppeln -
  // in der Praxis unwahrscheinlich (Temp-Pfade), aber billig abzusichern.
  const sichererPfad = ausgabePfad.replace(/'/g, "''");
  const wiedergabeLauf = await ausfuehren('powershell', [
    '-NoProfile',
    '-Command',
    `(New-Object Media.SoundPlayer '${sichererPfad}').PlaySync()`,
  ]);

  if (wiedergabeLauf.code !== 0) {
    return { ok: false, grund: 'wiedergabe_fehlgeschlagen' };
  }

  return { ok: true, grund: '' };
}

module.exports = { sprich };
```

- [ ] **Step 4: Test laufen lassen, Erfolg bestätigen**

Run: `node tests/sprich.test.js`
Expected: PASS

- [ ] **Step 5: Ganze Testsuite laufen lassen**

Run: `npm test`
Expected: alle Testdateien bestehen (4 jetzt).

- [ ] **Step 6: Commit**

```bash
git add sprachsteuerung/sprich.js sprachsteuerung/tests/sprich.test.js
git commit -m "$(cat <<'EOF'
Sprachsteuerung: Text-zu-Sprache ueber Piper + Wiedergabe

Piper (vorkompiliert, per child_process, Text ueber stdin) erzeugt eine
WAV-Datei, PowerShells Media.SoundPlayer spielt sie ab - kein
zusaetzliches npm-Audiopaket noetig. Piper- und Wiedergabe-Fehler werden
als {ok:false} zurueckgegeben statt zu werfen, das Programm soll dabei
nicht abstuerzen.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Feste Antworten für Fehlerfälle

**Files:**
- Create: `sprachsteuerung/feste-antworten.js`
- Test: `sprachsteuerung/tests/feste-antworten.test.js`

**Interfaces:**
- Produces: `textFuer(grund: string): string` — bildet jeden möglichen Fehler-`grund`-Wert aus den Tasks 2, 4 und 5 (`nicht_erreichbar`, `zeitueberschreitung`, `leer`, `fehlgeschlagen`, `kein_text`, `piper_fehlgeschlagen`, `wiedergabe_fehlgeschlagen`) sowie `'timeout_ollama'` (siehe Task 7) auf einen festen, kurzen, gesprochen-tauglichen deutschen Satz ab. Ein unbekannter Grund liefert einen generischen Satz statt zu werfen.

Eigenes kleines Modul, damit die Fehlertexte an einer Stelle stehen (nicht in jedem der vorherigen Module verstreut) und der Orchestrator (Task 7) sie einheitlich verwenden kann.

- [ ] **Step 1: Fehlschlagenden Test schreiben**

Create `sprachsteuerung/tests/feste-antworten.test.js`:

```js
const { check, finish, section } = require('./lib');
const { textFuer } = require('../feste-antworten');

section('Jeder bekannte Grund hat einen eigenen Satz');
const bekannt = [
  'nicht_erreichbar', 'zeitueberschreitung', 'leer', 'fehlgeschlagen',
  'kein_text', 'piper_fehlgeschlagen', 'wiedergabe_fehlgeschlagen', 'timeout_ollama',
];
const gesehen = new Set();
for (const grund of bekannt) {
  const text = textFuer(grund);
  check(`${grund} hat einen Text`, typeof text === 'string' && text.length > 5);
  check(`${grund} ist nicht doppelt`, !gesehen.has(text));
  gesehen.add(text);
}

section('Unbekannter Grund faellt nicht auseinander');
check('generischer Text statt Wurf', typeof textFuer('irgendwas-unbekanntes') === 'string');

finish();
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

Run: `node tests/feste-antworten.test.js`
Expected: FAIL — `Cannot find module '../feste-antworten'`

- [ ] **Step 3: Modul implementieren**

Create `sprachsteuerung/feste-antworten.js`:

```js
// Feste, gesprochen-taugliche Saetze fuer jeden Fehlerfall - an einer
// Stelle gesammelt statt in jedem Modul verstreut. Kein Modell erfindet
// hier etwas, das waere bei einer Fehlermeldung fehl am Platz.

const TEXTE = {
  nicht_erreichbar: 'Ich bin gerade nicht erreichbar, mein Sprachmodell antwortet nicht.',
  zeitueberschreitung: 'Das dauert mir gerade zu lange, frag mich gleich nochmal.',
  timeout_ollama: 'Ich brauche gerade zu lange zum Nachdenken, versuch es gleich nochmal.',
  leer: 'Dazu fällt mir gerade nichts ein.',
  fehlgeschlagen: 'Ich habe dich leider nicht verstanden.',
  kein_text: 'Ich habe nichts verstanden, war das leise oder undeutlich?',
  piper_fehlgeschlagen: 'Ich kann das gerade nicht aussprechen.',
  wiedergabe_fehlgeschlagen: 'Ich kann gerade nicht über die Lautsprecher sprechen.',
};

const STANDARD = 'Da ist etwas schiefgelaufen.';

function textFuer(grund) {
  return TEXTE[grund] || STANDARD;
}

module.exports = { textFuer };
```

- [ ] **Step 4: Test laufen lassen, Erfolg bestätigen**

Run: `node tests/feste-antworten.test.js`
Expected: PASS

- [ ] **Step 5: Ganze Testsuite laufen lassen**

Run: `npm test`
Expected: alle Testdateien bestehen (5 jetzt).

- [ ] **Step 6: Commit**

```bash
git add sprachsteuerung/feste-antworten.js sprachsteuerung/tests/feste-antworten.test.js
git commit -m "$(cat <<'EOF'
Sprachsteuerung: feste Antworten fuer alle Fehlerfaelle

Ein Satz pro moeglichem Fehlergrund aus den bisherigen Modulen, an einer
Stelle gesammelt. Kein Modell erfindet hier etwas - eine Fehlermeldung
soll nie vom Sprachmodell stammen.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Orchestrator (Aufwachwort → Aufnahme → Antwort → Sprache)

**Files:**
- Create: `sprachsteuerung/programm.js`
- Test: `sprachsteuerung/tests/programm.test.js`

**Interfaces:**
- Consumes: `pickModel`/`antworte` aus `ollama-client.js` (Task 2), `erstelleStilleErkennung` aus `aufnahme.js` (Task 3), `transkribiere` aus `hoere-zu.js` (Task 4), `sprich` aus `sprich.js` (Task 5), `textFuer` aus `feste-antworten.js` (Task 6).
- Produces:
  - `async verarbeiteAeusserung(wavPfad: string, { transkribieren, antworten, sprechen } = {}): Promise<{ ok: boolean, gesagt: string }>` — die komplette, OHNE Hardware testbare Kette: WAV → Text → Antwort → Sprache. Jeder Fehlerfall führt zu `sprechen(textFuer(grund))` statt eines Wurfs.
  - `starteProgramm()` — echte Verdrahtung von Porcupine (Aufwachwort) + `pvrecorder` (Mikrofon) + der Stille-Erkennung + `verarbeiteAeusserung()`. Diese Funktion selbst wird NICHT automatisiert getestet (echte Hardware) - siehe Task 8, manuelle Abnahme.

- [ ] **Step 1: Fehlschlagenden Test schreiben**

Create `sprachsteuerung/tests/programm.test.js`:

```js
const { check, equal, finish, section } = require('./lib');
const { verarbeiteAeusserung } = require('../programm');

section('Erfolgreicher Durchlauf');
(async () => {
  const gesprochen = [];
  const ergebnis = await verarbeiteAeusserung('C:/temp/aufnahme.wav', {
    transkribieren: async () => ({ ok: true, text: 'Wie geht es dir?' }),
    antworten: async (text) => {
      check('Text kommt bei antworten() an', text === 'Wie geht es dir?');
      return { ok: true, text: 'Mir geht es gut.' };
    },
    sprechen: async (text) => { gesprochen.push(text); return { ok: true }; },
  });

  check('ok', ergebnis.ok === true);
  equal('genau ein Satz gesprochen', gesprochen.length, 1);
  equal('die echte Antwort wurde gesprochen', gesprochen[0], 'Mir geht es gut.');

  section('Transkription schlaegt fehl -> feste Antwort, kein Ollama-Aufruf');
  const gesprochen2 = [];
  let ollamaAufgerufen = false;
  const ergebnis2 = await verarbeiteAeusserung('C:/temp/aufnahme.wav', {
    transkribieren: async () => ({ ok: false, grund: 'kein_text' }),
    antworten: async () => { ollamaAufgerufen = true; return { ok: true, text: 'x' }; },
    sprechen: async (text) => { gesprochen2.push(text); return { ok: true }; },
  });
  check('nicht ok', ergebnis2.ok === false);
  check('Ollama wird nicht aufgerufen', ollamaAufgerufen === false);
  equal('feste Antwort fuer kein_text gesprochen', gesprochen2[0], require('../feste-antworten').textFuer('kein_text'));

  section('Ollama nicht erreichbar -> feste Antwort');
  const gesprochen3 = [];
  const ergebnis3 = await verarbeiteAeusserung('C:/temp/aufnahme.wav', {
    transkribieren: async () => ({ ok: true, text: 'Test' }),
    antworten: async () => ({ ok: false, grund: 'nicht_erreichbar' }),
    sprechen: async (text) => { gesprochen3.push(text); return { ok: true }; },
  });
  check('nicht ok', ergebnis3.ok === false);
  equal('feste Antwort fuer nicht_erreichbar gesprochen', gesprochen3[0], require('../feste-antworten').textFuer('nicht_erreichbar'));

  section('Ollama braucht zu lange -> feste Timeout-Antwort');
  const gesprochen4 = [];
  const langsamesAntworten = () => new Promise((resolve) => {
    setTimeout(() => resolve({ ok: true, text: 'zu spaet' }), 200);
  });
  const ergebnis4 = await verarbeiteAeusserung('C:/temp/aufnahme.wav', {
    transkribieren: async () => ({ ok: true, text: 'Test' }),
    antworten: langsamesAntworten,
    sprechen: async (text) => { gesprochen4.push(text); return { ok: true }; },
    ollamaTimeoutMs: 20,
  });
  check('nicht ok bei Zeitueberschreitung', ergebnis4.ok === false);
  equal('feste Timeout-Antwort gesprochen', gesprochen4[0], require('../feste-antworten').textFuer('timeout_ollama'));

  finish();
})();
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

Run: `node tests/programm.test.js`
Expected: FAIL — `Cannot find module '../programm'`

- [ ] **Step 3: Modul implementieren**

Create `sprachsteuerung/programm.js`:

```js
require('dotenv').config();
const path = require('node:path');
const os = require('node:os');
const { antworte: antwortenEcht } = require('./ollama-client');
const { transkribiere: transkribierenEcht } = require('./hoere-zu');
const { sprich: sprechenEcht } = require('./sprich');
const { erstelleStilleErkennung } = require('./aufnahme');
const { textFuer } = require('./feste-antworten');

// Verbindet die einzelnen Schritte zur kompletten Kette: Aufnahme (WAV) ->
// Text -> Antwort -> Sprache. Jeder Fehlerfall fuehrt zu einer festen,
// gesprochenen Antwort statt eines Absturzes - das Programm muss nach
// jedem Fehler sofort wieder auf das naechste Aufwachwort warten koennen.

const OLLAMA_TIMEOUT_MS = 15 * 1000;

function mitTimeout(versprechen, timeoutMs) {
  return Promise.race([
    versprechen,
    new Promise((resolve) => setTimeout(() => resolve({ ok: false, grund: 'timeout_ollama' }), timeoutMs)),
  ]);
}

async function verarbeiteAeusserung(wavPfad, {
  transkribieren = transkribierenEcht,
  antworten = antwortenEcht,
  sprechen = sprechenEcht,
  ollamaTimeoutMs = OLLAMA_TIMEOUT_MS,
} = {}) {
  const gehoert = await transkribieren(wavPfad);
  if (!gehoert.ok) {
    await sprechen(textFuer(gehoert.grund));
    return { ok: false, gesagt: textFuer(gehoert.grund) };
  }

  const antwort = await mitTimeout(antworten(gehoert.text), ollamaTimeoutMs);
  if (!antwort.ok) {
    await sprechen(textFuer(antwort.grund));
    return { ok: false, gesagt: textFuer(antwort.grund) };
  }

  await sprechen(antwort.text);
  return { ok: true, gesagt: antwort.text };
}

/**
 * Echte Verdrahtung mit Mikrofon und Aufwachwort - NICHT automatisiert
 * getestet (echte Hardware). Siehe Umsetzungsplan, manuelle Abnahme.
 */
function starteProgramm() {
  // Erst hier (nicht am Dateianfang) importiert, damit die reine
  // Verarbeitungskette oben ohne installierte native Pakete testbar bleibt,
  // falls @picovoice/* auf einem CI-Rechner ohne Audiogeraet nicht laedt.
  const { Porcupine, BuiltinKeyword } = require('@picovoice/porcupine-node');
  const { PvRecorder } = require('@picovoice/pvrecorder-node');
  const fs = require('node:fs');

  const porcupine = new Porcupine(
    process.env.PICOVOICE_ACCESS_KEY,
    [process.env.PORCUPINE_KEYWORD_PFAD],
    [0.5],
  );

  const recorder = new PvRecorder(porcupine.frameLength, -1);
  recorder.start();
  console.log('Sprachsteuerung laeuft. Sag "Ghost" zum Starten.');

  let inAufnahme = false;
  let erkennung = null;
  let frames = [];

  (async () => {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const frame = await recorder.read();

      if (!inAufnahme) {
        const treffer = porcupine.process(frame);
        if (treffer !== -1) {
          console.log('Aufwachwort erkannt, ich höre zu...');
          inAufnahme = true;
          erkennung = erstelleStilleErkennung();
          frames = [];
        }
        continue;
      }

      frames.push(Buffer.from(frame.buffer));
      const fertig = erkennung.framePruefen(frame);

      if (fertig) {
        inAufnahme = false;
        const wavPfad = path.join(os.tmpdir(), `ghostxx-sprachsteuerung-${Date.now()}.wav`);
        schreibeWav(wavPfad, Buffer.concat(frames), recorder.sampleRate);
        await verarbeiteAeusserung(wavPfad);
        fs.rm(wavPfad, { force: true }, () => {});
      }
    }
  })();
}

/** Minimaler WAV-Header fuer 16-Bit-Mono-PCM - keine externe Bibliothek noetig. */
function schreibeWav(pfad, pcmDaten, sampleRate) {
  const fs = require('node:fs');
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcmDaten.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcmDaten.length, 40);
  fs.writeFileSync(pfad, Buffer.concat([header, pcmDaten]));
}

if (require.main === module) {
  starteProgramm();
}

module.exports = { starteProgramm, verarbeiteAeusserung };
```

Hinweis: `BuiltinKeyword` ist importiert, aber ungenutzt (das eigene Wort "Ghost" kommt aus `PORCUPINE_KEYWORD_PFAD`, keinem eingebauten Schlüsselwort) - beim Umsetzen den ungenutzten Import entfernen, war hier nur zur Vollständigkeit der API-Form erwähnt.

- [ ] **Step 4: Test laufen lassen, Erfolg bestätigen**

Run: `node tests/programm.test.js`
Expected: PASS

- [ ] **Step 5: Ganze Testsuite laufen lassen**

Run: `npm test`
Expected: alle Testdateien bestehen (6 jetzt).

- [ ] **Step 6: Commit**

```bash
git add sprachsteuerung/programm.js sprachsteuerung/tests/programm.test.js
git commit -m "$(cat <<'EOF'
Sprachsteuerung: Orchestrator (Aufnahme -> Text -> Antwort -> Sprache)

verarbeiteAeusserung() ist die komplette, ohne Hardware testbare Kette
mit injizierbaren Abhaengigkeiten - jeder Fehlerfall fuehrt zu einer
festen gesprochenen Antwort statt eines Absturzes, inklusive eines
Timeouts fuer eine zu langsame Ollama-Antwort. starteProgramm() ist die
echte Verdrahtung mit Porcupine (Aufwachwort) und pvrecorder (Mikrofon) -
bewusst nicht automatisiert getestet, siehe die manuelle Abnahme im
naechsten Task.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Einrichtung und manuelle Abnahme

Dieser Task hat keine automatisiert testbaren Schritte — er ist die Brücke zwischen fertigem Code und einem tatsächlich funktionierenden Sprachassistenten auf Kevins Rechner. Kein Schritt hier darf als "automatisiert getestet" behauptet werden.

- [ ] **Schritt 1: Picovoice einrichten**

Auf console.picovoice.ai ein kostenloses Konto anlegen, das Wort "Ghost" als eigenes Aufwachwort trainieren (Sprache Deutsch, Plattform Windows), die erzeugte `.ppn`-Datei nach `sprachsteuerung/ghost.ppn` legen, den Zugriffsschlüssel in `sprachsteuerung/.env` eintragen (`PICOVOICE_ACCESS_KEY`).

- [ ] **Schritt 2: whisper.cpp einrichten**

Von github.com/ggml-org/whisper.cpp/releases die vorkompilierte Windows-Version herunterladen, nach `sprachsteuerung/werkzeuge/` entpacken. Von huggingface.co/ggerganov/whisper.cpp das Modell `ggml-base.bin` herunterladen, ebenfalls dorthin legen. Pfade in `.env` eintragen (`WHISPER_PROGRAMM_PFAD`, `WHISPER_MODELL_PFAD`).

- [ ] **Schritt 3: Piper einrichten**

Von github.com/rhasspy/piper/releases die vorkompilierte Windows-Version herunterladen, nach `sprachsteuerung/werkzeuge/` entpacken. Die deutsche Stimme `de_DE-thorsten-medium` (ebenfalls aus den Piper-Releases bzw. der zugehörigen Stimmen-Sammlung) herunterladen, dorthin legen. Pfade in `.env` eintragen (`PIPER_PROGRAMM_PFAD`, `PIPER_STIMME_PFAD`).

- [ ] **Schritt 4: Erster echter Start**

```bash
cd sprachsteuerung
npm start
```

Erwartet: `Sprachsteuerung laeuft. Sag "Ghost" zum Starten.` erscheint, ohne Fehler beim Laden von Porcupine/pvrecorder.

- [ ] **Schritt 5: Aufwachwort von Ohr prüfen**

"Ghost" sagen. Erwartet: `Aufwachwort erkannt, ich höre zu...` erscheint. Falls es gar nicht oder ständig fälschlich anspringt: den Schwellwert bei Picovoice bzw. die Zuversicht (aktuell `0.5` in `programm.js`) anpassen — das ist der in der Spec vorgesehene, gemessene statt vermutete Nachjustierungsschritt.

- [ ] **Schritt 6: Ganzen Ablauf von Ohr prüfen**

Nach dem Aufwachwort einen einfachen Satz sagen ("Wie geht es dir?"), abwarten. Erwartet: nach kurzer Pause kommt eine kurze, gesprochene Antwort über die Lautsprecher zurück.

- [ ] **Schritt 7: Stille-Schwellwert nachjustieren, falls nötig**

Falls die Aufnahme zu früh abbricht (mitten im Satz) oder zu lange braucht (mehrere Sekunden Stille bis zur Antwort): den `schwelle`-Wert in `aufnahme.js`s `erstelleStilleErkennung()`-Aufruf in `programm.js` anpassen (Startwert `500`), erneut testen. Diese Anpassung bewusst gemessen am echten Mikrofon vornehmen, nicht raten.

- [ ] **Schritt 8: Fehlerfälle von Ohr prüfen**

Ollama kurz stoppen (`ollama stop` oder den Ollama-Prozess beenden) und "Ghost, wie geht's" sagen — erwartet: die feste Ansage "Ich bin gerade nicht erreichbar, mein Sprachmodell antwortet nicht." kommt zurück, das Programm stürzt nicht ab und wartet danach weiter auf "Ghost". Ollama wieder starten und einen normalen Testlauf wiederholen, um zu bestätigen, dass es sich davon erholt.

- [ ] **Schritt 9: Startmechanismus festlegen**

Bewusst kein automatischer Windows-Autostart in diesem Baustein — Kevin startet `npm start` manuell im Ordner `sprachsteuerung/`, solange er das Programm testet. Ein Autostart (ähnlich `scripts/run-bot.ps1` beim Bot) ist ein möglicher, aber separater späterer Schritt, wenn sich das Programm im Alltag bewährt hat.

## Manuelle Verifikation abgeschlossen, wenn:

Alle neun Schritte oben von Kevin selbst durchgeführt und bestätigt wurden — insbesondere Schritt 6 (kompletter Ablauf funktioniert) und Schritt 8 (Fehlerfall stürzt nicht ab).

## Self-Review

- **Spec-Abdeckung:** Aufwachwort (Task 7/8), Sprache-zu-Text (Task 4), Ollama-Anbindung mit derselben Modellwahl-Logik (Task 2), Text-zu-Sprache (Task 5), alle vier Fehlerfälle aus der Spec (Ollama nicht erreichbar/Timeout, Whisper kein Text, Porcupine-Fehlalarm implizit durch die Stille-Erkennung selbst — kein API-Aufruf ohne folgenden Text, Piper-Fehler) — abgedeckt. Eigener Ordner/eigenes package.json/kein gegenseitiger Import — Task 1 und Global Constraints. Manuelle Abnahme statt vorgetäuschter Automatisierung — Task 8.
- **Platzhalter-Scan:** keine TBD/TODO; alle Konstanten (Stille-Schwellwert, Frame-Zahlen, Timeout) sind konkrete Startwerte mit Begründung, ausdrücklich als in der manuellen Abnahme nachjustierbar markiert — kein unausgefüllter Platzhalter.
- **Typ-Konsistenz:** `{ok, grund}`-Form durchgängig in `ollama-client.js`, `hoere-zu.js`, `sprich.js`; `textFuer(grund)` deckt alle in diesen drei Modulen erzeugten `grund`-Werte plus `timeout_ollama` aus dem Orchestrator ab; `verarbeiteAeusserung()`s injizierte Parameter (`transkribieren`, `antworten`, `sprechen`) stimmen exakt mit den Exportnamen aus den jeweiligen Tasks überein.
