const { AuditLogEvent } = require('discord.js');
const { check, finish, section } = require('./lib');
const { config } = require('../src/config');
const { logBotEvent, logError, logEvent, setLogClient } = require('../src/logger');
const { ACTIONS, formatChanges } = require('../src/audit-log');

section('Abgedeckte Server-Ereignisse');
const wichtig = {
  'Channel erstellt': AuditLogEvent.ChannelCreate,
  'Channel bearbeitet': AuditLogEvent.ChannelUpdate,
  'Channel geloescht': AuditLogEvent.ChannelDelete,
  'Member gekickt': AuditLogEvent.MemberKick,
  'Member gebannt': AuditLogEvent.MemberBanAdd,
  'Member bearbeitet': AuditLogEvent.MemberUpdate,
  'Rollen geaendert': AuditLogEvent.MemberRoleUpdate,
  'Nachricht geloescht': AuditLogEvent.MessageDelete,
};
for (const [label, id] of Object.entries(wichtig)) {
  check(label, Boolean(ACTIONS[id]));
}

section('Aenderungen lesbar machen');
const changes = formatChanges([
  { key: 'name', old: 'alt', new: 'neu' },
  { key: 'nsfw', old: false, new: true },
  { key: 'permissions', old: '0', new: '8' },
  { key: 'topic', old: 'x', new: 'x' },
  { key: 'color', old: 0, new: 0x8b5cf6 },
  { key: '$add', old: null, new: [{ id: '1', name: 'Moderator' }] },
]);
check('Umbenennung sichtbar', changes.includes('alt → neu'));
check('Boolean lesbar', changes.includes('nsfw`: nein → ja'));
// Rohe Bitmasken sind im Log nur Rauschen.
check('Rechtemaske entrauscht', changes.includes('permissions`: geändert'));
check('Unveraendertes gefiltert', !changes.includes('topic'));
check('Farbe als Hex', changes.includes('#8b5cf6'));
check('Rollenname statt ID', changes.includes('Moderator'));

// Nach Kanal getrennt mitschreiben.
const proKanal = new Map();
setLogClient({
  channels: {
    fetch: async (id) => ({
      isTextBased: () => true,
      send: async (p) => {
        if (!proKanal.has(id)) proKanal.set(id, []);
        proKanal.get(id).push(p);
      },
    }),
  },
});

const serverKanal = () => proKanal.get(config.logChannelId) || [];
const botKanal = () => proKanal.get(config.botLogChannelId) || [];

section('Ansturm wird gebuendelt');
// Eine Aufraeumaktion im Server kann dutzende Eintraege auf einmal ausloesen.
// Einzeln gesendet liefe das sofort ins Discord-Ratelimit.
for (let i = 0; i < 25; i += 1) logEvent({ title: `Ereignis ${i}`, color: 'info' });

// Technisches soll nicht zwischen den Serverereignissen landen.
logBotEvent({ title: 'Bot gestartet', color: 'create' });
logError('Etwas ging schief', new Error('Testfehler mit Ursache'));

setTimeout(() => {
  const server = serverKanal();
  const bot = botKanal();
  const embeds = server.reduce((n, p) => n + p.embeds.length, 0);

  check(`25 Ereignisse -> ${server.length} Nachrichten`, server.length < 25);
  check('hoechstens 10 Embeds pro Nachricht', server.every((p) => p.embeds.length <= 10));
  check('nichts verloren', embeds === 25, `${embeds} statt 25`);
  check('Logs pingen niemanden', server.every((p) => p.allowedMentions?.parse?.length === 0));

  section('Getrennte Kanaele');
  check('Serverkanal bekam nur Serverereignisse', embeds === 25);
  check('Botkanal bekam die technischen', bot.length > 0);
  const botEmbeds = bot.flatMap((p) => p.embeds.map((e) => e.data));
  check('  Startmeldung dabei', botEmbeds.some((e) => e.title === 'Bot gestartet'));
  check('  Fehlermeldung dabei', botEmbeds.some((e) => e.title === 'Etwas ging schief'));
  check('  Fehler zeigt die Ursache', botEmbeds.some((e) => (e.fields || []).some((f) => f.value.includes('Testfehler mit Ursache'))));
  check('  keine Serverereignisse im Botkanal', !botEmbeds.some((e) => (e.title || '').startsWith('Ereignis ')));

  finish();
}, 6000);
