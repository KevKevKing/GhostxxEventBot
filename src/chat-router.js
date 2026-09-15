const { config } = require('./config');
const { listEvents } = require('./storage');
const {
  STATUS_MESSAGES,
  addParticipant,
  getKnownSlugs,
  isLive,
  removeParticipant,
  resolveEvent,
  swapParticipants,
} = require('./event-actions');
const { describeMember, resolveMember } = require('./member-resolver');
const { parseIntent } = require('./intent-parser');
const { refreshSignupMessage } = require('./event-message');
const { canRunChatCommands } = require('./permissions');
const { logError, logEvent } = require('./logger');
const { formatAttendees } = require('./ui');

// Uebersetzt eine erkannte Absicht in eine echte Aenderung.
//
// Das Sprachmodell fasst hier nichts an: es liefert nur eine Absicht, die
// Ausfuehrung laeuft ueber dieselben geprueften Funktionen wie /eintragen und
// /austragen. So kann ein Fehlgriff des Modells nie mehr ausloesen als eine
// Aktion, die es auch per Slash-Command gaebe.

function getKnownEventNames() {
  return [...getKnownSlugs(), '40er', '50er', 'Bank-Event', 'BizWar', 'Gießerei', 'Flugzeugträger', 'RP-Fabrik'];
}

function describeEvent(event) {
  const when = event.startAt
    ? `<t:${Math.floor(new Date(event.startAt).getTime() / 1000)}:t>`
    : (event.when || '');
  return when ? `**${event.title}** (${when})` : `**${event.title}**`;
}

/**
 * Muss vorher nachgefragt werden?
 *
 * Frueher wurde in den Event- und Meldungskanaelen IMMER gefragt. Das hiess:
 * jeder Tausch kostete zwei Klicks, auch der eindeutigste. Dabei ist an dieser
 * Stelle schon alles geklaert - prepareIntent hat Person und Anmeldung
 * aufgeloest und haette bei Unklarheit von sich aus zurueckgefragt.
 *
 * Was bleibt, ist das Modell: es raet die Absicht, und es hat im Test schon
 * eintragen und austragen verwechselt. Da wird weiter gefragt.
 *
 * Statt der Vorab-Frage haengt an jeder ausgefuehrten Aenderung ein
 * Rueckgaengig-Knopf. Gleich ein Klick, aber nur dann, wenn wirklich etwas
 * schiefging - statt jedes Mal.
 */
function needsConfirmation(intent) {
  // Lesende Aktionen sind harmlos.
  if (intent.action === 'list') return false;

  // Nur wenn nicht der Parser, sondern das Modell geraten hat.
  return intent.source !== 'parser';
}

/** Der Plan, der die Aenderung wieder zuruecknimmt. */
function buildUndoPlan(plan, result) {
  if (plan.action === 'swap') {
    return { action: 'swap', eventId: plan.eventId, outId: plan.inId, inId: plan.outId };
  }

  if (plan.action === 'add') {
    return { action: 'remove', eventId: plan.eventId, playerId: plan.playerId };
  }

  // Beim Zuruecknehmen eines Austrags landet die Person hinten in der Liste,
  // nicht auf ihrem alten Platz - die Position ist beim Entfernen weg. Beim
  // Tausch bleibt sie erhalten, der ist positionstreu gebaut.
  return {
    action: 'add',
    eventId: plan.eventId,
    playerId: plan.playerId,
    // Stand die Person auf der Ersatzbank, kommt sie auch dorthin zurueck.
    substitute: result?.status === 'removed_substitute',
  };
}

const SELF_REFERENCES = /^(mich|mir|ich|selbst|me|myself)$/i;

/**
 * Wer steht in dieser Anmeldung? Stammplatz und Ersatzbank zusammen.
 */
function angemeldeteIds(event) {
  return new Set([...(event?.attendees || []), ...(event?.substitutes || [])]);
}

/**
 * Grenzt mehrere Namenstreffer anhand der Anmeldung ein.
 *
 * Gibt nur zurueck, was DANACH eindeutig ist. Bleiben zwei uebrig, wird
 * weiterhin gefragt - lieber einmal nachhaken als den Falschen austragen.
 */
function eingrenzenMitAnmeldung(kandidaten, { angemeldet, erwarte }) {
  if (!angemeldet || !erwarte || !kandidaten?.length) return null;

  const passend = kandidaten.filter((member) =>
    (erwarte === 'drin' ? angemeldet.has(member.id) : !angemeldet.has(member.id)),
  );

  return passend.length === 1 ? passend[0] : null;
}

/**
 * Loest einen Namen zu einem Mitglied auf - und zieht dabei die Anmeldung heran.
 *
 * Der Trick: bei "tausche Ghost und Johannes" ist vorher klar, in welche
 * Richtung es geht. Wer RAUS soll, steht zwangslaeufig in der Liste; wer REIN
 * kommt, steht nicht drin. Passen auf dem Server mehrere Leute zum Namen,
 * entscheidet genau das - unter zehn Angemeldeten ist "Ghost" eindeutig, unter
 * 250 Servermitgliedern nicht.
 *
 * Ohne diesen Hinweis musste er zurueckfragen, obwohl die Antwort vor ihm lag.
 */
async function resolvePerson(guild, value, label, authorId = '', hinweis = {}) {
  if (!value) return { ok: false, text: `Ich habe nicht verstanden, wen du mit "${label}" meinst.` };

  // Gibt das Modell "mich" als Namen zurueck, ist der Schreiber gemeint.
  if (authorId && SELF_REFERENCES.test(String(value).trim())) {
    const self = await guild.members.fetch(authorId).catch(() => null);
    if (self) return { ok: true, member: self };
  }

  const result = await resolveMember(guild, value);
  if (result.ok) return { ok: true, member: result.member };

  if (result.reason === 'ambiguous') {
    // Mehrere Treffer - die Anmeldung entscheidet.
    const eindeutig = eingrenzenMitAnmeldung(result.candidates, hinweis);
    if (eindeutig) return { ok: true, member: eindeutig, viaAnmeldung: true };

    const names = result.candidates.map((m) => `\`${describeMember(m)}\``).join(', ');
    return {
      ok: false,
      text: `Bei "${value}" passen mehrere: ${names}. Nimm bitte eine direkte @Erwähnung.`,
      ask: {
        question: `Wer ist mit "${value}" gemeint?`,
        detail: `Es passen mehrere: ${names}`,
        key: `mehrdeutig:${value}`,
      },
    };
  }

  return {
    ok: false,
    text: `Ich finde niemanden namens "${value}". Nimm bitte eine direkte @Erwähnung.`,
    ask: {
      question: `Wer ist "${value}"?`,
      detail: 'Ich finde niemanden mit dem Namen auf dem Server.',
      key: `unbekannt:${value}`,
    },
  };
}

/**
 * Welche Anmeldung ist gemeint, wenn keine genannt wurde?
 *
 * Reihenfolge nach Eindeutigkeit: die Nachricht, auf die geantwortet wurde,
 * schlaegt den Kanal. Gibt es im Kanal mehr als eine offene Anmeldung, wird
 * nachgefragt statt geraten.
 */
async function resolveEventFromContext({ repliedMessageId, channelId, now = new Date() }) {
  const events = await listEvents();

  if (repliedMessageId) {
    const byReply = events.find((event) => event.messageId === repliedMessageId);
    if (byReply) return { ok: true, event: byReply, via: 'reply' };
  }

  // Nur wirklich aktuelle Anmeldungen. Manuell erstellte bekommen nie ein
  // closeAt und bleiben dauerhaft "offen" - ohne diesen Filter waeren in jedem
  // Kanal dutzende Karteileichen aus Wochen zurueck im Rennen.
  const inChannel = events.filter((event) => event.channelId === channelId && isLive(event, now));

  if (inChannel.length === 1) return { ok: true, event: inChannel[0], via: 'channel' };

  if (inChannel.length > 1) {
    const list = inChannel.slice(0, 5).map((e) => `**${e.title}**`).join(', ');
    return {
      ok: false,
      text: `Welche Anmeldung meinst du? Hier ist offen: ${list}. Sag den Namen dazu oder antworte direkt auf die Anmeldung.`,
      ask: {
        question: 'Welche Anmeldung war gemeint?',
        detail: `Im Kanal sind mehrere offen: ${list}`,
        key: `kanal-mehrdeutig:${channelId}`,
      },
    };
  }

  return {
    ok: false,
    text: 'Welches Event meinst du? Sag den Namen dazu oder antworte direkt auf die Anmeldung.',
    ask: {
      question: 'Auf welche Anmeldung hat sich das bezogen?',
      detail: 'Es wurde kein Event genannt und im Kanal ist gerade keins offen.',
      key: `kein-event:${channelId}`,
    },
  };
}

async function resolveTargetEvent(query) {
  const result = await resolveEvent(query, { now: new Date() });

  if (result.ok) return { ok: true, event: result.event, fromHistory: Boolean(result.closed) };

  if (result.reason === 'ambiguous') {
    const list = result.candidates.map((e) => `**${e.title}** (${e.when || e.id})`).join(', ');
    return {
      ok: false,
      text: `Es passen mehrere Anmeldungen: ${list}. Welche meinst du?`,
      ask: {
        question: `Welche Anmeldung ist mit "${query}" gemeint?`,
        detail: `Es passen mehrere: ${list}`,
        key: `event-mehrdeutig:${query}`,
      },
    };
  }

  if (result.reason === 'not_found') {
    return {
      ok: false,
      text: `Ich finde keine Anmeldung namens "${query}".`,
      ask: {
        question: `Welches Event ist "${query}"?`,
        detail: 'Den Namen kenne ich nicht.',
        key: `event:${query}`,
      },
    };
  }

  return { ok: false, text: 'Ich konnte die Anmeldung nicht zuordnen.' };
}

/**
 * Bereitet eine Absicht vor: loest Event und Personen auf und baut den Text,
 * der entweder direkt bestaetigt oder ausgefuehrt wird.
 */
async function prepareIntent(intent, context) {
  const { guild, member, channelId, repliedMessageId, authorId = member?.id } = context;

  if (intent.action !== 'list') {
    if (!(await canRunChatCommands(member))) {
      return { ok: false, text: 'Du darfst über den Chat keine Anmeldungen ändern. Frag jemanden mit Event-Rechten.' };
    }
  }

  // Ohne genannten Eventnamen ergibt sich die Anmeldung aus der Situation.
  const eventResult = intent.needsEvent
    ? await resolveEventFromContext({ repliedMessageId, channelId })
    : await resolveTargetEvent(intent.event);

  // Die Rueckfrage aus der Aufloesung weiterreichen, damit der Handler sie im
  // Rueckzugskanal stellen kann.
  if (!eventResult.ok) return { ok: false, text: eventResult.text, ask: eventResult.ask };

  const event = eventResult.event;

  if (event.status !== 'open' && intent.action !== 'list') {
    // Beim Rueckgriff auf die Historie ist "geschlossen" missverstaendlich -
    // gemeint war ja das naechste, noch nicht geoeffnete.
    const text = eventResult.fromHistory
      ? `Gerade läuft keine Anmeldung für **${event.title}**. Die letzte (${event.when || '—'}) ist schon zu.`
      : `Die Anmeldung für ${describeEvent(event)} ist bereits geschlossen.`;
    return { ok: false, text };
  }

  if (intent.action === 'list') {
    const lines = [`Teilnehmer für ${describeEvent(event)}:`, formatAttendees(event, 50)];
    if (Number(event.maxSubstitutes || 0) > 0) {
      lines.push('', '**Auswechselspieler**', formatAttendees({ attendees: event.substitutes || [] }, 50));
    }
    return { ok: true, immediate: true, text: lines.join('\n') };
  }

  // Wer gerade in dieser Anmeldung steht. Damit laesst sich ein mehrdeutiger
  // Name aufloesen, ohne zurueckfragen zu muessen.
  const angemeldet = angemeldeteIds(event);

  if (intent.action === 'swap') {
    // Wer rausgeht, steht in der Liste. Wer reinkommt, steht nicht drin.
    const out = await resolvePerson(guild, intent.out, 'raus', authorId, { angemeldet, erwarte: 'drin' });
    if (!out.ok) return { ok: false, text: out.text, ask: out.ask };

    const into = await resolvePerson(guild, intent.in, 'rein', authorId, { angemeldet, erwarte: 'draussen' });
    if (!into.ok) return { ok: false, text: into.text, ask: into.ask };

    return {
      ok: true,
      plan: { action: 'swap', eventId: event.id, outId: out.member.id, inId: into.member.id },
      text: `Tauschen in ${describeEvent(event)}: <@${out.member.id}> raus, <@${into.member.id}> rein.`,
    };
  }

  // Beim Eintragen ist die Person noch draussen, beim Austragen schon drin.
  const player = await resolvePerson(guild, intent.player, 'spieler', authorId, {
    angemeldet,
    erwarte: intent.action === 'remove' ? 'drin' : 'draussen',
  });
  if (!player.ok) return { ok: false, text: player.text, ask: player.ask };

  if (intent.action === 'add') {
    const asSub = Boolean(intent.substitute);
    return {
      ok: true,
      plan: { action: 'add', eventId: event.id, playerId: player.member.id, substitute: asSub },
      text: `Eintragen in ${describeEvent(event)}: <@${player.member.id}>${asSub ? ' als Auswechselspieler' : ''}.`,
    };
  }

  return {
    ok: true,
    plan: { action: 'remove', eventId: event.id, playerId: player.member.id },
    text: `Austragen aus ${describeEvent(event)}: <@${player.member.id}>.`,
  };
}

/**
 * Haelt fest, wer an einer Anmeldung was geaendert hat.
 *
 * Anmeldungen aendern heisst, jemanden von einem Event auszuschliessen.
 * Ohne Protokoll ist "wer hat mich rausgeworfen?" nicht beantwortbar.
 * Selbstanmeldungen ueber die Knoepfe stehen bewusst nicht drin - die sind
 * unstrittig und waeren nur Rauschen.
 */
function logSignupChange({ event, actorId, status, plan, via }) {
  const betroffen = plan.action === 'swap'
    ? `<@${plan.outId}> raus, <@${plan.inId}> rein`
    : `<@${plan.playerId}>`;

  const was = {
    swapped_main: 'Getauscht',
    swapped_substitute: 'Getauscht (Bank)',
    promoted_substitute: 'Von der Bank hochgerückt',
    demoted_attendee: 'Auf die Bank gesetzt',
    added_main: 'Eingetragen',
    added_substitute: 'Als Auswechselspieler eingetragen',
    removed_main: 'Ausgetragen',
    removed_substitute: 'Von der Bank genommen',
  }[status] || 'Geändert';

  logEvent({
    title: `Anmeldung: ${was}`,
    color: plan.action === 'remove' ? 'delete' : 'update',
    fields: [
      { name: 'Event', value: `${event.title}${event.when ? ` (${event.when})` : ''}`, inline: true },
      { name: 'Von', value: actorId ? `<@${actorId}>` : 'unbekannt', inline: true },
      { name: 'Betroffen', value: betroffen },
      { name: 'Wie', value: via === 'chat' ? 'per Chat' : 'per Slash-Command', inline: true },
      { name: 'Jetzt eingetragen', value: `${(event.attendees || []).length}${event.maxParticipants ? `/${event.maxParticipants}` : ''}`, inline: true },
    ],
    footer: `Event-ID ${event.id}`,
  });
}

/** Fuehrt einen vorbereiteten Plan aus. */
async function executePlan(plan, client, context = {}) {
  let result;

  if (plan.action === 'swap') {
    result = await swapParticipants(plan.eventId, plan.outId, plan.inId);
  } else if (plan.action === 'add') {
    result = await addParticipant(plan.eventId, plan.playerId, { substitute: plan.substitute });
  } else {
    result = await removeParticipant(plan.eventId, plan.playerId);
  }

  if (result.ok && result.event) {
    // Fehler hier nicht verschlucken: sonst meldet der Bot "Erledigt", waehrend
    // die Anmeldung sichtbar unveraendert bleibt - genau das ist im Test passiert.
    await refreshSignupMessage(client, result.event).catch((error) => {
      console.error('Anmeldung konnte nicht aktualisiert werden:', error.message);
      logError('Anmeldung konnte nicht aktualisiert werden', error, {
        fields: [{ name: 'Event', value: `${result.event.title} (${result.event.id})` }],
      });
    });

    logSignupChange({
      event: result.event,
      actorId: context.actorId,
      status: result.status,
      plan,
      via: context.via || 'chat',
    });
  }

  const detail = STATUS_MESSAGES[result.status] || 'Das hat nicht geklappt';

  if (!result.ok) {
    return { ok: false, text: `Ging nicht: ${detail}.` };
  }

  // Der Gegenplan haengt am Ergebnis, damit der Aufrufer einen
  // Rueckgaengig-Knopf anbieten kann. Beim Zuruecknehmen selbst entfaellt er,
  // sonst laesst sich endlos hin- und herschalten.
  const undo = context.isUndo ? null : buildUndoPlan(plan, result);

  if (plan.action === 'swap') {
    return { ok: true, undo, text: `Erledigt. <@${plan.outId}> raus, <@${plan.inId}> rein — ${detail}.` };
  }

  return { ok: true, undo, text: `Erledigt. <@${plan.playerId}> ${detail}.` };
}

/** Sucht in einer Nachricht nach einer Absicht - der schnelle, sichere Weg. */
function detectIntent(text, options = {}) {
  return parseIntent(text, {
    knownEvents: getKnownEventNames(),
    hasReply: Boolean(options.hasReply),
    selfId: options.selfId || '',
  });
}

module.exports = {
  buildUndoPlan,
  detectIntent,
  logSignupChange,
  resolveEventFromContext,
  describeEvent,
  executePlan,
  getKnownEventNames,
  needsConfirmation,
  prepareIntent,
};
