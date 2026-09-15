const { check, equal, finish, section } = require('./lib');
const { leseAntwort } = require('../src/bild-uhrzeit');
const { markiereZeitDoppel, tally } = require('../src/logbook');
const { getEvent } = require('../src/logbook-events');

// Der Anlass steht im Logbuch von "64-dannyd5117": zwei Nachweise "40er lose",
// vier Sekunden auseinander. Verschiedene Dateien, verschiedene Bildmasse - der
// Fingerabdruck konnte sie nicht als Doppel erkennen. Identisch waren aber
// Kontostand, Killfeed und vor allem die Spieluhr: beide 20:46 am 09.08.2026.

section('Antwort des Modells auslesen');
// Seit 17.08.: glm-ocr statt qwen3-vl:8b, kein Formular mehr ("UHRZEIT: ...
// DATUM: ..."), sondern roher Lesetext - gemessen an drei echten Ecken, alle
// drei richtig gelesen. Die Spieluhr erkennt der Code selbst daran, dass
// DIREKT danach ein Datum folgt.
const gut = leseAntwort('20:46 09.08.2026');
equal('Stunde', gut?.stunde, 20);
equal('Minute', gut?.minute, 46);
equal('Tag', gut?.tag, 9);
equal('Monat', gut?.monat, 8);
equal('Jahr', gut?.jahr, 2026);
equal('Stundenschluessel', gut?.stundenSchluessel, '2026-08-09 20');
equal('lesbarer Text', gut?.text, '09.08.2026 20:46');

check('einstellige Stunde', leseAntwort('9:05 1.2.2026')?.stundenSchluessel === '2026-02-01 09');
check('zweistelliges Jahr', leseAntwort('20:46 09.08.26')?.jahr === 2026);
check('Bindestrich im Datum', leseAntwort('20:46 09-08-2026')?.tag === 9);
check('Geschwaetz drumherum', leseAntwort('Klar! 20:46 ist es, am 09.08.2026 Sonst noch was?')?.stunde === 20);

// Der Ausschnitt zeigt oft noch einen Countdown daneben ("VERBLEIBEND 07:05
// VOR EMPFANG $150000") - eine zweite, aehnlich aussehende Uhrzeit ohne
// Datum. Die echte Spieluhr muss trotzdem gefunden werden, nicht der
// Countdown - genau das ist bei Kevins echten Bildern die Form gewesen.
const mitCountdown = leseAntwort('VERBLEIBEND 07:05 VOR EMPFANG $150000 21:47 13.08.2026');
equal('nicht der Countdown', mitCountdown?.stunde, 21);
equal('  sondern die echte Uhr', mitCountdown?.minute, 47);
check('Countdown ohne Datum daneben wird nicht verwechselt',
  leseAntwort('VERBLEIBEND 07:05 VOR EMPFANG $150000')?.stunde === undefined);

section('Unsinn wird nicht geglaubt');
// Ein verlesener Wert darf nicht als Tatsache durchgehen - daran haengt am Ende
// jemandes Auszahlung.
equal('Stunde 47', leseAntwort('47:00 09.08.2026'), null);
equal('Minute 99', leseAntwort('20:99 09.08.2026'), null);
equal('Monat 13', leseAntwort('20:46 09.13.2026'), null);
equal('Tag 40', leseAntwort('20:46 40.08.2026'), null);
equal('Jahr 1850', leseAntwort('20:46 09.08.1850'), null);
equal('nur Uhrzeit', leseAntwort('20:46'), null);
equal('nur Datum', leseAntwort('09.08.2026'), null);
equal('gar nichts', leseAntwort('weiss ich nicht'), null);
equal('leer', leseAntwort(''), null);

section('Zwei Aufnahmen desselben Durchgangs');
function eintrag(id, eventKey, zeit) {
  return {
    messageId: id,
    url: `#${id}`,
    images: [{}],
    claim: { ok: true, event: getEvent(eventKey), result: 'lose' },
    doppelVon: null,
    zeitpunkt: zeit ? leseAntwort(`UHRZEIT: ${zeit.uhr}\nDATUM: ${zeit.datum}`) : null,
  };
}

const dannyFall = [
  eintrag('d1', '40er', { uhr: '19:46', datum: '10.08.2026' }),
  eintrag('d2', '40er', { uhr: '20:46', datum: '09.08.2026' }),
  eintrag('d3', '40er', { uhr: '20:46', datum: '09.08.2026' }),
];
equal('einer faellt raus', markiereZeitDoppel(dannyFall), 1);
check('der erste bleibt', !dannyFall[1].zeitDoppelVon);
check('der zweite ist das Doppel', dannyFall[2].zeitDoppelVon?.messageId === 'd2', JSON.stringify(dannyFall[2].zeitDoppelVon));
check('  mit Zeitangabe', /09\.08\.2026 20:46/.test(dannyFall[2].zeitDoppelVon?.zeit || ''));
check('anderer Tag bleibt', !dannyFall[0].zeitDoppelVon);

const z = tally(dannyFall);
equal('40er zaehlt zweimal, nicht dreimal', z.get('40er'), { win: 0, lose: 2 });

section('Was KEIN Doppel ist');
// Dasselbe Event eine Stunde spaeter ist ein neuer Durchgang - der 40er laeuft
// ja stuendlich.
const stundeSpaeter = [
  eintrag('a', '40er', { uhr: '20:46', datum: '09.08.2026' }),
  eintrag('b', '40er', { uhr: '21:46', datum: '09.08.2026' }),
];
equal('kein Doppel', markiereZeitDoppel(stundeSpaeter), 0);

// Zwei verschiedene Events in derselben Stunde sind normal - es laufen ja
// mehrere gleichzeitig.
const zweiEvents = [
  eintrag('c', '40er', { uhr: '20:46', datum: '09.08.2026' }),
  eintrag('d', 'bizwar', { uhr: '20:46', datum: '09.08.2026' }),
];
equal('verschiedene Events', markiereZeitDoppel(zweiEvents), 0);

// Ohne gelesene Uhrzeit wird nichts unterstellt.
const ohneZeit = [
  eintrag('e', '40er', null),
  eintrag('f', '40er', null),
];
equal('ohne Uhrzeit kein Verdacht', markiereZeitDoppel(ohneZeit), 0);
equal('  und beide zaehlen', tally(ohneZeit).get('40er'), { win: 0, lose: 2 });

// Eins mit, eins ohne - reicht nicht fuer einen Vergleich.
const halb = [
  eintrag('g', '40er', { uhr: '20:46', datum: '09.08.2026' }),
  eintrag('h', '40er', null),
];
equal('halbe Angabe reicht nicht', markiereZeitDoppel(halb), 0);

section('Der Fingerabdruck geht vor');
// Ist ein Beitrag schon als gleiche DATEI erkannt, wird er nicht nochmal
// gezaehlt - sonst stuende er zweimal in der Problemliste.
const schonDoppelt = eintrag('i', '40er', { uhr: '20:46', datum: '09.08.2026' });
schonDoppelt.doppelVon = { messageId: 'x', url: '#x' };
const gemischt = [eintrag('j', '40er', { uhr: '20:46', datum: '09.08.2026' }), schonDoppelt];
equal('kein zweiter Vermerk', markiereZeitDoppel(gemischt), 0);

finish();
