// Protokolliert jeden Beitrittsversuch zu einer Anmeldung - der Grundstein
// fuer zwei Kevin-Wuensche: die genaue "voll in X Sekunden"-Meldung und die
// Info-Statistik ueber eine Nachricht.
//
// Absichtlich ein eigenes, ANHAENGENDES Protokoll statt die Zeit direkt an
// attendees/substitutes zu haengen: die beiden Listen sind ueberall im Code
// als reine ID-Listen verankert (attendees.includes(id), .filter(id => ...)
// usw.) - das umzubauen haette an zu vielen Stellen gleichzeitig angefasst.
// Ein separates Protokoll kommt dazu, ohne etwas Bestehendes zu veraendern.
//
// Nur der ERSTE Versuch pro Person zaehlt - wiederholtes Klicken auf "schon
// dabei" soll die Statistik nicht mit Duplikaten vollmuellen.

const MAX_EINTRAEGE = 200;

function protokolliereVersuch(event, userId, ergebnis, jetzt = new Date()) {
  const log = event.beitrittsLog || [];
  if (log.some((eintrag) => eintrag.userId === userId)) return event;

  const neu = [...log, { userId, zeit: jetzt.toISOString(), ergebnis }];
  return { ...event, beitrittsLog: neu.slice(-MAX_EINTRAEGE) };
}

/**
 * Der Zeitpunkt, an dem der EXAKT letzte Platz belegt wurde - nicht
 * geschaetzt aus einem Minutentakt, sondern der wirkliche Beitrittszeitpunkt
 * aus dem Protokoll. Gibt es noch keinen vollen Hauptplatz, null.
 */
function vollMoment(event) {
  const max = Number(event.maxParticipants || 0);
  if (!max) return null;

  const beigetreten = (event.beitrittsLog || [])
    .filter((eintrag) => eintrag.ergebnis === 'beigetreten')
    .sort((a, b) => new Date(a.zeit) - new Date(b.zeit));

  if (beigetreten.length < max) return null;
  return beigetreten[max - 1].zeit;
}

const ERGEBNIS_TEXT = {
  beigetreten: '',
  ersatzbank: ' (Auswechselspieler)',
  zu_spaet: ' — leider zu spät',
};

/**
 * Die nummerierte Statistik zu einer Anmeldung - so, wie sie ueber die
 * Nachricht abgerufen wird. Chronologisch, ein Beitrittsversuch pro Zeile.
 */
function baueInfoText(event) {
  const log = event.beitrittsLog || [];
  if (!log.length) return 'Für diese Anmeldung gibt es noch keine Statistik.';

  const start = new Date(event.openAt || event.createdAt || log[0].zeit).getTime();
  const sortiert = [...log].sort((a, b) => new Date(a.zeit) - new Date(b.zeit));

  const zeilen = sortiert.map((eintrag, index) => {
    const vergangenSek = Math.max(0, (new Date(eintrag.zeit).getTime() - start) / 1000);
    const grund = ERGEBNIS_TEXT[eintrag.ergebnis] ?? '';
    return `${index + 1}. <@${eintrag.userId}> mit ${vergangenSek.toFixed(3)} Sekunden${grund}`;
  });

  return zeilen.join('\n');
}

module.exports = { protokolliereVersuch, vollMoment, baueInfoText, MAX_EINTRAEGE };
