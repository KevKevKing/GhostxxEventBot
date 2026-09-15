const { createEventId } = require('./storage');
const { getStateCloseAt, getStateInkEndAt, parseStateStartedAt } = require('./state-time');

// Wie eine staatliche Meldung aussieht - an einer Stelle.
//
// Es gibt zwei Wege dorthin: /angriff bzw. /verteidigung, und seit heute auch
// eine Nachricht im sk-Kanal ("wir haben angegriffen um 21:07 gegen Nemesis").
// Die Anmeldung selbst muss beide Male dieselbe sein, sonst laufen die zwei
// Wege irgendwann auseinander und niemand merkt es.

const MAX_TEILNEHMER = 10;
const MAX_ERSATZ = 5;

function baueStateEvent({ stateType, reportFields, details = '', timeInput, pingTarget, createdBy, channelId }) {
  const stateStartedAt = parseStateStartedAt(timeInput);
  const stateInkEndAt = getStateInkEndAt(timeInput);

  return {
    id: createEventId(),
    kind: 'state',
    stateType,
    title: stateType === 'attack' ? 'Angriff gemeldet' : 'Verteidigung gemeldet',
    status: 'open',
    reportFields,
    details,
    stateStartedAt: stateStartedAt?.toISOString() || '',
    stateInkEndAt: stateInkEndAt?.toISOString() || '',
    // Mit einem closeAt schliesst der bestehende Scheduler die Meldung von
    // selbst, wenn die Inkzeit vorbei ist. Ohne das blieben sie dauerhaft offen
    // und muellten Speicher und Event-Suche zu.
    closeAt: getStateCloseAt({ stateInkEndAt, createdAt: new Date() }),
    attendees: [],
    substitutes: [],
    beitrittsLog: [],
    maxParticipants: MAX_TEILNEHMER,
    maxSubstitutes: MAX_ERSATZ,
    createdBy,
    createdAt: new Date().toISOString(),
    channelId,
    messageId: '',
    pingTarget,
    pingRoleId: pingTarget?.type === 'role' ? pingTarget.id : '',
    pingUserId: pingTarget?.type === 'user' ? pingTarget.id : '',
  };
}

/** Die zwei Felder, die im Embed ueber der Teilnehmerliste stehen. */
function baueMeldeFelder({ stateType, gegner, zeit }) {
  return [
    {
      name: stateType === 'attack' ? 'Wer wurde angegriffen' : 'Wer hat angegriffen',
      value: gegner,
      inline: true,
    },
    { name: 'Wann wurde angegriffen', value: zeit, inline: true },
  ];
}

module.exports = { MAX_ERSATZ, MAX_TEILNEHMER, baueMeldeFelder, baueStateEvent };
