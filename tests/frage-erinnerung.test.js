const { check, equal, finish, section, useTempData } = require('./lib');

const temp = useTempData();
const { config } = require('../src/config');
const { ABSTAND_MS, tick } = require('../src/frage-erinnerung');

function fakeClient(user) {
  return { users: { fetch: async (id) => (id === config.ownerId ? user : null) } };
}

(async () => {
  section('Sendet die erste offene Frage per DM');
  const gesendet = [];
  const user = { send: async (text) => { gesendet.push(text); } };
  const gestellt = [];

  const frage = { id: 'satz:bank', frage: 'Was wird fuer die Bank ausgezahlt?', warum: 'Kein Betrag hinterlegt.' };
  const ergebnis = await tick(fakeClient(user), {
    jetzt: 1000,
    holeOffeneFragen: async () => [frage],
    umgebungVerstehen: async () => ({ versucht: 0, gelernt: 0 }),
    merkeAlsGestellt: (userId, f) => gestellt.push({ userId, f }),
  });

  equal('gibt die gestellte Frage zurueck', ergebnis?.id, 'satz:bank');
  equal('eine DM gesendet', gesendet.length, 1);
  check('DM enthaelt die Frage', gesendet[0].includes('Was wird fuer die Bank ausgezahlt?'));
  equal('als gestellt vermerkt', gestellt[0]?.f.id, 'satz:bank');

  section('Kein zweites Mal innerhalb der Abstandszeit');
  const gesendet2 = [];
  const user2 = { send: async (text) => { gesendet2.push(text); } };
  const zuFrueh = await tick(fakeClient(user2), {
    jetzt: 1000 + ABSTAND_MS - 1,
    holeOffeneFragen: async () => [frage],
    umgebungVerstehen: async () => ({ versucht: 0, gelernt: 0 }),
    merkeAlsGestellt: () => {},
  });
  equal('nichts gesendet', gesendet2.length, 0);
  equal('kein Ergebnis', zuFrueh, null);

  section('Nach Ablauf der Abstandszeit wieder faellig');
  const gesendet3 = [];
  const user3 = { send: async (text) => { gesendet3.push(text); } };
  const wiederFaellig = await tick(fakeClient(user3), {
    jetzt: 1000 + ABSTAND_MS + 1,
    holeOffeneFragen: async () => [frage],
    umgebungVerstehen: async () => ({ versucht: 0, gelernt: 0 }),
    merkeAlsGestellt: () => {},
  });
  check('wieder gesendet', gesendet3.length === 1);
  check('Ergebnis da', Boolean(wiederFaellig));

  section('Keine offene Frage: keine DM, kein Fehler');
  const ohneFrage = await tick(fakeClient({ send: async () => { throw new Error('haette nie gesendet werden duerfen'); } }), {
    jetzt: 1000 + 2 * ABSTAND_MS + 1,
    holeOffeneFragen: async () => [],
    umgebungVerstehen: async () => ({ versucht: 0, gelernt: 0 }),
    merkeAlsGestellt: () => {},
  });
  equal('kein Ergebnis', ohneFrage, null);

  section('Wirft nie, auch wenn holeOffeneFragen wirft');
  const trotzFehler = await tick(fakeClient({ send: async () => {} }), {
    jetzt: 1000 + 3 * ABSTAND_MS + 1,
    holeOffeneFragen: async () => { throw new Error('kaputt'); },
    umgebungVerstehen: async () => ({ versucht: 0, gelernt: 0 }),
    merkeAlsGestellt: () => {},
  });
  equal('kein Ergebnis statt Absturz', trotzFehler, null);

  finish();
})();
