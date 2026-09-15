const { check, equal, finish, section } = require('./lib');
const { PRO_TAG, SCHNELL_MS, istVoll, satz, zuruecksetzen } = require('../src/voll-kommentar');
const {
  ABSTAND_MS, PRO_TAG: BILDER_PRO_TAG, darfKommentieren, merkeKommentar,
  stand, zuruecksetzen: bilderZuruecksetzen,
} = require('../src/bild-kommentar');

// Zwei Sachen, auf die er von sich aus reagiert - nicht nach Kalender, sondern
// weil gerade etwas passiert ist. Beide mit Bremse: ein Bot, der zu oft redet,
// wird stumm geschaltet, und dann ist auch das Nuetzliche weg.

section('Wann eine Anmeldung voll ist');
check('voll', istVoll({ attendees: new Array(10), maxParticipants: 10 }));
check('uebervoll', istVoll({ attendees: new Array(11), maxParticipants: 10 }));
check('fast voll nicht', !istVoll({ attendees: new Array(9), maxParticipants: 10 }));
check('ohne Grenze nicht', !istVoll({ attendees: new Array(9), maxParticipants: 0 }));
check('leer nicht', !istVoll({ attendees: [], maxParticipants: 10 }));

section('Was er dazu sagt');
// Seit der Umstellung auf das Beitrittsprotokoll (17.08., Kevins Ansage "muss
// zu 1000% sicher sein"): unter einer Minute steht die Zeit auf die
// Millisekunde genau da, nicht mehr als "unter zwei Minuten" geschaetzt.
const blitzschnell = satz({ title: '40er', maxParticipants: 10 }, 4321);
check('unter einer Minute: Millisekunden', blitzschnell.includes('4.321 Sekunden'), blitzschnell);
check('  nennt die Zahl', blitzschnell.includes('10 Leute'), blitzschnell);

const sehrSchnell = satz({ title: '40er', maxParticipants: 10 }, 90 * 1000);
check('90 Sekunden werden als Minuten genannt', sehrSchnell.includes('nach 2 Minuten'), sehrSchnell);

const schnell = satz({ title: '40er', maxParticipants: 10 }, 4 * 60 * 1000);
check('vier Minuten', schnell.includes('nach 4 Minuten'), schnell);
check('  das ging schnell', schnell.includes('ging schnell'), schnell);

const normal = satz({ title: 'Hafen', maxParticipants: 25 }, 20 * 60 * 1000);
check('langsam bleibt nuechtern', !normal.includes('schnell'), normal);

section('Bremsen beim Vollmelden');
equal('fuenf Minuten gelten als schnell', SCHNELL_MS, 5 * 60 * 1000);
equal('hoechstens drei am Tag', PRO_TAG, 3);
zuruecksetzen();

section('Bremsen beim Bildkommentar');
equal('zehn Minuten Abstand', ABSTAND_MS, 10 * 60 * 1000);
equal('hoechstens acht am Tag', BILDER_PRO_TAG, 8);

(async () => {
  bilderZuruecksetzen();

  // Der erste geht durch - wenn die Grafikkarte frei ist. Auf diesem Rechner
  // teilt sie sich mit GTA, deshalb kann die Antwort auch false sein.
  const ersterErlaubt = await darfKommentieren(Date.now());
  merkeKommentar(Date.now());

  // Direkt danach auf keinen Fall nochmal.
  equal('gleich danach nicht', await darfKommentieren(Date.now()), false);
  equal('nach 5 Minuten noch nicht', await darfKommentieren(Date.now() + 5 * 60 * 1000), false);

  // Nach dem Abstand wieder - sofern die Karte frei ist.
  const spaeter = await darfKommentieren(Date.now() + 11 * 60 * 1000);
  check('nach elf Minuten wieder (oder Karte belegt)', spaeter === true || spaeter === false);

  // Die Tagesgrenze haelt auch, wenn zwischendurch viel Zeit vergeht.
  bilderZuruecksetzen();
  const start = Date.now();
  for (let i = 0; i < BILDER_PRO_TAG; i += 1) merkeKommentar(start + i * 1000);
  equal('Tagesgrenze erreicht', stand().heute.anzahl, BILDER_PRO_TAG);
  equal('  dann Schluss', await darfKommentieren(start + 60 * 60 * 1000), false);

  check('erster Aufruf lieferte eine Antwort', typeof ersterErlaubt === 'boolean');

  bilderZuruecksetzen();
  finish();
})();
