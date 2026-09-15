const { EmbedBuilder } = require('discord.js');
const { config } = require('./config');

// Rueckfragen an die Serverleitung im Rueckzugskanal.
//
// Statt oeffentlich zu raten oder eine Anfrage kommentarlos abtropfen zu
// lassen, meldet der Bot hier was er nicht verstanden hat - mit Sprungmarke
// zur Originalnachricht.
//
// Er darf so oft fragen und erwaehnen, wie er will. Die einzige Bremse ist ein
// Schutz gegen Endlosschleifen: dieselbe Frage nicht zweimal in zehn Sekunden.
// Das faengt einen Programmfehler ab, ohne ihn im Alltag einzuschraenken.

const LOOP_GUARD_MS = Number(process.env.ASK_LOOP_GUARD_MS || 10 * 1000);

const recentQuestions = new Map();
let clientRef = null;

function setAskClient(client) {
  clientRef = client;
}

function pruneHistory(now) {
  for (const [key, at] of recentQuestions) {
    if (now - at > LOOP_GUARD_MS) recentQuestions.delete(key);
  }
}

function buildJumpLink(message) {
  if (!message?.guildId || !message.channelId || !message.id) return '';
  return `https://discord.com/channels/${message.guildId}/${message.channelId}/${message.id}`;
}

/**
 * Stellt eine Rueckfrage im Rueckzugskanal.
 *
 * @param {object} options
 * @param {string} options.question  Was der Bot wissen will.
 * @param {string} [options.detail]  Warum er fragt.
 * @param {object} [options.message] Die ausloesende Discord-Nachricht.
 * @param {string} [options.key]     Zum Zusammenfassen gleicher Faelle.
 */
async function askOwner({ question, detail = '', message = null, key = '' }) {
  if (!clientRef || !config.botHomeChannelId || !question) return false;

  const now = Date.now();
  pruneHistory(now);

  const dedupeKey = key || question;
  if (recentQuestions.has(dedupeKey)) return false;
  recentQuestions.set(dedupeKey, now);

  const channel = await clientRef.channels.fetch(config.botHomeChannelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return false;

  const embed = new EmbedBuilder()
    .setColor(0xfee75c)
    .setTitle('Kurze Rückfrage')
    .setDescription(question)
    .setTimestamp(new Date());

  const fields = [];
  if (detail) fields.push({ name: 'Warum ich frage', value: detail.slice(0, 1024) });

  if (message) {
    if (message.author) {
      fields.push({
        name: 'Von',
        value: `<@${message.author.id}>`,
        inline: true,
      });
    }
    if (message.channelId) {
      fields.push({ name: 'Wo', value: `<#${message.channelId}>`, inline: true });
    }
    if (message.content) {
      fields.push({ name: 'Gesagt wurde', value: message.content.slice(0, 1024) });
    }

    const link = buildJumpLink(message);
    if (link) fields.push({ name: 'Hinspringen', value: link });
  }

  if (fields.length) embed.addFields(fields);

  await channel.send({
    content: `<@${config.notifyUserId}>`,
    embeds: [embed],
    allowedMentions: { users: [config.notifyUserId] },
  }).catch((error) => {
    console.error('Rückfrage konnte nicht gesendet werden:', error.message);
  });

  return true;
}

module.exports = {
  askOwner,
  setAskClient,
};
