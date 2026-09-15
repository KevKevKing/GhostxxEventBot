const fs = require('node:fs/promises');
const path = require('node:path');
const { writeFileAtomic } = require('./atomic-write');
const { config } = require('./config');

const eventsFile = path.join(config.dataDir, 'events.json');
const archiveDir = path.join(config.dataDir, 'archive');
const STALE_OPEN_ARCHIVE_DAYS = 14;

let writeQueue = Promise.resolve();

async function ensureStore() {
  await fs.mkdir(config.dataDir, { recursive: true });

  try {
    await fs.access(eventsFile);
  } catch {
    await fs.writeFile(eventsFile, JSON.stringify({ events: [] }, null, 2));
  }
}

async function readStore() {
  await ensureStore();
  const raw = await fs.readFile(eventsFile, 'utf8');

  try {
    const data = JSON.parse(raw);
    if (!Array.isArray(data.events)) return { events: [] };
    return data;
  } catch {
    return { events: [] };
  }
}

async function writeStore(data) {
  await ensureStore();
  await writeFileAtomic(eventsFile, JSON.stringify(data, null, 2));
}

function queueWrite(operation) {
  writeQueue = writeQueue.then(operation, operation);
  return writeQueue;
}

async function listEvents() {
  const data = await readStore();
  return data.events;
}

async function getEvent(eventId) {
  const data = await readStore();
  return data.events.find((event) => event.id === eventId) || null;
}

async function saveEvent(event) {
  return queueWrite(async () => {
    const data = await readStore();
    const index = data.events.findIndex((stored) => stored.id === event.id);

    if (index >= 0) data.events[index] = event;
    else data.events.push(event);

    await writeStore(data);
    return event;
  });
}

async function updateEvent(eventId, updater) {
  return queueWrite(async () => {
    const data = await readStore();
    const index = data.events.findIndex((event) => event.id === eventId);
    if (index < 0) return null;

    const updated = await updater(data.events[index]);
    data.events[index] = updated;
    await writeStore(data);
    return updated;
  });
}

function createEventId() {
  const time = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 7);
  return `${time}-${random}`;
}

function getEventSortTime(event) {
  const stamp = event.closeAt || event.startAt || event.createdAt;
  const time = new Date(stamp || 0).getTime();
  return Number.isNaN(time) ? 0 : time;
}

/**
 * Verschiebt abgelaufene Events aus events.json in monatliche Archivdateien.
 *
 * Jeder Button-Klick liest und schreibt die komplette events.json. Ohne
 * Aufraeumen waechst sie unbegrenzt und macht jede Anmeldung langsamer.
 * Offene Events bleiben immer drin, egal wie alt.
 */
async function pruneEvents(maxAgeDays = 3, now = new Date()) {
  const cutoff = now.getTime() - maxAgeDays * 24 * 60 * 60 * 1000;
  // Manuell erstellte Anmeldungen haben kein closeAt und bleiben dauerhaft
  // 'open'. Die duerfen nicht ewig liegen bleiben, bekommen aber eine deutlich
  // laengere Schonfrist als regulaer geschlossene Events.
  const staleOpenCutoff = now.getTime() - STALE_OPEN_ARCHIVE_DAYS * 24 * 60 * 60 * 1000;

  return queueWrite(async () => {
    const data = await readStore();
    const keep = [];
    const archive = [];

    for (const event of data.events) {
      const sortTime = getEventSortTime(event);
      const expired = event.status !== 'open'
        ? sortTime < cutoff
        : !event.closeAt && sortTime < staleOpenCutoff;

      if (expired) archive.push(event);
      else keep.push(event);
    }

    if (!archive.length) return { archived: 0, remaining: keep.length };

    await fs.mkdir(archiveDir, { recursive: true });

    const buckets = new Map();
    for (const event of archive) {
      const month = new Date(getEventSortTime(event)).toISOString().slice(0, 7);
      if (!buckets.has(month)) buckets.set(month, []);
      buckets.get(month).push(event);
    }

    for (const [month, events] of buckets) {
      const target = path.join(archiveDir, `events-${month}.json`);
      let existing = [];

      try {
        const raw = await fs.readFile(target, 'utf8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed.events)) existing = parsed.events;
      } catch {
        existing = [];
      }

      const known = new Set(existing.map((event) => event.id));
      const merged = [...existing, ...events.filter((event) => !known.has(event.id))];

      await writeFileAtomic(target, JSON.stringify({ events: merged }, null, 2));
    }

    await writeStore({ ...data, events: keep });
    return { archived: archive.length, remaining: keep.length };
  });
}

module.exports = {
  createEventId,
  getEvent,
  listEvents,
  pruneEvents,
  saveEvent,
  updateEvent,
};

