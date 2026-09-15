const fs = require('node:fs/promises');
const path = require('node:path');
const { writeFileAtomic } = require('./atomic-write');
const { config } = require('./config');

const giveawaysFile = path.join(config.dataDir, 'giveaways.json');

let writeQueue = Promise.resolve();

async function ensureStore() {
  await fs.mkdir(config.dataDir, { recursive: true });

  try {
    await fs.access(giveawaysFile);
  } catch {
    await fs.writeFile(giveawaysFile, JSON.stringify({ giveaways: [] }, null, 2));
  }
}

async function readStore() {
  await ensureStore();
  const raw = await fs.readFile(giveawaysFile, 'utf8');

  try {
    const data = JSON.parse(raw);
    if (!Array.isArray(data.giveaways)) return { giveaways: [] };
    return data;
  } catch {
    return { giveaways: [] };
  }
}

async function writeStore(data) {
  await ensureStore();
  await writeFileAtomic(giveawaysFile, JSON.stringify(data, null, 2));
}

function queueWrite(operation) {
  writeQueue = writeQueue.then(operation, operation);
  return writeQueue;
}

async function listGiveaways() {
  const data = await readStore();
  return data.giveaways;
}

async function getGiveaway(giveawayId) {
  const data = await readStore();
  return data.giveaways.find((giveaway) => giveaway.id === giveawayId) || null;
}

async function saveGiveaway(giveaway) {
  return queueWrite(async () => {
    const data = await readStore();
    const index = data.giveaways.findIndex((stored) => stored.id === giveaway.id);

    if (index >= 0) data.giveaways[index] = giveaway;
    else data.giveaways.push(giveaway);

    await writeStore(data);
    return giveaway;
  });
}

async function updateGiveaway(giveawayId, updater) {
  return queueWrite(async () => {
    const data = await readStore();
    const index = data.giveaways.findIndex((giveaway) => giveaway.id === giveawayId);
    if (index < 0) return null;

    const updated = await updater(data.giveaways[index]);
    data.giveaways[index] = updated;
    await writeStore(data);
    return updated;
  });
}

function createGiveawayId() {
  const time = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 7);
  return `giveaway-${time}-${random}`;
}

module.exports = {
  createGiveawayId,
  getGiveaway,
  listGiveaways,
  saveGiveaway,
  updateGiveaway,
};
