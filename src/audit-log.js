const { AuditLogEvent, Events } = require('discord.js');
const { config } = require('./config');
const { logEvent, truncate } = require('./logger');
const { istAn } = require('./steuerung');

// Bewusst ueber guildAuditLogEntryCreate statt ueber guildMemberUpdate /
// guildMemberRemove: der Audit-Log liefert Kicks, Bans, Rollen- und
// Channel-Aenderungen inklusive Verursacher und Grund, und braucht dafuer nur
// das nicht-privilegierte GuildModeration-Intent.
const ACTIONS = {
  [AuditLogEvent.ChannelCreate]: { title: 'Channel erstellt', color: 'create', target: 'channel' },
  [AuditLogEvent.ChannelUpdate]: { title: 'Channel bearbeitet', color: 'update', target: 'channel' },
  [AuditLogEvent.ChannelDelete]: { title: 'Channel gelöscht', color: 'delete', target: 'channel' },
  [AuditLogEvent.ChannelOverwriteCreate]: { title: 'Channel-Rechte gesetzt', color: 'update', target: 'channel' },
  [AuditLogEvent.ChannelOverwriteUpdate]: { title: 'Channel-Rechte geändert', color: 'update', target: 'channel' },
  [AuditLogEvent.ChannelOverwriteDelete]: { title: 'Channel-Rechte entfernt', color: 'update', target: 'channel' },

  [AuditLogEvent.MemberKick]: { title: 'Member gekickt', color: 'danger', target: 'user' },
  [AuditLogEvent.MemberBanAdd]: { title: 'Member gebannt', color: 'danger', target: 'user' },
  [AuditLogEvent.MemberBanRemove]: { title: 'Bann aufgehoben', color: 'create', target: 'user' },
  [AuditLogEvent.MemberUpdate]: { title: 'Member bearbeitet', color: 'update', target: 'user' },
  [AuditLogEvent.MemberRoleUpdate]: { title: 'Rollen geändert', color: 'update', target: 'user' },
  [AuditLogEvent.MemberMove]: { title: 'Member verschoben', color: 'update', target: 'user' },
  [AuditLogEvent.MemberDisconnect]: { title: 'Member aus Sprachkanal getrennt', color: 'update', target: 'user' },

  [AuditLogEvent.RoleCreate]: { title: 'Rolle erstellt', color: 'create', target: 'role' },
  [AuditLogEvent.RoleUpdate]: { title: 'Rolle bearbeitet', color: 'update', target: 'role' },
  [AuditLogEvent.RoleDelete]: { title: 'Rolle gelöscht', color: 'delete', target: 'role' },

  [AuditLogEvent.MessageDelete]: { title: 'Nachricht gelöscht', color: 'delete', target: 'user' },
  [AuditLogEvent.MessageBulkDelete]: { title: 'Nachrichten massenhaft gelöscht', color: 'delete', target: 'channel' },
  [AuditLogEvent.MessagePin]: { title: 'Nachricht angepinnt', color: 'info', target: 'user' },
  [AuditLogEvent.MessageUnpin]: { title: 'Nachricht losgelöst', color: 'info', target: 'user' },

  [AuditLogEvent.GuildUpdate]: { title: 'Servereinstellungen geändert', color: 'update', target: 'none' },
  [AuditLogEvent.EmojiCreate]: { title: 'Emoji erstellt', color: 'create', target: 'none' },
  [AuditLogEvent.EmojiDelete]: { title: 'Emoji gelöscht', color: 'delete', target: 'none' },
  [AuditLogEvent.InviteCreate]: { title: 'Einladung erstellt', color: 'info', target: 'none' },
  [AuditLogEvent.InviteDelete]: { title: 'Einladung gelöscht', color: 'info', target: 'none' },
  [AuditLogEvent.WebhookCreate]: { title: 'Webhook erstellt', color: 'update', target: 'none' },
  [AuditLogEvent.WebhookDelete]: { title: 'Webhook gelöscht', color: 'update', target: 'none' },
  [AuditLogEvent.BotAdd]: { title: 'Bot hinzugefügt', color: 'danger', target: 'user' },
};

// Rohe Rechte-Bitmasken und Farbzahlen sind im Log nur Rauschen.
const NOISY_KEYS = new Set(['permissions', 'permissions_new', 'allow', 'allow_new', 'deny', 'deny_new']);

function formatValue(key, value) {
  if (value === null || value === undefined || value === '') return '—';
  if (Array.isArray(value)) {
    if (!value.length) return '—';
    return value.map((item) => (item?.name ? item.name : String(item?.id ?? item))).join(', ');
  }
  if (typeof value === 'boolean') return value ? 'ja' : 'nein';
  if (key === 'color' && typeof value === 'number') return `#${value.toString(16).padStart(6, '0')}`;
  return String(value);
}

function formatChanges(changes = []) {
  const lines = [];

  for (const change of changes) {
    if (NOISY_KEYS.has(change.key)) {
      lines.push(`\`${change.key}\`: geändert`);
      continue;
    }

    const before = formatValue(change.key, change.old);
    const after = formatValue(change.key, change.new);
    if (before === after) continue;

    lines.push(`\`${change.key}\`: ${truncate(before, 120)} → ${truncate(after, 120)}`);
  }

  return lines.slice(0, 12).join('\n');
}

function describeTarget(entry, kind) {
  const target = entry.target;

  if (kind === 'user') {
    const id = target?.id || entry.targetId;
    if (!id) return '';
    const tag = target?.tag || target?.username || '';
    return tag ? `<@${id}> (${tag})` : `<@${id}>`;
  }

  if (kind === 'channel') {
    const id = target?.id || entry.targetId;
    if (!id) return '';
    return target?.name ? `<#${id}> (${target.name})` : `<#${id}>`;
  }

  if (kind === 'role') {
    const id = target?.id || entry.targetId;
    if (!id) return '';
    return target?.name ? `<@&${id}> (${target.name})` : `<@&${id}>`;
  }

  return target?.name ? String(target.name) : '';
}

function handleAuditEntry(entry, guild) {
  if (!istAn('auditLog')) return;
  if (guild?.id !== config.guildId) return;

  const mapping = ACTIONS[entry.action];
  if (!mapping) return;

  const executor = entry.executor;
  const executorText = executor
    ? `<@${executor.id}> (${executor.tag || executor.username})`
    : 'Unbekannt';

  const fields = [
    { name: 'Ausgeführt von', value: executorText, inline: true },
  ];

  const targetText = describeTarget(entry, mapping.target);
  if (targetText) fields.push({ name: 'Betroffen', value: targetText, inline: true });

  if (entry.reason) fields.push({ name: 'Grund', value: entry.reason });

  const changes = formatChanges(entry.changes);
  if (changes) fields.push({ name: 'Änderungen', value: changes });

  if (entry.extra?.count) {
    fields.push({ name: 'Anzahl', value: String(entry.extra.count), inline: true });
  }

  logEvent({
    title: mapping.title,
    color: mapping.color,
    fields,
    footer: `Audit-Log-ID ${entry.id}`,
  });
}

function registerAuditLog(client) {
  client.on(Events.GuildAuditLogEntryCreate, (entry, guild) => {
    try {
      handleAuditEntry(entry, guild);
    } catch (error) {
      console.error('Audit-Log-Fehler:', error.message);
    }
  });

  console.log('Audit-Logging aktiv.');
}

module.exports = {
  ACTIONS,
  formatChanges,
  registerAuditLog,
};
