const { check, equal, finish, section, useTempData } = require('./lib');

const temp = useTempData();
const knowledge = require('../src/knowledge');
const { kurz, parseTeach } = require('../src/teach-parser');

(async () => {
  section('Beibringen erkennen');
  const lernSaetze = [
    ['merk dir Pascal spielt nie 40er', 'Pascal spielt nie 40er'],
    ['merke dir dass die Waffenfabrik viermal am Tag laeuft', 'die Waffenfabrik viermal am Tag laeuft'],
    ['Ghost, merk dir bitte dass wir montags Bank machen', 'wir montags Bank machen'],
    ['ghost merk dir: unsere Farbe ist grün', 'unsere Farbe ist grün'],
    ['merk dir, dass Nox Turfleader ist', 'Nox Turfleader ist'],
    ['lern dass Johannes der zweite Owner ist', 'Johannes der zweite Owner ist'],
    ['notier dir die Regel: keine POVs ohne Absprache', 'die Regel: keine POVs ohne Absprache'],
    ['speicher dass Fedex immer spät kommt', 'Fedex immer spät kommt'],
    ['wissen: der 40er startet immer um :40', 'der 40er startet immer um :40'],
    ['behalte dass Nox der Turfleader ist', 'Nox der Turfleader ist'],
  ];
  for (const [text, erwartet] of lernSaetze) {
    const r = parseTeach(text);
    check(`"${text.slice(0, 42)}"`, r?.art === 'lernen' && r.inhalt === erwartet, JSON.stringify(r));
  }

  section('Vergessen erkennen');
  for (const [text, erwartet] of [
    ['vergiss was du über Pascal weißt', 'Pascal'],
    ['vergiss alles was du über Pascal weißt', 'Pascal'],
    ['vergiss Pascal', 'Pascal'],
    ['lösche das Wissen über die Waffenfabrik', 'die Waffenfabrik'],
  ]) {
    const r = parseTeach(text);
    check(`"${text.slice(0, 42)}"`, r?.art === 'vergessen' && r.inhalt === erwartet, JSON.stringify(r));
  }

  section('Abfragen erkennen');
  equal('"was weißt du über Pascal"', parseTeach('was weißt du über Pascal')?.inhalt, 'Pascal');
  equal('"was weißt du?"', parseTeach('was weißt du?')?.art, 'abfragen');
  equal('"zeig mir dein wissen"', parseTeach('zeig mir dein wissen')?.art, 'abfragen');

  section('Normales Reden bleibt unberuehrt');
  for (const text of [
    'hey wie gehts', 'ist die erde rund', 'tausche im 40er @a mit @b',
    'merk', 'wer ist der beste spieler', 'trag mich ein',
  ]) {
    check(`"${text}"`, parseTeach(text) === null, JSON.stringify(parseTeach(text)));
  }

  section('Merken und wiederfinden');
  let r = await knowledge.remember('Pascal spielt nie 40er', 'u1');
  check('gemerkt', r.ok, JSON.stringify(r));
  equal('einer drin', await knowledge.count(), 1);

  // Zweimal dasselbe bringt nichts.
  r = await knowledge.remember('Pascal spielt nie 40er', 'u1');
  equal('doppelt wird abgelehnt', r.reason, 'schon_bekannt');
  equal('immer noch einer', await knowledge.count(), 1);

  // Andere Schreibweise gilt als dasselbe.
  r = await knowledge.remember('PASCAL SPIELT NIE 40ER', 'u1');
  equal('Gross- und Kleinschreibung egal', r.reason, 'schon_bekannt');

  check('zu kurz wird abgelehnt', (await knowledge.remember('ok', 'u1')).reason === 'zu_kurz');

  await knowledge.remember('Die Waffenfabrik startet um 03:20', 'u1');
  await knowledge.remember('Bank machen wir montags und donnerstags', 'u1');
  await knowledge.remember('Johannes Conti ist der zweite Owner', 'u1');
  equal('vier Einträge', await knowledge.count(), 4);

  section('Suchen');
  const gefunden = await knowledge.search('Pascal');
  equal('Pascal gefunden', gefunden.length, 1);
  check('  richtiger Satz', gefunden[0].text.includes('40er'));
  equal('Waffenfabrik gefunden', (await knowledge.search('waffenfabrik')).length, 1);
  equal('nichts zu Berlin', (await knowledge.search('Berlin')).length, 0);

  section('Wissen fuer den Prompt auswaehlen');
  // Bei wenig Wissen bekommt er alles - das ist zuverlaessiger als jede Auswahl.
  const alles = await knowledge.relevant('irgendwas ganz anderes');
  equal('alle vier mitgegeben', alles.length, 4);

  section('Bei viel Wissen wird ausgewaehlt');
  for (let i = 0; i < 30; i += 1) {
    await knowledge.remember(`Zufallsfakt Nummer ${i} über Thema ${i}`, 'u1');
  }
  check('über der Schwelle', await knowledge.count() > knowledge.ALLE_BIS);

  const passend = await knowledge.relevant('was ist mit Pascal und dem 40er');
  check('Auswahl bleibt klein', passend.length <= 10, `${passend.length}`);
  check('Pascal ist dabei', passend.some((f) => /Pascal/i.test(f.text)),
    passend.map((f) => f.text).join(' | '));

  // Passt nichts, bekommt er trotzdem etwas statt gar nichts.
  const nichts = await knowledge.relevant('völlig zusammenhangloses Kauderwelsch xyzq');
  check('nie ganz leer', nichts.length > 0);

  section('Vergessen');
  const weg = await knowledge.forget('Pascal');
  check('gefunden und entfernt', weg.ok && weg.entfernt.length === 1, JSON.stringify(weg.entfernt));
  equal('Pascal ist weg', (await knowledge.search('Pascal')).length, 0);

  const nichtsDa = await knowledge.forget('Australien');
  equal('unbekanntes meldet sich', nichtsDa.reason, 'nichts_gefunden');
  equal('leere Suche meldet sich', (await knowledge.forget('')).reason, 'zu_unklar');

  section('Ueberlebt einen Neustart');
  const vorher = await knowledge.count();
  knowledge.invalidateCache();
  equal('alles noch da', await knowledge.count(), vorher);
  check('Inhalt noch da', (await knowledge.search('waffenfabrik')).length === 1);

  section('Kurzfassung fuers Anzeigen');
  equal('kurzes bleibt', kurz('kurz'), 'kurz');
  check('langes wird gekuerzt', kurz('x'.repeat(200), 50).length === 50);
  equal('Zeilenumbrueche raus', kurz('a\nb'), 'a b');

  temp.cleanup();
  finish();
})();
