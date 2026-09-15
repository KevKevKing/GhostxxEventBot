const fs = require('node:fs/promises');
const path = require('node:path');
const { writeFileAtomic } = require('./atomic-write');
const { config } = require('./config');

// Dauerhafte Einstellungen, die der Bot per Chat gesagt bekommen kann.
//
// Regeln wie die Visum-Grenze aendern sich im Spiel laufend. Sie in .env zu
// pflegen hiesse: Datei bearbeiten und neu starten. Hier merkt er sie sich
// selbst, ueberlebt Neustarts, und du kannst sie ihm einfach sagen.

const settingsFile = path.join(config.dataDir, 'settings.json');

const DEFAULTS = {
  visaMinYears: 15,
  visaMaxId: 300000,
};

let writeQueue = Promise.resolve();
let cache = null;

function queueWrite(operation) {
  writeQueue = writeQueue.then(operation, operation);
  return writeQueue;
}

function sanitize(data = {}) {
  const clean = { ...DEFAULTS };

  const years = Number(data.visaMinYears);
  if (Number.isFinite(years) && years >= 0 && years <= 200) clean.visaMinYears = Math.round(years);

  const maxId = Number(data.visaMaxId);
  if (Number.isFinite(maxId) && maxId > 0 && maxId <= 10_000_000) clean.visaMaxId = Math.round(maxId);

  if (data.updatedAt) clean.updatedAt = String(data.updatedAt);
  if (data.updatedBy) clean.updatedBy = String(data.updatedBy);

  return clean;
}

async function readSettings() {
  if (cache) return cache;

  try {
    const raw = await fs.readFile(settingsFile, 'utf8');
    cache = sanitize(JSON.parse(raw));
  } catch {
    cache = { ...DEFAULTS };
  }

  return cache;
}

async function writeSettings(next) {
  return queueWrite(async () => {
    await fs.mkdir(config.dataDir, { recursive: true });
    const clean = sanitize(next);
    await writeFileAtomic(settingsFile, JSON.stringify(clean, null, 2));
    cache = clean;
    return clean;
  });
}

async function updateSettings(changes, updatedBy = '') {
  const current = await readSettings();
  return writeSettings({
    ...current,
    ...changes,
    updatedAt: new Date().toISOString(),
    updatedBy: updatedBy || current.updatedBy || '',
  });
}

/**
 * Erkennt Saetze wie "Visum ist jetzt 18" oder "ID Grenze auf 320000".
 * Gibt null zurueck, wenn nichts Eindeutiges drinsteht.
 */
function parseSettingChange(text) {
  const raw = String(text || '');
  const lower = raw.toLowerCase();

  // Zahlen mit Punkt oder Leerzeichen als Tausendertrenner zulassen.
  function findNumberAfter(keywords) {
    for (const keyword of keywords) {
      const index = lower.indexOf(keyword);
      if (index < 0) continue;
      const rest = raw.slice(index + keyword.length, index + keyword.length + 40);
      const match = rest.match(/(\d[\d.\s]*)/);
      if (match) {
        const value = Number(match[1].replace(/[.\s]/g, ''));
        if (Number.isFinite(value) && value > 0) return value;
      }
    }
    return null;
  }

  const changes = {};

  if (/\bvisum\b|\bvisa\b/.test(lower)) {
    const value = findNumberAfter(['visum', 'visa']);
    // Grosse Zahlen sind sicher keine Jahresangabe, sondern eine ID.
    if (value !== null && value <= 200) changes.visaMinYears = value;
  }

  if (/\bid\b|reisepass|passnummer/.test(lower)) {
    const value = findNumberAfter(['id grenze', 'id-grenze', 'idgrenze', 'id', 'reisepassnummer', 'passnummer']);
    if (value !== null && value > 1000) changes.visaMaxId = value;
  }

  return Object.keys(changes).length ? changes : null;
}

function describeSettings(settings) {
  return `Visum mindestens **${settings.visaMinYears}** Jahre, ID höchstens **${settings.visaMaxId}**.`;
}

module.exports = {
  DEFAULTS,
  describeSettings,
  parseSettingChange,
  readSettings,
  updateSettings,
};
