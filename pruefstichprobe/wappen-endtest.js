// Die fertige Wappen-Erkennung (erkenneWappen aus logbook-vision.js) gegen
// echte Bilder: die fuenf SK-Wappenbilder muessen "true" geben, die acht
// Nicht-SK-Bilder aus der alten Stichprobe muessen "false" geben.

process.chdir('C:/Users/kevin/Desktop/GhostxxEventBot');

const fs = require('node:fs');
const { zuschneiden } = require('../src/bild-zuschnitt');
const { leseEvents } = require('../src/logbook-vision');

const SK_BILDER = [
  'Screenshot 2026-08-17 042452.png',
  'Screenshot 2026-08-17 042509.png',
  'Screenshot 2026-08-17 042520.png',
  'Screenshot 2026-08-17 042528.png',
  'Screenshot 2026-08-17 042539.png',
];

const NICHT_SK_BILDER = [
  '01-megalodon-popup.png',
  '02-drift-popup.png',
  '03-sk-wappen.png', // Ausnahme: das IST SK, siehe unten
  '04-40er-blass.png',
  '05-video-ekz.png',
  '06-meeting.png',
  '07-rassauran.png',
  '08-uebermacht.png',
];

(async () => {
  console.log('=== Muessen WAHR sein (echte SK-Wappen) ===');
  let skRichtig = 0;
  for (const name of SK_BILDER) {
    const roh = fs.readFileSync(`pruefstichprobe/${name}`);
    const r = await leseEvents(roh.toString('base64'), { ohneGedaechtnis: true });
    const wappen = r.ok && r.antwort.wappen;
    if (wappen) skRichtig += 1;
    console.log(`  ${wappen ? 'OK ' : 'FEHLT'}  ${name}  (gefunden: ${r.ok ? r.gefundene.map((e) => e.key).join(',') || '-' : 'FEHLER'})`);
  }

  console.log('\n=== Muessen FALSCH sein (kein SK-Wappen) ===');
  let falschPositiv = 0;
  for (const name of NICHT_SK_BILDER) {
    const roh = fs.readFileSync(`pruefstichprobe/${name}`);
    const r = await leseEvents(roh.toString('base64'), { ohneGedaechtnis: true });
    const wappen = r.ok && r.antwort.wappen;
    if (wappen && name !== '03-sk-wappen.png') falschPositiv += 1;
    const erwartung = name === '03-sk-wappen.png' ? '(ist SK)' : '';
    console.log(`  ${wappen ? 'WAPPEN' : 'nein  '}  ${name} ${erwartung}`);
  }

  console.log(`\n${skRichtig}/${SK_BILDER.length} echte SK-Wappen erkannt.`);
  console.log(`${falschPositiv} Fehlalarme bei echten Nicht-SK-Bildern.`);
})();
