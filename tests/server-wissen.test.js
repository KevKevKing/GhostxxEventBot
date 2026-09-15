const { check, equal, finish, section, useTempData } = require('./lib');

const temp = useTempData();
const { aufgabenRollen, beschreibePerson, buildServerContext, kanalKarte, rangleiter } = require('../src/server-wissen');

// Nachgebauter Server mit der echten Struktur der Familie Unknown.
function rolle(id, name, position) {
  return { id, name, position };
}

const ROLLEN = [
  rolle('r9', '9 Legende', 30),
  rolle('r8', '8 Turf Leader', 25),
  rolle('r7', '7 BIG HOMIE', 20),
  rolle('r4', '4 Member', 10),
  rolle('r1', '1 HOTEL', 5),
  rolle('auszahlung', 'Auszahlung', 40),
  rolle('beschwerde', 'Beschwerde Leitung', 41),
  rolle('waffen', 'zuständig fürs Waffenlager', 42),
  rolle('bot', 'MEE6', 50),
  rolle('booster', 'Server Booster', 51),
  rolle('leer', 'Ausbilder', 43),
  rolle('everyone', '@everyone', 0),
];

function member(id, name, rollenIds, joined) {
  return {
    id,
    displayName: name,
    user: { username: name.toLowerCase() },
    roles: { cache: new Map(rollenIds.map((r) => [r, {}])) },
    joinedTimestamp: joined,
  };
}

const MITGLIEDER = [
  member('u1', 'Ghost Muffiin', ['r9', 'auszahlung'], Date.UTC(2025, 0, 15)),
  member('u2', 'Fedex Wave', ['r8', 'beschwerde'], Date.UTC(2025, 5, 1)),
  member('u3', 'Pascal', ['r4'], Date.UTC(2026, 1, 3)),
  member('u4', 'Nox', ['r7', 'waffen'], Date.UTC(2025, 8, 9)),
  member('bot1', 'MEE6', ['bot'], Date.UTC(2024, 0, 1)),
];

const guild = {
  roles: { cache: new Map(ROLLEN.map((r) => [r.id, r])) },
  members: { cache: new Map(MITGLIEDER.map((m) => [m.id, m])) },
};

(async () => {
  section('Rangleiter aus den Rollennamen');
  // Die Raenge tragen ihre Nummer im Namen - "9 Legende", "4 Member". Nichts
  // davon ist abgetippt, sonst waere es veraltet, sobald jemand umbenennt.
  const leiter = rangleiter(guild);
  equal('fuenf Raenge erkannt', leiter.length, 5);
  equal('hoechster zuerst', leiter[0].stufe, 9);
  equal('  Bezeichnung ohne Nummer', leiter[0].bezeichnung, 'Legende');
  equal('niedrigster zuletzt', leiter[leiter.length - 1].stufe, 1);
  equal('zaehlt die Leute', leiter.find((r) => r.stufe === 9).anzahl, 1);
  check('Aufgabenrollen sind keine Raenge', !leiter.some((r) => r.name === 'Auszahlung'));

  section('Aufgabenrollen');
  const aufgaben = aufgabenRollen(guild).map((r) => r.name);
  check('Auszahlung dabei', aufgaben.includes('Auszahlung'), aufgaben.join(', '));
  check('Beschwerde Leitung dabei', aufgaben.includes('Beschwerde Leitung'));
  check('Waffenlager dabei', aufgaben.includes('zuständig fürs Waffenlager'));
  check('Raenge NICHT dabei', !aufgaben.includes('4 Member'));
  check('Bots NICHT dabei', !aufgaben.includes('MEE6'));
  check('Booster NICHT dabei', !aufgaben.includes('Server Booster'));
  check('leere Rollen NICHT dabei', !aufgaben.includes('Ausbilder'));

  section('Personenbeschreibung');
  const text = beschreibePerson({
    id: 'u2',
    name: 'Fedex Wave',
    rang: '8 Turf Leader',
    aufgaben: ['Beschwerde Leitung'],
    dabeiSeit: new Date(Date.UTC(2025, 5, 1)),
    teilnahmen: 42,
    letztesEvent: { titel: '40er', zeit: new Date(Date.UTC(2026, 7, 8)) },
  });
  check('Name', /Fedex Wave/.test(text), text);
  check('Rang', /8 Turf Leader/.test(text), text);
  check('Aufgabe', /Beschwerde Leitung/.test(text), text);
  check('Teilnahmen', /42 Event-Anmeldungen/.test(text), text);
  check('letztes Event', /zuletzt 40er/.test(text), text);

  const neuling = beschreibePerson({
    id: 'u3', name: 'Pascal', rang: '4 Member', aufgaben: [],
    dabeiSeit: null, teilnahmen: 0, letztesEvent: null,
  });
  check('ohne Teilnahmen sauber formuliert', /noch bei keinem Event/.test(neuling), neuling);
  check('  keine leere Aufgabenliste', !/Aufgaben:/.test(neuling), neuling);

  section('Kontext nur zur passenden Frage');
  // Steht alles bei jeder Nachricht im Prompt, zieht er es ins Gespraech.
  const raenge = await buildServerContext('wer sind die leute hier', guild);
  check('Raenge kommen bei Personenfragen', /Legende/.test(raenge), raenge);

  const wer_macht = await buildServerContext('wer ist fuer die auszahlung zustaendig', guild);
  check('Aufgaben kommen bei Aufgabenfragen', /Auszahlung/.test(wer_macht), wer_macht);

  const orte = await buildServerContext('in welchem kanal melde ich mich an', guild);
  check('Kanaele kommen bei Ortsfragen', /Event-Anmeldungen/.test(orte), orte);

  const nichts = await buildServerContext('wer war napoleon', guild);
  equal('Wissensfrage bekommt nichts', nichts, '');

  const auch_nichts = await buildServerContext('hey wie gehts', guild);
  equal('Geplauder bekommt nichts', auch_nichts, '');

  section('Kanalkarte');
  const karte = kanalKarte();
  check('enthaelt Eintraege', karte.length >= 5, String(karte.length));
  check('jeder mit Beschreibung', karte.every(([id, was]) => id && was));

  section('Ohne Guild kein Absturz');
  equal('kein Server -> leer', await buildServerContext('wer sind die leute', null), '');
  equal('rangleiter vertraegt null', rangleiter(null).length, 0);
  equal('aufgabenRollen vertraegt null', aufgabenRollen(null).length, 0);

  temp.cleanup();
  finish();
})();
