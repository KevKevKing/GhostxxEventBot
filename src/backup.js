const fs = require('node:fs/promises');
const path = require('node:path');
const { config } = require('./config');
const { logBotEvent, logError } = require('./logger');

// Taegliche Sicherung von data/.
//
// Was dort liegt, ist nirgends sonst ableitbar: die Gewinner aller Verlosungen,
// die Rechte, das beigebrachte Wissen und das Eventarchiv. Ging eine dieser
// Dateien kaputt - Stromausfall mitten im Schreiben, ein Fehler beim Umbauen -
// waere sie weg gewesen.
//
// Bewusst simpel: eine Kopie pro Tag in einen eigenen Ordner, vierzehn Tage
// aufbewahrt. Kein Packen, keine Unterschiede berechnen - eine Sicherung, die
// man im Zweifel per Hand zurueckkopieren kann, ist mehr wert als eine
// clevere, die man erst wieder auspacken muss.

// Neben data/, nicht darin - wer den Datenordner loescht oder ersetzt, soll
// nicht im selben Zug seine Sicherungen mitnehmen.
const backupRoot = path.join(path.dirname(config.dataDir), 'backups');

const AUFBEWAHREN_TAGE = 14;
const INTERVALL_MS = 6 * 60 * 60 * 1000;

/**
 * 2026-08-09 in Ortszeit - sortiert sich von selbst richtig.
 *
 * Bewusst nicht toISOString: das rechnet nach UTC um, und nachts um eins haette
 * der Ordner den Namen des Vortags getragen.
 */
function heute(now = new Date()) {
  if (Number.isNaN(now.getTime())) throw new Error('Ungültiges Datum');

  const jahr = now.getFullYear();
  const monat = String(now.getMonth() + 1).padStart(2, '0');
  const tag = String(now.getDate()).padStart(2, '0');
  return `${jahr}-${monat}-${tag}`;
}

/** Alle .json unterhalb von data/, relativ zum Datenordner. */
async function sammleDateien(verzeichnis, prefix = '') {
  const eintraege = await fs.readdir(verzeichnis, { withFileTypes: true }).catch(() => []);
  const dateien = [];

  for (const eintrag of eintraege) {
    const relativ = prefix ? `${prefix}/${eintrag.name}` : eintrag.name;

    if (eintrag.isDirectory()) {
      dateien.push(...(await sammleDateien(path.join(verzeichnis, eintrag.name), relativ)));
      continue;
    }

    // .tmp-Reste eines abgebrochenen Schreibvorgangs gehoeren nicht in eine
    // Sicherung - sie sehen aus wie Daten, sind aber halbe Dateien.
    if (!eintrag.name.endsWith('.json')) continue;
    dateien.push(relativ);
  }

  return dateien;
}

/**
 * Legt eine Sicherung an, falls fuer heute noch keine existiert.
 * Wirft nie - eine fehlgeschlagene Sicherung darf den Bot nicht stoppen.
 */
async function sichern({ force = false, now = new Date() } = {}) {
  try {
    const ziel = path.join(backupRoot, heute(now));

    if (!force) {
      const schonDa = await fs.stat(ziel).then(() => true).catch(() => false);
      if (schonDa) return { ok: true, uebersprungen: true, ziel };
    }

    const dateien = await sammleDateien(config.dataDir);
    if (!dateien.length) return { ok: true, uebersprungen: true, dateien: 0 };

    await fs.mkdir(ziel, { recursive: true });

    let bytes = 0;
    for (const relativ of dateien) {
      const von = path.join(config.dataDir, relativ);
      const nach = path.join(ziel, relativ);

      await fs.mkdir(path.dirname(nach), { recursive: true });
      await fs.copyFile(von, nach);
      bytes += (await fs.stat(nach)).size;
    }

    const geloescht = await aufraeumen(now);
    return { ok: true, ziel, dateien: dateien.length, bytes, geloescht };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

/** Sicherungen aelter als AUFBEWAHREN_TAGE entfernen. */
async function aufraeumen(now = new Date()) {
  const grenze = new Date(now.getTime() - AUFBEWAHREN_TAGE * 24 * 60 * 60 * 1000);
  const grenzTag = heute(grenze);

  const ordner = await fs.readdir(backupRoot, { withFileTypes: true }).catch(() => []);
  const geloescht = [];

  for (const eintrag of ordner) {
    if (!eintrag.isDirectory()) continue;
    // Nur was wie ein Datum aussieht - sonst raeumt das hier fremde Ordner weg.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(eintrag.name)) continue;
    if (eintrag.name >= grenzTag) continue;

    await fs.rm(path.join(backupRoot, eintrag.name), { recursive: true, force: true }).catch(() => null);
    geloescht.push(eintrag.name);
  }

  return geloescht;
}

async function listeSicherungen() {
  const ordner = await fs.readdir(backupRoot, { withFileTypes: true }).catch(() => []);
  return ordner
    .filter((eintrag) => eintrag.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(eintrag.name))
    .map((eintrag) => eintrag.name)
    .sort();
}

function startBackups() {
  const lauf = async () => {
    const ergebnis = await sichern();

    if (!ergebnis.ok) {
      logError('Sicherung fehlgeschlagen', new Error(ergebnis.error));
      return;
    }

    if (ergebnis.uebersprungen) return;

    console.log(`Sicherung angelegt: ${ergebnis.dateien} Dateien nach ${ergebnis.ziel}`);
    logBotEvent({
      title: 'Sicherung angelegt',
      color: 'create',
      fields: [
        { name: 'Dateien', value: String(ergebnis.dateien), inline: true },
        { name: 'Groesse', value: `${Math.round(ergebnis.bytes / 1024)} KB`, inline: true },
        ...(ergebnis.geloescht?.length
          ? [{ name: 'Entfernt (älter als 14 Tage)', value: ergebnis.geloescht.join(', ') }]
          : []),
      ],
    });
  };

  lauf().catch(() => null);

  // Alle sechs Stunden nachsehen. Laeuft der Rechner nachts durch, ist die
  // Sicherung frueh da; wird er nur abends angemacht, eben dann - der
  // Tagesordner verhindert, dass mehrfach kopiert wird.
  const timer = setInterval(() => lauf().catch(() => null), INTERVALL_MS);
  timer.unref?.();
  return timer;
}

module.exports = {
  AUFBEWAHREN_TAGE,
  aufraeumen,
  backupRoot,
  listeSicherungen,
  sichern,
  startBackups,
};
