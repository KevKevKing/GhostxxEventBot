// Nicht die rohe antwort.wappen testen (die hat keine Sicherung), sondern
// den ECHTEN Pfad: readEventFromImage() und verifyImage(event='sk').
// Genau die entscheiden am Ende ueber Geld.

process.chdir('C:/Users/kevin/Desktop/GhostxxEventBot');

const fs = require('node:fs');
const { readEventFromImage, verifyImage } = require('../src/logbook-vision');
const { getEvent } = require('../src/logbook-events');

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
  '04-40er-blass.png',
  '05-video-ekz.png',
  '06-meeting.png',
  '07-rassauran.png',
  '08-uebermacht.png',
];

(async () => {
  console.log('=== SK-Bilder: readEventFromImage() sollte "sk" liefern ===');
  let skRichtig = 0;
  for (const name of SK_BILDER) {
    const roh = fs.readFileSync(`pruefstichprobe/${name}`);
    const r = await readEventFromImage(roh.toString('base64'), { ohneGedaechtnis: true });
    const ok = r.ok && r.event?.key === 'sk';
    if (ok) skRichtig += 1;
    console.log(`  ${ok ? 'OK ' : 'nein'}  ${name}  -> ${r.ok ? r.event?.key : r.reason}`);
  }

  console.log('\n=== SK-Bilder: verifyImage(event=sk) sollte true bestaetigen ===');
  let verifyRichtig = 0;
  for (const name of SK_BILDER) {
    const roh = fs.readFileSync(`pruefstichprobe/${name}`);
    const r = await verifyImage(roh.toString('base64'), getEvent('sk'), { ohneGedaechtnis: true });
    if (r.verified === true) verifyRichtig += 1;
    console.log(`  verified=${r.verified}  ${name}  (${r.reason || 'ok'})`);
  }

  console.log('\n=== Nicht-SK-Bilder: darf NIE "sk" liefern (readEventFromImage) ===');
  let falschAlsSk = 0;
  for (const name of NICHT_SK_BILDER) {
    const roh = fs.readFileSync(`pruefstichprobe/${name}`);
    const r = await readEventFromImage(roh.toString('base64'), { ohneGedaechtnis: true });
    const alsSk = r.ok && r.event?.key === 'sk';
    if (alsSk) falschAlsSk += 1;
    console.log(`  ${alsSk ? 'FALSCH ALS SK' : 'ok           '}  ${name}  -> ${r.ok ? r.event?.key : '(kein Fund)'}`);
  }

  console.log('\n=== Nicht-SK-Bilder: verifyImage(event=sk) darf NIE true geben ===');
  let falschBestaetigt = 0;
  for (const name of NICHT_SK_BILDER) {
    const roh = fs.readFileSync(`pruefstichprobe/${name}`);
    const r = await verifyImage(roh.toString('base64'), getEvent('sk'), { ohneGedaechtnis: true });
    if (r.verified === true) falschBestaetigt += 1;
    console.log(`  verified=${r.verified}  ${name}  (${r.reason || 'ok'})`);
  }

  console.log(`\n${skRichtig}/${SK_BILDER.length} echte SK ueber readEventFromImage erkannt.`);
  console.log(`${verifyRichtig}/${SK_BILDER.length} echte SK ueber verifyImage bestaetigt.`);
  console.log(`${falschAlsSk} Nicht-SK-Bilder faelschlich als SK erkannt (readEventFromImage).`);
  console.log(`${falschBestaetigt} Nicht-SK-Bilder faelschlich als SK bestaetigt (verifyImage).`);
})();
