const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { check, equal, finish, section } = require('./lib');
const session = require('../src/selbstverbesserung-session');

// Das Modul legt bei injiziertem `ausfuehren` (hier im Test) echte temporaere
// Verzeichnisse unter os.tmpdir() an (mkdir + writeFile), weil `git worktree
// remove` in den Tests nur gemockt ist und nichts wirklich loescht. Am Ende
// aufraeumen, damit keine "ghostxx-*"-Verzeichnisse im System-Temp liegen bleiben.
function raeumeGhostxxTempAuf() {
  const basis = os.tmpdir();
  for (const eintrag of fs.readdirSync(basis)) {
    if (eintrag.startsWith('ghostxx-')) {
      fs.rmSync(path.join(basis, eintrag), { recursive: true, force: true });
    }
  }
}

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

  raeumeGhostxxTempAuf();
  finish();
})();
