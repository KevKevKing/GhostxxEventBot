const { alleEvents, eventZeit, teilnehmer } = require('./event-history');

// Nachschlagen in den Anmeldungen.
//
// Bis hierher wusste der Bot nur, was gerade offen ist. Wer gefragt hat, wie
// oft er diesen Monat dabei war, bekam nichts - obwohl die Antwort in ueber
// zweitausend archivierten Anmeldungen steht.
//
// Alles hier ist reines Lesen. Es aendert nie etwas, deshalb braucht es auch
// keine Bestaetigung und keine Rechtepruefung ueber das Mitlesen hinaus.

/** Anfang des Zeitraums als Zeitstempel. null heisst "alles". */
function zeitraumStart(zeitraum, now = Date.now()) {
  const jetzt = new Date(now);

  switch (zeitraum) {
    case 'woche':
      return now - 7 * 24 * 60 * 60 * 1000;
    case 'monat':
      // Kalendermonat, nicht "letzte 30 Tage" - wer "diesen Monat" fragt,
      // meint ab dem Ersten.
      return new Date(jetzt.getFullYear(), jetzt.getMonth(), 1).getTime();
    case 'letzter_monat':
      return new Date(jetzt.getFullYear(), jetzt.getMonth() - 1, 1).getTime();
    case 'jahr':
      return new Date(jetzt.getFullYear(), 0, 1).getTime();
    default:
      return null;
  }
}

function zeitraumEnde(zeitraum, now = Date.now()) {
  if (zeitraum !== 'letzter_monat') return now;
  const jetzt = new Date(now);
  return new Date(jetzt.getFullYear(), jetzt.getMonth(), 1).getTime();
}

const ZEITRAUM_TEXT = {
  woche: 'in den letzten 7 Tagen',
  monat: 'diesen Monat',
  letzter_monat: 'letzten Monat',
  jahr: 'dieses Jahr',
};

function zeitraumText(zeitraum) {
  return ZEITRAUM_TEXT[zeitraum] || 'insgesamt';
}

/** Vereinheitlicht Eventnamen: "40er Krieg" und "40er" gehoeren zusammen. */
function eventName(event) {
  return String(event.title || 'Unbenannt').trim();
}

async function gefilterteEvents({ zeitraum = null, event = null, now = Date.now() } = {}) {
  const alle = await alleEvents();
  const von = zeitraumStart(zeitraum, now);
  const bis = zeitraumEnde(zeitraum, now);
  const suche = event ? String(event).toLowerCase() : null;

  return alle.filter((eintrag) => {
    if (suche && !eventName(eintrag).toLowerCase().includes(suche)) return false;
    if (von === null) return true;

    const zeit = eventZeit(eintrag);
    if (zeit === null) return false;
    return zeit >= von && zeit <= bis;
  });
}

/**
 * Wie oft war jemand dabei?
 * Liefert die Gesamtzahl und die Aufschluesselung nach Eventart.
 */
async function teilnahmen(userId, optionen = {}) {
  const events = await gefilterteEvents(optionen);
  const id = String(userId);

  let gesamt = 0;
  const proEvent = new Map();

  for (const event of events) {
    if (!teilnehmer(event).includes(id)) continue;
    gesamt += 1;
    const name = eventName(event);
    proEvent.set(name, (proEvent.get(name) || 0) + 1);
  }

  return {
    userId: id,
    gesamt,
    zeitraum: optionen.zeitraum || null,
    zeitraumText: zeitraumText(optionen.zeitraum),
    proEvent: [...proEvent.entries()]
      .map(([name, anzahl]) => ({ name, anzahl }))
      .sort((a, b) => b.anzahl - a.anzahl || a.name.localeCompare(b.name)),
    // Wieviele Anmeldungen es im Zeitraum ueberhaupt gab - ohne das ist eine
    // Zahl wie "12" nicht einzuordnen.
    moeglich: events.length,
  };
}

/** Die letzten Anmeldungen einer Person, neueste zuerst. */
async function letzteTeilnahmen(userId, anzahl = 5, optionen = {}) {
  const events = await gefilterteEvents(optionen);
  const id = String(userId);

  return events
    .filter((event) => teilnehmer(event).includes(id))
    .map((event) => ({
      name: eventName(event),
      zeit: eventZeit(event),
      ersatz: (event.substitutes || []).includes(id),
    }))
    .filter((eintrag) => eintrag.zeit !== null)
    .sort((a, b) => b.zeit - a.zeit)
    .slice(0, Math.max(1, Math.min(25, anzahl)));
}

/** Wer war bei einer Eventart am haeufigsten dabei? */
async function bestenliste(optionen = {}, limit = 10) {
  const events = await gefilterteEvents(optionen);
  const zaehler = new Map();

  for (const event of events) {
    for (const id of new Set(teilnehmer(event))) {
      zaehler.set(id, (zaehler.get(id) || 0) + 1);
    }
  }

  return {
    events: events.length,
    zeitraumText: zeitraumText(optionen.zeitraum),
    liste: [...zaehler.entries()]
      .map(([userId, anzahl]) => ({ userId, anzahl }))
      .sort((a, b) => b.anzahl - a.anzahl || a.userId.localeCompare(b.userId))
      .slice(0, limit),
  };
}

/** Welche Events gab es, wie gut waren sie besucht? */
async function eventUebersicht(optionen = {}) {
  const events = await gefilterteEvents(optionen);
  const proEvent = new Map();

  for (const event of events) {
    const name = eventName(event);
    const eintrag = proEvent.get(name) || { name, anzahl: 0, anmeldungen: 0, leer: 0 };
    const dabei = teilnehmer(event).length;

    eintrag.anzahl += 1;
    eintrag.anmeldungen += dabei;
    if (!dabei) eintrag.leer += 1;
    proEvent.set(name, eintrag);
  }

  return {
    zeitraumText: zeitraumText(optionen.zeitraum),
    gesamt: events.length,
    liste: [...proEvent.values()]
      .map((eintrag) => ({
        ...eintrag,
        schnitt: eintrag.anzahl ? Math.round((eintrag.anmeldungen / eintrag.anzahl) * 10) / 10 : 0,
      }))
      .sort((a, b) => b.anzahl - a.anzahl || a.name.localeCompare(b.name)),
  };
}

module.exports = {
  bestenliste,
  eventName,
  eventUebersicht,
  gefilterteEvents,
  letzteTeilnahmen,
  teilnahmen,
  zeitraumStart,
  zeitraumText,
};
