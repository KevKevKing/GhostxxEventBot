const { check, finish, section, useTempData } = require('./lib');

const temp = useTempData();
const { AB_ANTEIL, VORLAUF_MS, baueText, istErinnerungFaellig } = require('../src/event-erinnerung');

// Der Sinn der Regel ist, NICHT zu spammen. Aus 545 geposteten 40er in 30 Tagen:
// 36 Prozent blieben komplett leer, weitere 36 Prozent kamen ueber fuenf Leute
// nicht hinaus. Nur 17 Prozent standen bei 6 bis 9 von 10 - dort fehlen ein bis
// vier Leute, und dort lohnt sich ein Anstupsen.
//
// Deshalb pruefen die meisten Tests hier, wann er den Mund HAELT.

const JETZT = Date.UTC(2026, 7, 10, 20, 0, 0);

function event(felder = {}) {
  return {
    id: 'e1',
    title: '40er',
    status: 'open',
    attendees: [],
    maxParticipants: 10,
    channelId: 'k1',
    // Schliesst in drei Minuten - also im Vorlauffenster.
    closeAt: new Date(JETZT + 3 * 60 * 1000).toISOString(),
    ...felder,
  };
}

function mitLeuten(anzahl, felder = {}) {
  return event({ attendees: Array.from({ length: anzahl }, (_, i) => `u${i}`), ...felder });
}

(async () => {
  section('Er meldet sich, wenn es knapp ist');
  for (const n of [6, 7, 8, 9]) {
    const r = istErinnerungFaellig(mitLeuten(n), JETZT);
    check(`${n} von 10 -> anstupsen`, r.faellig === true, JSON.stringify(r));
    check(`  fehlen ${10 - n}`, r.fehlen === 10 - n);
  }

  section('Und schweigt, wenn es nichts bringt');
  // Zwei Drittel aller 40er landen hier. Ein Ping waere reine Belaestigung.
  for (const n of [0, 1, 2, 3, 4, 5]) {
    check(`${n} von 10 -> still`, !istErinnerungFaellig(mitLeuten(n), JETZT).faellig);
  }
  check('10 von 10 (voll) -> still', !istErinnerungFaellig(mitLeuten(10), JETZT).faellig);
  check('mehr als voll -> still', !istErinnerungFaellig(mitLeuten(12), JETZT).faellig);

  section('Nur einmal pro Anmeldung');
  // Der Scheduler laeuft alle 30 Sekunden. Ohne Vermerk kaeme der Ping
  // sechsmal, bis die Anmeldung zugeht.
  const schonGemeldet = mitLeuten(8, { erinnertAm: new Date(JETZT - 60000).toISOString() });
  check('zweiter Durchlauf schweigt', !istErinnerungFaellig(schonGemeldet, JETZT).faellig);

  section('Nur kurz vor Schluss');
  check('eine Stunde vorher -> still', !istErinnerungFaellig(
    mitLeuten(8, { closeAt: new Date(JETZT + 60 * 60 * 1000).toISOString() }), JETZT,
  ).faellig);
  check('sieben Minuten vorher -> still', !istErinnerungFaellig(
    mitLeuten(8, { closeAt: new Date(JETZT + 7 * 60 * 1000).toISOString() }), JETZT,
  ).faellig);
  check('vier Minuten vorher -> anstupsen', istErinnerungFaellig(
    mitLeuten(8, { closeAt: new Date(JETZT + 4 * 60 * 1000).toISOString() }), JETZT,
  ).faellig);
  check('schon vorbei -> still', !istErinnerungFaellig(
    mitLeuten(8, { closeAt: new Date(JETZT - 60 * 1000).toISOString() }), JETZT,
  ).faellig);
  check('ohne Schlusszeit -> still', !istErinnerungFaellig(
    mitLeuten(8, { closeAt: '' }), JETZT,
  ).faellig);

  section('Geschlossene und kleine Anmeldungen');
  check('geschlossen -> still', !istErinnerungFaellig(mitLeuten(8, { status: 'closed' }), JETZT).faellig);
  check('abgesagt -> still', !istErinnerungFaellig(mitLeuten(8, { status: 'cancelled' }), JETZT).faellig);
  // Bei drei Plaetzen ist "60 Prozent voll" bedeutungslos.
  check('winzige Anmeldung -> still', !istErinnerungFaellig(
    mitLeuten(2, { maxParticipants: 3 }), JETZT,
  ).faellig);

  section('Die grossen Events trifft es faktisch nie');
  // 25 Plaetze, im Schnitt 1 bis 2 Anmeldungen - 60 Prozent werden nie
  // erreicht. Die Regel begrenzt sich dadurch von selbst auf den 40er.
  check('2 von 25 -> still', !istErinnerungFaellig(mitLeuten(2, { maxParticipants: 25 }), JETZT).faellig);
  check('10 von 25 -> still', !istErinnerungFaellig(mitLeuten(10, { maxParticipants: 25 }), JETZT).faellig);
  check('16 von 25 -> anstupsen', istErinnerungFaellig(mitLeuten(16, { maxParticipants: 25 }), JETZT).faellig);

  section('Die Schwelle stimmt mit der Messung ueberein');
  check(`Grenze bei ${Math.round(AB_ANTEIL * 100)} Prozent`, Math.round(AB_ANTEIL * 10) === 6);
  check('Vorlauf sechs Minuten', VORLAUF_MS === 6 * 60 * 1000);

  section('Der Text');
  const text = baueText(event({ pingRoleId: 'r1' }), { fehlen: 2, dabei: 8, max: 10 });
  check('nennt das Event', /40er/.test(text), text);
  check('nennt den Stand', /8 von 10/.test(text), text);
  check('nennt die freien Plaetze', /2 Plätze/.test(text), text);
  check('pingt die Rolle', /<@&r1>/.test(text), text);

  const einer = baueText(event(), { fehlen: 1, dabei: 9, max: 10 });
  check('Einzahl bei einem Platz', /ein Platz/.test(einer), einer);
  check('ohne Rolle kein Ping', !/<@&/.test(einer), einer);

  temp.cleanup();
  finish();
})();
