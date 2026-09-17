const { EmbedBuilder } = require('discord.js');
const { config } = require('./config');
const { istAn } = require('./steuerung');

// Zwei getrennte Ziele:
//
//   'server' - was auf dem Server passiert: Kicks, Bans, Channel, Rollen,
//              Aenderungen an Anmeldungen. Das liest man nach.
//   'bot'    - was mit dem Bot selbst los ist: Fehler, Aussetzer, Neustarts.
//              Das liest man, wenn etwas nicht funktioniert.
//
// Getrennt, weil sonst ein technischer Fehler zwischen hundert Kick-Meldungen
// untergeht - und umgekehrt.
//
// Discord erlaubt rund 5 Nachrichten pro 5 Sekunden je Kanal. Eine Aufraeum-
// aktion kann dutzende Eintraege auf einmal ausloesen, deshalb laufen alle
// Logs durch eine Warteschlange und werden gebuendelt.

const FLUSH_INTERVAL_MS = 1100;
const MAX_EMBEDS_PER_MESSAGE = 10;
const MAX_QUEUE_LENGTH = 500;

const COLORS = {
  create: 0x57f287,
  update: 0xfee75c,
  delete: 0xed4245,
  danger: 0xed4245,
  info: 0x5865f2,
  dm: 0xeb459e,
  error: 0xed4245,
};

const TARGETS = {
  server: () => config.logChannelId,
  bot: () => config.botLogChannelId || config.logChannelId,
};

const queues = new Map();
let clientRef = null;
let errorListener = null;

/**
 * Wird bei jedem logError() zusaetzlich aufgerufen - fuer Module, die eine
 * eigene, ueber Neustarts hinweg persistierte Fehlerhistorie fuehren wollen
 * (siehe selbstbeobachtung.js). logger.js selbst bleibt bewusst ohne
 * Festplattenzugriff, damit bestehende Tests ohne eigenes Datenverzeichnis
 * weiterlaufen.
 */
function onError(listener) {
  errorListener = listener;
}

function setLogClient(client) {
  clientRef = client;
}

function getQueue(target) {
  if (!queues.has(target)) {
    queues.set(target, { entries: [], timer: null, dropped: 0 });
  }
  return queues.get(target);
}

function truncate(value, max = 1024) {
  const text = String(value ?? '');
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

function buildLogEmbed({ title, description, color = 'info', fields = [], footer }) {
  const embed = new EmbedBuilder()
    .setColor(COLORS[color] ?? COLORS.info)
    .setTitle(truncate(title, 256))
    .setTimestamp(new Date());

  if (description) embed.setDescription(truncate(description, 4000));
  if (footer) embed.setFooter({ text: truncate(footer, 2048) });

  const usable = fields
    .filter((field) => field && field.value !== undefined && field.value !== null && field.value !== '')
    .slice(0, 25)
    .map((field) => ({
      name: truncate(field.name, 256),
      value: truncate(field.value, 1024),
      inline: field.inline ?? false,
    }));

  if (usable.length) embed.addFields(usable);
  return embed;
}

async function resolveChannel(target) {
  const channelId = TARGETS[target]?.();
  if (!clientRef || !channelId) return null;

  const channel = await clientRef.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return null;
  return channel;
}

async function flush(target) {
  const queue = getQueue(target);
  queue.timer = null;
  if (!queue.entries.length) return;

  const batch = queue.entries.splice(0, MAX_EMBEDS_PER_MESSAGE);
  const dropped = queue.dropped;
  queue.dropped = 0;

  const channel = await resolveChannel(target);
  if (!channel) {
    // Ziel nicht erreichbar - lieber verwerfen als volllaufen lassen.
    queue.entries = [];
    return;
  }

  const embeds = batch.map(buildLogEmbed);
  if (dropped > 0) {
    embeds.push(buildLogEmbed({
      title: 'Log-Warteschlange übergelaufen',
      description: `${dropped} Ereignisse wurden verworfen, weil zu viele auf einmal kamen.`,
      color: 'danger',
    }));
  }

  await channel.send({ embeds, allowedMentions: { parse: [] } }).catch((error) => {
    console.error('Log konnte nicht gesendet werden:', error.message);
  });

  if (queue.entries.length) scheduleFlush(target);
}

function scheduleFlush(target) {
  const queue = getQueue(target);
  if (queue.timer) return;

  queue.timer = setTimeout(() => {
    flush(target).catch((error) => console.error('Log-Flush fehlgeschlagen:', error.message));
  }, FLUSH_INTERVAL_MS);
  queue.timer.unref?.();
}

/** Serveraktivitaet. Standardziel. */
function logEvent(entry) {
  if (!entry?.title) return;

  const ziel = TARGETS[entry.target] ? entry.target : 'server';
  if (ziel === 'bot' && !istAn('botLog')) return;

  // Fuers Dashboard mitschreiben, bevor die Warteschlange etwas verwerfen kann.
  merkeAktivitaet(entry);

  const target = ziel;
  const queue = getQueue(target);

  if (queue.entries.length >= MAX_QUEUE_LENGTH) {
    queue.dropped += 1;
    return;
  }

  queue.entries.push(entry);
  scheduleFlush(target);
}

/**
 * Technische Meldung ueber den Bot selbst.
 * Landet im Bot-Log, nicht zwischen den Serverereignissen.
 */
function logBotEvent(entry) {
  logEvent({ ...entry, target: 'bot' });
}

// Die letzten Fehler auch im Arbeitsspeicher behalten.
//
// Bisher landeten sie nur im Log-Kanal, wo sie zwischen hundert anderen
// Meldungen untergehen. Das Dashboard zeigt sie oben - dort sieht man sofort,
// ob in den letzten Stunden etwas schiefging.
const FEHLER_SPEICHER = 25;
const fehler = [];

function letzteFehler() {
  return [...fehler].reverse();
}

// Und alles, was er in Discord tut - Anmeldungen, Taeusche, aufgeraeumte
// Tickets, geschlossene Events. Steht sonst nur im Log-Kanal, wo man scrollen
// muss und zwischen Beitritten und Sprachkanal-Wechseln sucht.
const AKTIVITAET_SPEICHER = 60;
const aktivitaet = [];

function letzteAktivitaet() {
  return [...aktivitaet].reverse();
}

function merkeAktivitaet(entry) {
  aktivitaet.push({
    zeit: new Date().toISOString(),
    titel: entry.title,
    farbe: entry.color || 'info',
    // Die Felder sind das Interessante: wer, was, welches Event.
    text: (entry.fields || [])
      .filter((f) => f?.name && f?.value)
      .map((f) => `${f.name}: ${String(f.value).replace(/\n/g, ' ')}`)
      .join(' · ')
      .slice(0, 260) || String(entry.description || '').replace(/\n/g, ' ').slice(0, 260),
  });
  if (aktivitaet.length > AKTIVITAET_SPEICHER) aktivitaet.shift();
}

/** Fehler mit Ursache - so wie er auch in der Konsole steht. */
function logError(title, error, extra = {}) {
  const detail = error?.stack || error?.message || String(error || '');

  fehler.push({
    zeit: new Date().toISOString(),
    titel: title,
    grund: String(detail).split('\n')[0].slice(0, 200),
  });
  if (fehler.length > FEHLER_SPEICHER) fehler.shift();

  errorListener?.({ zeit: fehler[fehler.length - 1].zeit, titel: title, grund: fehler[fehler.length - 1].grund });

  if (!istAn('fehlerLog')) return;

  logBotEvent({
    title,
    color: 'error',
    description: extra.description,
    fields: [
      ...(extra.fields || []),
      { name: 'Fehler', value: `\`\`\`${truncate(detail, 900)}\`\`\`` },
    ],
  });
}

module.exports = {
  COLORS,
  letzteAktivitaet,
  letzteFehler,
  logBotEvent,
  logError,
  logEvent,
  onError,
  setLogClient,
  truncate,
};
