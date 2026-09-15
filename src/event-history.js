const fs = require('node:fs/promises');
const path = require('node:path');
const { config } = require('./config');
const { listEvents } = require('./storage');

// Alle Anmeldungen an einem Ort: die aktiven aus events.json und die
// archivierten aus data/archive/.
//
// Vorher lag das Einlesen des Archivs in der Rangliste und war dort privat.
// Jetzt fragen Rangliste und Nachschlagen dieselbe Stelle - sonst haetten zwei
// Zaehlungen derselben Sache irgendwann unterschiedliche Ergebnisse geliefert.

const CACHE_MS = 5 * 60 * 1000;
const archiveDir = path.join(config.dataDir, 'archive');

let cache = { at: 0, events: null };

async function readArchiveEvents() {
  let names;

  try {
    names = await fs.readdir(archiveDir);
  } catch {
    return [];
  }

  const events = [];
  for (const name of names.filter((entry) => entry.endsWith('.json'))) {
    try {
      const raw = await fs.readFile(path.join(archiveDir, name), 'utf8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.events)) events.push(...parsed.events);
    } catch {
      // Eine kaputte Archivdatei darf nicht alles andere verhindern.
    }
  }

  return events;
}

/** Aktive und archivierte Anmeldungen, ohne Doppelte. */
async function alleEvents(now = Date.now()) {
  if (cache.events && now - cache.at < CACHE_MS) return cache.events;

  const aktiv = await listEvents();
  const archiviert = await readArchiveEvents();

  // Archiv und aktive Datei koennen sich kurz ueberschneiden, waehrend der
  // Archivierer laeuft.
  const gesehen = new Set();
  const alle = [...aktiv, ...archiviert].filter((event) => {
    if (gesehen.has(event.id)) return false;
    gesehen.add(event.id);
    return true;
  });

  cache = { at: now, events: alle };
  return alle;
}

/** Wann fand die Anmeldung statt? Faellt auf das Anlegen zurueck. */
function eventZeit(event) {
  const roh = event.startAt || event.openAt || event.createdAt;
  const zeit = roh ? new Date(roh).getTime() : NaN;
  return Number.isFinite(zeit) ? zeit : null;
}

/** Alle Angemeldeten - Stammplatz und Ersatzbank zusammen. */
function teilnehmer(event) {
  return [...(event.attendees || []), ...(event.substitutes || [])];
}

function invalidateCache() {
  cache = { at: 0, events: null };
}

module.exports = {
  alleEvents,
  eventZeit,
  invalidateCache,
  readArchiveEvents,
  teilnehmer,
};
