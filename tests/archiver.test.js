const fs = require('node:fs');
const path = require('node:path');
const { check, equal, finish, section, useTempData } = require('./lib');

const temp = useTempData();
const { createEventId, listEvents, pruneEvents, saveEvent } = require('../src/storage');

// pruneEvents() verschiebt und loescht Eintraege aus events.json - der
// Live-Datei mit allen Anmeldungen von 251 echten Leuten. Vier
// Fallunterscheidungen (siehe pruneEvents-Kommentar in storage.js), die bei
// einem Fehler leise falsche Daten produzieren wuerden statt zu crashen.
// Bisher gab es dafuer keine einzige Testdatei (Ghosts eigener
// Code-Vorschlag zu src/archiver.js, 29./30.09.).

function tageZurueck(tage) {
  return new Date(Date.now() - tage * 24 * 60 * 60 * 1000).toISOString();
}

function baueEvent(teile) {
  return {
    id: createEventId(),
    title: 'Test-Event',
    status: 'open',
    attendees: [],
    substitutes: [],
    createdAt: new Date().toISOString(),
    ...teile,
  };
}

(async () => {
  section('Offene Anmeldung mit closeAt bleibt immer drin, egal wie alt');
  const mitCloseAt = baueEvent({ status: 'open', closeAt: tageZurueck(400), createdAt: tageZurueck(400) });
  await saveEvent(mitCloseAt);
  const ergebnis1 = await pruneEvents(3);
  check('nicht archiviert', ergebnis1.archived === 0, JSON.stringify(ergebnis1));
  check('noch in der Liste', (await listEvents()).some((e) => e.id === mitCloseAt.id));

  section('Offene Anmeldung ohne closeAt bleibt vor der 14-Tage-Grenze');
  const offenJung = baueEvent({ status: 'open', closeAt: '', createdAt: tageZurueck(13) });
  await saveEvent(offenJung);
  const ergebnis2 = await pruneEvents(3);
  check('nicht archiviert', ergebnis2.archived === 0, JSON.stringify(ergebnis2));
  check('noch in der Liste', (await listEvents()).some((e) => e.id === offenJung.id));

  section('Offene Anmeldung ohne closeAt verfaellt nach der 14-Tage-Grenze');
  const offenAlt = baueEvent({ status: 'open', closeAt: '', createdAt: tageZurueck(15) });
  await saveEvent(offenAlt);
  const ergebnis3 = await pruneEvents(3);
  check('archiviert', ergebnis3.archived === 1, JSON.stringify(ergebnis3));
  check('nicht mehr in der Liste', !(await listEvents()).some((e) => e.id === offenAlt.id));

  section('Geschlossene Anmeldung bleibt innerhalb von maxAgeDays');
  const geschlossenJung = baueEvent({ status: 'closed', closeAt: tageZurueck(2), createdAt: tageZurueck(2) });
  await saveEvent(geschlossenJung);
  const ergebnis4 = await pruneEvents(3);
  check('nicht archiviert', ergebnis4.archived === 0, JSON.stringify(ergebnis4));
  check('noch in der Liste', (await listEvents()).some((e) => e.id === geschlossenJung.id));

  section('Geschlossene Anmeldung verfaellt nach maxAgeDays');
  const geschlossenAlt = baueEvent({ status: 'closed', closeAt: tageZurueck(5), createdAt: tageZurueck(5) });
  await saveEvent(geschlossenAlt);
  const ergebnis5 = await pruneEvents(3);
  check('archiviert', ergebnis5.archived === 1, JSON.stringify(ergebnis5));
  check('nicht mehr in der Liste', !(await listEvents()).some((e) => e.id === geschlossenAlt.id));

  const archiveDir = path.join(temp.dir, 'archive');
  const monat = new Date(geschlossenAlt.closeAt).toISOString().slice(0, 7);
  const archivDatei = path.join(archiveDir, `events-${monat}.json`);
  check('Monats-Archivdatei angelegt', fs.existsSync(archivDatei));
  const archivInhalt = JSON.parse(fs.readFileSync(archivDatei, 'utf8'));
  check('archiviertes Event steht drin', archivInhalt.events.some((e) => e.id === geschlossenAlt.id));

  section('Zusammenfuehren mit bestehender Monats-Archivdatei dedupliziert ueber event.id');
  // Dieselbe geschlossenAlt-ID liegt nach dem vorigen Lauf schon in der
  // Archivdatei. Ein zweites Event desselben Monats, das archiviert wird,
  // darf das bestehende nicht verdoppeln.
  const zweitesImSelbenMonat = baueEvent({ status: 'closed', closeAt: geschlossenAlt.closeAt, createdAt: geschlossenAlt.closeAt });
  await saveEvent(zweitesImSelbenMonat);
  await pruneEvents(3);
  const archivNachher = JSON.parse(fs.readFileSync(archivDatei, 'utf8'));
  const idsImArchiv = archivNachher.events.map((e) => e.id);
  equal('kein Duplikat des alten Eintrags', idsImArchiv.filter((id) => id === geschlossenAlt.id).length, 1);
  check('neues Event zusaetzlich drin', idsImArchiv.includes(zweitesImSelbenMonat.id));

  section('Nichts zu archivieren -> archived:0, verbleibend genannt');
  const nurNochOffene = await listEvents();
  const ergebnis6 = await pruneEvents(3);
  equal('nichts archiviert', ergebnis6.archived, 0);
  equal('verbleibend stimmt', ergebnis6.remaining, nurNochOffene.length);

  temp.cleanup();
  finish();
})();
