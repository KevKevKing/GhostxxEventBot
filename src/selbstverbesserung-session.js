const { spawn, exec } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { getBerlinDateStamp } = require('./time');

// Stoesst eine non-interaktive Claude-Code-Session auf einem eigenen,
// isolierten git-worktree an.
//
// Was hier TATSAECHLICH schuetzt, ehrlich aufgezaehlt:
//
//   1. Env-Sanitizing (bereinigteUmgebung): der Kindprozess bekommt kein
//      DISCORD_TOKEN/BOT_TOKEN/TOKEN. Ohne diesen Filter wuerde Node das
//      komplette process.env des laufenden Bots vererben - dann koennte ein
//      `node src/index.js` im Worktree sich mit dem echten Token einloggen
//      und den Bot doppelt starten. Im Worktree selbst liegt ausserdem keine
//      .env (gitignored, ein frischer Checkout enthaelt sie nicht).
//   2. Der Tabu-Diff: was im Worktree committet wurde, wird gegen
//      TABU_MUSTER geprueft, statt dem Prompt zu vertrauen.
//   3. Die Vorher/Nachher-Pruefung des ECHTEN Checkouts (pruefeWurzel):
//      `git status --porcelain -- data/ src/` im Wurzelverzeichnis vor und
//      nach der Session. Der Worktree liegt unter os.tmpdir(), aber die
//      Session hat vollen Bash-Zugriff und koennte ueber die .git-Datei den
//      Pfad zum echten Checkout finden. Eine Aenderung dort wirkt SOFORT,
//      nicht erst nach einem Neustart - das ist der Fall, an dem laut
//      CLAUDE.md echte Auszahlungen haengen.
//
// Was hier NICHT schuetzt, und das soll so dastehen: ein Prozess mit Bash
// ist ohne echtes Sandboxing grundsaetzlich nicht einsperrbar. Punkt 3 ist
// eine ERKENNUNG, keine Verhinderung - sie schlaegt nach der Tat an, aber
// sie schlaegt wenigstens an, statt dass die Isolation nur behauptet wird.
// Das Restrisiko bleibt und wird bewusst nicht durch Sandboxing geschlossen.

const TABU_MUSTER = [
  'src/event-', 'src/scheduler.js', 'src/storage.js', 'src/archiver.js',
  'src/logbook', 'src/logbuch-', 'src/auszahlung-saetze.js',
  'src/giveaway', 'src/state-', '.env', 'env',
  // Fachdaten und Logs: die Session hat dort nichts zu suchen, weder lesend
  // noch schreibend - in data/ stehen Namen und Spielernummern.
  'data/', 'logs/',
];

// Was im echten Checkout unveraendert bleiben MUSS. Bewusst knapp: data/
// (Fachdaten, wirkt sofort) und src/ (Code des laufenden Bots).
const WURZEL_PFADE = ['data/', 'src/'];

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
  exec(`taskkill /PID ${pid} /T /F`, { env: bereinigteUmgebung() }, () => {
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
- **Arbeite AUSSCHLIESSLICH in diesem Arbeitsverzeichnis.** Wechsle nie in ein
  Elternverzeichnis und nie in einen anderen Checkout desselben Projekts.
  Suche nicht ueber die .git-Datei nach dem echten Arbeitsverzeichnis des
  laufenden Bots. Dort laeuft Ghostxx gerade wirklich - eine Aenderung wirkt
  dort sofort und trifft echte Auszahlungen.
- **Lies und schreibe nirgendwo \`data/\` oder \`logs/\`** - weder hier noch
  irgendwo sonst auf dem Rechner. In data/ stehen Klarnamen und
  Spielernummern von 251 Leuten.
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

/**
 * Zustand des ECHTEN Checkouts als vergleichbarer Text. Wird vor und nach
 * der Session aufgerufen; unterscheiden sich die beiden Ergebnisse, hat die
 * Session ausserhalb ihres Worktrees geschrieben.
 *
 * Bewusst ueber `ausfuehren` und nicht direkt ueber child_process, damit der
 * Test die Antwort steuern kann.
 */
async function pruefeWurzel(ausfuehren) {
  const stand = await ausfuehren('git', ['status', '--porcelain', '--', ...WURZEL_PFADE], { cwd: wurzel });
  // Bei einem Fehler (code != 0) gibt es keinen verwertbaren Zustand. Dann
  // lieber null als eine leere Zeichenkette: null vergleicht sich mit nichts
  // und loest keinen Fehlalarm aus, sagt aber auch kein "alles gut".
  if (stand.code !== 0) return null;
  return stand.stdout.split(/\r?\n/).map((z) => z.trim()).filter(Boolean).sort().join('\n');
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

  // Zustand des echten Checkouts VOR allem anderen festhalten - danach legt
  // "git worktree add" zwar etwas an, aber nichts in data/ oder src/.
  const wurzelVorher = await pruefeWurzel(ausfuehren);

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

    // Der ernsteste denkbare Fehlerfall, deshalb ganz vorn - noch vor der
    // Frage, ob die Session ueberhaupt erfolgreich war. Auch eine
    // abgebrochene oder abgelaufene Session kann vorher am echten Checkout
    // geschrieben haben.
    const wurzelNachher = await pruefeWurzel(ausfuehren);
    if (wurzelVorher !== null && wurzelNachher !== null && wurzelVorher !== wurzelNachher) {
      return {
        ...ergebnis,
        zusammenfassung,
        fehler: 'Session hat den echten Checkout veraendert! '
          + 'git status in data/ oder src/ des Wurzelverzeichnisses sieht nach der Session anders aus als davor. '
          + 'Nichts gepusht. Bitte SOFORT von Hand pruefen: git status und git diff im echten Arbeitsverzeichnis.',
      };
    }

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
