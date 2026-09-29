const path = require('node:path');
const { check, equal, finish, section, useTempData } = require('./lib');

const temp = useTempData();

const codeVorschlag = require('../src/code-vorschlag');

section('naechsteDatei: rotiert durch eine Liste');
(async () => {
  const liste = ['a.js', 'b.js', 'c.js'];
  const ersteDatei = await codeVorschlag.naechsteDatei({ listeSrcDateien: async () => liste, zuletztVorgeschlagen: null });
  equal('erste Datei ohne Vorgeschichte', ersteDatei, 'a.js');

  const naechsteNachA = await codeVorschlag.naechsteDatei({ listeSrcDateien: async () => liste, zuletztVorgeschlagen: 'a.js' });
  equal('nach a.js kommt b.js', naechsteNachA, 'b.js');

  const naechsteNachC = await codeVorschlag.naechsteDatei({ listeSrcDateien: async () => liste, zuletztVorgeschlagen: 'c.js' });
  equal('nach dem Ende wieder von vorne', naechsteNachC, 'a.js');

  const naechsteNachUnbekannt = await codeVorschlag.naechsteDatei({ listeSrcDateien: async () => liste, zuletztVorgeschlagen: 'geloescht.js' });
  equal('unbekannte zuletzt-Datei -> von vorne', naechsteNachUnbekannt, 'a.js');

  section('darfFragen: Mindestpause und offener Zustand');
  check('darf fragen, wenn noch nie gefragt wurde', await codeVorschlag.darfFragen());

  await codeVorschlag.sendeAnfrage({
    naechsteDatei: async () => 'beispiel.js',
    sendeDm: async () => {},
  });
  check('darf NICHT fragen, solange eine Anfrage offen ist', !(await codeVorschlag.darfFragen()));

  const ausstehendNachAnfrage = await codeVorschlag.holeAusstehend();
  equal('Art ist anfrage', ausstehendNachAnfrage.art, 'anfrage');
  equal('richtige Datei gemerkt', ausstehendNachAnfrage.datei, 'src/beispiel.js');

  await codeVorschlag.vermerkeAbgelehnteAnfrage();
  check('nach Ablehnung nichts mehr ausstehend', (await codeVorschlag.holeAusstehend()) === null);
  check('darf trotzdem noch nicht sofort wieder fragen (Mindestpause)', !(await codeVorschlag.darfFragen()));

  section('starteUndSendeVorschlag: Erfolg fuehrt zu ausstehendem Vorschlag');
  const gesendeteDms = [];
  await codeVorschlag.starteUndSendeVorschlag('beispiel2.js', {
    starteSession: async () => ({ ok: true, vorschlag: 'Mach X anders.' }),
    sendeDm: async (text) => { gesendeteDms.push(text); },
  });
  const ausstehendNachVorschlag = await codeVorschlag.holeAusstehend();
  equal('Art ist vorschlag', ausstehendNachVorschlag.art, 'vorschlag');
  equal('Vorschlagstext gemerkt', ausstehendNachVorschlag.vorschlag, 'Mach X anders.');
  check('DM mit dem Vorschlag verschickt', gesendeteDms.some((t) => t.includes('Mach X anders.')));

  section('vermerkeEntscheidung: landet im Verlauf, ausstehend wird geleert');
  await codeVorschlag.vermerkeEntscheidung('angenommen');
  check('nichts mehr ausstehend', (await codeVorschlag.holeAusstehend()) === null);

  section('starteUndSendeVorschlag: Fehlschlag meldet sich per DM, kein ausstehender Vorschlag');
  const fehlerDms = [];
  await codeVorschlag.starteUndSendeVorschlag('beispiel3.js', {
    starteSession: async () => ({ ok: false, vorschlag: '', fehler: 'kaputt' }),
    sendeDm: async (text) => { fehlerDms.push(text); },
  });
  check('Fehler-DM verschickt', fehlerDms.some((t) => t.includes('kaputt') || t.toLowerCase().includes('nicht geklappt')));
  check('kein ausstehender Vorschlag nach Fehlschlag', (await codeVorschlag.holeAusstehend()) === null);

  section('werteAntwortAus: nur echtes ja/nein, keine Wort-Praefix-Verwechslung');
  equal('"ja" wird erkannt', codeVorschlag.werteAntwortAus('ja'), 'ja');
  equal('"Ja" wird erkannt', codeVorschlag.werteAntwortAus('Ja'), 'ja');
  equal('"JA " wird erkannt', codeVorschlag.werteAntwortAus('JA '), 'ja');
  equal('"nein" wird erkannt', codeVorschlag.werteAntwortAus('nein'), 'nein');
  equal('"Nein" wird erkannt', codeVorschlag.werteAntwortAus('Nein'), 'nein');
  equal('"Januar" ist KEIN ja', codeVorschlag.werteAntwortAus('Januar'), null);
  equal('"Jahreswechsel" ist KEIN ja', codeVorschlag.werteAntwortAus('Jahreswechsel'), null);
  equal('unrelated Text -> null', codeVorschlag.werteAntwortAus('wann ist das naechste Event?'), null);

  temp.cleanup();
  finish();
})();
