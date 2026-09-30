const fs = require('node:fs/promises');
const path = require('node:path');
const { config } = require('./config');
const { writeFileAtomic } = require('./atomic-write');
const { logError } = require('./logger');
const { istAn } = require('./steuerung');
const { starteVorschlagsSession, TABU_MUSTER } = require('./selbstverbesserung-session');
const { aktuellerLauf, bearbeiteProblem: bearbeiteProblemEcht } = require('./selbstverbesserung');
const { istNachtruhe } = require('./selbstverbesserung-limit');

// Ghost darf von sich aus fragen, ob er sich eine Datei anschauen und einen
// Verbesserungsvorschlag machen darf - kein fester Zeitplan, keine
// Tagesobergrenze. Zwei Zustimmungsstufen statt einer schuetzen davor,
// dass daraus unbegrenzt haeufige Claude-Code-Sessions werden: erst "darf
// ich schauen?", dann (nur nach einem Ja) die eigentliche, LESENDE Session.
// Stufe 1 loest nie eine Code-Aenderung aus. Stufe 2 (Kevins "ja" zum
// fertigen Vorschlag) tut das inzwischen sehr wohl - sie ruft dieselbe
// gehaertete Kette wie ein automatisch erkanntes Problem auf
// (bearbeiteProblem() in selbstverbesserung.js: Tabu-Pruefung, Tests,
// eigener Branch, Push, geteiltes 5/Tag-Limit). Siehe docs/superpowers/specs/
// 2026-09-29-code-vorschlaege-design.md und
// 2026-09-30-code-vorschlag-automatische-umsetzung-design.md.

const ANFRAGE_ABSTAND_MS = 3 * 60 * 60 * 1000;
const VERLAUF_MAX = 100;
// Discord-DMs vertragen maximal ~2000 Zeichen - ein user.send() darueber
// wirft. 1800 statt voller 2000 laesst Platz fuer den umgebenden DM-Text
// (Dateiname, Hinweiszeile). Analog zu den .slice(0, N)-Kappungen anderswo
// im Projekt (z.B. message-handler.js MAX_REPLY_LENGTH, handlers.js 1900).
const VORSCHLAG_TEXT_MAX = 1800;
const FEHLER_TEXT_MAX = 1200;
const standDatei = path.join(config.dataDir, 'code-vorschlaege.json');

let dmClient = null;
// Waehrend eine Vorschlags-Session laeuft (bis zu ~20 Min), darf tick() keine
// neue Gate-1-Anfrage verschicken - sonst koennte Kevins spaetes "ja" auf die
// ALTE Anfrage sich auf eine inzwischen laengst neu angefragte Datei beziehen.
// Rein im Speicher (kein Neustart-Schutz noetig): ein Bot-Neustart waehrend
// einer laufenden Session verwirft die Session ohnehin komplett.
let vorschlagLaeuft = false;

function setClient(client) {
  dmClient = client;
}

function laeuftGerade() {
  return vorschlagLaeuft;
}

/**
 * Interpretiert Kevins DM-Antwort. Bewusst nicht `startsWith('ja')`, weil das
 * auch "Januar" oder "Jahreswechsel" als Zustimmung werten wuerde - \b sorgt
 * dafuer, dass nach "ja"/"nein" eine Wortgrenze kommt.
 */
function werteAntwortAus(text) {
  const normalisiert = (text || '').trim().toLowerCase();
  if (/^ja\b/.test(normalisiert)) return 'ja';
  if (/^nein\b/.test(normalisiert)) return 'nein';
  return null;
}

function kuerze(text, max) {
  const wert = String(text || '');
  return wert.length > max ? `${wert.slice(0, max)}… (gekürzt)` : wert;
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
  vorschlagLaeuft = true;
  try {
    const stand = await ladeStand();
    stand.ausstehend = null;
    await speichereStand(stand);

    const ergebnis = await starteSession(dateiPfad);

    if (!ergebnis.ok) {
      await sendeDm(`Hat leider nicht geklappt: ${kuerze(ergebnis.fehler, FEHLER_TEXT_MAX)}`).catch(() => null);
      return;
    }

    await sendeDm(
      `${kuerze(ergebnis.vorschlag, VORSCHLAG_TEXT_MAX)}\n\n_Vorschlag zu ${dateiPfad}_\n\n`
      + 'Antworte mit "ja" oder "nein" - "ja" setzt es um (eigener Branch, zaehlt gegen '
      + 'das 5/Tag-Limit), "nein" verwirft den Vorschlag.',
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
  } finally {
    vorschlagLaeuft = false;
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

/**
 * Kevin hat "ja" zum fertigen Vorschlag (Gate 2) gesagt: das setzt ihn
 * jetzt tatsaechlich um, ueber dieselbe gehaertete Kette wie ein
 * automatisch erkanntes Problem (Tabu-Pfade, Tests, Branch, Push,
 * geteiltes 5/Tag-Limit). Der Vorschlagstext wird dabei zum "Beleg" -
 * bearbeiteProblem() kennt den Unterschied zwischen "Auslöser war ein
 * echter Fehler" und "Auslöser war ein angenommener Vorschlag" nicht,
 * es ist fuer sie einfach ein problem-Objekt. Wirft nie - Aufrufer
 * (message-handler.js) ruft das per .catch(() => null) im Hintergrund auf.
 */
async function setzeVorschlagUm(ausstehend, { bearbeiteProblem = bearbeiteProblemEcht, sendeDm = sendeDmStandard } = {}) {
  try {
    // Vor bearbeiteProblem() pruefen, nicht danach: liegt die Datei in einem
    // Tabu-Bereich, wuerde die echte Session ohnehin per Tabu-Diff-Check in
    // starteSession() blockiert - aber erst NACHDEM sie schon einen Platz vom
    // 5/Tag-Limit verbraucht hat. Hier vorher abfangen kostet keinen Slot.
    if (TABU_MUSTER.some((muster) => ausstehend.datei.startsWith(muster))) {
      await sendeDm(
        `Das liegt in einem Tabu-Bereich (siehe CLAUDE.md), den ich nicht automatisch anfassen darf `
        + `(${ausstehend.datei}) - du müsstest das selbst oder mit Claude Code umsetzen.`,
      ).catch(() => null);
      return;
    }

    await bearbeiteProblem({
      titel: `Vorschlag umsetzen: ${ausstehend.datei}`,
      belege: [{ zeit: ausstehend.gesendetAm, grund: ausstehend.vorschlag }],
    });
  } catch (error) {
    console.error('Code-Vorschlag (Umsetzung) fehlgeschlagen:', error.message);
    logError('Fehler beim Code-Vorschlag (Umsetzung)', error);
  }
}

async function tick() {
  try {
    if (!istAn('selbstverbesserung')) return;
    if (istNachtruhe()) return;
    if (aktuellerLauf().laeuft) return;
    if (vorschlagLaeuft) return;
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
  laeuftGerade,
  naechsteDatei,
  sendeAnfrage,
  setClient,
  setzeVorschlagUm,
  startCodeVorschlag,
  starteUndSendeVorschlag,
  vermerkeAbgelehnteAnfrage,
  vermerkeEntscheidung,
  werteAntwortAus,
};
