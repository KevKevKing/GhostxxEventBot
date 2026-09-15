const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} = require('discord.js');
const { toUnixSeconds } = require('./time');

const STATUS = {
  open: {
    label: 'Offen',
    color: 0x2ecc71,
  },
  closed: {
    label: 'Geschlossen',
    color: 0xf1c40f,
  },
  cancelled: {
    label: 'Abgesagt',
    color: 0xe74c3c,
  },
};

function formatAttendeeCount(event) {
  const count = event.attendees.length;
  if (!event.maxParticipants) return `${count}`;
  return `${count}/${event.maxParticipants}`;
}

// 20 war zu knapp: die meisten Anmeldungen erlauben bis zu 25 Plaetze
// (NORMAL_LIMIT in schedule-data.js), da fehlten in der Liste immer die
// letzten 4-5. 30 deckt jede echte Obergrenze mit Luft - ein Discord-Feld
// vertraegt 1024 Zeichen, 25 Zeilen mit Erwaehnung brauchen davon rund 700.
function formatAttendees(event, limit = 30, emptyText = 'Noch niemand eingetragen.') {
  if (!event.attendees.length) return emptyText;

  const visible = event.attendees.slice(0, limit).map((userId, index) => {
    return `${index + 1}. <@${userId}>`;
  });

  const hiddenCount = event.attendees.length - visible.length;
  if (hiddenCount > 0) visible.push(`... und ${hiddenCount} weitere.`);

  return visible.join('\n');
}

function buildEventEmbed(event) {
  const status = STATUS[event.status] || STATUS.open;
  const title = event.title.startsWith('Event:') ? event.title : `Event: ${event.title}`;
  const hasScheduleTimes = event.openAt && event.startAt && event.closeAt;
  const hasInkEnd = Boolean(event.inkEndAt);
  const description = hasScheduleTimes
    ? [
      `Anmeldung seit <t:${toUnixSeconds(event.openAt)}:t>.`,
      hasInkEnd
        ? `Start: <t:${toUnixSeconds(event.startAt)}:t> - Inkzeit bis <t:${toUnixSeconds(event.inkEndAt)}:t>.`
        : `Start: <t:${toUnixSeconds(event.startAt)}:t> - Anmeldung bis <t:${toUnixSeconds(event.closeAt)}:t>.`,
    ].join('\n')
    : event.description;
  const attendeeCount = event.maxParticipants
    ? `${event.attendees.length}/${event.maxParticipants}`
    : `${event.attendees.length}`;
  const attendeeFieldName = event.maxParticipants
    ? `Teilnehmer (${event.attendees.length}/${event.maxParticipants})`
    : `Teilnehmer (${event.attendees.length})`;
  const substitutes = event.substitutes || [];
  const hasSubstitutes = Number(event.maxSubstitutes || 0) > 0;

  const embed = new EmbedBuilder()
    .setColor(status.color)
    .setTitle(title)
    .setDescription(description)
    .setFooter({ text: 'EventBotGhostXX • Event Anmeldung' })
    .setTimestamp(new Date(event.createdAt));

  if (hasScheduleTimes) {
    embed.addFields(
      { name: 'Status', value: status.label, inline: true },
      { name: 'Start', value: `<t:${toUnixSeconds(event.startAt)}:R>`, inline: true },
      { name: 'Anmeldung', value: `bis <t:${toUnixSeconds(event.closeAt)}:t>`, inline: true },
      ...(hasInkEnd
        ? [{ name: 'Inkzeit', value: `bis <t:${toUnixSeconds(event.inkEndAt)}:t>`, inline: false }]
        : []),
      { name: attendeeFieldName, value: formatAttendees(event), inline: false },
      ...(hasSubstitutes
        ? [{
          name: `Auswechselspieler (${substitutes.length}/${event.maxSubstitutes})`,
          value: formatAttendees({ attendees: substitutes }),
          inline: false,
        }]
        : []),
    );
  } else {
    embed.addFields(
      { name: 'Wann', value: event.when, inline: true },
      { name: 'Status', value: status.label, inline: true },
      { name: 'Teilnehmer', value: attendeeCount || formatAttendeeCount(event), inline: true },
      { name: attendeeFieldName, value: formatAttendees(event), inline: false },
      ...(hasSubstitutes
        ? [{
          name: `Auswechselspieler (${substitutes.length}/${event.maxSubstitutes})`,
          value: formatAttendees({ attendees: substitutes }),
          inline: false,
        }]
        : []),
    );
  }

  if (event.location) {
    embed.addFields({ name: 'Treffpunkt', value: event.location, inline: false });
  }

  if (event.cancelReason) {
    embed.addFields({ name: 'Grund', value: event.cancelReason, inline: false });
  }

  return embed;
}

function buildEventComponents(event) {
  const disabled = event.status !== 'open';
  const buttons = [
    new ButtonBuilder()
      .setCustomId(`event_signup:join:${event.id}`)
      .setLabel('Beitreten')
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled),
  ];

  if (Number(event.maxSubstitutes || 0) > 0) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`event_signup:substitute:${event.id}`)
        .setLabel('Auswechselspieler')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(disabled),
    );
  }

  buttons.push(
    new ButtonBuilder()
      .setCustomId(`event_signup:leave:${event.id}`)
      .setLabel('Verlassen')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled),
  );

  return [
    new ActionRowBuilder().addComponents(...buttons),
  ];
}

function formatStateList(userIds, limit = 30, emptyText = 'Noch niemand eingetragen.') {
  if (!userIds.length) return emptyText;

  const visible = userIds.slice(0, limit).map((userId, index) => {
    return `${index + 1}. <@${userId}>`;
  });
  const hiddenCount = userIds.length - visible.length;
  if (hiddenCount > 0) visible.push(`... und ${hiddenCount} weitere.`);

  return visible.join('\n');
}

function buildStateSignupEmbed(event) {
  const isAttack = event.stateType === 'attack';
  const stateTitle = isAttack ? 'Angriff gemeldet' : 'Verteidigung gemeldet';
  const timeField = event.reportFields.find((field) => field.name === 'Wann wurde angegriffen');
  const targetFields = event.reportFields.filter((field) => field.name !== 'Wann wurde angegriffen');
  const overviewFields = targetFields.map((field) => ({
    name: field.name,
    value: `**${field.value}**`,
    inline: true,
  }));

  if (timeField) {
    overviewFields.push({
      name: timeField.name,
      value: `**${timeField.value}**`,
      inline: true,
    });
  }

  if (event.stateInkEndAt) {
    overviewFields.push({
      name: 'Inkzeit',
      value: `**<t:${toUnixSeconds(event.stateInkEndAt)}:R>**`,
      inline: true,
    });
  }

  const embed = new EmbedBuilder()
    .setColor(isAttack ? 0xe74c3c : 0x3498db)
    .setTitle(stateTitle)
    .addFields(...overviewFields);

  if (event.details) {
    embed.addFields({ name: 'Details', value: event.details, inline: false });
  }

  embed.addFields(
    {
      name: `Teilnehmer (${event.attendees.length}/${event.maxParticipants})`,
      value: formatStateList(event.attendees),
      inline: false,
    },
    {
      name: `Auswechselspieler (${event.substitutes.length}/${event.maxSubstitutes})`,
      value: formatStateList(event.substitutes),
      inline: false,
    },
  );

  embed
    .setFooter({ text: 'EventBotGhostXX • Staatliche Anmeldung' })
    .setTimestamp(new Date(event.createdAt));

  return embed;
}

function buildStateSignupComponents(event) {
  const disabled = event.status !== 'open';

  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`state_signup:join:${event.id}`)
        .setLabel('Anmelden')
        .setStyle(ButtonStyle.Success)
        .setDisabled(disabled),
      new ButtonBuilder()
        .setCustomId(`state_signup:substitute:${event.id}`)
        .setLabel('Auswechselspieler')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(disabled),
      new ButtonBuilder()
        .setCustomId(`state_signup:leave:${event.id}`)
        .setLabel('Abmelden')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(disabled),
    ),
  ];
}

function buildStateEmbed({ type, interaction, fields, details }) {
  return buildStateSignupEmbed({
    id: 'vorschau',
    stateType: type,
    reportFields: fields,
    details,
    attendees: [],
    substitutes: [],
    beitrittsLog: [],
    maxParticipants: 10,
    maxSubstitutes: 3,
    status: 'open',
    createdBy: interaction.user.id,
    createdAt: new Date().toISOString(),
  });
}

module.exports = {
  buildEventComponents,
  buildEventEmbed,
  buildStateEmbed,
  buildStateSignupComponents,
  buildStateSignupEmbed,
  formatAttendees,
};
