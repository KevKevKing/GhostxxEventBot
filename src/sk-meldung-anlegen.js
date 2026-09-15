const { config } = require('./config');
const { canManageSignups } = require('./permissions');
const { saveEvent } = require('./storage');
const { baueMeldeFelder, baueStateEvent } = require('./state-event');
const { buildStateSignupComponents, buildStateSignupEmbed } = require('./ui');
const { logBotEvent } = require('./logger');
const {
  ergaenzeOffene, frageNach, merkeOffen, parseSkMeldung, vergissOffen,
} = require('./sk-meldung');

// Aus "wir haben angegriffen um 21:07 gegen Nemesis" wird eine Anmeldung.
//
// Bisher ging das nur ueber /angriff. Wer mitten in der Inkzeit meldet, tippt
// aber einen Satz und kein Formular - und bekam bis jetzt nur die Antwort,
// er solle woanders quatschen.

/** Wer per Nachricht melden darf: dieselben wie bei /angriff. */
async function darfMelden(message) {
  return canManageSignups(message.member || { id: message.author.id });
}

function pingZiel() {
  return config.giveawayPingRoleId
    ? { type: 'role', id: config.giveawayPingRoleId }
    : null;
}

/**
 * Nimmt eine SK-Meldung per Nachricht entgegen.
 *
 * Gibt true zurueck, wenn die Nachricht behandelt wurde - dann laeuft der
 * normale Weg (Umleitung in den Chat, Sprachmodell) nicht mehr weiter.
 */
async function behandleSkMeldung(message, text, { reply, merken }) {
  if (message.channelId !== config.stateChannelId) return false;

  const userId = message.author.id;

  // Erst schauen, ob das die Antwort auf eine Rueckfrage ist ("Nemesis",
  // "21:07"). Sonst wuerde so ein Wort als neue Meldung gelesen - oder gar nicht.
  const meldung = ergaenzeOffene(userId, text) || parseSkMeldung(text);
  if (!meldung) return false;

  if (!(await darfMelden(message))) {
    // Kein stilles Verschlucken: sonst steht da jemand und wartet.
    const antwort = 'Eine SK-Meldung anlegen dürfen nur Turf-Leader und Admins.';
    await reply(message, antwort);
    await merken(antwort);
    return true;
  }

  if (meldung.fehlt.length) {
    merkeOffen(userId, meldung);
    const antwort = frageNach(meldung);
    await reply(message, antwort);
    await merken(antwort);
    return true;
  }

  vergissOffen(userId);

  const ziel = pingZiel();
  const event = baueStateEvent({
    stateType: meldung.art,
    reportFields: baueMeldeFelder({
      stateType: meldung.art,
      gegner: meldung.gegner,
      zeit: meldung.zeit,
    }),
    timeInput: meldung.zeit,
    pingTarget: ziel,
    createdBy: userId,
    channelId: message.channelId,
  });

  const gesendet = await message.channel.send({
    content: ziel ? `<@&${ziel.id}>` : undefined,
    embeds: [buildStateSignupEmbed(event)],
    components: buildStateSignupComponents(event),
    allowedMentions: ziel ? { roles: [ziel.id] } : { parse: [] },
  });

  event.messageId = gesendet.id;
  await saveEvent(event);

  logBotEvent({
    title: meldung.art === 'attack' ? 'Angriff per Nachricht gemeldet' : 'Verteidigung per Nachricht gemeldet',
    description: `${meldung.gegner} um ${meldung.zeit}`,
    color: 'create',
    fields: [{ name: 'Von', value: `<@${userId}>`, inline: true }],
  });

  await merken(`${event.title}: ${meldung.gegner} um ${meldung.zeit}`);
  return true;
}

module.exports = { behandleSkMeldung, darfMelden };
