# Ghostxx Selbstverbesserung (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ghostxx erkennt wiederkehrende Probleme in seinen eigenen Logs, stößt dafür automatisch eine non-interaktive Claude-Code-Session auf einem eigenen, isolierten Branch an, und meldet Kevin per Discord-DM + Dashboard einen fertigen Lösungsvorschlag — ohne main, Auszahlungscode oder den laufenden Bot selbst anzufassen.

**Architecture:** Ein Beobachter liest die bestehende Fehlerhistorie (neu: persistiert über Neustarts hinweg) und die Crash-Historie aus `logs/bot.log`, erkennt Muster gegen feste Schwellwerte und prüft gegen ein neues `Gedächtnis/`-Verzeichnis, ob das Problem schon behandelt wurde. Bei einem neuen Problem legt ein Session-Modul einen `git worktree` auf eigenem Branch an (dadurch technisch von main UND vom laufenden Bot-Prozess isoliert — der Worktree hat kein `.env`, kann also den echten Bot nicht doppelt starten) und ruft darin die Claude-Code-CLI non-interaktiv auf. Nach Abschluss prüft der Code selbst (nicht nur der Prompt), ob Tabu-Dateien angefasst wurden, bevor gepusht wird. Ein Rate-Limiter deckelt auf 5 automatische Läufe/Tag, eine Benachrichtigung schickt Kevin eine DM (außerhalb der Nachtruhe 2–10 Uhr), und das Dashboard zeigt den laufenden/letzten Stand.

**Tech Stack:** Node.js (kein Framework, wie der Rest des Projekts), `node:child_process` (`spawn`, analog `system-werte.js`), `node:fs/promises` + `writeFileAtomic` für alle persistierten Dateien, Discord.js für die DM, git-CLI + Claude-Code-CLI als externe Prozesse. Keine neuen npm-Abhängigkeiten.

**Spec:** [docs/superpowers/specs/2026-09-17-ghostxx-selbstverbesserung-design.md](../specs/2026-09-17-ghostxx-selbstverbesserung-design.md)

## Global Constraints

- Alles auf Deutsch: Variablennamen, Kommentare (Umlaute umschrieben: `fuer`, `nie`), Log-/DM-Texte (Umlaute normal: `für`).
- Kein neues npm-Paket. Nur `node:*`-Module und bestehende Projekt-Module.
- Jede persistierte Datei nutzt `writeFileAtomic` aus `src/atomic-write.js`.
- Jedes neue Modul bekommt eine `tests/<name>.test.js` im bestehenden Runner-Stil (`tests/lib.js`: `check`, `equal`, `finish`, `section`, `useTempData`). Kein Test darf echte Netzwerk-/Prozessaufrufe (git, Claude-CLI, Discord) wirklich ausführen — diese werden per Dependency Injection durch Fake-Funktionen ersetzt.
- Leitplanken aus der Spec sind NICHT verhandelbar und werden, wo technisch möglich, im Code erzwungen statt nur im Prompt behauptet (siehe Task 5).
- `npm test` muss nach jedem Task grün sein, bevor committet wird.

---

### Task 1: Fehlerhistorie in `logger.js` persistierbar machen

**Files:**
- Modify: `src/logger.js`
- Test: `tests/logger.test.js`

**Interfaces:**
- Produces: `onError(listener)` — registriert eine Funktion `(eintrag) => void`, die bei jedem `logError(...)`-Aufruf zusätzlich zum bestehenden In-Memory-Speicher aufgerufen wird, mit `eintrag = { zeit: string (ISO), titel: string, grund: string }`. Ohne registrierten Listener ändert sich nichts am bestehenden Verhalten.

Der Bot selbst schreibt hier NICHTS auf Platte — das bleibt bewusst bei dem Modul, das den Listener registriert (Task 2), damit `logger.js` weiterhin ohne Seiteneffekt in reinen Speicher testbar bleibt (das bestehende `tests/logger.test.js` läuft ohne `useTempData()` und würde sonst reale Dateien im echten `data/`-Ordner anlegen).

- [ ] **Step 1: Fehlschlagenden Test schreiben**

In `tests/logger.test.js`, vor der bestehenden `section('Ansturm wird gebuendelt')`, ergänzen:

```js
section('Fehlerhistorie kann mitgehoert werden');
const gehoerteFehler = [];
logger.onError((eintrag) => gehoerteFehler.push(eintrag));
logError('Erster Testfehler', new Error('Ursache A'));
check('Listener bekam Titel', gehoerteFehler[0]?.titel === 'Erster Testfehler');
check('Listener bekam Grund', gehoerteFehler[0]?.grund?.includes('Ursache A'));
check('Listener bekam Zeit', typeof gehoerteFehler[0]?.zeit === 'string');
```

Dafür oben im Test den kompletten Modul-Export statt nur destrukturierter Funktionen importieren:

```js
const logger = require('../src/logger');
const { logBotEvent, logError, logEvent, setLogClient } = logger;
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

Run: `node tests/logger.test.js`
Expected: FAIL — `logger.onError is not a function`

- [ ] **Step 3: `onError` in `src/logger.js` implementieren**

Nach Zeile `let clientRef = null;` ergänzen:

```js
let errorListener = null;

/**
 * Wird bei jedem logError() zusaetzlich aufgerufen - fuer Module, die eine
 * eigene, ueber Neustarts hinweg persistierte Fehlerhistorie fuehren wollen
 * (siehe selbstbeobachtung.js). logger.js selbst bleibt bewusst ohne
 * Festplattenzugriff, damit bestehende Tests ohne eigenes Datenverzeichnis
 * weiterlaufen.
 */
function onError(listener) {
  errorListener = listener;
}
```

In `logError`, direkt nach dem bestehenden `if (fehler.length > FEHLER_SPEICHER) fehler.shift();`, ergänzen:

```js
  errorListener?.({ zeit: fehler[fehler.length - 1].zeit, titel: title, grund: fehler[fehler.length - 1].grund });
```

Und `onError` in `module.exports` aufnehmen.

- [ ] **Step 4: Test laufen lassen, Erfolg bestätigen**

Run: `node tests/logger.test.js`
Expected: PASS, alle Sections inklusive der neuen.

- [ ] **Step 5: Ganze Testsuite laufen lassen**

Run: `npm test`
Expected: alle 29 (+0, da nur bestehende Datei geändert) Testdateien bestehen.

- [ ] **Step 6: Commit**

```bash
git add src/logger.js tests/logger.test.js
git commit -m "$(cat <<'EOF'
logger: Fehlerhistorie mithoerbar machen

onError() liefert jeden logError()-Aufruf an einen optionalen Listener,
ohne dass logger.js selbst auf Platte schreibt - Grundlage fuer eine
persistierte Fehlerhistorie in selbstbeobachtung.js (Selbstverbesserung
Phase 1), ohne bestehende Tests zu beruehren.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `Gedächtnis/`-Verwaltung

**Files:**
- Create: `src/selbstverbesserung-gedaechtnis.js`
- Test: `tests/selbstverbesserung-gedaechtnis.test.js`

**Interfaces:**
- Produces:
  - `signatur(problemTitel: string): string` — normalisierte Kennung für ein Problem (klein geschrieben, getrimmt).
  - `async istBekannt(sig: string, { seitTagen = 14 } = {}): Promise<boolean>` — `true`, wenn im Gedächtnis ein Eintrag mit dieser Signatur existiert, dessen Status `'offen'` oder `'abgelehnt'` ist UND der jünger als `seitTagen` Tage ist.
  - `async neuerEintrag({ titel, belege }): Promise<{ id: string }>` — legt eine neue Datei an, Status `'offen'`.
  - `async vermerkeSession(id: string, { branch, zusammenfassung, ok, fehler }): Promise<void>`
  - `async vermerkeEntscheidung(id: string, { status: 'angenommen'|'abgelehnt'|'ignoriert', grund }): Promise<void>`
  - `async liste(limit = 20): Promise<Array<object>>` — neueste zuerst, für das Dashboard (Task 8).

**Format:** ein JSON-Dokument pro Problem unter `Gedächtnis/<Berlin-Datum>-<slug>.json` im Projekt-Wurzelverzeichnis (git-versioniert, nicht in `data/` — `data/` ist Fachdaten, `Gedächtnis/` ist Ghostxx' eigene Historie und soll lesbar im Repo landen).

- [ ] **Step 1: Fehlschlagenden Test schreiben**

Create `tests/selbstverbesserung-gedaechtnis.test.js`:

```js
const fs = require('node:fs');
const path = require('node:path');
const { check, equal, finish, section, useTempData } = require('./lib');

const temp = useTempData();
// Gedaechtnis liegt bewusst NICHT unter DATA_DIR, sondern parallel im
// Projekt-Wurzelverzeichnis - dafuer bekommt der Test ein eigenes,
// zufaelliges Wurzelverzeichnis ueber GEDAECHTNIS_ROOT.
process.env.GEDAECHTNIS_ROOT = temp.dir;

const gedaechtnis = require('../src/selbstverbesserung-gedaechtnis');

section('Neuer Eintrag');
let id;
(async () => {
  const angelegt = await gedaechtnis.neuerEintrag({
    titel: 'Fehler in der Event-Schleife',
    belege: [{ zeit: new Date().toISOString(), grund: 'Testfehler' }],
  });
  id = angelegt.id;
  check('Eintrag hat eine Id', typeof id === 'string' && id.length > 0);

  const sig = gedaechtnis.signatur('Fehler in der Event-Schleife');
  check('Direkt danach als bekannt erkannt', await gedaechtnis.istBekannt(sig));
  check('Anderes Problem nicht bekannt', !(await gedaechtnis.istBekannt(gedaechtnis.signatur('Ganz anderes Problem'))));

  section('Session und Entscheidung vermerken');
  await gedaechtnis.vermerkeSession(id, { branch: 'selbstverbesserung/test', zusammenfassung: 'Testfix', ok: true });
  await gedaechtnis.vermerkeEntscheidung(id, { status: 'abgelehnt', grund: 'Testgrund' });

  const liste = await gedaechtnis.liste();
  const eintrag = liste.find((e) => e.id === id);
  check('Eintrag in der Liste', Boolean(eintrag));
  equal('Branch vermerkt', eintrag.session.branch, 'selbstverbesserung/test');
  equal('Entscheidung vermerkt', eintrag.entscheidung.status, 'abgelehnt');

  section('Abgelehnt bleibt bekannt, aeltere Ablehnung nicht');
  check('Nach Ablehnung weiterhin bekannt', await gedaechtnis.istBekannt(sig));
  check('Nach 14 Tagen nicht mehr blockierend', !(await gedaechtnis.istBekannt(sig, { seitTagen: 0 })));

  temp.cleanup();
  finish();
})();
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

Run: `node tests/selbstverbesserung-gedaechtnis.test.js`
Expected: FAIL — `Cannot find module '../src/selbstverbesserung-gedaechtnis'`

- [ ] **Step 3: Modul implementieren**

Create `src/selbstverbesserung-gedaechtnis.js`:

```js
const fs = require('node:fs/promises');
const path = require('node:path');
const { writeFileAtomic } = require('./atomic-write');
const { getBerlinDateStamp } = require('./time');

// Ghostxx' eigenes Gedaechtnis fuer die Selbstverbesserung: ein JSON pro
// erkanntem Problem, git-versioniert im Projekt-Wurzelverzeichnis - bewusst
// NICHT in data/, das ist Fachdaten (Events, Logbuch). Hier steht Ghostxx'
// eigene Historie: was er an sich selbst bemerkt, versucht und Kevin
// entschieden hat.

const wurzel = process.env.GEDAECHTNIS_ROOT || path.resolve(__dirname, '..');
const ordner = path.join(wurzel, 'Gedächtnis');

function signatur(titel) {
  return String(titel || '').trim().toLowerCase();
}

function slug(titel) {
  return String(titel || 'problem')
    .toLowerCase()
    .replace(/[^a-z0-9äöüß]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'problem';
}

async function alleDateien() {
  await fs.mkdir(ordner, { recursive: true });
  const namen = await fs.readdir(ordner);
  return namen.filter((n) => n.endsWith('.json')).map((n) => path.join(ordner, n));
}

async function ladeAlle() {
  const dateien = await alleDateien();
  const eintraege = [];
  for (const datei of dateien) {
    try {
      eintraege.push(JSON.parse(await fs.readFile(datei, 'utf8')));
    } catch {
      // Kaputte Datei ueberspringen statt den ganzen Lauf abzubrechen.
    }
  }
  return eintraege;
}

async function speichere(eintrag) {
  const datei = path.join(ordner, `${eintrag.id}.json`);
  await fs.mkdir(ordner, { recursive: true });
  await writeFileAtomic(datei, JSON.stringify(eintrag, null, 2));
}

async function istBekannt(sig, { seitTagen = 14 } = {}) {
  const grenze = Date.now() - seitTagen * 24 * 60 * 60 * 1000;
  const eintraege = await ladeAlle();

  return eintraege.some((eintrag) => {
    if (signatur(eintrag.problem?.titel) !== sig) return false;
    const status = eintrag.entscheidung?.status || 'offen';
    if (status !== 'offen' && status !== 'abgelehnt') return false;
    return new Date(eintrag.erkanntAm).getTime() >= grenze;
  });
}

async function neuerEintrag({ titel, belege = [] }) {
  const heute = getBerlinDateStamp();
  const id = `${heute}-${slug(titel)}-${Date.now().toString(36).slice(-4)}`;

  const eintrag = {
    id,
    erkanntAm: new Date().toISOString(),
    problem: { titel, belege },
    session: null,
    entscheidung: { status: 'offen', am: null, grund: '' },
  };

  await speichere(eintrag);
  return { id };
}

async function findeEintrag(id) {
  const dateien = await alleDateien();
  const datei = dateien.find((d) => path.basename(d, '.json') === id);
  if (!datei) return null;
  return JSON.parse(await fs.readFile(datei, 'utf8'));
}

async function vermerkeSession(id, { branch, zusammenfassung, ok, fehler = '' }) {
  const eintrag = await findeEintrag(id);
  if (!eintrag) return;
  eintrag.session = { gestartetAm: new Date().toISOString(), branch, zusammenfassung, ok, fehler };
  await speichere(eintrag);
}

async function vermerkeEntscheidung(id, { status, grund = '' }) {
  const eintrag = await findeEintrag(id);
  if (!eintrag) return;
  eintrag.entscheidung = { status, am: new Date().toISOString(), grund };
  await speichere(eintrag);
}

async function liste(limit = 20) {
  const eintraege = await ladeAlle();
  return eintraege
    .sort((a, b) => new Date(b.erkanntAm) - new Date(a.erkanntAm))
    .slice(0, limit);
}

module.exports = {
  istBekannt,
  liste,
  neuerEintrag,
  signatur,
  vermerkeEntscheidung,
  vermerkeSession,
};
```

- [ ] **Step 4: Test laufen lassen, Erfolg bestätigen**

Run: `node tests/selbstverbesserung-gedaechtnis.test.js`
Expected: PASS

- [ ] **Step 5: Ganze Testsuite laufen lassen**

Run: `npm test`
Expected: alle Testdateien bestehen (30 jetzt).

- [ ] **Step 6: `.gitignore` prüfen**

`Gedächtnis/` darf NICHT ignoriert sein (es soll versioniert werden). Kurz `cat .gitignore` prüfen — falls ein zu breites Muster wie `*ächtnis*` oder ähnliches existiert, hier nichts ändern (unwahrscheinlich), sonst weiter.

- [ ] **Step 7: Commit**

```bash
git add src/selbstverbesserung-gedaechtnis.js tests/selbstverbesserung-gedaechtnis.test.js
git commit -m "$(cat <<'EOF'
Gedaechtnis-Verwaltung fuer die Selbstverbesserung

Ein JSON-Eintrag pro erkanntem Problem unter Gedaechtnis/, git-versioniert.
Haelt fest was beobachtet wurde, ob/was eine Session vorgeschlagen hat und
Kevins Entscheidung - damit derselbe Fund nicht wiederholt vorgeschlagen
wird (istBekannt() blockt offene und abgelehnte Eintraege der letzten 14
Tage).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Beobachter — Probleme erkennen

**Files:**
- Create: `src/selbstbeobachtung.js`
- Test: `tests/selbstbeobachtung.test.js`

**Interfaces:**
- Consumes: `logger.onError` (Task 1), `gedaechtnis.signatur`/`istBekannt` (Task 2).
- Produces:
  - `registriereBeobachtung()` — hängt sich per `logger.onError` ein, sammelt persistierte Fehlerhistorie. Wird einmal beim Bot-Start aufgerufen.
  - `async erkenneProblem(): Promise<{ titel: string, belege: Array<{zeit, grund}> } | null>` — liefert ein Problem, wenn ein Fehlertitel `>= 3`-mal innerhalb von 2 Stunden auftrat UND `!(await gedaechtnis.istBekannt(signatur(titel)))`, sonst `null`. Bei mehreren Kandidaten: der mit den meisten Vorkommen.
  - `async crashSchleifeErkannt(): Promise<{ titel: string, belege: Array<{zeit, grund}> } | null>` — liest `logs/bot.log`, erkennt `>= 3` "Bot beendet nach"-Zeilen innerhalb von 2 Stunden, liefert ein Problem-Objekt mit `titel: 'Wiederholte Abstuerze'` oder `null`.

**Persistenz:** eigene Datei `data/selbstbeobachtung-verlauf.json` (Fachdaten-artig, gehört zu `data/`, nicht zu `Gedächtnis/` — das ist Rohmaterial/Zählwerk, kein für Menschen bestimmter Bericht), max. 300 Einträge, älter als 24h werden beim Laden verworfen.

- [ ] **Step 1: Fehlschlagenden Test schreiben**

Create `tests/selbstbeobachtung.test.js`:

```js
const fs = require('node:fs');
const path = require('node:path');
const { check, finish, section, useTempData } = require('./lib');

const temp = useTempData();
process.env.GEDAECHTNIS_ROOT = temp.dir;

const { logError } = require('../src/logger');
const beobachtung = require('../src/selbstbeobachtung');

section('Kein Problem ohne Wiederholung');
beobachtung.registriereBeobachtung();

(async () => {
  logError('Einzelfehler', new Error('einmalig'));
  check('Einzelfehler ergibt kein Problem', (await beobachtung.erkenneProblem()) === null);

  section('Drei gleiche Fehler ergeben ein Problem');
  for (let i = 0; i < 3; i += 1) {
    logError('Wiederholter Fehler', new Error(`Versuch ${i}`));
  }
  const problem = await beobachtung.erkenneProblem();
  check('Problem erkannt', problem?.titel === 'Wiederholter Fehler');
  check('Belege gesammelt', problem?.belege?.length >= 3);

  section('Bereits bekanntes Problem wird nicht erneut gemeldet');
  const gedaechtnis = require('../src/selbstverbesserung-gedaechtnis');
  await gedaechtnis.neuerEintrag({ titel: 'Wiederholter Fehler', belege: problem.belege });
  check('Kein erneuter Fund', (await beobachtung.erkenneProblem()) === null);

  temp.cleanup();
  finish();
})();
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

Run: `node tests/selbstbeobachtung.test.js`
Expected: FAIL — `Cannot find module '../src/selbstbeobachtung'`

- [ ] **Step 3: Modul implementieren**

Create `src/selbstbeobachtung.js`:

```js
const fs = require('node:fs/promises');
const path = require('node:path');
const { onError } = require('./logger');
const { writeFileAtomic } = require('./atomic-write');
const { config } = require('./config');
const { istBekannt, signatur } = require('./selbstverbesserung-gedaechtnis');

// Liest Ghostxx' eigene Fehlerhistorie und Absturzhistorie, und erkennt
// darin ECHTE, wiederkehrende Probleme - nicht jede Einzelmeldung. Ein
// Fehler zaehlt erst als Problem, wenn er sich innerhalb von zwei Stunden
// mehrfach wiederholt (messen, nicht vermuten - siehe CLAUDE.md).

const SCHWELLE = 3;
const FENSTER_MS = 2 * 60 * 60 * 1000;
const MAX_VERLAUF = 300;

const verlaufDatei = path.join(config.dataDir, 'selbstbeobachtung-verlauf.json');
let verlauf = null;

async function ladeVerlauf() {
  if (verlauf) return verlauf;
  try {
    const roh = JSON.parse(await fs.readFile(verlaufDatei, 'utf8'));
    verlauf = Array.isArray(roh.eintraege) ? roh.eintraege : [];
  } catch {
    verlauf = [];
  }
  return verlauf;
}

async function speichereVerlauf() {
  const grenze = Date.now() - FENSTER_MS;
  verlauf = verlauf.filter((e) => new Date(e.zeit).getTime() >= grenze).slice(-MAX_VERLAUF);
  await fs.mkdir(config.dataDir, { recursive: true });
  await writeFileAtomic(verlaufDatei, JSON.stringify({ eintraege: verlauf }, null, 2));
}

/** Einmal beim Bot-Start aufrufen: haengt sich an logger.logError. */
function registriereBeobachtung() {
  onError((eintrag) => {
    ladeVerlauf().then(async (liste) => {
      liste.push(eintrag);
      await speichereVerlauf();
    }).catch(() => null);
  });
}

async function erkenneProblem() {
  const eintraege = await ladeVerlauf();
  const grenze = Date.now() - FENSTER_MS;
  const aktuelle = eintraege.filter((e) => new Date(e.zeit).getTime() >= grenze);

  const proTitel = new Map();
  for (const eintrag of aktuelle) {
    const liste = proTitel.get(eintrag.titel) || [];
    liste.push(eintrag);
    proTitel.set(eintrag.titel, liste);
  }

  let bester = null;
  for (const [titel, belege] of proTitel) {
    if (belege.length < SCHWELLE) continue;
    if (await istBekannt(signatur(titel))) continue;
    if (!bester || belege.length > bester.belege.length) bester = { titel, belege };
  }

  return bester;
}

/**
 * bot.log ist GEMISCHT kodiert (UTF-8 vom Watchdog, UTF-16 vom Bot ueber
 * Tee-Object) - dieselbe NUL-Byte-Behandlung wie in dashboard-daten.js
 * terminal(), hier unabhaengig gehalten, weil beide Module unterschiedliche
 * Ausschnitte brauchen (hier: ganze Datei fuer die letzten 2h, dort: die
 * letzten paar Zeilen fuers Terminal-Fenster).
 */
async function leseBotLog() {
  const datei = path.join(path.dirname(config.dataDir), 'logs', 'bot.log');
  try {
    const roh = await fs.readFile(datei);
    const ohneNull = roh.filter((byte) => byte !== 0);
    return Buffer.from(ohneNull).toString('utf8').split(/\r?\n/);
  } catch {
    return [];
  }
}

const CRASH_ZEILE = /^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\] Bot beendet nach/;

async function crashSchleifeErkannt() {
  const zeilen = await leseBotLog();
  const grenze = Date.now() - FENSTER_MS;

  const crashes = zeilen
    .map((zeile) => zeile.match(CRASH_ZEILE))
    .filter(Boolean)
    .map((treffer) => ({ zeit: new Date(treffer[1].replace(' ', 'T')).toISOString(), grund: treffer[0] }))
    .filter((eintrag) => new Date(eintrag.zeit).getTime() >= grenze);

  if (crashes.length < SCHWELLE) return null;
  if (await istBekannt(signatur('Wiederholte Abstuerze'))) return null;

  return { titel: 'Wiederholte Abstuerze', belege: crashes };
}

module.exports = {
  crashSchleifeErkannt,
  erkenneProblem,
  registriereBeobachtung,
};
```

- [ ] **Step 4: Test laufen lassen, Erfolg bestätigen**

Run: `node tests/selbstbeobachtung.test.js`
Expected: PASS

- [ ] **Step 5: Ganze Testsuite laufen lassen**

Run: `npm test`
Expected: alle Testdateien bestehen (31 jetzt).

- [ ] **Step 6: Commit**

```bash
git add src/selbstbeobachtung.js tests/selbstbeobachtung.test.js
git commit -m "$(cat <<'EOF'
Beobachter: wiederkehrende Fehler und Absturzschleifen erkennen

Haengt sich an logger.onError, haelt eine ueber Neustarts persistierte
Fehlerhistorie (data/selbstbeobachtung-verlauf.json) und meldet ein
Problem erst ab 3 Vorkommen in 2 Stunden - eine Einzelmeldung ist noch
kein Muster. Prueft zusaetzlich gegen das Gedaechtnis, ob es schon
behandelt wurde. crashSchleifeErkannt() liest dieselbe Schwelle aus den
"Bot beendet nach"-Zeilen in logs/bot.log.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Rate-Limit und Nachtruhe

**Files:**
- Create: `src/selbstverbesserung-limit.js`
- Test: `tests/selbstverbesserung-limit.test.js`

**Interfaces:**
- Consumes: `getBerlinDateStamp` aus `src/time.js`.
- Produces:
  - `async darfLaufen(): Promise<{ erlaubt: true } | { erlaubt: false, grund: 'tageslimit' }>` — `false` ab dem 6. automatischen Lauf am selben Berlin-Kalendertag.
  - `async vermerkeLauf(): Promise<void>` — zählt einen Lauf für heute.
  - `async heutigeAnzahl(): Promise<number>`
  - `istNachtruhe(now = new Date()): boolean` — `true` zwischen 02:00 und 10:00 Uhr Berliner Zeit (dieselbe Zeitspanne wie in `tagesrhythmus.js`).

**Persistenz:** `data/selbstverbesserung-limit.json`, Format `{ datum: 'YYYY-MM-DD', anzahl: number }` — bei Datumwechsel automatisch zurückgesetzt.

- [ ] **Step 1: Fehlschlagenden Test schreiben**

Create `tests/selbstverbesserung-limit.test.js`:

```js
const { check, equal, finish, section, useTempData } = require('./lib');

const temp = useTempData();
const limit = require('../src/selbstverbesserung-limit');

section('Nachtruhe');
check('3 Uhr ist Nachtruhe', limit.istNachtruhe(new Date('2026-09-17T02:00:00+02:00')));
check('11 Uhr ist keine Nachtruhe', !limit.istNachtruhe(new Date('2026-09-17T11:00:00+02:00')));

section('Tageslimit');
(async () => {
  for (let i = 0; i < 5; i += 1) {
    const stand = await limit.darfLaufen();
    check(`Lauf ${i + 1} erlaubt`, stand.erlaubt === true);
    await limit.vermerkeLauf();
  }

  const sechster = await limit.darfLaufen();
  check('6. Lauf am selben Tag nicht mehr erlaubt', sechster.erlaubt === false);
  equal('Grund ist Tageslimit', sechster.grund, 'tageslimit');

  equal('Heutige Anzahl ist 5', await limit.heutigeAnzahl(), 5);

  temp.cleanup();
  finish();
})();
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

Run: `node tests/selbstverbesserung-limit.test.js`
Expected: FAIL — Modul fehlt.

- [ ] **Step 3: Modul implementieren**

Create `src/selbstverbesserung-limit.js`:

```js
const fs = require('node:fs/promises');
const path = require('node:path');
const { writeFileAtomic } = require('./atomic-write');
const { config } = require('./config');
const { getBerlinDateStamp, getBerlinParts } = require('./time');

// Deckelt die automatisch gestarteten Selbstverbesserungs-Sessions auf 5 pro
// Tag - passend zum "Alles gedeckelt"-Prinzip der anderen proaktiven Module
// (event-erinnerung.js, meilenstein.js, ...). Ab dem 6. muss Ghostxx erst
// nachfragen, statt einfach weiterzumachen.

const MAX_PRO_TAG = 5;
const datei = path.join(config.dataDir, 'selbstverbesserung-limit.json');

function istNachtruhe(now = new Date()) {
  const { hour } = getBerlinParts(now);
  return hour >= 2 && hour < 10;
}

async function ladeStand() {
  const heute = getBerlinDateStamp();
  try {
    const roh = JSON.parse(await fs.readFile(datei, 'utf8'));
    if (roh.datum === heute) return roh;
  } catch {
    // Keine oder kaputte Datei - bei null startet der Tag bei 0.
  }
  return { datum: heute, anzahl: 0 };
}

async function heutigeAnzahl() {
  return (await ladeStand()).anzahl;
}

async function darfLaufen() {
  const stand = await ladeStand();
  if (stand.anzahl >= MAX_PRO_TAG) return { erlaubt: false, grund: 'tageslimit' };
  return { erlaubt: true };
}

async function vermerkeLauf() {
  const stand = await ladeStand();
  stand.anzahl += 1;
  await fs.mkdir(config.dataDir, { recursive: true });
  await writeFileAtomic(datei, JSON.stringify(stand, null, 2));
}

module.exports = {
  darfLaufen,
  heutigeAnzahl,
  istNachtruhe,
  vermerkeLauf,
};
```

Hinweis: `getBerlinParts` ist in `src/time.js` bereits vorhanden, aber nicht exportiert (siehe Datei) — im selben Schritt in `src/time.js` zu `module.exports` hinzufügen, falls dort noch nicht gelistet. Vorher mit `grep -n "module.exports" src/time.js` prüfen, welche Funktionen schon exportiert werden, und `getBerlinParts` ergänzen, falls es fehlt.

- [ ] **Step 4: Test laufen lassen, Erfolg bestätigen**

Run: `node tests/selbstverbesserung-limit.test.js`
Expected: PASS

- [ ] **Step 5: Ganze Testsuite laufen lassen**

Run: `npm test`
Expected: alle Testdateien bestehen (32 jetzt).

- [ ] **Step 6: Commit**

```bash
git add src/selbstverbesserung-limit.js tests/selbstverbesserung-limit.test.js src/time.js
git commit -m "$(cat <<'EOF'
Rate-Limit und Nachtruhe fuer die Selbstverbesserung

Max. 5 automatisch gestartete Sessions pro Berliner Kalendertag, danach
muss Ghostxx nachfragen statt weiterzumachen. istNachtruhe() (02-10 Uhr)
steuert in einem spaeteren Task, wann die Discord-DM tatsaechlich
rausgeht.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Claude-Code-Session auf isoliertem Branch anstoßen

**Files:**
- Create: `src/selbstverbesserung-session.js`
- Test: `tests/selbstverbesserung-session.test.js`

**Interfaces:**
- Consumes: nichts aus vorherigen Tasks direkt (bekommt das Problem-Objekt vom Aufrufer, Task 6).
- Produces:
  - `async starteSession(problem: { titel, belege }, { ausfuehren = echtAusfuehren } = {}): Promise<{ ok: boolean, branch: string, zusammenfassung: string, fehler: string }>`
  - Der optionale `ausfuehren`-Parameter ist die Dependency-Injection-Stelle für Tests: eine Funktion `(cmd, args, options) => Promise<{ code, stdout, stderr }>`, Standardwert ruft wirklich `node:child_process`.

**Ablauf (real, `ausfuehren` = echter Prozessaufruf):**
1. Branch-Name bauen: `selbstverbesserung/<Berlin-Datum>-<slug>`.
2. `git worktree add <temp-pfad> -b <branch> main` im Projekt-Root ausführen — der Worktree hat dadurch **kein** `.env`/`env` (die sind gitignored, ein frischer Checkout enthält sie nicht), kann den echten Bot also technisch nicht doppelt starten.
3. Prompt-Datei `SELBSTVERBESSERUNG_AUFGABE.md` im Worktree schreiben (Belege, Aufgabenbeschreibung, Tabu-Liste, Anweisung: `npm test` vor dem Commit laufen lassen, eigenen Commit machen aber NICHT pushen, eine Zusammenfassung nach `SELBSTVERBESSERUNG_ZUSAMMENFASSUNG.md` schreiben).
4. Claude-Code-CLI non-interaktiv im Worktree aufrufen: `claude -p "Lies SELBSTVERBESSERUNG_AUFGABE.md und arbeite die Aufgabe ab." --permission-mode acceptEdits` mit `cwd` = Worktree-Pfad, Timeout 20 Minuten (danach Prozess killen, `ok: false`).
5. `SELBSTVERBESSERUNG_ZUSAMMENFASSUNG.md` lesen (falls vorhanden) als `zusammenfassung`, Datei danach löschen (nicht Teil des Fixes).
6. **Harte Prüfung, nicht nur Prompt-Vertrauen:** `git diff --name-only main...HEAD` im Worktree gegen `TABU_MUSTER` prüfen (siehe unten). Treffer → `ok: false`, `fehler: 'Leitplanke verletzt: <Datei>'`, NICHT pushen.
7. Sonst: `git push origin <branch>` im Worktree, `ok: true`.
8. `git worktree remove <temp-pfad> --force` in jedem Fall (auch bei Fehlern) aufräumen.

**TABU_MUSTER** (Dateipfad-Präfixe, aus der Spec/Kevins Leitplanken):
```js
const TABU_MUSTER = [
  'src/event-', 'src/scheduler.js', 'src/storage.js', 'src/archiver.js',
  'src/logbook', 'src/logbuch-', 'src/auszahlung-saetze.js',
  'src/giveaway', 'src/state-', '.env', 'env',
];
```

- [ ] **Step 1: Fehlschlagenden Test schreiben**

Create `tests/selbstverbesserung-session.test.js`:

```js
const { check, equal, finish, section } = require('./lib');
const session = require('../src/selbstverbesserung-session');

section('Erfolgreicher Lauf ohne Tabu-Verstoss');
(async () => {
  const aufrufe = [];
  const fakeAusfuehren = async (cmd, args) => {
    aufrufe.push([cmd, ...args].join(' '));
    if (cmd === 'git' && args[0] === 'diff') {
      return { code: 0, stdout: 'src/harmlos.js\n', stderr: '' };
    }
    if (cmd === 'claude') {
      return { code: 0, stdout: 'fertig', stderr: '' };
    }
    return { code: 0, stdout: '', stderr: '' };
  };

  const ergebnis = await session.starteSession(
    { titel: 'Testproblem', belege: [{ zeit: new Date().toISOString(), grund: 'x' }] },
    { ausfuehren: fakeAusfuehren, leseZusammenfassung: async () => 'Habe X repariert.' },
  );

  check('Session als ok gemeldet', ergebnis.ok === true);
  check('Branch-Name gesetzt', ergebnis.branch.startsWith('selbstverbesserung/'));
  equal('Zusammenfassung uebernommen', ergebnis.zusammenfassung, 'Habe X repariert.');
  check('git push wurde aufgerufen', aufrufe.some((a) => a.startsWith('git push')));
  check('worktree remove wurde aufgerufen', aufrufe.some((a) => a.includes('worktree remove')));

  section('Tabu-Datei angefasst -> automatisch abgelehnt, kein Push');
  const aufrufeTabu = [];
  const fakeAusfuehrenTabu = async (cmd, args) => {
    aufrufeTabu.push([cmd, ...args].join(' '));
    if (cmd === 'git' && args[0] === 'diff') {
      return { code: 0, stdout: 'src/scheduler.js\n', stderr: '' };
    }
    return { code: 0, stdout: '', stderr: '' };
  };

  const ergebnisTabu = await session.starteSession(
    { titel: 'Testproblem 2', belege: [] },
    { ausfuehren: fakeAusfuehrenTabu, leseZusammenfassung: async () => 'x' },
  );

  check('Als nicht ok gemeldet', ergebnisTabu.ok === false);
  check('Grund nennt die Datei', ergebnisTabu.fehler.includes('src/scheduler.js'));
  check('Kein Push bei Tabu-Verstoss', !aufrufeTabu.some((a) => a.startsWith('git push')));
  check('Trotzdem aufgeraeumt', aufrufeTabu.some((a) => a.includes('worktree remove')));

  finish();
})();
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

Run: `node tests/selbstverbesserung-session.test.js`
Expected: FAIL — Modul fehlt.

- [ ] **Step 3: Modul implementieren**

Create `src/selbstverbesserung-session.js`:

```js
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { getBerlinDateStamp } = require('./time');

// Stoesst eine non-interaktive Claude-Code-Session auf einem eigenen,
// isolierten git-worktree an. Der Worktree ist die eigentliche Leitplanke
// gegen "versehentlich den echten Bot doppelt starten" - er hat kein .env,
// also keinen Token. Gegen main/Tabu-Bereiche wird zusaetzlich der
// tatsaechliche Diff geprueft, nicht nur der Prompt vertraut (Kevins
// Leitplanken sollen technisch gelten, nicht nur behauptet werden).

const TABU_MUSTER = [
  'src/event-', 'src/scheduler.js', 'src/storage.js', 'src/archiver.js',
  'src/logbook', 'src/logbuch-', 'src/auszahlung-saetze.js',
  'src/giveaway', 'src/state-', '.env', 'env',
];

const TIMEOUT_MS = 20 * 60 * 1000;
const wurzel = path.resolve(__dirname, '..');

function slug(titel) {
  return String(titel || 'problem')
    .toLowerCase()
    .replace(/[^a-z0-9äöüß]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'problem';
}

function echtAusfuehren(cmd, args, options = {}) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { windowsHide: true, ...options });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      p.kill();
    }, options.timeoutMs || TIMEOUT_MS);

    p.stdout?.on('data', (d) => { stdout += d; });
    p.stderr?.on('data', (d) => { stderr += d; });
    p.on('error', () => { clearTimeout(timer); resolve({ code: -1, stdout, stderr: 'Prozess konnte nicht gestartet werden' }); });
    p.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
}

function baueAufgabe(problem) {
  const belegeText = (problem.belege || [])
    .map((b) => `- ${b.zeit}: ${b.grund}`)
    .join('\n') || '(keine Einzelbelege, siehe Titel)';

  return `# Selbstverbesserung: ${problem.titel}

Ghostxx (dieser Bot) hat an sich selbst folgendes wiederholt beobachtet:

**${problem.titel}**

${belegeText}

## Aufgabe

Finde die Ursache und behebe sie mit einer moeglichst kleinen, fokussierten
Aenderung. Halte dich an CLAUDE.md in diesem Projekt (Sprache, Konventionen,
"messen nicht vermuten").

## Feste Grenzen (nicht verhandelbar)

- Fasse NICHTS in Eventlogik, Zeitplaner oder Auszahlungscode an (u.a.
  src/event-*.js, src/scheduler.js, src/storage.js, src/archiver.js,
  src/logbook*.js, src/logbuch-*.js, src/auszahlung-saetze.js,
  src/giveaway*.js, src/state-*.js). Wenn das Problem dort liegt, beschreibe
  es stattdessen nur in der Zusammenfassung, aendere nichts.
- Fasse .env/env nicht an.
- Fuehre restart-bot.ps1 oder stop-bot.ps1 nicht aus.
- Ein Problem, ein fokussierter Commit. Fuehre \`npm test\` aus und
  committe nur, wenn alle Tests bestehen.
- Push NICHT selbst - das macht die aufrufende Automatisierung.

## Am Ende

Schreibe eine kurze Zusammenfassung (was war das Problem, was hast du
geaendert, ob npm test bestanden hat) in eine neue Datei
SELBSTVERBESSERUNG_ZUSAMMENFASSUNG.md im Projekt-Root.
`;
}

async function pruefeTabu(worktreePfad, ausfuehren) {
  const diff = await ausfuehren('git', ['diff', '--name-only', 'main...HEAD'], { cwd: worktreePfad });
  const dateien = diff.stdout.split(/\r?\n/).map((z) => z.trim()).filter(Boolean);
  const treffer = dateien.find((datei) => TABU_MUSTER.some((muster) => datei.startsWith(muster)));
  return { treffer, dateien };
}

async function leseZusammenfassungStandard(worktreePfad) {
  const datei = path.join(worktreePfad, 'SELBSTVERBESSERUNG_ZUSAMMENFASSUNG.md');
  try {
    const inhalt = await fs.readFile(datei, 'utf8');
    await fs.rm(datei, { force: true });
    return inhalt.trim();
  } catch {
    return '';
  }
}

async function starteSession(problem, { ausfuehren = echtAusfuehren, leseZusammenfassung } = {}) {
  const branch = `selbstverbesserung/${getBerlinDateStamp()}-${slug(problem.titel)}`;
  const worktreePfad = path.join(os.tmpdir(), `ghostxx-${slug(problem.titel)}-${Date.now()}`);

  let ergebnis = { ok: false, branch, zusammenfassung: '', fehler: '' };

  try {
    const angelegt = await ausfuehren('git', ['worktree', 'add', worktreePfad, '-b', branch, 'main'], { cwd: wurzel });
    if (angelegt.code !== 0) {
      return { ...ergebnis, fehler: `Worktree konnte nicht angelegt werden: ${angelegt.stderr}` };
    }

    await fs.writeFile(path.join(worktreePfad, 'SELBSTVERBESSERUNG_AUFGABE.md'), baueAufgabe(problem));

    const lauf = await ausfuehren(
      'claude',
      ['-p', 'Lies SELBSTVERBESSERUNG_AUFGABE.md im Projekt-Root und arbeite die Aufgabe ab.', '--permission-mode', 'acceptEdits'],
      { cwd: worktreePfad },
    );

    const zusammenfassung = leseZusammenfassung
      ? await leseZusammenfassung(worktreePfad)
      : await leseZusammenfassungStandard(worktreePfad);

    if (lauf.code !== 0) {
      return { ...ergebnis, zusammenfassung, fehler: `Claude-Code-Session fehlgeschlagen: ${lauf.stderr || lauf.code}` };
    }

    const { treffer, dateien } = await pruefeTabu(worktreePfad, ausfuehren);
    if (treffer) {
      return { ...ergebnis, zusammenfassung, fehler: `Leitplanke verletzt: ${treffer}` };
    }
    if (!dateien.length) {
      return { ...ergebnis, zusammenfassung, fehler: 'Session hat keine Aenderung committet.' };
    }

    const push = await ausfuehren('git', ['push', 'origin', branch], { cwd: worktreePfad });
    if (push.code !== 0) {
      return { ...ergebnis, zusammenfassung, fehler: `Push fehlgeschlagen: ${push.stderr}` };
    }

    ergebnis = { ok: true, branch, zusammenfassung, fehler: '' };
    return ergebnis;
  } finally {
    await ausfuehren('git', ['worktree', 'remove', worktreePfad, '--force'], { cwd: wurzel }).catch(() => null);
  }
}

module.exports = {
  TABU_MUSTER,
  starteSession,
};
```

- [ ] **Step 4: Test laufen lassen, Erfolg bestätigen**

Run: `node tests/selbstverbesserung-session.test.js`
Expected: PASS

- [ ] **Step 5: Ganze Testsuite laufen lassen**

Run: `npm test`
Expected: alle Testdateien bestehen (33 jetzt).

- [ ] **Step 6: Commit**

```bash
git add src/selbstverbesserung-session.js tests/selbstverbesserung-session.test.js
git commit -m "$(cat <<'EOF'
Claude-Code-Session auf isoliertem Branch anstossen

Legt einen git worktree auf einem eigenen Branch an (kein main, kein
.env im Worktree - kann den echten Bot technisch nicht doppelt starten),
ruft darin die Claude-Code-CLI non-interaktiv auf, und prueft danach den
tatsaechlichen Diff gegen die Tabu-Bereiche (Event-/Zeitplan-/
Auszahlungscode) - nicht nur den Prompt. Bei einem Treffer wird nicht
gepusht, egal was die Session sonst gemacht hat.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Benachrichtigung per Discord-DM

**Files:**
- Create: `src/selbstverbesserung-benachrichtigung.js`
- Test: `tests/selbstverbesserung-benachrichtigung.test.js`

**Interfaces:**
- Consumes: `istNachtruhe` aus Task 4, `config.ownerId`.
- Produces:
  - `setBenachrichtigungClient(client)` — analog `setLogClient`/`setAskClient`.
  - `async benachrichtige({ problem, ergebnis }): Promise<boolean>` — schickt sofort, außer während der Nachtruhe: dann in eine In-Memory-Warteschlange legen und beim nächsten Aufruf von `sendeAusstehende()` nach Nachtruhe-Ende zustellen.
  - `async sendeAusstehende(): Promise<number>` — von Task 7s Tick regelmäßig aufgerufen, sendet zurückgehaltene DMs sobald keine Nachtruhe mehr ist, gibt Anzahl gesendeter zurück.

- [ ] **Step 1: Fehlschlagenden Test schreiben**

Create `tests/selbstverbesserung-benachrichtigung.test.js`:

```js
const { check, finish, section } = require('./lib');
const benachrichtigung = require('../src/selbstverbesserung-benachrichtigung');
const { config } = require('../src/config');

section('Sofortiger Versand ausserhalb der Nachtruhe');
(async () => {
  const gesendet = [];
  benachrichtigung.setBenachrichtigungClient({
    users: {
      fetch: async (id) => ({
        id,
        send: async (payload) => { gesendet.push(payload); },
      }),
    },
  });

  const jetzt = new Date('2026-09-17T14:00:00+02:00');
  const ok = await benachrichtigung.benachrichtige(
    { problem: { titel: 'Testproblem' }, ergebnis: { ok: true, branch: 'x', zusammenfassung: 'y' } },
    { now: jetzt },
  );
  check('Wurde sofort gesendet', ok === true);
  check('Genau eine DM', gesendet.length === 1);
  check('Enthaelt den Titel', JSON.stringify(gesendet[0]).includes('Testproblem'));

  section('Waehrend der Nachtruhe zurueckgehalten, danach zugestellt');
  const nachts = new Date('2026-09-18T03:00:00+02:00');
  const zurueckgehalten = await benachrichtigung.benachrichtige(
    { problem: { titel: 'Nachtproblem' }, ergebnis: { ok: true, branch: 'x', zusammenfassung: 'y' } },
    { now: nachts },
  );
  check('Nicht sofort gesendet', zurueckgehalten === false);
  check('Noch keine zweite DM', gesendet.length === 1);

  const morgens = new Date('2026-09-18T10:30:00+02:00');
  const anzahl = await benachrichtigung.sendeAusstehende({ now: morgens });
  check('Nachtrag zugestellt', anzahl === 1);
  check('Jetzt zwei DMs insgesamt', gesendet.length === 2);

  finish();
})();
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

Run: `node tests/selbstverbesserung-benachrichtigung.test.js`
Expected: FAIL — Modul fehlt.

- [ ] **Step 3: Modul implementieren**

Create `src/selbstverbesserung-benachrichtigung.js`:

```js
const { EmbedBuilder } = require('discord.js');
const { config } = require('./config');
const { istNachtruhe } = require('./selbstverbesserung-limit');

// Persoenliche DM an Kevin statt Discord-Kanal - passt zu "wie ein Kollege,
// der sich meldet". Waehrend der bestehenden Nachtruhe (02-10 Uhr, siehe
// tagesrhythmus.js) wird nicht sofort zugestellt, sondern zurueckgehalten.

let clientRef = null;
const warteschlange = [];

function setBenachrichtigungClient(client) {
  clientRef = client;
}

function baueEmbed({ problem, ergebnis }) {
  const embed = new EmbedBuilder()
    .setColor(ergebnis.ok ? 0x57f287 : 0xed4245)
    .setTitle(ergebnis.ok ? 'Ich hab einen Vorschlag' : 'Ich hab was untersucht, aber nichts brauchbares')
    .setDescription(problem.titel)
    .setTimestamp(new Date());

  const felder = [];
  if (ergebnis.zusammenfassung) felder.push({ name: 'Zusammenfassung', value: ergebnis.zusammenfassung.slice(0, 1024) });
  if (ergebnis.ok) felder.push({ name: 'Branch', value: ergebnis.branch });
  if (ergebnis.fehler) felder.push({ name: 'Warum nichts kam', value: ergebnis.fehler.slice(0, 1024) });

  if (felder.length) embed.addFields(felder);
  return embed;
}

async function sendeJetzt(eintrag) {
  if (!clientRef) return false;
  const user = await clientRef.users.fetch(config.ownerId).catch(() => null);
  if (!user) return false;

  await user.send({ embeds: [baueEmbed(eintrag)] }).catch((error) => {
    console.error('Selbstverbesserungs-DM konnte nicht gesendet werden:', error.message);
  });
  return true;
}

async function benachrichtige(eintrag, { now = new Date() } = {}) {
  if (istNachtruhe(now)) {
    warteschlange.push(eintrag);
    return false;
  }
  return sendeJetzt(eintrag);
}

async function sendeAusstehende({ now = new Date() } = {}) {
  if (istNachtruhe(now) || !warteschlange.length) return 0;

  const anzahl = warteschlange.length;
  while (warteschlange.length) {
    await sendeJetzt(warteschlange.shift());
  }
  return anzahl;
}

module.exports = {
  benachrichtige,
  sendeAusstehende,
  setBenachrichtigungClient,
};
```

- [ ] **Step 4: Test laufen lassen, Erfolg bestätigen**

Run: `node tests/selbstverbesserung-benachrichtigung.test.js`
Expected: PASS

- [ ] **Step 5: Ganze Testsuite laufen lassen**

Run: `npm test`
Expected: alle Testdateien bestehen (34 jetzt).

- [ ] **Step 6: Commit**

```bash
git add src/selbstverbesserung-benachrichtigung.js tests/selbstverbesserung-benachrichtigung.test.js
git commit -m "$(cat <<'EOF'
Discord-DM fuer die Selbstverbesserung, mit Nachtruhe

Kevin bekommt eine persoenliche DM statt einer Kanalnachricht, sobald ein
Vorschlag (oder ein erfolgloser Versuch) fertig ist. Waehrend der
bestehenden Nachtruhe (02-10 Uhr) wird zurueckgehalten und erst danach
zugestellt.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Orchestrator und Einbindung in `index.js`

**Files:**
- Create: `src/selbstverbesserung.js`
- Modify: `src/index.js`
- Test: `tests/selbstverbesserung.test.js`

**Interfaces:**
- Consumes: `registriereBeobachtung`, `erkenneProblem`, `crashSchleifeErkannt` (Task 3), `neuerEintrag`, `vermerkeSession`, `liste` (Task 2), `darfLaufen`, `vermerkeLauf` (Task 4), `starteSession` (Task 5), `benachrichtige`, `sendeAusstehende`, `setBenachrichtigungClient` (Task 6).
- Produces:
  - `async tick({ beobachten, limit, session, benachrichtigung, gedaechtnis } = {})` — eine Runde: ausstehende DMs zustellen, prüfen ob ein Crash-Problem oder Fehler-Problem vorliegt, wenn ja und `darfLaufen()` erlaubt: Gedächtnis-Eintrag anlegen, Session starten, Ergebnis vermerken, benachrichtigen, Lauf zählen. Alle Abhängigkeiten sind per Parameter austauschbar (Default: die echten Module) — das macht den Test möglich, ohne echte Prozesse zu starten.
  - `startSelbstverbesserung(client)` — registriert den Beobachter, setzt den DM-Client, startet ein Intervall (alle 10 Minuten, analog `scheduler.js`s `TICK_MS`-Muster), gibt das Intervall-Handle zurück.

- [ ] **Step 1: Fehlschlagenden Test schreiben**

Create `tests/selbstverbesserung.test.js`:

```js
const { check, finish, section } = require('./lib');
const { tick } = require('../src/selbstverbesserung');

section('Kein Problem -> nichts passiert');
(async () => {
  const aufrufe = [];
  await tick({
    beobachten: { erkenneProblem: async () => null, crashSchleifeErkannt: async () => null },
    limit: { darfLaufen: async () => ({ erlaubt: true }), vermerkeLauf: async () => aufrufe.push('vermerkeLauf') },
    session: { starteSession: async () => { aufrufe.push('starteSession'); return { ok: true, branch: 'x', zusammenfassung: 'y' }; } },
    benachrichtigung: { benachrichtige: async () => aufrufe.push('benachrichtige'), sendeAusstehende: async () => 0 },
    gedaechtnis: { neuerEintrag: async () => { aufrufe.push('neuerEintrag'); return { id: '1' }; }, vermerkeSession: async () => aufrufe.push('vermerkeSession') },
  });
  check('Nichts ausgeloest', aufrufe.length === 0);

  section('Problem gefunden und Limit erlaubt -> volle Kette');
  const aufrufe2 = [];
  await tick({
    beobachten: { erkenneProblem: async () => ({ titel: 'X', belege: [] }), crashSchleifeErkannt: async () => null },
    limit: { darfLaufen: async () => ({ erlaubt: true }), vermerkeLauf: async () => aufrufe2.push('vermerkeLauf') },
    session: { starteSession: async (problem) => { aufrufe2.push(`starteSession:${problem.titel}`); return { ok: true, branch: 'b', zusammenfassung: 'z' }; } },
    benachrichtigung: { benachrichtige: async () => aufrufe2.push('benachrichtige'), sendeAusstehende: async () => 0 },
    gedaechtnis: { neuerEintrag: async () => { aufrufe2.push('neuerEintrag'); return { id: '42' }; }, vermerkeSession: async (id) => aufrufe2.push(`vermerkeSession:${id}`) },
  });
  check('Eintrag angelegt', aufrufe2.includes('neuerEintrag'));
  check('Session gestartet mit richtigem Titel', aufrufe2.includes('starteSession:X'));
  check('Session vermerkt', aufrufe2.includes('vermerkeSession:42'));
  check('Benachrichtigt', aufrufe2.includes('benachrichtige'));
  check('Lauf gezaehlt', aufrufe2.includes('vermerkeLauf'));

  section('Tageslimit erreicht -> keine Session');
  const aufrufe3 = [];
  await tick({
    beobachten: { erkenneProblem: async () => ({ titel: 'X', belege: [] }), crashSchleifeErkannt: async () => null },
    limit: { darfLaufen: async () => ({ erlaubt: false, grund: 'tageslimit' }), vermerkeLauf: async () => aufrufe3.push('vermerkeLauf') },
    session: { starteSession: async () => { aufrufe3.push('starteSession'); return { ok: true }; } },
    benachrichtigung: { benachrichtige: async () => aufrufe3.push('benachrichtige'), sendeAusstehende: async () => 0 },
    gedaechtnis: { neuerEintrag: async () => { aufrufe3.push('neuerEintrag'); return { id: '1' }; }, vermerkeSession: async () => aufrufe3.push('vermerkeSession') },
  });
  check('Keine Session bei erreichtem Limit', !aufrufe3.includes('starteSession'));

  finish();
})();
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

Run: `node tests/selbstverbesserung.test.js`
Expected: FAIL — Modul fehlt.

- [ ] **Step 3: Modul implementieren**

Create `src/selbstverbesserung.js`:

```js
const { logError } = require('./logger');
const beobachtungEcht = require('./selbstbeobachtung');
const limitEcht = require('./selbstverbesserung-limit');
const sessionEcht = require('./selbstverbesserung-session');
const benachrichtigungEcht = require('./selbstverbesserung-benachrichtigung');
const gedaechtnisEcht = require('./selbstverbesserung-gedaechtnis');

const TICK_MS = 10 * 60 * 1000;

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
} = {}) {
  await benachrichtigung.sendeAusstehende();

  const problem = (await beobachten.crashSchleifeErkannt()) || (await beobachten.erkenneProblem());
  if (!problem) return;

  const stand = await limit.darfLaufen();
  if (!stand.erlaubt) return;

  const { id } = await gedaechtnis.neuerEintrag(problem);
  const ergebnis = await session.starteSession(problem);
  await gedaechtnis.vermerkeSession(id, ergebnis);
  await benachrichtigung.benachrichtige({ problem, ergebnis });
  await limit.vermerkeLauf();
}

function startSelbstverbesserung(client) {
  beobachtungEcht.registriereBeobachtung();
  benachrichtigungEcht.setBenachrichtigungClient(client);

  let laeuft = false;
  async function lauf() {
    if (laeuft) return;
    laeuft = true;
    try {
      await tick();
    } catch (error) {
      console.error('Selbstverbesserung-Fehler:', error);
      logError('Fehler in der Selbstverbesserung', error);
    } finally {
      laeuft = false;
    }
  }

  lauf();
  const interval = setInterval(lauf, TICK_MS);
  console.log('Selbstverbesserung laeuft.');
  return interval;
}

module.exports = {
  startSelbstverbesserung,
  tick,
};
```

- [ ] **Step 4: Test laufen lassen, Erfolg bestätigen**

Run: `node tests/selbstverbesserung.test.js`
Expected: PASS

- [ ] **Step 5: In `src/index.js` einbinden**

Import ergänzen (bei den anderen `start*`-Importen):

```js
const { startSelbstverbesserung } = require('./selbstverbesserung');
```

Nach der Zeile `startDashboard(readyClient);` ergänzen:

```js
      // Verstehen -> lernen -> anwenden (Vorschlag): beobachtet eigene
      // Fehler/Abstuerze, schlaegt hoechstens 5x taeglich automatisch einen
      // Fix vor, wendet nie selbst etwas an - siehe docs/superpowers/specs/
      // 2026-09-17-ghostxx-selbstverbesserung-design.md.
      startSelbstverbesserung(readyClient);
```

- [ ] **Step 6: Ganze Testsuite laufen lassen**

Run: `npm test`
Expected: alle Testdateien bestehen (35 jetzt).

- [ ] **Step 7: Bot lokal starten und Log prüfen (kein echter Selbstverbesserungs-Lauf nötig)**

Run: `.\scripts\restart-bot.ps1` dann `.\scripts\bot-status.ps1`
Expected: `Selbstverbesserung laeuft.` erscheint in den letzten Logzeilen, keine neuen Fehler.

- [ ] **Step 8: Commit**

```bash
git add src/selbstverbesserung.js src/index.js tests/selbstverbesserung.test.js
git commit -m "$(cat <<'EOF'
Selbstverbesserung: Orchestrator und Einbindung

tick() verbindet Beobachter, Gedaechtnis, Rate-Limit, Session-Anstoss und
Benachrichtigung zur vollen verstehen-lernen-anwenden(-vorschlagen)-Kette,
alle Abhaengigkeiten austauschbar fuer Tests. startSelbstverbesserung()
laeuft alle 10 Minuten, eingebunden in index.js nach dem Dashboard-Start.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Sichtbarkeit im Dashboard

**Files:**
- Modify: `src/dashboard-daten.js`
- Modify: `src/dashboard-seite.js`
- Test: `tests/dashboard.test.js`

**Interfaces:**
- Consumes: `liste` aus `selbstverbesserung-gedaechtnis.js` (Task 2), `heutigeAnzahl` aus `selbstverbesserung-limit.js` (Task 4).
- Produces: `stand()` (bestehende Funktion) bekommt ein zusätzliches Feld `selbstverbesserung: { heutigeLaeufe: number, letzteEintraege: Array<{ id, titel, erkanntAm, entscheidung }> }`.

- [ ] **Step 1: Fehlschlagenden Test schreiben**

In `tests/dashboard.test.js` (bestehende Datei) eine neue Section ergänzen — vorher kurz die Datei lesen, um Stil/Fake-Client-Aufbau zu übernehmen (`useTempData()`, ein Fake-`client`-Objekt mit den von `stand()` gebrauchten Feldern). Ergänzen:

```js
section('Selbstverbesserung im Dashboard sichtbar');
const gedaechtnis = require('../src/selbstverbesserung-gedaechtnis');
await gedaechtnis.neuerEintrag({ titel: 'Dashboard-Testproblem', belege: [] });

const stand2 = await stand(fakeClient); // fakeClient: siehe bestehenden Testaufbau in dieser Datei
check('selbstverbesserung-Feld vorhanden', Boolean(stand2.selbstverbesserung));
check('Heutige Laeufe ist eine Zahl', typeof stand2.selbstverbesserung.heutigeLaeufe === 'number');
check('Letzter Eintrag sichtbar', stand2.selbstverbesserung.letzteEintraege.some((e) => e.titel === 'Dashboard-Testproblem'));
```

Den genauen Namen des bestehenden Fake-Clients in `tests/dashboard.test.js` beim Umsetzen übernehmen (nicht `fakeClient` erfinden, falls die Datei anders heißt — an die dortige Konvention anpassen).

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

Run: `node tests/dashboard.test.js`
Expected: FAIL — `stand2.selbstverbesserung` ist `undefined`.

- [ ] **Step 3: `stand()` in `src/dashboard-daten.js` erweitern**

Import ergänzen:

```js
const { liste: selbstverbesserungListe } = require('./selbstverbesserung-gedaechtnis');
const { heutigeAnzahl } = require('./selbstverbesserung-limit');
```

In der `stand()`-Funktion, im zurückgegebenen Objekt (vor `schalter: alleSchalter(),`) ergänzen:

```js
    selbstverbesserung: {
      heutigeLaeufe: await heutigeAnzahl().catch(() => 0),
      letzteEintraege: (await selbstverbesserungListe(10).catch(() => [])).map((e) => ({
        id: e.id,
        titel: e.problem?.titel || '',
        erkanntAm: e.erkanntAm,
        entscheidung: e.entscheidung?.status || 'offen',
        branch: e.session?.branch || '',
      })),
    },
```

Und im abschließenden `module.exports` bleibt alles wie gehabt (nur `stand` selbst ändert sich, kein neuer Export nötig).

- [ ] **Step 4: Test laufen lassen, Erfolg bestätigen**

Run: `node tests/dashboard.test.js`
Expected: PASS

- [ ] **Step 5: Dashboard-Seite um eine Kachel ergänzen**

`src/dashboard-seite.js` lesen (nicht Teil dieses Plans im Detail, da rein visuelle HTML/CSS/JS-Ergänzung nach bestehendem Muster) und eine neue Kachel "Selbstverbesserung" nach demselben Aufbau wie die bestehenden Kacheln (z. B. "Fehler" oder "Warnungen") ergänzen: zeigt `heutigeLaeufe / 5`, und pro Eintrag in `letzteEintraege` Titel + Zeitpunkt + Entscheidungsstatus (farblich wie die bestehenden Status-Badges, falls vorhanden). Kein neuer JS-Fetch nötig — die Daten kommen über das bestehende `/api/stand`-Polling.

- [ ] **Step 6: Ganze Testsuite laufen lassen**

Run: `npm test`
Expected: alle Testdateien bestehen (weiterhin 35, da `dashboard.test.js` schon existierte).

- [ ] **Step 7: Bot neu starten und Dashboard von Auge prüfen**

Run: `.\scripts\restart-bot.ps1`

Dann `http://localhost:8787` im Browser öffnen, prüfen: neue Kachel sichtbar, zeigt "0 / 5" (oder passenden Stand), keine JS-Fehler in der Konsole.

- [ ] **Step 8: Commit**

```bash
git add src/dashboard-daten.js src/dashboard-seite.js tests/dashboard.test.js
git commit -m "$(cat <<'EOF'
Dashboard: Selbstverbesserung sichtbar machen

Neue Kachel zeigt heutige automatische Laeufe (von max. 5) und die
letzten Gedaechtnis-Eintraege mit Entscheidungsstatus - rein lesend,
wie der Rest des Dashboards.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Manuelle Verifikation nach Task 7 (vor dem ersten echten automatischen Lauf)

Diese Schritte sind kein Task mit Checkboxen, weil sie echtes Geld/echte Infrastruktur berühren — von Kevin selbst auszuführen, nicht automatisiert:

1. Prüfen, dass die installierte Claude-Code-CLI auf diesem Rechner tatsächlich `claude -p "<text>" --permission-mode acceptEdits` non-interaktiv unterstützt (Version/Flags können vom Stand dieses Plans abweichen) — einmal von Hand in einem Testverzeichnis ausprobieren, nicht direkt im Ghostxx-Repo.
2. Einmal `starteSession()` mit einem künstlichen, harmlosen Problem manuell aus einer Node-REPL heraus auslösen und den kompletten Ablauf (Branch, Push, Tabu-Prüfung, Aufräumen) beobachten, bevor der Scheduler es automatisch tut.
3. Erst danach `startSelbstverbesserung` im echten Betrieb laufen lassen.

## Self-Review

- **Spec-Abdeckung:** Beobachter (Task 3), Gedächtnis (Task 2), Auslösen+Rate-Limit+Nachtruhe (Task 4/5/7), Sichtbarkeit Dashboard+DM (Task 6/8), alle 5 Leitplanken technisch verankert (Branch-only + Tabu-Diff-Check in Task 5, kein Restart weil Worktree ohne echten Prozesszugriff, kein `.env`-Zugriff weil Worktree keins hat, ein Problem pro Branch durch Design) — abgedeckt.
- **Platzhalter-Scan:** keine TBD/TODO; der einzige bewusst offene Punkt (exakte CLI-Flags der installierten Claude-Code-Version) ist explizit als manueller Verifikationsschritt nach Task 7 markiert, nicht als Lücke im Code.
- **Typ-Konsistenz:** `starteSession(problem, { ausfuehren, leseZusammenfassung })` → `{ ok, branch, zusammenfassung, fehler }` wird in Task 6/7 konsistent verwendet; `neuerEintrag({ titel, belege })` → `{ id }` ebenso.
