const { check, equal, finish, section, useTempData } = require('./lib');

const temp = useTempData();
const { findePerson, frühereNamen, merkeNamen, spielerNummer } = require('../src/namens-gedaechtnis');

// Der Anlass: Im Logbuch steht ein Thread "Orhan Schimpansenfliege | 196034",
// angelegt hat ihn "Lenny Lonee | 196034". Derselbe Mensch nach einer
// Umbenennung. Der Name aendert sich, die Spielernummer bleibt.

(async () => {
  section('Spielernummer aus dem Namen');
  equal('mit Strich', spielerNummer('Ghost Muffiin | 266391'), '266391');
  equal('mit I statt Strich', spielerNummer('Dennis Wesh I 142391'), '142391');
  equal('ohne Abstand', spielerNummer('Pauli Erotica I329559'), '329559');
  equal('ohne Nummer', spielerNummer('Lofi Radio'), '');
  equal('Nummer mittendrin zaehlt nicht', spielerNummer('40er 9 von 9 Belohnung'), '');
  equal('leer vertraegt es', spielerNummer(''), '');

  section('Umbenennungen merken');
  const erst = await merkeNamen('u1', 'Lenny Lonee | 196034');
  check('erster Name ist keine Aenderung', erst.neu === false, JSON.stringify(erst));

  const nochmal = await merkeNamen('u1', 'Lenny Lonee | 196034');
  check('gleicher Name aendert nichts', nochmal.neu === false);

  const geaendert = await merkeNamen('u1', 'Orhan Schimpansenfliege | 196034');
  check('Umbenennung wird erkannt', geaendert.neu === true, JSON.stringify(geaendert));
  equal('  kennt den alten Namen', geaendert.vorher, 'Lenny Lonee | 196034');

  const alte = await frühereNamen('u1');
  check('alter Name bleibt abrufbar', alte.includes('Lenny Lonee | 196034'), JSON.stringify(alte));
  check('  aktueller Name steht nicht dabei', !alte.includes('Orhan Schimpansenfliege | 196034'));

  section('Suche findet auch unter dem alten Namen');
  const perAlt = await findePerson('Lenny Lonee');
  equal('ein Treffer', perAlt.length, 1);
  equal('  richtige Person', perAlt[0].userId, 'u1');
  equal('  als frueherer Name markiert', perAlt[0].ueber, 'frueher');
  equal('  nennt den heutigen Namen', perAlt[0].name, 'Orhan Schimpansenfliege | 196034');

  const perNeu = await findePerson('Orhan');
  equal('unter dem neuen Namen auch', perNeu[0]?.ueber, 'aktuell');

  section('Suche ueber die Spielernummer');
  // Die ueberlebt jede Umbenennung - deshalb der verlaesslichste Weg.
  const perNummer = await findePerson('196034');
  equal('nackte Nummer findet', perNummer[0]?.userId, 'u1');
  equal('  ueber die Nummer', perNummer[0]?.ueber, 'nummer');

  const perVollname = await findePerson('Irgendwer | 196034');
  equal('Nummer schlaegt Name', perVollname[0]?.userId, 'u1');

  section('Mehrere Leute');
  await merkeNamen('u2', 'Ghost Muffiin | 266391');
  await merkeNamen('u3', 'Fedex Wave | 258761');

  equal('jeder fuer sich', (await findePerson('Ghost'))[0]?.userId, 'u2');
  equal('  und der andere', (await findePerson('Fedex'))[0]?.userId, 'u3');
  equal('Unbekanntes findet nichts', (await findePerson('Napoleon')).length, 0);
  equal('Leeres findet nichts', (await findePerson('')).length, 0);

  section('Verlauf bleibt begrenzt');
  for (let i = 0; i < 15; i += 1) await merkeNamen('u4', `Name ${i} | 111111`);
  const viele = await frühereNamen('u4');
  check('hoechstens zehn gemerkt', viele.length <= 10, String(viele.length));
  check('  der juengste alte zuerst', viele[0] === 'Name 13 | 111111', viele[0]);

  temp.cleanup();
  finish();
})();
