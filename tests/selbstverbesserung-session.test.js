const fs = require('node:fs');
const { check, equal, finish, section } = require('./lib');
const session = require('../src/selbstverbesserung-session');

// Das Modul legt bei injiziertem `ausfuehren` (hier im Test) echte temporaere
// Verzeichnisse an (mkdir + writeFile), weil `git worktree remove` in den
// Tests nur gemockt ist und nichts wirklich loescht. Am Ende raeumen wir NUR
// die Pfade auf, die DIESER Testlauf selbst per `git worktree add <pfad> ...`
// angelegt hat - niemals pauschal alles unter os.tmpdir(), das mit
// "ghostxx-" anfaengt. Grund: eine echte, gerade laufende Selbstverbesserungs-
// Session legt ihren Worktree unter genau demselben Namensmuster an, und
// `npm test` kann waehrenddessen laufen (CLAUDE.md: nach jeder Aenderung
// npm test). Ein pauschales Aufraeumen wuerde deren Arbeitsverzeichnis mitten
// im Lauf loeschen.
function extrahiereWorktreePfad(rohAufrufe) {
  const treffer = rohAufrufe.find(
    ({ cmd, args }) => cmd === 'git' && args[0] === 'worktree' && args[1] === 'add',
  );
  return treffer ? treffer.args[2] : null;
}

function raeumeAuf(...pfade) {
  for (const pfad of pfade) {
    if (pfad) fs.rmSync(pfad, { recursive: true, force: true });
  }
}

section('Erfolgreicher Lauf ohne Tabu-Verstoss');
(async () => {
  const aufrufe = [];
  const rohAufrufe = [];
  const fakeAusfuehren = async (cmd, args) => {
    aufrufe.push([cmd, ...args].join(' '));
    rohAufrufe.push({ cmd, args });
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
  const rohAufrufeTabu = [];
  const fakeAusfuehrenTabu = async (cmd, args) => {
    aufrufeTabu.push([cmd, ...args].join(' '));
    rohAufrufeTabu.push({ cmd, args });
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

  section('data/ und logs/ stehen auf der Tabu-Liste');
  check('data/ ist tabu', session.TABU_MUSTER.includes('data/'));
  check('logs/ ist tabu', session.TABU_MUSTER.includes('logs/'));

  section('Aufgabentext verbietet den Ausbruch aus dem Worktree');
  // Der Prompt ist keine technische Grenze, aber er soll die Regel wenigstens
  // aussprechen - sonst haelt sich auch eine gutwillige Session nicht daran.
  const rohAufrufePrompt = [];
  await session.starteSession(
    { titel: 'Prompt-Pruefung', belege: [] },
    {
      ausfuehren: async (cmd, args) => {
        rohAufrufePrompt.push({ cmd, args });
        return { code: 0, stdout: '', stderr: '' };
      },
      leseZusammenfassung: async () => '',
    },
  );
  const promptPfad = extrahiereWorktreePfad(rohAufrufePrompt);
  const aufgabenText = fs.readFileSync(`${promptPfad}/SELBSTVERBESSERUNG_AUFGABE.md`, 'utf8');
  check('Prompt verbietet Elternverzeichnis/anderen Checkout', aufgabenText.includes('AUSSCHLIESSLICH in diesem Arbeitsverzeichnis'));
  check('Prompt verbietet data/ und logs/', aufgabenText.includes('data/') && aufgabenText.includes('logs/'));

  section('Session hat den echten Checkout veraendert -> Alarm, kein Push');
  const aufrufeEinbruch = [];
  const rohAufrufeEinbruch = [];
  let statusAufrufe = 0;
  const fakeAusfuehrenEinbruch = async (cmd, args) => {
    aufrufeEinbruch.push([cmd, ...args].join(' '));
    rohAufrufeEinbruch.push({ cmd, args });
    if (cmd === 'git' && args[0] === 'status') {
      statusAufrufe += 1;
      // Erster Aufruf: sauber. Zweiter (nach der Session): jemand hat in
      // data/ geschrieben.
      return { code: 0, stdout: statusAufrufe === 1 ? '' : ' M data/events.json\n', stderr: '' };
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

  check('Echter Checkout wurde vorher und nachher geprueft', statusAufrufe === 2);
  check('Als nicht ok gemeldet', ergebnisEinbruch.ok === false);
  check('Meldung nennt den echten Checkout', ergebnisEinbruch.fehler.startsWith('Session hat den echten Checkout veraendert!'));
  check('Kein Push nach Einbruch', !aufrufeEinbruch.some((a) => a.startsWith('git push')));
  check('Trotzdem aufgeraeumt', aufrufeEinbruch.some((a) => a.includes('worktree remove')));

  section('Geaendert aber nicht committet -> Kevin erfaehrt davon');
  const rohAufrufeOffen = [];
  const fakeAusfuehrenOffen = async (cmd, args, options = {}) => {
    rohAufrufeOffen.push({ cmd, args });
    if (cmd === 'git' && args[0] === 'status' && options.cwd && options.cwd.includes('ghostxx-')) {
      // Status IM Worktree: es liegt etwas Uncommittetes herum.
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

  raeumeAuf(
    extrahiereWorktreePfad(rohAufrufeOffen),
    extrahiereWorktreePfad(rohAufrufe),
    extrahiereWorktreePfad(rohAufrufeTabu),
    promptPfad,
    extrahiereWorktreePfad(rohAufrufeEinbruch),
  );
  finish();
})();
