const { logError } = require('./logger');
const { istAn } = require('./steuerung');
const beobachtungEcht = require('./selbstbeobachtung');
const limitEcht = require('./selbstverbesserung-limit');
const sessionEcht = require('./selbstverbesserung-session');
const benachrichtigungEcht = require('./selbstverbesserung-benachrichtigung');
const gedaechtnisEcht = require('./selbstverbesserung-gedaechtnis');

const TICK_MS = 10 * 60 * 1000;

// Was gerade laeuft - fuers Dashboard, nach dem Vorbild von lauf-stand.js.
// Eine Session dauert bis zu 20 Minuten; ohne diese Anzeige sieht Kevin in
// der ganzen Zeit nichts und weiss nicht, ob ueberhaupt etwas passiert.
let laufendesProblem = null;
let laufSeit = null;

function aktuellerLauf() {
  return {
    laeuft: Boolean(laufendesProblem),
    problem: laufendesProblem,
    seit: laufSeit,
  };
}

/**
 * Eine Runde: verstehen (Beobachter) -> lernen (Gedaechtnis pruefen,
 * Session starten) -> anwenden bleibt bei Kevin (nur Vorschlag+DM).
 *
 * Alle Abhaengigkeiten per Parameter, damit der Test keine echten
 * Prozesse/Discord-Aufrufe braucht.
 */
async function tick({
  beobachten = beobachtungEcht,
  limit = limitEcht,
  session = sessionEcht,
  benachrichtigung = benachrichtigungEcht,
  gedaechtnis = gedaechtnisEcht,
  schalterAn = istAn,
} = {}) {
  // Der Schalter steht standardmaessig auf AUS (siehe steuerung.js). Solange
  // er aus ist, passiert hier gar nichts - auch keine nachgereichten DMs.
  // Kevin schaltet ihn im Dashboard ein, wenn er die drei Handpruefungen
  // aus dem Plan gemacht hat.
  if (!schalterAn('selbstverbesserung')) return;

  await benachrichtigung.sendeAusstehende();

  const problem = (await beobachten.crashSchleifeErkannt()) || (await beobachten.erkenneProblem());
  if (!problem) return;

  const stand = await limit.darfLaufen();
  if (!stand.erlaubt) {
    // Frueher: einfach return. Damit wurde derselbe Fund alle 10 Minuten neu
    // erkannt und lautlos weggeworfen - Kevin erfuhr nie, dass Ghostxx etwas
    // gesehen hat. Jetzt gibt es einen Gedaechtnis-Eintrag (Status 'offen',
    // damit istBekannt() das Nachfragen auf EINMAL begrenzt) und genau eine
    // DM. Gestartet wird nichts, also wird auch kein Lauf vermerkt.
    try {
      const { id } = await gedaechtnis.neuerEintrag(problem);
      const ergebnis = {
        ok: false,
        branch: '',
        zusammenfassung: '',
        fehler: 'Tageslimit erreicht (5/Tag) - nicht automatisch bearbeitet.',
      };
      await gedaechtnis.vermerkeSession(id, ergebnis);
      await benachrichtigung.benachrichtige({ problem, ergebnis });
    } catch (error) {
      console.error('Selbstverbesserung: Tageslimit-Meldung fehlgeschlagen:', error);
      logError('Fehler in der Selbstverbesserungs-Kette', error);
    }
    return;
  }

  // Ab hier haengt am Gedaechtnis-Eintrag (Status 'offen') die 14-Tage-Sperre
  // von istBekannt(): stuerzt irgendein Schritt hier ab, MUSS der Eintrag auf
  // 'ignoriert' gesetzt werden - sonst gilt ein echtes, wiederkehrendes
  // Problem 14 Tage lang lautlos als "schon bekannt" und wird nie wieder
  // gemeldet. 'abgelehnt' waere hier falsch, das blockiert genauso wie
  // 'offen' - es war aber kein echtes Ablehnen, nur ein interner Fehler.
  let id;
  try {
    ({ id } = await gedaechtnis.neuerEintrag(problem));

    // Der VERSUCH zaehlt, nicht der Erfolg - und er zaehlt, bevor er beginnt.
    // Frueher stand das am Ende der Kette: ein dauerhafter Fehler (kaputte
    // JSON-Datei o.ae.) liess damit endlos ungezaehlte 20-Minuten-Sessions
    // alle 10 Minuten laufen, ohne je das Tageslimit zu erreichen. Das ist
    // die richtige Semantik fuer einen Drosselzaehler.
    await limit.vermerkeLauf();

    let ergebnis;
    laufendesProblem = problem.titel;
    laufSeit = Date.now();
    try {
      ergebnis = await session.starteSession(problem);
    } finally {
      // Egal ob Erfolg, Fehler oder Zeitueberschreitung: die Anzeige darf
      // nicht haengen bleiben, sonst behauptet das Dashboard stundenlang
      // einen Lauf, den es nicht mehr gibt.
      laufendesProblem = null;
      laufSeit = null;
    }

    await gedaechtnis.vermerkeSession(id, ergebnis);
    await benachrichtigung.benachrichtige({ problem, ergebnis });
  } catch (error) {
    console.error('Selbstverbesserung-Fehler in der Kette:', error);
    logError('Fehler in der Selbstverbesserungs-Kette', error);
    if (id) {
      await gedaechtnis.vermerkeEntscheidung(id, {
        status: 'ignoriert',
        grund: 'Interner Fehler waehrend der Selbstverbesserung: ' + error.message,
      });
    }
  }
}

function startSelbstverbesserung(client) {
  beobachtungEcht.registriereBeobachtung();
  benachrichtigungEcht.setBenachrichtigungClient(client);

  let laeuft = false;
  async function lauf() {
    // Zweite, unabhaengige Pruefung: tick() prueft den Schalter selbst, aber
    // so wird bei ausgeschaltetem Schalter nicht einmal die Kette betreten.
    if (!istAn('selbstverbesserung')) return;
    if (laeuft) return;
    laeuft = true;
    try {
      await tick();
    } catch (error) {
      console.error('Selbstverbesserung-Fehler:', error);
      logError('Fehler in der Selbstverbesserung', error);
    } finally {
      laeuft = false;
    }
  }

  // Beobachter und DM-Client werden immer angemeldet (das kostet nichts und
  // schreibt nur Fehlerhistorie mit) - gestartet wird aber nur, wenn der
  // Schalter an ist. Das Intervall laeuft trotzdem mit, damit ein spaeteres
  // Einschalten im Dashboard ohne Bot-Neustart greift.
  lauf();
  const interval = setInterval(lauf, TICK_MS);
  console.log(istAn('selbstverbesserung')
    ? 'Selbstverbesserung laeuft.'
    : 'Selbstverbesserung ist ausgeschaltet (Schalter "selbstverbesserung" im Dashboard).');
  return interval;
}

module.exports = {
  aktuellerLauf,
  startSelbstverbesserung,
  tick,
};
