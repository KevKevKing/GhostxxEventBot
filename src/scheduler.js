const { config } = require('./config');
const { erinnereAnKnappeEvents } = require('./event-erinnerung');
const { sendEventMessage, refreshSignupMessage } = require('./event-message');
const { EVENT_SLOTS } = require('./schedule-data');
const { getStateCloseAt } = require('./state-time');
const { logError } = require('./logger');
const { istAn } = require('./steuerung');
const {
  addDaysToStamp,
  berlinTimeToDate,
  getBerlinDateStamp,
  getWeekdayForDateStamp,
} = require('./time');
const { getEvent, listEvents, saveEvent, updateEvent } = require('./storage');

const TICK_MS = 30 * 1000;

function makeScheduledEventId(slot, dateStamp) {
  return `${slot.slug}-${dateStamp.replaceAll('-', '')}${slot.signupStart.replace(':', '')}`;
}

function makeDateForSlot(dateStamp, time, openAt) {
  const date = berlinTimeToDate(dateStamp, time);
  if (openAt && date < openAt) {
    return berlinTimeToDate(addDaysToStamp(dateStamp, 1), time);
  }

  return date;
}

function buildDailySlots(dateStamp) {
  const weekday = getWeekdayForDateStamp(dateStamp);

  return EVENT_SLOTS.filter((slot) => !slot.days || slot.days.includes(weekday)).map((slot) => {
    const openAt = berlinTimeToDate(dateStamp, slot.signupStart);
    const startAt = makeDateForSlot(dateStamp, slot.start, openAt);
    const closeAt = makeDateForSlot(dateStamp, slot.signupEnd, openAt);
    const inkEndAt = slot.inkEnd ? makeDateForSlot(dateStamp, slot.inkEnd, openAt) : null;

    return {
      ...slot,
      id: makeScheduledEventId(slot, dateStamp),
      dateStamp,
      openAt,
      startAt,
      closeAt,
      inkEndAt,
    };
  });
}

function buildScheduledEvent(slot) {
  return {
    id: slot.id,
    scheduleKey: slot.id,
    slug: slot.slug,
    title: slot.title,
    description: '',
    when: slot.start,
    location: '',
    maxParticipants: slot.maxParticipants,
    status: 'open',
    attendees: [],
    beitrittsLog: [],
    createdBy: 'scheduler',
    createdAt: new Date().toISOString(),
    channelId: config.eventChannelId,
    messageId: '',
    pingTarget: slot.pingRoleId
      ? {
        type: 'role',
        id: slot.pingRoleId,
      }
      : null,
    pingRoleId: slot.pingRoleId,
    openAt: slot.openAt.toISOString(),
    startAt: slot.startAt.toISOString(),
    closeAt: slot.closeAt.toISOString(),
    inkEndAt: slot.inkEndAt?.toISOString() || '',
  };
}

async function openDueEvents(client, now) {
  const today = getBerlinDateStamp(now);
  const yesterday = addDaysToStamp(today, -1);
  const slots = [...buildDailySlots(yesterday), ...buildDailySlots(today)];

  for (const slot of slots) {
    if (now < slot.openAt || now >= slot.closeAt) continue;

    const existing = await getEvent(slot.id);
    if (existing) continue;

    const event = buildScheduledEvent(slot);
    const message = await sendEventMessage(client, event, { ping: true });
    if (!message) {
      console.error(`Event-Channel ${config.eventChannelId} konnte nicht beschrieben werden.`);
      continue;
    }

    event.messageId = message.id;
    await saveEvent(event);
    console.log(`Event geoeffnet: ${event.title} (${event.id})`);
  }
}

/**
 * Wann eine Anmeldung faellig ist.
 *
 * Geplante Events bringen ihr closeAt mit. Staatliche Meldungen bekommen es
 * seit neuestem beim Erstellen - die davor gespeicherten haben keins und
 * wuerden sonst ewig offen bleiben, deshalb wird es hier aus der Inkzeit
 * abgeleitet.
 *
 * Manuell erstellte Events (/event erstellen) haben bewusst kein Ende: die
 * schliesst weiterhin nur ein Mensch.
 */
function getDueTime(event) {
  if (event.closeAt) return new Date(event.closeAt);
  if (event.kind === 'state') return new Date(getStateCloseAt(event));
  return null;
}

async function closeDueEvents(client, now) {
  const events = await listEvents();
  const dueEvents = events.filter((event) => {
    if (event.status !== 'open') return false;
    const due = getDueTime(event);
    return due && !Number.isNaN(due.getTime()) && due <= now;
  });

  for (const event of dueEvents) {
    const updated = await updateEvent(event.id, (stored) => ({
      ...stored,
      status: 'closed',
      // Nachtraeglich festhalten, damit der Eintrag beim naechsten Mal nicht
      // wieder neu berechnet werden muss.
      closeAt: stored.closeAt || getDueTime(stored)?.toISOString() || '',
    }));

    if (!updated) continue;

    // Staatliche Meldungen haben ein eigenes Embed - mit dem normalen Renderer
    // wuerde die Meldung beim Schliessen zerschossen.
    await refreshSignupMessage(client, updated).catch((error) => {
      console.error(`Anmeldung ${updated.id} konnte nicht aktualisiert werden:`, error.message);
    });

    console.log(`Anmeldung geschlossen: ${updated.title} (${updated.id})`);
  }
}

async function runSchedulerTick(client, now = new Date()) {
  if (!istAn('eventScheduler')) return;
  await closeDueEvents(client, now);
  await openDueEvents(client, now);
  // Nach dem Schliessen, damit keine Anmeldung angestupst wird, die gerade
  // ohnehin zugeht.
  await erinnereAnKnappeEvents(client, now.getTime());
}

function startEventScheduler(client) {
  let running = false;

  async function tick() {
    if (running) return;
    running = true;

    try {
      await runSchedulerTick(client);
    } catch (error) {
      console.error('Scheduler-Fehler:', error);
      logError('Fehler in der Event-Schleife', error);
    } finally {
      running = false;
    }
  }

  tick();
  const interval = setInterval(tick, TICK_MS);
  console.log('Event-Scheduler laeuft.');
  return interval;
}

module.exports = {
  buildDailySlots,
  runSchedulerTick,
  startEventScheduler,
};
