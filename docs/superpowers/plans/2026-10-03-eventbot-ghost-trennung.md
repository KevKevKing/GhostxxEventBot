# Event-Bot von KI und Logbuch befreien — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aus `GhostxxEventBot` alles löschen, was KI, Ollama, Chat, Bilder, Selbstverbesserung oder Logbuch/Auszahlung ist, ohne dass Events, Scheduler, SK und Commands etwas davon merken.

**Architecture:** Zuerst ein Git-Tag als Sicherheitsnetz, dann werden die fünf verflochtenen Dateien (`message-handler.js`, Dashboard, `commands.js`/`handlers.js`, `index.js`/`termin-erinnerung.js`/`steuerung.js`) so umgebaut, dass sie keines der 45 Module mehr brauchen. Erst danach werden die Module gelöscht. Ein neuer Wächter-Test sorgt dafür, dass nie wieder KI in den Event-Bot rutscht. Jeder Task endet grün (`npm test`).

**Tech Stack:** Node.js, discord.js, eigener Testläufer (`tests/lib.js`, `tests/run.js`), kein Framework.

**Spec:** `docs/superpowers/specs/2026-10-03-eventbot-ghost-trennung-design.md`

## Global Constraints

- **Hauptsache die Events gehen** (Kevin): Anmeldungen, Scheduler, SK, `tausche/trag ein/aus`, `/event`, `/eintragen`, `/austragen`, `/bearbeiten`, `/angriff`, `/verteidigung`, `/verlosung`, `/top`, Absagen-Knopf im Dashboard dürfen sich im Verhalten **nicht** ändern.
- **Nur Code wird gelöscht.** `data/`, `Gedächtnis/`, `.env`, `backups/`, `logs/` werden nicht angefasst.
- **Der laufende Bot wird während der Entwicklung nicht berührt.** Gearbeitet wird in einem eigenen Worktree (`EnterWorktree`), nie im Hauptordner. Gestoppt/neugestartet wird erst beim Umschalten nach dem Merge (Kevin hat das erlaubt).
- **`config.js` wird nicht angefasst** (ungenutzte Ollama-/Logbuch-Einstellungen bleiben, siehe Spec).
- **Keine neuen Fähigkeiten.** Das ist ein reiner Rückbau.
- Alles auf Deutsch (Texte, Kommentare mit umschriebenen Umlauten `fuer`/`ueber` im Code, normale Umlaute in Docs), siehe `CLAUDE.md`.
- Die 45 zu löschenden Module (exakt diese, nicht mehr, nicht weniger):
  `ollama ollama-watch model-intent auto-learn knowledge memory self-knowledge server-wissen teach-parser ghostxx-fragen frage-erinnerung stats-parser stats-answer stats terminplan-wissen bot-settings selbstverbesserung selbstverbesserung-session selbstverbesserung-limit selbstverbesserung-gedaechtnis selbstverbesserung-benachrichtigung selbstbeobachtung code-vorschlag bild-kommentar bild-uhrzeit bild-vorablesen bild-gedaechtnis bild-laden bild-zuschnitt visa logbook logbook-batch logbook-command logbook-events logbook-vision logbuch-tickets logbuch-zahlen auszahlung-saetze ticket-namen ticket-aufraeumer namens-gedaechtnis lauf-stand meilenstein tagesrhythmus voll-kommentar praesenz` (jeweils `src/<name>.js`), dazu der Ordner `code-recherche/`.

## Review Focus

1. **Text-Befehl "tausche/trag ein" geht weiter, ohne `merken`/Gedächtnis/Modell.** Erwartung: ein Befehl im Chat-Kanal ruft `detectIntent` → `runIntent` und antwortet (hier: "Welches Event meinst du?"). Test in Task 2.
2. **SK-Satz "wir haben angegriffen um 21:07 gegen Nemesis" legt weiter eine Meldung an.** Erwartung: im Meldungskanal entsteht ein gespeichertes SK-Event vom Typ `attack`. Test in Task 2 (die Funktion rief bisher `merken()`, das es nicht mehr gibt).
3. **Smalltalk bekommt keine Antwort mehr und wirft nicht.** Erwartung: "hey wie gehts" im Chat-Kanal → keine Antwort, kein Fehler. Test in Task 2.
4. **Der Bot startet überhaupt.** Eine hängende `require`-Verbindung zu einem gelöschten Modul würde den Start sofort abbrechen. Erwartung: jede relative `require`-Verbindung in `src/` zeigt auf eine echte Datei. Wächter-Test in Task 6.
5. **Die Slash-Command-Liste ist genau die erwartete.** Ein versehentlich mitgelöschtes `/event` oder `/top` wäre fatal. Erwartung: `buildCommands()` liefert genau die 14 erwarteten Namen. Test in Task 4.
6. **Das Dashboard-Skript wirft im Browser keinen Fehler.** Die Seite liest Felder aus `stand()`, die wegfallen. Erwartung: keine Konsolenfehler beim Laden, Absagen-Knopf und Schalter funktionieren. Prüfung in Task 3 im Browser.
7. **Schalter ohne Besitzer.** `istAn('chat')` & Co. liefern für unbekannte Schlüssel `true` (kein Absturz), aber `steuerung.json` auf dem Rechner kann alte Schlüssel enthalten. Erwartung: alte Schlüssel werden ignoriert (`saeubere()` kennt nur `STANDARD`-Schlüssel, bestehend). Test in Task 5.

---

## Datei-Überblick

- **Create:** `docs/ghost-uebergabe.md`, `tests/message-handler.test.js`, `tests/commands.test.js`, `tests/abhaengigkeiten.test.js`
- **Rewrite:** `src/message-handler.js` (1076 → ca. 190 Zeilen), `src/index.js`
- **Modify:** `src/sk-meldung-anlegen.js`, `src/handlers.js`, `src/commands.js`, `src/termin-erinnerung.js`, `src/steuerung.js`, `src/dashboard.js`, `src/dashboard-daten.js`, `src/dashboard-seite.js`, `tests/dashboard.test.js`, `tests/steuerung.test.js`, `tests/sk-meldung-anlegen.test.js` (falls `merken` dort vorkommt), `CLAUDE.md`, `README.md`
- **Delete:** die 45 Module, `code-recherche/`, und die zugehörigen Testdateien (Liste in Task 6)

---

### Task 1: Sicherheitsnetz und Übergabe-Notiz

**Files:**
- Create: `docs/ghost-uebergabe.md`

**Interfaces:**
- Consumes: nichts.
- Produces: Git-Tag `vor-trennung-2026-10-03` (auf dem Stand vor jeder Änderung) und `docs/ghost-uebergabe.md`; spätere Tasks und die neue Ghost-Sitzung verlassen sich darauf.

- [ ] **Step 1: Tag auf den aktuellen Stand von `origin/main` setzen und hochladen**

Run (aus dem Worktree, bevor irgendeine Datei geändert wurde):
```bash
git fetch origin
git tag vor-trennung-2026-10-03 origin/main
git push origin vor-trennung-2026-10-03
git ls-remote --tags origin vor-trennung-2026-10-03
```
Expected: die letzte Zeile zeigt den Tag mit einem Commit-Hash.

- [ ] **Step 2: Übergabe-Notiz schreiben**

Erstelle `docs/ghost-uebergabe.md` mit genau diesem Inhalt:

````markdown
# Übergabe an die neue Ghost-Sitzung

Am 3.10.2026 wurde alles, was KI, Ollama, Chat, Bilder, Selbstverbesserung
und Logbuch/Auszahlung war, aus dem Event-Bot **gelöscht** (siehe
`docs/superpowers/specs/2026-10-03-eventbot-ghost-trennung-design.md`).
Nichts davon ging verloren: der komplette alte Stand liegt im Git-Tag
**`vor-trennung-2026-10-03`**.

```bash
git show vor-trennung-2026-10-03:src/ollama.js          # eine Datei ansehen
git checkout vor-trennung-2026-10-03 -- src/ollama.js    # eine Datei zurückholen
git worktree add ../alt vor-trennung-2026-10-03          # den ganzen alten Stand
```

## Was gelöscht wurde

KI und Chat: `ollama`, `ollama-watch`, `model-intent`, `auto-learn`,
`knowledge`, `memory`, `self-knowledge`, `server-wissen`, `teach-parser`,
`ghostxx-fragen`, `frage-erinnerung`, `stats-parser`, `stats-answer`, `stats`,
`terminplan-wissen`, `bot-settings`.
Selbstverbesserung: `selbstverbesserung`, `-session`, `-limit`,
`-gedaechtnis`, `-benachrichtigung`, `selbstbeobachtung`, `code-vorschlag`.
Bilder: `bild-kommentar`, `bild-uhrzeit`, `bild-vorablesen`,
`bild-gedaechtnis`, `bild-laden`, `bild-zuschnitt`, `visa`.
Logbuch und Auszahlung: `logbook`, `logbook-batch`, `logbook-command`,
`logbook-events`, `logbook-vision`, `logbuch-tickets`, `logbuch-zahlen`,
`auszahlung-saetze`, `ticket-namen`, `ticket-aufraeumer`,
`namens-gedaechtnis`, `lauf-stand`.
Redet von selbst: `meilenstein`, `tagesrhythmus`, `voll-kommentar`, `praesenz`.
Dazu `code-recherche/` und die Commands `/auszahlen`, `/sammelauszahlung`,
`/sammelauswertung`.

## Wo die Daten liegen (unverändert, nur nicht mehr gelesen)

`data/` (Events, Logbuch-Stände, Wissen, Gesprächsverlauf, Namensgedächtnis,
Bild-Gedächtnis, Selbstverbesserungs-Limit) und `Gedächtnis/` (Ghosts eigene
Funde und Entscheidungen) bleiben auf Kevins Rechner liegen. Das tägliche
Backup nach `backups/` läuft weiter.

## Zugangsdaten

Ollama-, Tavily- und Claude-Zugangsdaten stehen in der `.env` des Event-Bots
und gehören für Ghost in eine **eigene** `.env`. Das macht Kevin von Hand.
Ein zweiter Discord-Bot für Ghost braucht einen **eigenen Token**: zwei
Programme mit demselben Token reagieren beide auf jede Nachricht.

## Die KI-Erkenntnisse aus dem alten CLAUDE.md

**Erst ablesen, dann raten.** Vor dem Sprachmodell steht immer ein fester
Parser. Was sich eindeutig aus dem Satz ablesen lässt, wird abgelesen
(`intent-parser`, `stats-parser`, `sk-meldung`, `terminplan-wissen`). Das
Modell ist nur das Auffangnetz. Gründe: die Grafikkarte teilt sich mit GTA und
ist manchmal voll, und an einer Anmeldung hängen zehn Leute. Neue Fähigkeiten
zuerst als Parser bauen, nicht als Prompt.

**Messen, nicht vermuten.** Gegen eine **feste** Stichprobe messen, vorher und
nachher. Gemessene Fehlschläge: eine "verbesserte" Bildanweisung senkte die
Trefferquote von 72 % auf 20 %; die Wiederholungsbremse fürs Bildlesen
abzuschalten klang richtig und war falsch herum; eine Längengrenze für die
Antwort schnitt mitten ins Denken; der Zuschnitt als erster Anlauf war
schlechter als als zweiter.

**Modelle (Ollama, lokal):** Chat `qwen3.5:9b` (bei voller Grafikkarte
`qwen3.5:2b`); Bilder im Logbuch `qwen3-vl:8b` mit Zuschnitt des oberen Rands
als zweitem Anlauf; Visum `qwen3.5:9b`. Das Bildlesen blieb bewusst auf dem 8b,
auch bei voller Grafikkarte (15/15 gemessen, fürs 4b gab es keine vergleichbare
Zahl; am Bild hängt Geld). Beim Chat ist der Wechsel aufs kleine Modell richtig.
**Ollama darf nie blockieren:** fällt es aus, laufen alles andere weiter.

**Bekannte Fallen:** Discord schreibt Kanalnamen klein und macht aus jedem
Leerzeichen einen Bindestrich (daher die Fettbuchstaben in `ticket-namen`);
Umbenennen ist auf 2 Änderungen pro 10 Minuten und Kanal begrenzt; im
Zuhause-Kanal galt jede Aussage als Tatsache (daher mehrere Netze in
`auto-learn`); die Spielernummer (`| 266391`) ist der einzige verlässliche
Anker für eine Person.

**Nachträge zur Selbstverbesserung:** läuft über `claude -p ... --permission-mode
bypassPermissions` in einem frischen Klon vom GitHub-Remote (nie im echten
Ordner), mit Tabu-Pfaden, bereinigter Umgebung und Diff-Prüfung. Einzelne
Sitzungen können wegen paralleler Git-Arbeit im selben Ordner einen falschen
"echten Checkout verändert"-Alarm auslösen: Entwicklung gehört deshalb immer in
einen Worktree.
````

- [ ] **Step 3: Commit**

```bash
git add docs/ghost-uebergabe.md
git commit -m "Uebergabe-Notiz fuer die neue Ghost-Sitzung (Tag vor-trennung-2026-10-03)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `message-handler.js` auf Befehle und SK zusammenstreichen

**Files:**
- Rewrite: `src/message-handler.js`
- Modify: `src/sk-meldung-anlegen.js`, `src/handlers.js` (nur die Wissens-Button-Weiche), `tests/sk-meldung-anlegen.test.js` (nur falls `merken` dort vorkommt)
- Test: `tests/message-handler.test.js` (neu)

**Interfaces:**
- Consumes: `detectIntent`, `executePlan`, `needsConfirmation`, `prepareIntent` aus `./chat-router`; `behandleSkMeldung` aus `./sk-meldung-anlegen`; `askOwner` aus `./ask-owner`; `istAn` aus `./steuerung`; `logError` aus `./logger` (alle unverändert).
- Produces: `src/message-handler.js` exportiert nur noch `handleMessage(message, client)`, `handleChatConfirmButton(interaction)`, `registerMessageHandler(client)`, `shouldRespond(message, botId)`. `behandleSkMeldung(message, text, { reply })` (ohne `merken`).

- [ ] **Step 1: Failing Test schreiben**

Erstelle `tests/message-handler.test.js`:

```js
const { check, finish, section, useTempData } = require('./lib');

const temp = useTempData();
const { config } = require('../src/config');
const { handleMessage } = require('../src/message-handler');
const { listEvents } = require('../src/storage');

const client = { user: { id: 'BOT' } };

// Eine Discord-Nachricht, so wenig wie noetig nachgebaut.
function nachricht({ text, channelId, userId = config.ownerId, bot = false }) {
  const antworten = [];
  const gesendet = [];
  return {
    antworten,
    gesendet,
    message: {
      author: { id: userId, bot },
      content: text,
      channelId,
      guildId: config.guildId,
      channel: {
        send: async (payload) => { gesendet.push(payload); return { id: 'gesendet-1' }; },
        sendTyping: async () => {},
      },
      member: { id: userId, roles: { cache: new Map() } },
      mentions: { users: new Map() },
      reference: null,
      reply: async (payload) => { antworten.push(payload); return {}; },
    },
  };
}

(async () => {
  section('Smalltalk bekommt keine Antwort mehr und wirft nicht');
  const smalltalk = nachricht({ text: 'hey wie gehts euch so', channelId: config.chatChannelId });
  let geworfen = false;
  try {
    await handleMessage(smalltalk.message, client);
  } catch {
    geworfen = true;
  }
  check('wirft nicht', !geworfen);
  check('keine Antwort', smalltalk.antworten.length === 0);
  check('nichts gesendet', smalltalk.gesendet.length === 0);

  section('Nachrichten von Bots werden ignoriert');
  const vomBot = nachricht({ text: 'ghost tausche @a mit @b', channelId: config.chatChannelId, bot: true });
  await handleMessage(vomBot.message, client);
  check('keine Antwort auf Bots', vomBot.antworten.length === 0);

  section('Text-Befehl laeuft weiter ueber den Parser (ohne Modell)');
  // Kein Event vorhanden: der Parser erkennt "trag mich ein", die Aufloesung
  // fragt nach, welches Event gemeint ist. Das beweist: erkennen -> ausfuehren
  // -> antworten lebt, auch ohne Gedaechtnis und ohne Ollama.
  const befehl = nachricht({ text: 'ghost trag mich ein', channelId: config.chatChannelId });
  await handleMessage(befehl.message, client);
  check('es kommt eine Antwort', befehl.antworten.length === 1, `${befehl.antworten.length}`);
  const antwortText = typeof befehl.antworten[0] === 'string'
    ? befehl.antworten[0]
    : befehl.antworten[0]?.content || '';
  check('Rueckfrage nach dem Event', /Event/i.test(antwortText), antwortText);

  section('SK-Meldung als Satz legt ein Event an');
  const vorher = (await listEvents()).length;
  const sk = nachricht({
    text: 'ghost wir haben angegriffen um 21:07 gegen Nemesis',
    channelId: config.stateChannelId,
  });
  await handleMessage(sk.message, client);
  const nachher = await listEvents();
  check('ein Event mehr gespeichert', nachher.length === vorher + 1, `${vorher} -> ${nachher.length}`);
  check('es ist eine SK-Meldung', nachher.at(-1)?.kind === 'state', JSON.stringify(nachher.at(-1)?.kind));
  check('Meldung im Kanal gepostet', sk.gesendet.length === 1);

  temp.cleanup();
  finish();
})();
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

Run: `node tests/message-handler.test.js`
Expected: FAIL. Der Smalltalk-Fall schlägt fehl (der alte Handler fragt das Sprachmodell und antwortet "Mein Kopf streikt gerade" bzw. wirft, weil Ollama nicht erreichbar ist), und/oder die Befehle antworten über `merken`/Gedächtnis auf eine andere Art.

- [ ] **Step 3: `src/message-handler.js` komplett ersetzen**

Der Inhalt der Datei wird **ersetzt** durch:

```js
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, Events } = require('discord.js');
const { config } = require('./config');
const { istAn: schalterAn } = require('./steuerung');
const { logError } = require('./logger');
const {
  detectIntent,
  executePlan,
  needsConfirmation,
  prepareIntent,
} = require('./chat-router');
const { behandleSkMeldung } = require('./sk-meldung-anlegen');
const { askOwner } = require('./ask-owner');

// Nur noch zwei Wege fuer Nachrichten: klar formulierte Text-Befehle
// ("tausche @A mit @B", "trag mich ein") und SK-Meldungen als Satz. Beides
// laeuft ueber feste Parser - kein Sprachmodell, kein Chat, kein Gedaechtnis.
// Der Rest wird nicht beantwortet. Siehe docs/superpowers/specs/
// 2026-10-03-eventbot-ghost-trennung-design.md.

const NAME_TRIGGER = /\bghost(xx|y|i)?\b/i;
const PENDING_TTL_MS = 5 * 60 * 1000;

const pendingPlans = new Map();

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
 * Wo der Bot Befehle entgegennimmt: in DMs, wenn er erwaehnt oder beim Namen
 * gerufen wird, und in seinen beiden Kanaelen (Chat und Rueckzugsort).
 */
function shouldRespond(message, botId) {
  if (isFromBot(message)) return false;
  if (isDirectMessage(message)) return true;
  if (mentionsBot(message, botId)) return true;
  if (message.channelId === config.chatChannelId) return true;
  if (message.channelId === config.botHomeChannelId) return true;
  if (NAME_TRIGGER.test(message.content || '')) return true;
  return false;
}

// Auf welche Nachricht wurde geantwortet? Damit laesst sich die gemeinte
// Anmeldung eindeutig bestimmen, ohne dass jemand ihren Namen tippen muss.
function getRepliedMessageId(message) {
  return message.reference?.messageId || '';
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

async function reply(message, payload) {
  const body = typeof payload === 'string' ? { content: payload } : payload;
  return message.reply({ ...body, allowedMentions: { parse: [], repliedUser: true } })
    .catch(() => null);
}

async function handleMessage(message, client) {
  const botId = client.user.id;
  if (!shouldRespond(message, botId)) return;

  // Nur der eigene Server, plus DMs.
  if (!isDirectMessage(message) && message.guildId !== config.guildId) return;

  const text = (message.content || '').replace(new RegExp(`<@!?${botId}>`, 'g'), '').trim();
  if (!text) return;

  const repliedMessageId = getRepliedMessageId(message);
  const context = {
    guild: message.guild,
    member: message.member,
    channelId: message.channelId,
    repliedMessageId,
    authorId: message.author.id,
    client,
  };

  // Klar formulierte Befehle mit @Erwähnung oder "mich".
  const parsed = detectIntent(text, {
    hasReply: Boolean(repliedMessageId),
    selfId: message.author.id,
  });

  if (parsed) {
    await runIntent(message, client, parsed, context);
    return;
  }

  // "wir haben angegriffen um 21:07 gegen Nemesis" - eine SK-Meldung als Satz,
  // das Textgegenstueck zu /angriff und /verteidigung: pausiert deshalb mit
  // demselben Dashboard-Schalter "commands".
  if (!schalterAn('commands')) return;
  await behandleSkMeldung(message, text, { reply }).catch((error) => {
    logError('SK-Meldung fehlgeschlagen', error, {
      fields: [{ name: 'Text', value: text.slice(0, 200) }],
    });
  });
}

/** Pruefen, bestaetigen, ausfuehren. */
async function runIntent(message, client, intent, context) {
  if (!schalterAn('commands')) {
    await reply(message, 'Commands sind gerade im Dashboard pausiert.');
    return;
  }
  const prepared = await prepareIntent(intent, context);

  if (!prepared.ok || prepared.immediate) {
    await reply(message, prepared.text);

    // Konnte er jemanden oder ein Event nicht zuordnen, fragt er im
    // Rueckzugskanal nach - statt die Anfrage einfach abtropfen zu lassen.
    if (prepared.ask) {
      await askOwner({ ...prepared.ask, message }).catch(() => null);
    }
    return;
  }

  // Nur was nicht der feste Parser erkannt hat, wird vorher abgefragt. Beim
  // Parser ist an dieser Stelle alles geklaert - Person und Anmeldung sind
  // aufgeloest.
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
    return;
  }

  await reply(message, result.text);
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
  registerMessageHandler,
  shouldRespond,
};
```

- [ ] **Step 4: `merken` aus `src/sk-meldung-anlegen.js` entfernen**

Ändere die Signatur (Zeile 34) von
```js
async function behandleSkMeldung(message, text, { reply, merken }) {
```
zu
```js
async function behandleSkMeldung(message, text, { reply }) {
```
und entferne die drei Zeilen `await merken(antwort);` (nach dem `reply` bei "Eine SK-Meldung anlegen dürfen nur...", nach dem `reply` bei `frageNach`) sowie die Zeile `await merken(\`${event.title}: ${meldung.gegner} um ${meldung.zeit}\`);` ganz am Ende vor `return true;`.

Prüfe danach `tests/sk-meldung-anlegen.test.js`: kommt dort `merken` vor (Stub oder Assertion), entferne es (Stub aus dem Aufruf, Assertion streichen, die übrigen Prüfungen der Meldungs-Logik bleiben unverändert).

- [ ] **Step 5: Wissens-Button-Weiche aus `src/handlers.js` entfernen**

Entferne in `handleInteraction` genau diesen Block (aktuell Zeile 115-119):
```js
  if (interaction.isButton() && interaction.customId.startsWith('wissen_')) {
    const { handleKnowledgeConflictButton } = require('./message-handler');
    await handleKnowledgeConflictButton(interaction);
    return;
  }
```

- [ ] **Step 6: Test laufen lassen, Erfolg bestätigen**

Run: `node tests/message-handler.test.js`
Expected: PASS, alle Checks `OK`. Falls der SK-Fall wegen Rechten scheitert (`canManageSignups`), kontrolliere, dass `member.id` im Test `config.ownerId` ist (Owner zählt als Editor); falls `saveEvent` auf `DATA_DIR` zeigt, muss `useTempData()` **vor** dem ersten `require('../src/...')` aufgerufen werden (steht so oben im Test).

- [ ] **Step 7: Betroffene bestehende Tests und die ganze Suite**

Run: `node tests/sk-meldung-anlegen.test.js && node tests/chat-router.test.js && npm test`
Expected: PASS, alle Dateien grün. (Die Module, die `message-handler.js` bisher importierte, existieren noch und werden noch von `index.js`/dem Dashboard gebraucht; gelöscht wird erst in Task 6.)

- [ ] **Step 8: Commit**

```bash
git add src/message-handler.js src/sk-meldung-anlegen.js src/handlers.js tests/message-handler.test.js tests/sk-meldung-anlegen.test.js
git commit -m "message-handler: nur noch Text-Befehle und SK-Saetze, kein Chat, kein Modell

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Dashboard entschlacken

**Files:**
- Modify: `src/dashboard-daten.js`, `src/dashboard.js`, `src/dashboard-seite.js`, `tests/dashboard.test.js`

**Interfaces:**
- Consumes: `systemWerte` (`./system-werte`), `letzteAktivitaet`/`letzteFehler` (`./logger`), `alleSchalter` (`./steuerung`), `listEvents` (`./storage`), `getEvent`/`updateEvent`, `refreshEventMessage`.
- Produces: `stand(client)` liefert **nur** `{ zeit, guildId, anmeldungen, fehler, aktivitaet, terminal, system, warnungen, schalter }`. `warnungen(client, { anmeldungen })` (zweites Argument nur noch `anmeldungen`). `dashboard.js` bietet nur noch `GET /api/stand`, `POST /api/schalter`, `POST /api/neustart`, `POST /api/aus`, `POST /api/anmeldung-absagen`.

- [ ] **Step 1: Tests anpassen (rot)**

In `tests/dashboard.test.js`:
- Entferne die Sektion `'Der Stand eines Laufs'` (Zeile 27-45) und den Import von `lauf-stand` (`beendeLauf, laufStand, meldeFortschritt, starteLauf`), sowie `require('../src/lauf-stand')`.
- In `'Wovor gewarnt wird'` und `'Fuenf gleiche Warnungen werden eine'`: entferne alle Prüfungen zu **Ollama/Grafikkarte/Tickets ohne Besitzer** (Warnungen "Ollama weg", "Grafikkarte belegt", "Ticket ohne Besitzer") und rufe `warnungen(...)` nur noch mit `{ anmeldungen }` auf (ohne `technikStand`). Die Prüfungen zu "schließt bald" und "vergessen zu schließen" bleiben unverändert.
- Entferne die Sektionen `'Pause-Knopf fuers Bildlesen'`, `'"Er fragt"-Kachel ist raus (ersetzt durch DM, siehe frage-erinnerung.js)'`, `'Selbstverbesserung im Dashboard sichtbar'`, `'Offene Fragen kommen nicht mehr ueber das Dashboard (siehe frage-erinnerung.js)'` samt Importen von `selbstverbesserung-gedaechtnis`.
- In `'Karten in den richtigen Spalten'` entferne den Teil, der `posChat` (GhostxxCode-Chat) prüft.
- Füge diese neue Sektion **vor** `temp.cleanup()` ein:

```js
  section('Entschlackt: nichts mehr von KI, Bildern, Logbuch oder Selbstverbesserung');
  for (const weg of ['GhostxxCode', 'Sammelauszahlung', 'Logbuch', 'Selbstverbesserung',
    '/api/chat', '/api/bilder-pause', 'chatformular', 'karte-lauf']) {
    check(`Seite kennt "${weg}" nicht mehr`, !html.includes(weg));
  }
  const stand3 = await stand(stiller);
  const erwarteteFelder = ['aktivitaet', 'anmeldungen', 'fehler', 'guildId', 'schalter', 'system', 'terminal', 'warnungen', 'zeit'];
  equal('stand() liefert genau diese Felder', Object.keys(stand3).sort(), erwarteteFelder);
```

Run: `node tests/dashboard.test.js`
Expected: FAIL (die Seite enthält die Begriffe noch, `stand()` liefert noch viele Felder).

- [ ] **Step 2: `src/dashboard-daten.js` umbauen**

Entferne die Importe von `logbuch-tickets`, `logbook`, `ollama`, `bild-gedaechtnis`, `bild-vorablesen`, `lauf-stand`, `selbstverbesserung-gedaechtnis`, `selbstverbesserung-limit`, `selbstverbesserung`, `meilenstein`, `tagesrhythmus`, sowie `berlinTimeToDate` (nicht mehr genutzt; `getBerlinDateStamp` nur behalten, falls noch gebraucht). Entferne die Funktionen `logbuchStand`, `technik`, `geplantes` samt dem Logbuch-Cache (`LOGBUCH_CACHE_MS`, `logbuchCache`). Behalten: `artVon`, `minutenBis`, `offeneAnmeldungen`, `terminal`, `mitNamen`.

Ersetze `warnungen` und `stand` und die Exporte durch:

```js
/**
 * Was gerade nicht stimmt.
 *
 * Bewusst wenige und harte Regeln - eine Warnliste, die immer voll ist,
 * schaut sich nach drei Tagen niemand mehr an.
 */
async function warnungen(client, { anmeldungen }) {
  const liste = [];

  for (const a of anmeldungen) {
    if (a.schliesstIn !== null && a.schliesstIn <= 6 && a.schliesstIn > 0 && a.max && a.dabei < a.max && a.anteil >= 0.6) {
      liste.push({ stufe: 'gelb', text: `${a.titel} schließt in ${a.schliesstIn} Min — ${a.max - a.dabei} fehlen noch.` });
    }
  }

  // Selbst erstellte Anmeldungen haben kein closeAt und bleiben stehen, bis
  // jemand sie schliesst. Fuenf FamWars standen so bis zu zwoelf Tage offen.
  //
  // Zusammengefasst, nicht einzeln: fuenfmal derselbe Satz untereinander hat
  // im ersten Anlauf den halben Bildschirm gefuellt und alles andere nach
  // unten geschoben.
  const vergessen = anmeldungen.filter((a) => (
    a.schliesstIn === null && a.offenSeitStunden !== null && a.offenSeitStunden > 48
  ));
  if (vergessen.length === 1) {
    const a = vergessen[0];
    liste.push({
      stufe: 'gelb',
      text: `"${a.titel}" steht seit ${Math.round(a.offenSeitStunden / 24)} Tagen offen — vergessen zu schließen?`,
    });
  } else if (vergessen.length > 1) {
    const aeltester = Math.max(...vergessen.map((a) => a.offenSeitStunden));
    const namen = [...new Set(vergessen.map((a) => a.titel))].join(', ');
    liste.push({
      stufe: 'gelb',
      text: `${vergessen.length} Anmeldungen stehen seit bis zu ${Math.round(aeltester / 24)} Tagen offen (${namen}) — vergessen zu schließen?`,
    });
  }

  return liste;
}

/** Der komplette Stand fuer die Seite. */
async function stand(client) {
  const anmeldungen = await offeneAnmeldungen();
  const guild = client.guilds.cache.get(config.guildId) || null;

  return {
    zeit: new Date().toISOString(),
    // Fuer die Sprunglinks zu einzelnen Nachrichten.
    guildId: config.guildId,
    anmeldungen,
    fehler: letzteFehler(),
    aktivitaet: letzteAktivitaet().map((a) => ({ ...a, text: mitNamen(a.text, guild) })),
    terminal: await terminal(),
    system: await systemWerte(client),
    warnungen: await warnungen(client, { anmeldungen }),
    schalter: alleSchalter(),
  };
}

module.exports = {
  artVon, mitNamen, offeneAnmeldungen, stand, terminal, warnungen,
};
```

(`warnungen` behält den Parameter `client` für die Aufrufstelle; falls Lint/Leser das stört, darf er entfallen, wenn `stand()` und der Test konsistent bleiben.)

- [ ] **Step 3: `src/dashboard.js` umbauen**

Entferne die Importe `setzePause` (`./bild-vorablesen`) und `chat` (`./ollama`), den Endpoint `POST /api/bilder-pause` (inklusive seines Kommentars "Einziger verbliebener schreibender Weg…"), den Endpoint `POST /api/chat` (inklusive `CODING_MODELL` und des langen Kommentars darüber) und die Verwendung von `istAn('chat')` (damit ist `istAn` im Import nicht mehr nötig, falls nicht anderweitig genutzt). Passe den Dateikommentar "Ein Fenster in Ghostxx' Kopf …" an: "Ein Fenster in den Event-Bot: die Anmeldungen, die Fehler im Log-Kanal, die Schalter." Behalten: `/api/stand`, `/api/schalter`, `/api/neustart`, `/api/aus`, `/api/anmeldung-absagen`, die Seite.

- [ ] **Step 4: `src/dashboard-seite.js` umbauen**

HTML (aktuell Zeile 352-423):
- In der Reaktor-Karte `kernstand`: entferne `<div id="technik">…</div>` und `<div id="laufzeit"></div>`, behalte `<div id="stand">lädt…</div>`.
- Entferne die Karten **GhostxxCode — Coding-Helfer** (komplett inkl. `chatverlauf`/`chatformular`), **Sammelauszahlung** (`id="karte-lauf"`), **Logbuch — wartet auf Auszahlung**, **Selbstverbesserung**.

Skript:
- Entferne die Funktionen `zeichneLauf`, `zeichneSelbstverbesserung`, `zeichneLogbuch`, `zeichneDashboardChat` und den Chat-Absende-Handler (`$('chatformular').addEventListener('submit', …)`), den Bilder-Pause-Knopf in `zeichneLeiste` (Parameter `bilder` und der `bilder-pause-knopf`-Block) samt dem `pauseKnopf`-Handler mit `fetch('/api/bilder-pause', …)`.
- Im Render (`laden`): entferne `setThinking(Boolean(d.rechnet))`, den Ruhestand-Text-Zweig, der `d.rechnet`/`d.bilder` liest (ersetze ihn durch einen festen Text wie `'wacht'`/den bisherigen Standardtext ohne Bilder), `zeichneLeiste(d.system, d.bilder)` → `zeichneLeiste(d.system)`, den Block `const t = d.technik; …` samt `$('technik').innerHTML`, `zeichneLauf`, `zeichneLogbuch`, `zeichneSelbstverbesserung`.
- Der Reaktor bleibt als Optik: `setThinking` und `.core-state.think` dürfen als ungenutzter Code stehen bleiben oder entfallen; der Kernzustand zeigt dauerhaft `BEREIT`. Die Zeichenschleife `draw()` bleibt unverändert (der Test `'Reaktor dreht immer…'` muss weiter grün sein).
- Entferne das jetzt tote CSS (`.chatverlauf`, `.chatformular`, `.pause-knopf` und die Karten-IDs `#logbuch`, `#selbstverbesserung`, `#lauf`), soweit es eindeutig nur zu den entfernten Teilen gehört.

- [ ] **Step 5: Tests grün**

Run: `node tests/dashboard.test.js`
Expected: PASS.

- [ ] **Step 6: Im Browser prüfen, dass die Seite nicht wirft**

Lege in dem Scratchpad-Ordner (nicht im Repo) `dashboard-smoke.js` an:
```js
process.env.DASHBOARD_PORT = '18787';
const projekt = process.argv[2]; // absoluter Pfad zum Worktree
const { startDashboard } = require(`${projekt}/src/dashboard`);
const client = { guilds: { cache: new Map() }, ws: { ping: 42 } };
startDashboard(client);
console.log('Dashboard-Smoke laeuft auf http://127.0.0.1:18787');
setInterval(() => {}, 1 << 30);
```
Starte es im Hintergrund (`node dashboard-smoke.js <worktree-pfad>`), öffne `http://127.0.0.1:18787` im Browser-Pane (`mcp__Claude_Browser__navigate`), klicke einmal auf die Seite (Ruhebildschirm weckt auf), und prüfe mit `read_console_messages` (nur Fehler): **keine** Fehler. Prüfe per `find`/`read_page`, dass die Karten "Steuerzentrale", "System", "Offene Anmeldungen", "Was er in Discord tut", "Letzte Fehler" da sind und die vier entfernten fehlen. Beende den Hintergrundprozess danach.
Expected: keine Konsolenfehler, genau die fünf Karten.

- [ ] **Step 7: Ganze Suite und Commit**

Run: `npm test`
Expected: PASS.

```bash
git add src/dashboard-daten.js src/dashboard.js src/dashboard-seite.js tests/dashboard.test.js
git commit -m "Dashboard: nur noch Event-Teile (kein Chat, keine Bilder, kein Logbuch, keine Selbstverbesserung)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Logbuch-Commands aus `commands.js` und `handlers.js`

**Files:**
- Modify: `src/commands.js`, `src/handlers.js`
- Test: `tests/commands.test.js` (neu)

**Interfaces:**
- Consumes: `buildCommands()` aus `./commands` (exportiert, liefert `SlashCommandBuilder`/Kontextmenü-Objekte mit `toJSON()`).
- Produces: `buildCommands()` liefert genau 14 Einträge (siehe Test).

- [ ] **Step 1: Failing Test schreiben**

Erstelle `tests/commands.test.js`:
```js
const { check, equal, finish, section } = require('./lib');
const { buildCommands } = require('../src/commands');

section('Die Command-Liste ist genau die erwartete');
const namen = buildCommands().map((befehl) => befehl.toJSON().name).sort();
const erwartet = [
  'Info', 'admin', 'angriff', 'austragen', 'bearbeiten', 'editor', 'eintragen',
  'embed', 'event', 'purge', 'say', 'top', 'verlosung', 'verteidigung',
].sort();
equal('14 Commands inkl. Kontextmenue Info', namen, erwartet);

section('Kein Logbuch-Command mehr');
for (const weg of ['auszahlen', 'sammelauszahlung', 'sammelauswertung']) {
  check(`/${weg} ist weg`, !namen.includes(weg));
}

section('Die Event-Commands sind noch da (Hauptsache die Events gehen)');
for (const da of ['event', 'eintragen', 'austragen', 'bearbeiten', 'angriff', 'verteidigung', 'top']) {
  check(`/${da}`, namen.includes(da));
}
const event = buildCommands().find((b) => b.toJSON().name === 'event').toJSON();
const unterbefehle = event.options.filter((o) => o.type === 1).map((o) => o.name).sort();
equal('/event hat alle Unterbefehle', unterbefehle, ['absagen', 'erstellen', 'liste', 'schliessen', 'teilnehmer']);

finish();
```
Run: `node tests/commands.test.js`
Expected: FAIL (die drei Logbuch-Commands sind noch in der Liste).

- [ ] **Step 2: Commands entfernen**

In `src/commands.js` entferne die drei Builder-Blöcke `/auszahlen`, `/sammelauszahlung`, `/sammelauswertung` einschließlich des Kommentars "Dasselbe wie /sammelauszahlung, nur ohne Bildpruefung." (aktuell Zeile 544-593, von `new SlashCommandBuilder().setName('auszahlen')` bis zur schließenden `),` von `sammelauswertung`). Achte auf die Kommas der benachbarten Einträge.

- [ ] **Step 3: Handler entfernen**

In `src/handlers.js`:
- Entferne die zwei Importe `const { handleAuszahlenCommand } = require('./logbook-command');` und `const { handleSammelauszahlungCommand } = require('./logbook-batch');`.
- Entferne in `handleCommand` die drei Blöcke für `auszahlen`, `sammelauszahlung` und `sammelauswertung` (aktuell Zeile 159-174, inklusive Kommentar "Derselbe Ablauf, nur ohne Bildpruefung…").
- Ändere `const ADMIN_COMMANDS = new Set(['verlosung', 'editor', 'auszahlen', 'sammelauszahlung', 'sammelauswertung']);` zu `const ADMIN_COMMANDS = new Set(['verlosung', 'editor']);` und passe den Kommentar darüber an ("greift in Verlosungen und Editor-Rechte ein").

- [ ] **Step 4: Tests grün, Suite grün**

Run: `node tests/commands.test.js && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/commands.js src/handlers.js tests/commands.test.js
git commit -m "Logbuch-Commands entfernt (/auszahlen, /sammelauszahlung, /sammelauswertung)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: `index.js`, `termin-erinnerung.js` und `steuerung.js` aufräumen

**Files:**
- Rewrite: `src/index.js`
- Modify: `src/termin-erinnerung.js`, `src/steuerung.js`, `tests/steuerung.test.js`

**Interfaces:**
- Consumes: alle in `index.js` bleibenden `start*`/`register*`-Funktionen (unverändert).
- Produces: `index.js` importiert **keines** der 45 Module mehr; `steuerung.js` kennt nur noch die Schalter `eventScheduler, terminErinnerungen, commands, auditLog, logNachrichten, logMitglieder, logSprache, logSelbststumm, logKanaele, botLog, fehlerLog` (alle standardmäßig an).

- [ ] **Step 1: Test für `steuerung.js` anpassen (rot)**

Ersetze in `tests/steuerung.test.js` den Block ab `console.log('\nSteuerzentrale');` bis zum Dateiende durch:
```js
console.log('\nSteuerzentrale');
pruefe('alle erwarteten Schalter haben einen sicheren Standard', () => {
  const erwartet = [
    'eventScheduler', 'terminErinnerungen', 'commands', 'auditLog', 'logNachrichten',
    'logMitglieder', 'logSprache', 'logSelbststumm', 'logKanaele', 'botLog', 'fehlerLog',
  ];
  assert.deepEqual(Object.keys(STANDARD).sort(), erwartet.sort());

  // Alles laeuft standardmaessig weiter - es gibt keinen Schalter mehr, der
  // bewusst aus startet (die Selbstverbesserung war der einzige).
  for (const [key, wert] of Object.entries(STANDARD)) {
    assert.equal(wert, true, `Standard von ${key}`);
  }
});

console.log(`\n${1 - fehlgeschlagen} bestanden, ${fehlgeschlagen} fehlgeschlagen`);
process.exitCode = fehlgeschlagen ? 1 : 0;
```
Run: `node tests/steuerung.test.js`
Expected: FAIL (die Schlüssel `chat`, `visaBilder`, `chatBilder`, `logbuchSortieren`, `selbstverbesserung` sind noch drin).

- [ ] **Step 2: `src/steuerung.js` anpassen**

Ersetze das `STANDARD`-Objekt (aktuell Zeile 11-33) durch:
```js
const STANDARD = {
  eventScheduler: true,
  terminErinnerungen: true,
  commands: true,
  auditLog: true,
  logNachrichten: true,
  logMitglieder: true,
  logSprache: true,
  logSelbststumm: true,
  logKanaele: true,
  botLog: true,
  fehlerLog: true,
};
```
Die Funktionen `saeubere`/`istAn`/`setzeSchalter` bleiben unverändert: ein alter Schlüssel in der vorhandenen `data/steuerung.json` wird von `saeubere()` ignoriert, weil sie nur `STANDARD`-Schlüssel übernimmt.

- [ ] **Step 3: `src/termin-erinnerung.js` ohne Voll-Kommentar**

- Entferne `const { pruefeVolle } = require('./voll-kommentar');` (Zeile 5).
- Entferne in der Taktfunktion die Zeilen
  ```js
      // Derselbe Minutentakt: eine Minute Ungenauigkeit spielt bei "das ging
      // schnell" keine Rolle, und es spart einen zweiten Zeitgeber.
      pruefeVolle(client).catch(() => null);
  ```
- Ändere die Log-Zeile `console.log('Termin-Erinnerung laeuft (mit Voll-Kommentar).');` zu `console.log('Termin-Erinnerung laeuft.');`.

- [ ] **Step 4: `src/index.js` komplett ersetzen**

Der Inhalt wird **ersetzt** durch:

```js
const { Client, Events, GatewayIntentBits, Partials } = require('discord.js');
const { assertRuntimeConfig, config } = require('./config');
const { handleInteraction } = require('./handlers');
const { registerCommands } = require('./register-commands');
const { startEventScheduler } = require('./scheduler');
const { startGiveawayScheduler } = require('./giveaway');
const { startEventArchiver } = require('./archiver');
const { startBackups } = require('./backup');
const { setLogClient, logBotEvent, logError } = require('./logger');
const { setAskClient } = require('./ask-owner');
const { registerAuditLog } = require('./audit-log');
const { registerServerLog } = require('./server-log');
const { registerMessageHandler } = require('./message-handler');
const { startDashboard } = require('./dashboard');
const { startTerminErinnerung } = require('./termin-erinnerung');
const { registerFamilienListe } = require('./familien-liste');
const { ladeSteuerung } = require('./steuerung');

async function main() {
  assertRuntimeConfig({ requireClientId: false });
  await ladeSteuerung();

  const client = new Client({
    // GuildMembers und MessageContent sind privilegiert und im Developer Portal
    // freigeschaltet. Faellt eine Freischaltung weg, startet der Bot nicht mehr -
    // scripts/run-bot.ps1 faengt das mit steigender Wartezeit ab, statt endlos
    // im Sekundentakt neu zu starten.
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildMessageReactions,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages,
      // Liefert guildAuditLogEntryCreate fuer das Server-Logging.
      GatewayIntentBits.GuildModeration,
      // Sprachkanaele: betreten, verlassen, stumm. Nicht privilegiert.
      GatewayIntentBits.GuildVoiceStates,
    ],
    // Ohne Channel-Partial kommen DMs nicht an, wenn der Channel noch nicht im Cache ist.
    partials: [Partials.Channel, Partials.Message],
  });

  client.once(Events.ClientReady, async (readyClient) => {
    try {
      const commandCount = await registerCommands(readyClient.user.id);
      console.log(`${commandCount} Slash-Commands bereit.`);
      console.log(`Eingeloggt als ${readyClient.user.tag}`);
      console.log(`Aktiv fuer Guild ${config.guildId}`);
      setLogClient(readyClient);
      setAskClient(readyClient);
      registerAuditLog(readyClient);
      registerServerLog(readyClient);

      // Alle Mitglieder einmal laden, damit Namen wie "Muffiin" gefunden
      // werden. Discords Suche kennt nur Namensanfaenge, der Zwischenspeicher
      // auch Teiltreffer - und der ist ohne dieses Laden unvollstaendig.
      const guild = await readyClient.guilds.fetch(config.guildId).catch(() => null);
      if (guild) {
        const members = await guild.members.fetch().catch((error) => {
          console.warn('Mitglieder konnten nicht geladen werden:', error.message);
          return null;
        });
        if (members) console.log(`${members.size} Mitglieder geladen.`);
      }

      // Vor dem Archivieren sichern: der Archivierer schreibt events.json neu,
      // und genau dabei ist schon einmal etwas schiefgegangen.
      startBackups();

      startEventScheduler(readyClient);
      startGiveawayScheduler(readyClient);
      startEventArchiver();

      registerMessageHandler(readyClient);

      // Ruft 25 Minuten vor einem selbst erstellten Event nochmal und traegt
      // das Ende ein - geschlossen wird dann vom bestehenden Zeitplaner.
      startTerminErinnerung(readyClient);

      // Wer eine Rangrolle traegt, ist Familienmitglied - Discord ist die
      // Quelle, seit die Ingame-Liste am 15.08.2026 einmalig abgeglichen und
      // aufgeraeumt wurde. Liste jede Minute, Abweichungen stuendlich.
      registerFamilienListe(readyClient);

      // Nur auf diesem Rechner erreichbar. Faellt es aus, laeuft der Bot
      // unveraendert weiter - es liest nur, es steuert nichts.
      startDashboard(readyClient);

      logBotEvent({
        title: 'Bot gestartet',
        description: `Eingeloggt als ${readyClient.user.tag}.`,
        color: 'create',
      });
    } catch (error) {
      console.error('Slash-Command-Registrierung fehlgeschlagen:');
      console.error(error.message);
      process.exit(1);
    }
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      await handleInteraction(interaction);
    } catch (error) {
      console.error('Interaction-Fehler:', error);
      logError('Fehler bei einem Command oder Knopf', error, {
        fields: [
          { name: 'Was', value: interaction.commandName || interaction.customId || 'unbekannt', inline: true },
          { name: 'Von', value: `<@${interaction.user?.id}>`, inline: true },
        ],
      });

      if (!interaction.isRepliable()) return;

      const payload = {
        content: 'Dabei ist ein Fehler passiert. Bitte versuche es erneut oder pruefe die Bot-Logs.',
        ephemeral: true,
      };

      if (interaction.deferred || interaction.replied) {
        await interaction.followUp(payload).catch(() => null);
      } else {
        await interaction.reply(payload).catch(() => null);
      }
    }
  });

  await client.login(config.token);
}

main().catch((error) => {
  console.error('Bot-Start fehlgeschlagen:');
  console.error(error.message);
  process.exit(1);
});
```

- [ ] **Step 5: Tests, Syntax, Suite**

Run: `node tests/steuerung.test.js && node tests/termin-erinnerung.test.js && node -c src/index.js && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/index.js src/termin-erinnerung.js src/steuerung.js tests/steuerung.test.js
git commit -m "index/termin-erinnerung/steuerung: nur noch Event-Teile starten

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Die 45 Module, `code-recherche/` und ihre Tests löschen, Wächter-Test

**Files:**
- Delete: die 45 Module aus den Global Constraints, `code-recherche/`, Testdateien (Liste unten)
- Create: `tests/abhaengigkeiten.test.js`

**Interfaces:**
- Consumes: den Stand nach Task 2 bis 5 (kein verbliebenes Modul darf ein zu löschendes mehr per `require` brauchen).
- Produces: `src/` mit 44 Modulen; der Wächter-Test `tests/abhaengigkeiten.test.js`.

- [ ] **Step 1: Wächter-Test schreiben (rot, solange die Module noch existieren)**

Erstelle `tests/abhaengigkeiten.test.js`:
```js
const fs = require('node:fs');
const path = require('node:path');
const { check, finish, section } = require('./lib');

const wurzel = path.join(__dirname, '..');
const src = path.join(wurzel, 'src');
const dateien = fs.readdirSync(src).filter((name) => name.endsWith('.js'));

// Diese Module gehoeren nicht (mehr) in den Event-Bot: KI, Chat, Bilder,
// Selbstverbesserung, Logbuch und Auszahlung (Kevin, 3.10.2026). Ghost wird
// spaeter in einer eigenen Sitzung neu aufgebaut. Dieser Test verhindert,
// dass sich so etwas wieder einschleicht.
const VERBOTEN = [
  'ollama', 'ollama-watch', 'model-intent', 'auto-learn', 'knowledge', 'memory',
  'self-knowledge', 'server-wissen', 'teach-parser', 'ghostxx-fragen',
  'frage-erinnerung', 'stats-parser', 'stats-answer', 'stats', 'terminplan-wissen',
  'bot-settings', 'selbstverbesserung', 'selbstverbesserung-session',
  'selbstverbesserung-limit', 'selbstverbesserung-gedaechtnis',
  'selbstverbesserung-benachrichtigung', 'selbstbeobachtung', 'code-vorschlag',
  'bild-kommentar', 'bild-uhrzeit', 'bild-vorablesen', 'bild-gedaechtnis',
  'bild-laden', 'bild-zuschnitt', 'visa', 'logbook', 'logbook-batch',
  'logbook-command', 'logbook-events', 'logbook-vision', 'logbuch-tickets',
  'logbuch-zahlen', 'auszahlung-saetze', 'ticket-namen', 'ticket-aufraeumer',
  'namens-gedaechtnis', 'lauf-stand', 'meilenstein', 'tagesrhythmus',
  'voll-kommentar', 'praesenz',
];

section('Jede relative require-Verbindung in src/ zeigt auf eine echte Datei');
const haengend = [];
for (const datei of dateien) {
  const code = fs.readFileSync(path.join(src, datei), 'utf8');
  for (const treffer of code.matchAll(/require\('\.\/([\w-]+)'\)/g)) {
    if (!fs.existsSync(path.join(src, `${treffer[1]}.js`))) haengend.push(`${datei} -> ${treffer[1]}`);
  }
}
check('keine haengende Verbindung', haengend.length === 0, haengend.join(', '));

section('Der Event-Bot enthaelt keine KI, kein Ollama, keine Bilder, kein Logbuch');
for (const name of VERBOTEN) {
  check(`src/${name}.js existiert nicht`, !fs.existsSync(path.join(src, `${name}.js`)));
}
check('code-recherche/ existiert nicht', !fs.existsSync(path.join(wurzel, 'code-recherche')));

section('Nichts in src/ verweist auf einen verbotenen Namen');
const verweise = [];
for (const datei of dateien) {
  const code = fs.readFileSync(path.join(src, datei), 'utf8');
  for (const name of VERBOTEN) {
    if (new RegExp(`require\\('\\./${name}'\\)`).test(code)) verweise.push(`${datei} -> ${name}`);
  }
  if (/require\('\.\.\/code-recherche/.test(code)) verweise.push(`${datei} -> code-recherche`);
}
check('kein require auf ein verbotenes Modul', verweise.length === 0, verweise.join(', '));

finish();
```
Run: `node tests/abhaengigkeiten.test.js`
Expected: FAIL (die verbotenen Dateien existieren noch).

- [ ] **Step 2: Vorher prüfen, dass nichts Bleibendes die Module noch braucht**

Run:
```bash
node -e "
const fs=require('fs'),path=require('path');
const weg=new Set(('ollama ollama-watch model-intent auto-learn knowledge memory self-knowledge server-wissen teach-parser ghostxx-fragen frage-erinnerung stats-parser stats-answer stats terminplan-wissen bot-settings selbstverbesserung selbstverbesserung-session selbstverbesserung-limit selbstverbesserung-gedaechtnis selbstverbesserung-benachrichtigung selbstbeobachtung code-vorschlag bild-kommentar bild-uhrzeit bild-vorablesen bild-gedaechtnis bild-laden bild-zuschnitt visa logbook logbook-batch logbook-command logbook-events logbook-vision logbuch-tickets logbuch-zahlen auszahlung-saetze ticket-namen ticket-aufraeumer namens-gedaechtnis lauf-stand meilenstein tagesrhythmus voll-kommentar praesenz').split(' '));
let treffer=0;
for(const d of fs.readdirSync('src').filter(n=>n.endsWith('.js'))){
  const n=d.replace('.js',''); if(weg.has(n)) continue;
  const code=fs.readFileSync(path.join('src',d),'utf8');
  for(const m of code.matchAll(/require\('\.\/([\w-]+)'\)/g)) if(weg.has(m[1])){console.log(d,'->',m[1]);treffer++;}
}
console.log(treffer? 'NOCH VERBINDUNGEN - nicht loeschen' : 'sauber: nichts Bleibendes braucht die Module');
"
```
Expected: `sauber: nichts Bleibendes braucht die Module`. Bei Treffern: stoppen und zuerst die jeweilige Datei bereinigen (Ursache in Task 2 bis 5 suchen), nicht weiterlöschen.

- [ ] **Step 3: Module löschen**

```bash
git rm src/ollama.js src/ollama-watch.js src/model-intent.js src/auto-learn.js src/knowledge.js src/memory.js src/self-knowledge.js src/server-wissen.js src/teach-parser.js src/ghostxx-fragen.js src/frage-erinnerung.js src/stats-parser.js src/stats-answer.js src/stats.js src/terminplan-wissen.js src/bot-settings.js
git rm src/selbstverbesserung.js src/selbstverbesserung-session.js src/selbstverbesserung-limit.js src/selbstverbesserung-gedaechtnis.js src/selbstverbesserung-benachrichtigung.js src/selbstbeobachtung.js src/code-vorschlag.js
git rm src/bild-kommentar.js src/bild-uhrzeit.js src/bild-vorablesen.js src/bild-gedaechtnis.js src/bild-laden.js src/bild-zuschnitt.js src/visa.js
git rm src/logbook.js src/logbook-batch.js src/logbook-command.js src/logbook-events.js src/logbook-vision.js src/logbuch-tickets.js src/logbuch-zahlen.js src/auszahlung-saetze.js src/ticket-namen.js src/ticket-aufraeumer.js src/namens-gedaechtnis.js src/lauf-stand.js
git rm src/meilenstein.js src/tagesrhythmus.js src/voll-kommentar.js src/praesenz.js
git rm -r code-recherche
```

- [ ] **Step 4: Testdateien der gelöschten Module löschen**

Erst jede Datei kurz prüfen (`grep -n "require('../src/" tests/<datei>`): sie darf **nur** gelöschte Module testen (plus `config`/`logger`/`storage` als Hilfsimporte). Dann:
```bash
git rm tests/auszahlung-saetze.test.js tests/auto-learn.test.js tests/bild-gedaechtnis.test.js tests/bild-laden.test.js tests/bild-uhrzeit.test.js tests/bild-zuschnitt.test.js tests/code-vorschlag.test.js tests/knowledge.test.js tests/logbook-events.test.js tests/logbook-vision-anzeige.test.js tests/logbook.test.js tests/model-intent.test.js tests/namens-gedaechtnis.test.js tests/praesenz.test.js tests/reaktionen.test.js tests/selbstverbesserung-gedaechtnis.test.js tests/selbstverbesserung-limit.test.js tests/selbstverbesserung-session.test.js tests/selbstverbesserung.test.js tests/server-wissen.test.js tests/stats.test.js tests/terminplan-wissen.test.js tests/ticket-namen.test.js tests/visa.test.js tests/zwei-events.test.js
git rm tests/achtungszeichen.test.js tests/frage-erinnerung.test.js tests/ghostxx-fragen.test.js tests/logbook-batch.test.js tests/logbuch-tickets.test.js tests/selbstbeobachtung.test.js tests/selbstverbesserung-benachrichtigung.test.js tests/voll-kommentar.test.js
git rm tests/code-recherche-uebersetzung.test.js tests/code-recherche-websuche.test.js
```
Prüfe mit `git status`, dass **nur** Dateien gelöscht wurden, die zu den 45 Modulen oder zu `code-recherche` gehören. Bleiben müssen u. a.: `archiver`, `ask-owner`, `atomic-write`, `audit-log`, `backup`, `beitritts-log`, `chat-router`, `event-actions`, `event-erinnerung`, `familien-liste`, `intent-parser`, `leaderboard`, `logger`, `namensaufloesung`, `permissions`, `server-log`, `sk-meldung-anlegen`, `sk-meldung`, `steuerung`, `termin-erinnerung`, `dashboard`, `message-handler`, `commands`, `abhaengigkeiten`.

Hinweis: `tests/namensaufloesung.test.js` testet `member-resolver` (bleibt). Wenn eine der obigen Testdateien doch ein bleibendes Modul prüft, **nicht löschen**, sondern die Zeilen zu gelöschten Modulen entfernen.

- [ ] **Step 5: Wächter und Suite grün**

Run: `node tests/abhaengigkeiten.test.js && node -c src/index.js && npm test`
Expected: PASS, alle Testdateien grün (nur noch die verbleibenden, ungefähr 30).

- [ ] **Step 6: Commit**

```bash
git add -A tests src code-recherche
git commit -m "KI, Chat, Bilder, Selbstverbesserung, Logbuch geloescht (45 Module) plus Waechter-Test

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: `CLAUDE.md` und `README.md` auf den neuen Stand bringen

**Files:**
- Modify: `CLAUDE.md`, `README.md`

**Interfaces:**
- Consumes: den Stand nach Task 6.
- Produces: Dokumentation, die dem Code entspricht und auf `docs/ghost-uebergabe.md` verweist.

- [ ] **Step 1: `CLAUDE.md` bearbeiten**

Wende diese Änderungen an (alles andere bleibt):
- Einleitung: den Satz "Verwaltet Event-Anmeldungen, staatliche Meldungen (SK), das Logbuch mit Bildnachweisen, Auszahlungen und Verlosungen — und redet nebenbei im Chat." ersetzen durch "Verwaltet Event-Anmeldungen, staatliche Meldungen (SK) und Verlosungen. KI, Chat, Bilder, Logbuch und Auszahlung sind am 3.10.2026 entfernt worden (siehe `docs/ghost-uebergabe.md`)."
- Abschnitt **Betrieb**: `npm test` ohne feste Dateizahl ("29 Testdateien") nennen (z. B. "alle Testdateien").
- Abschnitt **Aufbau**: "63 Module in `src/`" auf die tatsächliche Zahl ändern (`ls src/*.js | wc -l`); die Zeilen zu `logbook*.js` und `ollama.js` streichen.
- Abschnitte **Die drei Zeichen im Logbuch** und alles zum Logbuch ganz entfernen.
- Abschnitt **Dashboard**: auf den neuen Inhalt kürzen (Offene Anmeldungen mit Absagen, Steuerzentrale, Aktivität, Fehler, Rechner-Werte); die Sätze über Logbuch-Stand, Sammelauszahlung, Ollama-Kern, `POST /api/bilder-pause` und die Fragen-DMs entfernen. Schreibende Wege nennen: `/api/schalter`, `/api/neustart`, `/api/aus`, `/api/anmeldung-absagen`.
- Abschnitt **Was er von sich aus tut**: die Tabelle auf die verbleibenden Zeilen kürzen (nur `event-erinnerung.js` und `termin-erinnerung.js`; Zeilen für Meilenstein, Tagesrhythmus, Voll-Kommentar, Bild-Kommentar, Rückfrage-DMs entfernen). "Nachts (2–10 Uhr) sagt er nichts." prüfen: wenn `event-erinnerung` das tut, stehen lassen.
- Abschnitte **Der wichtigste Grundsatz: erst ablesen, dann raten** und **Der zweite Grundsatz: messen, nicht vermuten**: durch einen kurzen Absatz ersetzen: "KI-Grundsätze (erst ablesen, dann raten; messen, nicht vermuten) und die gemessenen Fehlschläge stehen in `docs/ghost-uebergabe.md`." Der Event-Bot arbeitet ohnehin nur noch mit festen Parsern.
- Abschnitt **Feste Entscheidungen**: die Punkte zu Visum-Prüfung, Bildlesen/`qwen3-vl` und "Eventlogik … nicht anfassen" (behalten) prüfen: Visum/Bildlesen entfernen, Token-in-`.env.example` und Git-Repo behalten (den Satz über "perspektivisch an sich selbst arbeiten" streichen), "Die nachts leeren 40er-Zeitfenster" und "Auswechselspieler" behalten.
- Abschnitt **Modelle (Ollama, lokal)**: komplett entfernen.
- Abschnitt **Fallen, die schon zugeschnappt sind**: Kanalnamen/Fettbuchstaben (`ticket-namen`), "Wem ein Logbuch-Ticket gehört", Zuhause-Kanal/`handleAutoLearn` entfernen; Rename-Limit und Spielernummer als Anker behalten, soweit sie noch Event-Bezug haben.
- Neue kurze Zeile ganz oben unter dem Titel: "Ghost (KI) ist ein eigenes Projekt in `C:\Users\kevin\Desktop\Ghost` und hat mit diesem Bot nichts mehr zu tun."

- [ ] **Step 2: `README.md` prüfen und anpassen**

Run: `grep -n -i "ollama\|logbuch\|chat\|selbstverbesserung\|bild" README.md`
Entferne bzw. korrigiere jede Fundstelle so, dass die README nur noch beschreibt, was der Event-Bot wirklich tut (Events, Anmeldungen, SK, Commands, Verlosungen, Dashboard, Betrieb über `scripts/`).

- [ ] **Step 3: Konsistenz prüfen**

Run: `grep -n -i "ollama\|logbook\|selbstverbesserung\|bild-" CLAUDE.md README.md`
Expected: keine Treffer außer in den Sätzen, die ausdrücklich auf `docs/ghost-uebergabe.md` verweisen.

- [ ] **Step 4: Suite und Commit**

Run: `npm test`
Expected: PASS.

```bash
git add CLAUDE.md README.md
git commit -m "CLAUDE.md und README: Event-Bot ohne KI und Logbuch

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Nach der Umsetzung: Umschalten (macht Kevin mit mir, nicht der Plan)

1. **Letzte Sammelauszahlung** im alten Bot laufen lassen (danach gibt es sie nicht mehr).
2. Ganz-Branch-Review, CI grün, Merge nach `main`.
3. Bot stoppen (`.\scripts\stop-bot.ps1`), `main` ziehen, Bot starten (`.\scripts\restart-bot.ps1`).
4. **Live-Prüfliste** aus der Spec abarbeiten: `/event erstellen`, Anmelden per Button, `/eintragen`, `/austragen`, "ghost tausche A mit B" im Text mit Rückgängig-Knopf, `/angriff` und eine SK-Meldung als Satz, `/verlosung`, `/top`, Dashboard und Absagen-Knopf; die drei Logbuch-Commands sind in Discord weg; im Log steht nichts von Ollama.
