const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const { config } = require('./config');
const { istAn: schalterAn } = require('./steuerung');
const { createEventId, getEvent, listEvents, saveEvent, updateEvent } = require('./storage');
const {
  STATUS_MESSAGES,
  addParticipant,
  removeParticipant,
} = require('./event-actions');
const { logSignupChange } = require('./chat-router');
const { logBotEvent } = require('./logger');
const { buildLeaderboardPage } = require('./leaderboard');
const { handleAuszahlenCommand } = require('./logbook-command');
const { handleSammelauszahlungCommand } = require('./logbook-batch');
const { listGiveaways, updateGiveaway } = require('./giveaway-storage');
const {
  buildPingAllowedMentions,
  formatPingTarget,
  getEventPingTarget,
  refreshEventMessage,
  refreshSignupMessage: refreshTypedSignupMessage,
  sendEventMessage,
} = require('./event-message');
const { baueStateEvent } = require('./state-event');
const { protokolliereVersuch, baueInfoText } = require('./beitritts-log');
const {
  createGiveaway,
  parseGiveawayDrawAt,
  refreshGiveawayMessage,
  refreshGiveawayResultMessage,
} = require('./giveaway');
const {
  buildEventComponents,
  buildEventEmbed,
  buildStateSignupComponents,
  buildStateSignupEmbed,
  formatAttendees,
} = require('./ui');
const {
  addAdmin,
  addEditor,
  canManageSignups,
  hasAdminRights,
  isEditor,
  isOwnerOrAdmin,
  listAdmins,
  listEditors,
  removeAdmin,
  removeEditor,
} = require('./permissions');

const TURF_LEADER_COMMANDS = new Set(['angriff', 'verteidigung']);

// /purge loescht bis zu 100 Nachrichten und ist nicht rueckgaengig zu machen,
// /admin vergibt Rechte. Beides bleibt ausschliesslich bei Owner und Co-Owner -
// auch eingetragene Admins kommen da nicht ran.
const OWNER_ONLY_COMMANDS = new Set(['purge', 'admin']);

// Eine Stufe darunter: greift in Gewinne, Auszahlungen und Editor-Rechte ein.
// Dafuer reicht ein per /admin eingetragener Admin.
const ADMIN_COMMANDS = new Set(['verlosung', 'editor', 'auszahlen', 'sammelauszahlung', 'sammelauswertung']);

// Darf jeder benutzen.
const PUBLIC_COMMANDS = new Set(['top']);

// Im Namen des Bots schreiben: zusaetzlich die eingetragenen Editoren, aber
// nicht die Befehlsrollen.
const EDITOR_ONLY_COMMANDS = new Set(['say', 'embed']);

const MESSAGE_MODAL_TTL_MS = 10 * 60 * 1000;
const pendingMessageModals = new Map();

async function handleInteraction(interaction) {
  if (interaction.guildId !== config.guildId) {
    if (interaction.isRepliable()) {
      await interaction.reply({
        content: 'Dieser Bot ist nur auf dem konfigurierten Server aktiv.',
        ephemeral: true,
      });
    }
    return;
  }

  if (interaction.isModalSubmit()) {
    await handleMessageModalSubmit(interaction);
    return;
  }

  if (interaction.isChatInputCommand()) {
    await handleCommand(interaction);
    return;
  }

  if (interaction.isMessageContextMenuCommand() && interaction.commandName === 'Info') {
    await handleInfoContextMenu(interaction);
    return;
  }

  if (
    interaction.isButton() &&
    (interaction.customId.startsWith('event:') || interaction.customId.startsWith('event_signup:'))
  ) {
    await handleEventButton(interaction);
    return;
  }

  if (interaction.isButton() && interaction.customId.startsWith('wissen_')) {
    const { handleKnowledgeConflictButton } = require('./message-handler');
    await handleKnowledgeConflictButton(interaction);
    return;
  }

  if (interaction.isButton() && interaction.customId.startsWith('top:')) {
    await handleTopButton(interaction);
    return;
  }

  if (interaction.isButton() && interaction.customId.startsWith('state_signup:')) {
    await handleStateSignupButton(interaction);
    return;
  }

  if (interaction.isButton() && interaction.customId.startsWith('giveaway_delivery:')) {
    await handleGiveawayDeliveryButton(interaction);
    return;
  }

  if (
    interaction.isButton() &&
    (interaction.customId.startsWith('chat_confirm:') ||
      interaction.customId.startsWith('chat_cancel:') ||
      interaction.customId.startsWith('chat_undo:'))
  ) {
    const { handleChatConfirmButton } = require('./message-handler');
    await handleChatConfirmButton(interaction);
  }
}

async function handleCommand(interaction) {
  if (!schalterAn('commands')) {
    await interaction.reply({ content: 'Commands sind gerade im Dashboard pausiert.', ephemeral: true });
    return;
  }
  if (!(await assertCommandPermission(interaction))) return;

  if (interaction.commandName === 'top') {
    await handleTopCommand(interaction);
    return;
  }

  if (interaction.commandName === 'auszahlen') {
    await handleAuszahlenCommand(interaction);
    return;
  }

  if (interaction.commandName === 'sammelauszahlung') {
    await handleSammelauszahlungCommand(interaction);
    return;
  }

  // Derselbe Ablauf, nur ohne Bildpruefung - gezaehlt wird allein nach dem
  // Text im Beitrag.
  if (interaction.commandName === 'sammelauswertung') {
    await handleSammelauszahlungCommand(interaction, { nurText: true });
    return;
  }

  if (interaction.commandName === 'editor') {
    await handleEditorCommand(interaction);
    return;
  }

  if (interaction.commandName === 'admin') {
    await handleAdminCommand(interaction);
    return;
  }

  if (interaction.commandName === 'say') {
    await handleSayCommand(interaction);
    return;
  }

  if (interaction.commandName === 'embed') {
    await handleEmbedCommand(interaction);
    return;
  }

  if (interaction.commandName === 'purge') {
    await handlePurgeCommand(interaction);
    return;
  }

  if (interaction.commandName === 'bearbeiten') {
    await handleEditSignupCommand(interaction);
    return;
  }

  if (interaction.commandName === 'verlosung') {
    await handleGiveawayCommand(interaction);
    return;
  }

  if (interaction.commandName === 'event') {
    await handleEventCommand(interaction);
    return;
  }

  if (interaction.commandName === 'angriff') {
    await handleAttackCommand(interaction);
    return;
  }

  if (interaction.commandName === 'verteidigung') {
    await handleDefenseCommand(interaction);
    return;
  }

  if (interaction.commandName === 'eintragen') {
    await handleManualSignupCommand(interaction, 'add');
    return;
  }

  if (interaction.commandName === 'austragen') {
    await handleManualSignupCommand(interaction, 'remove');
  }
}

async function handleSayCommand(interaction) {
  const rawContent = interaction.options.getString('nachricht');
  const selectedChannel = interaction.options.getChannel('channel');
  const targetChannel = selectedChannel || interaction.channel;
  const pingTarget = getPingTargetFromMentionable(interaction.options.getMentionable('ping'));
  const allowPings = interaction.options.getBoolean('pings') ?? false;
  const usersToPing = getSayUsers(interaction);
  const roleToPing = interaction.options.getRole('rolle');

  if (!targetChannel || !targetChannel.isTextBased()) {
    await interaction.reply({
      content: 'Der Ziel-Channel wurde nicht gefunden oder ist kein Textkanal.',
      ephemeral: true,
    });
    return;
  }

  if (!rawContent) {
    const customId = `say_modal:${interaction.id}`;
    storeMessageModalContext(customId, {
      type: 'say',
      channelId: targetChannel.id,
      pingTarget,
      allowPings,
      userIds: usersToPing.map((user) => user.id),
      roleId: roleToPing?.id || '',
    });

    await interaction.showModal(buildMessageModal(customId, {
      title: 'Say Nachricht',
      label: 'Nachricht',
      maxLength: 2000,
    }));
    return;
  }

  await interaction.deferReply({ ephemeral: true });
  await sendSayMessage(interaction, {
    channelId: targetChannel.id,
    rawContent,
    pingTarget,
    allowPings,
    users: usersToPing,
    role: roleToPing,
  });
}

async function handleEmbedCommand(interaction) {
  const rawText = interaction.options.getString('text');
  const title = interaction.options.getString('titel') || '';
  const selectedChannel = interaction.options.getChannel('channel');
  const targetChannel = selectedChannel || interaction.channel;
  const color = parseEmbedColor(interaction.options.getString('farbe'));
  const pingTarget = getPingTargetFromMentionable(interaction.options.getMentionable('ping'));
  const allowPings = interaction.options.getBoolean('pings') ?? false;
  const usersToPing = getSayUsers(interaction);
  const roleToPing = interaction.options.getRole('rolle');

  if (!targetChannel || !targetChannel.isTextBased()) {
    await interaction.reply({
      content: 'Der Ziel-Channel wurde nicht gefunden oder ist kein Textkanal.',
      ephemeral: true,
    });
    return;
  }

  if (color === null) {
    await interaction.reply({
      content: 'Die Farbe muss als Hex-Wert angegeben werden, z.B. `#8b5cf6`.',
      ephemeral: true,
    });
    return;
  }

  if (!rawText) {
    const customId = `embed_modal:${interaction.id}`;
    storeMessageModalContext(customId, {
      type: 'embed',
      channelId: targetChannel.id,
      title,
      color,
      pingTarget,
      allowPings,
      userIds: usersToPing.map((user) => user.id),
      roleId: roleToPing?.id || '',
    });

    await interaction.showModal(buildMessageModal(customId, {
      title: 'Embed Text',
      label: 'Text',
      maxLength: 4000,
    }));
    return;
  }

  await interaction.deferReply({ ephemeral: true });
  await sendEmbedMessage(interaction, {
    channelId: targetChannel.id,
    rawText,
    title,
    color,
    pingTarget,
    allowPings,
    users: usersToPing,
    role: roleToPing,
  });
}

async function handleMessageModalSubmit(interaction) {
  const context = takeMessageModalContext(interaction.customId);
  if (!context) {
    await interaction.reply({
      content: 'Dieses Textfenster ist abgelaufen. Bitte fuehre den Command nochmal aus.',
      ephemeral: true,
    });
    return;
  }

  const content = interaction.fields.getTextInputValue('content');
  const users = context.userIds.map((id) => ({ id }));
  const role = context.roleId ? { id: context.roleId } : null;
  const pingTarget = context.pingTarget || null;

  await interaction.deferReply({ ephemeral: true });

  if (context.type === 'say') {
    await sendSayMessage(interaction, {
      channelId: context.channelId,
      rawContent: content,
      pingTarget,
      allowPings: context.allowPings,
      users,
      role,
    });
    return;
  }

  if (context.type === 'embed') {
    await sendEmbedMessage(interaction, {
      channelId: context.channelId,
      rawText: content,
      title: context.title,
      color: context.color,
      pingTarget,
      allowPings: context.allowPings,
      users,
      role,
    });
    return;
  }

  await interaction.editReply('Dieses Textfenster konnte nicht zugeordnet werden.');
}

async function sendSayMessage(interaction, { channelId, rawContent, pingTarget, allowPings, users, role }) {
  const targetChannel = await resolveTextChannel(interaction, channelId);
  if (!targetChannel) {
    await interaction.editReply('Der Ziel-Channel wurde nicht gefunden oder ist kein Textkanal.');
    return;
  }

  const messageContent = applyMessagePingTarget(
    applyMentionPlaceholders(normalizeMessageInput(rawContent), users, role),
    pingTarget,
  );
  if (!messageContent.trim()) {
    await interaction.editReply('Bitte gib eine Nachricht ein.');
    return;
  }

  const message = await targetChannel.send({
    content: messageContent,
    allowedMentions: buildSayAllowedMentions({
      allowPings,
      users,
      role,
      pingTarget,
    }),
  });

  await interaction.editReply(`Gesendet in <#${targetChannel.id}>: ${message.url}`);
}

async function sendEmbedMessage(interaction, { channelId, rawText, title, color, pingTarget, allowPings, users, role }) {
  const targetChannel = await resolveTextChannel(interaction, channelId);
  if (!targetChannel) {
    await interaction.editReply('Der Ziel-Channel wurde nicht gefunden oder ist kein Textkanal.');
    return;
  }

  const description = applyPingPlaceholder(
    applyMentionPlaceholders(normalizeMessageInput(rawText), users, role),
    pingTarget,
  );
  if (!description.trim()) {
    await interaction.editReply('Bitte gib einen Embed-Text ein.');
    return;
  }

  const pingContent = buildEmbedPingContent(description, {
    allowPings,
    users,
    role,
    pingTarget,
  });

  const embed = new EmbedBuilder()
    .setDescription(description)
    .setColor(color)
    .setTimestamp(new Date());

  if (title) embed.setTitle(title);

  const message = await targetChannel.send({
    content: pingContent || undefined,
    embeds: [embed],
    allowedMentions: buildSayAllowedMentions({
      allowPings,
      users,
      role,
      pingTarget,
    }),
  });

  await interaction.editReply(`Embed gesendet in <#${targetChannel.id}>: ${message.url}`);
}

async function resolveTextChannel(interaction, channelId) {
  if (interaction.channel?.id === channelId && interaction.channel.isTextBased()) {
    return interaction.channel;
  }

  const channel = await interaction.client.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return null;
  return channel;
}

function buildMessageModal(customId, { title, label, maxLength }) {
  const input = new TextInputBuilder()
    .setCustomId('content')
    .setLabel(label)
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(maxLength)
    .setPlaceholder('Verwende Shift + Enter, um einen Zeilenumbruch einzufuegen');

  return new ModalBuilder()
    .setCustomId(customId)
    .setTitle(title)
    .addComponents(new ActionRowBuilder().addComponents(input));
}

function storeMessageModalContext(customId, context) {
  cleanupExpiredMessageModals();
  pendingMessageModals.set(customId, {
    ...context,
    expiresAt: Date.now() + MESSAGE_MODAL_TTL_MS,
  });
}

function takeMessageModalContext(customId) {
  cleanupExpiredMessageModals();
  const context = pendingMessageModals.get(customId);
  pendingMessageModals.delete(customId);

  if (!context || context.expiresAt <= Date.now()) return null;
  return context;
}

function cleanupExpiredMessageModals() {
  const now = Date.now();
  for (const [customId, context] of pendingMessageModals.entries()) {
    if (context.expiresAt <= now) {
      pendingMessageModals.delete(customId);
    }
  }
}

function normalizeMessageInput(content) {
  return String(content || '').replace(/\\n/g, '\n');
}

function getSayUsers(interaction) {
  const users = [];
  const seen = new Set();

  for (const optionName of ['person_1', 'person_2', 'person_3', 'person_4', 'person_5']) {
    const user = interaction.options.getUser(optionName);
    if (!user || seen.has(user.id)) continue;

    users.push(user);
    seen.add(user.id);
  }

  return users;
}

function applyMentionPlaceholders(content, users, role) {
  let updated = String(content || '');

  users.forEach((user, index) => {
    const placeholder = new RegExp(`\\{person_${index + 1}\\}`, 'gi');
    updated = updated.replace(placeholder, `<@${user.id}>`);
  });

  updated = updated.replace(/\{rolle\}/gi, role ? `<@&${role.id}>` : '');
  return updated;
}

function hasPingPlaceholder(content) {
  return /\{ping\}/i.test(String(content || ''));
}

function applyPingPlaceholder(content, pingTarget) {
  const pingText = formatPingTarget(pingTarget);
  if (!pingText) return String(content || '').replace(/\{ping\}/gi, '');
  return String(content || '').replace(/\{ping\}/gi, pingText);
}

function applyMessagePingTarget(content, pingTarget) {
  const text = String(content || '');
  const pingText = formatPingTarget(pingTarget);
  if (!pingText) return text.replace(/\{ping\}/gi, '');
  if (hasPingPlaceholder(text)) return applyPingPlaceholder(text, pingTarget);
  return `${pingText}\n${text}`;
}

function buildSayAllowedMentions({ allowPings, users, role, pingTarget }) {
  if (allowPings) {
    return { parse: ['users', 'roles', 'everyone'] };
  }

  const userIds = new Set(users.map((user) => user.id));
  const roleIds = new Set(role ? [role.id] : []);

  if (pingTarget?.type === 'user') userIds.add(pingTarget.id);
  if (pingTarget?.type === 'role') roleIds.add(pingTarget.id);

  return {
    parse: [],
    users: [...userIds],
    roles: [...roleIds],
  };
}

function parseEmbedColor(input) {
  if (!input) return 0x8b5cf6;

  const match = String(input).trim().match(/^#?([0-9a-f]{6})$/i);
  if (!match) return null;

  return Number.parseInt(match[1], 16);
}

function buildEmbedPingContent(description, { allowPings, users, role, pingTarget }) {
  const mentions = new Set();
  const pingText = formatPingTarget(pingTarget);

  if (pingText) {
    mentions.add(pingText);
  }

  for (const user of users) {
    if (description.includes(`<@${user.id}>`) || description.includes(`<@!${user.id}>`)) {
      mentions.add(`<@${user.id}>`);
    }
  }

  if (role && description.includes(`<@&${role.id}>`)) {
    mentions.add(`<@&${role.id}>`);
  }

  if (allowPings) {
    for (const mention of extractMentionTokens(description)) {
      mentions.add(mention);
    }
  }

  return [...mentions].join(' ');
}

function extractMentionTokens(content) {
  const matches = String(content || '').match(/<@!?\d{17,25}>|<@&\d{17,25}>|@everyone|@here/g);
  return matches || [];
}

async function handlePurgeCommand(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const amount = interaction.options.getInteger('anzahl', true);
  const channel = interaction.channel;

  if (!channel || !channel.isTextBased() || typeof channel.bulkDelete !== 'function') {
    await interaction.editReply('In diesem Channel kann ich keine Nachrichten gesammelt loeschen.');
    return;
  }

  try {
    const deleted = await channel.bulkDelete(amount, true);
    const skipped = amount - deleted.size;
    const skippedText = skipped > 0
      ? ` ${skipped} Nachricht(en) wurden uebersprungen, meistens weil sie aelter als 14 Tage sind.`
      : '';

    await interaction.editReply(`${deleted.size} Nachricht(en) geloescht.${skippedText}`);
  } catch (error) {
    await interaction.editReply('Ich konnte die Nachrichten nicht loeschen. Pruefe bitte, ob der Bot Nachrichten verwalten darf.');
  }
}

async function handleEditSignupCommand(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const messageId = normalizeMessageId(interaction.options.getString('nachrichten_id', true));
  if (!messageId) {
    await interaction.editReply('Bitte gib eine gueltige Nachrichten-ID oder einen Discord-Nachrichtenlink an.');
    return;
  }

  const target = await findSignupByMessageId(messageId);
  if (!target) {
    const giveaway = await findGiveawayByMessageId(messageId);
    if (giveaway) {
      await handleEditGiveawayMessage(interaction, giveaway);
      return;
    }

    await interaction.editReply('Ich finde zu dieser Nachrichten-ID keine gespeicherte Anmeldung.');
    return;
  }

  if (target.kind === 'state') {
    await interaction.editReply('Dieser Command bearbeitet nur normale Event-Anmeldungen, keine staatliche Anmeldung.');
    return;
  }

  const { changes, changedLabels, selectedChannel } = collectEventEditOptions(interaction);
  if (!changedLabels.length) {
    await interaction.editReply('Gib mindestens eine Aenderung an.');
    return;
  }

  if (selectedChannel && !selectedChannel.isTextBased()) {
    await interaction.editReply('Der ausgewaehlte Channel ist kein Textkanal.');
    return;
  }

  const channelChanged = Boolean(selectedChannel && selectedChannel.id !== target.channelId);
  let newMessage = null;

  if (channelChanged) {
    const movedEvent = applyEventEdits(
      {
        ...target,
        channelId: selectedChannel.id,
        messageId: '',
      },
      changes,
    );

    try {
      newMessage = await sendEventMessage(interaction.client, movedEvent, {
        ping: Boolean(getEventPingTarget(movedEvent)),
      });
    } catch {
      await interaction.editReply('Die Anmeldung konnte im neuen Channel nicht gepostet werden.');
      return;
    }
  }

  const updated = await updateEvent(target.id, (event) => {
    const next = applyEventEdits(event, changes);

    if (selectedChannel) {
      next.channelId = selectedChannel.id;
    }

    if (newMessage) {
      next.messageId = newMessage.id;
    }

    return next;
  });

  if (!updated) {
    await interaction.editReply('Diese Anmeldung konnte nicht aktualisiert werden.');
    return;
  }

  await refreshEventMessage(interaction.client, updated, {
    ping: hasOwn(changes, 'pingTarget') && Boolean(getEventPingTarget(updated)),
    syncPingContent: hasOwn(changes, 'pingTarget'),
  });

  if (channelChanged) {
    await deleteStoredMessage(interaction.client, target.channelId, target.messageId);
  }

  const location = updated.messageId
    ? `https://discord.com/channels/${interaction.guildId}/${updated.channelId}/${updated.messageId}`
    : `<#${updated.channelId}>`;

  await interaction.editReply(`Anmeldung bearbeitet: ${changedLabels.join(', ')}\n${location}`);
}

async function handleEditGiveawayMessage(interaction, giveaway) {
  if (giveaway.status !== 'open') {
    await interaction.editReply('Diese Verlosung ist nicht mehr offen und kann nicht mehr bearbeitet werden.');
    return;
  }

  const { changes, changedLabels, selectedChannel } = collectGiveawayEditOptions(interaction);

  if (selectedChannel) {
    await interaction.editReply('Der Channel einer laufenden Verlosung kann nicht geändert werden, weil sonst die Reaktionen verloren gehen würden.');
    return;
  }

  if (!changedLabels.length) {
    await interaction.editReply('Gib mindestens eine Verlosungs-Änderung an: `platz_1`, `platz_2`, `platz_3`, `auslosung` oder `ping`.');
    return;
  }

  if (changes.invalidDrawAt) {
    await interaction.editReply('Bitte gib die Auslosung so an: `21.06.2026 23:00` oder `21.06.2026 23 Uhr`.');
    return;
  }

  if (changes.drawAt && changes.drawAt <= new Date()) {
    await interaction.editReply('Die neue Auslosung muss in der Zukunft liegen.');
    return;
  }

  const updated = await updateGiveaway(giveaway.id, (stored) => applyGiveawayEdits(stored, changes));
  if (!updated) {
    await interaction.editReply('Diese Verlosung konnte nicht aktualisiert werden.');
    return;
  }

  await refreshGiveawayMessage(interaction.client, updated);

  const location = `https://discord.com/channels/${interaction.guildId}/${updated.channelId}/${updated.messageId}`;
  await interaction.editReply(`Verlosung bearbeitet: ${changedLabels.join(', ')}\n${location}`);
}

async function handleGiveawayCommand(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const drawAt = parseGiveawayDrawAt(interaction.options.getString('auslosung', true));
  if (!drawAt) {
    await interaction.editReply('Bitte gib das Auslosungsdatum so an: `18.06.2026 23:00` oder `18.06.2026 23 Uhr`.');
    return;
  }

  if (drawAt <= new Date()) {
    await interaction.editReply('Das Auslosungsdatum muss in der Zukunft liegen.');
    return;
  }

  const selectedChannel = interaction.options.getChannel('channel');
  const channel = selectedChannel || interaction.channel;
  if (!channel || !channel.isTextBased()) {
    await interaction.editReply('Der Verlosungs-Channel wurde nicht gefunden oder ist kein Textkanal.');
    return;
  }

  const pingTarget = getPingTargetFromMentionable(interaction.options.getMentionable('ping'))
    || getDefaultGiveawayPingTarget();

  try {
    const { giveaway, message } = await createGiveaway(interaction.client, {
      guildId: interaction.guildId,
      channel,
      prize1: interaction.options.getString('platz_1', true),
      prize2: interaction.options.getString('platz_2', true),
      prize3: interaction.options.getString('platz_3', true),
      drawAt,
      pingTarget,
      createdBy: interaction.user.id,
    });

    await interaction.editReply([
      `Verlosung erstellt in <#${channel.id}>: ${message.url}`,
      `Auslosung: <t:${Math.floor(new Date(giveaway.drawAt).getTime() / 1000)}:F>`,
    ].join('\n'));
  } catch (error) {
    await interaction.editReply(error.message || 'Die Verlosung konnte nicht erstellt werden.');
  }
}

function buildTopComponents(seite) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        // Die Seitenzahl steckt im Knopf, nicht im Arbeitsspeicher. So blaettert
        // er auch noch, wenn der Bot zwischendurch neu gestartet wurde.
        .setCustomId(`top:${seite.page - 1}`)
        .setLabel('Zurück')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(seite.isFirst),
      new ButtonBuilder()
        .setCustomId(`top:${seite.page + 1}`)
        .setLabel('Weiter')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(seite.isLast),
    ),
  ];
}

function buildTopPayload(seite) {
  const embed = new EmbedBuilder()
    .setColor(0xfee75c)
    .setTitle('Fleißigste Anmelder')
    .setDescription(seite.text)
    .setFooter({ text: `${seite.footer} · Seite ${seite.page}/${seite.pageCount}` });

  return {
    embeds: [embed],
    components: seite.pageCount > 1 ? buildTopComponents(seite) : [],
    allowedMentions: { parse: [] },
  };
}

async function handleTopCommand(interaction) {
  await interaction.deferReply();
  const seite = await buildLeaderboardPage(1, interaction.guild);
  await interaction.editReply(buildTopPayload(seite));
}

async function handleTopButton(interaction) {
  const gewuenscht = Number(interaction.customId.split(':')[1]);
  const seite = await buildLeaderboardPage(gewuenscht, interaction.guild);
  await interaction.update(buildTopPayload(seite));
}

/** Liste aller Stufen - wird von /editor liste und /admin liste geteilt. */
async function buildRightsOverview() {
  const [admins, editors] = await Promise.all([listAdmins(), listEditors()]);
  const nennen = (ids, leer) =>
    (ids.length ? ids.map((userId) => `- <@${userId}> (\`${userId}\`)`).join('\n') : leer);

  return [
    '**Fest (aus der Konfiguration)**',
    `Owner: <@${config.ownerId}>`,
    `Co-Owner: <@${config.adminId}>`,
    `Turf Leader: <@&${config.turfLeaderRoleId}> nur für /angriff und /verteidigung`,
    '',
    '**Admins** — alles außer `/purge` und `/admin`',
    nennen(admins, 'Noch keine Admins eingetragen.'),
    '',
    '**Editoren** — normale Commands, dazu `/say` und `/embed`',
    nennen(editors, 'Noch keine Editoren eingetragen.'),
  ].join('\n');
}

async function handleAdminCommand(interaction) {
  // Doppelt geprueft: assertCommandPermission laesst hier nur Owner und
  // Co-Owner durch. Wer Rechte vergibt, entscheidet ueber alles andere mit -
  // das soll nicht an einer einzigen Stelle haengen.
  if (!isOwnerOrAdmin(interaction.user.id)) {
    await interaction.reply({
      content: 'Admin-Rechte vergeben dürfen nur Owner und Co-Owner.',
      ephemeral: true,
    });
    return;
  }

  const subcommand = interaction.options.getSubcommand();

  if (subcommand === 'liste') {
    await interaction.reply({
      content: await buildRightsOverview(),
      ephemeral: true,
      allowedMentions: { parse: [] },
    });
    return;
  }

  const user = interaction.options.getUser('member', true);

  if (user.bot) {
    await interaction.reply({
      content: 'Bots bekommen keine Rechte.',
      ephemeral: true,
    });
    return;
  }

  if (isOwnerOrAdmin(user.id)) {
    await interaction.reply({
      content: `<@${user.id}> steht fest in der Konfiguration und hat ohnehin alle Rechte.`,
      ephemeral: true,
      allowedMentions: { parse: [] },
    });
    return;
  }

  if (subcommand === 'hinzufuegen') {
    const result = await addAdmin(user.id);

    if (result.changed) {
      logBotEvent({
        title: 'Admin-Rechte vergeben',
        color: 'warn',
        fields: [
          { name: 'Member', value: `<@${user.id}> (\`${user.id}\`)` },
          { name: 'Durch', value: `<@${interaction.user.id}>` },
        ],
      });
    }

    await interaction.reply({
      content: result.changed
        ? `<@${user.id}> ist jetzt Admin und darf alles außer \`/purge\` und \`/admin\`.`
        : `<@${user.id}> ist bereits Admin.`,
      ephemeral: true,
      allowedMentions: { parse: [] },
    });
    return;
  }

  if (subcommand === 'entfernen') {
    const result = await removeAdmin(user.id);

    if (result.changed) {
      logBotEvent({
        title: 'Admin-Rechte entzogen',
        color: 'warn',
        fields: [
          { name: 'Member', value: `<@${user.id}> (\`${user.id}\`)` },
          { name: 'Durch', value: `<@${interaction.user.id}>` },
        ],
      });
    }

    await interaction.reply({
      content: result.changed
        ? `<@${user.id}> ist kein Admin mehr.`
        : `<@${user.id}> war nicht als Admin eingetragen.`,
      ephemeral: true,
      allowedMentions: { parse: [] },
    });
  }
}

async function handleEditorCommand(interaction) {
  if (!(await hasAdminRights(interaction.user.id))) {
    await interaction.reply({
      content: 'Editor-Rechte verwalten dürfen nur Owner, Co-Owner und Admins.',
      ephemeral: true,
    });
    return;
  }

  const subcommand = interaction.options.getSubcommand();

  if (subcommand === 'liste') {
    await interaction.reply({
      content: await buildRightsOverview(),
      ephemeral: true,
      allowedMentions: { parse: [] },
    });
    return;
  }

  const user = interaction.options.getUser('member', true);

  if (await hasAdminRights(user.id)) {
    await interaction.reply({
      content: `<@${user.id}> hat bereits Admin-Rechte und braucht keine Editor-Rechte.`,
      ephemeral: true,
      allowedMentions: { parse: [] },
    });
    return;
  }

  if (subcommand === 'hinzufuegen') {
    const result = await addEditor(user.id);
    await interaction.reply({
      content: result.changed
        ? `<@${user.id}> ist jetzt Editor und darf alle normalen Bot-Commands ausführen.`
        : `<@${user.id}> ist bereits Editor.`,
      ephemeral: true,
      allowedMentions: { parse: [] },
    });
    return;
  }

  if (subcommand === 'entfernen') {
    const result = await removeEditor(user.id);
    await interaction.reply({
      content: result.changed
        ? `<@${user.id}> ist kein Editor mehr.`
        : `<@${user.id}> war nicht als Editor eingetragen.`,
      ephemeral: true,
      allowedMentions: { parse: [] },
    });
  }
}

async function handleEventCommand(interaction) {
  const subcommand = interaction.options.getSubcommand();

  if (subcommand === 'erstellen') {
    await createEvent(interaction);
    return;
  }

  if (subcommand === 'liste') {
    await showEventList(interaction);
    return;
  }

  if (subcommand === 'teilnehmer') {
    await showEventAttendees(interaction);
    return;
  }

  if (subcommand === 'schliessen') {
    await setEventStatus(interaction, 'closed');
    return;
  }

  if (subcommand === 'absagen') {
    await setEventStatus(interaction, 'cancelled');
  }
}

async function createEvent(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const selectedChannel = interaction.options.getChannel('channel');
  const channelId = selectedChannel?.id || config.eventChannelId;
  const channel = selectedChannel || await interaction.client.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) {
    await interaction.editReply('Der ausgewählte Event-Channel wurde nicht gefunden oder ist kein Textkanal.');
    return;
  }

  const pingTarget = getPingTargetFromMentionable(interaction.options.getMentionable('ping'))
    || getDefaultEventPingTarget();
  const maxSubstitutesOption = interaction.options.getInteger('max_auswechselspieler');
  const useSubstitutes = (interaction.options.getBoolean('auswechselspieler') ?? false) || Boolean(maxSubstitutesOption);
  const event = {
    id: createEventId(),
    title: interaction.options.getString('titel', true),
    when: interaction.options.getString('wann', true),
    description: interaction.options.getString('beschreibung', true),
    location: interaction.options.getString('treffpunkt') || '',
    maxParticipants: interaction.options.getInteger('max_teilnehmer') || null,
    maxSubstitutes: useSubstitutes ? (maxSubstitutesOption || 3) : 0,
    status: 'open',
    attendees: [],
    substitutes: [],
    beitrittsLog: [],
    createdBy: interaction.user.id,
    createdAt: new Date().toISOString(),
    channelId: channel.id,
    messageId: '',
    pingTarget,
    pingRoleId: pingTarget?.type === 'role' ? pingTarget.id : '',
    pingUserId: pingTarget?.type === 'user' ? pingTarget.id : '',
  };

  const message = await sendEventMessage(interaction.client, event, { ping: Boolean(pingTarget) });
  event.messageId = message.id;
  await saveEvent(event);

  await interaction.editReply(`Event erstellt in <#${channel.id}>: ${message.url}\nEvent-ID: ${event.id}`);
}

async function showEventList(interaction) {
  const events = (await listEvents())
    .filter((event) => event.status !== 'cancelled')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  if (!events.length) {
    await interaction.reply({ content: 'Es gibt aktuell keine geplanten Events.', ephemeral: true });
    return;
  }

  const lines = events.slice(0, 15).map((event) => {
    const count = event.maxParticipants
      ? `${event.attendees.length}/${event.maxParticipants}`
      : `${event.attendees.length}`;
    return `**${event.title}** | ${event.when} | ${event.status} | ${count} Teilnehmer | ID: \`${event.id}\``;
  });

  await interaction.reply({
    content: lines.join('\n'),
    ephemeral: true,
  });
}

async function showEventAttendees(interaction) {
  const eventId = interaction.options.getString('event_id', true);
  const event = await getEvent(eventId);

  if (!event) {
    await interaction.reply({ content: 'Dieses Event wurde nicht gefunden.', ephemeral: true });
    return;
  }

  await interaction.reply({
    content: buildEventAttendeeText(event),
    ephemeral: true,
    allowedMentions: { parse: [] },
  });
}

async function setEventStatus(interaction, status) {
  await interaction.deferReply({ ephemeral: true });

  const eventId = interaction.options.getString('event_id', true);
  const cancelReason = status === 'cancelled'
    ? interaction.options.getString('grund') || ''
    : '';

  const updated = await updateEvent(eventId, (event) => ({
    ...event,
    status,
    cancelReason,
  }));

  if (!updated) {
    await interaction.editReply('Dieses Event wurde nicht gefunden.');
    return;
  }

  await refreshEventMessage(interaction.client, updated);

  const label = status === 'cancelled' ? 'abgesagt' : 'geschlossen';
  await interaction.editReply(`Event \`${updated.id}\` wurde ${label}.`);
}

/**
 * Rechtsklick auf eine Anmeldungs-Nachricht -> Apps -> Info. Zeigt die
 * Beitritts-Statistik zu genau der Anmeldung, an der die Nachricht haengt.
 */
async function handleInfoContextMenu(interaction) {
  const events = await listEvents();
  const event = events.find((eintrag) => eintrag.messageId === interaction.targetId);

  if (!event) {
    await interaction.reply({
      content: 'Das ist keine Anmeldungs-Nachricht - dazu gibt es keine Statistik.',
      ephemeral: true,
    });
    return;
  }

  // Bei einem Autoklicker koennen sich viele "zu spaet"-Versuche ansammeln -
  // Discord erlaubt hoechstens 2000 Zeichen pro Nachricht.
  const text = `**${event.title}**\n${baueInfoText(event)}`;
  await interaction.reply({
    content: text.length > 1990 ? `${text.slice(0, 1900)}\n… gekürzt.` : text,
    ephemeral: true,
    allowedMentions: { parse: [] },
  });
}

async function handleEventButton(interaction) {
  const [, action, eventId] = interaction.customId.split(':');
  if (!eventId) {
    await interaction.reply({ content: 'Diese Anmeldung ist ungueltig.', ephemeral: true });
    return;
  }

  if (action === 'list') {
    const event = await getEvent(eventId);
    if (!event) {
      await interaction.reply({ content: 'Dieses Event wurde nicht gefunden.', ephemeral: true });
      return;
    }

    await interaction.reply({
      content: buildEventAttendeeText(event),
      ephemeral: true,
      allowedMentions: { parse: [] },
    });
    return;
  }

  // Discord verlangt eine Antwort innerhalb von drei Sekunden, sonst zeigt es
  // dem Klickenden "Diese Interaktion ist fehlgeschlagen" - auch wenn der
  // Klick im Hintergrund vielleicht doch noch verarbeitet wird.
  //
  // updateEvent() laeuft durch eine globale Schreibwarteschlange (queueWrite
  // in storage.js) - klicken viele auf einmal (Autoklicker, oder einfach
  // 30 Leute gleichzeitig bei einem beliebten Event), wartet ein spaeterer
  // Klick hinter allen frueheren. Bei genug Klicks reisst das die drei
  // Sekunden, und der Klick "zaehlt nicht", obwohl die Daten am Ende richtig
  // stehen. Sofort bestaetigen loest das: das Zeitfenster ist vorbei, sobald
  // Discord die Bestaetigung hat, die eigentliche Verarbeitung darf beliebig
  // lange in der Warteschlange stehen.
  //
  // Schlaegt sogar DAS fehl ("Unknown interaction") - beobachtet bei einem
  // Ansturm auf FamWar, Discord hatte den Klick offenbar selbst verzoegert
  // zugestellt und die Interaktion war schon tot, bevor wir sie ueberhaupt
  // ansehen konnten - darf der Beitritt trotzdem nicht verloren gehen. Bis
  // hierhin stand ein einfaches "await", ein Fehler hat die Funktion beendet
  // und updateEvent() NIE erreicht: der Klick zaehlte dann ueberhaupt nicht,
  // schlimmer als vorher. Jetzt wird nur vermerkt, ob geantwortet werden kann -
  // der Beitritt selbst laeuft in jedem Fall durch.
  const bestaetigt = await interaction.deferUpdate().then(() => true, () => false);

  let result = '';
  const updated = await updateEvent(eventId, (event) => {
    if (event.status !== 'open') {
      result = 'closed';
      return event;
    }

    const attendees = event.attendees || [];
    const substitutes = event.substitutes || [];
    const maxSubstitutes = Number(event.maxSubstitutes || 0);
    const isAttending = attendees.includes(interaction.user.id);
    const isSubstitute = substitutes.includes(interaction.user.id);

    if (action === 'join') {
      if (isAttending || isSubstitute) {
        result = 'already_joined';
        return event;
      }

      if (event.maxParticipants && attendees.length >= event.maxParticipants) {
        result = 'main_full';
        return protokolliereVersuch(event, interaction.user.id, 'zu_spaet');
      }

      result = 'joined';
      return protokolliereVersuch({
        ...event,
        attendees: [...attendees, interaction.user.id],
        substitutes,
      }, interaction.user.id, 'beigetreten');
    }

    if (action === 'substitute') {
      if (isAttending || isSubstitute) {
        result = 'already_joined';
        return event;
      }

      if (!maxSubstitutes) {
        result = 'substitutes_disabled';
        return event;
      }

      if (substitutes.length >= maxSubstitutes) {
        result = 'substitute_full';
        return protokolliereVersuch(event, interaction.user.id, 'zu_spaet');
      }

      result = 'joined_substitute';
      return protokolliereVersuch({
        ...event,
        attendees,
        substitutes: [...substitutes, interaction.user.id],
      }, interaction.user.id, 'ersatzbank');
    }

    if (action === 'leave') {
      if (!isAttending && !isSubstitute) {
        result = 'not_joined';
        return event;
      }

      result = isSubstitute ? 'left_substitute' : 'left';
      return {
        ...event,
        attendees: attendees.filter((userId) => userId !== interaction.user.id),
        substitutes: substitutes.filter((userId) => userId !== interaction.user.id),
      };
    }

    result = 'unknown';
    return event;
  });

  // Ab hier nur noch der Versuch, zu antworten - der Beitritt selbst steht
  // schon fest. War die Bestaetigung oben schon fehlgeschlagen, ist die
  // Interaktion tot: jeder weitere Aufruf ueber sie wuerde denselben Fehler
  // werfen. Die OEFFENTLICHE Anmeldeliste im Kanal muss aber trotzdem
  // stimmen - die wird hier direkt ueber den Client neu geschrieben, nicht
  // ueber die tote Interaktion. Nur die private "du bist angemeldet"-
  // Rueckmeldung an den Klickenden faellt dann aus.
  if (!bestaetigt) {
    if (updated && ['joined', 'joined_substitute', 'left', 'left_substitute'].includes(result)) {
      await refreshEventMessage(interaction.client, updated).catch(() => null);
    }
    return;
  }

  if (!updated) {
    await interaction.followUp({ content: 'Dieses Event wurde nicht gefunden.', ephemeral: true }).catch(() => null);
    return;
  }

  if (['joined', 'joined_substitute', 'left', 'left_substitute'].includes(result)) {
    await interaction.editReply({
      embeds: [buildEventEmbed(updated)],
      components: buildEventComponents(updated),
      allowedMentions: { parse: [] },
    }).catch(() => null);

    await interaction.followUp({
      content: {
        joined: 'Du bist angemeldet.',
        joined_substitute: 'Du bist als Auswechselspieler eingetragen.',
        left: 'Du bist abgemeldet.',
        left_substitute: 'Du bist als Auswechselspieler abgemeldet.',
      }[result],
      ephemeral: true,
    }).catch(() => null);
    return;
  }

  const messages = {
    already_joined: 'Du bist bereits angemeldet.',
    not_joined: 'Du bist fuer dieses Event nicht angemeldet.',
    main_full: 'Die normale Teilnehmerliste ist voll.',
    substitute_full: 'Die Auswechselspieler-Liste ist voll.',
    substitutes_disabled: 'Für dieses Event gibt es keine Auswechselspieler-Liste.',
    closed: 'Die Anmeldung fuer dieses Event ist geschlossen.',
    unknown: 'Diese Aktion kenne ich nicht.',
  };

  await interaction.followUp({
    content: messages[result] || messages.unknown,
    ephemeral: true,
  }).catch(() => null);
}

async function handleAttackCommand(interaction) {
  if (!(await assertStateChannel(interaction))) return;
  const attackedAt = interaction.options.getString('wann_wurde_angegriffen', true);
  const pingTarget = getPingTargetFromMentionable(interaction.options.getMentionable('ping'));

  await createStateSignup(interaction, {
    stateType: 'attack',
    timeInput: attackedAt,
    pingTarget,
    reportFields: [
      {
        name: 'Wer wurde angegriffen',
        value: interaction.options.getString('wer_wurde_angegriffen', true),
        inline: true,
      },
      {
        name: 'Wann wurde angegriffen',
        value: attackedAt,
        inline: true,
      },
    ],
    details: interaction.options.getString('details') || '',
  });
}

async function handleDefenseCommand(interaction) {
  if (!(await assertStateChannel(interaction))) return;
  const attackedAt = interaction.options.getString('wann_wurde_angegriffen', true);
  const pingTarget = getPingTargetFromMentionable(interaction.options.getMentionable('ping'));

  await createStateSignup(interaction, {
    stateType: 'defense',
    timeInput: attackedAt,
    pingTarget,
    reportFields: [
      {
        name: 'Wer hat angegriffen',
        value: interaction.options.getString('wer_hat_angegriffen', true),
        inline: true,
      },
      {
        name: 'Wann wurde angegriffen',
        value: attackedAt,
        inline: true,
      },
    ],
    details: interaction.options.getString('details') || '',
  });
}

async function createStateSignup(interaction, { stateType, reportFields, details, timeInput, pingTarget }) {
  await interaction.deferReply();

  const event = baueStateEvent({
    stateType,
    reportFields,
    details,
    timeInput,
    pingTarget,
    createdBy: interaction.user.id,
    channelId: interaction.channelId,
  });

  const payload = {
    embeds: [buildStateSignupEmbed(event)],
    components: buildStateSignupComponents(event),
    allowedMentions: pingTarget ? buildPingAllowedMentions(pingTarget) : { parse: [] },
  };

  if (pingTarget) {
    payload.content = formatPingTarget(pingTarget);
  }

  await interaction.editReply(payload);

  const message = await interaction.fetchReply();
  event.messageId = message.id;
  await saveEvent(event);
}

async function handleStateSignupButton(interaction) {
  const [, action, eventId] = interaction.customId.split(':');
  if (!eventId) {
    await interaction.reply({ content: 'Diese staatliche Anmeldung ist ungueltig.', ephemeral: true });
    return;
  }

  // Siehe handleEventButton weiter oben: sofort bestaetigen, bevor die
  // (moeglicherweise wartende) Verarbeitung passiert - sonst reisst Discords
  // Drei-Sekunden-Fenster bei vielen gleichzeitigen Klicks. Schlaegt sogar
  // das fehl, darf die Anmeldung trotzdem nicht verloren gehen - siehe die
  // lange Warnung dort.
  const bestaetigt = await interaction.deferUpdate().then(() => true, () => false);

  let result = '';
  const updated = await updateEvent(eventId, (event) => {
    if (!event || event.kind !== 'state') {
      result = 'missing';
      return event;
    }

    if (event.status !== 'open') {
      result = 'closed';
      return event;
    }

    const attendees = event.attendees || [];
    const substitutes = event.substitutes || [];
    const isAttendee = attendees.includes(interaction.user.id);
    const isSubstitute = substitutes.includes(interaction.user.id);

    if (action === 'join') {
      if (isAttendee || isSubstitute) {
        result = 'already_joined';
        return event;
      }

      if (attendees.length < event.maxParticipants) {
        result = 'joined_main';
        return protokolliereVersuch({
          ...event,
          attendees: [...attendees, interaction.user.id],
          substitutes,
        }, interaction.user.id, 'beigetreten');
      }

      result = 'main_full';
      return protokolliereVersuch(event, interaction.user.id, 'zu_spaet');
    }

    if (action === 'substitute') {
      if (isAttendee || isSubstitute) {
        result = 'already_joined';
        return event;
      }

      if (substitutes.length < event.maxSubstitutes) {
        result = 'joined_substitute';
        return protokolliereVersuch({
          ...event,
          attendees,
          substitutes: [...substitutes, interaction.user.id],
        }, interaction.user.id, 'ersatzbank');
      }

      result = 'substitute_full';
      return protokolliereVersuch(event, interaction.user.id, 'zu_spaet');
    }

    if (action === 'leave') {
      if (!isAttendee && !isSubstitute) {
        result = 'not_joined';
        return event;
      }

      result = isSubstitute ? 'left_substitute' : 'left_main';
      return {
        ...event,
        attendees: attendees.filter((userId) => userId !== interaction.user.id),
        substitutes: substitutes.filter((userId) => userId !== interaction.user.id),
      };
    }

    result = 'unknown';
    return event;
  });

  // Siehe handleEventButton: die oeffentliche Anmeldeliste muss stimmen,
  // auch wenn die Interaktion schon tot ist und niemand eine private
  // Rueckmeldung sieht.
  if (!bestaetigt) {
    if (updated && ['joined_main', 'joined_substitute', 'left_main', 'left_substitute'].includes(result)) {
      await refreshTypedSignupMessage(interaction.client, updated).catch(() => null);
    }
    return;
  }

  if (!updated || result === 'missing') {
    await interaction.followUp({ content: 'Diese staatliche Anmeldung wurde nicht gefunden.', ephemeral: true }).catch(() => null);
    return;
  }

  if (['joined_main', 'joined_substitute', 'left_main', 'left_substitute'].includes(result)) {
    await interaction.editReply({
      embeds: [buildStateSignupEmbed(updated)],
      components: buildStateSignupComponents(updated),
      allowedMentions: { parse: [] },
    }).catch(() => null);

    const messages = {
      joined_main: 'Du bist angemeldet.',
      joined_substitute: 'Du bist als Auswechselspieler eingetragen.',
      left_main: 'Du bist abgemeldet.',
      left_substitute: 'Du bist als Auswechselspieler abgemeldet.',
    };

    await interaction.followUp({ content: messages[result], ephemeral: true }).catch(() => null);
    return;
  }

  const messages = {
    already_joined: 'Du bist bereits eingetragen.',
    not_joined: 'Du bist nicht eingetragen.',
    main_full: 'Die normale Teilnehmerliste ist voll. Nutze den Auswechselspieler-Button.',
    substitute_full: 'Die Auswechselspieler-Liste ist voll.',
    closed: 'Diese Anmeldung ist geschlossen.',
    unknown: 'Diese Aktion kenne ich nicht.',
  };

  await interaction.followUp({
    content: messages[result] || messages.unknown,
    ephemeral: true,
  }).catch(() => null);
}

async function handleGiveawayDeliveryButton(interaction) {
  if (!isOwnerOrAdmin(interaction.user.id)) {
    await interaction.reply({
      content: 'Nur Owner und Admin duerfen Gewinne als erhalten markieren.',
      ephemeral: true,
    });
    return;
  }

  const [, giveawayId, placeRaw] = interaction.customId.split(':');
  const place = Number(placeRaw);
  if (!giveawayId || ![1, 2, 3].includes(place)) {
    await interaction.reply({
      content: 'Dieser Verlosungs-Button ist ungueltig.',
      ephemeral: true,
    });
    return;
  }

  await interaction.deferUpdate();

  let result = '';
  const updated = await updateGiveaway(giveawayId, (giveaway) => {
    if (!giveaway || giveaway.status !== 'drawn') {
      result = 'not_drawn';
      return giveaway;
    }

    const winners = (giveaway.winners || []).map((winner) => ({ ...winner }));
    const index = winners.findIndex((winner) => Number(winner.place) === place);
    if (index < 0) {
      result = 'missing_winner';
      return giveaway;
    }

    if (winners[index].deliveredAt) {
      result = 'already_delivered';
      return giveaway;
    }

    winners[index].deliveredAt = new Date().toISOString();
    winners[index].deliveredBy = interaction.user.id;
    result = 'delivered';

    return {
      ...giveaway,
      winners,
    };
  });

  if (!updated || result === 'not_drawn') {
    await interaction.followUp({
      content: 'Diese Verlosung wurde nicht gefunden oder ist noch nicht ausgelost.',
      ephemeral: true,
    });
    return;
  }

  if (result === 'missing_winner') {
    await interaction.followUp({
      content: `Fuer Platz ${place} gibt es keinen Gewinner.`,
      ephemeral: true,
    });
    return;
  }

  await refreshGiveawayResultMessage(interaction.client, updated);

  await interaction.followUp({
    content: result === 'already_delivered'
      ? `Platz ${place} war bereits als erhalten markiert.`
      : `Platz ${place} wurde als erhalten markiert.`,
    ephemeral: true,
  });
}

async function handleManualSignupCommand(interaction, mode) {
  await interaction.deferReply({ ephemeral: true });

  const user = interaction.options.getUser('spieler', true);
  const messageId = normalizeMessageId(interaction.options.getString('nachrichten_id', true));
  const asSubstitute = interaction.options.getBoolean('auswechselspieler') ?? false;

  if (!messageId) {
    await interaction.editReply('Bitte gib eine gültige Nachrichten-ID oder einen Discord-Nachrichtenlink an.');
    return;
  }

  const target = await findSignupByMessageId(messageId);

  if (!target) {
    await interaction.editReply('Ich finde zu dieser Nachrichten-ID keine gespeicherte Anmeldung.');
    return;
  }

  const result = mode === 'remove'
    ? await removeParticipant(target.id, user.id)
    : await addParticipant(target.id, user.id, { substitute: asSubstitute });

  if (result.status === 'event_missing') {
    await interaction.editReply('Diese Anmeldung konnte nicht aktualisiert werden.');
    return;
  }

  if (result.ok) {
    await refreshSignupMessage(interaction.client, result.event);

    // Auch per Slash-Command protokollieren - sonst waere nur nachvollziehbar,
    // was ueber den Chat geaendert wurde.
    logSignupChange({
      event: result.event,
      actorId: interaction.user.id,
      status: result.status,
      plan: { action: mode === 'remove' ? 'remove' : 'add', playerId: user.id },
      via: 'slash',
    });
  }

  const detail = STATUS_MESSAGES[result.status];
  const content = result.ok || result.status === 'already_joined' || result.status === 'not_joined'
    ? `<@${user.id}> ${detail}.`
    : `${detail || 'Diese Aktion konnte nicht ausgeführt werden'}.`;

  await interaction.editReply({
    content,
    allowedMentions: { parse: [] },
  });
}

function collectEventEditOptions(interaction) {
  const changes = {};
  const changedLabels = [];

  const title = interaction.options.getString('titel');
  if (title !== null) {
    changes.title = title;
    changedLabels.push('Titel');
  }

  const when = interaction.options.getString('wann');
  if (when !== null) {
    changes.when = when;
    changedLabels.push('Wann');
  }

  const description = interaction.options.getString('beschreibung');
  if (description !== null) {
    changes.description = description;
    changedLabels.push('Beschreibung');
  }

  const location = interaction.options.getString('treffpunkt');
  if (location !== null) {
    changes.location = location.trim() === '-' ? '' : location;
    changedLabels.push('Treffpunkt');
  }

  const selectedChannel = interaction.options.getChannel('channel');
  if (selectedChannel) {
    changedLabels.push('Channel');
  }

  const maxParticipants = interaction.options.getInteger('max_teilnehmer');
  if (maxParticipants !== null) {
    changes.maxParticipants = maxParticipants > 0 ? maxParticipants : null;
    changedLabels.push('Max. Teilnehmer');
  }

  const substitutesEnabled = interaction.options.getBoolean('auswechselspieler');
  if (substitutesEnabled !== null) {
    changes.substitutesEnabled = substitutesEnabled;
    changedLabels.push('Auswechselspieler');
  }

  const maxSubstitutes = interaction.options.getInteger('max_auswechselspieler');
  if (maxSubstitutes !== null) {
    changes.maxSubstitutes = maxSubstitutes;
    changedLabels.push('Max. Auswechselspieler');
  }

  const pingTarget = getPingTargetFromMentionable(interaction.options.getMentionable('ping'));
  if (pingTarget) {
    changes.pingTarget = pingTarget;
    changedLabels.push('Ping');
  }

  return { changes, changedLabels, selectedChannel };
}

function collectGiveawayEditOptions(interaction) {
  const changes = {};
  const changedLabels = [];

  const prize1 = interaction.options.getString('platz_1');
  if (prize1 !== null) {
    changes.prize1 = prize1;
    changedLabels.push('Platz 1');
  }

  const prize2 = interaction.options.getString('platz_2');
  if (prize2 !== null) {
    changes.prize2 = prize2;
    changedLabels.push('Platz 2');
  }

  const prize3 = interaction.options.getString('platz_3');
  if (prize3 !== null) {
    changes.prize3 = prize3;
    changedLabels.push('Platz 3');
  }

  const drawAtInput = interaction.options.getString('auslosung') || interaction.options.getString('wann');
  if (drawAtInput !== null) {
    const drawAt = parseGiveawayDrawAt(drawAtInput);
    if (drawAt) {
      changes.drawAt = drawAt;
      changedLabels.push('Auslosung');
    } else {
      changes.invalidDrawAt = true;
      changedLabels.push('Auslosung');
    }
  }

  const pingTarget = getPingTargetFromMentionable(interaction.options.getMentionable('ping'));
  if (pingTarget) {
    changes.pingTarget = pingTarget;
    changedLabels.push('Ping');
  }

  const selectedChannel = interaction.options.getChannel('channel');
  return { changes, changedLabels, selectedChannel };
}

function applyEventEdits(event, changes) {
  const updated = {
    ...event,
    attendees: event.attendees || [],
    substitutes: event.substitutes || [],
  };

  if (hasOwn(changes, 'title')) updated.title = changes.title;
  if (hasOwn(changes, 'when')) updated.when = changes.when;
  if (hasOwn(changes, 'description')) updated.description = changes.description;
  if (hasOwn(changes, 'location')) updated.location = changes.location;
  if (hasOwn(changes, 'maxParticipants')) updated.maxParticipants = changes.maxParticipants;
  if (hasOwn(changes, 'pingTarget')) {
    updated.pingTarget = changes.pingTarget;
    updated.pingRoleId = changes.pingTarget?.type === 'role' ? changes.pingTarget.id : '';
    updated.pingUserId = changes.pingTarget?.type === 'user' ? changes.pingTarget.id : '';
  }

  const hasSubstituteToggle = hasOwn(changes, 'substitutesEnabled');
  const hasSubstituteLimit = hasOwn(changes, 'maxSubstitutes');

  if (hasSubstituteToggle && changes.substitutesEnabled === false) {
    updated.maxSubstitutes = 0;
    updated.substitutes = [];
  } else if (hasSubstituteLimit && changes.maxSubstitutes <= 0) {
    updated.maxSubstitutes = 0;
    updated.substitutes = [];
  } else if (hasSubstituteToggle || hasSubstituteLimit) {
    const currentLimit = Number(updated.maxSubstitutes || 0);
    updated.maxSubstitutes = hasSubstituteLimit
      ? changes.maxSubstitutes
      : currentLimit || 3;
    updated.substitutes = updated.substitutes || [];
  }

  return updated;
}

function applyGiveawayEdits(giveaway, changes) {
  const prizes = [...(giveaway.prizes || [])];
  while (prizes.length < 3) prizes.push('');

  if (hasOwn(changes, 'prize1')) prizes[0] = changes.prize1;
  if (hasOwn(changes, 'prize2')) prizes[1] = changes.prize2;
  if (hasOwn(changes, 'prize3')) prizes[2] = changes.prize3;

  const updated = {
    ...giveaway,
    prizes,
  };

  if (changes.drawAt) updated.drawAt = changes.drawAt.toISOString();
  if (hasOwn(changes, 'pingTarget')) {
    updated.pingTarget = changes.pingTarget;
    updated.pingRoleId = changes.pingTarget?.type === 'role' ? changes.pingTarget.id : null;
    updated.pingUserId = changes.pingTarget?.type === 'user' ? changes.pingTarget.id : '';
  }

  return updated;
}

function getDefaultEventPingTarget() {
  return config.eventRoleId
    ? {
      type: 'role',
      id: config.eventRoleId,
    }
    : null;
}

function getDefaultGiveawayPingTarget() {
  return config.giveawayPingRoleId
    ? {
      type: 'role',
      id: config.giveawayPingRoleId,
    }
    : null;
}

function getPingTargetFromMentionable(mentionable) {
  if (!mentionable?.id) return null;

  return {
    type: isRoleMentionable(mentionable) ? 'role' : 'user',
    id: mentionable.id,
  };
}

function isRoleMentionable(mentionable) {
  return (
    mentionable.rawPosition !== undefined ||
    mentionable.hexColor !== undefined ||
    mentionable.managed !== undefined ||
    mentionable.members !== undefined
  );
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

async function assertCommandPermission(interaction) {
  // Die Rangliste ist oeffentlich - sie zeigt nur, was ohnehin in den
  // Anmeldungen steht, und aendert nichts.
  if (PUBLIC_COMMANDS.has(interaction.commandName)) return true;

  // Beide Owner duerfen alles.
  if (isOwnerOrAdmin(interaction.user.id)) return true;

  if (OWNER_ONLY_COMMANDS.has(interaction.commandName)) {
    await interaction.reply({
      content: interaction.commandName === 'purge'
        ? 'Nachrichten löschen dürfen nur Owner und Co-Owner.'
        : 'Admin-Rechte vergeben dürfen nur Owner und Co-Owner.',
      ephemeral: true,
    });
    return false;
  }

  if (ADMIN_COMMANDS.has(interaction.commandName)) {
    if (await hasAdminRights(interaction.user.id)) return true;

    await interaction.reply({
      content: 'Diesen Command dürfen nur Owner, Co-Owner und eingetragene Admins benutzen.',
      ephemeral: true,
    });
    return false;
  }

  if (EDITOR_ONLY_COMMANDS.has(interaction.commandName)) {
    if (await isEditor(interaction.user.id)) return true;

    await interaction.reply({
      content: 'Im Namen des Bots schreiben dürfen nur Owner, Co-Owner und Editoren.',
      ephemeral: true,
    });
    return false;
  }

  // Alles rund um Anmeldungen: dieselbe Pruefung wie im Chat. Wer per Nachricht
  // tauschen darf, darf auch /eintragen - vorher waren das zwei getrennte
  // Regeln mit unterschiedlichem Ergebnis fuer dieselbe Person.
  if (await canManageSignups(interaction.member || { id: interaction.user.id })) return true;

  await interaction.reply({
    content: 'Du hast keine Berechtigung für diesen Command.',
    ephemeral: true,
  });
  return false;
}

function memberHasRole(interaction, roleId) {
  const roles = interaction.member?.roles;
  if (!roles) return false;
  if (roles.cache?.has(roleId)) return true;
  if (Array.isArray(roles)) return roles.includes(roleId);
  return false;
}

async function assertStateChannel(interaction) {
  if (interaction.channelId === config.stateChannelId) return true;

  await interaction.reply({
    content: `Dieser Command darf nur in <#${config.stateChannelId}> benutzt werden.`,
    ephemeral: true,
  });

  return false;
}

function buildEventAttendeeText(event) {
  const lines = [
    `**${event.title}**`,
    '',
    '**Teilnehmer**',
    formatAttendees(event, 50),
  ];

  if (Number(event.maxSubstitutes || 0) > 0) {
    lines.push(
      '',
      '**Auswechselspieler**',
      formatAttendees({ attendees: event.substitutes || [] }, 50),
    );
  }

  return lines.join('\n');
}

function normalizeMessageId(input) {
  const matches = String(input || '').match(/\d{17,25}/g);
  if (!matches?.length) return '';
  return matches[matches.length - 1];
}

async function findSignupByMessageId(messageId) {
  const events = await listEvents();
  return events.find((event) => event.messageId === messageId) || null;
}

async function findGiveawayByMessageId(messageId) {
  const giveaways = await listGiveaways();
  return giveaways.find((giveaway) => (
    giveaway.messageId === messageId ||
    giveaway.resultMessageId === messageId
  )) || null;
}

async function refreshSignupMessage(client, event) {
  await refreshTypedSignupMessage(client, event);
}

async function refreshStoredStateMessage(client, event) {
  if (!event.channelId || !event.messageId) return;

  const channel = await client.channels.fetch(event.channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return;

  const message = await channel.messages.fetch(event.messageId).catch(() => null);
  if (!message) return;

  await message.edit({
    embeds: [buildStateSignupEmbed(event)],
    components: buildStateSignupComponents(event),
    allowedMentions: { parse: [] },
  });
}

async function deleteStoredMessage(client, channelId, messageId) {
  if (!channelId || !messageId) return;

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return;

  const message = await channel.messages.fetch(messageId).catch(() => null);
  if (!message) return;

  await message.delete().catch(() => null);
}

module.exports = {
  handleInteraction,
  // Nur zum Pruefen der Rechtematrix. Die Regeln sind ueber mehrere Faelle
  // verteilt, deshalb wird die echte Funktion getestet statt sie nachzubauen.
  assertCommandPermission,
};
