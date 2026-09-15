const { listEvents, updateEvent } = require('./storage');
const { EVENT_SLOTS } = require('./schedule-data');
const { normalizeCompact, pickBestMatches, scoreMatch } = require('./text-match');
const { protokolliereVersuch } = require('./beitritts-log');

// Scheduler-IDs haben die Form "<slug>-YYYYMMDDHHMM". Aeltere Eintraege in
// data/events.json haben kein eigenes slug-Feld, deshalb leiten wir es notfalls
// aus der ID ab.
const SCHEDULED_ID_SUFFIX = /-\d{12}$/;

function getEventSlug(event = {}) {
  if (event.slug) return event.slug;
  const id = String(event.id || '');
  if (SCHEDULED_ID_SUFFIX.test(id)) return id.replace(SCHEDULED_ID_SUFFIX, '');
  return '';
}

function getKnownSlugs() {
  return [...new Set(EVENT_SLOTS.map((slot) => slot.slug))];
}

function isDiscordId(input) {
  return /^\d{17,25}$/.test(String(input || '').trim());
}

function extractTimeHint(query) {
  const match = String(query || '').match(/\b(\d{1,2})[:.](\d{2})\b/);
  if (!match) return '';
  return `${String(match[1]).padStart(2, '0')}:${match[2]}`;
}

function eventMatchesTime(event, timeHint) {
  if (!timeHint) return true;
  if (String(event.when || '').includes(timeHint)) return true;

  const startAt = event.startAt ? new Date(event.startAt) : null;
  if (!startAt || Number.isNaN(startAt.getTime())) return false;

  const berlin = new Intl.DateTimeFormat('de-DE', {
    timeZone: 'Europe/Berlin',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(startAt);

  return berlin.replace('.', ':') === timeHint;
}

function scoreEventAgainstQuery(event, query) {
  const slugScore = scoreMatch(getEventSlug(event), query);
  const titleScore = scoreMatch(event.title, query);
  return Math.max(slugScore, titleScore);
}

// Wie lange eine offene Anmeldung ohne closeAt noch als "aktuell" gilt.
// Betrifft nur manuell erstellte Events - geplante schliessen von selbst.
const STALE_OPEN_MS = 12 * 60 * 60 * 1000;

function isLive(event, now) {
  if (event.status !== 'open') return false;

  if (event.closeAt) {
    const closeAt = new Date(event.closeAt).getTime();
    return Number.isNaN(closeAt) || closeAt > now.getTime();
  }

  const created = new Date(event.createdAt || 0).getTime();
  if (Number.isNaN(created) || !created) return false;
  return now.getTime() - created < STALE_OPEN_MS;
}

function sortByRecency(events) {
  return [...events].sort((a, b) => {
    const aTime = new Date(a.startAt || a.createdAt || 0).getTime();
    const bTime = new Date(b.startAt || b.createdAt || 0).getTime();
    return bTime - aTime;
  });
}

/**
 * Loest eine freie Beschreibung wie "40er", "das Bank-Event um 21:30" oder eine
 * rohe Event-/Nachrichten-ID zu genau einem gespeicherten Event auf.
 *
 * Gibt bewusst niemals blind das erstbeste Ergebnis zurueck: bei mehreren
 * gleichwertigen Treffern kommt reason 'ambiguous' plus die Kandidaten, damit
 * der Aufrufer nachfragen kann.
 */
async function resolveEvent(query, options = {}) {
  const { now = new Date(), includeClosed = true } = options;
  const raw = String(query || '').trim();

  if (!raw) return { ok: false, reason: 'empty', candidates: [] };

  const events = await listEvents();

  if (isDiscordId(raw)) {
    const direct = events.find((event) => event.id === raw || event.messageId === raw);
    if (direct) return { ok: true, event: direct };
  }

  const byId = events.find((event) => event.id === raw);
  if (byId) return { ok: true, event: byId };

  const timeHint = extractTimeHint(raw);
  const textQuery = timeHint ? raw.replace(/\b\d{1,2}[:.]\d{2}\b/, ' ').trim() : raw;

  if (!normalizeCompact(textQuery)) return { ok: false, reason: 'empty', candidates: [] };

  const matching = events
    .filter((event) => event.status !== 'cancelled')
    .filter((event) => eventMatchesTime(event, timeHint))
    .map((event) => ({ event, score: scoreEventAgainstQuery(event, textQuery) }))
    .filter((entry) => entry.score > 0);

  if (!matching.length) {
    return { ok: false, reason: 'not_found', candidates: [], knownSlugs: getKnownSlugs() };
  }

  const topScore = Math.max(...matching.map((entry) => entry.score));
  const best = matching.filter((entry) => entry.score === topScore).map((entry) => entry.event);

  // Innerhalb desselben Events (z.B. 24x "40er" pro Tag) ist nicht der Name
  // mehrdeutig, sondern der Zeitpunkt. Aktuell laufende Anmeldungen gewinnen,
  // danach das zuletzt gestartete Event.
  //
  // Wichtig: manuell erstellte Anmeldungen haben kein closeAt und bleiben
  // deshalb dauerhaft auf status 'open'. Ohne die Altersgrenze wuerde eine
  // Karteileiche von vor Monaten das aktuelle Event verdraengen.
  const live = sortByRecency(best.filter((event) => isLive(event, now)));
  if (live.length === 1) return { ok: true, event: live[0] };
  if (live.length > 1) {
    return { ok: false, reason: 'ambiguous', candidates: live.slice(0, 5) };
  }

  if (!includeClosed) {
    return { ok: false, reason: 'no_open_event', candidates: sortByRecency(best).slice(0, 5) };
  }

  const recent = sortByRecency(best);
  const past = recent.filter((event) => new Date(event.startAt || event.createdAt || 0) <= now);
  return { ok: true, event: past[0] || recent[0], closed: true };
}

function readLists(event) {
  return {
    attendees: [...(event.attendees || [])],
    substitutes: [...(event.substitutes || [])],
    maxParticipants: Number(event.maxParticipants || 0),
    maxSubstitutes: Number(event.maxSubstitutes || 0),
  };
}

/**
 * Traegt einen Spieler ein. Reine Datenoperation, kennt kein Discord-Interaction
 * und wird sowohl von /eintragen als auch vom Chat-Router benutzt.
 */
async function addParticipant(eventId, userId, options = {}) {
  const { substitute = false } = options;
  let status = 'unknown';

  const updated = await updateEvent(eventId, (event) => {
    const { attendees, substitutes, maxParticipants, maxSubstitutes } = readLists(event);

    if (attendees.includes(userId) || substitutes.includes(userId)) {
      status = 'already_joined';
      return event;
    }

    if (substitute) {
      if (!maxSubstitutes) {
        status = 'substitutes_disabled';
        return event;
      }

      if (substitutes.length >= maxSubstitutes) {
        status = 'substitute_full';
        return protokolliereVersuch(event, userId, 'zu_spaet');
      }

      status = 'added_substitute';
      return protokolliereVersuch(
        { ...event, attendees, substitutes: [...substitutes, userId] },
        userId,
        'ersatzbank',
      );
    }

    if (maxParticipants && attendees.length >= maxParticipants) {
      status = 'main_full';
      return protokolliereVersuch(event, userId, 'zu_spaet');
    }

    status = 'added_main';
    return protokolliereVersuch(
      { ...event, attendees: [...attendees, userId], substitutes },
      userId,
      'beigetreten',
    );
  });

  if (!updated) return { ok: false, status: 'event_missing', event: null };
  return { ok: status.startsWith('added'), status, event: updated };
}

async function removeParticipant(eventId, userId) {
  let status = 'unknown';

  const updated = await updateEvent(eventId, (event) => {
    const { attendees, substitutes } = readLists(event);
    const isAttendee = attendees.includes(userId);
    const isSubstitute = substitutes.includes(userId);

    if (!isAttendee && !isSubstitute) {
      status = 'not_joined';
      return event;
    }

    status = isSubstitute ? 'removed_substitute' : 'removed_main';
    return {
      ...event,
      attendees: attendees.filter((id) => id !== userId),
      substitutes: substitutes.filter((id) => id !== userId),
    };
  });

  if (!updated) return { ok: false, status: 'event_missing', event: null };
  return { ok: status.startsWith('removed'), status, event: updated };
}

/**
 * Tauscht zwei Spieler in einem Zug. Bewusst NICHT als remove + add gebaut:
 * bei vollen Listen (40er hat 10 Plaetze) wuerde sonst der erste Spieler
 * rausfliegen und der zweite nicht mehr reinpassen.
 *
 * Der neue Spieler landet auf der exakten Listenposition des alten, damit sich
 * die Reihenfolge im Embed nicht durchmischt.
 */
async function swapParticipants(eventId, outUserId, inUserId) {
  let status = 'unknown';

  if (outUserId === inUserId) {
    return { ok: false, status: 'same_user', event: null };
  }

  const updated = await updateEvent(eventId, (event) => {
    const { attendees, substitutes } = readLists(event);
    const outMainIndex = attendees.indexOf(outUserId);
    const outSubIndex = substitutes.indexOf(outUserId);

    if (outMainIndex < 0 && outSubIndex < 0) {
      status = 'out_not_joined';
      return event;
    }

    const inMainIndex = attendees.indexOf(inUserId);
    const inSubIndex = substitutes.indexOf(inUserId);

    // Stehen beide schon in der Anmeldung, aber in verschiedenen Listen, ist
    // "tausche A mit B" ein Platztausch: der Auswechselspieler rueckt hoch, der
    // Teilnehmer geht auf die Bank. Genau das braucht der Meldungskanal, wo
    // staendig zwischen Teilnehmern und Ersatz geschoben wird.
    if (outMainIndex >= 0 && inSubIndex >= 0) {
      const nextAttendees = [...attendees];
      const nextSubstitutes = [...substitutes];
      nextAttendees[outMainIndex] = inUserId;
      nextSubstitutes[inSubIndex] = outUserId;
      status = 'promoted_substitute';
      return { ...event, attendees: nextAttendees, substitutes: nextSubstitutes };
    }

    if (outSubIndex >= 0 && inMainIndex >= 0) {
      const nextAttendees = [...attendees];
      const nextSubstitutes = [...substitutes];
      nextAttendees[inMainIndex] = outUserId;
      nextSubstitutes[outSubIndex] = inUserId;
      status = 'demoted_attendee';
      return { ...event, attendees: nextAttendees, substitutes: nextSubstitutes };
    }

    // Beide in derselben Liste - da gibt es nichts zu tauschen.
    if (inMainIndex >= 0 || inSubIndex >= 0) {
      status = 'in_already_joined';
      return event;
    }

    if (outMainIndex >= 0) {
      const nextAttendees = [...attendees];
      nextAttendees[outMainIndex] = inUserId;
      status = 'swapped_main';
      return { ...event, attendees: nextAttendees, substitutes };
    }

    const nextSubstitutes = [...substitutes];
    nextSubstitutes[outSubIndex] = inUserId;
    status = 'swapped_substitute';
    return { ...event, attendees, substitutes: nextSubstitutes };
  });

  if (!updated) return { ok: false, status: 'event_missing', event: null };

  const successStates = ['swapped_main', 'swapped_substitute', 'promoted_substitute', 'demoted_attendee'];
  return { ok: successStates.includes(status), status, event: updated };
}

const STATUS_MESSAGES = {
  added_main: 'wurde eingetragen',
  added_substitute: 'wurde als Auswechselspieler eingetragen',
  removed_main: 'wurde ausgetragen',
  removed_substitute: 'wurde als Auswechselspieler ausgetragen',
  swapped_main: 'wurde getauscht',
  swapped_substitute: 'wurde bei den Auswechselspielern getauscht',
  promoted_substitute: 'ist vom Auswechselspieler auf den festen Platz gerueckt, der andere auf die Bank',
  demoted_attendee: 'ist auf die Auswechselbank gerueckt, der andere auf den festen Platz',
  already_joined: 'ist bereits eingetragen',
  in_already_joined: 'ist bereits eingetragen',
  not_joined: 'ist in dieser Anmeldung nicht eingetragen',
  out_not_joined: 'ist in dieser Anmeldung nicht eingetragen',
  main_full: 'Die normale Teilnehmerliste ist voll',
  substitute_full: 'Die Auswechselspieler-Liste ist voll',
  substitutes_disabled: 'Diese Anmeldung hat keine Auswechselbank (die gibt es nur bei selbst erstellten und bei staatlichen Meldungen)',
  same_user: 'Das ist zweimal derselbe Spieler',
  event_missing: 'Diese Anmeldung konnte nicht aktualisiert werden',
};

module.exports = {
  STATUS_MESSAGES,
  addParticipant,
  isLive,
  getEventSlug,
  getKnownSlugs,
  removeParticipant,
  resolveEvent,
  swapParticipants,
};
