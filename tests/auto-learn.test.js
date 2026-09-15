const { check, finish, section, useTempData } = require('./lib');

const temp = useTempData();
const { istAussage } = require('../src/auto-learn');

section('Aussagen werden gemerkt');
// In seinem Zuhause gilt: was die Leitung sagt, ist ein Fakt.
const aussagen = [
  'Die Waffenfabrik läuft viermal am Tag',
  'Bank machen wir montags, mittwochs und samstags um 21:30',
  'Nox Erotica ist unser Turfleader',
  'POVs müssen vorher abgesprochen werden',
  'Wir nehmen niemanden unter Visum 15 auf',
  'Fedex Wave kümmert sich um die Auszahlungen',
  'Die 40er nachts zwischen 5 und 10 Uhr spielt nie jemand',
];
for (const text of aussagen) {
  check(`"${text.slice(0, 46)}"`, istAussage(text), 'wurde nicht als Aussage erkannt');
}

section('Anrede vor der Frage');
// "ghost wer ist Fedex Wave" wurde als TATSACHE gespeichert - die
// Fragenerkennung suchte das Fragewort am Satzanfang, dort stand aber die
// Anrede. Die naechste Frage galt dann als Widerspruch dazu.
for (const text of [
  'ghost wer ist Fedex Wave',
  'Ghost wie viele events hast du',
  'ghost, was ist die hauptstadt von frankreich',
  'ghostxx wann ist der naechste 40er',
  'hey ghost wie gehts dir',
  'sag mal ghost was kannst du',
  'ghost darf johannes eintragen',
]) {
  check(`"${text.slice(0, 44)}"`, !istAussage(text), 'wurde faelschlich gemerkt');
}

// Ansagen mit Anrede bleiben Ansagen.
for (const text of [
  'ghost merk dir wir spielen montags bank',
  'ghost ab sofort schreibt jeder seinen nachweis rein',
]) {
  check(`"${text.slice(0, 44)}"`, istAussage(text), 'haette gemerkt werden sollen');
}

section('Fragen werden nicht gemerkt');
// Eine Frage ist keine Ansage - sonst stuende die Frage selbst im Gedaechtnis.
const fragen = [
  'wann läuft die waffenfabrik?',
  'wann machen wir bank',
  'wer ist unser turfleader',
  'was weißt du über Pascal',
  'wie läuft das mit den POVs',
  'kannst du das nochmal erklären',
  'ist das so richtig?',
  'welche farbe haben wir',
  'warum geht das nicht',
];
for (const text of fragen) {
  check(`"${text.slice(0, 46)}"`, !istAussage(text), 'wurde faelschlich als Aussage erkannt');
}

section('Fragen mit dem Fragewort mittendrin');
// "bei wie vielen Events war Cell Yeat dabei" begann mit "bei", galt deshalb
// als Ansage und stand danach als angebliche Tatsache im Gedaechtnis - waehrend
// die Frage selbst unbeantwortet blieb. Deutsche Fragen fangen oft nicht mit
// dem Fragewort an.
for (const text of [
  'bei wie vielen Events war Cell Yeat dabei',
  'und wer kümmert sich jetzt um die Auszahlung',
  'seit wann gibt es den Hotel Event',
  'ab wann läuft der Flugzeugträger',
  'weißt du wie viele Leute gestern dabei waren',
  'kannst du mir sagen wer im 40er drin ist',
  'in welchem Kanal stehen die Anmeldungen',
]) {
  check(`"${text.slice(0, 46)}"`, !istAussage(text), 'wurde faelschlich gemerkt');
}

section('Lob ist keine Tatsache');
// Beides stand im echten Gedaechtnis. Schlimmer noch: das zweite Lob galt dann
// als Widerspruch zum ersten, und Ghostxx fragte nach, was denn nun gelte.
for (const text of [
  'sehr gut beobachtet !',
  'auch sehr gut beobachtet',
  'das war wirklich sehr gut gemacht',
  'ja genau so ist richtig',
  'danke dir das war top',
]) {
  check(`"${text.slice(0, 46)}"`, !istAussage(text), 'wurde faelschlich gemerkt');
}

// Ein Satz, der nur mit Lob ANFAENGT, bleibt eine Ansage.
check('Lob plus Inhalt', istAussage('Gut zu wissen: die Weinberge geben 100k'));
check('Lob plus Regel', istAussage('Sehr gut, ab jetzt zahlen wir die Bank mit 275k aus'));

section('Geplauder wird nicht gemerkt');
// Sonst stuende nach einer Woche "hallo" und "test" im Gedaechtnis.
for (const text of [
  'hallo', 'hi', 'moin', 'ok', 'passt', 'danke', 'alles klar', 'lol',
  'ja', 'nein', 'top', 'nice', 'stimmt', 'geht klar',
]) {
  check(`"${text}"`, !istAussage(text), 'wurde faelschlich gemerkt');
}

section('Zu kurz oder ohne Inhalt');
check('leer', !istAussage(''));
check('zwei Zeichen', !istAussage('ok'));
check('nur Zahlen', !istAussage('123456789012345'));
check('nur Emojis', !istAussage('🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥'));
check('nur ein Link', !istAussage('https://discord.com/channels/1/2/3'));
check('knapp unter der Grenze', !istAussage('zu kurz ja'));

section('Grenzfaelle');
// Lange Saetze mit Fragezeichen bleiben Fragen.
check('lange Frage', !istAussage('sag mal, wie machen wir das eigentlich mit den Auszahlungen?'));
// Aussagen mit Fragewort mittendrin sind trotzdem Aussagen.
check('"wie" mittendrin', istAussage('Ich zeige dir gleich wie das mit den Auszahlungen läuft'));
// Aufforderungen sind Aussagen genug.
check('Ansage', istAussage('Ab sofort schreibt jeder seinen Nachweis ins Logbuch'));


section('Themenkollision melden');
// Bewusst deterministisch: das Modell hat hier im Test "NEIN WIDERSPRUCH KEITER"
// geantwortet - weder Format noch Inhalt stimmten.
(async () => {
  const knowledge = require('../src/knowledge');
  const { findeWiderspruch } = require('../src/auto-learn');

  for (const fakt of [
    'Die Waffenfabrik laeuft viermal am Tag',
    'Bank machen wir montags und donnerstags um 21:30',
    'Nox Erotica ist unser Turfleader',
    'POVs muessen vorher abgesprochen werden',
  ]) await knowledge.remember(fakt, 'owner');

  for (const [neu, sollMelden] of [
    ['Die Waffenfabrik laeuft ab jetzt nur noch zweimal am Tag', true],
    ['Bank machen wir jetzt dienstags und freitags', true],
    ['Nox ist nicht mehr Turfleader, jetzt ist es Fedex', true],
    ['POVs darf jeder ohne Absprache posten', true],
    ['Unsere Familienfarbe ist gruen', false],
    ['Weinberge spielen wir freitags abends', false],
    ['Das Logbuch fuehrt jeder selbst', false],
  ]) {
    const r = await findeWiderspruch(neu);
    const label = `${sollMelden ? 'meldet' : 'still '} bei "${neu.slice(0, 40)}"`;
    check(label, r.widerspruch === sollMelden, JSON.stringify(r.alt?.text));
  }

  // Wortgleiches ist kein Konflikt - das faengt remember als "schon bekannt" ab.
  const gleich = await findeWiderspruch('Nox Erotica ist unser Turfleader');
  check('wortgleich meldet nicht', !gleich.widerspruch, JSON.stringify(gleich.alt?.text));

  temp.cleanup();
  finish();
})();
