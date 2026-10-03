// Winzige Testhilfe ohne Fremdpakete - dieselbe Konvention wie im
// Hauptprojekt (tests/lib.js), als eigene Kopie, weil sprachsteuerung/ nie
// etwas aus src/ oder tests/ des Bots importiert.

let failed = 0;
let passed = 0;

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  OK   ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${name}${detail ? `  -> ${detail}` : ''}`);
  }
  return Boolean(condition);
}

function equal(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  return check(name, a === e, `erwartet ${e}, war ${a}`);
}

function section(title) {
  console.log(`\n${title}`);
}

function finish() {
  console.log(`\n${passed} bestanden, ${failed} fehlgeschlagen`);
  process.exit(failed ? 1 : 0);
}

module.exports = { check, equal, finish, section };
