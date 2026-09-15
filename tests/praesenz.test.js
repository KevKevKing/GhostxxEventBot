const { check, equal, finish, section, useTempData } = require('./lib');

useTempData();
const { hoechsterBis, istMeilenstein, satz } = require('../src/meilenstein');
const { abendText, besonderesHeute, morgenText, schoenerName } = require('../src/tagesrhythmus');
const { RUHE_BIS, RUHE_VON, faellig } = require('../src/praesenz');

// Die Schwellen sind gemessen, nicht geraten: 2513 Anmeldungen aus 71 Tagen,
// 125 Leute. "10 / 25 / dann jede 50" ergibt 2.3 Meilensteine pro Tag, mit der
// Tagesbremse bleiben 1.5 uebrig. An 27 von 71 Tagen sagt er gar nichts.

section('Was ein Meilenstein ist');
check('10', istMeilenstein(10));
check('25', istMeilenstein(25));
check('50', istMeilenstein(50));
check('100', istMeilenstein(100));
check('500', istMeilenstein(500));

check('9 nicht', !istMeilenstein(9));
check('11 nicht', !istMeilenstein(11));
check('26 nicht', !istMeilenstein(26));
check('75 nicht', !istMeilenstein(75));
check('0 nicht', !istMeilenstein(0));

section('Hoechster erreichter Stand');
// Damit ein Neustart nicht nochmal gratuliert und ein Sprung von 48 auf 52
// nicht verschluckt wird.
equal('bei 9', hoechsterBis(9), 0);
equal('bei 10', hoechsterBis(10), 10);
equal('bei 24', hoechsterBis(24), 10);
equal('bei 25', hoechsterBis(25), 25);
equal('bei 49', hoechsterBis(49), 25);
equal('bei 52', hoechsterBis(52), 50);
equal('bei 149', hoechsterBis(149), 100);
equal('bei 512', hoechsterBis(512), 500);

section('Wie er es sagt');
// "war zum 25. Mal dabei" hat im Chat die Rueckfrage "und wobei?" ausgeloest.
// Wobei stand nirgends. Seitdem muss das Wort "Anmeldung" drin sein.
for (const n of [10, 25, 50, 100, 250, 500]) {
  check(`${n}: sagt wobei`, /Anmeldung/.test(satz({ id: 'u1', anzahl: n })), satz({ id: 'u1', anzahl: n }));
}
check('500er ist besonders', /Wahnsinn/.test(satz({ id: 'u1', anzahl: 500 })));
check('nennt die Person', satz({ id: 'u7', anzahl: 50 }).includes('<@u7>'));

// Ueberwiegt eine Eventart deutlich, wird sie genannt.
const mitArt = satz({ id: 'u1', anzahl: 25, top: { key: '40er', label: '40er', anzahl: 18 } });
check('nennt die Eventart', mitArt.includes('Meistens 40er (18×)'), mitArt);

// Bei zwei Teilnahmen waere "meistens" albern.
const duennerTop = satz({ id: 'u1', anzahl: 25, top: { key: '40er', label: '40er', anzahl: 2 } });
check('nicht bei zwei', !duennerTop.includes('Meistens'), duennerTop);
check('ohne Angabe geht auch', !satz({ id: 'u1', anzahl: 25 }).includes('Meistens'));

section('Morgens: nur was heute besonders ist');
// Der 40er laeuft jeden Tag - den nennt er nicht. Bank gibt es Mo/Mi/Sa,
// Flugzeugtraeger So/Di/Do/Fr.
const montag = besonderesHeute('2026-08-10');
const dienstag = besonderesHeute('2026-08-11');
check('Montag hat Bank', montag.some((e) => e.titel === 'Bank-Event'), JSON.stringify(montag));
check('Dienstag keine Bank', !dienstag.some((e) => e.titel === 'Bank-Event'), JSON.stringify(dienstag));
check('Dienstag hat Flugzeugtraeger', dienstag.some((e) => e.titel === 'Flugzeugtraeger'), JSON.stringify(dienstag));
check('40er wird nicht genannt', !montag.some((e) => e.titel === '40er'));

const text = morgenText('2026-08-10');
check('nennt den Wochentag', text.includes('Montag'), text);
check('nennt die Bank', text.includes('Bank-Event'), text);

// Im Zeitplan stehen die Namen umschrieben, in einer Nachricht an die Familie
// gehoeren die Umlaute hin.
equal('Flugzeugträger', schoenerName('Flugzeugtraeger'), 'Flugzeugträger');
equal('Gießerei', schoenerName('Giesserei'), 'Gießerei');
equal('anderes bleibt', schoenerName('Bank-Event'), 'Bank-Event');
check('im Text mit Umlaut', morgenText('2026-08-13').includes('Flugzeugträger'), morgenText('2026-08-13'));

section('Abends: der Tag in Zahlen');
const voll = abendText({ events: 35, teilnahmen: 120, volle: 4, leute: 22, beste: [
  { id: 'u1', anzahl: 8 }, { id: 'u2', anzahl: 5 }, { id: 'u3', anzahl: 4 },
] });
check('Anzahl Anmeldungen', voll.includes('35 Anmeldungen'), voll);
check('Teilnahmen', voll.includes('120 Teilnahmen'), voll);
check('volle Teams', voll.includes('4 davon waren voll'), voll);
check('die Fleissigsten', voll.includes('<@u1> (8)'), voll);

// Ein einzelner Teilnehmer ist kein "am fleissigsten" - das waere albern.
const duenn = abendText({ events: 3, teilnahmen: 4, volle: 0, leute: 3, beste: [{ id: 'u1', anzahl: 2 }] });
check('kein Fleiss bei zwei', !duenn.includes('fleißigsten'), duenn);
check('keine vollen Teams erwaehnt', !duenn.includes('voll besetzt'), duenn);

// An einem Tag ohne Events sagt er gar nichts.
equal('leerer Tag -> kein Text', abendText({ events: 0, teilnahmen: 0, volle: 0, leute: 0, beste: [] }), '');

section('Nachgereichte Meilensteine');
const mitNach = abendText(
  { events: 30, teilnahmen: 100, volle: 2, leute: 20, beste: [] },
  [{ id: 'u1', anzahl: 50 }, { id: 'u2', anzahl: 100 }],
);
check('haengt sie an', mitNach.includes('Außerdem heute geschafft'), mitNach);
check('beide dabei', mitNach.includes('<@u1>') && mitNach.includes('<@u2>'), mitNach);

const vieleNach = abendText(
  { events: 30, teilnahmen: 100, volle: 0, leute: 20, beste: [] },
  Array.from({ length: 14 }, (_, i) => ({ id: `u${i}`, anzahl: 50 })),
);
check('kuerzt bei vielen', vieleNach.includes('und 4 weitere'), vieleNach);

section('Wann etwas faellig ist');
const zehnUhr30 = new Date('2026-08-10T08:30:00Z').getTime(); // 10:30 Berlin
check('genau zur Zeit', faellig('2026-08-10', '10:30', zehnUhr30));
check('eine Stunde spaeter noch', faellig('2026-08-10', '10:30', zehnUhr30 + 60 * 60 * 1000));
check('drei Stunden spaeter nicht mehr', !faellig('2026-08-10', '10:30', zehnUhr30 + 3 * 60 * 60 * 1000));
check('vorher nicht', !faellig('2026-08-10', '10:30', zehnUhr30 - 60 * 1000));

section('Nachtruhe');
check('von 2 bis 10', RUHE_VON === 2 && RUHE_BIS === 10);

finish();
