const { config } = require('./config');
const { buildEventComponents, buildEventEmbed } = require('./ui');

function buildEventPayload(event, options = {}) {
  const { ping = false } = options;
  const pingTarget = getEventPingTarget(event);
  const pingContent = pingTarget ? formatPingTarget(pingTarget) : '';
  const payload = {
    embeds: [buildEventEmbed(event)],
    components: buildEventComponents(event),
    allowedMentions: ping && pingTarget ? buildPingAllowedMentions(pingTarget) : { parse: [] },
  };

  if (ping || options.syncPingContent) {
    payload.content = ping ? pingContent : '';
  }

  return payload;
}

function getEventPingTarget(event = {}) {
  if ('pingTarget' in event) {
    if (!event.pingTarget || event.pingTarget === false) return null;
    if (event.pingTarget.id && ['role', 'user'].includes(event.pingTarget.type)) {
      return {
        type: event.pingTarget.type,
        id: event.pingTarget.id,
      };
    }
  }

  if (event.pingUserId) {
    return {
      type: 'user',
      id: event.pingUserId,
    };
  }

  if ('pingRoleId' in event) {
    return event.pingRoleId
      ? {
        type: 'role',
        id: event.pingRoleId,
      }
      : null;
  }

  return config.eventRoleId
    ? {
      type: 'role',
      id: config.eventRoleId,
    }
    : null;
}

function formatPingTarget(target) {
  if (!target?.id) return '';
  return target.type === 'role' ? `<@&${target.id}>` : `<@${target.id}>`;
}

function buildPingAllowedMentions(target) {
  if (!target?.id) return { parse: [] };

  return {
    parse: [],
    roles: target.type === 'role' ? [target.id] : [],
    users: target.type === 'user' ? [target.id] : [],
  };
}

async function getEventChannel(client, channelId = config.eventChannelId) {
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return null;
  return channel;
}

async function sendEventMessage(client, event, options = {}) {
  const channel = await getEventChannel(client, event.channelId || config.eventChannelId);
  if (!channel) return null;

  return channel.send(buildEventPayload(event, options));
}

async function refreshEventMessage(client, event, options = {}) {
  if (!event.channelId || !event.messageId) return null;

  const channel = await getEventChannel(client, event.channelId);
  if (!channel) return null;

  const message = await channel.messages.fetch(event.messageId).catch(() => null);
  if (!message) return null;

  return message.edit(buildEventPayload(event, options));
}

/**
 * Aktualisiert die Nachricht einer Anmeldung - egal welcher Art.
 *
 * Staatliche Meldungen (kind: 'state') haben ein eigenes Embed mit eigenen
 * Buttons. Wird hier der normale Renderer benutzt, passiert entweder nichts
 * oder die Meldung wird zerschossen. Beide Wege - Slash-Command und Chat -
 * muessen deshalb ueber diese Funktion gehen.
 */
async function refreshSignupMessage(client, event) {
  if (!event?.channelId || !event?.messageId) return null;

  if (event.kind === 'state') {
    const { buildStateSignupComponents, buildStateSignupEmbed } = require('./ui');

    const channel = await client.channels.fetch(event.channelId).catch(() => null);
    if (!channel || !channel.isTextBased()) return null;

    const message = await channel.messages.fetch(event.messageId).catch(() => null);
    if (!message) return null;

    return message.edit({
      embeds: [buildStateSignupEmbed(event)],
      components: buildStateSignupComponents(event),
      allowedMentions: { parse: [] },
    });
  }

  return refreshEventMessage(client, event);
}

module.exports = {
  buildPingAllowedMentions,
  buildEventPayload,
  formatPingTarget,
  getEventPingTarget,
  refreshEventMessage,
  refreshSignupMessage,
  sendEventMessage,
};
