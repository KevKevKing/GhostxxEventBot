const fs = require('node:fs/promises');
const path = require('node:path');

// Datei sicher ersetzen: erst daneben schreiben, dann umbenennen.
//
// Unter Windows scheitert das Umbenennen mit EPERM oder EBUSY, wenn ein
// anderer Prozess die Zieldatei noch offen hat - beim Neustart des Bots oder
// wenn ein Virenscanner gerade hineinschaut. Das ist ein kurzer Zustand,
// deshalb wird es ein paar Mal mit wachsender Pause wiederholt.
//
// Passiert das nicht, bleibt eine verwaiste .tmp liegen und die Aenderung geht
// verloren - genau das ist beim Archivieren einmal passiert.
//
// Ghosts eigener Code-Vorschlag (30.09.): der Name der Temp-Datei haengt nur
// vom Zielpfad ab. Ruft irgendwer writeFileAtomic zweimal GLEICHZEITIG mit
// demselben Pfad auf, schreiben beide in dieselbe .tmp-Datei - wer zuerst
// umbenennt, gewinnt, der andere trifft auf ein verschwundenes .tmp (ENOENT,
// nicht in RETRYABLE) und wirft. Sechs Module bauen sich dagegen von Hand
// dieselbe writeQueue/queueWrite-Serialisierung (storage.js, permissions.js,
// memory.js, knowledge.js, giveaway-storage.js, bot-settings.js) -
// bild-vorablesen.js tut es NICHT, und sichereStand() wird dort sowohl vom
// Bild-Takt als auch vom Dashboard-Pausieren-Knopf aus aufgerufen, ohne
// gemeinsame Sperre. Deshalb serialisiert writeFileAtomic jetzt selbst, pro
// aufgeloestem Pfad - fuer alle Aufrufer auf einmal, nicht nur fuer einen.

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

async function schreibeUndBenenneUm(filePath, content) {
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

// Eine Kette pro aufgeloestem Zielpfad, damit zwei gleichzeitige Aufrufe fuer
// denselben Pfad nacheinander statt gegeneinander schreiben. Waechst nicht
// unbegrenzt: die Menge der tatsaechlich geschriebenen Pfade ist die feste,
// kleine Menge an Datendateien dieses Projekts, keine pro Anfrage neue Datei.
const anstehendeSchreibvorgaenge = new Map();

/**
 * Schreibt content nach filePath, ohne dass bei einem Absturz eine halbe
 * Datei zurueckbleibt - und ohne dass zwei gleichzeitige Aufrufe fuer
 * denselben Pfad sich gegenseitig die .tmp-Datei wegschreiben.
 */
function writeFileAtomic(filePath, content) {
  const aufgeloest = path.resolve(filePath);
  const vorherigeKette = anstehendeSchreibvorgaenge.get(aufgeloest) || Promise.resolve();

  // Egal ob der vorherige Schreibvorgang zu demselben Pfad erfolgreich war
  // oder scheiterte, der naechste soll trotzdem versuchen zu schreiben -
  // sonst wuerde ein einzelner Fehlschlag alle folgenden Schreibversuche zu
  // diesem Pfad fuer immer blockieren.
  const eigenerVorgang = vorherigeKette.then(
    () => schreibeUndBenenneUm(filePath, content),
    () => schreibeUndBenenneUm(filePath, content),
  );

  // In der Kette selbst darf ein Fehler nicht weitergereicht werden (siehe
  // oben) - der Aufrufer DIESES writeFileAtomic()-Aufrufs soll den Fehler
  // trotzdem sehen, deshalb wird unten `eigenerVorgang` zurueckgegeben, nicht
  // die hier gefangene Version.
  anstehendeSchreibvorgaenge.set(aufgeloest, eigenerVorgang.catch(() => null));

  return eigenerVorgang;
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
