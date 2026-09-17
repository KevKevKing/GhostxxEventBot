const { spawn, exec } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { getBerlinDateStamp } = require('./time');

// Stoesst eine non-interaktive Claude-Code-Session auf einem eigenen,
// isolierten git-worktree an. Zwei Dinge sind TATSAECHLICH garantiert, mehr
// nicht: (1) im Worktree liegt keine .env-Datei (gitignored, ein frischer
// Checkout enthaelt sie nicht), (2) der Kindprozess bekommt ein bereinigtes
// Environment ohne DISCORD_TOKEN/BOT_TOKEN/TOKEN (echtAusfuehren() filtert
// das explizit heraus - ohne diesen Filter wuerde Node das komplette
// process.env des laufenden Bots vererben, inklusive Token, egal ob im
// Worktree eine .env liegt). Zusammen verhindert das, dass ein `node
// src/index.js` im Worktree sich mit dem echten Token einloggen und den Bot
// doppelt starten koennte. Gegen main/Tabu-Bereiche wird zusaetzlich der
// tatsaechliche Diff geprueft, nicht nur der Prompt vertraut (Kevins
// Leitplanken sollen technisch gelten, nicht nur behauptet werden).

const TABU_MUSTER = [
  'src/event-', 'src/scheduler.js', 'src/storage.js', 'src/archiver.js',
  'src/logbook', 'src/logbuch-', 'src/auszahlung-saetze.js',
  'src/giveaway', 'src/state-', '.env', 'env',
];

// Namen, unter denen der echte Discord-Token in process.env stehen kann
// (siehe getToken() in config.js). Werden vor jedem Kindprozess entfernt.
const TOKEN_UMGEBUNGSVARIABLEN = ['DISCORD_TOKEN', 'BOT_TOKEN', 'TOKEN'];

const TIMEOUT_MS = 20 * 60 * 1000;
const wurzel = path.resolve(__dirname, '..');

function slug(titel) {
  return String(titel || 'problem')
    .toLowerCase()
    .replace(/[^a-z0-9äöüß]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'problem';
}

function bereinigteUmgebung() {
  const env = { ...process.env };
  for (const name of TOKEN_UMGEBUNGSVARIABLEN) {
    delete env[name];
  }
  return env;
}

function killeHartUnterWindows(pid) {
  // p.kill() (SIGTERM) beendet unter Windows nur den direkten Kindprozess,
  // nicht dessen eigene Unterprozesse (z.B. wenn die Claude-CLI selbst npm
  // oder git startet) - die wuerden als Waisen weiterlaufen und sich die GPU
  // mit GTA teilen. taskkill mit /T beendet den ganzen Prozessbaum.
  exec(`taskkill /PID ${pid} /T /F`, () => {
    // Fehler hier ignorieren - z.B. wenn der Prozess schon beendet ist.
  });
}

function echtAusfuehren(cmd, args, options = {}) {
  return new Promise((resolve) => {
    let p;
    try {
      p = spawn(cmd, args, { windowsHide: true, ...options, env: options.env || bereinigteUmgebung() });
    } catch (fehler) {
      // Ein synchroner Wurf (z.B. bei kaputten Argumenten) soll nie das
      // zurueckgegebene Promise rejecten - starteSession() erwartet immer
      // {code, stdout, stderr}.
      resolve({ code: -1, stdout: '', stderr: `Prozess konnte nicht gestartet werden: ${fehler.message}` });
      return;
    }

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      if (process.platform === 'win32' && p.pid) {
        killeHartUnterWindows(p.pid);
      } else {
        p.kill();
      }
    }, options.timeoutMs || TIMEOUT_MS);

    p.stdout?.on('data', (d) => { stdout += d; });
    p.stderr?.on('data', (d) => { stderr += d; });
    p.on('error', () => { clearTimeout(timer); resolve({ code: -1, stdout, stderr: 'Prozess konnte nicht gestartet werden', timedOut }); });
    p.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        code,
        stdout,
        stderr: timedOut ? `Zeitueberschreitung nach ${Math.round((options.timeoutMs || TIMEOUT_MS) / 60000)} Minuten` : stderr,
        timedOut,
      });
    });
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
- Starte den Bot nicht, auch nicht direkt mit \`node src/index.js\` oder
  \`npm start\`.
- Ein Problem, ein fokussierter Commit. Fuehre \`npm test\` aus und
  committe nur, wenn alle Tests bestehen.
- Push NICHT selbst - das macht die aufrufende Automatisierung.

## Am Ende

Schreibe eine kurze Zusammenfassung (was war das Problem, was hast du
geaendert, ob npm test bestanden hat) in eine neue Datei
SELBSTVERBESSERUNG_ZUSAMMENFASSUNG.md im Projekt-Root.
`;
}

// Diese Pruefung ist bewusst post-hoc: sie laeuft NACH dem Claude-Code-Lauf,
// nicht in einer Sandbox waehrend dessen. Technisch koennte die Session
// selbst pushen oder main veraendern, bevor diese Funktion ueberhaupt
// aufgerufen wird. Das ist eine bewusste Design-Entscheidung (Diff-Pruefung
// statt Prozess-Sandboxing) - das Restrisiko besteht und wird hier bewusst
// nicht durch echtes Sandboxing geschlossen.
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

    // mkdir zusaetzlich zu "git worktree add": im echten Lauf legt git das
    // Verzeichnis schon an, aber bei injiziertem `ausfuehren` (Tests) tut es
    // das nicht - defensiv also selbst dafuer sorgen, dass es existiert.
    await fs.mkdir(worktreePfad, { recursive: true });
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
      const fehlerText = lauf.timedOut
        ? lauf.stderr
        : `Claude-Code-Session fehlgeschlagen: ${lauf.stderr || lauf.code}`;
      return { ...ergebnis, zusammenfassung, fehler: fehlerText };
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
