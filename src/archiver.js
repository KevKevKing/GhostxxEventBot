const { config } = require('./config');
const { pruneEvents } = require('./storage');
const { logError } = require('./logger');

const ARCHIVE_INTERVAL_MS = 6 * 60 * 60 * 1000;

async function runArchivePass() {
  try {
    const result = await pruneEvents(config.eventArchiveDays);
    if (result.archived > 0) {
      console.log(`Archiviert: ${result.archived} Events, ${result.remaining} bleiben aktiv.`);
    }
  } catch (error) {
    console.error('Archivierung fehlgeschlagen:', error.message);
    logError('Archivierung fehlgeschlagen', error);
  }
}

function startEventArchiver() {
  runArchivePass();
  const interval = setInterval(runArchivePass, ARCHIVE_INTERVAL_MS);
  console.log('Event-Archivierung laeuft.');
  return interval;
}

module.exports = {
  runArchivePass,
  startEventArchiver,
};
