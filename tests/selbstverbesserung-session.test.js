const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { check, equal, finish, section } = require('./lib');
const session = require('../src/selbstverbesserung-session');

// Das Modul legt bei injiziertem `ausfuehren` (hier im Test) echte temporaere
// Verzeichnisse an (mkdir + writeFile), weil `git clone` hier nur gemockt ist
// und nichts wirklich klont. Das Aufraeumen am Ende macht das Modul aber
// selbst und echt: seit dem Wechsel von `git worktree add` auf `git clone`
// loescht es das Verzeichnis per fs.rm, nicht per `git worktree remove`.
// Genau das pruefen die Tests unten auch - kein pauschales Loeschen von
// allem unter os.tmpdir(), was mit "ghostxx-" anfaengt: eine echte, gerade
// laufende Selbstverbesserungs-Session nutzt dasselbe Namensmuster, und
// `npm test` kann waehrenddessen laufen.
function extrahiereKlonPfad(rohAufrufe) {
  const treffer = rohAufrufe.find(({ cmd, args }) => cmd === 'git' && args[0] === 'clone');
  return treffer ? treffer.args[treffer.args.length - 1] : null;
}

// Jede Fake-Ausfuehrung muss die Remote-URL liefern - ohne sie bricht
// starteSession ab, bevor ueberhaupt geklont wird.
const REMOTE_URL = 'https://github.com/KevKevKing/GhostxxEventBot.git';

function istRemoteAbfrage(cmd, args) {
  return cmd === 'git' && args[0] === 'remote' && args[1] === 'get-url';
}

section('Erfolgreicher Lauf ohne Tabu-Verstoss');
(async () => {
  const aufrufe = [];
  const rohAufrufe = [];
  const fakeAusfuehren = async (cmd, args) => {
    aufrufe.push([cmd, ...args].join(' '));
    rohAufrufe.push({ cmd, args });
    if (istRemoteAbfrage(cmd, args)) {
      return { code: 0, stdout: `${REMOTE_URL}\n`, stderr: '' };
    }
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

  check('Session als ok gemeldet', ergebnis.ok === true, ergebnis.fehler);
  check('Branch-Name gesetzt', ergebnis.branch.startsWith('selbstverbesserung/'));
  equal('Zusammenfassung uebernommen', ergebnis.zusammenfassung, 'Habe X repariert.');
  check('git push wurde aufgerufen', aufrufe.some((a) => a.startsWith('git push')));

  section('Geklont wird vom Remote, nicht vom lokalen Pfad');
  // Der Kern des Fixes: `git worktree add` legt eine .git-Datei an, in der
  // woertlich der Pfad zum echten Checkout des laufenden Bots steht. Ein
  // `git clone <remote-url>` verraet diesen Pfad nicht.
  const klonAufruf = rohAufrufe.find(({ cmd, args }) => cmd === 'git' && args[0] === 'clone');
  check('git clone statt git worktree add', Boolean(klonAufruf));
  check('kein worktree-Aufruf mehr', !aufrufe.some((a) => a.includes('worktree')));
  check('geklont wird die Remote-URL', Boolean(klonAufruf) && klonAufruf.args.includes(REMOTE_URL));
  check(
    'Branch wird im Klon abgezweigt',
    rohAufrufe.some(({ cmd, args }) => cmd === 'git' && args[0] === 'checkout' && args[1] === '-b'),
  );
  check(
    'Remote-URL wird im echten Wurzelverzeichnis gelesen',
    rohAufrufe.some(({ cmd, args }) => istRemoteAbfrage(cmd, args)),
  );
  check('Klonverzeichnis wurde am Ende geloescht', !fs.existsSync(extrahiereKlonPfad(rohAufrufe)));

  section('Tabu-Datei angefasst -> automatisch abgelehnt, kein Push');
  const aufrufeTabu = [];
  const rohAufrufeTabu = [];
  const fakeAusfuehrenTabu = async (cmd, args) => {
    aufrufeTabu.push([cmd, ...args].join(' '));
    rohAufrufeTabu.push({ cmd, args });
    if (istRemoteAbfrage(cmd, args)) {
      return { code: 0, stdout: `${REMOTE_URL}\n`, stderr: '' };
    }
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
  check('Trotzdem aufgeraeumt', !fs.existsSync(extrahiereKlonPfad(rohAufrufeTabu)));

  section('Ohne Remote-URL wird gar nicht erst geklont');
  // Ohne origin gibt es keinen Weg, der den echten lokalen Pfad verborgen
  // haelt - dann lieber abbrechen als auf den lokalen Pfad zurueckfallen.
  const aufrufeOhneRemote = [];
  const ergebnisOhneRemote = await session.starteSession(
    { titel: 'Kein Remote', belege: [] },
    {
      ausfuehren: async (cmd, args) => {
        aufrufeOhneRemote.push([cmd, ...args].join(' '));
        if (istRemoteAbfrage(cmd, args)) {
          return { code: 1, stdout: '', stderr: 'no such remote' };
        }
        return { code: 0, stdout: '', stderr: '' };
      },
      leseZusammenfassung: async () => '',
    },
  );
  check('Als nicht ok gemeldet', ergebnisOhneRemote.ok === false);
  check('Grund nennt die Remote-URL', ergebnisOhneRemote.fehler.includes('Remote-URL'));
  check('Kein clone ohne Remote-URL', !aufrufeOhneRemote.some((a) => a.startsWith('git clone')));

  section('data/ und logs/ stehen auf der Tabu-Liste');
  // Bleibt bestehen, obwohl pruefeWurzel data/ nicht mehr ueberwacht: sollte
  // jemand data/ aus .gitignore nehmen, greift der Diff-Check im eigenen Klon.
  check('data/ ist tabu', session.TABU_MUSTER.includes('data/'));
  check('logs/ ist tabu', session.TABU_MUSTER.includes('logs/'));

  section('Aufgabentext verbietet den Ausbruch aus dem Klon');
  // Der Prompt ist keine technische Grenze, aber er soll die Regel wenigstens
  // aussprechen - fuer data/ ist er sogar die HAUPTverteidigung, seit klar
  // ist, dass sich Aenderungen dort nicht rauschfrei erkennen lassen.
  // Gelesen wird die Datei waehrend des (gefakten) claude-Aufrufs, weil das
  // Verzeichnis danach vom Modul geloescht wird.
  let aufgabenText = '';
  await session.starteSession(
    { titel: 'Prompt-Pruefung', belege: [] },
    {
      ausfuehren: async (cmd, args, options = {}) => {
        if (istRemoteAbfrage(cmd, args)) {
          return { code: 0, stdout: `${REMOTE_URL}\n`, stderr: '' };
        }
        if (cmd === 'claude') {
          aufgabenText = fs.readFileSync(`${options.cwd}/SELBSTVERBESSERUNG_AUFGABE.md`, 'utf8');
        }
        return { code: 0, stdout: '', stderr: '' };
      },
      leseZusammenfassung: async () => '',
    },
  );
  check('Prompt verbietet Elternverzeichnis/anderen Checkout', aufgabenText.includes('AUSSCHLIESSLICH in diesem Arbeitsverzeichnis'));
  check('Prompt verbietet data/ und logs/', aufgabenText.includes('data/') && aufgabenText.includes('logs/'));

  section('Session hat src/ im echten Checkout veraendert -> Alarm, kein Push');
  // Bewusst src/ und NICHT data/: data/*.json ist gitignored, `git status`
  // wuerde dort nie etwas melden. Und ein Hash-/Zeitstempelvergleich ginge
  // auch nicht, weil der echte Bot waehrend der bis zu 20 Minuten langen
  // Session selbst staendig legitim in data/ schreibt. Diese Pruefung deckt
  // deshalb nur src/ ab - dort schreibt der Bot nie selbst, also kein
  // Rauschen. Fuer data/ gibt es keine technische Erkennung mehr, siehe den
  // Modulkommentar in src/selbstverbesserung-session.js.
  const aufrufeEinbruch = [];
  const rohAufrufeEinbruch = [];
  let statusAufrufe = 0;
  const fakeAusfuehrenEinbruch = async (cmd, args) => {
    aufrufeEinbruch.push([cmd, ...args].join(' '));
    rohAufrufeEinbruch.push({ cmd, args });
    if (istRemoteAbfrage(cmd, args)) {
      return { code: 0, stdout: `${REMOTE_URL}\n`, stderr: '' };
    }
    if (cmd === 'git' && args[0] === 'status') {
      statusAufrufe += 1;
      // Erster Aufruf: sauber. Zweiter (nach der Session): jemand hat in
      // src/ des echten Checkouts geschrieben.
      return { code: 0, stdout: statusAufrufe === 1 ? '' : ' M src/message-handler.js\n', stderr: '' };
    }
    if (cmd === 'git' && args[0] === 'diff') {
      return { code: 0, stdout: 'src/harmlos.js\n', stderr: '' };
    }
    return { code: 0, stdout: '', stderr: '' };
  };

  const ergebnisEinbruch = await session.starteSession(
    { titel: 'Einbruch', belege: [] },
    { ausfuehren: fakeAusfuehrenEinbruch, leseZusammenfassung: async () => 'x' },
  );

  check('Echter Checkout wurde vorher und nachher geprueft', statusAufrufe === 2, String(statusAufrufe));
  check(
    'Geprueft wird nur src/, nicht data/',
    rohAufrufeEinbruch.some(
      ({ cmd, args }) => cmd === 'git' && args[0] === 'status'
        && args.includes('src/') && !args.includes('data/'),
    ),
  );
  check('Als nicht ok gemeldet', ergebnisEinbruch.ok === false);
  check('Meldung nennt den echten Checkout', ergebnisEinbruch.fehler.startsWith('Session hat den echten Checkout veraendert!'));
  check('Kein Push nach Einbruch', !aufrufeEinbruch.some((a) => a.startsWith('git push')));
  check('Trotzdem aufgeraeumt', !fs.existsSync(extrahiereKlonPfad(rohAufrufeEinbruch)));

  section('Geaendert aber nicht committet -> Kevin erfaehrt davon');
  const rohAufrufeOffen = [];
  const fakeAusfuehrenOffen = async (cmd, args, options = {}) => {
    rohAufrufeOffen.push({ cmd, args });
    if (istRemoteAbfrage(cmd, args)) {
      return { code: 0, stdout: `${REMOTE_URL}\n`, stderr: '' };
    }
    if (cmd === 'git' && args[0] === 'status' && options.cwd && options.cwd.includes('ghostxx-')) {
      // Status IM Klon: es liegt etwas Uncommittetes herum.
      return { code: 0, stdout: ' M src/etwas.js\n?? neu.js\n', stderr: '' };
    }
    return { code: 0, stdout: '', stderr: '' };
  };

  const ergebnisOffen = await session.starteSession(
    { titel: 'Nicht committet', belege: [] },
    { ausfuehren: fakeAusfuehrenOffen, leseZusammenfassung: async () => '' },
  );
  check('Als nicht ok gemeldet', ergebnisOffen.ok === false);
  check(
    'Meldung nennt die verworfenen Aenderungen',
    ergebnisOffen.fehler.includes('nicht committet') && ergebnisOffen.fehler.includes('verworfen'),
    ergebnisOffen.fehler,
  );

  section('claude-Aufruf nutzt bypassPermissions, nicht acceptEdits');
  // Gemessen: acceptEdits erlaubt der CLI automatisches Dateischreiben, aber
  // kein automatisches Ausfuehren von Bash-Befehlen (git add/commit, npm
  // test) - die Session waere mit acceptEdits nie zu einem Commit gekommen.
  let claudeAufrufArgs = null;
  await session.starteSession(
    { titel: 'Permission-Mode-Pruefung', belege: [] },
    {
      ausfuehren: async (cmd, args) => {
        if (istRemoteAbfrage(cmd, args)) {
          return { code: 0, stdout: `${REMOTE_URL}\n`, stderr: '' };
        }
        if (cmd === 'claude') {
          claudeAufrufArgs = args;
        }
        return { code: 0, stdout: '', stderr: '' };
      },
      leseZusammenfassung: async () => '',
    },
  );
  check('claude-Aufruf wurde erfasst', Array.isArray(claudeAufrufArgs));
  check(
    'bypassPermissions statt acceptEdits',
    Boolean(claudeAufrufArgs) && claudeAufrufArgs.includes('bypassPermissions') && !claudeAufrufArgs.includes('acceptEdits'),
    JSON.stringify(claudeAufrufArgs),
  );

  section('Windows-Spawn-Fix: nur der claude-Aufruf bekommt shell:true');
  // Gemessen: spawn('claude', ...) schlaegt unter Windows ohne shell:true mit
  // ENOENT fehl, weil claude dort als claude.cmd/claude.ps1-Skript installiert
  // ist. git-Aufrufe sprechen git.exe direkt an und sollen NICHT betroffen
  // sein. process.platform ist konfigurierbar - hier gezielt fuer den Test
  // auf 'win32' gesetzt und danach wiederhergestellt.
  const echtePlattform = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
  try {
    const claudeAngepasst = session.passeBefehlFuerPlattformAn('claude', { cwd: '/irgendwo' });
    check('claude wird zu claude.cmd unter win32', claudeAngepasst.cmd === 'claude.cmd', claudeAngepasst.cmd);
    check('shell:true fuer claude unter win32', claudeAngepasst.options.shell === true);

    const gitAngepasst = session.passeBefehlFuerPlattformAn('git', { cwd: '/irgendwo' });
    check('git bleibt git unter win32', gitAngepasst.cmd === 'git', gitAngepasst.cmd);
    check('git bekommt kein shell:true', !gitAngepasst.options.shell);
  } finally {
    Object.defineProperty(process, 'platform', echtePlattform);
  }

  section('Windows-Spawn-Fix greift nicht auf anderen Plattformen');
  const echtePlattform2 = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
  try {
    const claudeLinux = session.passeBefehlFuerPlattformAn('claude', {});
    check('claude bleibt claude unter linux', claudeLinux.cmd === 'claude', claudeLinux.cmd);
    check('kein shell:true unter linux', !claudeLinux.options.shell);
  } finally {
    Object.defineProperty(process, 'platform', echtePlattform2);
  }

  section('Windows-Integrationstest: der Prompt kommt als EIN Argument an');
  // Der Fehler, den das Review gefunden hat, waere mit den beiden Tests oben
  // NIE aufgefallen: die pruefen nur, dass passeBefehlFuerPlattformAn() die
  // richtige Zuordnung liefert (claude -> claude.cmd, shell:true), nie, was
  // cmd.exe mit den Argumenten macht, sobald echtAusfuehren() sie wirklich an
  // spawn() weiterreicht. Deshalb hier ein echter Prozess: ein .cmd-Shim,
  // das seine eigene argv in eine Datei schreibt, aufgerufen ueber die
  // tatsaechliche echtAusfuehren()-Funktion mit genau den Argumenten, die
  // starteSession() an den claude-Aufruf uebergibt (CLAUDE_PROMPT plus
  // --permission-mode bypassPermissions).
  // Nur unter win32 aussagekraeftig - anderswo greift der shell:true-Zweig
  // gar nicht, dort wird uebersprungen statt etwas vorzutaeuschen.
  if (process.platform === 'win32') {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostxx-cmdshim-'));
    const argvDatei = path.join(tmpDir, 'argv-output.txt');
    // %~1, %~2, ... entfernen umschliessende Anfuehrungszeichen - genau das
    // Verhalten, das claude.cmd von npm auch zeigen wuerde. Der Shim schreibt
    // jedes Argument in eine eigene Zeile, damit ein zerfallenes (in mehrere
    // Woerter gespaltenes) Argument im Ergebnis sofort als mehrere Zeilen
    // sichtbar wird.
    const shimInhalt = [
      '@echo off',
      'setlocal EnableDelayedExpansion',
      `set "outfile=${argvDatei}"`,
      'if exist "%outfile%" del "%outfile%"',
      ':loop',
      'if "%~1"=="" goto :eof',
      'echo(%~1>> "%outfile%"',
      'shift',
      'goto loop',
    ].join('\r\n');
    fs.writeFileSync(path.join(tmpDir, 'claude.cmd'), shimInhalt);

    // Wichtig: cmd.exe sucht ein bares "claude.cmd" nicht zuverlaessig zuerst
    // im cwd - auf diesem Rechner griff sonst der ECHTE, global installierte
    // claude.cmd von PATH (erkennbar am "Not logged in"-Output), startete
    // einen echten Netzwerk-Login-Versuch und hinterliess einen
    // haengenbleibenden Prozess samt gesperrtem Temp-Verzeichnis. Deshalb
    // hier das Testverzeichnis explizit vorn in PATH einhaengen, damit
    // garantiert der Shim gefunden wird, nicht die echte CLI.
    const pathSchluessel = Object.keys(process.env).find((k) => k.toLowerCase() === 'path') || 'Path';
    const testUmgebung = {
      ...session.bereinigteUmgebung(),
      [pathSchluessel]: `${tmpDir}${path.delimiter}${process.env[pathSchluessel] || ''}`,
    };

    try {
      const ergebnisSpawn = await session.echtAusfuehren(
        'claude',
        ['-p', session.CLAUDE_PROMPT, '--permission-mode', 'bypassPermissions'],
        { cwd: tmpDir, timeoutMs: 10000, env: testUmgebung },
      );
      check('Shim-Aufruf erfolgreich beendet (Code 0)', ergebnisSpawn.code === 0, JSON.stringify(ergebnisSpawn));

      const zeilen = fs.existsSync(argvDatei)
        ? fs.readFileSync(argvDatei, 'utf8').split(/\r?\n/).filter((z) => z.length > 0)
        : [];
      check('Genau 4 Argumente kommen an (kein Zerfall)', zeilen.length === 4, JSON.stringify(zeilen));
      check('-p kommt an', zeilen[0] === '-p', JSON.stringify(zeilen));
      check(
        'Der Prompt kommt unveraendert als EIN Argument an',
        zeilen[1] === session.CLAUDE_PROMPT,
        JSON.stringify(zeilen),
      );
      check('--permission-mode kommt an', zeilen[2] === '--permission-mode', JSON.stringify(zeilen));
      check('bypassPermissions kommt an', zeilen[3] === 'bypassPermissions', JSON.stringify(zeilen));

      // Beleg, dass es sich um einen echten, jetzt behobenen Fehler handelt
      // und nicht um eine erfundene Sorge: mit dem URSPRUENGLICHEN,
      // mehrwoertigen Prompt-Satz (vor diesem Fix) zerfaellt derselbe Aufruf
      // ueber denselben Shim tatsaechlich in mehr als 4 Argumente.
      const alterMehrwoertigerPrompt = 'Lies SELBSTVERBESSERUNG_AUFGABE.md im Projekt-Root und arbeite die Aufgabe ab.';
      const ergebnisAlt = await session.echtAusfuehren(
        'claude',
        ['-p', alterMehrwoertigerPrompt, '--permission-mode', 'bypassPermissions'],
        { cwd: tmpDir, timeoutMs: 10000, env: testUmgebung },
      );
      check('Alter Aufruf (Vergleich) beendet', ergebnisAlt.code === 0, JSON.stringify(ergebnisAlt));
      const zeilenAlt = fs.existsSync(argvDatei)
        ? fs.readFileSync(argvDatei, 'utf8').split(/\r?\n/).filter((z) => z.length > 0)
        : [];
      check(
        'Alter Prompt-Satz zerfiel tatsaechlich in mehrere Argumente (der behobene Fehler)',
        zeilenAlt.length > 4,
        JSON.stringify(zeilenAlt),
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  } else {
    console.log('  (uebersprungen - nur unter win32 aussagekraeftig, dieser Lauf ist ' + process.platform + ')');
  }

  section('Token bleiben dem Kindprozess verborgen');
  // Regressionstest: ohne diesen Filter erbt die Claude-Code-Session das
  // komplette process.env des laufenden Bots - inklusive Discord-Token.
  const vorher = {};
  for (const name of ['DISCORD_TOKEN', 'BOT_TOKEN', 'TOKEN']) {
    vorher[name] = process.env[name];
    process.env[name] = `test-geheim-${name}`;
  }
  const umgebung = session.bereinigteUmgebung();
  for (const name of ['DISCORD_TOKEN', 'BOT_TOKEN', 'TOKEN']) {
    check(`${name} fehlt in der Umgebung`, !(name in umgebung));
  }
  check(
    'Kein Wert des Tokens taucht sonstwo auf',
    !Object.values(umgebung).some((wert) => String(wert).startsWith('test-geheim-')),
  );
  const pfadSchluessel = Object.keys(process.env).find((k) => k.toLowerCase() === 'path');
  check('Normale Variablen bleiben erhalten (PATH)', Boolean(pfadSchluessel && umgebung[pfadSchluessel]));
  for (const [name, wert] of Object.entries(vorher)) {
    if (wert === undefined) delete process.env[name];
    else process.env[name] = wert;
  }

  section('Der Pfad des echten Checkouts bleibt dem Kindprozess verborgen');
  // Der Bot wird ueber `npm start` gestartet, und npm setzt dabei INIT_CWD
  // sowie ein Dutzend npm_*-Variablen auf den echten Checkout-Pfad. Ohne
  // diesen Filter haette ein `echo $INIT_CWD` in der Session gereicht - dann
  // waere der ganze Wechsel von worktree auf clone umsonst gewesen.
  const PFAD_NAMEN = ['INIT_CWD', 'PWD', 'OLDPWD', 'npm_config_local_prefix', 'npm_package_json'];
  // Bewusst ein erfundener Marker statt des echten Pfads: der echte Pfad
  // steckt waehrend `npm test` in weiteren Variablen dieses Prozesses, dann
  // wuerde die Suche unten anschlagen, ohne dass etwas kaputt ist.
  const PFAD_MARKER = 'C:\\test-marker-echter-checkout';
  const vorherPfad = {};
  for (const name of PFAD_NAMEN) {
    vorherPfad[name] = process.env[name];
    process.env[name] = PFAD_MARKER;
  }
  const umgebungPfad = session.bereinigteUmgebung();
  for (const name of PFAD_NAMEN) {
    check(`${name} fehlt in der Umgebung`, !(name in umgebungPfad));
  }
  check(
    'Keine npm_-Variable bleibt uebrig',
    !Object.keys(umgebungPfad).some((name) => name.toLowerCase().startsWith('npm_')),
  );
  check(
    'Der Pfad taucht in keiner verbliebenen Variable auf',
    !Object.values(umgebungPfad).some((wert) => String(wert).includes(PFAD_MARKER)),
  );
  const pfadSchluessel2 = Object.keys(process.env).find((k) => k.toLowerCase() === 'path');
  check('PATH bleibt trotzdem erhalten', Boolean(pfadSchluessel2 && umgebungPfad[pfadSchluessel2]));
  for (const [name, wert] of Object.entries(vorherPfad)) {
    if (wert === undefined) delete process.env[name];
    else process.env[name] = wert;
  }

  finish();
})();
