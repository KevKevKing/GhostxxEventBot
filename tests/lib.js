const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Winzige Testhilfe ohne Fremdpakete - der Bot soll keine Abhaengigkeiten
// bekommen, die er im Betrieb nicht braucht.

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

// Eigenes Datenverzeichnis, damit Tests niemals data/events.json anfassen.
function useTempData() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostbot-test-'));
  process.env.DATA_DIR = dir;
  return {
    dir,
    cleanup() {
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

function finish() {
  console.log(`\n${passed} bestanden, ${failed} fehlgeschlagen`);
  process.exit(failed ? 1 : 0);
}

async function ollamaAvailable() {
  try {
    const res = await fetch(`${process.env.OLLAMA_URL || 'http://127.0.0.1:11434'}/api/version`, {
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

module.exports = { check, equal, finish, ollamaAvailable, section, useTempData };
