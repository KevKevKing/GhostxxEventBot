const { check, equal, finish, section } = require('./lib');
const { config } = require('../src/config');
const { wurdeGewertet } = require('../src/logbook-command');
const { getEvent } = require('../src/logbook-events');
const { isMarkedDone, readEntries } = require('../src/logbook');

// Ein Haken heisst "gezaehlt und bezahlt". Er darf nur dort hin, wo der Bot
// die Angabe auch pruefen konnte.
//
// Frueher bekam auch ein Beitrag den Haken, dessen Bild gar nicht lesbar war -
// der galt damit als erledigt, obwohl nie jemand hingesehen hatte. Beim
// Durchscrollen war so ein Fall nicht von einem sauber bezahlten zu
// unterscheiden.

function eintrag(teil = {}) {
  return {
    messageId: 'm1',
    images: [{}],
    claim: { ok: true, event: getEvent('40er'), result: 'win' },
    verified: true,
    doppelVon: null,
    zeitDoppelVon: null,
    ...teil,
  };
}

section('Was einen Haken bekommt');
check('geprueft und gut', wurdeGewertet(eintrag()));
check('  auch bei lose', wurdeGewertet(eintrag({ claim: { ok: true, event: getEvent('40er'), result: 'lose' } })));

section('Was KEINEN Haken bekommt');
// null heisst "konnte ich nicht pruefen". Genau das war der Fehler.
check('nicht pruefbar', !wurdeGewertet(eintrag({ verified: null })));
check('widerlegt', !wurdeGewertet(eintrag({ verified: false })));
check('ohne Bild', !wurdeGewertet(eintrag({ images: [] })));
check('ohne Event', !wurdeGewertet(eintrag({ claim: { ok: false, event: null, result: 'win' } })));
check('ohne Ergebnis', !wurdeGewertet(eintrag({ claim: { ok: true, event: getEvent('40er'), result: null } })));
check('Doppelbild', !wurdeGewertet(eintrag({ doppelVon: { messageId: 'x' } })));
check('selber Durchgang', !wurdeGewertet(eintrag({ zeitDoppelVon: { messageId: 'x' } })));

section('Das Achtungszeichen ist keine Linie');
// Gezaehlt wird weiterhin ab dem letzten echten Haken. Ein markierter Beitrag
// darf NICHT als abgerechnet gelten - sonst waere alles darueber verloren.
function nachricht(id, reaktionen = []) {
  return {
    id,
    author: { id: 'u1', bot: false },
    content: '40er win',
    attachments: new Map([['a', { contentType: 'image/png', size: 1, width: 1, height: 1, url: `#${id}` }]]),
    reactions: { cache: new Map(reaktionen.map((name) => [name, { emoji: { name } }])) },
    url: `#${id}`,
    createdTimestamp: Number(id.slice(1)),
  };
}

const mitAchtung = nachricht('m2', [config.logbookAttentionEmojiName]);
const mitHaken = nachricht('m3', [config.giveawayEmojiName]);

check('Achtungszeichen ist kein Haken', !isMarkedDone(mitAchtung));
check('der echte Haken schon', isMarkedDone(mitHaken));

// Ein Beitrag mit Achtungszeichen bleibt unterhalb der Linie und wird beim
// naechsten Lauf wieder angesehen - genau so soll es sein.
const eintraege = readEntries([nachricht('m1'), mitAchtung, nachricht('m4')], 'bot');
equal('alle drei bleiben offen', eintraege.length, 3);

// Steht ein echter Haken dazwischen, zieht der die Linie.
const mitLinie = readEntries([nachricht('m1'), mitHaken, nachricht('m4')], 'bot');
equal('nur was darunter liegt', mitLinie.length, 1);
equal('  und zwar das richtige', mitLinie[0].messageId, 'm4');

section('Der Name des Zeichens');
equal('AttentionAnimated', config.logbookAttentionEmojiName, 'AttentionAnimated');

section('Zwei Events, die sich ein Wort teilen');
// Kevins Auskunft: "Kampf ums Geschaeft fuer inoffizielle Organisationen" ist
// die GEWINNMELDUNG des Ressourcenkriegs, also der 40er. BizWar heisst im
// Spiel "Uebernahme des Geschaefts" - ein anderes Event.
//
// Solange das blanke Wort "Geschaeft" im Katalog stand, zaehlte jeder
// Screenshot mit dieser Meldung als BizWar. Drei Nachweise waren betroffen,
// einer davon mit "40er Win" beschriftet - was ja auch stimmte.
const { findEventsInImageText } = require('../src/logbook-events');

const erkannt = (text) => findEventsInImageText(text);

equal('Gewinnmeldung ist der 40er', erkannt('Kampf ums Geschäft für inoffizielle Organisationen')[0]?.key, '40er');
equal('das echte BizWar bleibt BizWar', erkannt('Übernahme des Geschäfts')[0]?.key, 'bizwar');
// Die Zeile darunter nennt die Ressource, aber kein Event - die allein ist
// kein Nachweis.
equal('Ressourcenmeldung allein reicht nicht', erkannt('Familie Unknown hat die Ressource Power Plant übernommen').length, 0);
// Das blanke Wort "Geschaeft" ist raus - es traf jede Einblendung.
equal('blankes Wort reicht nicht', erkannt('irgendwas mit Geschäft').length, 0);

finish();
