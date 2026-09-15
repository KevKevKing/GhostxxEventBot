const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { config } = require('./config');
const { writeFileAtomic } = require('./atomic-write');
const { findEventsInImageText } = require('./logbook-events');

// Was in einem Bild steht, aendert sich nie.
//
// Bisher wurde jedes Bild erst bei der Sammelauszahlung gelesen - alle auf
// einmal, zwei bis drei Stunden am Stueck, Grafikkarte dicht. Und wer erst
// Wochen spaeter ausgezahlt wird, dessen Discord-Anhang ist womoeglich schon
// abgelaufen: bei einer Messstichprobe waren nach drei Tagen 2 von 15 Bildern
// nicht mehr abrufbar.
//
// Deshalb wird jedes Ergebnis hier festgehalten, sobald es einmal gelesen
// wurde. Gespeichert wird NUR das Ergebnis, nie das Bild selbst.
//
// Der Schluessel ist der Inhalt des Bildes (SHA-1), nicht die Nachrichten-ID:
// dasselbe Bild ein zweites Mal hochgeladen trifft denselben Eintrag und wird
// gar nicht erst neu gelesen.

const MAX_EINTRAEGE = 3000;

const datei = path.join(config.dataDir, 'bild-gedaechtnis.json');

let speicher = null;
let schreibt = null;

function abdruck(imageBase64) {
  return crypto.createHash('sha1').update(String(imageBase64 || '')).digest('hex').slice(0, 16);
}

async function laden() {
  if (speicher) return speicher;

  try {
    const roh = await fs.readFile(datei, 'utf8');
    const daten = JSON.parse(roh);
    speicher = new Map(Object.entries(daten.bilder || {}));
  } catch {
    speicher = new Map();
  }

  return speicher;
}

async function sichern() {
  if (schreibt) return schreibt;

  schreibt = (async () => {
    const map = await laden();

    // Aeltestes zuerst wegwerfen, wenn es zu viel wird.
    if (map.size > MAX_EINTRAEGE) {
      const sortiert = [...map.entries()].sort((a, b) => (
        new Date(a[1].gelesenAm || 0) - new Date(b[1].gelesenAm || 0)
      ));
      for (const [schluessel] of sortiert.slice(0, map.size - MAX_EINTRAEGE)) map.delete(schluessel);
    }

    await writeFileAtomic(datei, JSON.stringify({ bilder: Object.fromEntries(map) }, null, 2));
    schreibt = null;
  })();

  return schreibt;
}

/** Was wurde zu diesem Bild schon gelesen? */
async function merke(imageBase64) {
  const map = await laden();
  return map.get(abdruck(imageBase64)) || null;
}

/**
 * Ergebnis festhalten. Ergaenzt einen vorhandenen Eintrag, statt ihn zu ersetzen.
 *
 * `gelesenAm` wird NUR gesetzt, wenn wirklich etwas gelesen wurde. Vorher
 * bekam auch ein fehlgeschlagener Versuch einen frischen Zeitstempel - im
 * Dashboard sah das aus, als wuerde er staendig alles neu auswerten, obwohl
 * er nur an denselben Bildern gescheitert ist.
 */
async function halteFest(imageBase64, teil) {
  const map = await laden();
  const schluessel = abdruck(imageBase64);
  const alt = map.get(schluessel) || {};

  const etwasGelesen = Boolean(teil.antwort) || 'zeitpunkt' in teil || teil.gelesen === true;
  const neu = { ...alt, ...teil, versuchtAm: new Date().toISOString() };

  if (etwasGelesen) neu.gelesenAm = new Date().toISOString();
  else if (!neu.gelesenAm) neu.gelesenAm = alt.gelesenAm || '';

  map.set(schluessel, neu);
  await sichern();
  return neu;
}

/** Alles, was er gelesen hat - neueste zuerst. Fuers Dashboard. */
async function alleGelesenen(anzahl = 40) {
  const map = await laden();
  return [...map.entries()]
    // Die Zuordnung kommt frisch aus dem Katalog, nicht aus der Datei - sonst
    // stehen im Dashboard Eventnamen, die es so nicht mehr gibt.
    .map(([schluessel, wert]) => ({ schluessel, ...wert, labels: labelsVon(wert) }))
    .sort((a, b) => (
      new Date(b.gelesenAm || b.versuchtAm || 0) - new Date(a.gelesenAm || a.versuchtAm || 0)
    ))
    .slice(0, anzahl);
}

/**
 * Welche Nachrichten sind schon ausgewertet?
 *
 * Damit laesst sich der Merkzettel des Vorablesers wiederherstellen, ohne alle
 * Tickets nochmal abzulaufen - genau das habe ich einmal von Hand geloescht
 * und ihn dadurch alles neu durchgehen lassen.
 */
async function erledigteNachrichten() {
  const map = await laden();
  return [...map.values()]
    .filter((w) => w.messageId && istEndgueltig(w))
    .map((w) => w.messageId);
}

/**
 * Welche Events stecken in diesem Eintrag - nach dem HEUTIGEN Katalog?
 *
 * Bewusst nicht `eintrag.labels`. Das Feld steht zwar in der Datei, ist aber
 * nur eine Momentaufnahme von damals: Bilder mit der Gewinnmeldung des
 * Ressourcenkriegs lagen dort als "Bizwar", weil der Katalog zu dem Zeitpunkt
 * noch das blanke "geschaeft" enthielt. Der Katalog hat sich seither zweimal
 * geaendert - die Datei kein einziges Mal.
 *
 * Neu berechnet gilt jede Katalogkorrektur rueckwirkend fuer alles, was schon
 * gelesen wurde - ohne dass irgendwer eine Datei aufraeumen muss.
 */
// labelsVon() lief bisher bei JEDEM Aufruf neu durch die unscharfe Suche
// (gleitendes Fenster, Levenshtein) - gewollt, siehe Kommentar oben, wegen
// rueckwirkender Katalogkorrekturen. Das Problem: ungeklaerte() ruft das fuer
// JEDEN Eintrag im Bildgedaechtnis auf, bei JEDEM 45-Sekunden-Takt, sobald
// die Warteschlange leer ist - gemessen 19,6 Sekunden Vollsperre pro Takt bei
// 562 Eintraegen, am 18.08. Der Bot war dadurch fast die Haelfte der Zeit
// komplett eingefroren (Dashboard, Buttons, Discord-Ping).
//
// Der Katalog aendert sich nur beim Neustart (EVENTS wird einmal geladen,
// nicht live nachgeladen) - darum reicht eine Zwischenspeicherung pro
// Prozesslauf. Die WeakMap ist bei jedem Neustart leer, die rueckwirkende
// Korrektur bleibt also erhalten. Es wird nichts auf die Festplatte
// geschrieben.
const labelsCache = new WeakMap();

function labelsVon(eintrag) {
  if (!eintrag) return [];
  if (labelsCache.has(eintrag)) return labelsCache.get(eintrag);
  const ergebnis = findEventsInImageText(eintrag?.antwort?.events).map((e) => e.label);
  labelsCache.set(eintrag, ergebnis);
  return ergebnis;
}

/**
 * Ist dieses Ergebnis endgueltig?
 *
 * Ein Fund schon: was im Bild steht, aendert sich nicht mehr. Eine
 * Fehlanzeige erst beim zweiten Mal - der kleine Kasten oben rechts wird
 * leicht uebersehen, und ein zu Unrecht als leer abgehaktes Bild waere fuer
 * die Auszahlung verloren.
 */
function istEndgueltig(eintrag) {
  if (!eintrag?.antwort) return false;
  const fund = labelsVon(eintrag).length > 0 || eintrag.antwort.wappen;
  return fund || (eintrag.leerVersuche || 0) >= 2;
}

async function anzahlGemerkt() {
  return (await laden()).size;
}

/**
 * Was noch nicht geklaert ist - fuer die Wiedervorlage.
 *
 * Alles, wo kein Event gefunden wurde oder das Lesen gescheitert ist, und
 * dessen letzter Versuch lange genug her ist. Hat er nichts Neues zu tun,
 * nimmt er sich diese nochmal vor: die Grafikkarte ist dann sowieso frei, und
 * an jedem dieser Bilder haengt Geld.
 */
async function ungeklaerte(aelterAlsMs = 60 * 60 * 1000, jetzt = Date.now()) {
  const map = await laden();

  return [...map.values()]
    .filter((w) => {
      if (!w.messageId || !w.kanalId) return false;
      if (istEndgueltig(w) && labelsVon(w).length) return false;
      const fund = labelsVon(w).length > 0 || w.antwort?.wappen;
      if (fund) return false;

      const zuletzt = new Date(w.versuchtAm || w.gelesenAm || 0).getTime();
      return jetzt - zuletzt >= aelterAlsMs;
    })
    .sort((a, b) => new Date(a.versuchtAm || 0) - new Date(b.versuchtAm || 0));
}

/**
 * Die EINE Wahrheit ueber die Bilder.
 *
 * Vorher gab es drei Zaehler fuer dieselbe Sache: die Zahl der Eintraege
 * (9), einen eigenen Erfolgszaehler im Vorableser (7) und die wirklich
 * gelesenen (6). Alle drei standen im Dashboard, alle drei hiessen "gelesen",
 * und keine zwei stimmten ueberein.
 *
 * Jetzt wird nur noch hier gezaehlt - aus dem, was tatsaechlich gespeichert
 * ist. Zwei Zahlen koennen nicht auseinanderlaufen, wenn es nur eine gibt.
 */
async function zaehlung() {
  const map = await laden();
  const alle = [...map.values()];
  const gelesen = alle.filter((w) => w.antwort).length;

  return {
    gesamt: alle.length,
    gelesen,
    gescheitert: alle.length - gelesen,
  };
}

function zuruecksetzen() {
  speicher = new Map();
}

module.exports = {
  abdruck, alleGelesenen, anzahlGemerkt, erledigteNachrichten, halteFest,
  istEndgueltig, labelsVon, merke, ungeklaerte, zaehlung, zuruecksetzen,
};
