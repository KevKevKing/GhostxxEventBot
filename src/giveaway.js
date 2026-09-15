const path = require('node:path');
const { randomInt } = require('node:crypto');
const { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { config } = require('./config');
const {
  createGiveawayId,
  listGiveaways,
  saveGiveaway,
  updateGiveaway,
} = require('./giveaway-storage');
const { berlinTimeToDate, getBerlinDateStamp, toUnixSeconds } = require('./time');
const { logError } = require('./logger');
const { askOwner } = require('./ask-owner');

const TICK_MS = 30 * 1000;
// Nach so vielen erfolglosen Versuchen gilt eine Ziehung als gescheitert.
const MAX_DRAW_ATTEMPTS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;
const START_IMAGE_PATH = path.resolve(__dirname, '..', 'assets', 'giveaway-start.png');
const RESULT_IMAGE_PATH = path.resolve(__dirname, '..', 'assets', 'giveaway-result.png');
const DELIVERED_MARK = '\u2705';

function getGiveawayPingTarget(giveaway = {}) {
  if ('pingTarget' in giveaway) {
    if (!giveaway.pingTarget || giveaway.pingTarget === false) return null;
    if (giveaway.pingTarget.id && ['role', 'user'].includes(giveaway.pingTarget.type)) {
      return {
        type: giveaway.pingTarget.type,
        id: giveaway.pingTarget.id,
      };
    }
  }

  if (giveaway.pingUserId) {
    return {
      type: 'user',
      id: giveaway.pingUserId,
    };
  }

  if ('pingRoleId' in giveaway) {
    return giveaway.pingRoleId
      ? {
        type: 'role',
        id: giveaway.pingRoleId,
      }
      : null;
  }

  return config.giveawayPingRoleId
    ? {
      type: 'role',
      id: config.giveawayPingRoleId,
    }
    : null;
}

function formatPingTarget(target) {
  if (!target?.id) return '';
  return target.type === 'role' ? `<@&${target.id}>` : `<@${target.id}>`;
}

function formatGiveawayEmoji(giveaway) {
  if (giveaway.emojiText) return giveaway.emojiText;
  if (giveaway.emojiId && giveaway.emojiName) {
    return `${giveaway.emojiAnimated ? '<a:' : '<:'}${giveaway.emojiName}:${giveaway.emojiId}>`;
  }
  if (giveaway.emojiName) return `:${giveaway.emojiName}:`;
  return `:${config.giveawayEmojiName}:`;
}

function buildAllowedMentions(giveaway, users = []) {
  const pingTarget = getGiveawayPingTarget(giveaway);
  const userIds = new Set(users);
  if (pingTarget?.type === 'user') userIds.add(pingTarget.id);

  return {
    parse: [],
    roles: pingTarget?.type === 'role' ? [pingTarget.id] : [],
    users: [...userIds],
  };
}

function buildNoMentions() {
  return { parse: [] };
}

function parseGiveawayDrawAt(input, now = new Date()) {
  const text = String(input || '').trim();
  const match = text.match(
    /^(\d{1,2})[.\-/](\d{1,2})(?:[.\-/](\d{2,4}))?\s*(?:um\s*)?(\d{1,2})(?:[:.]?(\d{1,2}))?\s*(?:uhr)?$/i,
  );

  if (!match) return null;

  const berlinNow = getBerlinDateStamp(now).split('-').map(Number);
  const day = Number(match[1]);
  const month = Number(match[2]);
  let year = match[3] ? Number(match[3]) : berlinNow[0];
  const hour = Number(match[4]);
  const minute = match[5] ? Number(match[5]) : 0;

  if (year < 100) year += 2000;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  if (hour < 0 || hour > 23) return null;
  if (minute < 0 || minute > 59) return null;

  const dateStamp = [
    String(year).padStart(4, '0'),
    String(month).padStart(2, '0'),
    String(day).padStart(2, '0'),
  ].join('-');
  const time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  const drawAt = berlinTimeToDate(dateStamp, time);
  const parts = getBerlinDateStamp(drawAt).split('-').map(Number);

  if (parts[0] !== year || parts[1] !== month || parts[2] !== day) return null;
  return drawAt;
}

async function resolveGiveawayEmoji(client, guildId) {
  const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) return null;

  const cachedEmoji = guild.emojis.cache.find((emoji) => emoji.name === config.giveawayEmojiName);
  if (cachedEmoji) return cachedEmoji;

  const emojis = await guild.emojis.fetch().catch(() => null);
  return emojis?.find((emoji) => emoji.name === config.giveawayEmojiName) || null;
}

function buildGiveawayPostContent(giveaway, emojiText) {
  const drawAtUnix = toUnixSeconds(giveaway.drawAt);
  const pingText = formatPingTarget(getGiveawayPingTarget(giveaway));
  const pingLine = pingText ? [pingText, ''] : [];

  return [
    ...pingLine,
    `${emojiText} **Verlosung!** ${emojiText}`,
    '',
    'Gewinne einen von drei tollen Preisen!',
    '',
    '**Teilnahmebedingungen:**',
    `Reagiere mit ${emojiText} auf diesen Beitrag.`,
    '',
    `3 glückliche Gewinner werden <t:${drawAtUnix}:R> zufällig ausgewählt.`,
    '',
    '**Preise:**',
    `1. Platz: ${giveaway.prizes[0]}`,
    `2. Platz: ${giveaway.prizes[1]}`,
    `3. Platz: ${giveaway.prizes[2]}`,
    '',
    `Teilnahmeschluss: <t:${drawAtUnix}:F>`,
  ].join('\n');
}

function getWinnerForPlace(giveaway, place) {
  return (giveaway.winners || []).find((winner) => Number(winner.place) === place) || null;
}

function buildGiveawayResultContent(giveaway) {
  const pingText = formatPingTarget(getGiveawayPingTarget(giveaway));
  const pingLine = pingText ? [pingText, ''] : [];
  const prizeLines = [1, 2, 3].map((place) => {
    const winner = getWinnerForPlace(giveaway, place);
    const prize = winner?.prize || giveaway.prizes[place - 1] || '';
    const userText = winner?.userId ? `<@${winner.userId}>` : 'Kein Gewinner';
    const deliveredText = winner?.deliveredAt ? ` ${DELIVERED_MARK}` : '';
    return `${place}. Platz: ${userText}${deliveredText} - ${prize}`;
  });

  return [
    ...pingLine,
    '**Verlosung beendet!**',
    '',
    'Danke an alle fürs Mitmachen.',
    '',
    '**Die drei Gewinner sind:**',
    ...prizeLines,
    '',
    `Teilnehmer: ${giveaway.participantCount || 0}`,
  ].join('\n');
}

function buildGiveawayResultComponents(giveaway) {
  if (!Array.isArray(giveaway.winners) || !giveaway.winners.length) return [];

  const row = new ActionRowBuilder();
  for (const place of [1, 2, 3]) {
    const winner = getWinnerForPlace(giveaway, place);
    const delivered = Boolean(winner?.deliveredAt);

    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`giveaway_delivery:${giveaway.id}:${place}`)
        .setLabel(`${place}. erhalten`)
        .setStyle(delivered ? ButtonStyle.Success : ButtonStyle.Secondary)
        .setEmoji(DELIVERED_MARK)
        .setDisabled(!winner || delivered),
    );
  }

  return [row];
}

async function createGiveaway(client, options) {
  const emoji = await resolveGiveawayEmoji(client, options.guildId);
  if (!emoji) {
    throw new Error(`Emoji :${config.giveawayEmojiName}: wurde auf dem Server nicht gefunden.`);
  }

  const pingTarget = options.pingTarget === undefined
    ? getGiveawayPingTarget()
    : options.pingTarget;

  const giveaway = {
    id: createGiveawayId(),
    guildId: options.guildId,
    channelId: options.channel.id,
    messageId: '',
    resultMessageId: '',
    status: 'open',
    prizes: [options.prize1, options.prize2, options.prize3],
    drawAt: options.drawAt.toISOString(),
    createdBy: options.createdBy,
    createdAt: new Date().toISOString(),
    emojiName: emoji.name,
    emojiId: emoji.id,
    emojiAnimated: Boolean(emoji.animated),
    emojiText: emoji.toString(),
    pingTarget,
    pingRoleId: pingTarget?.type === 'role' ? pingTarget.id : null,
    pingUserId: pingTarget?.type === 'user' ? pingTarget.id : '',
    winners: [],
    participantCount: 0,
  };

  const message = await options.channel.send({
    content: buildGiveawayPostContent(giveaway, emoji.toString()),
    files: [new AttachmentBuilder(START_IMAGE_PATH, { name: 'verlosung-start.png' })],
    allowedMentions: buildAllowedMentions(giveaway),
  });

  try {
    await message.react(emoji);
  } catch {
    await message.delete().catch(() => null);
    throw new Error(`Der Bot konnte nicht mit :${config.giveawayEmojiName}: reagieren.`);
  }

  giveaway.messageId = message.id;
  await saveGiveaway(giveaway);
  return { giveaway, message };
}

async function fetchGiveawayMessage(client, giveaway) {
  const channel = await client.channels.fetch(giveaway.channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return null;
  return channel.messages.fetch(giveaway.messageId).catch(() => null);
}

async function refreshGiveawayMessage(client, giveaway) {
  const message = await fetchGiveawayMessage(client, giveaway);
  if (!message) return null;

  return message.edit({
    content: buildGiveawayPostContent(giveaway, formatGiveawayEmoji(giveaway)),
    allowedMentions: buildAllowedMentions(giveaway),
  });
}

async function fetchGiveawayResultMessage(client, giveaway) {
  if (!giveaway.channelId || !giveaway.resultMessageId) return null;

  const channel = await client.channels.fetch(giveaway.channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return null;

  return channel.messages.fetch(giveaway.resultMessageId).catch(() => null);
}

async function refreshGiveawayResultMessage(client, giveaway) {
  const message = await fetchGiveawayResultMessage(client, giveaway);
  if (!message) return null;

  return message.edit({
    content: buildGiveawayResultContent(giveaway),
    components: buildGiveawayResultComponents(giveaway),
    allowedMentions: buildNoMentions(),
  });
}

function getGiveawayCleanupBase(giveaway) {
  return giveaway.drawnAt || giveaway.failedAt || giveaway.drawAt || giveaway.createdAt || '';
}

function getGiveawayCleanupCutoff(now = new Date()) {
  const cleanupDays = Number.isFinite(config.giveawayCleanupDays)
    ? config.giveawayCleanupDays
    : 3;
  return new Date(now.getTime() - cleanupDays * DAY_MS);
}

function isGiveawayDueForCleanup(giveaway, now = new Date()) {
  if (giveaway.cleanedAt || giveaway.deletedAt) return false;
  if (!['drawn', 'failed'].includes(giveaway.status)) return false;

  const base = getGiveawayCleanupBase(giveaway);
  if (!base) return false;

  const baseDate = new Date(base);
  if (Number.isNaN(baseDate.getTime())) return false;

  return baseDate <= getGiveawayCleanupCutoff(now);
}

async function deleteMessageById(client, channelId, messageId) {
  if (!channelId || !messageId) return 'skipped';

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return 'channel_missing';

  const message = await channel.messages.fetch(messageId).catch(() => null);
  if (!message) return 'message_missing';

  await message.delete().catch(() => null);
  return 'deleted';
}

async function cleanupGiveawayMessages(client, giveaway) {
  const startStatus = await deleteMessageById(client, giveaway.channelId, giveaway.messageId);
  const resultStatus = await deleteMessageById(client, giveaway.channelId, giveaway.resultMessageId);

  return updateGiveaway(giveaway.id, (stored) => ({
    ...stored,
    cleanedAt: new Date().toISOString(),
    cleanupDays: config.giveawayCleanupDays,
    deletedMessages: {
      start: startStatus,
      result: resultStatus,
    },
  }));
}

function findGiveawayReaction(message, giveaway) {
  return message.reactions.cache.find((reaction) => {
    return (
      (giveaway.emojiId && reaction.emoji.id === giveaway.emojiId) ||
      reaction.emoji.name === giveaway.emojiName
    );
  }) || null;
}

async function fetchAllReactionUsers(reaction) {
  const users = new Map();
  let after;

  while (true) {
    const batch = await reaction.users.fetch({ limit: 100, after }).catch(() => null);
    if (!batch?.size) break;

    for (const user of batch.values()) {
      if (!user.bot) users.set(user.id, user);
    }

    if (batch.size < 100) break;
    after = batch.last().id;
  }

  return [...users.values()];
}

function pickWinners(users, count) {
  const pool = [...users];
  const winners = [];

  while (pool.length && winners.length < count) {
    const index = randomInt(pool.length);
    winners.push(pool.splice(index, 1)[0]);
  }

  return winners;
}

async function drawGiveaway(client, giveaway) {
  const message = await fetchGiveawayMessage(client, giveaway);
  if (!message) {
    await updateGiveaway(giveaway.id, (stored) => ({
      ...stored,
      status: 'failed',
      error: 'Verlosungsnachricht wurde nicht gefunden.',
      failedAt: new Date().toISOString(),
    }));
    return;
  }

  const reaction = findGiveawayReaction(message, giveaway);
  const participants = reaction ? await fetchAllReactionUsers(reaction) : [];
  const winners = pickWinners(participants, 3);

  const winnerRecords = winners.map((winner, index) => ({
    place: index + 1,
    userId: winner.id,
    prize: giveaway.prizes[index],
    deliveredAt: '',
    deliveredBy: '',
  }));

  // Erst die Gewinner festschreiben, dann verkuenden.
  //
  // Vorher lief es andersherum: Nachricht raus, danach speichern. Schlug das
  // Speichern fehl, blieb die Verlosung auf "offen" und wurde beim naechsten
  // Durchlauf ERNEUT gezogen - mit anderen Gewinnern und einer zweiten
  // Ergebnisnachricht. Ein Speicherfehler ist heute schon einmal aufgetreten,
  // das Risiko ist also nicht theoretisch.
  const gespeichert = await updateGiveaway(giveaway.id, (stored) => ({
    ...stored,
    status: 'drawn',
    drawnAt: new Date().toISOString(),
    participantCount: participants.length,
    winners: winnerRecords,
  }));

  if (!gespeichert) {
    logError('Verlosung konnte nicht gespeichert werden', new Error('updateGiveaway lieferte nichts'), {
      fields: [{ name: 'Verlosung', value: giveaway.id }],
    });
    return;
  }

  const resultPayload = { ...giveaway, participantCount: participants.length, winners: winnerRecords };

  try {
    const resultMessage = await message.channel.send({
      content: buildGiveawayResultContent(resultPayload),
      files: [new AttachmentBuilder(RESULT_IMAGE_PATH, { name: 'verlosung-gewinner.png' })],
      components: buildGiveawayResultComponents(resultPayload),
      allowedMentions: buildAllowedMentions(resultPayload, winners.map((winner) => winner.id)),
    });

    await updateGiveaway(giveaway.id, (stored) => ({ ...stored, resultMessageId: resultMessage.id }));
  } catch (error) {
    // Die Gewinner stehen fest, nur das Verkuenden ging schief. Nicht neu
    // ziehen - stattdessen melden, damit es von Hand nachgeholt werden kann.
    const liste = winnerRecords.map((w) => `${w.place}. <@${w.userId}> - ${w.prize}`).join('\n') || 'niemand';
    logError('Ergebnis der Verlosung konnte nicht gepostet werden', error, {
      fields: [
        { name: 'Verlosung', value: giveaway.id },
        { name: 'Gewinner stehen fest', value: liste },
      ],
    });
    await askOwner({
      question: 'Ich konnte das Ergebnis einer Verlosung nicht posten.',
      detail: `Die Gewinner stehen aber fest:\n${liste}`,
      key: `verlosung-post:${giveaway.id}`,
    }).catch(() => null);
  }

  // Niemand hat mitgemacht? Das ist fast immer ein technisches Problem -
  // etwa ein entferntes Emoji - und keine leere Teilnahme.
  if (!participants.length) {
    await askOwner({
      question: 'Eine Verlosung hatte keine Teilnehmer.',
      detail: reaction
        ? 'Auf die Nachricht hat niemand reagiert.'
        : 'Ich habe die Reaktion auf der Verlosungsnachricht nicht gefunden - vielleicht wurde das Emoji entfernt.',
      key: `verlosung-leer:${giveaway.id}`,
    }).catch(() => null);
  }
}

async function runGiveawaySchedulerTick(client, now = new Date()) {
  const giveaways = await listGiveaways();
  const dueGiveaways = giveaways.filter((giveaway) => {
    return giveaway.status === 'open' && new Date(giveaway.drawAt) <= now;
  });

  for (const giveaway of dueGiveaways) {
    try {
      await drawGiveaway(client, giveaway);
    } catch (error) {
      // Ohne Zaehler wuerde eine dauerhaft scheiternde Ziehung alle 30 Sekunden
      // neu versuchen - endlos, und jedes Mal mit einer Fehlermeldung.
      const versuche = Number(giveaway.drawAttempts || 0) + 1;
      const aufgeben = versuche >= MAX_DRAW_ATTEMPTS;

      await updateGiveaway(giveaway.id, (stored) => ({
        ...stored,
        drawAttempts: versuche,
        ...(aufgeben ? {
          status: 'failed',
          error: `Ziehung nach ${versuche} Versuchen aufgegeben: ${error.message}`,
          failedAt: new Date().toISOString(),
        } : {}),
      })).catch(() => null);

      logError(`Ziehung fehlgeschlagen (Versuch ${versuche}/${MAX_DRAW_ATTEMPTS})`, error, {
        fields: [{ name: 'Verlosung', value: giveaway.id }],
      });

      if (aufgeben) {
        await askOwner({
          question: 'Eine Verlosung lässt sich nicht ziehen.',
          detail: `Nach ${versuche} Versuchen aufgegeben. Grund: ${error.message}`,
          key: `verlosung-tot:${giveaway.id}`,
        }).catch(() => null);
      }
    }
  }

  await cleanupDueGiveaways(client, now);
}

async function cleanupDueGiveaways(client, now = new Date()) {
  const giveaways = await listGiveaways();
  const dueGiveaways = giveaways.filter((giveaway) => isGiveawayDueForCleanup(giveaway, now));

  for (const giveaway of dueGiveaways) {
    const cleaned = await cleanupGiveawayMessages(client, giveaway);
    console.log(`Verlosung aufgeraeumt: ${cleaned.id}`);
  }

  return dueGiveaways.length;
}

function startGiveawayScheduler(client) {
  let running = false;

  async function tick() {
    if (running) return;
    running = true;

    try {
      await runGiveawaySchedulerTick(client);
    } catch (error) {
      console.error('Verlosungs-Scheduler-Fehler:', error);
      logError('Fehler im Verlosungs-Scheduler', error);
    } finally {
      running = false;
    }
  }

  tick();
  const interval = setInterval(tick, TICK_MS);
  console.log('Verlosungs-Scheduler laeuft.');
  return interval;
}

module.exports = {
  buildGiveawayPostContent,
  buildGiveawayResultComponents,
  buildGiveawayResultContent,
  cleanupDueGiveaways,
  createGiveaway,
  parseGiveawayDrawAt,
  refreshGiveawayMessage,
  refreshGiveawayResultMessage,
  runGiveawaySchedulerTick,
  startGiveawayScheduler,
};
