const fs = require('node:fs');
const path = require('node:path');
const { check, equal, finish, section, useTempData } = require('./lib');

const temp = useTempData();
// Gedaechtnis liegt bewusst NICHT unter DATA_DIR, sondern parallel im
// Projekt-Wurzelverzeichnis - dafuer bekommt der Test ein eigenes,
// zufaelliges Wurzelverzeichnis ueber GEDAECHTNIS_ROOT.
process.env.GEDAECHTNIS_ROOT = temp.dir;

const gedaechtnis = require('../src/selbstverbesserung-gedaechtnis');

section('Neuer Eintrag');
let id;
(async () => {
  const angelegt = await gedaechtnis.neuerEintrag({
    titel: 'Fehler in der Event-Schleife',
    belege: [{ zeit: new Date().toISOString(), grund: 'Testfehler' }],
  });
  id = angelegt.id;
  check('Eintrag hat eine Id', typeof id === 'string' && id.length > 0);

  const sig = gedaechtnis.signatur('Fehler in der Event-Schleife');
  check('Direkt danach als bekannt erkannt', await gedaechtnis.istBekannt(sig));
  check('Anderes Problem nicht bekannt', !(await gedaechtnis.istBekannt(gedaechtnis.signatur('Ganz anderes Problem'))));

  section('Session und Entscheidung vermerken');
  await gedaechtnis.vermerkeSession(id, { branch: 'selbstverbesserung/test', zusammenfassung: 'Testfix', ok: true });
  await gedaechtnis.vermerkeEntscheidung(id, { status: 'abgelehnt', grund: 'Testgrund' });

  const liste = await gedaechtnis.liste();
  const eintrag = liste.find((e) => e.id === id);
  check('Eintrag in der Liste', Boolean(eintrag));
  equal('Branch vermerkt', eintrag.session.branch, 'selbstverbesserung/test');
  equal('Entscheidung vermerkt', eintrag.entscheidung.status, 'abgelehnt');

  section('Abgelehnt bleibt bekannt, aeltere Ablehnung nicht');
  check('Nach Ablehnung weiterhin bekannt', await gedaechtnis.istBekannt(sig));
  check('Nach 14 Tagen nicht mehr blockierend', !(await gedaechtnis.istBekannt(sig, { seitTagen: 0 })));

  temp.cleanup();
  finish();
})();
