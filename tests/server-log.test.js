const { ChannelType, Events } = require('discord.js');
const { check, finish, section } = require('./lib');
const { config } = require('../src/config');
const { setLogClient } = require('../src/logger');
const { registerServerLog } = require('../src/server-log');

// Der Bot horcht auf Gateway-Ereignisse. Hier wird ein Client nachgebaut,
// die Ereignisse von Hand ausgeloest und geprueft, was im Log landet.

const gesendet = [];
setLogClient({
  channels: {
    fetch: async () => ({ isTextBased: () => true, send: async (p) => gesendet.push(p) }),
  },
});

const handler = new Map();
const fakeClient = {
  on(name, fn) {
    if (!handler.has(name)) handler.set(name, []);
    handler.get(name).push(fn);
  },
};
registerServerLog(fakeClient);

function ausloesen(name, ...args) {
  for (const fn of handler.get(name) || []) fn(...args);
}

async function eintraege() {
  await new Promise((r) => setTimeout(r, 1400));
  const alle = gesendet.flatMap((p) => p.embeds.map((e) => e.data));
  gesendet.length = 0;
  return alle;
}

const GUILD = config.guildId;
const KANAL = '111111111111111111';
const user = { id: '222222222222222222', tag: 'Tester#0001', username: 'Tester' };

function rollenCache(ids) {
  return { cache: new Map(ids.map((id) => [id, { id, name: `Rolle${id}` }])) };
}

(async () => {
  section('Nachricht gelöscht');
  ausloesen(Events.MessageDelete, {
    guildId: GUILD, channelId: KANAL, id: '900', author: user,
    content: 'das war der Inhalt', attachments: new Map(),
  });
  let e = await eintraege();
  check('wird protokolliert', e.some((x) => x.title === 'Nachricht gelöscht'), JSON.stringify(e.map((x) => x.title)));
  const geloescht = e.find((x) => x.title === 'Nachricht gelöscht');
  check('  mit Inhalt', geloescht.fields.some((f) => f.value.includes('das war der Inhalt')));
  check('  mit Kanal', geloescht.fields.some((f) => f.name === 'Kanal'));

  section('Nicht zwischengespeicherte Nachricht');
  ausloesen(Events.MessageDelete, { guildId: GUILD, channelId: KANAL, id: '901', author: null, content: '', attachments: new Map() });
  e = await eintraege();
  check('sagt ehrlich, dass der Inhalt fehlt',
    e[0].fields.some((f) => /nicht im Zwischenspeicher/.test(f.value)));

  section('Nachricht bearbeitet');
  ausloesen(Events.MessageUpdate,
    { content: 'vorher so', guildId: GUILD, channelId: KANAL, id: '902' },
    { content: 'nachher anders', guildId: GUILD, channelId: KANAL, id: '902', author: user });
  e = await eintraege();
  const bearbeitet = e.find((x) => x.title === 'Nachricht bearbeitet');
  check('wird protokolliert', Boolean(bearbeitet));
  check('  zeigt vorher', bearbeitet.fields.some((f) => f.value.includes('vorher so')));
  check('  zeigt nachher', bearbeitet.fields.some((f) => f.value.includes('nachher anders')));
  check('  hat Sprungmarke', bearbeitet.fields.some((f) => f.value.includes('discord.com/channels')));

  section('Unveränderte Bearbeitung wird ignoriert');
  // Discord meldet auch, wenn nur eine Linkvorschau nachgeladen wurde.
  ausloesen(Events.MessageUpdate,
    { content: 'gleich', guildId: GUILD, channelId: KANAL, id: '903' },
    { content: 'gleich', guildId: GUILD, channelId: KANAL, id: '903', author: user });
  e = await eintraege();
  check('kein Eintrag', e.length === 0, JSON.stringify(e.map((x) => x.title)));

  section('Log-Kanal protokolliert sich nicht selbst');
  ausloesen(Events.MessageDelete, {
    guildId: GUILD, channelId: config.logChannelId, id: '904', author: user, content: 'x', attachments: new Map(),
  });
  e = await eintraege();
  check('kein Eintrag', e.length === 0);

  section('Beitreten und Verlassen');
  ausloesen(Events.GuildMemberAdd, {
    guild: { id: GUILD, memberCount: 253 }, user: { ...user, createdTimestamp: Date.now() - 86400000 },
  });
  e = await eintraege();
  check('Beitritt protokolliert', e.some((x) => x.title === 'Server betreten'));

  ausloesen(Events.GuildMemberRemove, {
    guild: { id: GUILD, memberCount: 252 }, user, joinedTimestamp: Date.now() - 86400000,
    roles: rollenCache(['r1']),
  });
  e = await eintraege();
  const weg = e.find((x) => x.title === 'Server verlassen');
  check('Austritt protokolliert', Boolean(weg));
  check('  nennt die alten Rollen', weg.fields.some((f) => /Rolle/.test(f.value)));

  section('Rollen geändert');
  ausloesen(Events.GuildMemberUpdate,
    { guild: { id: GUILD }, user, nickname: 'Alt', roles: rollenCache(['r1', 'r2']), communicationDisabledUntilTimestamp: null },
    { guild: { id: GUILD }, user, nickname: 'Alt', roles: rollenCache(['r2', 'r3']), communicationDisabledUntilTimestamp: null });
  e = await eintraege();
  const rollen = e.find((x) => x.title === 'Rollen geändert');
  check('protokolliert', Boolean(rollen));
  check('  zeigt dazu', rollen.fields.some((f) => f.name === 'Dazu' && f.value.includes('r3')));
  check('  zeigt weg', rollen.fields.some((f) => f.name === 'Weg' && f.value.includes('r1')));

  section('Name geändert');
  ausloesen(Events.GuildMemberUpdate,
    { guild: { id: GUILD }, user, nickname: 'Alter Name', roles: rollenCache([]), communicationDisabledUntilTimestamp: null },
    { guild: { id: GUILD }, user, nickname: 'Neuer Name', roles: rollenCache([]), communicationDisabledUntilTimestamp: null });
  e = await eintraege();
  check('protokolliert', e.some((x) => x.title === 'Name geändert'));

  section('Auszeit');
  const bis = Date.now() + 600000;
  ausloesen(Events.GuildMemberUpdate,
    { guild: { id: GUILD }, user, nickname: null, roles: rollenCache([]), communicationDisabledUntilTimestamp: null },
    { guild: { id: GUILD }, user, nickname: null, roles: rollenCache([]), communicationDisabledUntilTimestamp: bis });
  e = await eintraege();
  check('protokolliert', e.some((x) => x.title === 'Auszeit bekommen'));

  section('Sprachkanal');
  const sprachMember = { user };
  ausloesen(Events.VoiceStateUpdate,
    { guild: { id: GUILD }, channelId: null, member: sprachMember },
    { guild: { id: GUILD }, channelId: KANAL, member: sprachMember });
  e = await eintraege();
  check('Betreten', e.some((x) => x.title === 'Sprachkanal betreten'));

  ausloesen(Events.VoiceStateUpdate,
    { guild: { id: GUILD }, channelId: KANAL, member: sprachMember },
    { guild: { id: GUILD }, channelId: null, member: sprachMember });
  e = await eintraege();
  check('Verlassen', e.some((x) => x.title === 'Sprachkanal verlassen'));

  ausloesen(Events.VoiceStateUpdate,
    { guild: { id: GUILD }, channelId: KANAL, member: sprachMember },
    { guild: { id: GUILD }, channelId: '333', member: sprachMember });
  e = await eintraege();
  check('Wechsel', e.some((x) => x.title === 'Sprachkanal gewechselt'));

  section('Stumm');
  ausloesen(Events.VoiceStateUpdate,
    { guild: { id: GUILD }, channelId: KANAL, member: sprachMember, selfMute: false, selfDeaf: false },
    { guild: { id: GUILD }, channelId: KANAL, member: sprachMember, selfMute: true, selfDeaf: false });
  e = await eintraege();
  check('selbst stummgeschaltet', e.some((x) => x.fields?.some((f) => /Mikro aus/.test(f.value))));

  // Vom Server stumm ist eine Moderationsmassnahme - eigene Meldung.
  ausloesen(Events.VoiceStateUpdate,
    { guild: { id: GUILD }, channelId: KANAL, member: sprachMember, serverMute: false },
    { guild: { id: GUILD }, channelId: KANAL, member: sprachMember, serverMute: true });
  e = await eintraege();
  check('vom Server stummgeschaltet', e.some((x) => x.title === 'Sprachrechte geändert'));

  section('Kanal bearbeitet');
  ausloesen(Events.ChannelUpdate,
    { guild: { id: GUILD }, id: KANAL, name: 'alt-name', type: ChannelType.GuildText, topic: 'altes Thema', nsfw: false, rateLimitPerUser: 0 },
    { guild: { id: GUILD }, id: KANAL, name: 'neu-name', type: ChannelType.GuildText, topic: 'neues Thema', nsfw: true, rateLimitPerUser: 5 });
  e = await eintraege();
  const kanal = e.find((x) => x.title === 'Kanal bearbeitet');
  check('protokolliert', Boolean(kanal));
  const was = kanal.fields.find((f) => f.name === 'Was').value;
  check('  Name', /alt-name → neu-name/.test(was), was);
  check('  Thema', /altes Thema → neues Thema/.test(was));
  check('  NSFW', /NSFW/.test(was));
  check('  Langsamer Modus', /Langsamer Modus/.test(was));

  section('Fremder Server wird ignoriert');
  ausloesen(Events.MessageDelete, { guildId: '999', channelId: KANAL, id: '905', author: user, content: 'x', attachments: new Map() });
  e = await eintraege();
  check('kein Eintrag', e.length === 0);

  finish();
})();
