const assert = require('node:assert/strict');
const { STANDARD } = require('../src/steuerung');

let fehlgeschlagen = 0;

function pruefe(name, fn) {
  try {
    fn();
    console.log(`  OK   ${name}`);
  } catch (error) {
    fehlgeschlagen += 1;
    console.log(`  FEHLER ${name}: ${error.message}`);
  }
}

console.log('\nSteuerzentrale');
pruefe('alle erwarteten Schalter haben einen sicheren Standard', () => {
  const erwartet = [
    'eventScheduler', 'terminErinnerungen', 'chat', 'commands', 'visaBilder',
    'chatBilder', 'logbuchSortieren', 'auditLog', 'logNachrichten',
    'logMitglieder', 'logSprache', 'logSelbststumm', 'logKanaele', 'botLog', 'fehlerLog',
  ];
  assert.deepEqual(Object.keys(STANDARD).sort(), erwartet.sort());
  assert.ok(Object.values(STANDARD).every((wert) => wert === true));
});

console.log(`\n${1 - fehlgeschlagen} bestanden, ${fehlgeschlagen} fehlgeschlagen`);
process.exitCode = fehlgeschlagen ? 1 : 0;
