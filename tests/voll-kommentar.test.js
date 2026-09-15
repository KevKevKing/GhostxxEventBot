const { check, equal, finish, section, useTempData } = require('./lib');

const temp = useTempData();
const { saveEvent, getEvent } = require('../src/storage');
const { protokolliereVersuch } = require('../src/beitritts-log');
const { istVoll, pruefeVolle, satz, zuruecksetzen } = require('../src/voll-kommentar');
const { config } = require('../src/config');

section('Der Satz - unter einer Minute auf die Millisekunde genau');
// Kevins Ansage: die Zahl muss zu 1000% stimmen, keine grobe Schaetzung mehr.
check('unter 60 Sekunden zeigt Millisekunden',
  /war in 4\.123 Sekunden voll/.test(satz({ title: '40er', maxParticipants: 10 }, 4123)));
check('auch bei unter einer Sekunde', /war in 0\.500 Sekunden voll/.test(satz({ title: 'X', maxParticipants: 5 }, 500)));

section('Der Satz - ab einer Minute in Minuten');
check('genau eine Minute', /nach 1 Minuten voll/.test(satz({ title: 'X', maxParticipants: 5 }, 60000)));
check('drei Minuten', /nach 3 Minuten voll/.test(satz({ title: 'X', maxParticipants: 5 }, 3 * 60000)));
check('ueber fuenf Minuten: kein Spruch ueber Schnelligkeit',
  !/schnell|zack/.test(satz({ title: 'X', maxParticipants: 5 }, 10 * 60000)));

section('istVoll');
check('voll', istVoll({ maxParticipants: 2, attendees: ['a', 'b'] }));
check('nicht voll', !istVoll({ maxParticipants: 2, attendees: ['a'] }));
check('kein Limit gesetzt', !istVoll({ maxParticipants: 0, attendees: ['a'] }));

// Fake-Client, der einen Kanal mit send() liefert - keine echte Discord-
// Verbindung noetig.
function fakeClient(kanalId) {
  const gesendet = [];
  return {
    gesendet,
    channels: {
      fetch: async (id) => (id === kanalId
        ? { isTextBased: () => true, send: async (msg) => { gesendet.push(msg); } }
        : null),
    },
  };
}

(async () => {
  section('pruefeVolle nimmt den exakten Moment aus dem Protokoll');
  config.chatChannelId = 'kanal-1';
  zuruecksetzen();

  const geoeffnetUm = new Date('2026-08-17T20:00:00.000Z');
  // Der zweite (letzte) Beitritt ist 3,7 Sekunden nach dem Oeffnen - GENAU
  // DAS muss in der Meldung stehen, nicht eine grobe Schaetzung vom naechsten
  // Minutentakt (der hier erst viel spaeter laeuft, siehe "jetzt" unten).
  let event = {
    id: 'e1',
    title: 'Der 40er',
    status: 'open',
    maxParticipants: 2,
    attendees: ['a', 'b'],
    openAt: geoeffnetUm.toISOString(),
    createdAt: geoeffnetUm.toISOString(),
    beitrittsLog: [],
  };
  event = protokolliereVersuch(event, 'a', 'beigetreten', new Date('2026-08-17T20:00:01.000Z'));
  event = protokolliereVersuch(event, 'b', 'beigetreten', new Date('2026-08-17T20:00:03.700Z'));
  await saveEvent(event);

  const client = fakeClient('kanal-1');

  // "jetzt" ist absichtlich viel spaeter als der echte Beitritt - genau das
  // beweist, dass die Meldung den PROTOKOLLIERTEN Moment nimmt, nicht die
  // Zeit des Durchlaufs.
  const jetzt = new Date('2026-08-17T20:05:00.000Z').getTime();
  const gesagt = await pruefeVolle(client, jetzt);

  equal('ein Event gemeldet', gesagt.length, 1);
  equal('genau eine Nachricht gesendet', client.gesendet.length, 1);
  check('die Meldung nennt die echten 3,7 Sekunden, nicht die 5 Minuten bis zum Check',
    /war in 3\.700 Sekunden voll/.test(client.gesendet[0].content),
    client.gesendet[0].content);

  const gespeichert = await getEvent('e1');
  check('vollAm ist gesetzt', Boolean(gespeichert.vollAm));
  equal('vollNach ist der exakte Wert (3700ms), nicht die Zeit bis zum Check',
    gespeichert.vollNach, 3700);

  section('Wird nicht doppelt gemeldet');
  const nochmal = await pruefeVolle(client, jetzt + 60000);
  equal('kein zweites Mal', nochmal.length, 0);
  equal('keine zweite Nachricht', client.gesendet.length, 1);

  section('Alte Anmeldungen ohne Protokoll fallen auf die Schaetzung zurueck');
  zuruecksetzen();
  const altesEvent = {
    id: 'e2',
    title: 'Altes Event',
    status: 'open',
    maxParticipants: 1,
    attendees: ['x'],
    openAt: new Date('2026-08-17T21:00:00.000Z').toISOString(),
    // Kein beitrittsLog - so sahen Anmeldungen vor der Umstellung aus.
  };
  await saveEvent(altesEvent);

  const client2 = fakeClient('kanal-1');
  const jetzt2 = new Date('2026-08-17T21:01:30.000Z').getTime();
  const gesagt2 = await pruefeVolle(client2, jetzt2);
  equal('trotzdem gemeldet', gesagt2.length, 1);
  check('Schaetzung aus der Zeitdifferenz (90 Sekunden)',
    /nach 2 Minuten voll/.test(client2.gesendet[0].content), client2.gesendet[0].content);

  temp.cleanup();
  finish();
})();
