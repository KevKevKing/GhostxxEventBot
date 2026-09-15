const { check, equal, finish, section, useTempData } = require('./lib');

const temp = useTempData();
const { buildLeaderboardPage, clampPage, getPageCount, invalidateCache } = require('../src/leaderboard');
const { saveEvent } = require('../src/storage');

// Discord-IDs sind 17-19 Stellen lang und damit groesser als JavaScript
// sicher rechnen kann - deshalb als Text zusammensetzen, nicht addieren.
function id(n) {
  return `1000000000000${String(1000 + n)}`;
}

(async () => {
  section('Seitenberechnung');
  const leer = [];
  const genau10 = Array.from({ length: 10 }, (_, i) => i);
  const elf = Array.from({ length: 11 }, (_, i) => i);
  equal('keine Eintraege -> 1 Seite', getPageCount(leer), 1);
  equal('genau 10 -> 1 Seite', getPageCount(genau10), 1);
  equal('11 -> 2 Seiten', getPageCount(elf), 2);

  // Aus dem Knopf kann jede Zahl kommen, auch nach einem Neustart.
  equal('Seite 0 wird auf 1 gezogen', clampPage(0, elf), 1);
  equal('Seite -5 wird auf 1 gezogen', clampPage(-5, elf), 1);
  equal('Seite 99 wird auf die letzte gezogen', clampPage(99, elf), 2);
  equal('Unsinn wird zu 1', clampPage(NaN, elf), 1);

  section('Rangliste aus echten Anmeldungen');
  // 25 Leute, absteigend viele Teilnahmen: Person 1 ist 25x dabei, Person 25 einmal.
  const jetzt = new Date().toISOString();
  for (let n = 1; n <= 25; n += 1) {
    await saveEvent({
      id: `ev-${n}`,
      title: '40er',
      status: 'closed',
      attendees: Array.from({ length: 26 - n }, (_, i) => id(i + 1)),
      substitutes: [],
      createdAt: jetzt,
      startAt: jetzt,
    });
  }
  invalidateCache();

  const seite1 = await buildLeaderboardPage(1, null);
  equal('Seite 1 von 3', [seite1.page, seite1.pageCount], [1, 3]);
  check('erster Platz mit Medaille', seite1.text.startsWith('🥇'), seite1.text.slice(0, 40));
  check('Bestplatzierter ist Person 1', seite1.text.includes(id(1)));
  check('  mit 25 Anmeldungen', seite1.text.includes('**25**'));
  check('zehn Zeilen', seite1.text.split('\n').length === 10, String(seite1.text.split('\n').length));
  check('erste Seite: kein Zurueck', seite1.isFirst && !seite1.isLast);

  const seite2 = await buildLeaderboardPage(2, null);
  equal('Seite 2', seite2.page, 2);
  check('beginnt bei Platz 11', seite2.text.includes('`11.`'), seite2.text.slice(0, 40));
  check('keine Medaille mehr', !seite2.text.includes('🥇'));
  check('mittlere Seite: beides moeglich', !seite2.isFirst && !seite2.isLast);

  const seite3 = await buildLeaderboardPage(3, null);
  check('letzte Seite: kein Weiter', seite3.isLast);
  check('  enthaelt Platz 25', seite3.text.includes('`25.`'), seite3.text.slice(-60));

  section('Ueber die Grenzen hinaus');
  const zuHoch = await buildLeaderboardPage(999, null);
  equal('bleibt auf der letzten Seite', zuHoch.page, 3);
  const zuNiedrig = await buildLeaderboardPage(0, null);
  equal('bleibt auf der ersten Seite', zuNiedrig.page, 1);

  section('Fussnote zaehlt richtig');
  // 25+24+...+1 = 325 Anmeldungen aus 25 Events
  check('Anmeldungen gesamt', seite1.footer.includes('325 Anmeldungen'), seite1.footer);
  check('Events gesamt', seite1.footer.includes('25 Events'), seite1.footer);
  check('Platzbereich', seite1.footer.includes('Platz 1–10 von 25'), seite1.footer);

  temp.cleanup();
  finish();
})();
