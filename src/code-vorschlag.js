const fs = require('node:fs/promises');
const path = require('node:path');
const { config } = require('./config');
const { writeFileAtomic } = require('./atomic-write');
const { logError } = require('./logger');
const { istAn } = require('./steuerung');
const { starteVorschlagsSession } = require('./selbstverbesserung-session');
const { aktuellerLauf } = require('./selbstverbesserung');

// Ghost darf von sich aus fragen, ob er sich eine Datei anschauen und einen
// Verbesserungsvorschlag machen darf - kein fester Zeitplan, keine
// Tagesobergrenze. Zwei Zustimmungsstufen statt einer schuetzen davor,
// dass daraus unbegrenzt haeufige Claude-Code-Sessions werden: erst "darf
// ich schauen?", dann (nur nach einem Ja) die eigentliche Session, dann
// nochmal Zustimmung zum fertigen Vorschlag. Keine der beiden Stufen loest
// jemals eine Code-Aenderung aus - siehe docs/superpowers/specs/
// 2026-09-29-code-vorschlaege-design.md.

const ANFRAGE_ABSTAND_MS = 3 * 60 * 60 * 1000;
const VERLAUF_MAX = 100;
const standDatei = path.join(config.dataDir, 'code-vorschlaege.json');

let dmClient = null;

function setClient(client) {
  dmClient = client;
}

async function ladeStand() {
  try {
    const roh = JSON.parse(await fs.readFile(standDatei, 'utf8'));
    return {
      rotation: roh.rotation || { zuletztVorgeschlagen: null },
      letzteAnfrageAm: roh.letzteAnfrageAm || null,
      ausstehend: roh.ausstehend || null,
      verlauf: Array.isArray(roh.verlauf) ? roh.verlauf : [],
    };
  } catch {
    return { rotation: { zuletztVorgeschlagen: null }, letzteAnfrageAm: null, ausstehend: null, verlauf: [] };
  }
}

async function speichereStand(stand) {
  await fs.mkdir(config.dataDir, { recursive: true });
  await writeFileAtomic(standDatei, JSON.stringify(stand, null, 2));
}

async function listeSrcDateienStandard() {
  const dateien = await fs.readdir(path.join(__dirname));
  return dateien.filter((name) => name.endsWith('.js')).sort();
}

/**
 * Schlaegt vor, welche Datei als Naechstes angefragt wird - reine
 * Rotation, kein Zufall, damit garantiert irgendwann alles einmal
 * drankommt. Das ist nur der Ausgangspunkt der Anfrage-DM: sagt Kevin ja,
 * darf die eigentliche Session danach frei im Repo lesen (siehe
 * baueVorschlagsAufgabe in selbstverbesserung-session.js).
 */
async function naechsteDatei({ listeSrcDateien = listeSrcDateienStandard, zuletztVorgeschlagen } = {}) {
  const dateien = await listeSrcDateien();
  if (!dateien.length) return null;

  let zuletzt = zuletztVorgeschlagen;
  if (zuletzt === undefined) {
    zuletzt = (await ladeStand()).rotation.zuletztVorgeschlagen;
  }

  const index = dateien.indexOf(zuletzt);
  const naechsterIndex = index === -1 ? 0 : (index + 1) % dateien.length;
  return dateien[naechsterIndex];
}

async function darfFragen() {
  const stand = await ladeStand();
  if (stand.ausstehend) return false;
  if (!stand.letzteAnfrageAm) return true;
  return Date.now() - new Date(stand.letzteAnfrageAm).getTime() >= ANFRAGE_ABSTAND_MS;
}

async function holeAusstehend() {
  return (await ladeStand()).ausstehend;
}

async function sendeDmStandard(text) {
  if (!dmClient) throw new Error('Kein Discord-Client gesetzt (setClient() nie aufgerufen?)');
  const user = await dmClient.users.fetch(config.ownerId).catch(() => null);
  if (!user) throw new Error('Owner per DM nicht erreichbar');
  await user.send(text);
}

/**
 * Gate 1: fragt per DM, ob Ghost sich eine Datei anschauen darf. Startet
 * dabei noch KEINE Session - das passiert erst nach Kevins "Ja", siehe
 * starteUndSendeVorschlag().
 */
async function sendeAnfrage({ naechsteDatei: waehleDatei = naechsteDatei, sendeDm = sendeDmStandard } = {}) {
  const dateiName = await waehleDatei();
  if (!dateiName) return null;

  const dateiPfad = `src/${dateiName}`;
  await sendeDm(
    `Ich würde mir gerne ${dateiPfad} anschauen und dir vielleicht einen Verbesserungsvorschlag machen. Ok?\n\n`
    + 'Antworte mit "ja" oder "nein".',
  );

  const stand = await ladeStand();
  stand.rotation = { zuletztVorgeschlagen: dateiName };
  stand.letzteAnfrageAm = new Date().toISOString();
  stand.ausstehend = { art: 'anfrage', datei: dateiPfad, vorschlag: null, gesendetAm: stand.letzteAnfrageAm };
  await speichereStand(stand);
  return dateiPfad;
}

/** Kevin hat "nein" zur Anfrage (Gate 1) gesagt. */
async function vermerkeAbgelehnteAnfrage() {
  const stand = await ladeStand();
  stand.ausstehend = null;
  await speichereStand(stand);
}

/**
 * Kevin hat "ja" zur Anfrage (Gate 1) gesagt: jetzt erst laeuft die
 * eigentliche, lesende Session. Wirft nie - Aufrufer (message-handler.js)
 * ruft das per .catch(() => null) im Hintergrund auf.
 */
async function starteUndSendeVorschlag(dateiPfad, { starteSession = starteVorschlagsSession, sendeDm = sendeDmStandard } = {}) {
  try {
    const stand = await ladeStand();
    stand.ausstehend = null;
    await speichereStand(stand);

    const ergebnis = await starteSession(dateiPfad);

    if (!ergebnis.ok) {
      await sendeDm(`Hat leider nicht geklappt: ${ergebnis.fehler}`).catch(() => null);
      return;
    }

    await sendeDm(
      `${ergebnis.vorschlag}\n\n_Vorschlag zu ${dateiPfad}_\n\n`
      + 'Antworte mit "ja" oder "nein" - "ja" heisst nur "gute Idee, merken", '
      + 'ich aendere dadurch noch nichts automatisch.',
    );

    const standDanach = await ladeStand();
    standDanach.ausstehend = {
      art: 'vorschlag',
      datei: dateiPfad,
      vorschlag: ergebnis.vorschlag,
      gesendetAm: new Date().toISOString(),
    };
    await speichereStand(standDanach);
  } catch (error) {
    console.error('Code-Vorschlag (Session) fehlgeschlagen:', error.message);
    logError('Fehler beim Code-Vorschlag (Session)', error);
  }
}

/** Kevin hat auf den fertigen Vorschlag (Gate 2) geantwortet. */
async function vermerkeEntscheidung(status) {
  const stand = await ladeStand();
  if (!stand.ausstehend) return;
  stand.verlauf.push({ ...stand.ausstehend, status, entschiedenAm: new Date().toISOString() });
  stand.verlauf = stand.verlauf.slice(-VERLAUF_MAX);
  stand.ausstehend = null;
  await speichereStand(stand);
}

async function tick() {
  try {
    if (!istAn('selbstverbesserung')) return;
    if (aktuellerLauf().laeuft) return;
    if (!(await darfFragen())) return;
    await sendeAnfrage();
  } catch (error) {
    console.error('Code-Vorschlag fehlgeschlagen:', error.message);
    logError('Fehler beim Code-Vorschlag', error);
  }
}

function startCodeVorschlag(client) {
  setClient(client);

  let laeuft = false;
  async function lauf() {
    if (laeuft) return;
    laeuft = true;
    try {
      await tick();
    } finally {
      laeuft = false;
    }
  }

  lauf();
  return setInterval(lauf, 10 * 60 * 1000);
}

module.exports = {
  ANFRAGE_ABSTAND_MS,
  darfFragen,
  holeAusstehend,
  naechsteDatei,
  sendeAnfrage,
  setClient,
  startCodeVorschlag,
  starteUndSendeVorschlag,
  vermerkeAbgelehnteAnfrage,
  vermerkeEntscheidung,
};
