const { check, equal, finish, section } = require('./lib');
const {
  ANGRIFF, VERTEIDIGUNG, ergaenzeOffene, frageNach, merkeOffen, offeneMeldung,
  parseSkMeldung, vergissOffen, zeitAus,
} = require('../src/sk-meldung');

// Der echte Satz aus der sk-anmeldung, den Ghostxx weggeschickt hat:
//   "ghost wir haben angegriffen um 21:07 gegen Nemesis"

section('Angriff erkennen');
const nemesis = parseSkMeldung('ghost wir haben angegriffen um 21:07 gegen Nemesis');
equal('Angriff', nemesis?.art, ANGRIFF);
equal('Gegner', nemesis?.gegner, 'Nemesis');
equal('Zeit', nemesis?.zeit, '21:07');
equal('nichts fehlt', nemesis?.fehlt.length, 0);

equal('Name vor dem Verb', parseSkMeldung('wir haben Nemesis angegriffen um 21:07')?.gegner, 'Nemesis');
equal('mit Punkt statt Doppelpunkt', parseSkMeldung('wir haben angriff gegen Elegnu 21.07')?.zeit, '21:07');
equal('volle Stunde', parseSkMeldung('wir greifen Elegnu an um 21 uhr')?.zeit, '21:00');
equal('  und der Gegner', parseSkMeldung('wir greifen Elegnu an um 21 uhr')?.gegner, 'Elegnu');
equal('Befehlsform', parseSkMeldung('erstell mir ein angriff gegen nemesis wir haben 21.07 angegriffen')?.art, ANGRIFF);

section('Verteidigung erkennen');
const verteidigung = parseSkMeldung('ghost wir wurden angegriffen um 16:35 von Elegnu');
equal('Verteidigung', verteidigung?.art, VERTEIDIGUNG);
equal('Gegner', verteidigung?.gegner, 'Elegnu');
equal('Zeit', verteidigung?.zeit, '16:35');

equal('Angreifer vorne', parseSkMeldung('Elegnu hat uns angegriffen um 16:35')?.gegner, 'Elegnu');
equal('  ist Verteidigung', parseSkMeldung('Elegnu hat uns angegriffen um 16:35')?.art, VERTEIDIGUNG);
equal('greifen uns an', parseSkMeldung('Nemesis greift uns gerade an 21:07')?.art, VERTEIDIGUNG);
equal('  Angreifer vor dem Verb', parseSkMeldung('Nemesis greift uns gerade an 21:07')?.gegner, 'Nemesis');
equal('das Wort Verteidigung', parseSkMeldung('verteidigung gegen Elegnu 16:35')?.art, VERTEIDIGUNG);

// "uns" ist der Unterschied. Ohne das Wort ist es unser Angriff.
equal('ohne uns ist es Angriff', parseSkMeldung('wir haben Elegnu angegriffen 16:35')?.art, ANGRIFF);

section('Was fehlt');
const ohneZeit = parseSkMeldung('wir haben angegriffen gegen Nemesis');
equal('nur die Zeit fehlt', ohneZeit?.fehlt.join(), 'zeit');
equal('  passende Rueckfrage', frageNach(ohneZeit), 'Um wie viel Uhr war das?');

const ohneGegner = parseSkMeldung('wir haben angegriffen um 21:07');
equal('nur der Gegner fehlt', ohneGegner?.fehlt.join(), 'gegner');
equal('  passende Rueckfrage', frageNach(ohneGegner), 'Wen habt ihr angegriffen?');

const nackt = parseSkMeldung('wir wurden angegriffen');
equal('beides fehlt', nackt?.fehlt.join(), 'gegner,zeit');
check('  fragt nach beidem', /Wer hat angegriffen, und um wie viel Uhr/.test(frageNach(nackt)));

section('Was KEINE Meldung ist');
// Sonst legt jede Unterhaltung im Kanal eine Anmeldung an.
equal('Frage mit Fragezeichen', parseSkMeldung('ghost wer hat uns angegriffen?'), null);
equal('Frage ohne Fragezeichen', parseSkMeldung('wer hat uns gestern angegriffen'), null);
equal('wann-Frage', parseSkMeldung('wann wurden wir angegriffen'), null);
equal('Smalltalk', parseSkMeldung('hey wie gehts dir'), null);
equal('anderer Befehl', parseSkMeldung('trag mich ein'), null);
equal('leer', parseSkMeldung(''), null);
equal('nichts', parseSkMeldung(null), null);

section('Uhrzeit lesen');
equal('Doppelpunkt', zeitAus('um 21:07'), '21:07');
equal('Punkt', zeitAus('um 21.07'), '21:07');
equal('einstellig', zeitAus('um 9:05'), '09:05');
equal('Uhr', zeitAus('um 21 uhr'), '21:00');
equal('Stunde 25 gilt nicht', zeitAus('um 25:07'), '');
equal('Minute 70 gilt nicht', zeitAus('um 21:70'), '');
equal('keine Zeit', zeitAus('gegen Nemesis'), '');

section('Nachreichen');
// "wir wurden angegriffen" - "von wem?" - "Nemesis"
vergissOffen('u1');
merkeOffen('u1', parseSkMeldung('wir wurden angegriffen um 16:35'));
const nachgereicht = ergaenzeOffene('u1', 'Nemesis');
equal('Gegner ergaenzt', nachgereicht?.gegner, 'Nemesis');
equal('  Zeit bleibt', nachgereicht?.zeit, '16:35');
equal('  fertig', nachgereicht?.fehlt.length, 0);

vergissOffen('u2');
merkeOffen('u2', parseSkMeldung('wir haben angegriffen gegen Nemesis'));
equal('Zeit ergaenzt', ergaenzeOffene('u2', '21:07')?.zeit, '21:07');
equal('  auch mit Vorwort', ergaenzeOffene('u2', 'um 21:07 war das')?.zeit, '21:07');

vergissOffen('u3');
merkeOffen('u3', parseSkMeldung('wir haben angegriffen gegen Nemesis'));
equal('nichts Passendes -> nichts', ergaenzeOffene('u3', 'ok danke dir'), null);

// Nach zehn Minuten ist die halbe Meldung weg - sonst loest ein "21:07" von
// spaeter noch eine Anmeldung aus, die niemand mehr gemeint hat.
vergissOffen('u4');
const jetzt = Date.now();
merkeOffen('u4', parseSkMeldung('wir haben angegriffen gegen Nemesis'), jetzt);
check('kurz danach noch da', !!offeneMeldung('u4', jetzt + 60 * 1000));
check('nach elf Minuten weg', !offeneMeldung('u4', jetzt + 11 * 60 * 1000));
equal('  und nicht mehr zu ergaenzen', ergaenzeOffene('u4', '21:07', jetzt + 11 * 60 * 1000), null);

equal('ohne angefangene Meldung', ergaenzeOffene('niemand', '21:07'), null);

finish();
