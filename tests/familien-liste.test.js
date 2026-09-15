const { check, equal, finish, section } = require('./lib');
const {
  RANG_LABEL, baueAbweichungText, baueListenText, istVerdaechtigerSchwund, meldeAbgaenge,
  spielerNummer, teile,
} = require('../src/familien-liste');

section('Spielernummer aus dem Discord-Namen');
equal('mit Strich', spielerNummer('Ghost Muffiin | 266391'), '266391');
equal('mit I', spielerNummer('Dennis Wesh I 142391'), '142391');
equal('ganz ohne Trenner', spielerNummer('Paul Ultra 155716'), '155716');
equal('mit Schraegstrich', spielerNummer('Rayman Furious / 295271'), '295271');
equal('nichts lesbar', spielerNummer('Casablanca420'), '');
equal('leer', spielerNummer(''), '');

section('Text in Discord-taugliche Nachrichten teilen');
const kurz = teile(['a', 'b', 'c']);
equal('passt in eine Nachricht', kurz.length, 1);

const lang = teile(Array.from({ length: 200 }, (_, i) => `Zeile ${i} `.repeat(10)));
check('wird auf mehrere Nachrichten verteilt', lang.length > 1, String(lang.length));
check('jede Nachricht unter dem Limit', lang.every((n) => n.length <= 1900), lang.map((n) => n.length).join(','));

section('Die Rangliste');
const mitglieder = {
  u1: { anzeigename: 'Ghost Muffiin', raenge: [9], nummer: '266391' },
  u2: { anzeigename: 'Zoko Yeat', raenge: [4], nummer: '56708' },
  u3: { anzeigename: 'Hans Mujackson', raenge: [4], nummer: '55578' },
};
const listenText = baueListenText(mitglieder).join('\n');
check('9 Legende taucht auf', listenText.includes('9 Legende (1)'));
check('4 Member mit beiden Leuten', listenText.includes('4 Member (2)'));
check('leere Raenge sind trotzdem da', listenText.includes('3 Probe (0)'));
check('Mentions statt Klartext', listenText.includes('<@u1>') && listenText.includes('<@u2>'));

const mitBeleidigung = {
  u9: { anzeigename: 'ganz normaler Name', raenge: [9], nummer: '1' },
  u10: { anzeigename: 'enthaelt Niggerküsschen im Namen', raenge: [9], nummer: '2' },
};
const beleidigungsText = baueListenText(mitBeleidigung).join('\n');
check('beleidigender Name wird nicht angezeigt', !beleidigungsText.includes('Niggerküsschen'));
check('normaler Name bleibt unangetastet', beleidigungsText.includes('ganz normaler Name'));

section('Abweichungen: nur Discord-interne Sonderfaelle');
const mitAbweichung = {
  u1: { anzeigename: 'Eryk Fox', raenge: [4, 3], nummer: '311871' },
  u2: { anzeigename: 'Casablanca420', raenge: [1], nummer: '' },
  u3: { anzeigename: 'Normal Name', raenge: [4], nummer: '12345' },
};
const abwText = baueAbweichungText(mitAbweichung).join('\n');
check('doppelte Rangrolle erkannt', abwText.includes('Mehrere Rangrollen gleichzeitig (1)') && abwText.includes('<@u1>'));
check('fehlende Nummer erkannt', abwText.includes('ohne lesbare Spielernummer (1)') && abwText.includes('<@u2>'));
check('normaler Fall taucht nicht als Abweichung auf', !abwText.includes('<@u3>'));

section('Verdaechtiger Schwund wird nicht als Massenabgang geglaubt');
// Der eigentliche Vorfall vom 23.08.: 269 -> praktisch nichts mehr.
check('269 auf 5 ist verdaechtig', istVerdaechtigerSchwund(269, 5));
check('269 auf 250 ist normaler Schwankungsbereich', !istVerdaechtigerSchwund(269, 250));
check('269 auf 190 (30% weg) ist noch nicht verdaechtig', !istVerdaechtigerSchwund(269, 190));
check('269 auf 188 (mehr als 30% weg) ist verdaechtig', istVerdaechtigerSchwund(269, 188));
check('Zuwachs ist nie verdaechtig', !istVerdaechtigerSchwund(269, 400));
// Bei einer Kleinfamilie waere ein Drittel schnell mal ein paar echte
// Abgaenge - die Pruefung greift deshalb erst ab 20 Leuten.
check('kleine Familie: Pruefung greift nicht', !istVerdaechtigerSchwund(10, 2));
check('erster Lauf (vorher leer) ist nie verdaechtig', !istVerdaechtigerSchwund(0, 5));

section('Wer eine Rangrolle verliert, bekommt eine eigene Meldung');
(async () => {
  const gesendet = [];
  const fakeKanal = { send: async (opt) => { gesendet.push(opt); return { id: 'neu' }; } };

  const vorher = {
    u1: { anzeigename: 'Baum', raenge: [7], nummer: '' },
    u2: { anzeigename: 'Bleibt Dabei', raenge: [4], nummer: '1' },
  };
  const nachher = {
    u2: { anzeigename: 'Bleibt Dabei', raenge: [4], nummer: '1' },
  };

  await meldeAbgaenge(fakeKanal, vorher, nachher);
  equal('genau eine Abgangsmeldung', gesendet.length, 1);
  check('nennt den Discord-Namen von damals', gesendet[0].content.includes('Baum'));
  check('nennt HAT VERLASSEN deutlich', gesendet[0].content.includes('HAT VERLASSEN'));
  check('pingt genau die richtige Person', gesendet[0].allowed_mentions.users.includes('u1'));

  // Niemand verloren -> keine Meldung. Beim allerersten Start ist "vorher"
  // leer, und das darf nicht wie 250 Abgaenge aussehen.
  const gesendet2 = [];
  const fakeKanal2 = { send: async (opt) => { gesendet2.push(opt); } };
  await meldeAbgaenge(fakeKanal2, {}, nachher);
  equal('leeres "vorher" loest nichts aus', gesendet2.length, 0);

  section('Ein Fehlerpfad darf nie selbst der Fehler sein');
  // Am 16.08. stand hier logBotEvent(...).catch() - aber logBotEvent gibt
  // nichts zurueck. Der TypeError im Timer hat den Bot gekillt und Kevins
  // laufende Sammelauszahlung bei 34 von 66 Tickets mitgerissen.
  const quelle = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', 'src', 'familien-liste.js'), 'utf8',
  );
  // Nur echten Code pruefen - im Kommentar darueber steht der Fehler ja
  // absichtlich, damit ihn niemand aus Versehen wieder einbaut.
  const codeZeilen = quelle.split('\n').filter((z) => !z.trim().startsWith('//')).join('\n');
  check('kein .catch an logBotEvent', !/logBotEvent\([^;]*\)\s*\.catch/.test(codeZeilen));

  section('Rangnamen');
  equal('alle neun da', Object.keys(RANG_LABEL).length, 9);

  finish();
})();
