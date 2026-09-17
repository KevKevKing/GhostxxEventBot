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
    'selbstverbesserung',
  ];
  assert.deepEqual(Object.keys(STANDARD).sort(), erwartet.sort());

  // Alles laeuft standardmaessig weiter - mit genau einer bewussten Ausnahme:
  // die Selbstverbesserung startet echte Claude-Code-Sessions und muss erst
  // von Hand freigegeben werden.
  const ausnahmen = ['selbstverbesserung'];
  for (const [key, wert] of Object.entries(STANDARD)) {
    assert.equal(wert, !ausnahmen.includes(key), `Standard von ${key}`);
  }
});

pruefe('Selbstverbesserung startet ausgeschaltet', () => {
  assert.equal(STANDARD.selbstverbesserung, false);
});

console.log(`\n${2 - fehlgeschlagen} bestanden, ${fehlgeschlagen} fehlgeschlagen`);
process.exitCode = fehlgeschlagen ? 1 : 0;
