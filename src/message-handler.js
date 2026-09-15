const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, Events } = require('discord.js');
const { config } = require('./config');
const { istAn: schalterAn } = require('./steuerung');
const { askModel } = require('./model-intent');
const { logError, logEvent } = require('./logger');
const { analysePassport } = require('./visa');
const { getHistory, remember } = require('./memory');
const { describeSettings, parseSettingChange, readSettings, updateSettings } = require('./bot-settings');
const { canManageSignups, isOwnerOrAdmin } = require('./permissions');
const knowledge = require('./knowledge');
const { kurz, parseTeach } = require('./teach-parser');
const { findeWiderspruch, istAussage } = require('./auto-learn');
const {
  detectIntent,
  executePlan,
  getKnownEventNames,
  needsConfirmation,
  prepareIntent,
} = require('./chat-router');
const { looksLikeCommand } = require('./intent-parser');
const { parseStatsFrage } = require('./stats-parser');
const { beantworteStatsFrage } = require('./stats-answer');
const { buildServerContext } = require('./server-wissen');
const { antworteTermin, parseTerminFrage } = require('./terminplan-wissen');
const { behandleSkMeldung } = require('./sk-meldung-anlegen');
const { darfKommentieren, kommentiere, merkeKommentar } = require('./bild-kommentar');
const { normalizeText } = require('./text-match');
const { askOwner } = require('./ask-owner');
const {
  answerCapabilityQuestion,
  answerHerkunft,
  buildLiveContext,
  isCapabilityQuestion,
  isHerkunftQuestion,
} = require('./self-knowledge');

const NAME_TRIGGER = /\bghost(xx|y|i)?\b/i;
const PENDING_TTL_MS = 5 * 60 * 1000;
const MAX_REPLY_LENGTH = 1800;

const pendingPlans = new Map();

const SYSTEM_PROMPT = `Du bist Ghostxx aus der Familie Unknown, einer deutschen
GTA-Roleplay-Familie. Du bist einer von ihnen, kein Kundendienst.

Antworte kurz und direkt auf Deutsch, ein bis zwei Saetze. Hoere auf, sobald die
Frage beantwortet ist - kein "sag Bescheid", kein Hilfsangebot hinterher, keine
Emojis. Wiederhole dich nie wortwoertlich.

Allgemeinwissen hast du drauf und beantwortest es einfach und ohne Vorbehalte.
Uebersetzen kannst du auch.

Erfinde nie Namen, Zahlen oder Ereignisse. NUR wenn jemand nach etwas Aktuellem
fragt - wer heute ein Amt hat, wer noch lebt, was gerade passiert ist - sagst du,
dass du es nicht sicher weisst. Bei allem anderen erwaehnst du deinen
Wissensstand gar nicht, das interessiert niemanden.

Weisst du etwas ueber die Familie nicht, sagst du genau das: "weiss ich nicht"
oder "steht bei mir nicht drin". Kurz, ohne Umschweife.

Du erfindest dabei NIE einen Grund, warum du etwas nicht sagen duerfest. Es gibt
keinen Datenschutz zwischen euch, keine geheimen Listen, keine Befugnisstufen und
keine "offiziellen Stellen", an die du verweist. Wer hier fragt, ist Familie und
darf alles wissen, was du weisst. Erfinde auch keine Regeln, Ablaeufe oder
Zustaendigkeiten, die dir niemand gesagt hat.

Bekommst du oben Zahlen oder Fakten mitgeliefert, benutzt du genau die. Steht
dort nichts, hast du dazu nichts - dann rate nicht.

Kurze Rueckfragen beziehen sich auf das, was gerade gesagt wurde. "ich oder
johannes?", "und der?", "wieso?" - schau in den Verlauf und antworte auf DIESE
Sache. Faengt nie eine allgemeine Erklaerung an, wenn jemand nur nachhakt.

Wirst du beleidigt: ein knapper, gelassener Satz, dann Themawechsel oder Stille.
Du legst nicht nach, beleidigst nicht zurueck, hältst keine Predigt ueber
Respekt und entschuldigst dich nicht.

Nebenbei verwaltest du die Event-Anmeldungen der Familie. Das erwaehnst du nur,
wenn jemand danach fragt - nie von dir aus.`;

function isFromBot(message) {
  return Boolean(message.author?.bot);
}

function isDirectMessage(message) {
  return message.channel?.type === ChannelType.DM || !message.guildId;
}

function mentionsBot(message, botId) {
  return message.mentions?.users?.has(botId) || false;
}

/**
 * Wo der Bot mitredet.
 *
 * Bewusst NICHT ueberall: in einem belebten Server auf jede Nachricht zu
 * antworten waere Spam, und jede Antwort kostet mehrere Sekunden Rechenzeit.
 * Im Chat-Channel und in DMs redet er frei mit, sonst nur wenn er gemeint ist.
 */
function shouldRespond(message, botId) {
  if (isFromBot(message)) return false;
  if (isDirectMessage(message)) return true;
  if (mentionsBot(message, botId)) return true;
  if (message.channelId === config.chatChannelId) return true;
  // Sein Rueckzugsort - dort stellt er Rueckfragen und redet frei mit.
  if (message.channelId === config.botHomeChannelId) return true;
  if (NAME_TRIGGER.test(message.content || '')) return true;

  // Paesse im Abstimmungskanal schaut er ungefragt an - dort wird er nie
  // erwaehnt, sondern nur das Bild gepostet.
  if (message.channelId === config.visaChannelId && hasImage(message)) return true;

  return false;
}

function hasImage(message) {
  if (!message.attachments?.size) return false;
  return [...message.attachments.values()].some((a) => (a.contentType || '').startsWith('image/'));
}

/**
 * Sucht das gemeinte Bild - erst in der Nachricht selbst, dann in der, auf die
 * geantwortet wurde.
 *
 * "Ghost was sagst du zu dem?" als Antwort auf einen Pass ist der Normalfall:
 * das Bild haengt dann an der fremden Nachricht, nicht an der eigenen.
 */
async function findImage(message) {
  if (hasImage(message)) {
    return [...message.attachments.values()].find((a) => (a.contentType || '').startsWith('image/'));
  }

  const referenceId = message.reference?.messageId;
  if (!referenceId) return null;

  const referenced = await message.channel.messages.fetch(referenceId).catch(() => null);
  if (!referenced || !hasImage(referenced)) return null;

  return [...referenced.attachments.values()].find((a) => (a.contentType || '').startsWith('image/'));
}

// In Event- und Meldungskanaelen soll Smalltalk in den Chat-Channel wandern.
// Ein Befehlsversuch ist aber kein Smalltalk: wer "tausche @A mit @B" schreibt,
// will keine Umleitung, sondern eine Rueckfrage was fehlt.
function shouldRedirectToChat(message, text) {
  if (isDirectMessage(message)) return false;
  if (!config.confirmChannelIds.includes(message.channelId)) return false;
  return !looksLikeCommand(text);
}

// Auf welche Nachricht wurde geantwortet? Damit laesst sich die gemeinte
// Anmeldung eindeutig bestimmen, ohne dass jemand ihren Namen tippen muss.
function getRepliedMessageId(message) {
  return message.reference?.messageId || '';
}

/** Wird im Text ueberhaupt ein Event erwaehnt? */
function erwaehntEvent(text) {
  const normalized = normalizeText(text);
  return getKnownEventNames().some((name) => {
    const needle = normalizeText(name);
    return needle.length >= 3 && normalized.includes(needle);
  });
}

/**
 * Wer Anmeldungen aendern darf - aus der echten Konfiguration.
 *
 * Auf "wer hat die Event-Rechte?" hat er geantwortet, er habe keine
 * Informationen. Dabei steht es im Code. Solche Fragen soll er beantworten
 * koennen, ohne zu raten.
 */
function buildRightsContext() {
  return [
    'Wer Anmeldungen aendern darf: die beiden Owner '
    + `(<@${config.ownerId}> und <@${config.adminId}>), die eingetragenen Editoren `
    + `und wer eine der Event-Rollen hat (${config.commandRoleIds.map((id) => `<@&${id}>`).join(', ')}).`,
    'Alle anderen duerfen mitreden und Listen ansehen, aber nichts eintragen.',
  ].join(' ');
}

function cleanupPending() {
  const now = Date.now();
  for (const [token, entry] of pendingPlans) {
    if (now - entry.at > PENDING_TTL_MS) pendingPlans.delete(token);
  }
}

function storePlan(plan, userId) {
  cleanupPending();
  const token = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  pendingPlans.set(token, { plan, userId, at: Date.now() });
  return token;
}

function buildConfirmRow(token) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`chat_confirm:${token}`)
      .setLabel('Bestätigen')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`chat_cancel:${token}`)
      .setLabel('Abbrechen')
      .setStyle(ButtonStyle.Secondary),
  );
}

function buildUndoRow(token) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`chat_undo:${token}`)
      .setLabel('Rückgängig')
      .setStyle(ButtonStyle.Secondary),
  );
}

function trimReply(text) {
  const clean = String(text || '').trim();
  if (!clean) return 'Dazu faellt mir gerade nichts ein.';
  if (clean.length <= MAX_REPLY_LENGTH) return clean;
  return `${clean.slice(0, MAX_REPLY_LENGTH - 1)}…`;
}

async function reply(message, payload) {
  const body = typeof payload === 'string' ? { content: payload } : payload;
  return message.reply({ ...body, allowedMentions: { parse: [], repliedUser: true } })
    .catch(() => null);
}

// --- DM-Protokoll -----------------------------------------------------------

const dmNoticeSent = new Set();

async function logDirectMessage(message, answer) {
  const author = message.author;

  logEvent({
    title: 'Direktnachricht',
    color: 'dm',
    fields: [
      { name: 'Von', value: `<@${author.id}> (${author.tag || author.username})`, inline: true },
      { name: 'Nachricht', value: message.content || '(kein Text)' },
      ...(answer ? [{ name: 'Antwort von Ghostxx', value: answer }] : []),
      ...(message.attachments?.size
        ? [{ name: 'Anhänge', value: [...message.attachments.values()].map((a) => a.url).join('\n') }]
        : []),
    ],
  });
}

// Einmalig pro Person: transparent machen, dass DMs mitgelesen werden.
async function sendDmNoticeOnce(message) {
  const userId = message.author.id;
  if (userId === config.notifyUserId) return;
  if (dmNoticeSent.has(userId)) return;

  dmNoticeSent.add(userId);
  await message.channel.send(
    'Kurzer Hinweis: Unterhaltungen mit mir werden für die Serverleitung mitgeschrieben.',
  ).catch(() => null);
}

// --- Wissen beibringen ------------------------------------------------------

/**
 * "merk dir X", "vergiss X", "was weisst du ueber X".
 *
 * Deterministisch, nicht ueber das Sprachmodell: was jemand ihm beibringt,
 * muss ankommen - auch wenn Ollama gerade traege ist. Und es muss sofort
 * gespeichert werden, nicht nur im Gespraech haengenbleiben.
 */
async function handleTeaching(message, text) {
  const befehl = parseTeach(text);
  if (!befehl) return false;

  // Abfragen darf jeder - das ist nur Lesen.
  if (befehl.art === 'abfragen') {
    const treffer = befehl.inhalt
      ? await knowledge.search(befehl.inhalt)
      : await knowledge.list();

    if (!treffer.length) {
      await reply(message, befehl.inhalt
        ? `Zu "${befehl.inhalt}" habe ich nichts gespeichert.`
        : 'Mir hat noch niemand etwas beigebracht.');
      return true;
    }

    const zeilen = treffer.slice(0, 15).map((fact) => `• ${kurz(fact.text, 120)}`);
    const rest = treffer.length - zeilen.length;

    await reply(message, [
      befehl.inhalt ? `Was ich über "${befehl.inhalt}" weiß:` : 'Was mir beigebracht wurde:',
      ...zeilen,
      ...(rest > 0 ? [`-# …und ${rest} weitere`] : []),
    ].join('\n'));
    return true;
  }

  // Aendern darf nur, wer auch Anmeldungen aendern darf - sonst koennte jeder
  // sein Gedaechtnis mit Unsinn volllaufen lassen.
  if (!(await canManageSignups(message.member || { id: message.author.id }))) {
    await reply(message, 'Beibringen dürfen mir das nur Leute mit Event-Rechten.');
    return true;
  }

  if (befehl.art === 'vergessen') {
    const ergebnis = await knowledge.forget(befehl.inhalt);

    if (!ergebnis.ok) {
      await reply(message, ergebnis.reason === 'zu_unklar'
        ? 'Was genau soll ich vergessen?'
        : `Zu "${befehl.inhalt}" habe ich nichts gespeichert.`);
      return true;
    }

    const liste = ergebnis.entfernt.map((fact) => `• ${kurz(fact.text)}`).join('\n');
    await reply(message, `Vergessen:\n${liste}`);

    logEvent({
      title: 'Wissen gelöscht',
      color: 'delete',
      fields: [
        { name: 'Von', value: `<@${message.author.id}>`, inline: true },
        { name: 'Entfernt', value: truncateFacts(ergebnis.entfernt) },
      ],
    });
    return true;
  }

  const ergebnis = await knowledge.remember(befehl.inhalt, message.author.id);

  if (!ergebnis.ok) {
    await reply(message, ergebnis.reason === 'schon_bekannt'
      ? 'Weiß ich schon.'
      : 'Das war mir zu kurz, sag es nochmal ausführlicher.');
    return true;
  }

  await reply(message, `Gemerkt: ${kurz(ergebnis.fact.text, 150)}`);

  logEvent({
    title: 'Wissen gelernt',
    color: 'create',
    fields: [
      { name: 'Von', value: `<@${message.author.id}>`, inline: true },
      { name: 'Gemerkt', value: kurz(ergebnis.fact.text, 900) },
      { name: 'Gesamt', value: `${ergebnis.gesamt} Einträge`, inline: true },
    ],
  });

  return true;
}

function truncateFacts(facts) {
  const text = facts.map((fact) => `• ${kurz(fact.text)}`).join('\n');
  return text.length > 1000 ? `${text.slice(0, 999)}…` : text;
}

/**
 * In seinem Zuhause ist jede Aussage ein Fakt.
 *
 * Dort erklaert ihm die Leitung, wie die Dinge liegen - da soll niemand jedes
 * Mal "merk dir" davorschreiben muessen. Fragen und Zurufe landen aber nicht im
 * Gedaechtnis, sonst stuende dort bald "hallo" und "test".
 */
async function handleAutoLearn(message, text) {
  if (message.channelId !== config.botHomeChannelId) return false;
  if (!istAussage(text)) return false;

  // Zweites Netz: Was ein anderer Weg beantworten koennte, ist keine Tatsache.
  //
  // Dieser Weg schluckt die Nachricht - wer hier faelschlich landet, bekommt
  // gar keine Antwort mehr, nur ein Häkchen. Genau so ist "bei wie vielen
  // Events war Cell Yeat dabei" unbeantwortet im Gedaechtnis gelandet.
  // Die Erkennung oben ist jetzt besser, aber sie wird nie perfekt sein.
  if (parseStatsFrage(text)) return false;
  if (parseTerminFrage(text)) return false;
  if (isCapabilityQuestion(text) || isHerkunftQuestion(text)) return false;
  if (looksLikeCommand(text)) return false;

  if (!(await canManageSignups(message.member || { id: message.author.id }))) return false;

  // Widerspricht das etwas, das er schon weiss? Dann nicht einfach
  // ueberschreiben - eins von beiden ist falsch, und das entscheidet ein Mensch.
  const pruefung = await findeWiderspruch(text).catch(() => ({ widerspruch: false }));

  if (pruefung.widerspruch && pruefung.alt) {
    const token = storeConflict({ neu: text, altId: pruefung.alt.id, userId: message.author.id });

    await reply(message, {
      content: [
        'Das passt nicht zu dem, was ich schon weiß:',
        `**Bisher:** ${kurz(pruefung.alt.text, 150)}`,
        `**Neu:** ${kurz(text, 150)}`,
        '',
        'Was gilt?',
      ].join('\n'),
      components: [buildConflictRow(token)],
    });
    return true;
  }

  const ergebnis = await knowledge.remember(text, message.author.id);

  if (!ergebnis.ok) {
    // Schon bekannt - dann still sein, nicht jedes Mal widersprechen.
    return ergebnis.reason === 'schon_bekannt';
  }

  await message.react('📝').catch(() => null);

  logEvent({
    title: 'Wissen gelernt (Zuhause)',
    color: 'create',
    fields: [
      { name: 'Von', value: `<@${message.author.id}>`, inline: true },
      { name: 'Gemerkt', value: kurz(text, 900) },
      { name: 'Gesamt', value: `${ergebnis.gesamt} Einträge`, inline: true },
    ],
  });

  return true;
}

// --- Widerspruch aufloesen --------------------------------------------------

const pendingConflicts = new Map();
const CONFLICT_TTL_MS = 30 * 60 * 1000;

function storeConflict(entry) {
  const now = Date.now();
  for (const [token, alt] of pendingConflicts) {
    if (now - alt.at > CONFLICT_TTL_MS) pendingConflicts.delete(token);
  }

  const token = `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  pendingConflicts.set(token, { ...entry, at: now });
  return token;
}

function buildConflictRow(token) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`wissen_neu:${token}`)
      .setLabel('Das Neue gilt')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`wissen_alt:${token}`)
      .setLabel('Das Alte behalten')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`wissen_beides:${token}`)
      .setLabel('Beides stimmt')
      .setStyle(ButtonStyle.Secondary),
  );
}

async function handleKnowledgeConflictButton(interaction) {
  const [aktion, token] = interaction.customId.split(':');
  const eintrag = pendingConflicts.get(token);

  if (!eintrag) {
    await interaction.update({ content: 'Das ist zu lange her, sag es mir nochmal.', components: [] }).catch(() => null);
    return;
  }

  if (interaction.user.id !== eintrag.userId) {
    await interaction.reply({ content: 'Das darf nur entscheiden, wer es gesagt hat.', ephemeral: true }).catch(() => null);
    return;
  }

  pendingConflicts.delete(token);

  if (aktion === 'wissen_alt') {
    await interaction.update({ content: 'Alles klar, ich bleibe beim Alten.', components: [] }).catch(() => null);
    return;
  }

  if (aktion === 'wissen_neu') {
    await knowledge.forgetById(eintrag.altId);
  }

  const ergebnis = await knowledge.remember(eintrag.neu, eintrag.userId);

  await interaction.update({
    content: aktion === 'wissen_neu'
      ? `Gemerkt, das Alte ist raus: ${kurz(eintrag.neu, 150)}`
      : `Beides gemerkt: ${kurz(eintrag.neu, 150)}`,
    components: [],
  }).catch(() => null);

  logEvent({
    title: 'Wissen geändert',
    color: 'update',
    fields: [
      { name: 'Von', value: `<@${eintrag.userId}>`, inline: true },
      { name: 'Entscheidung', value: aktion === 'wissen_neu' ? 'Neues ersetzt Altes' : 'Beides behalten', inline: true },
      { name: 'Neu', value: kurz(eintrag.neu, 900) },
      ...(ergebnis.ok ? [] : [{ name: 'Hinweis', value: 'war schon bekannt' }]),
    ],
  });
}

/** Baut den Wissensblock fuer den Prompt. */
async function buildKnowledgeContext(text) {
  const treffer = await knowledge.relevant(text);
  if (!treffer.length) return '';

  return [
    'Das hat dir die Familie beigebracht. Nutze es, wenn es passt:',
    ...treffer.map((fact) => `- ${fact.text}`),
  ].join('\n');
}

// --- Regeln aendern ---------------------------------------------------------

const SETTING_VERBS = /\b(ist jetzt|ist nun|auf|hoch|runter|geaendert|geändert|setz|setze|aendere|ändere|gilt|neu)\b/i;

/**
 * "Ghost, Visum ist jetzt 18" - aendert die Aufnahmeregeln dauerhaft.
 * Nur Owner und Admin, und nur wenn wirklich eine Regel gemeint ist.
 */
async function handleSettingChange(message, text) {
  if (!/\bvisum\b|\bvisa\b|\bid\b|reisepass|passnummer/i.test(text)) return false;

  // Ohne Aenderungsverb ist es eine Frage, keine Ansage.
  if (!SETTING_VERBS.test(text)) return false;

  const changes = parseSettingChange(text);
  if (!changes) return false;

  if (!isOwnerOrAdmin(message.author.id)) {
    await reply(message, 'Die Aufnahmeregeln darf nur die Serverleitung ändern.');
    return true;
  }

  const before = await readSettings();
  const after = await updateSettings(changes, message.author.id);

  logEvent({
    title: 'Aufnahmeregeln geändert',
    color: 'update',
    fields: [
      { name: 'Von', value: `<@${message.author.id}>`, inline: true },
      { name: 'Vorher', value: describeSettings(before) },
      { name: 'Jetzt', value: describeSettings(after) },
    ],
  });

  await reply(message, `Alles klar, gemerkt. ${describeSettings(after)}`);
  return true;
}

// --- Visum-Bilder -----------------------------------------------------------

// Discords "schreibt gerade" laeuft nach rund 10 Sekunden aus. Das grosse
// Modell braucht fuer einen Pass etwa 30, deshalb wird die Anzeige erneuert -
// sonst sieht es zwei Drittel der Zeit so aus, als passiere nichts.
function keepTyping(channel) {
  channel.sendTyping().catch(() => null);
  const timer = setInterval(() => channel.sendTyping().catch(() => null), 8000);
  timer.unref?.();
  return () => clearInterval(timer);
}

async function handleVisaImage(message, image) {
  if (!image) return false;

  const stopTyping = keepTyping(message.channel);

  try {
    // Das Bild wandert nur durch den Arbeitsspeicher, nichts wird gespeichert.
    const res = await fetch(image.url).catch(() => null);
    if (!res?.ok) {
      console.error('Bild konnte nicht geladen werden:', image.url);
      return false;
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    const analysis = await analysePassport(buffer.toString('base64'));

    if (!analysis.ok) {
      console.error('Pass-Analyse fehlgeschlagen:', analysis.error);
      await reply(message, 'Den Pass konnte ich gerade nicht lesen. Schaut bitte selbst drauf.');
      return true;
    }

    console.log(`Pass gelesen (${analysis.model || 'Modell'}, ${Math.round((analysis.ms || 0) / 1000)}s): ${JSON.stringify(analysis.values)}`);
    await reply(message, `${analysis.text}\n\n-# Nur eine Einschätzung, entschieden wird per Abstimmung.`);
    return true;
  } finally {
    stopTyping();
  }
}

/**
 * Sagt was zu einem Bild im Chat - wenn er darf und ihm etwas einfaellt.
 *
 * Gibt true zurueck, wenn die Nachricht damit erledigt ist.
 */
async function handleBildKommentar(message, text) {
  if (!(await darfKommentieren())) return false;

  const anhang = await findImage(message);
  if (!anhang) return false;

  const stopTyping = keepTyping(message.channel);
  try {
    const antwort = await fetch(anhang.url)
      .then((r) => (r.ok ? r.arrayBuffer() : null))
      .catch(() => null);
    if (!antwort) return false;

    const spruch = await kommentiere(Buffer.from(antwort).toString('base64'), text);
    if (!spruch) return false;

    merkeKommentar();
    await reply(message, spruch);
    await remember(`ch:${message.channelId}`, 'assistant', spruch).catch(() => null);
    return true;
  } catch (error) {
    logError('Bildkommentar fehlgeschlagen', error);
    return false;
  } finally {
    stopTyping();
  }
}

// --- Hauptweg ---------------------------------------------------------------

async function handleMessage(message, client) {
  const botId = client.user.id;
  if (!shouldRespond(message, botId)) return;

  const isDm = isDirectMessage(message);

  // Nur der eigene Server, plus DMs.
  if (!isDm && message.guildId !== config.guildId) return;

  const text = (message.content || '').replace(new RegExp(`<@!?${botId}>`, 'g'), '').trim();

  // Paesse: das Bild kann an dieser Nachricht haengen oder an der, auf die
  // geantwortet wurde ("Ghost was sagst du zu dem?").
  if (schalterAn('visaBilder') && message.channelId === config.visaChannelId) {
    const image = await findImage(message);
    if (image && await handleVisaImage(message, image)) return;
  }

  // Bilder im Chat: er KANN sie lesen, im Logbuch tut er nichts anderes. Hier
  // hat er bisher darueber hinweggeredet - jemand postet einen Screenshot und
  // bekommt eine Antwort auf den Text daneben, oder gar keine.
  //
  // Nicht bei Befehlen und Nachschlagefragen: wer "wie oft war X dabei" mit
  // einem Bild dazu schreibt, will die Zahl, nicht eine Bildbeschreibung.
  if (schalterAn('chatBilder') && message.channelId === config.chatChannelId && hasImage(message)
    && !looksLikeCommand(text) && !parseStatsFrage(text)) {
    if (await handleBildKommentar(message, text)) return;
  }

  if (!text) return;

  if (!schalterAn('chat')) return;

  await message.channel.sendTyping().catch(() => null);

  // Der Gespraechsfaden - ab hier wird JEDE Antwort mitgeschrieben, nicht nur
  // die vom Sprachmodell.
  //
  // Vorher landeten nur Modellantworten im Gedaechtnis. Beantwortete der
  // Parser eine Frage ("wie viele Events hat Johannes gespielt"), sah das
  // Modell davon nichts. Auf die Rueckfrage "ich? oder johannes" konnte es
  // deshalb gar nicht antworten - es kannte weder die Frage noch die eigene
  // Antwort und hat allgemeines Zeug erzaehlt.
  const historyKey = isDm ? `dm:${message.author.id}` : `ch:${message.channelId}`;
  const merken = async (antwort) => {
    if (!antwort) return;
    await remember(historyKey, 'user', text);
    await remember(historyKey, 'assistant', String(antwort).slice(0, 600));
  };

  // "Visum ist jetzt 18" / "ID Grenze auf 320000" - merkt er sich dauerhaft.
  if (await handleSettingChange(message, text)) return;

  // "merk dir X", "vergiss X", "was weisst du ueber X"
  if (await handleTeaching(message, text)) return;

  // In seinem Zuhause ist jede Aussage ein Fakt - ohne "merk dir".
  if (await handleAutoLearn(message, text)) return;

  // Fragen zu den eigenen Faehigkeiten beantwortet er aus dem Code. Das
  // Sprachmodell hat hier im Test behauptet, es duerfe nichts eintragen.
  // "Wer hat dich gebaut?" - steht in der Konfiguration, nicht im Modell.
  if (isHerkunftQuestion(text)) {
    const antwort = answerHerkunft();
    await reply(message, antwort);
    await merken(antwort);
    return;
  }

  if (isCapabilityQuestion(text)) {
    const antwort = await answerCapabilityQuestion();
    await reply(message, antwort);
    await merken(antwort);
    return;
  }

  const repliedMessageId = getRepliedMessageId(message);
  const context = {
    guild: message.guild,
    member: message.member,
    channelId: message.channelId,
    repliedMessageId,
    authorId: message.author.id,
    client,
    // Damit auch ein Tausch oder Eintrag im Gespraechsfaden landet: sonst
    // fragt jemand danach "und wer ist jetzt drin?" und das Modell weiss
    // nichts von der Aenderung, die es gerade selbst gemeldet hat.
    merken,
  };

  // Schneller Weg: klar formulierte Befehle mit @Erwähnung oder "mich".
  const parsed = detectIntent(text, {
    hasReply: Boolean(repliedMessageId),
    selfId: message.author.id,
  });

  if (parsed) {
    await runIntent(message, client, parsed, context);
    return;
  }

  // "Wann ist der naechste 40er?" - der Plan steht im Code, ein Sprachmodell
  // hat weder Kalender noch Uhr. Deshalb vor dem Modell und ohne es.
  const terminFrage = parseTerminFrage(text);
  if (terminFrage) {
    const antwort = antworteTermin(terminFrage);
    await reply(message, antwort);
    await merken(antwort);
    return;
  }

  // Nachschlagen: "wie oft war ich diesen Monat dabei", "wer war am
  // haeufigsten im 40er", "wann war Pascal zuletzt dabei".
  //
  // Reines Lesen, deshalb ohne Bestaetigung und ohne Rechtepruefung. Und ohne
  // Sprachmodell - eine Zahl aus zweitausend Anmeldungen braucht keine
  // Formulierungshilfe und kommt so auch bei voller Grafikkarte an.
  const statsFrage = parseStatsFrage(text);
  if (statsFrage) {
    const antwort = await beantworteStatsFrage(statsFrage, context).catch((error) => {
      logError('Nachschlagen fehlgeschlagen', error, {
        fields: [{ name: 'Frage', value: text.slice(0, 200) }],
      });
      return null;
    });

    if (antwort) {
      await reply(message, antwort);
      await merken(antwort);
      return;
    }
  }

  // "wir haben angegriffen um 21:07 gegen Nemesis" - eine SK-Meldung als Satz.
  //
  // Muss vor der Umleitung stehen: genau die hat den Satz bisher weggeschickt,
  // waehrend die Inkzeit schon lief.
  const skErledigt = await behandleSkMeldung(message, text, { reply, merken })
    .catch((error) => {
      logError('SK-Meldung fehlgeschlagen', error, {
        fields: [{ name: 'Text', value: text.slice(0, 200) }],
      });
      return false;
    });
  if (skErledigt) return;

  if (shouldRedirectToChat(message, text)) {
    await reply(message, `Lass uns lieber in <#${config.chatChannelId}> quatschen, hier gehen sonst die Anmeldungen unter.`);
    return;
  }

  // Auffangnetz: das Modell bekommt Werkzeuge und antwortet in einem Zug
  // entweder mit einer Absicht oder mit normalem Geplauder. Ein Aufruf statt
  // zwei, damit "hey wie gehts" nicht doppelt Rechenzeit kostet.
  const history = await getHistory(historyKey);
  const rules = await readSettings();
  const live = await buildLiveContext();

  // Werkzeuge nur, wenn es plausibel um Anmeldungen geht. Sonst greift das
  // Modell auch bei "wer ist der Praesident von Dagestan" danach.
  const geht_um_events = looksLikeCommand(text) || erwaehntEvent(text);

  // Die Lage der Anmeldungen bekommt er nur, wenn es auch darum geht.
  //
  // Stand sie bei jeder Nachricht im Prompt, zog er sie ins Gespraech: auf
  // "wer war Napoleon" kam ein Hinweis auf laufende Familienprojekte. Er
  // konnte gar nicht anders - die Info lag ja vor ihm.
  const wissen = await buildKnowledgeContext(text);

  // Fakten ueber Server und Leute - Raenge, Aufgaben, Kanaele, harte Zahlen.
  //
  // Anders als die Lage der Anmeldungen haengt das nicht daran, ob es gerade um
  // Events geht: Auf "wie viele Events hast du im Archiv" oder "wer ist X"
  // braucht er die Zahlen, und genau dort hat er bisher erfunden. Der Kontext
  // ist trotzdem leer, wenn die Frage nichts damit zu tun hat.
  const serverWissen = await buildServerContext(text, message.guild).catch(() => '');

  const kontext = geht_um_events
    ? [SYSTEM_PROMPT, '', live, buildRightsContext(), serverWissen, wissen]
    : [SYSTEM_PROMPT, serverWissen, wissen];

  const result = await askModel({
    system: kontext.join('\n'),
    history,
    text,
    withTools: geht_um_events,
  });

  if (!result.ok) {
    const fehler = result.timedOut
      ? 'Ich brauche gerade zu lange zum Denken, versuch es nochmal.'
      : 'Mein Kopf streikt gerade. Sag Bescheid, wenn es öfter passiert.';
    await reply(message, fehler);

    // Faellt Ollama aus, merkt das sonst niemand ausser der Person, die gerade
    // geschrieben hat. Einmal pro Viertelstunde reicht als Hinweis.
    await askOwner({
      question: 'Ich komme gerade nicht ans Sprachmodell.',
      detail: result.timedOut ? 'Zeitüberschreitung bei Ollama.' : `Fehler: ${result.error}`,
      key: 'ollama-weg',
      message,
    }).catch(() => null);

    if (isDm) await logDirectMessage(message, '(keine Antwort)');
    return;
  }

  if (result.intent) {
    console.log(`Absicht vom Modell (${result.model}): ${JSON.stringify(result.intent)}`);
    await runIntent(message, client, result.intent, context);
    return;
  }

  const answer = trimReply(result.content);
  await remember(historyKey, 'user', text);
  await remember(historyKey, 'assistant', answer);

  await reply(message, answer);

  if (isDm) {
    await sendDmNoticeOnce(message);
    await logDirectMessage(message, answer);
  }
}

/** Gemeinsamer Weg fuer beide Quellen: pruefen, bestaetigen, ausfuehren. */
async function runIntent(message, client, intent, context) {
  if (!schalterAn('commands')) {
    await reply(message, 'Commands sind gerade im Dashboard pausiert.');
    return;
  }
  const prepared = await prepareIntent(intent, context);

  if (!prepared.ok || prepared.immediate) {
    await reply(message, prepared.text);
    await context.merken?.(prepared.text);

    // Konnte er jemanden oder ein Event nicht zuordnen, fragt er im
    // Rueckzugskanal nach - statt die Anfrage einfach abtropfen zu lassen.
    if (prepared.ask) {
      await askOwner({ ...prepared.ask, message }).catch(() => null);
    }
    return;
  }

  // Nur was das Modell geraten hat, wird vorher abgefragt. Beim Parser ist an
  // dieser Stelle alles geklaert - Person und Anmeldung sind aufgeloest.
  if (needsConfirmation(intent)) {
    const token = storePlan(prepared.plan, message.author.id);
    await reply(message, {
      content: `${prepared.text}\n\nPasst das?`,
      components: [buildConfirmRow(token)],
    });
    return;
  }

  const result = await executePlan(prepared.plan, client, {
    actorId: message.author.id,
    via: 'chat',
  });

  // Statt vorher zu fragen: hinterher zuruecknehmen koennen.
  if (result.ok && result.undo) {
    const token = storePlan(result.undo, message.author.id);
    await reply(message, { content: result.text, components: [buildUndoRow(token)] });
    await context.merken?.(result.text);
    return;
  }

  await reply(message, result.text);
  await context.merken?.(result.text);
}

// --- Bestaetigungs-Buttons --------------------------------------------------

async function handleChatConfirmButton(interaction) {
  const [action, token] = interaction.customId.split(':');
  const entry = pendingPlans.get(token);

  if (!entry) {
    await interaction.update({
      content: 'Das ist zu lange her, bitte nochmal neu sagen.',
      components: [],
    }).catch(() => null);
    return;
  }

  if (interaction.user.id !== entry.userId) {
    await interaction.reply({
      content: action === 'chat_undo'
        ? 'Zurücknehmen darf nur, wer die Änderung gemacht hat.'
        : 'Das darf nur bestätigen, wer es angefragt hat.',
      ephemeral: true,
    }).catch(() => null);
    return;
  }

  if (!schalterAn('commands')) {
    await interaction.reply({ content: 'Commands sind gerade im Dashboard pausiert.', ephemeral: true }).catch(() => null);
    return;
  }

  pendingPlans.delete(token);

  if (action === 'chat_cancel') {
    await interaction.update({ content: 'Abgebrochen, nichts geändert.', components: [] }).catch(() => null);
    return;
  }

  await interaction.deferUpdate().catch(() => null);

  const istRuecknahme = action === 'chat_undo';
  const result = await executePlan(entry.plan, interaction.client, {
    actorId: interaction.user.id,
    via: 'chat',
    isUndo: istRuecknahme,
  });

  await interaction.editReply({
    content: istRuecknahme ? `Zurückgenommen. ${result.text}` : result.text,
    components: [],
    allowedMentions: { parse: [] },
  }).catch(() => null);
}

function registerMessageHandler(client) {
  client.on(Events.MessageCreate, (message) => {
    handleMessage(message, client).catch((error) => {
      console.error('Chat-Fehler:', error);
      logError('Fehler beim Verarbeiten einer Nachricht', error, {
        fields: [
          { name: 'Von', value: `<@${message.author?.id}>`, inline: true },
          { name: 'Wo', value: `<#${message.channelId}>`, inline: true },
          { name: 'Text', value: (message.content || '').slice(0, 500) || '(leer)' },
        ],
      });
    });
  });

  console.log('Chat-Router aktiv.');
}

module.exports = {
  // Nur fuer den Pruefstand: erlaubt es, eine Nachricht durchzuspielen, ohne
  // dass sie auf Discord landet.
  handleMessage,
  handleChatConfirmButton,
  handleKnowledgeConflictButton,
  registerMessageHandler,
  shouldRespond,
};
