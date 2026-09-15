const { check, equal, finish, section } = require('./lib');
const { MINDESTBETRAG, SAETZE, euro, formatiere, rechne, satzFuer } = require('../src/auszahlung-saetze');
const { EVENTS } = require('../src/logbook-events');

// Die Saetze stammen aus dem Kanal auszahlung-info, nicht aus der Tabelle.
// Dort steht die Grundliste vom 28.04.2026 und danach drei Anpassungen - die
// muessen eingerechnet sein, sonst zahlt er nach alten Werten.

section('Die Anpassungen sind drin');
equal('40er Win (07.05.: 50k -> 60k)', SAETZE['40er'].win, 60000);
equal('40er Lose (07.05.: 20k -> 25k)', SAETZE['40er'].lose, 25000);
equal('SK Win (01.05.: 50k -> 80k)', SAETZE.sk.win, 80000);
equal('Weinberge Win (01.05.: 50k -> 100k)', SAETZE.weinberge.win, 100000);
equal('RP-Fabrik Win (24.05.: 350k -> 275k)', SAETZE['rp-fabrik'].win, 275000);
equal('RP-Fabrik Lose', SAETZE['rp-fabrik'].lose, 50000);

section('Der Rest der Liste');
equal('EKZ', SAETZE.ekz.win, 50000);
equal('Gießerei Win', SAETZE.giesserei.win, 50000);
equal('Gießerei Lose', SAETZE.giesserei.lose, 20000);
equal('Hafen pro Drop', SAETZE.hafen.win, 50000);
equal('Waffenfabrik Win', SAETZE.waffenfabrik.win, 50000);
equal('Fam-Raid', SAETZE.famraid.win, 25000);
equal('Flugzeugträger Win', SAETZE.flugzeugtraeger.win, 40000);
equal('Bank Win', SAETZE.bank.win, 40000);

section('Was sich nicht ausrechnen laesst');
// BizWar haengt vom Unternehmen ab, FamWar von den erhaltenen Gegenstaenden.
// Beides steht so in auszahlung-info - hier wird nichts geraten.
check('BizWar geht an einen Menschen', SAETZE.bizwar.vonHand && SAETZE.bizwar.win === null);
check('FamWar geht an einen Menschen', SAETZE.famwar.vonHand && SAETZE.famwar.win === null);

section('Rechnen');
const einfach = rechne(new Map([['40er', { win: 10, lose: 4 }]]));
equal('10 Siege + 4 Niederlagen', einfach.summe, 10 * 60000 + 4 * 25000);
equal('  eine Zeile', einfach.zeilen.length, 1);
equal('  nichts offen', einfach.offen.length, 0);

const gemischt = rechne(new Map([
  ['40er', { win: 12, lose: 7 }],
  ['weinberge', { win: 2, lose: 0 }],
  ['rp-fabrik', { win: 1, lose: 2 }],
]));
equal('Summe stimmt', gemischt.summe, 12 * 60000 + 7 * 25000 + 2 * 100000 + 1 * 275000 + 2 * 50000);
check('groesster Posten zuerst', gemischt.zeilen[0].key === '40er', JSON.stringify(gemischt.zeilen.map((z) => z.key)));

section('Unklares wandert zur Handarbeit, nicht in die Summe');
const mitOffen = rechne(new Map([
  ['40er', { win: 1, lose: 0 }],
  ['bizwar', { win: 3, lose: 0 }],
  ['famwar', { win: 5, lose: 0 }],
]));
equal('nur der 40er zaehlt', mitOffen.summe, 60000);
equal('zwei offene Posten', mitOffen.offen.length, 2);
check('BizWar mit Begruendung', mitOffen.offen.some((o) => /75k, 150k oder 250k/.test(o.grund)));

// Events ohne hinterlegten Satz duerfen nicht still verschwinden.
const unbekannt = rechne(new Map([['50er', { win: 3, lose: 1 }]]));
equal('50er zaehlt nicht mit', unbekannt.summe, 0);
check('wird aber gemeldet', unbekannt.offen.some((o) => o.key === '50er' && /kein Satz/.test(o.grund)));

section('Welche Events keinen Satz haben');
// In auszahlung-info stehen sie nicht - erfinden waere hier das Schlimmste,
// was man tun kann. Sie sollen auffallen, nicht verschwinden.
const ohneSatz = EVENTS.filter((e) => !satzFuer(e.key)).map((e) => e.label);
check('genau die vier bekannten', ohneSatz.length === 4, ohneSatz.join(', '));
for (const label of ['50er', 'Hotel', 'Gefängnis', 'Waffenteile']) {
  check(`  ${label} hat keinen Satz`, ohneSatz.includes(label), ohneSatz.join(', '));
}

section('Darstellung');
const text = formatiere(gemischt);
check('nennt die Summe', /Auszahlung: \$/.test(text), text);
check('deutsche Tausenderpunkte', /\$1\.\d{3}\.\d{3}/.test(text), text);

const klein = formatiere(rechne(new Map([['40er', { win: 1, lose: 0 }]])));
check('Hinweis auf die Mindestgrenze', new RegExp(`Unter \\$${MINDESTBETRAG.toLocaleString('de-DE').replace(/\./g, '\\.')}`).test(klein), klein);

const gross = formatiere(rechne(new Map([['rp-fabrik', { win: 10, lose: 0 }]])));
check('kein Hinweis ueber der Grenze', !/Unter \$/.test(gross), gross);

equal('leere Auszaehlung gibt nichts aus', formatiere(rechne(new Map())), '');
equal('Betragsformat', euro(1470000), '$1.470.000');

finish();
