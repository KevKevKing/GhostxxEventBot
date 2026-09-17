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
const { grundstandAufbauen, registerNamensGedaechtnis } = require('./namens-gedaechtnis');
const { registerTicketAufraeumer, ticketsBeimStartAufraeumen } = require('./ticket-aufraeumer');
const { startPraesenz } = require('./praesenz');
const { startDashboard } = require('./dashboard');
const { startTerminErinnerung } = require('./termin-erinnerung');
const { startSelbstverbesserung } = require('./selbstverbesserung');
const { registerBildVorablesen } = require('./bild-vorablesen');
const { registerFamilienListe } = require('./familien-liste');
const { isReachable, pickModel, warmUp } = require('./ollama');
const { startOllamaWatch } = require('./ollama-watch');
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

        // Namen einmal festhalten, damit spaetere Umbenennungen einen
        // Ausgangspunkt haben. Beim ersten Start sind das alle, danach nur
        // noch die, die sich zwischendurch geaendert haben.
        const neueNamen = await grundstandAufbauen(guild).catch(() => 0);
        if (neueNamen) console.log(`${neueNamen} Namensaenderungen nachgetragen.`);

        // Nach den Mitgliedern, nicht davor: ohne sie findet der Aufraeumer
        // niemanden und wuerde jedes Ticket in Ruhe lassen.
        // Nicht abwarten - das kann bei vielen Tickets dauern.
        ticketsBeimStartAufraeumen(guild).catch((error) => {
          console.warn('Tickets aufraeumen fehlgeschlagen:', error.message);
        });
      }

      registerTicketAufraeumer(readyClient);

      // Vor dem Archivieren sichern: der Archivierer schreibt events.json neu,
      // und genau dabei ist schon einmal etwas schiefgegangen.
      startBackups();

      startEventScheduler(readyClient);
      startGiveawayScheduler(readyClient);
      startEventArchiver();

      registerMessageHandler(readyClient);
      registerNamensGedaechtnis(readyClient);

      // Was er von sich aus sagt: Meilensteine, morgens ein Ausblick, abends
      // ein Rueckblick. Nach dem Nachrichten-Handler, damit ein Fehler hier
      // das Antworten nicht mitreisst.
      startPraesenz(readyClient);

      // Ruft 25 Minuten vor einem selbst erstellten Event nochmal und traegt
      // das Ende ein - geschlossen wird dann vom bestehenden Zeitplaner.
      startTerminErinnerung(readyClient);

      // Liest jedes Logbuch-Bild, sobald es hochgeladen wird - still, ein Bild
      // alle 45 Sekunden, und nie bei belegter Grafikkarte. Die Auszahlung
      // findet die Ergebnisse dann schon vor.
      registerBildVorablesen(readyClient);

      // Wer eine Rangrolle traegt, ist Familienmitglied - Discord ist die
      // Quelle, seit die Ingame-Liste am 15.08.2026 einmalig abgeglichen und
      // aufgeraeumt wurde. Liste jede Minute, Abweichungen stuendlich.
      registerFamilienListe(readyClient);

      // Nur auf diesem Rechner erreichbar. Faellt es aus, laeuft der Bot
      // unveraendert weiter - es liest nur, es steuert nichts.
      startDashboard(readyClient);

      // Verstehen -> lernen -> anwenden (Vorschlag): beobachtet eigene
      // Fehler/Abstuerze, schlaegt hoechstens 5x taeglich automatisch einen
      // Fix vor, wendet nie selbst etwas an - siehe docs/superpowers/specs/
      // 2026-09-17-ghostxx-selbstverbesserung-design.md. Steht ueber den
      // Dashboard-Schalter "selbstverbesserung" standardmaessig auf AUS -
      // erst nach Kevins Handpruefung laeuft hier ueberhaupt etwas.
      startSelbstverbesserung(readyClient);

      // Ollama darf nicht blockieren: laeuft es nicht, funktionieren Events,
      // Slash-Commands und Logging trotzdem weiter. Nur das freie Chatten faellt aus.
      const ollamaUp = await isReachable();
      if (ollamaUp) {
        const model = await pickModel();
        console.log(`Ollama erreichbar, Modell: ${model}`);
        warmUp().catch(() => null);
      } else {
        console.warn(`Ollama unter ${config.ollamaUrl} nicht erreichbar - Chat ist deaktiviert.`);
      }

      // Behaelt Ollama im Auge und meldet, wenn es weg ist oder wiederkommt.
      startOllamaWatch();

      logBotEvent({
        title: 'Bot gestartet',
        description: `Eingeloggt als ${readyClient.user.tag}.`,
        color: 'create',
        fields: [{ name: 'Chat', value: ollamaUp ? 'aktiv' : 'aus (Ollama nicht erreichbar)', inline: true }],
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
