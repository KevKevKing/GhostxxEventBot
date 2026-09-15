const { ChannelType, Events } = require('discord.js');
const { config } = require('./config');
const { logEvent, truncate } = require('./logger');
const { istAn: schalterAn } = require('./steuerung');

// Direkte Server-Ereignisse.
//
// Der Audit-Log allein reicht nicht: wer seine EIGENE Nachricht loescht oder
// bearbeitet, erzeugt dort gar keinen Eintrag. Auch Beitritte, Austritte und
// alles rund um Sprachkanaele stehen nicht drin. Diese Ereignisse kommen
// stattdessen direkt ueber das Gateway.

// Einzelne Gruppen abschaltbar - Sprachkanaele koennen bei vielen Leuten
// gespraechig werden.
function istAn(gruppe) {
  const schalter = {
    nachrichten: 'logNachrichten',
    mitglieder: 'logMitglieder',
    sprache: 'logSprache',
    selbststumm: 'logSelbststumm',
    kanaele: 'logKanaele',
  }[gruppe];
  if (schalter && !schalterAn(schalter)) return false;
  const aus = (process.env.LOG_AUS || '').split(',').map((x) => x.trim()).filter(Boolean);
  return !aus.includes(gruppe);
}

function messageLink(message) {
  if (!message?.guildId || !message.channelId || !message.id) return '';
  return `https://discord.com/channels/${message.guildId}/${message.channelId}/${message.id}`;
}

function autorFeld(user) {
  if (!user) return 'Unbekannt';
  return `<@${user.id}> (${user.tag || user.username || user.id})`;
}

// Der Log-Kanal selbst wird nicht protokolliert - sonst meldet er sich
// gegenseitig und der Kanal laeuft mit sich selbst voll.
function istLogKanal(channelId) {
  return [config.logChannelId, config.botLogChannelId].includes(channelId);
}

function gehoertZumServer(guildId) {
  return guildId === config.guildId;
}

// --- Nachrichten ------------------------------------------------------------

function registerMessageEvents(client) {
  client.on(Events.MessageDelete, (message) => {
    if (!gehoertZumServer(message.guildId)) return;
    if (istLogKanal(message.channelId)) return;
    if (!istAn('nachrichten')) return;

    const felder = [
      { name: 'Kanal', value: `<#${message.channelId}>`, inline: true },
      { name: 'Von', value: message.author ? autorFeld(message.author) : 'nicht im Zwischenspeicher', inline: true },
    ];

    // Nur was der Bot vorher gesehen hat, liegt noch im Zwischenspeicher.
    if (message.content) {
      felder.push({ name: 'Inhalt', value: truncate(message.content, 1024) });
    } else {
      felder.push({ name: 'Inhalt', value: '*war nicht im Zwischenspeicher — vor dem letzten Neustart geschrieben*' });
    }

    if (message.attachments?.size) {
      felder.push({
        name: 'Anhänge',
        value: [...message.attachments.values()].map((a) => a.name || a.url).join('\n'),
      });
    }

    logEvent({ title: 'Nachricht gelöscht', color: 'delete', fields: felder });
  });

  client.on(Events.MessageUpdate, (alt, neu) => {
    if (!gehoertZumServer(neu.guildId)) return;
    if (istLogKanal(neu.channelId)) return;
    if (!istAn('nachrichten')) return;
    if (neu.author?.bot) return;

    // Discord meldet auch Aenderungen, bei denen der Text gleich bleibt -
    // etwa wenn eine Linkvorschau nachgeladen wird.
    if (alt?.content === neu.content) return;

    logEvent({
      title: 'Nachricht bearbeitet',
      color: 'update',
      fields: [
        { name: 'Kanal', value: `<#${neu.channelId}>`, inline: true },
        { name: 'Von', value: autorFeld(neu.author), inline: true },
        { name: 'Vorher', value: truncate(alt?.content || '*nicht im Zwischenspeicher*', 1024) },
        { name: 'Nachher', value: truncate(neu.content || '*leer*', 1024) },
        { name: 'Hinspringen', value: messageLink(neu) },
      ],
    });
  });

  client.on(Events.MessageBulkDelete, (messages) => {
    const erste = messages.first();
    if (!gehoertZumServer(erste?.guildId)) return;
    if (istLogKanal(erste?.channelId)) return;
    if (!istAn('nachrichten')) return;

    const beispiele = [...messages.values()]
      .filter((m) => m.content)
      .slice(0, 5)
      .map((m) => `${m.author?.username || '?'}: ${truncate(m.content, 80)}`)
      .join('\n');

    logEvent({
      title: `${messages.size} Nachrichten auf einmal gelöscht`,
      color: 'delete',
      fields: [
        { name: 'Kanal', value: `<#${erste?.channelId}>`, inline: true },
        ...(beispiele ? [{ name: 'Beispiele', value: beispiele }] : []),
      ],
    });
  });
}

// --- Mitglieder -------------------------------------------------------------

function registerMemberEvents(client) {
  client.on(Events.GuildMemberAdd, (member) => {
    if (!gehoertZumServer(member.guild?.id)) return;
    if (!istAn('mitglieder')) return;

    const alter = member.user.createdAt
      ? `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`
      : 'unbekannt';

    logEvent({
      title: 'Server betreten',
      color: 'create',
      fields: [
        { name: 'Wer', value: autorFeld(member.user), inline: true },
        { name: 'Account erstellt', value: alter, inline: true },
        { name: 'Mitglieder jetzt', value: String(member.guild.memberCount), inline: true },
      ],
    });
  });

  client.on(Events.GuildMemberRemove, (member) => {
    if (!gehoertZumServer(member.guild?.id)) return;
    if (!istAn('mitglieder')) return;

    const rollen = member.roles?.cache
      ? [...member.roles.cache.values()].filter((r) => r.name !== '@everyone').map((r) => r.name).join(', ')
      : '';

    logEvent({
      title: 'Server verlassen',
      color: 'delete',
      description: 'Ob freiwillig oder rausgeworfen, steht im Audit-Log-Eintrag daneben.',
      fields: [
        { name: 'Wer', value: autorFeld(member.user), inline: true },
        { name: 'Dabei seit', value: member.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>` : 'unbekannt', inline: true },
        { name: 'Mitglieder jetzt', value: String(member.guild.memberCount), inline: true },
        ...(rollen ? [{ name: 'Hatte die Rollen', value: truncate(rollen, 1024) }] : []),
      ],
    });
  });

  client.on(Events.GuildMemberUpdate, (alt, neu) => {
    if (!gehoertZumServer(neu.guild?.id)) return;
    if (!istAn('mitglieder')) return;

    const felder = [{ name: 'Wer', value: autorFeld(neu.user), inline: true }];
    let titel = '';

    if (alt.nickname !== neu.nickname) {
      titel = 'Name geändert';
      felder.push(
        { name: 'Vorher', value: alt.nickname || '*keiner*', inline: true },
        { name: 'Nachher', value: neu.nickname || '*keiner*', inline: true },
      );
    }

    const alteRollen = new Set(alt.roles.cache.keys());
    const neueRollen = new Set(neu.roles.cache.keys());
    const dazu = [...neueRollen].filter((id) => !alteRollen.has(id));
    const weg = [...alteRollen].filter((id) => !neueRollen.has(id));

    if (dazu.length || weg.length) {
      titel = titel || 'Rollen geändert';
      if (dazu.length) felder.push({ name: 'Dazu', value: dazu.map((id) => `<@&${id}>`).join(', ') });
      if (weg.length) felder.push({ name: 'Weg', value: weg.map((id) => `<@&${id}>`).join(', ') });
    }

    if (alt.communicationDisabledUntilTimestamp !== neu.communicationDisabledUntilTimestamp) {
      const bis = neu.communicationDisabledUntilTimestamp;
      titel = bis ? 'Auszeit bekommen' : 'Auszeit aufgehoben';
      if (bis) felder.push({ name: 'Bis', value: `<t:${Math.floor(bis / 1000)}:f>`, inline: true });
    }

    if (!titel) return;

    logEvent({ title: titel, color: 'update', fields: felder });
  });
}

// --- Sprachkanaele ----------------------------------------------------------

function registerVoiceEvents(client) {
  client.on(Events.VoiceStateUpdate, (alt, neu) => {
    const member = neu.member || alt.member;
    if (!gehoertZumServer(neu.guild?.id || alt.guild?.id)) return;
    if (!istAn('sprache')) return;

    const wer = autorFeld(member?.user);

    // Kanal gewechselt, betreten oder verlassen
    if (alt.channelId !== neu.channelId) {
      if (!alt.channelId) {
        logEvent({
          title: 'Sprachkanal betreten',
          color: 'create',
          fields: [{ name: 'Wer', value: wer, inline: true }, { name: 'Kanal', value: `<#${neu.channelId}>`, inline: true }],
        });
      } else if (!neu.channelId) {
        logEvent({
          title: 'Sprachkanal verlassen',
          color: 'delete',
          fields: [{ name: 'Wer', value: wer, inline: true }, { name: 'Kanal', value: `<#${alt.channelId}>`, inline: true }],
        });
      } else {
        logEvent({
          title: 'Sprachkanal gewechselt',
          color: 'update',
          fields: [
            { name: 'Wer', value: wer, inline: true },
            { name: 'Von', value: `<#${alt.channelId}>`, inline: true },
            { name: 'Nach', value: `<#${neu.channelId}>`, inline: true },
          ],
        });
      }
      return;
    }

    // Selbst stumm / Kopfhoerer aus - das macht die Person selbst.
    if (!istAn('selbststumm')) return;

    const aenderungen = [];
    if (alt.selfMute !== neu.selfMute) aenderungen.push(neu.selfMute ? 'Mikro aus' : 'Mikro an');
    if (alt.selfDeaf !== neu.selfDeaf) aenderungen.push(neu.selfDeaf ? 'Kopfhörer aus' : 'Kopfhörer an');
    if (alt.streaming !== neu.streaming) aenderungen.push(neu.streaming ? 'teilt Bildschirm' : 'teilt nicht mehr');

    // Server-stumm ist eine Moderationsmassnahme und wichtiger.
    const vonAussen = [];
    if (alt.serverMute !== neu.serverMute) vonAussen.push(neu.serverMute ? 'vom Server stummgeschaltet' : 'Stummschaltung aufgehoben');
    if (alt.serverDeaf !== neu.serverDeaf) vonAussen.push(neu.serverDeaf ? 'vom Server taubgeschaltet' : 'Taubschaltung aufgehoben');

    if (vonAussen.length) {
      logEvent({
        title: 'Sprachrechte geändert',
        color: 'danger',
        fields: [
          { name: 'Wer', value: wer, inline: true },
          { name: 'Kanal', value: `<#${neu.channelId}>`, inline: true },
          { name: 'Was', value: vonAussen.join(', ') },
        ],
      });
      return;
    }

    if (!aenderungen.length) return;

    logEvent({
      title: 'Mikro / Kopfhörer',
      color: 'info',
      fields: [
        { name: 'Wer', value: wer, inline: true },
        { name: 'Kanal', value: `<#${neu.channelId}>`, inline: true },
        { name: 'Was', value: aenderungen.join(', ') },
      ],
    });
  });
}

// --- Kanaele ----------------------------------------------------------------

const KANAL_ARTEN = {
  [ChannelType.GuildText]: 'Textkanal',
  [ChannelType.GuildVoice]: 'Sprachkanal',
  [ChannelType.GuildCategory]: 'Kategorie',
  [ChannelType.GuildAnnouncement]: 'Ankündigungskanal',
  [ChannelType.GuildStageVoice]: 'Bühne',
  [ChannelType.GuildForum]: 'Forum',
};

function beschreibeKanal(channel) {
  const art = KANAL_ARTEN[channel.type] || 'Kanal';
  return `${art} <#${channel.id}> (${channel.name})`;
}

function registerChannelEvents(client) {
  client.on(Events.ChannelCreate, (channel) => {
    if (!gehoertZumServer(channel.guild?.id)) return;
    if (!istAn('kanaele')) return;

    logEvent({
      title: 'Kanal erstellt',
      color: 'create',
      fields: [
        { name: 'Kanal', value: beschreibeKanal(channel) },
        ...(channel.parent ? [{ name: 'In Kategorie', value: channel.parent.name, inline: true }] : []),
      ],
    });
  });

  client.on(Events.ChannelDelete, (channel) => {
    if (!gehoertZumServer(channel.guild?.id)) return;
    if (!istAn('kanaele')) return;

    logEvent({
      title: 'Kanal gelöscht',
      color: 'delete',
      fields: [
        { name: 'Kanal', value: `${KANAL_ARTEN[channel.type] || 'Kanal'} **${channel.name}**` },
        ...(channel.parent ? [{ name: 'War in Kategorie', value: channel.parent.name, inline: true }] : []),
      ],
    });
  });

  client.on(Events.ChannelUpdate, (alt, neu) => {
    if (!gehoertZumServer(neu.guild?.id)) return;
    if (!istAn('kanaele')) return;

    const aenderungen = [];
    const vergleich = [
      ['Name', alt.name, neu.name],
      ['Thema', alt.topic, neu.topic],
      ['Kategorie', alt.parent?.name, neu.parent?.name],
      ['NSFW', alt.nsfw, neu.nsfw],
      ['Langsamer Modus', alt.rateLimitPerUser, neu.rateLimitPerUser],
      ['Bitrate', alt.bitrate, neu.bitrate],
      ['Nutzerlimit', alt.userLimit, neu.userLimit],
    ];

    for (const [label, vorher, nachher] of vergleich) {
      if (vorher === nachher) continue;
      if (vorher === undefined && nachher === undefined) continue;
      aenderungen.push(`**${label}:** ${truncate(String(vorher ?? '—'), 100)} → ${truncate(String(nachher ?? '—'), 100)}`);
    }

    // Rechteaenderungen einzeln aufzuschluesseln waere unlesbar - der
    // Audit-Log nennt ohnehin, wer es war.
    if (alt.permissionOverwrites?.cache?.size !== neu.permissionOverwrites?.cache?.size) {
      aenderungen.push('**Rechte:** geändert');
    }

    if (!aenderungen.length) return;

    logEvent({
      title: 'Kanal bearbeitet',
      color: 'update',
      fields: [
        { name: 'Kanal', value: beschreibeKanal(neu) },
        { name: 'Was', value: truncate(aenderungen.join('\n'), 1024) },
      ],
    });
  });
}

function registerServerLog(client) {
  registerMessageEvents(client);
  registerMemberEvents(client);
  registerVoiceEvents(client);
  registerChannelEvents(client);

  console.log('Server-Logging aktiv.');
}

module.exports = {
  beschreibeKanal,
  istAn,
  messageLink,
  registerServerLog,
};
