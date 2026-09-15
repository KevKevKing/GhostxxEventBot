const { check, equal, finish, section } = require('./lib');
const { antworteTermin, findeEventArt, naechsteTermine, parseTerminFrage } = require('../src/terminplan-wissen');

// "Wann ist der naechste 40er?" ging bisher ans Sprachmodell - das hat weder
// Kalender noch Uhr und hat deshalb geraten. Dabei stehen alle 49 Termine im
// Code.

// Montag, 10.08.2026, 18:10 Berliner Zeit.
const MONTAG_ABEND = new Date('2026-08-10T16:10:00Z');

section('Terminfragen erkennen');
for (const text of [
  'wann ist der naechste 40er',
  'wann läuft der nächste bizwar',
  'was kommt als nächstes',
  'wann ist die nächste bank',
]) {
  check(`"${text}"`, parseTerminFrage(text)?.art === 'termin', JSON.stringify(parseTerminFrage(text)));
}

section('Uhrzeit und Datum');
for (const text of ['wie spät ist es', 'welcher tag ist heute', 'sag mal die uhrzeit']) {
  check(`"${text}"`, parseTerminFrage(text)?.art === 'uhrzeit', JSON.stringify(parseTerminFrage(text)));
}

section('Was KEINE Terminfrage ist');
// "wann war X dabei" fragt das Archiv, nicht den Plan - das beantwortet der
// Statistikteil und wuerde hier sonst abgefangen.
for (const text of [
  'wann war Pascal zuletzt dabei',
  'wann war ich das letzte mal dabei',
  'wie gehts dir',
  'wer ist Fedex Wave',
  'trag mich beim 40er ein',
]) {
  check(`"${text}"`, parseTerminFrage(text) === null, JSON.stringify(parseTerminFrage(text)));
}

section('Eventart aus der Frage');
for (const [text, erwartet] of [
  ['wann ist der nächste 40er', '40er'],
  ['wann läuft bizwar', 'BizWar'],
  ['wann ist die nächste bank', 'Bank-Event'],
  ['wann ist wf', 'Waffenfabrik'],
  ['wann ist der nächste hafen', 'Hafen'],
  ['wann kommt das gefängnis', 'Angriff auf das Gefaengnis'],
  ['was kommt als nächstes', ''],
]) {
  equal(`"${text}"`, findeEventArt(text), erwartet);
}

section('Die naechsten Termine stimmen');
// Der 40er laeuft stuendlich zur vollen Stunde plus 40 Minuten.
const vierziger = naechsteTermine('40er', { jetzt: MONTAG_ABEND, anzahl: 3 });
equal('drei Termine', vierziger.length, 3);
check('erster noch heute', vierziger[0].heute === true, JSON.stringify(vierziger[0]));
check('aufsteigend sortiert', vierziger[0].start < vierziger[1].start && vierziger[1].start < vierziger[2].start);
check('alle in der Zukunft', vierziger.every((t) => t.start > MONTAG_ABEND));
check('Anmeldung liegt davor', vierziger.every((t) => t.anmeldungAb < t.start));

// Bank laeuft nur montags, mittwochs, samstags - der naechste muss einer davon sein.
const bank = naechsteTermine('Bank-Event', { jetzt: MONTAG_ABEND, anzahl: 3 });
check('Bank findet Termine', bank.length > 0);
check('nur an Banktagen', bank.every((t) => ['Montag', 'Mittwoch', 'Samstag'].includes(t.wochentag)),
  bank.map((t) => t.wochentag).join(', '));

// Ohne Eventart: einfach das Naechste, was ansteht.
const irgendwas = naechsteTermine('', { jetzt: MONTAG_ABEND, anzahl: 4 });
equal('vier Termine', irgendwas.length, 4);
check('gemischte Events moeglich', new Set(irgendwas.map((t) => t.titel)).size >= 1);

section('Unbekanntes Event');
const nichts = naechsteTermine('Gibtsnicht', { jetzt: MONTAG_ABEND });
equal('findet nichts', nichts.length, 0);
check('und sagt das auch', /nicht im Plan/.test(antworteTermin({ art: 'termin', eventArt: 'Gibtsnicht' }, MONTAG_ABEND)));

section('Die Antwort');
const text = antworteTermin({ art: 'termin', eventArt: '40er' }, MONTAG_ABEND);
check('nennt das Event', /40er/.test(text), text);
check('nennt eine Uhrzeit', /\d{2}:\d{2}/.test(text), text);
check('sagt wie lange noch', /in \d+ (Minuten|Stunden|Std)/.test(text), text);
check('nennt die Anmeldung', /Anmeldung ab/.test(text), text);

const zeit = antworteTermin({ art: 'uhrzeit' }, MONTAG_ABEND);
check('Datum mit Wochentag', /Montag/.test(zeit), zeit);
check('mit Uhrzeit', /\d{2}:\d{2} Uhr/.test(zeit), zeit);

finish();
