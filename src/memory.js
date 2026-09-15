const fs = require('node:fs/promises');
const path = require('node:path');
const { writeFileAtomic } = require('./atomic-write');
const { config } = require('./config');

// Gespraechsgedaechtnis, das Neustarts ueberlebt.
//
// Vorher lagen die letzten Nachrichten nur im Arbeitsspeicher und waren nach
// jedem Neustart weg - der Bot hat mitten im Gespraech vergessen, worum es ging.
// Geschrieben wird verzoegert gesammelt, damit nicht jede Chatnachricht einen
// Dateizugriff ausloest.

const memoryFile = path.join(config.dataDir, 'chat-memory.json');

const MAX_TURNS_PER_THREAD = 12;
const THREAD_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_THREADS = 200;
const SAVE_DEBOUNCE_MS = 5000;

let threads = null;
let saveTimer = null;
let writeQueue = Promise.resolve();

function queueWrite(operation) {
  writeQueue = writeQueue.then(operation, operation);
  return writeQueue;
}

async function load() {
  if (threads) return threads;

  threads = new Map();

  try {
    const raw = await fs.readFile(memoryFile, 'utf8');
    const data = JSON.parse(raw);
    const now = Date.now();

    for (const [key, entry] of Object.entries(data.threads || {})) {
      if (!Array.isArray(entry?.messages)) continue;
      if (now - Number(entry.at || 0) > THREAD_TTL_MS) continue;
      threads.set(key, { messages: entry.messages.slice(-MAX_TURNS_PER_THREAD), at: Number(entry.at) });
    }
  } catch {
    // Keine oder kaputte Datei - dann eben ohne Erinnerung starten.
  }

  return threads;
}

function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    save().catch((error) => console.error('Gedaechtnis speichern fehlgeschlagen:', error.message));
  }, SAVE_DEBOUNCE_MS);
  saveTimer.unref?.();
}

async function save() {
  const map = await load();

  return queueWrite(async () => {
    const now = Date.now();

    // Aeltestes zuerst wegwerfen, damit die Datei nicht unbegrenzt waechst.
    const alive = [...map.entries()]
      .filter(([, entry]) => now - entry.at <= THREAD_TTL_MS)
      .sort((a, b) => b[1].at - a[1].at)
      .slice(0, MAX_THREADS);

    threads = new Map(alive);

    await fs.mkdir(config.dataDir, { recursive: true });
    const payload = { threads: Object.fromEntries(alive) };
    await writeFileAtomic(memoryFile, JSON.stringify(payload, null, 2));
  });
}

async function getHistory(key) {
  const map = await load();
  const entry = map.get(key);
  if (!entry) return [];
  if (Date.now() - entry.at > THREAD_TTL_MS) {
    map.delete(key);
    return [];
  }
  return entry.messages;
}

async function remember(key, role, content) {
  const map = await load();
  const entry = map.get(key) || { messages: [], at: Date.now() };

  entry.messages.push({ role, content: String(content).slice(0, 2000) });
  while (entry.messages.length > MAX_TURNS_PER_THREAD) entry.messages.shift();
  entry.at = Date.now();

  map.set(key, entry);
  scheduleSave();
}

async function forget(key) {
  const map = await load();
  const had = map.delete(key);
  if (had) scheduleSave();
  return had;
}

async function stats() {
  const map = await load();
  return {
    threads: map.size,
    messages: [...map.values()].reduce((sum, entry) => sum + entry.messages.length, 0),
  };
}

module.exports = {
  MAX_TURNS_PER_THREAD,
  forget,
  getHistory,
  remember,
  save,
  stats,
};
