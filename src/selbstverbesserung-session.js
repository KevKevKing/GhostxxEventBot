const { spawn, exec } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { getBerlinDateStamp } = require('./time');

// Stoesst eine non-interaktive Claude-Code-Session auf einem eigenen,
// eigenstaendigen Klon des Projekts an (nicht auf einem git-worktree, siehe
// Punkt 3).
//
// Was hier TATSAECHLICH schuetzt, ehrlich aufgezaehlt:
//
//   1. Env-Sanitizing (bereinigteUmgebung): der Kindprozess bekommt kein
//      DISCORD_TOKEN/BOT_TOKEN/TOKEN. Ohne diesen Filter wuerde Node das
//      komplette process.env des laufenden Bots vererben - dann koennte ein
//      `node src/index.js` im Klon sich mit dem echten Token einloggen
//      und den Bot doppelt starten. Im Klon selbst liegt ausserdem keine
//      .env (gitignored, ein frischer Checkout enthaelt sie nicht).
//   2. Der Tabu-Diff: was im Klon committet wurde, wird gegen
//      TABU_MUSTER geprueft, statt dem Prompt zu vertrauen.
//   3. Klon statt Worktree: `git worktree add` legt im Arbeitsverzeichnis
//      eine .git-DATEI an, in der woertlich der Pfad zum echten lokalen
//      Checkout steht (`gitdir: C:/.../GhostxxEventBot/.git/worktrees/...`).
//      Ein einziges `cat .git` haette der Session also verraten, wo der
//      laufende Bot auf der Platte liegt - genau das, was der Prompt ihr
//      verbietet. Ein `git clone <remote-url>` erzeugt dagegen ein
//      eigenstaendiges Repository, dessen .git nur die GitHub-URL kennt.
//      Wichtig: geklont wird vom REMOTE, nie vom lokalen Pfad - ein
//      `git clone <lokaler pfad>` wuerde denselben Pfad in
//      .git/config als origin hinterlegen und nichts gewinnen.
//      Dazu gehoert der Pfad-Filter in bereinigteUmgebung(): npm setzt
//      beim Start des Bots INIT_CWD und ein Dutzend npm_*-Variablen auf den
//      echten Checkout-Pfad, die werden mit entfernt.
//
//      ABER - und das ist wichtiger als der Fix selbst: der echte Pfad ist
//      damit NICHT unauffindbar geworden. Die Claude-CLI legt in
//      ~/.claude/projects/ pro Projekt einen Ordner an, dessen NAME den Pfad
//      kodiert (`C--Users-kevin-Desktop-GhostxxEventBot`). Ein
//      `ls ~/.claude/projects` verraet ihn also weiterhin, und das laesst
//      sich nicht schliessen, ohne der CLI ihr eigenes Zuhause wegzunehmen.
//      Was der Klon wirklich leistet: er schliesst den BEILAEUFIGEN Weg -
//      die .git-Datei lag im Arbeitsverzeichnis, ein `cat .git` beim
//      Umsehen haette gereicht, voellig ohne Absicht. Wer den Pfad gezielt
//      sucht, findet ihn nach wie vor. Das ist ein bestehendes Restrisiko,
//      keine geschlossene Luecke.
//      Seit dem Wechsel auf bypassPermissions (Begruendung weiter unten) ist
//      dieses Restrisiko groesser als hier urspruenglich beschrieben: unter
//      acceptEdits haette die Session so einen Befehl (`ls
//      ~/.claude/projects`, `cat .git`, `cd ..`) gar nicht unbeaufsichtigt
//      ausfuehren koennen - jeder Bash-Befehl haette nachgefragt und waere
//      ohne Antwort abgebrochen. Unter bypassPermissions kann sie es ohne
//      jede Rueckfrage, sofort, waehrend des Laufs. "Wer gezielt sucht,
//      findet ihn" ist damit nicht mehr nur ein theoretisches Restrisiko,
//      sondern technisch voraussetzungslos moeglich.
//   4. Die Vorher/Nachher-Pruefung des ECHTEN Checkouts (pruefeWurzel):
//      `git status --porcelain -- src/` im Wurzelverzeichnis vor und nach
//      der Session. Eine Aenderung dort wirkt nach dem naechsten Neustart.
//      Rauschfrei ist das bezogen auf den BOT - der schreibt nie selbst in
//      src/. Ein Fehlalarm ist trotzdem moeglich: wenn Kevin waehrend der
//      bis zu 20 Minuten selbst an src/ arbeitet (von Hand oder in einer
//      zweiten Claude-Code-Session), sieht die Pruefung genau dasselbe wie
//      bei einem echten Einbruch und schlaegt an. Das ist gewollt
//      fail-closed - lieber einmal umsonst nachsehen als einen echten Fall
//      verpassen. Es soll nur niemanden ueberraschen: der erste Alarm
//      dieser Art ist vermutlich Kevin selbst, und er darf dem Alarm
//      danach trotzdem noch glauben.
//
// Warum data/ NICHT ueberwacht wird, obwohl dort die Auszahlungsdaten
// liegen - das ist die unangenehme Stelle und sie soll hier stehen:
//   - `git status` taugt dort nicht: .gitignore schliesst `data/*.json` aus,
//     Git verfolgt diese Dateien gar nicht und meldet nie eine Aenderung.
//     Ein `-- data/` im Aufruf sah nach Schutz aus, war aber blind.
//   - Ein Hash- oder Zeitstempelvergleich ueber data/ taugt auch nicht: der
//     echte Bot LAEUFT waehrend der bis zu 20 Minuten langen Session weiter
//     und schreibt staendig legitim in data/ (Anmeldungen, Logbuch-Stand,
//     Steuerungszustand). Die Pruefung wuerde fast bei jedem Lauf anschlagen,
//     ohne dass etwas passiert ist. Eine Warnung, die immer kommt, wird
//     abgeschaltet - das waere schlechter als gar keine.
// Die Verteidigung fuer data/ ist deshalb: Punkt 3 (der Pfad liegt der
// Session nicht mehr beilaeufig vor der Nase - gezielt findbar bleibt er,
// siehe dort) plus die ausdrueckliche Prompt-Anweisung, data/ nirgendwo
// anzufassen. Fuer data/ gibt es also KEINE technische Erkennung wie bei
// src/, sondern nur Vertrauen in die Anweisung und einen etwas hoeheren
// Aufwand fuer den Pfad. Das ist ein echtes, offenes Restrisiko und soll
// hier auch so heissen. Wer das anders haben will, braucht echtes
// Sandboxing, nicht eine weitere Pruefschleife.
//
// Was hier NICHT schuetzt, und das soll ebenfalls so dastehen: ein Prozess
// mit Bash ist ohne echtes Sandboxing grundsaetzlich nicht einsperrbar.
// Punkt 4 ist eine ERKENNUNG, keine Verhinderung - sie schlaegt nach der Tat
// an, aber sie schlaegt wenigstens an, statt dass die Isolation nur
// behauptet wird.
//
// Warum `--permission-mode bypassPermissions` statt `acceptEdits` - auch das
// gehoert ehrlich hierher, weil es das Ausmass dessen erhoeht, was die
// Session automatisch darf:
//   Ein echter Testlauf (in einem harmlosen Testordner, nicht im echten
//   Repo) hat gezeigt: `acceptEdits` erlaubt der CLI automatisches
//   Dateischreiben, aber KEIN automatisches Ausfuehren von Bash-Befehlen -
//   `git add`/`git commit`/`npm test` fragen weiterhin nach, und ohne
//   jemanden, der die Frage beantwortet, bricht die Session ab. Mit
//   `acceptEdits` haette dieses Feature also nie tatsaechlich committet -
//   es haette nie einen echten Vorschlag liefern koennen. Ein zweiter Test
//   mit `bypassPermissions` im selben Testordner hat funktioniert: Datei
//   geschrieben, `git add` und `git commit` automatisch ausgefuehrt, nichts
//   darueber hinaus, keine Auffaelligkeiten.
//   Die CLI selbst empfiehlt `bypassPermissions` nur fuer Umgebungen ohne
//   Internetzugang - diese Session braucht aber Internet (klont vom
//   GitHub-Remote, pusht dorthin). Das ist ein bewusst in Kauf genommenes,
//   erhoehtes Risiko, keine geschlossene Luecke. Was es kompensiert: die
//   bereits bestehenden Massnahmen oben - der Tabu-Diff nach dem Lauf
//   (Punkt 2), die Vorher/Nachher-Pruefung des echten Checkouts (Punkt 4)
//   und die Env-Bereinigung (Punkt 1). Keine davon verhindert etwas
//   WAEHREND des Laufs, sie schlagen alle erst danach an.

const TABU_MUSTER = [
  'src/event-', 'src/scheduler.js', 'src/storage.js', 'src/archiver.js',
  'src/logbook', 'src/logbuch-', 'src/auszahlung-saetze.js',
  'src/giveaway', 'src/state-', '.env', 'env',
  // Fachdaten und Logs: die Session hat dort nichts zu suchen, weder lesend
  // noch schreibend - in data/ stehen Namen und Spielernummern.
  'data/', 'logs/',
  // Billige Zusatzabsicherung: Startskripte, Abhaengigkeiten, die eigenen
  // Konventionen und die Werkzeugkonfiguration aendert die Session nicht.
  'scripts/', 'package.json', 'package-lock.json', 'CLAUDE.md', '.claude/',
];

// Was im echten Checkout ueber `git status` ueberwacht wird: src/ (der Code
// des laufenden Bots), scripts/ (Start-/Stop-/Restart-Skripte - eine
// Aenderung dort wirkt erst beim naechsten Neustart, aber genau deshalb
// waere sie leicht zu uebersehen) und .claude/ (eigene Konventionen,
// Werkzeugkonfiguration). Alle drei sind versioniert (git status sieht
// Aenderungen) und werden vom laufenden Bot nie beschrieben - das
// Rauschargument, das data/ von dieser Liste ausschliesst, greift hier
// nicht. Seit bypassPermissions (siehe Modulkommentar oben) ist eine
// unbeaufsichtigte Aenderung an z.B. scripts/run-bot.ps1 technisch leichter
// erreichbar als vorher, deshalb gehoert scripts/ jetzt mit in die
// Ueberwachung. data/ steht hier weiterhin bewusst NICHT - warum, siehe den
// Modulkommentar oben (gitignored, und der laufende Bot schreibt dort
// selbst staendig legitim). TABU_MUSTER behaelt 'data/' trotzdem: sollte
// jemand data/ aus .gitignore nehmen, greift der Diff-Check im eigenen Klon.
const WURZEL_PFADE = ['src/', 'scripts/', '.claude/'];

// Namen, unter denen der echte Discord-Token in process.env stehen kann
// (siehe getToken() in config.js). Werden vor jedem Kindprozess entfernt.
const TOKEN_UMGEBUNGSVARIABLEN = ['DISCORD_TOKEN', 'BOT_TOKEN', 'TOKEN'];

// Variablen, die den PFAD des echten Checkouts verraten. Der Bot wird ueber
// `npm start` gestartet (scripts/run-bot.ps1), und npm legt dabei eine ganze
// Reihe eigener Variablen an, die den Startpfad woertlich enthalten:
// INIT_CWD, npm_config_local_prefix, npm_package_json und weitere. Ohne
// diesen Filter haette ein `echo $INIT_CWD` in der Session gereicht - der
// ganze Aufwand mit dem Klon statt dem Worktree waere umsonst gewesen.
// PWD/OLDPWD aus demselben Grund: sie tragen das Arbeitsverzeichnis des
// Elternprozesses. Das Kind setzt sich beide ohnehin selbst neu, passend zu
// seinem eigenen cwd.
const PFAD_UMGEBUNGSVARIABLEN = ['INIT_CWD', 'PWD', 'OLDPWD'];
const PFAD_PRAEFIXE = ['npm_'];

const TIMEOUT_MS = 20 * 60 * 1000;
const wurzel = path.resolve(__dirname, '..');

// Bewusst EIN einzelnes Wort ohne Leerzeichen (Bindestriche statt
// Leerzeichen) - warum, steht ausfuehrlich beim Kommentar zu
// passeBefehlFuerPlattformAn(): unter Windows (shell:true) wuerde ein
// mehrwoertiger String in cmd.exe in einzelne Positionals zerfallen, und die
// claude-CLI kennt fuer den Prompt nur EIN Positional. Der eigentliche
// Auftrag steht ohnehin vollstaendig in SELBSTVERBESSERUNG_AUFGABE.md (siehe
// baueAufgabe weiter unten) - dieser Prompt muss nur noch dorthin verweisen.
const CLAUDE_PROMPT = 'Lies-SELBSTVERBESSERUNG_AUFGABE.md-im-Projekt-Root-und-arbeite-die-Aufgabe-ab';

function slug(titel) {
  return String(titel || 'problem')
    .toLowerCase()
    .replace(/[^a-z0-9äöüß]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'problem';
}

function bereinigteUmgebung() {
  const env = { ...process.env };
  for (const name of [...TOKEN_UMGEBUNGSVARIABLEN, ...PFAD_UMGEBUNGSVARIABLEN]) {
    delete env[name];
  }
  // Windows vergleicht Variablennamen ohne Ruecksicht auf Gross-/
  // Kleinschreibung, deshalb hier auch - npm schreibt sie klein, aber
  // darauf soll sich das hier nicht verlassen.
  for (const name of Object.keys(env)) {
    if (PFAD_PRAEFIXE.some((praefix) => name.toLowerCase().startsWith(praefix))) {
      delete env[name];
    }
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

// Unter Windows ist `claude` kein direkt startbares Programm, sondern ein
// von npm erzeugtes claude.cmd/claude.ps1-Skript. `spawn('claude', ...)` ohne
// shell:true sucht dort nur nach echten Binaerdateien und schlaegt mit ENOENT
// fehl - gemessen an einem echten Testlauf. shell:true zusammen mit dem
// Namen claude.cmd behebt das: portabel, kein hartcodierter Pfad wie bei der
// echten claude.exe, deren Pfad von der jeweiligen npm-Installation abhaengt.
//
// KORRIGIERT, weil hier vorher eine falsche Annahme stand: Node fuegt bei
// shell:true die Argumente NICHT einzeln gequotet zusammen. Es baut
// command + args mit je einem Leerzeichen zu EINER Kommandozeile zusammen
// und uebergibt die an `cmd.exe /d /s /c "..."` - ein Argument, das selbst
// ein Leerzeichen enthaelt, zerfaellt dort in mehrere Woerter, weil cmd.exe
// die urspruenglichen Argumentgrenzen gar nicht mehr kennt. Gemessen mit
// genau den Argumenten, die starteSession() an den claude-Aufruf uebergeben
// hat (damals noch mit dem mehrwoertigen Prompt-Satz), gegen ein .cmd-Shim,
// das seine eigene argv in eine Datei schreibt:
//   ["-p","Lies","SELBSTVERBESSERUNG_AUFGABE.md","im","Projekt-Root","und",
//    "arbeite","die","Aufgabe","ab.","--permission-mode","bypassPermissions"]
// statt der erwarteten 4 Eintraege. Die claude-CLI hat aber nur EIN
// Positional fuer den Prompt (`claude [options] [command] [prompt]`) -
// unter Windows waere davon praktisch nur "Lies" als Prompt angekommen, der
// Rest waeren ueberzaehlige Positionals gewesen. Die Session haette nie
// erfahren, dass sie SELBSTVERBESSERUNG_AUFGABE.md lesen soll: das Feature
// waere unter Windows kaputt gewesen, trotz gruener Tests - die frueheren
// Tests pruefen nur, wie die Argumente VOR dem Spawn zusammengesetzt sind,
// nicht, was cmd.exe danach damit macht.
// Der eigentliche Fix dafuer steht deshalb nicht hier, sondern beim Prompt
// selbst: CLAUDE_PROMPT weiter unten ist bewusst EIN einzelnes Wort ohne
// Leerzeichen (Bindestriche statt Leerzeichen), genau damit dieses
// Auseinanderfallen strukturell nicht mehr passieren kann - unabhaengig
// davon, wie viele Argumente insgesamt uebergeben werden. Wer hier spaeter
// ein neues Argument MIT Leerzeichen ergaenzt, muss entweder dasselbe Muster
// verwenden oder eine echte Windows-Quotierung nachruesten (z.B. Argumente
// mit Leerzeichen selbst in doppelte Anfuehrungszeichen setzen) - Stand
// jetzt ist WEDER das eine noch das andere fuer beliebige kuenftige
// Argumente automatisch abgesichert.
//
// Und zwar NUR fuer den claude-Aufruf: die bestehenden git-Aufrufe sprechen
// git.exe direkt an, eine echte Binaerdatei, die ohne Shell funktioniert,
// und sollen shell:true nicht bekommen - das waere eine unnoetige Ausweitung
// dessen, was der Kindprozess darf.
function passeBefehlFuerPlattformAn(cmd, options) {
  if (process.platform === 'win32' && cmd === 'claude') {
    return { cmd: 'claude.cmd', options: { ...options, shell: true } };
  }
  return { cmd, options };
}

function echtAusfuehren(cmd, args, options = {}) {
  return new Promise((resolve) => {
    let p;
    const angepasst = passeBefehlFuerPlattformAn(cmd, options);
    try {
      p = spawn(angepasst.cmd, args, {
        windowsHide: true,
        ...angepasst.options,
        env: angepasst.options.env || bereinigteUmgebung(),
      });
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
  Suche nicht nach dem echten Arbeitsverzeichnis des laufenden Bots. Dort
  laeuft Ghostxx gerade wirklich - eine Aenderung wirkt dort sofort und
  trifft echte Auszahlungen.
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
async function pruefeTabu(klonPfad, ausfuehren) {
  const diff = await ausfuehren('git', ['diff', '--name-only', 'main...HEAD'], { cwd: klonPfad });
  const dateien = diff.stdout.split(/\r?\n/).map((z) => z.trim()).filter(Boolean);
  const treffer = dateien.find((datei) => TABU_MUSTER.some((muster) => datei.startsWith(muster)));
  return { treffer, dateien };
}

/**
 * Zustand des ECHTEN Checkouts als vergleichbarer Text - ueber WURZEL_PFADE
 * (src/, scripts/, .claude/). Wird vor und nach der Session aufgerufen;
 * unterscheiden sich die beiden Ergebnisse, hat die Session ausserhalb ihres
 * Klons geschrieben.
 *
 * Fuer data/ gibt es diese Erkennung bewusst nicht (Modulkommentar oben).
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

async function leseZusammenfassungStandard(klonPfad) {
  const datei = path.join(klonPfad, 'SELBSTVERBESSERUNG_ZUSAMMENFASSUNG.md');
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
  const klonPfad = path.join(os.tmpdir(), `ghostxx-${slug(problem.titel)}-${Date.now()}`);

  let ergebnis = { ok: false, branch, zusammenfassung: '', fehler: '' };

  // Zustand des echten Checkouts VOR allem anderen festhalten - danach wird
  // im Wurzelverzeichnis nur noch gelesen (git remote get-url).
  const wurzelVorher = await pruefeWurzel(ausfuehren);

  try {
    // Die Remote-URL ist das Einzige, was aus dem echten Wurzelverzeichnis
    // herausgereicht wird - kein lokaler Pfad.
    const remote = await ausfuehren('git', ['remote', 'get-url', 'origin'], { cwd: wurzel });
    const remoteUrl = remote.code === 0 ? remote.stdout.trim() : '';
    if (!remoteUrl) {
      return { ...ergebnis, fehler: `Remote-URL von origin nicht lesbar: ${remote.stderr || remote.code}` };
    }

    // --single-branch spart Zeit und Bandbreite; main bleibt als lokaler
    // Branch vorhanden, den `git diff main...HEAD` spaeter braucht.
    const angelegt = await ausfuehren(
      'git',
      ['clone', '--branch', 'main', '--single-branch', remoteUrl, klonPfad],
      { cwd: os.tmpdir() },
    );
    if (angelegt.code !== 0) {
      return { ...ergebnis, fehler: `Klon konnte nicht angelegt werden: ${angelegt.stderr}` };
    }

    // mkdir zusaetzlich zu "git clone": im echten Lauf legt git das
    // Verzeichnis schon an, aber bei injiziertem `ausfuehren` (Tests) tut es
    // das nicht - defensiv also selbst dafuer sorgen, dass es existiert.
    await fs.mkdir(klonPfad, { recursive: true });

    const abgezweigt = await ausfuehren('git', ['checkout', '-b', branch], { cwd: klonPfad });
    if (abgezweigt.code !== 0) {
      return { ...ergebnis, fehler: `Branch konnte nicht angelegt werden: ${abgezweigt.stderr}` };
    }

    await fs.writeFile(path.join(klonPfad, 'SELBSTVERBESSERUNG_AUFGABE.md'), baueAufgabe(problem));

    const lauf = await ausfuehren(
      'claude',
      ['-p', CLAUDE_PROMPT, '--permission-mode', 'bypassPermissions'],
      { cwd: klonPfad },
    );

    const zusammenfassung = leseZusammenfassung
      ? await leseZusammenfassung(klonPfad)
      : await leseZusammenfassungStandard(klonPfad);

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
          + `git status in ${WURZEL_PFADE.join(', ')} des Wurzelverzeichnisses sieht nach der Session anders aus als davor. `
          + 'Nichts gepusht. Bitte SOFORT von Hand pruefen: git status und git diff im echten Arbeitsverzeichnis.',
      };
    }

    if (lauf.code !== 0) {
      const fehlerText = lauf.timedOut
        ? lauf.stderr
        : `Claude-Code-Session fehlgeschlagen: ${lauf.stderr || lauf.code}`;
      return { ...ergebnis, zusammenfassung, fehler: fehlerText };
    }

    const { treffer, dateien } = await pruefeTabu(klonPfad, ausfuehren);
    if (treffer) {
      return { ...ergebnis, zusammenfassung, fehler: `Leitplanke verletzt: ${treffer}` };
    }
    if (!dateien.length) {
      // "Nichts committet" hat zwei sehr verschiedene Ursachen, und der
      // Unterschied ist fuer Kevin wichtig: entweder die Session hat
      // tatsaechlich nichts gemacht, oder sie hat Dateien geaendert und
      // konnte nur nicht committen (z.B. fehlende Ausfuehrungsrechte fuer
      // npm test / git commit). Im zweiten Fall loescht das Aufraeumen
      // gleich danach die Arbeit unwiderruflich - dann soll in der DM
      // wenigstens stehen, dass etwas da war.
      const offen = await ausfuehren('git', ['status', '--porcelain'], { cwd: klonPfad });
      const hatUncommittetes = offen.code === 0
        && offen.stdout.split(/\r?\n/).some((z) => z.trim());

      return {
        ...ergebnis,
        zusammenfassung,
        fehler: hatUncommittetes
          ? 'Session hat Dateien geaendert, aber nicht committet - vermutlich fehlende '
            + 'Ausfuehrungsrechte fuer npm test/git commit. Aenderungen wurden verworfen.'
          : 'Session hat keine Aenderung committet.',
      };
    }

    // origin zeigt im Klon auf dieselbe GitHub-URL wie im echten Checkout -
    // der Push landet also wie vorher am richtigen Ort.
    const push = await ausfuehren('git', ['push', 'origin', branch], { cwd: klonPfad });
    if (push.code !== 0) {
      return { ...ergebnis, zusammenfassung, fehler: `Push fehlgeschlagen: ${push.stderr}` };
    }

    ergebnis = { ok: true, branch, zusammenfassung, fehler: '' };
    return ergebnis;
  } finally {
    // Ein eigenstaendiger Klon ist nirgends registriert - er wird einfach als
    // Verzeichnis geloescht. Kein `git worktree remove`, kein `git worktree
    // prune` im echten Wurzelverzeichnis mehr noetig.
    try {
      await fs.rm(klonPfad, { recursive: true, force: true });
    } catch {
      // Unter Windows kann eine Datei noch belegt sein (z.B. ein
      // Nachzuegler-Prozess). Das Aufraeumen darf das Ergebnis der Session
      // nicht kippen - der Pfad liegt in os.tmpdir() und faellt spaetestens
      // beim naechsten Aufraeumen des Systems weg.
    }
  }
}

module.exports = {
  TABU_MUSTER,
  // Nur fuer den Regressionstest exportiert: dass hier wirklich kein Token
  // durchrutscht, war der schwerwiegendste Fehler, der in diesem Feature
  // bisher gefunden wurde. Das darf nicht ungeprueft bleiben.
  bereinigteUmgebung,
  // Nur fuer den Regressionstest exportiert: dass unter Windows wirklich nur
  // der claude-Aufruf shell:true bekommt und git-Aufrufe unangetastet
  // bleiben, war der Kern des ENOENT-Fixes.
  passeBefehlFuerPlattformAn,
  // Nur fuer den Integrationstest exportiert: der reicht bis in den echten
  // spawn() hinein (mit einem .cmd-Shim statt der echten claude-CLI), weil
  // genau dort - und nicht in der reinen Argument-Zuordnungsfunktion - der
  // Shell-Zerfall-Fehler steckte, den die reinen Unit-Tests nicht gefunden
  // haetten.
  echtAusfuehren,
  CLAUDE_PROMPT,
  starteSession,
};
