const { check, equal, finish, section } = require('./lib');
const { parseClaim, findEventInText, listEventLabels } = require('../src/logbook-events');
const {
  collectProblems, formatTable, istGewertet, readEntries, tally,
} = require('../src/logbook');

let bildZaehler = 0;

// Jedes Bild bekommt eine eigene Groesse - so wie zwei echte Screenshots auch
// nie byte-genau gleich gross sind. Fuer Doppelposts wird die Groesse bewusst
// wiederverwendet.
function nachricht(id, text, bilder = 1, groesse = null) {
  const attachments = new Map();
  for (let i = 0; i < bilder; i += 1) {
    bildZaehler += 1;
    attachments.set(`a${i}`, {
      contentType: 'image/png',
      size: groesse ?? 100000 + bildZaehler,
      width: 1920,
      height: 1080,
    });
  }
  return { id, author: { id: 'u1' }, content: text, url: `#${id}`, attachments };
}

section('Eventkatalog');
// Die Zahl steht hier, damit ein versehentlich geloeschtes Event auffaellt -
// nicht als Verbot, neue aufzunehmen. Kommt eins dazu, gehoert die Zahl mit
// angepasst und der Grund in die Zeile darunter.
//
// Zuletzt dazugekommen: FamWar. Der stand in der Auszahlungstabelle, aber
// nicht im Katalog - er liess sich also gar nicht eintragen.
check('alle 17 Events da', listEventLabels().length === 17, listEventLabels().join(', '));
check('  FamWar dabei', listEventLabels().includes('FamWar'), listEventLabels().join(', '));

// Diese fuenf standen im Terminplan, konnten aber nicht ausgezahlt werden.
for (const [text, label] of [
  ['50er win', '50er'],
  ['hotel lose', 'Hotel'],
  ['ft win', 'Flugzeugträger'],
  ['gefängnis lose', 'Gefängnis'],
  ['waffenteile win', 'Waffenteile'],
]) {
  const r = parseClaim(text);
  check(`"${text}" zaehlt jetzt`, r.ok && r.event.label === label, JSON.stringify(r));
}

const paare = [
  ['40er win', '40er', 'win'],
  ['40er lose', '40er', 'lose'],
  ['bizwar lose', 'Bizwar', 'lose'],
  ['WF Win', 'Waffenfabrik', 'win'],
  ['rp fabrik win', 'RP-Fabrik', 'win'],
  ['weinberge lose', 'Weinberge', 'lose'],
  ['Gießerei lose', 'Gießerei', 'lose'],
  ['gieserei win', 'Gießerei', 'win'],
  ['hafendrop win', 'Hafen', 'win'],
  ['ekz lose', 'EKZ', 'lose'],
  ['sk lose', 'SK', 'lose'],
  ['raid win', 'FamRaid', 'win'],
  ['fam raid lose', 'FamRaid', 'lose'],
  ['bank win', 'Bank', 'win'],
  ['bank lose', 'Bank', 'lose'],
];
for (const [text, event, ergebnis] of paare) {
  const r = parseClaim(text);
  check(`"${text}" -> ${event} / ${ergebnis}`, r.ok && r.event.label === event && r.result === ergebnis, JSON.stringify(r));
}

section('Nur bekannte Events zaehlen');
// "Ueberfall auf die Militaerbasis" ist ein Anzeigefehler im Spiel, kein Event.
check('Militaerbasis wird ignoriert', findEventInText('Überfall auf die Militärbasis win') === null);
// Banküberfall IST ein Event - nur die Militaerbasis-Anzeige ist ein Bug.
equal('"bank win"', findEventInText('bank win')?.key, 'bank');
equal('"Banküberfall lose"', findEventInText('Banküberfall lose')?.key, 'bank');
check('Smalltalk wird ignoriert', findEventInText('moin leute alles gut') === null);

section('Unklare Angaben zaehlen nicht');
check('ohne Ergebnis', parseClaim('40er').ok === false);
check('ohne Event', parseClaim('win').ok === false);
// Beides genannt heisst nicht eindeutig.
check('win und lose zusammen', parseClaim('40er win lose').ok === false);

section('Laengeres Kuerzel gewinnt');
// "rp fabrik" darf nicht als blosses "rp" durchgehen.
equal('"rp fabrik"', findEventInText('rp fabrik win')?.key, 'rp-fabrik');
equal('"hafendrop"', findEventInText('hafendrop win')?.key, 'hafen');

section('Zaehlung');
const eintraege = readEntries([
  nachricht('1', '40er win'),
  nachricht('2', '40er win'),
  nachricht('3', '40er lose'),
  nachricht('4', 'bizwar lose'),
  nachricht('5', 'sk lose'),
  nachricht('6', 'moin leute', 0),
  nachricht('7', '40er', 1),
  nachricht('8', 'hafen win', 0),
], 'bot');

const zaehler = tally(eintraege);
equal('40er: 1 Niederlage, 2 Siege', zaehler.get('40er'), { win: 2, lose: 1 });
equal('Bizwar: 1 Niederlage', zaehler.get('bizwar'), { win: 0, lose: 1 });
// Ohne Screenshot gibt es keinen Nachweis.
check('"hafen win" ohne Bild zaehlt nicht', !zaehler.has('hafen'));

section('Tabellenformat');
const tabelle = formatTable(zaehler);
check('Kopfzeile Event | Lose | Win', /Event\s+\| Lose \| Win/.test(tabelle), tabelle.split('\n')[1]);
check('40er-Zeile mit 1 und 2', /40er\s+\|\s+1 \|\s+2/.test(tabelle), tabelle);
// 3 Niederlagen (40er, Bizwar, SK) und 2 Siege (40er)
check('Gesamtzeile', /Gesamt\s+\|\s+3 \|\s+2/.test(tabelle), tabelle);

section('Was jemand anschauen sollte');
const probleme = collectProblems(eintraege);
const gruende = probleme.map((p) => p.grund);
// Geplauder ohne Bild ist kein Nachweisfehler und wird nicht gemeldet.
const geplauder = readEntries([nachricht('p1', 'hahahha', 0), nachricht('p2', 'sry bro xD', 0)], 'bot');
check('Geplauder wird nicht gemeldet', collectProblems(geplauder).length === 0);
// Ein Bild ohne erkennbaren Text schon.
const bildOhneText = readEntries([nachricht('p3', 'moin', 1)], 'bot');
check('Bild ohne Angabe wird gemeldet', collectProblems(bildOhneText).some((x) => /Kein bekanntes Event/.test(x.grund)));
check('fehlendes Ergebnis gemeldet', gruende.some((g) => /Kein win\/lose/.test(g)));
check('fehlendes Bild gemeldet', gruende.some((g) => /Kein Bild/.test(g)));

section('Mehrere Bilder in einem Beitrag');
// Frueher war jedes zusaetzliche Bild eine Meldung wert, weil nur das erste
// angesehen wurde. Inzwischen werden bis zu drei gelesen - zwei Screenshots
// sind der Normalfall und kein Fehler mehr.
const zweiBilder = readEntries([nachricht('9', '40er win', 2)], 'bot');
equal('zwei sind in Ordnung', collectProblems(zweiBilder).length, 0);

const dreiBilder = readEntries([nachricht('9b', '40er win', 3)], 'bot');
equal('drei auch noch', collectProblems(dreiBilder).length, 0);

// Darueber schaut sich wirklich niemand mehr alles an - das gehoert gesagt.
const vieleBilder = readEntries([nachricht('9c', '40er win', 5)], 'bot');
check('ab vier wird es gemeldet',
  collectProblems(vieleBilder).some((p) => /5 Bilder/.test(p.grund)),
  JSON.stringify(collectProblems(vieleBilder)));

section('Angesehen, aber kein Urteil moeglich');
// Kevins Vorgabe: lieber "konnte nicht gefunden werden" schreiben als so tun,
// als waere alles in Ordnung. Vorher stand so ein Beitrag nirgends - er bekam
// nur kein Haekchen.
const unklar = readEntries([nachricht('9d', '40er win')], 'bot');
unklar[0].verified = null;
unklar[0].verifyReason = '40er gefunden, aber auch Bizwar — muss angeschaut werden';
check('kommt in die Liste',
  collectProblems(unklar).some((p) => /muss angeschaut werden/.test(p.grund)));

// Nicht angesehen ist etwas anderes als angesehen ohne Ergebnis.
const nieGeprueft = readEntries([nachricht('9e', '40er win')], 'bot');
equal('ungeprueft wird nicht gemeldet', collectProblems(nieGeprueft).length, 0);

section('Widerspruch aus der Bildpruefung');
const widerspruch = readEntries([nachricht('10', 'bizwar win')], 'bot');
widerspruch[0].verified = false;
widerspruch[0].verifyReason = 'Im Bild steht 40er, angegeben war Bizwar';
check('zaehlt nicht mit', !tally(widerspruch).has('bizwar'));
check('wird gemeldet', collectProblems(widerspruch).some((p) => /Im Bild steht 40er/.test(p.grund)));


section('Was nicht abgehakt wird, wird auch nicht gezaehlt');
// Kevins Fund an seinem eigenen Ticket: in der Tabelle stand
// "RP-Fabrik | 1 | 0", und drei Zeilen darunter "RP-Fabrik WIn - noch nicht
// gelesen - wird nachgeholt". Beides ueber DENSELBEN Nachweis.
//
// Ursache waren zwei Regeln, die sich widersprachen: gezaehlt wurde alles
// ausser dem Widerlegten (verified !== false), abgehakt nur das Bestaetigte
// (verified === true). Der Nachweis landete also in der Auszahlung, bekam
// aber kein Haekchen - und haette beim naechsten Lauf ein ZWEITES Mal
// gezaehlt. Das ist eine Doppelzahlung.
const ungelesen = readEntries([nachricht('u1', 'RP-Fabrik win')], 'bot');
ungelesen[0].verified = null;
ungelesen[0].verifyReason = 'noch nicht gelesen — wird nachgeholt';

check('nicht gewertet', !istGewertet(ungelesen[0]));
check('  also auch nicht in der Tabelle', !tally(ungelesen).has('rp-fabrik'));
check('  aber gemeldet', collectProblems(ungelesen).some((p) => /noch nicht gelesen/.test(p.grund)));

// Gelesen und bestaetigt: zaehlt ganz normal.
const gelesen = readEntries([nachricht('u2', 'RP-Fabrik win')], 'bot');
gelesen[0].verified = true;
check('bestaetigt zaehlt', istGewertet(gelesen[0]));
equal('  und steht in der Tabelle', tally(gelesen).get('rp-fabrik'), { win: 1, lose: 0 });

// Widerlegt: zaehlt nicht, wie schon vorher.
const widerlegt2 = readEntries([nachricht('u3', 'RP-Fabrik win')], 'bot');
widerlegt2[0].verified = false;
check('widerlegt zaehlt nicht', !istGewertet(widerlegt2[0]));


section('Der Geldsack ist ein Haken von Hand');
// Kevin und Johannes tragen die Auszahlungen selbst ein und markieren mit
// :0acrylic_moneybag:, was sie angerechnet haben. Das muss der Bot als
// "erledigt" verstehen, sonst zaehlt er es beim naechsten Lauf nochmal.
function mitGeldsack(id, text) {
  const m = nachricht(id, text);
  m.reactions = { cache: new Map([['x', { emoji: { name: '0acrylic_moneybag' } }]]) };
  return m;
}

const bezahlt = readEntries([
  mitGeldsack('b1', '40er win'),
  nachricht('b2', 'sk lose'),
], 'bot');
equal('der Geldsack-Beitrag faellt raus', bezahlt.length, 1);
equal('  und es ist der richtige', bezahlt[0].messageId, 'b2');


section('Uebergang: ohne Marker gilt weiter das letzte Haekchen');
// Alle Tickets von vor der Umstellung haben noch keinen GTALoading-Marker.
// Ohne diesen Rueckfall wuerde der Bot jedes davon komplett von vorne
// aufrollen - hunderte Nachrichten, die laengst bezahlt sind.
function mitHaken(id, text) {
  const m = nachricht(id, text);
  m.reactions = { cache: new Map([['x', { emoji: { name: 'delaTeabesttigt' } }]]) };
  return m;
}
function mitAnderemSmiley(id, text) {
  const m = nachricht(id, text);
  m.reactions = { cache: new Map([['x', { emoji: { name: 'daumenhoch' } }]]) };
  return m;
}
function mitMarker(id, text) {
  const m = nachricht(id, text);
  m.reactions = { cache: new Map([['x', { emoji: { name: 'GTALoading' } }]]) };
  return m;
}
function mitAchtung(id, text) {
  const m = nachricht(id, text);
  m.reactions = { cache: new Map([['x', { emoji: { name: 'AttentionAnimated' } }]]) };
  return m;
}

const gemischt = readEntries([
  mitHaken('a', '40er win'),
  nachricht('b', 'bizwar lose'),           // ohne Haken, aber oberhalb
  mitAnderemSmiley('c', 'weinberge win'),  // anderer Smiley, oberhalb
  mitHaken('d', 'hafen win'),              // letztes Haekchen - hier ist die Linie
  nachricht('e', '40er win'),
  nachricht('f', 'sk lose'),
], 'bot');

equal('nur was unter der Linie steht', gemischt.length, 2);
equal('alles darueber gilt als erledigt', gemischt.bereitsAusgezahlt, 4);
const z2 = tally(gemischt);
equal('40er einmal', z2.get('40er'), { win: 1, lose: 0 });
check('bizwar zaehlt nicht (oberhalb)', !z2.has('bizwar'));
check('weinberge zaehlt nicht (anderer Smiley, oberhalb)', !z2.has('weinberge'));
check('hafen zaehlt nicht (das Haekchen selbst)', !z2.has('hafen'));
equal('sk einmal', z2.get('sk'), { win: 0, lose: 1 });

// Ohne jedes Haekchen wird alles gezaehlt.
const ohneHaken = readEntries([nachricht('x', '40er win'), nachricht('y', 'sk lose')], 'bot');
equal('ohne Haekchen: alles offen', ohneHaken.length, 2);
equal('nichts als erledigt', ohneHaken.bereitsAusgezahlt, 0);


section('Die Linie ist der Marker, nicht mehr das Haekchen');
// Der Haken hatte zwei Bedeutungen gleichzeitig - "bezahlt" UND "ab hier
// nicht mehr hinsehen". Jetzt zieht nur noch GTALoading die Linie, und ein
// Haken darunter aendert daran nichts.
const mitMarkerLinie = readEntries([
  nachricht('m1', '40er win'),        // oberhalb des Markers - erledigt
  mitMarker('m2', 'sk win'),          // HIER ist die Linie
  nachricht('m3', 'bizwar lose'),     // darunter - zaehlt
  mitHaken('m4', 'hafen win'),        // Haken darunter zieht KEINE neue Linie
  nachricht('m5', 'weinberge lose'),  // muss trotzdem noch zaehlen
], 'bot');

// Zwei, nicht drei: der abgehakte m4 zaehlt selbst nicht mehr mit (ist ja
// bezahlt) - er zieht nur eben auch keine Linie mehr.
equal('zwei offene Beitraege', mitMarkerLinie.length, 2);
const zM = tally(mitMarkerLinie);
check('oberhalb des Markers zaehlt nicht', !zM.has('40er'));
check('der Marker selbst auch nicht', !zM.has('sk'));
equal('darunter zaehlt', zM.get('bizwar'), { win: 0, lose: 1 });
check('der Haken selbst zaehlt nicht (schon bezahlt)', !zM.has('hafen'));
// Der wichtigste Punkt: frueher haette der Haken auf m4 die Linie nach unten
// gezogen und m5 waere fuer immer verschwunden.
equal('UNTER dem Haken zaehlt weiter', zM.get('weinberge'), { win: 0, lose: 1 });

// Steht ein Marker da, gilt NUR er - auch wenn weiter unten Haken sind.
const markerVorHaken = readEntries([
  mitMarker('v1', '40er win'),
  mitHaken('v2', 'sk win'),
  nachricht('v3', 'bizwar lose'),
], 'bot');
equal('Marker gewinnt gegen spaeteres Haekchen', markerVorHaken.length, 1);
equal('  und es ist der richtige', markerVorHaken[0].messageId, 'v3');


section('Ein offenes Problem sticht die Linie');
// Kevins Fund: 39 Nachweise in 16 Tickets waren unter die Linie gerutscht,
// weil spaeter ein Haken darunter kam. Alle mit echtem Text und Bild - die
// waeren nie wieder angesehen worden, und an jedem haengt Geld.
const problemOben = readEntries([
  mitAchtung('p1', '40er win'),   // Problem, OBERHALB der Linie
  nachricht('p2', 'sk win'),
  mitMarker('p3', 'hafen win'),   // die Linie
  nachricht('p4', 'bizwar lose'),
], 'bot');

check('das Problem wird trotzdem eingesammelt',
  problemOben.some((e) => e.messageId === 'p1'), problemOben.map((e) => e.messageId).join());
check('  der Rest oberhalb bleibt erledigt',
  !problemOben.some((e) => e.messageId === 'p2'));
check('  und was darunter steht sowieso',
  problemOben.some((e) => e.messageId === 'p4'));

// Erledigt ist es erst, wenn ein Haken oder eine Ablehnung dazukommt.
function mitAchtungUndHaken(id, text) {
  const m = nachricht(id, text);
  m.reactions = { cache: new Map([
    ['a', { emoji: { name: 'AttentionAnimated' } }],
    ['b', { emoji: { name: 'delaTeabesttigt' } }],
  ]) };
  return m;
}
function mitAchtungUndAblehnung(id, text) {
  const m = nachricht(id, text);
  m.reactions = { cache: new Map([
    ['a', { emoji: { name: 'AttentionAnimated' } }],
    ['b', { emoji: { name: 'delaTeaabgelehnt' } }],
  ]) };
  return m;
}

const geklaert = readEntries([
  mitAchtungUndHaken('g1', '40er win'),      // geklaert: bezahlt
  mitAchtungUndAblehnung('g2', 'sk win'),    // geklaert: abgelehnt
  mitMarker('g3', 'hafen win'),
], 'bot');
equal('geklaerte Probleme kommen nicht zurueck', geklaert.length, 0);


section('Abgelehnte Nachweise zaehlen nie');
// Aus dem echten Thread "Felix Crackhead I 322629": direkt unter dem Haken lag
// ein von Hand abgelehnter Nachweis. Die Linie hat ihn wieder eingesammelt und
// er waere doch bezahlt worden - das Ablehn-Emoji wurde gar nicht gelesen.
function mitAblehnung(id, text) {
  const m = nachricht(id, text);
  m.reactions = { cache: new Map([['x', { emoji: { name: 'delaTeaabgelehnt' } }]]) };
  return m;
}

const felix = readEntries([
  mitHaken('f0', '40er win'),        // die Linie
  mitAblehnung('f1', 'bizwar win'),  // darunter, aber abgelehnt
  nachricht('f2', '40er lose'),
  nachricht('f3', 'waffenfabrik win'),
], 'bot');

equal('abgelehnter faellt raus', felix.length, 2);
equal('wird gezaehlt und gemeldet', felix.abgelehnt, 1);
const z3 = tally(felix);
check('abgelehntes bizwar zaehlt nicht', !z3.has('bizwar'));
equal('40er lose zaehlt', z3.get('40er'), { win: 0, lose: 1 });
equal('waffenfabrik zaehlt', z3.get('waffenfabrik'), { win: 1, lose: 0 });

// Auch ohne jede Linie gilt eine Ablehnung.
const nurAblehnung = readEntries([
  mitAblehnung('g0', '40er win'),
  nachricht('g1', 'sk lose'),
], 'bot');
equal('ohne Haken: abgelehnter trotzdem raus', nurAblehnung.length, 1);
equal('  und gezaehlt', nurAblehnung.abgelehnt, 1);

// Ein einzeln abgehakter Beitrag unterhalb der Linie zaehlt ebenfalls nicht -
// er ist ja schon entschieden.
const einzelnAbgehakt = readEntries([
  nachricht('h0', '40er win'),
  mitHaken('h1', 'bizwar win'),
  nachricht('h2', 'sk lose'),
], 'bot');
equal('nur die zwei unmarkierten', einzelnAbgehakt.length, 1);
check('der abgehakte bizwar zaehlt nicht', !tally(einzelnAbgehakt).has('bizwar'));

// Beides zusammen (wie bei Felix [0]) - Haken UND Ablehnung: bleibt draussen.
const beides = nachricht('i0', '40er win');
beides.reactions = { cache: new Map([
  ['a', { emoji: { name: 'delaTeabesttigt' } }],
  ['b', { emoji: { name: 'delaTeaabgelehnt' } }],
]) };
const gemischtMarkiert = readEntries([beides, nachricht('i1', 'sk win')], 'bot');
equal('nur der unmarkierte bleibt', gemischtMarkiert.length, 1);

section('Fremder Haken wird gemeldet, nicht geraten');
// Im Logbuch stehen 17 Beitraege mit einem normalen :white_check_mark: statt
// dem Haken der Familie. Ob das "erledigt" heissen sollte, weiss nur ein
// Mensch - also fragen. Einer davon waere sonst doppelt ausgezahlt worden.
function mitFremdemHaken(id, text) {
  const m = nachricht(id, text);
  m.reactions = { cache: new Map([['x', { emoji: { name: '✅' } }]]) };
  return m;
}

const fremd = readEntries([mitFremdemHaken('k0', '40er win')], 'bot');
equal('zaehlt weiter mit', fremd.length, 1);
check('  aber wird gemeldet', collectProblems(fremd).some((p) => /schon abgerechnet/.test(p.grund)), JSON.stringify(collectProblems(fremd)));

// Der echte Haken daneben macht die Meldung ueberfluessig.
const beide = nachricht('k1', '40er win');
beide.reactions = { cache: new Map([
  ['a', { emoji: { name: '✅' } }],
  ['b', { emoji: { name: 'delaTeabesttigt' } }],
]) };
const mitBeiden = readEntries([beide, nachricht('k2', 'sk win')], 'bot');
check('echter Haken schlaegt fremden', !collectProblems(mitBeiden).some((p) => /schon abgerechnet/.test(p.grund)));

section('Derselbe Screenshot zweimal');
// "Niemand spielt fair" - wer dasselbe Bild nochmal hochlaedt, soll nicht
// zweimal bezahlt werden. Erkannt an Dateigroesse und Abmessungen, die Discord
// mitliefert; das Bild muss dafuer nicht geladen werden.
const doppelt = readEntries([
  nachricht('d1', '40er win', 1, 500000),
  nachricht('d2', '40er win', 1, 500000),   // dasselbe Bild nochmal
  nachricht('d3', 'bizwar win', 1, 700000),
], 'bot');

equal('beide Beitraege bleiben in der Liste', doppelt.length, 3);
equal('einer als Doppelposting erkannt', doppelt.doppelt, 1);
check('der ZWEITE ist der Doppelte', doppelt[1].doppelVon !== null, JSON.stringify(doppelt[1].doppelVon));
check('  und zeigt auf den ersten', doppelt[1].doppelVon?.messageId === 'd1');
check('der erste bleibt sauber', doppelt[0].doppelVon === null);

const zd = tally(doppelt);
equal('40er zaehlt nur einmal', zd.get('40er'), { win: 1, lose: 0 });
equal('bizwar unberuehrt', zd.get('bizwar'), { win: 1, lose: 0 });
check('wird gemeldet, mit Link zum Original',
  collectProblems(doppelt).some((p) => /schon eingereicht/.test(p.grund) && /#d1/.test(p.grund)),
  JSON.stringify(collectProblems(doppelt).map((p) => p.grund)));

// Verschiedene Bilder mit gleichen Abmessungen sind KEIN Doppelposting -
// fast alle Screenshots sind 1920x1080. Die Dateigroesse macht den Unterschied.
const gleicheMasse = readEntries([
  nachricht('e1', '40er win'),
  nachricht('e2', '40er win'),
], 'bot');
equal('gleiche Aufloesung allein reicht nicht', gleicheMasse.doppelt, 0);
equal('beide zaehlen', tally(gleicheMasse).get('40er'), { win: 2, lose: 0 });

// Der gemeine Fall: ein laengst abgehaktes Bild nochmal einreichen. Das
// Original liegt oberhalb der Linie und wird sonst gar nicht mehr angeschaut.
const altesOriginal = nachricht('f1', '40er win', 1, 850000);
altesOriginal.reactions = { cache: new Map([['x', { emoji: { name: 'delaTeabesttigt' } }]]) };

const altesBildNeu = readEntries([
  altesOriginal,                               // schon bezahlt, oberhalb der Linie
  nachricht('f2', 'bizwar win', 1, 900000),
  nachricht('f3', '40er win', 1, 850000),      // dasselbe Bild wie f1
], 'bot');
equal('altes Bild wiedererkannt', altesBildNeu.doppelt, 1);
check('40er zaehlt nicht nochmal', !tally(altesBildNeu).has('40er'), JSON.stringify([...tally(altesBildNeu)]));

section('Nur "WIN" im Text');
// Manche schreiben kein Event dazu - dann kommt es aus dem Bild.
const nurWin = parseClaim('WIN');
check('gilt nicht als Fehler', nurWin.needsEventFromImage === true, JSON.stringify(nurWin));
equal('Ergebnis erkannt', nurWin.result, 'win');
const nurLose = parseClaim('lose');
equal('auch bei lose', nurLose.result, 'lose');

const ausBild = readEntries([nachricht('e', 'WIN')], 'bot');
check('ohne Bilderkennung ein Problem', collectProblems(ausBild).length === 1);
// Mit erkanntem Event aus dem Bild zaehlt es normal
ausBild[0].eventFromImage = { key: 'weinberge', label: 'Weinberge' };
equal('zaehlt mit Event aus dem Bild', tally(ausBild).get('weinberge'), { win: 1, lose: 0 });
check('und ist kein Problem mehr', collectProblems(ausBild).length === 0);

finish();
