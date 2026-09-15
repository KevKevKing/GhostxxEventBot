const fs = require('node:fs');
const path = require('node:path');
const { check, finish, section, useTempData } = require('./lib');

const temp = useTempData();
const { AUFBEWAHREN_TAGE, aufraeumen, backupRoot, listeSicherungen, sichern } = require('../src/backup');

function schreibe(relativ, inhalt) {
  const ziel = path.join(temp.dir, relativ);
  fs.mkdirSync(path.dirname(ziel), { recursive: true });
  fs.writeFileSync(ziel, JSON.stringify(inhalt, null, 2));
}

// Ortszeit, nicht UTC - genau wie die Sicherung ihre Ordner benennt.
function lokalerTag(datum) {
  const monat = String(datum.getMonth() + 1).padStart(2, '0');
  const tag = String(datum.getDate()).padStart(2, '0');
  return `${datum.getFullYear()}-${monat}-${tag}`;
}

function tagVor(tage) {
  return lokalerTag(new Date(Date.now() - tage * 24 * 60 * 60 * 1000));
}

(async () => {
  section('Sicherung legt alles ab');
  schreibe('events.json', { events: [{ id: 'a' }] });
  schreibe('knowledge.json', { facts: ['Der 40er startet immer um :40'] });
  schreibe('permissions.json', { admins: ['1'], editors: ['2'] });
  schreibe('archive/2026-07.json', { events: [{ id: 'alt' }] });

  const heute = new Date();
  const erste = await sichern({ now: heute });
  check('erfolgreich', erste.ok, erste.error);
  check('vier Dateien', erste.dateien === 4, String(erste.dateien));

  const tag = lokalerTag(heute);
  for (const datei of ['events.json', 'knowledge.json', 'permissions.json', 'archive/2026-07.json']) {
    check(`  ${datei}`, fs.existsSync(path.join(backupRoot, tag, datei)));
  }

  section('Inhalt stimmt ueberein');
  const kopie = JSON.parse(fs.readFileSync(path.join(backupRoot, tag, 'knowledge.json'), 'utf8'));
  check('Wissen 1:1 kopiert', kopie.facts[0] === 'Der 40er startet immer um :40');
  const unterordner = JSON.parse(fs.readFileSync(path.join(backupRoot, tag, 'archive/2026-07.json'), 'utf8'));
  check('Archiv-Unterordner erhalten', unterordner.events[0].id === 'alt');

  section('Zweimal am Tag kopiert nicht doppelt');
  const zweite = await sichern({ now: heute });
  check('uebersprungen', zweite.uebersprungen === true);

  section('Halbe Dateien werden ausgelassen');
  // Ein abgebrochener Schreibvorgang laesst .tmp liegen. Die sehen aus wie
  // Daten, sind aber unvollstaendig - die gehoeren nicht in eine Sicherung.
  schreibe('events.json.tmp', { kaputt: true });
  const dritte = await sichern({ force: true, now: heute });
  check('.tmp nicht mitgenommen', dritte.dateien === 4, String(dritte.dateien));

  section('Alte Sicherungen verfallen');
  for (const tage of [1, 5, 13, 15, 40]) {
    fs.mkdirSync(path.join(backupRoot, tagVor(tage)), { recursive: true });
  }
  // Fremde Ordner muessen liegen bleiben - hier wird geloescht, das darf nur
  // die eigenen Datumsordner treffen.
  fs.mkdirSync(path.join(backupRoot, 'wichtig-von-hand'), { recursive: true });

  await aufraeumen(new Date());
  const uebrig = await listeSicherungen();

  check(`heute bleibt`, uebrig.includes(tag));
  check('1 Tag alt bleibt', uebrig.includes(tagVor(1)));
  check(`${AUFBEWAHREN_TAGE - 1} Tage alt bleibt`, uebrig.includes(tagVor(13)));
  check('15 Tage alt ist weg', !uebrig.includes(tagVor(15)));
  check('40 Tage alt ist weg', !uebrig.includes(tagVor(40)));
  check('fremder Ordner bleibt', fs.existsSync(path.join(backupRoot, 'wichtig-von-hand')));

  section('Sicherung liegt neben data, nicht darin');
  // Sonst nimmt ein geloeschter Datenordner die Sicherungen mit.
  check('ausserhalb', !backupRoot.startsWith(temp.dir + path.sep), backupRoot);

  section('Fehler reissen den Bot nicht mit');
  const kaputt = await sichern({ force: true, now: new Date('nicht-echt') });
  check('wirft nicht, meldet nur', kaputt.ok === false && typeof kaputt.error === 'string');

  fs.rmSync(backupRoot, { recursive: true, force: true });
  temp.cleanup();
  finish();
})();
