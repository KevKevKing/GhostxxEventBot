const { check, equal, finish, section, useTempData } = require('./lib');

const temp = useTempData();
const { addParticipant, removeParticipant, swapParticipants } = require('../src/event-actions');
const { getEvent, saveEvent } = require('../src/storage');

const A = '111111111111111111';
const B = '222222222222222222';
const C = '333333333333333333';
const D = '444444444444444444';

async function makeEvent(id, attendees, substitutes, max = 3, maxSub = 2, extra = {}) {
  await saveEvent({
    id,
    title: '40er',
    slug: '40er',
    status: 'open',
    attendees: [...attendees],
    substitutes: [...substitutes],
    maxParticipants: max,
    maxSubstitutes: maxSub,
    startAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    ...extra,
  });
}

(async () => {
  section('Tausch bei voller Liste');
  // Der Grund fuer die atomare Operation: als remove + add wuerde der erste
  // rausfliegen und der zweite nicht mehr reinpassen.
  await makeEvent('e1', [A, B, C], [], 3, 0);
  let r = await swapParticipants('e1', B, D);
  equal('gelingt trotz voller Liste', [r.ok, r.status], [true, 'swapped_main']);
  equal('Position bleibt erhalten', (await getEvent('e1')).attendees, [A, D, C]);

  section('Platztausch zwischen Liste und Bank');
  await makeEvent('e2', [A, B], [C], 2, 2);
  r = await swapParticipants('e2', B, C);
  equal('Ersatz rueckt hoch', [r.ok, r.status], [true, 'promoted_substitute']);
  let e = await getEvent('e2');
  equal('  C in der Hauptliste', e.attendees, [A, C]);
  equal('  B auf der Bank', e.substitutes, [B]);

  r = await swapParticipants('e2', B, C);
  equal('umgekehrte Richtung', [r.ok, r.status], [true, 'demoted_attendee']);
  e = await getEvent('e2');
  equal('  wieder zurueck', [e.attendees, e.substitutes], [[A, B], [C]]);

  section('Fehlerfaelle aendern nichts');
  await makeEvent('e3', [A, B], [], 3, 0);
  r = await swapParticipants('e3', C, D);
  equal('unbekannter Spieler', [r.ok, r.status], [false, 'out_not_joined']);
  equal('  Liste unveraendert', (await getEvent('e3')).attendees, [A, B]);

  r = await swapParticipants('e3', A, B);
  equal('beide schon drin', [r.ok, r.status], [false, 'in_already_joined']);
  equal('  Liste unveraendert', (await getEvent('e3')).attendees, [A, B]);

  r = await swapParticipants('e3', A, A);
  equal('mit sich selbst', [r.ok, r.status], [false, 'same_user']);

  r = await swapParticipants('gibtsnicht', A, B);
  equal('unbekanntes Event', [r.ok, r.status], [false, 'event_missing']);

  section('Ein- und Austragen');
  await makeEvent('e4', [A, B, C], [], 3, 0);
  r = await addParticipant('e4', D);
  equal('volle Liste lehnt ab', [r.ok, r.status], [false, 'main_full']);

  await makeEvent('e5', [A], [], 3, 2);
  r = await addParticipant('e5', B, { substitute: true });
  equal('als Ersatz eintragen', [r.ok, r.status], [true, 'added_substitute']);
  r = await addParticipant('e5', B);
  equal('doppelt eintragen abgelehnt', [r.ok, r.status], [false, 'already_joined']);
  r = await removeParticipant('e5', B);
  equal('Ersatz austragen', [r.ok, r.status], [true, 'removed_substitute']);
  r = await removeParticipant('e5', D);
  equal('nicht Eingetragenen austragen', [r.ok, r.status], [false, 'not_joined']);

  section('Karteileichen zaehlen nicht als aktuell');
  const { isLive } = require('../src/event-actions');
  const jetzt = new Date();
  const alt = new Date(jetzt.getTime() - 20 * 60 * 60 * 1000).toISOString();
  check('offen ohne closeAt und alt -> nicht aktuell',
    !isLive({ status: 'open', createdAt: alt }, jetzt));
  check('offen ohne closeAt und frisch -> aktuell',
    isLive({ status: 'open', createdAt: jetzt.toISOString() }, jetzt));
  check('geschlossen -> nie aktuell',
    !isLive({ status: 'closed', closeAt: new Date(jetzt.getTime() + 1000).toISOString() }, jetzt));

  temp.cleanup();
  finish();
})();
