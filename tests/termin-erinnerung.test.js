const { check, equal, finish, section } = require('./lib');
const { VORLAUF_MIN, baueRuf, istSelbstErstellt, leseTermin } = require('../src/termin-erinnerung');

// Fuenf FamWars standen bis zu zwoelf Tage offen, weil sie niemand geschlossen
// hat - und wer sich am Tag der Ankuendigung eintrug, wurde am Eventtag nie
// wieder erinnert. Beides haengt an einer Uhrzeit im Feld "wann".

const JETZT = new Date('2026-08-13T12:00:00Z'); // 14:00 Berlin

function berlin(datum) {
  return new Intl.DateTimeFormat('de-DE', {
    timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(datum);
}

section('Termin aus freiem Text lesen');
equal('Datum und Uhrzeit', berlin(leseTermin('13.08.2026 21:00', JETZT)), '13.08., 21:00');
equal('mit Wort dazwischen', berlin(leseTermin('am 13.08.2026 um 21:00 Uhr', JETZT)), '13.08., 21:00');
equal('zweistelliges Jahr', berlin(leseTermin('13.08.26 21:00', JETZT)), '13.08., 21:00');
equal('ohne Jahr', berlin(leseTermin('13.08. 21:00', JETZT)), '13.08., 21:00');
equal('Punkt statt Doppelpunkt', berlin(leseTermin('14.08.2026 20.30', JETZT)), '14.08., 20:30');

// Der Klassiker: "13.08.2026" ohne Uhrzeit darf NICHT als 13:08 gelesen werden.
equal('nur Datum -> nichts', leseTermin('13.08.2026', JETZT), null);
equal('nur Datum ohne Jahr -> nichts', leseTermin('13.08.', JETZT), null);
equal('Freitext ohne Zeit', leseTermin('nächste Woche', JETZT), null);
equal('leer', leseTermin('', JETZT), null);
equal('nichts', leseTermin(null, JETZT), null);

section('Nur eine Uhrzeit');
// Heute, wenn sie noch kommt - sonst morgen. Ein Event in der Vergangenheit
// anzukuendigen waere sinnlos.
equal('spaeter heute', berlin(leseTermin('21:00', JETZT)), '13.08., 21:00');
equal('schon vorbei -> morgen', berlin(leseTermin('09:00', JETZT)), '14.08., 09:00');

section('Unsinn wird nicht geglaubt');
equal('Stunde 25', leseTermin('13.08.2026 25:00', JETZT), null);
equal('Minute 70', leseTermin('13.08.2026 21:70', JETZT), null);
equal('Monat 13', leseTermin('01.13.2026 21:00', JETZT), null);
equal('Tag 40', leseTermin('40.08.2026 21:00', JETZT), null);

section('Wen es betrifft');
check('selbst erstellt', istSelbstErstellt({ status: 'open', createdBy: '286819354589265920' }));
// Geplante Events bringen ihre Zeiten selbst mit, staatliche ihre Inkzeit.
check('geplant nicht', !istSelbstErstellt({ status: 'open', createdBy: 'scheduler' }));
check('staatlich nicht', !istSelbstErstellt({ status: 'open', kind: 'state', createdBy: 'x' }));
check('geschlossen nicht', !istSelbstErstellt({ status: 'closed', createdBy: 'x' }));

section('Wie der zweite Ruf aussieht');
const start = leseTermin('13.08.2026 21:00', JETZT);
const ruf = baueRuf({
  title: 'FamWar', pingRoleId: '1150863456828928130', attendees: new Array(11), maxParticipants: 15,
}, start);
check('ruft die Rolle', ruf.includes('<@&1150863456828928130>'), ruf);
check('nennt das Event', ruf.includes('**FamWar**'), ruf);
check('nennt die Uhrzeit', ruf.includes('21:00 Uhr'), ruf);
check('nennt freie Plaetze', ruf.includes('11/15 dabei, 4 Plätze noch frei'), ruf);

const voll = baueRuf({ title: 'FamWar', attendees: new Array(15), maxParticipants: 15 }, start);
check('bei voll keine freien Plaetze', !voll.includes('frei'), voll);
check('ohne Rolle kein Ruf', !voll.includes('<@&'), voll);

const einer = baueRuf({ title: 'FamWar', attendees: new Array(14), maxParticipants: 15 }, start);
check('Einzahl bei einem Platz', einer.includes('1 Platz noch frei'), einer);

section('Vorlauf');
equal('25 Minuten', VORLAUF_MIN, 25);

finish();
