const fs = require('node:fs/promises');

// Datei sicher ersetzen: erst daneben schreiben, dann umbenennen.
//
// Unter Windows scheitert das Umbenennen mit EPERM oder EBUSY, wenn ein
// anderer Prozess die Zieldatei noch offen hat - beim Neustart des Bots oder
// wenn ein Virenscanner gerade hineinschaut. Das ist ein kurzer Zustand,
// deshalb wird es ein paar Mal mit wachsender Pause wiederholt.
//
// Passiert das nicht, bleibt eine verwaiste .tmp liegen und die Aenderung geht
// verloren - genau das ist beim Archivieren einmal passiert.

const RETRY_DELAYS_MS = [50, 150, 400, 1000];
const RETRYABLE = new Set(['EPERM', 'EBUSY', 'EACCES', 'ENOTEMPTY']);

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function renameWithRetry(from, to) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await fs.rename(from, to);
      return;
    } catch (error) {
      const letzterVersuch = attempt >= RETRY_DELAYS_MS.length;
      if (letzterVersuch || !RETRYABLE.has(error.code)) throw error;
      await wait(RETRY_DELAYS_MS[attempt]);
    }
  }
}

/**
 * Schreibt content nach filePath, ohne dass bei einem Absturz eine halbe
 * Datei zurueckbleibt.
 */
async function writeFileAtomic(filePath, content) {
  const tempFile = `${filePath}.tmp`;

  await fs.writeFile(tempFile, content);

  try {
    await renameWithRetry(tempFile, filePath);
  } catch (error) {
    // Nicht die kaputte .tmp liegen lassen - sonst sammeln sich Reste an.
    await fs.rm(tempFile, { force: true }).catch(() => null);
    throw error;
  }
}

/** Raeumt Reste auf, die ein frueherer Fehlschlag hinterlassen hat. */
async function cleanupStaleTemp(filePath) {
  await fs.rm(`${filePath}.tmp`, { force: true }).catch(() => null);
}

module.exports = {
  cleanupStaleTemp,
  renameWithRetry,
  writeFileAtomic,
};
