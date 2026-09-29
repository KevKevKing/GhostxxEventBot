# Ghost schlägt selbst Code-Verbesserungen vor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ghost darf von sich aus (kein fester Zeitplan) per DM fragen, ob er sich eine Datei anschauen und einen Verbesserungsvorschlag machen darf — zwei Zustimmungsstufen (vor dem Anschauen, dann zum fertigen Vorschlag), keine automatische Umsetzung.

**Architecture:** Eine neue, einfache Klon-Session (`starteVorschlagsSession`, ohne Branch/Commit/Push/Tabu-Prüfung, weil nichts geschrieben wird) plus ein neues Orchestrierungs-Modul (`src/code-vorschlag.js`), das Rotation, Zustand und die zwei DM-Stufen verwaltet, angebunden an `message-handler.js` (Antwort-Verarbeitung) und `index.js` (Scheduler-Start).

**Tech Stack:** Node.js, kein Framework, eigener Test-Läufer (`tests/lib.js`), keine neuen Abhängigkeiten.

**Spec:** `docs/superpowers/specs/2026-09-29-code-vorschlaege-design.md`

## Global Constraints

- Kein fester Zeitplan, keine Tagesobergrenze — nur eine Mindestpause
  zwischen zwei "darf ich schauen?"-Anfragen (`ANFRAGE_ABSTAND_MS`,
  Vorschlag 3 Stunden), rein als Anti-Spam-Bremse.
- Zweistufiges Ja/Nein: Gate 1 ("darf ich schauen?") vor der Session,
  Gate 2 (Zustimmung zum fertigen Vorschlag) danach. **Keine** der beiden
  Stufen löst jemals eine Code-Änderung aus.
- Höchstens EIN offener Zustand gleichzeitig (`ausstehend`), nie mehrere
  gestapelte Anfragen/Vorschläge.
- `starteVorschlagsSession` committet/pusht nichts, braucht deshalb keinen
  Branch, kein `npm ci`, keine Tabu-Pfad-Prüfung — nur `pruefeWurzel()`
  als Sicherheitsnetz bleibt (wie bei `starteSession()`).
- Gleicher Dashboard-Schalter wie die echte Selbstverbesserung
  (`istAn('selbstverbesserung')`) — kein neuer, eigener Schalter.
- Alles auf Deutsch (Texte, Kommentare mit umschriebenen Umlauten wie
  "fuer" statt "für", deutsche Variablennamen), siehe CLAUDE.md.

---

## Datei-Überblick

- **Modify:** `src/selbstverbesserung-session.js` — neue Funktionen
  `baueVorschlagsAufgabe(dateiPfad)` und `starteVorschlagsSession(dateiPfad, opts)`.
- **Create:** `src/code-vorschlag.js` — Rotation, Zustand, beide DM-Stufen,
  Scheduler.
- **Modify:** `src/message-handler.js` — neuer DM-Antwort-Abschnitt für
  beide Zustimmungsstufen.
- **Modify:** `src/index.js` — `startCodeVorschlag(client)` beim Bot-Start
  aufrufen.
- **Modify:** `tests/selbstverbesserung-session.test.js` — neue Tests für
  `starteVorschlagsSession`.
- **Create:** `tests/code-vorschlag.test.js` — Tests für Rotation,
  Mindestpause, Zustandsübergänge.

---

### Task 1: Neue, einfache Session in `selbstverbesserung-session.js`

**Files:**
- Modify: `src/selbstverbesserung-session.js`
- Test: `tests/selbstverbesserung-session.test.js`

**Interfaces:**
- Consumes: `bereinigteUmgebung()`, `echtAusfuehren()`,
  `passeBefehlFuerPlattformAn()`, `pruefeWurzel(ausfuehren)`,
  `WURZEL_PFADE`, `wurzel` (alle bereits vorhanden, module-intern in
  derselben Datei — kein neuer Import nötig).
- Produces: `starteVorschlagsSession(dateiPfad: string, {ausfuehren?, leseVorschlag?}): Promise<{ok:boolean, vorschlag:string, fehler:string}>`
  und `baueVorschlagsAufgabe(dateiPfad: string): string` — beide neu
  exportiert, genutzt von Task 2.

- [ ] **Step 1: Test schreiben (schlägt fehl)**

Füge in `tests/selbstverbesserung-session.test.js` eine neue Sektion ein
(z.B. direkt vor der Sektion `'Token bleiben dem Kindprozess verborgen'`,
oder ans Ende der Datei vor `finish()` — Platzierung ist nicht kritisch,
solange sie innerhalb der bestehenden async-IIFE liegt, in der auch die
anderen `starteSession`-Tests laufen):

```js
section('Vorschlags-Session: erfolgreicher Lauf');
{
  const aufrufeVorschlag = [];
  const fakeAusfuehrenVorschlag = async (cmd, args) => {
    aufrufeVorschlag.push([cmd, ...args].join(' '));
    if (istRemoteAbfrage(cmd, args)) {
      return { code: 0, stdout: `${REMOTE_URL}\n`, stderr: '' };
    }
    if (cmd === 'claude') {
      return { code: 0, stdout: 'fertig', stderr: '' };
    }
    return { code: 0, stdout: '', stderr: '' };
  };

  const ergebnisVorschlag = await session.starteVorschlagsSession(
    'src/beispiel.js',
    { ausfuehren: fakeAusfuehrenVorschlag, leseVorschlag: async () => 'Konkreter Vorschlag zu src/beispiel.js.' },
  );

  check('Session als ok gemeldet', ergebnisVorschlag.ok === true, ergebnisVorschlag.fehler);
  equal('Vorschlag uebernommen', ergebnisVorschlag.vorschlag, 'Konkreter Vorschlag zu src/beispiel.js.');
  check('kein Branch angelegt', !aufrufeVorschlag.some((a) => a.startsWith('git checkout -b')));
  check('kein npm ci', !aufrufeVorschlag.some((a) => a.startsWith('npm ci')));
  check('kein push', !aufrufeVorschlag.some((a) => a.startsWith('git push')));
  check('Aufgabentext nennt die Datei', session.baueVorschlagsAufgabe('src/beispiel.js').includes('src/beispiel.js'));
  check('Aufgabentext verbietet Aenderungen', /AENDERE KEINE DATEI/i.test(session.baueVorschlagsAufgabe('src/beispiel.js').toUpperCase()));
}

section('Vorschlags-Session: Klon schlaegt fehl -> kein Absturz');
{
  const ergebnisFehler = await session.starteVorschlagsSession(
    'src/beispiel.js',
    {
      ausfuehren: async (cmd, args) => {
        if (istRemoteAbfrage(cmd, args)) return { code: 0, stdout: `${REMOTE_URL}\n`, stderr: '' };
        if (cmd === 'git' && args[0] === 'clone') return { code: 1, stdout: '', stderr: 'kaputt' };
        return { code: 0, stdout: '', stderr: '' };
      },
    },
  );
  check('Kein Absturz, ok:false', ergebnisFehler.ok === false);
  check('Fehlertext vorhanden', ergebnisFehler.fehler.includes('Klon'));
}

section('Vorschlags-Session: leerer Vorschlag zaehlt als Fehler');
{
  const ergebnisLeer = await session.starteVorschlagsSession(
    'src/beispiel.js',
    {
      ausfuehren: async (cmd, args) => {
        if (istRemoteAbfrage(cmd, args)) return { code: 0, stdout: `${REMOTE_URL}\n`, stderr: '' };
        if (cmd === 'claude') return { code: 0, stdout: '', stderr: '' };
        return { code: 0, stdout: '', stderr: '' };
      },
      leseVorschlag: async () => '',
    },
  );
  check('Kein Vorschlag -> ok:false', ergebnisLeer.ok === false);
}
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

Run: `node tests/selbstverbesserung-session.test.js`
Expected: FAIL — `session.starteVorschlagsSession is not a function`

- [ ] **Step 3: Funktionen implementieren**

Füge in `src/selbstverbesserung-session.js`, **nach** der bestehenden
`baueAufgabe()`-Funktion (endet bei `` `SELBSTVERBESSERUNG_ZUSAMMENFASSUNG.md
im Projekt-Root.\n`;\n}\` ``, aktuell um Zeile 374) und **vor** `pruefeTabu()`,
folgendes ein:

```js
const CODE_VORSCHLAG_PROMPT = 'Lies-CODE_VORSCHLAG_AUFGABE.md-im-Projekt-Root-und-schreibe-den-Vorschlag';

function baueVorschlagsAufgabe(dateiPfad) {
  return `# Code-Vorschlag: ${dateiPfad}

Lies dir \`${dateiPfad}\` in diesem Projekt an - und alles andere im
Projekt, was du zum Verstehen brauchst (verwandte Module, Tests,
CLAUDE.md). Du darfst frei im Projekt lesen, nicht nur diese eine Datei.

## Aufgabe

Schreibe GENAU EINEN konkreten, ehrlichen Verbesserungsvorschlag in
\`CODE_VORSCHLAG.md\` im Projekt-Root. Sei konkret (Datei, ungefaehre
Stelle, was genau du aendern wuerdest und warum) - kein allgemeines
"koennte sauberer sein". Faellt dir nichts Nennenswertes auf, schreibe
stattdessen genau \`(nichts Nennenswertes)\` hinein.

WICHTIG: AENDERE KEINE DATEI, committe nichts, fuehre keine Tests aus - du
sollst nur lesen und EINEN Vorschlag aufschreiben, nichts umsetzen.

Halte dich an CLAUDE.md in diesem Projekt (Sprache, "messen nicht
vermuten").
`;
}

async function leseVorschlagStandard(klonPfad) {
  const datei = path.join(klonPfad, 'CODE_VORSCHLAG.md');
  try {
    const inhalt = await fs.readFile(datei, 'utf8');
    return inhalt.trim();
  } catch {
    return '';
  }
}

/**
 * Deutlich einfacher als starteSession(): es wird nie committet oder
 * gepusht, deshalb kein Branch, kein npm ci, keine Tabu-Pruefung. Der
 * komplette Klon wird am Ende gelöscht, unabhaengig davon, was darin
 * geschah - nur CODE_VORSCHLAG.md wird vorher ausgelesen.
 */
async function starteVorschlagsSession(dateiPfad, { ausfuehren = echtAusfuehren, leseVorschlag } = {}) {
  const klonPfad = path.join(os.tmpdir(), `ghostxx-vorschlag-${Date.now()}`);
  let ergebnis = { ok: false, vorschlag: '', fehler: '' };

  const wurzelVorher = await pruefeWurzel(ausfuehren);

  try {
    const remote = await ausfuehren('git', ['remote', 'get-url', 'origin'], { cwd: wurzel });
    const remoteUrl = remote.code === 0 ? remote.stdout.trim() : '';
    if (!remoteUrl) {
      return { ...ergebnis, fehler: `Remote-URL von origin nicht lesbar: ${remote.stderr || remote.code}` };
    }

    const angelegt = await ausfuehren(
      'git',
      ['clone', '--branch', 'main', '--single-branch', remoteUrl, klonPfad],
      { cwd: os.tmpdir() },
    );
    if (angelegt.code !== 0) {
      return { ...ergebnis, fehler: `Klon konnte nicht angelegt werden: ${angelegt.stderr}` };
    }

    await fs.mkdir(klonPfad, { recursive: true });

    await fs.writeFile(path.join(klonPfad, 'CODE_VORSCHLAG_AUFGABE.md'), baueVorschlagsAufgabe(dateiPfad));

    const lauf = await ausfuehren(
      'claude',
      ['-p', CODE_VORSCHLAG_PROMPT, '--permission-mode', 'bypassPermissions'],
      { cwd: klonPfad },
    );

    const vorschlag = leseVorschlag
      ? await leseVorschlag(klonPfad)
      : await leseVorschlagStandard(klonPfad);

    const wurzelNachher = await pruefeWurzel(ausfuehren);
    if (wurzelVorher !== null && wurzelNachher !== null && wurzelVorher !== wurzelNachher) {
      return {
        ...ergebnis,
        fehler: 'Session hat den echten Checkout veraendert! '
          + `git status in ${WURZEL_PFADE.join(', ')} des Wurzelverzeichnisses sieht nach der Session anders aus als davor. `
          + 'Bitte SOFORT von Hand pruefen: git status und git diff im echten Arbeitsverzeichnis.',
      };
    }

    if (lauf.code !== 0) {
      const fehlerText = lauf.timedOut
        ? lauf.stderr
        : `Claude-Code-Session fehlgeschlagen: ${lauf.stderr || lauf.code}`;
      return { ...ergebnis, fehler: fehlerText };
    }

    if (!vorschlag) {
      return { ...ergebnis, fehler: 'Session hat keinen Vorschlag geschrieben.' };
    }

    ergebnis = { ok: true, vorschlag, fehler: '' };
    return ergebnis;
  } finally {
    try {
      await fs.rm(klonPfad, { recursive: true, force: true });
    } catch {
      // siehe starteSession(): Aufraeumen darf das Ergebnis nicht kippen.
    }
  }
}
```

Ergänze `module.exports` (aktuell endend bei `baueAufgabe,` und `starteSession,`
vor der schließenden `};`) um zwei weitere Einträge direkt nach `starteSession,`:

```js
  baueVorschlagsAufgabe,
  starteVorschlagsSession,
```

- [ ] **Step 4: Test laufen lassen, Erfolg bestätigen**

Run: `node tests/selbstverbesserung-session.test.js`
Expected: PASS — alle Checks `OK`, inklusive der drei neuen Abschnitte.

- [ ] **Step 5: Ganze Testsuite laufen lassen**

Run: `npm test`
Expected: PASS — alle 53 Testdateien grün.

- [ ] **Step 6: Commit**

```bash
git add src/selbstverbesserung-session.js tests/selbstverbesserung-session.test.js
git commit -m "Selbstverbesserung: einfache Vorschlags-Session ohne Commit/Push

starteVorschlagsSession() klont, laesst eine Claude-Code-Session nur einen
Text-Vorschlag schreiben (keine Aenderung, kein Commit, kein Push), liest
ihn aus und loescht den Klon wieder. Noch nicht angebunden."
```

---

### Task 2: Orchestrierung in `src/code-vorschlag.js`

**Files:**
- Create: `src/code-vorschlag.js`
- Test: `tests/code-vorschlag.test.js`

**Interfaces:**
- Consumes: `starteVorschlagsSession(dateiPfad, opts)` aus Task 1
  (`./selbstverbesserung-session`), `aktuellerLauf()` aus
  `./selbstverbesserung`, `istAn(key)` aus `./steuerung`, `config` aus
  `./config`, `writeFileAtomic` aus `./atomic-write`, `logError` aus
  `./logger`.
- Produces (alle neu, genutzt von Task 3):
  - `setClient(client): void`
  - `holeAusstehend(): Promise<{art:'anfrage'|'vorschlag', datei:string, vorschlag:string|null, gesendetAm:string} | null>`
  - `vermerkeAbgelehnteAnfrage(): Promise<void>`
  - `starteUndSendeVorschlag(dateiPfad: string): Promise<void>`
  - `vermerkeEntscheidung(status: 'angenommen'|'abgelehnt'): Promise<void>`
  - `startCodeVorschlag(client): void`

- [ ] **Step 1: Test schreiben (schlägt fehl, weil die Datei noch nicht existiert)**

Erstelle `tests/code-vorschlag.test.js`:

```js
const path = require('node:path');
const { check, equal, finish, section, useTempData } = require('./lib');

const temp = useTempData();

const codeVorschlag = require('../src/code-vorschlag');

section('naechsteDatei: rotiert durch eine Liste');
(async () => {
  const liste = ['a.js', 'b.js', 'c.js'];
  const ersteDatei = await codeVorschlag.naechsteDatei({ listeSrcDateien: async () => liste, zuletztVorgeschlagen: null });
  equal('erste Datei ohne Vorgeschichte', ersteDatei, 'a.js');

  const naechsteNachA = await codeVorschlag.naechsteDatei({ listeSrcDateien: async () => liste, zuletztVorgeschlagen: 'a.js' });
  equal('nach a.js kommt b.js', naechsteNachA, 'b.js');

  const naechsteNachC = await codeVorschlag.naechsteDatei({ listeSrcDateien: async () => liste, zuletztVorgeschlagen: 'c.js' });
  equal('nach dem Ende wieder von vorne', naechsteNachC, 'a.js');

  const naechsteNachUnbekannt = await codeVorschlag.naechsteDatei({ listeSrcDateien: async () => liste, zuletztVorgeschlagen: 'geloescht.js' });
  equal('unbekannte zuletzt-Datei -> von vorne', naechsteNachUnbekannt, 'a.js');

  section('darfFragen: Mindestpause und offener Zustand');
  check('darf fragen, wenn noch nie gefragt wurde', await codeVorschlag.darfFragen());

  await codeVorschlag.sendeAnfrage({
    naechsteDatei: async () => 'beispiel.js',
    sendeDm: async () => {},
  });
  check('darf NICHT fragen, solange eine Anfrage offen ist', !(await codeVorschlag.darfFragen()));

  const ausstehendNachAnfrage = await codeVorschlag.holeAusstehend();
  equal('Art ist anfrage', ausstehendNachAnfrage.art, 'anfrage');
  equal('richtige Datei gemerkt', ausstehendNachAnfrage.datei, 'beispiel.js');

  await codeVorschlag.vermerkeAbgelehnteAnfrage();
  check('nach Ablehnung nichts mehr ausstehend', (await codeVorschlag.holeAusstehend()) === null);
  check('darf trotzdem noch nicht sofort wieder fragen (Mindestpause)', !(await codeVorschlag.darfFragen()));

  section('starteUndSendeVorschlag: Erfolg fuehrt zu ausstehendem Vorschlag');
  const gesendeteDms = [];
  await codeVorschlag.starteUndSendeVorschlag('beispiel2.js', {
    starteSession: async () => ({ ok: true, vorschlag: 'Mach X anders.' }),
    sendeDm: async (text) => { gesendeteDms.push(text); },
  });
  const ausstehendNachVorschlag = await codeVorschlag.holeAusstehend();
  equal('Art ist vorschlag', ausstehendNachVorschlag.art, 'vorschlag');
  equal('Vorschlagstext gemerkt', ausstehendNachVorschlag.vorschlag, 'Mach X anders.');
  check('DM mit dem Vorschlag verschickt', gesendeteDms.some((t) => t.includes('Mach X anders.')));

  section('vermerkeEntscheidung: landet im Verlauf, ausstehend wird geleert');
  await codeVorschlag.vermerkeEntscheidung('angenommen');
  check('nichts mehr ausstehend', (await codeVorschlag.holeAusstehend()) === null);

  section('starteUndSendeVorschlag: Fehlschlag meldet sich per DM, kein ausstehender Vorschlag');
  const fehlerDms = [];
  await codeVorschlag.starteUndSendeVorschlag('beispiel3.js', {
    starteSession: async () => ({ ok: false, vorschlag: '', fehler: 'kaputt' }),
    sendeDm: async (text) => { fehlerDms.push(text); },
  });
  check('Fehler-DM verschickt', fehlerDms.some((t) => t.includes('kaputt') || t.toLowerCase().includes('nicht geklappt')));
  check('kein ausstehender Vorschlag nach Fehlschlag', (await codeVorschlag.holeAusstehend()) === null);

  temp.cleanup();
  finish();
})();
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

Run: `node tests/code-vorschlag.test.js`
Expected: FAIL — `Cannot find module '../src/code-vorschlag'`

- [ ] **Step 3: Modul implementieren**

Erstelle `src/code-vorschlag.js`:

```js
const fs = require('node:fs/promises');
const path = require('node:path');
const { config } = require('./config');
const { writeFileAtomic } = require('./atomic-write');
const { logError } = require('./logger');
const { istAn } = require('./steuerung');
const { starteVorschlagsSession } = require('./selbstverbesserung-session');
const { aktuellerLauf } = require('./selbstverbesserung');

// Ghost darf von sich aus fragen, ob er sich eine Datei anschauen und einen
// Verbesserungsvorschlag machen darf - kein fester Zeitplan, keine
// Tagesobergrenze. Zwei Zustimmungsstufen statt einer schuetzen davor,
// dass daraus unbegrenzt haeufige Claude-Code-Sessions werden: erst "darf
// ich schauen?", dann (nur nach einem Ja) die eigentliche Session, dann
// nochmal Zustimmung zum fertigen Vorschlag. Keine der beiden Stufen loest
// jemals eine Code-Aenderung aus - siehe docs/superpowers/specs/
// 2026-09-29-code-vorschlaege-design.md.

const ANFRAGE_ABSTAND_MS = 3 * 60 * 60 * 1000;
const VERLAUF_MAX = 100;
const standDatei = path.join(config.dataDir, 'code-vorschlaege.json');

let dmClient = null;

function setClient(client) {
  dmClient = client;
}

async function ladeStand() {
  try {
    const roh = JSON.parse(await fs.readFile(standDatei, 'utf8'));
    return {
      rotation: roh.rotation || { zuletztVorgeschlagen: null },
      letzteAnfrageAm: roh.letzteAnfrageAm || null,
      ausstehend: roh.ausstehend || null,
      verlauf: Array.isArray(roh.verlauf) ? roh.verlauf : [],
    };
  } catch {
    return { rotation: { zuletztVorgeschlagen: null }, letzteAnfrageAm: null, ausstehend: null, verlauf: [] };
  }
}

async function speichereStand(stand) {
  await fs.mkdir(config.dataDir, { recursive: true });
  await writeFileAtomic(standDatei, JSON.stringify(stand, null, 2));
}

async function listeSrcDateienStandard() {
  const dateien = await fs.readdir(path.join(__dirname));
  return dateien.filter((name) => name.endsWith('.js')).sort();
}

/**
 * Schlaegt vor, welche Datei als Naechstes angefragt wird - reine
 * Rotation, kein Zufall, damit garantiert irgendwann alles einmal
 * drankommt. Das ist nur der Ausgangspunkt der Anfrage-DM: sagt Kevin ja,
 * darf die eigentliche Session danach frei im Repo lesen (siehe
 * baueVorschlagsAufgabe in selbstverbesserung-session.js).
 */
async function naechsteDatei({ listeSrcDateien = listeSrcDateienStandard, zuletztVorgeschlagen } = {}) {
  const dateien = await listeSrcDateien();
  if (!dateien.length) return null;

  let zuletzt = zuletztVorgeschlagen;
  if (zuletzt === undefined) {
    zuletzt = (await ladeStand()).rotation.zuletztVorgeschlagen;
  }

  const index = dateien.indexOf(zuletzt);
  const naechsterIndex = index === -1 ? 0 : (index + 1) % dateien.length;
  return dateien[naechsterIndex];
}

async function darfFragen() {
  const stand = await ladeStand();
  if (stand.ausstehend) return false;
  if (!stand.letzteAnfrageAm) return true;
  return Date.now() - new Date(stand.letzteAnfrageAm).getTime() >= ANFRAGE_ABSTAND_MS;
}

async function holeAusstehend() {
  return (await ladeStand()).ausstehend;
}

async function sendeDmStandard(text) {
  if (!dmClient) throw new Error('Kein Discord-Client gesetzt (setClient() nie aufgerufen?)');
  const user = await dmClient.users.fetch(config.ownerId).catch(() => null);
  if (!user) throw new Error('Owner per DM nicht erreichbar');
  await user.send(text);
}

/**
 * Gate 1: fragt per DM, ob Ghost sich eine Datei anschauen darf. Startet
 * dabei noch KEINE Session - das passiert erst nach Kevins "Ja", siehe
 * starteUndSendeVorschlag().
 */
async function sendeAnfrage({ naechsteDatei: waehleDatei = naechsteDatei, sendeDm = sendeDmStandard } = {}) {
  const dateiName = await waehleDatei();
  if (!dateiName) return null;

  const dateiPfad = `src/${dateiName}`;
  await sendeDm(
    `Ich würde mir gerne ${dateiPfad} anschauen und dir vielleicht einen Verbesserungsvorschlag machen. Ok?\n\n`
    + 'Antworte mit "ja" oder "nein".',
  );

  const stand = await ladeStand();
  stand.rotation = { zuletztVorgeschlagen: dateiName };
  stand.letzteAnfrageAm = new Date().toISOString();
  stand.ausstehend = { art: 'anfrage', datei: dateiPfad, vorschlag: null, gesendetAm: stand.letzteAnfrageAm };
  await speichereStand(stand);
  return dateiPfad;
}

/** Kevin hat "nein" zur Anfrage (Gate 1) gesagt. */
async function vermerkeAbgelehnteAnfrage() {
  const stand = await ladeStand();
  stand.ausstehend = null;
  await speichereStand(stand);
}

/**
 * Kevin hat "ja" zur Anfrage (Gate 1) gesagt: jetzt erst laeuft die
 * eigentliche, lesende Session. Wirft nie - Aufrufer (message-handler.js)
 * ruft das per .catch(() => null) im Hintergrund auf.
 */
async function starteUndSendeVorschlag(dateiPfad, { starteSession = starteVorschlagsSession, sendeDm = sendeDmStandard } = {}) {
  try {
    const stand = await ladeStand();
    stand.ausstehend = null;
    await speichereStand(stand);

    const ergebnis = await starteSession(dateiPfad);

    if (!ergebnis.ok) {
      await sendeDm(`Hat leider nicht geklappt: ${ergebnis.fehler}`).catch(() => null);
      return;
    }

    await sendeDm(
      `${ergebnis.vorschlag}\n\n_Vorschlag zu ${dateiPfad}_\n\n`
      + 'Antworte mit "ja" oder "nein" - "ja" heisst nur "gute Idee, merken", '
      + 'ich aendere dadurch noch nichts automatisch.',
    );

    const standDanach = await ladeStand();
    standDanach.ausstehend = {
      art: 'vorschlag',
      datei: dateiPfad,
      vorschlag: ergebnis.vorschlag,
      gesendetAm: new Date().toISOString(),
    };
    await speichereStand(standDanach);
  } catch (error) {
    console.error('Code-Vorschlag (Session) fehlgeschlagen:', error.message);
    logError('Fehler beim Code-Vorschlag (Session)', error);
  }
}

/** Kevin hat auf den fertigen Vorschlag (Gate 2) geantwortet. */
async function vermerkeEntscheidung(status) {
  const stand = await ladeStand();
  if (!stand.ausstehend) return;
  stand.verlauf.push({ ...stand.ausstehend, status, entschiedenAm: new Date().toISOString() });
  stand.verlauf = stand.verlauf.slice(-VERLAUF_MAX);
  stand.ausstehend = null;
  await speichereStand(stand);
}

async function tick() {
  try {
    if (!istAn('selbstverbesserung')) return;
    if (aktuellerLauf().laeuft) return;
    if (!(await darfFragen())) return;
    await sendeAnfrage();
  } catch (error) {
    console.error('Code-Vorschlag fehlgeschlagen:', error.message);
    logError('Fehler beim Code-Vorschlag', error);
  }
}

function startCodeVorschlag(client) {
  setClient(client);

  let laeuft = false;
  async function lauf() {
    if (laeuft) return;
    laeuft = true;
    try {
      await tick();
    } finally {
      laeuft = false;
    }
  }

  lauf();
  return setInterval(lauf, 10 * 60 * 1000);
}

module.exports = {
  ANFRAGE_ABSTAND_MS,
  darfFragen,
  holeAusstehend,
  naechsteDatei,
  sendeAnfrage,
  setClient,
  startCodeVorschlag,
  starteUndSendeVorschlag,
  vermerkeAbgelehnteAnfrage,
  vermerkeEntscheidung,
};
```

**Hinweis zur Testbarkeit:** `naechsteDatei()` liest im Testaufruf
`zuletztVorgeschlagen` direkt aus den übergebenen Optionen (nicht aus der
Datei), damit die Rotations-Logik ohne Zustands-Nebenwirkung testbar ist -
`sendeAnfrage()` selbst liest/schreibt dagegen den echten Zustand über
`ladeStand()`/`speichereStand()`, wie es der eigentliche Ablauf braucht.
Achte beim Implementieren darauf, dass `DATA_DIR` in den Tests über
`useTempData()` (siehe `tests/lib.js`) gesetzt ist, **bevor**
`require('../src/code-vorschlag')` das erste Mal läuft - `config.dataDir`
wird beim Laden des Moduls ausgewertet, siehe der Kommentar dazu in
`tests/dashboard.test.js`.

- [ ] **Step 4: Test laufen lassen, Erfolg bestätigen**

Run: `node tests/code-vorschlag.test.js`
Expected: PASS — alle Checks `OK`.

- [ ] **Step 5: Ganze Testsuite laufen lassen**

Run: `npm test`
Expected: PASS — alle 54 Testdateien grün (53 bisherige + die neue).

- [ ] **Step 6: Commit**

```bash
git add src/code-vorschlag.js tests/code-vorschlag.test.js
git commit -m "Code-Vorschlag: Rotation, Zustand und zweistufiges Ja/Nein

Neues Modul orchestriert die neue Vorschlags-Session: Gate 1 (darf ich
schauen?) per DM, erst nach einem Ja laeuft die Session, Gate 2 (Zustimmung
zum Vorschlag) danach. Kein fester Zeitplan, nur eine Mindestpause
zwischen zwei Anfragen. Noch nicht angebunden - folgt in Task 3."
```

---

### Task 3: Anbindung in `message-handler.js` und `index.js`

**Files:**
- Modify: `src/message-handler.js`
- Modify: `src/index.js`

**Interfaces:**
- Consumes aus Task 2 (`./code-vorschlag`): `holeAusstehend()`,
  `vermerkeAbgelehnteAnfrage()`, `starteUndSendeVorschlag(dateiPfad)`,
  `vermerkeEntscheidung(status)`, `startCodeVorschlag(client)`.
- Produces: nichts Neues für andere Tasks — Endpunkt der Kette.

**Hinweis zum Testen:** Weder `message-handler.js` noch `index.js` haben
eine eigene Testdatei in diesem Projekt (beide sind eng an einen echten
Discord-Client gekoppelt). Dieser Task wird über einen Syntax-Check und
die volle Testsuite verifiziert, nicht über dedizierte Tests.

- [ ] **Step 1: Import in `message-handler.js` ergänzen**

Suche die bestehende Import-Zeile für `selbstbeobachtung` (aus der
vorherigen Selbstverbesserungs-Erweiterung, `const { vermerkeModellFallback } = require('./selbstbeobachtung');`)
und füge danach eine neue Zeile ein:

```js
const codeVorschlag = require('./code-vorschlag');
```

- [ ] **Step 2: DM-Antwort-Abschnitt einfügen**

Suche in `src/message-handler.js` den bestehenden Block, der mit
`// Antwort auf eine per DM gestellte Frage (siehe frage-erinnerung.js):`
beginnt (die Zeile mit `if (isDm && text && message.author.id === config.ownerId) {`
direkt danach). Füge **davor** einen neuen, eigenen Block ein (eigenes
`if`, eigenes `return` - nicht in den bestehenden Block verschachteln):

```js
  // Antwort auf eine der beiden Code-Vorschlag-Zustimmungsstufen (siehe
  // code-vorschlag.js): "darf ich schauen?" oder der fertige Vorschlag
  // selbst. Muss VOR dem Frage-Erinnerung-Block stehen, sonst wuerde eine
  // Antwort hier faelschlich als Antwort auf eine offene operative Frage
  // gewertet. Beide Zustaende sind selten und ueberschneiden sich in der
  // Praxis kaum.
  if (isDm && text && message.author.id === config.ownerId) {
    const ausstehend = await codeVorschlag.holeAusstehend();
    if (ausstehend) {
      const antwort = text.trim().toLowerCase();
      const istJa = antwort.startsWith('ja');
      const istNein = antwort.startsWith('nein');

      if (!istJa && !istNein) {
        await reply(message, 'Verstehe nur "ja" oder "nein" dazu.');
        return;
      }

      if (ausstehend.art === 'anfrage') {
        if (istNein) {
          await codeVorschlag.vermerkeAbgelehnteAnfrage();
          await reply(message, 'Alles klar, dann nicht.');
          return;
        }
        await reply(message, 'Alles klar, ich schau mir das an und melde mich.');
        codeVorschlag.starteUndSendeVorschlag(ausstehend.datei).catch(() => null);
        return;
      }

      await codeVorschlag.vermerkeEntscheidung(istJa ? 'angenommen' : 'abgelehnt');
      await reply(message, istJa ? 'Gemerkt, danke.' : 'Auch gut, verworfen.');
      return;
    }
  }

```

- [ ] **Step 3: `index.js` verdrahten**

Suche die bestehende Import-Zeile `const { startFrageErinnerung } = require('./frage-erinnerung');`
und füge danach ein:

```js
const { startCodeVorschlag } = require('./code-vorschlag');
```

Suche den Aufruf `startFrageErinnerung(readyClient);` (siehe Kommentar
"Ersetzt die alte 'Er fragt'-Dashboard-Kachel") und füge **danach** ein:

```js

      // Ghost darf von sich aus per DM fragen, ob er sich eine Datei
      // anschauen und einen Verbesserungsvorschlag machen darf - siehe
      // docs/superpowers/specs/2026-09-29-code-vorschlaege-design.md.
      // Kein fester Zeitplan, zwei Zustimmungsstufen, nie automatische
      // Umsetzung. Steht unter demselben Dashboard-Schalter
      // "selbstverbesserung" wie die echte Selbstverbesserung.
      startCodeVorschlag(readyClient);
```

- [ ] **Step 4: Syntax-Check und volle Testsuite laufen lassen**

Run: `node -c src/message-handler.js`
Expected: kein Fehler.

Run: `node -c src/index.js`
Expected: kein Fehler.

Run: `npm test`
Expected: PASS — alle 54 Testdateien grün.

- [ ] **Step 5: Commit**

```bash
git add src/message-handler.js src/index.js
git commit -m "Code-Vorschlag: DM-Antworten verarbeiten, beim Start anschalten

Neuer DM-Antwort-Abschnitt vor dem Frage-Erinnerung-Block verarbeitet
beide Zustimmungsstufen. startCodeVorschlag() laeuft ab jetzt beim
Bot-Start mit, unter demselben Schalter wie die echte Selbstverbesserung."
```

---

## Nach der Umsetzung

- Live beobachten: kommt tatsächlich irgendwann eine "darf ich mir X
  anschauen?"-DM an, und funktioniert der ganze Ablauf bis zum fertigen
  Vorschlag? Das ist der erste echte End-to-End-Beweis für dieses Feature.
- Der Umstieg auf "ja beim Vorschlag = automatische Umsetzung" (siehe
  Spec-Zusammenfassung) ist eine spätere, eigene Änderung - nicht Teil
  dieses Plans.
