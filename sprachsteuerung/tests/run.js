const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

// Faehrt alle *.test.js nacheinander und fasst zusammen - identischer Stil
// wie tests/run.js im Hauptprojekt.

const testDir = __dirname;
const files = fs.readdirSync(testDir)
  .filter((name) => name.endsWith('.test.js'))
  .sort();

const nurDiese = process.argv.slice(2);
const auswahl = nurDiese.length
  ? files.filter((name) => nurDiese.some((wunsch) => name.includes(wunsch)))
  : files;

if (!auswahl.length) {
  console.error(nurDiese.length ? `Keine Tests gefunden für: ${nurDiese.join(', ')}` : 'Keine Tests gefunden.');
  process.exit(1);
}

const gescheitert = [];
const start = Date.now();

for (const name of auswahl) {
  console.log(`\n${'='.repeat(60)}\n${name}\n${'='.repeat(60)}`);

  const result = spawnSync(process.execPath, [path.join(testDir, name)], {
    stdio: 'inherit',
    env: process.env,
  });

  if (result.status !== 0) gescheitert.push(name);
}

const dauer = ((Date.now() - start) / 1000).toFixed(1);
console.log(`\n${'='.repeat(60)}`);

if (gescheitert.length) {
  console.log(`FEHLGESCHLAGEN nach ${dauer}s: ${gescheitert.join(', ')}`);
  process.exit(1);
}

console.log(`Alle ${auswahl.length} Testdateien bestanden (${dauer}s).`);
