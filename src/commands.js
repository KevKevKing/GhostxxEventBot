const {
  ApplicationCommandType, ChannelType, ContextMenuCommandBuilder, SlashCommandBuilder,
} = require('discord.js');

function buildCommands() {
  return [
    new SlashCommandBuilder()
      .setName('event')
      .setDescription('Eventplanung verwalten')
      .setDMPermission(false)
      .addSubcommand((subcommand) =>
        subcommand
          .setName('erstellen')
          .setDescription('Erstellt eine Event-Anmeldung im Eventkanal')
          .addStringOption((option) =>
            option
              .setName('titel')
              .setDescription('Name des Events')
              .setRequired(true)
              .setMaxLength(100),
          )
          .addStringOption((option) =>
            option
              .setName('wann')
              .setDescription('Datum und Uhrzeit, z.B. 07.06.2026 20:00')
              .setRequired(true)
              .setMaxLength(80),
          )
          .addStringOption((option) =>
            option
              .setName('beschreibung')
              .setDescription('Kurze Beschreibung oder Ablauf')
              .setRequired(true)
              .setMaxLength(900),
          )
          .addStringOption((option) =>
            option
              .setName('treffpunkt')
              .setDescription('Treffpunkt oder Sammelort')
              .setRequired(false)
              .setMaxLength(120),
          )
          .addChannelOption((option) =>
            option
              .setName('channel')
              .setDescription('Channel, in den die Event-Anmeldung gesendet wird')
              .addChannelTypes(ChannelType.GuildAnnouncement, ChannelType.GuildText)
              .setRequired(false),
          )
          .addIntegerOption((option) =>
            option
              .setName('max_teilnehmer')
              .setDescription('Optionales Teilnehmerlimit')
              .setRequired(false)
              .setMinValue(1)
              .setMaxValue(200),
          )
          .addBooleanOption((option) =>
            option
              .setName('auswechselspieler')
              .setDescription('Auswechselspieler-Liste aktivieren')
              .setRequired(false),
          )
          .addIntegerOption((option) =>
            option
              .setName('max_auswechselspieler')
              .setDescription('Limit fuer Auswechselspieler, Standard ist 3')
              .setRequired(false)
              .setMinValue(1)
              .setMaxValue(50),
          )
          .addMentionableOption((option) =>
            option
              .setName('ping')
              .setDescription('Ping beim Posten frei auswaehlen: Rolle oder Member')
              .setRequired(false),
          ),
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName('liste')
          .setDescription('Zeigt alle offenen Events'),
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName('teilnehmer')
          .setDescription('Zeigt die Teilnehmer eines Events')
          .addStringOption((option) =>
            option
              .setName('event_id')
              .setDescription('Event-ID aus dem Embed')
              .setRequired(true)
              .setMaxLength(40),
          ),
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName('schliessen')
          .setDescription('Schliesst die Anmeldung eines Events')
          .addStringOption((option) =>
            option
              .setName('event_id')
              .setDescription('Event-ID aus dem Embed')
              .setRequired(true)
              .setMaxLength(40),
          ),
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName('absagen')
          .setDescription('Sagt ein Event ab')
          .addStringOption((option) =>
            option
              .setName('event_id')
              .setDescription('Event-ID aus dem Embed')
              .setRequired(true)
              .setMaxLength(40),
          )
          .addStringOption((option) =>
            option
              .setName('grund')
              .setDescription('Optionaler Grund')
              .setRequired(false)
              .setMaxLength(300),
          ),
      ),

    new SlashCommandBuilder()
      .setName('angriff')
      .setDescription('Meldet einen Angriff im staatlichen Channel')
      .setDMPermission(false)
      .addStringOption((option) =>
        option
          .setName('wer_wurde_angegriffen')
          .setDescription('Wer wurde angegriffen?')
          .setRequired(true)
          .setMaxLength(120),
      )
      .addStringOption((option) =>
        option
          .setName('wann_wurde_angegriffen')
          .setDescription('Wann wurde angegriffen?')
          .setRequired(true)
          .setMaxLength(120),
      )
      .addStringOption((option) =>
        option
          .setName('details')
          .setDescription('Frei formulierbare Details')
          .setRequired(false)
          .setMaxLength(500),
      )
      .addMentionableOption((option) =>
        option
          .setName('ping')
          .setDescription('Ping frei auswaehlen: Rolle oder Member')
          .setRequired(false),
      ),

    new SlashCommandBuilder()
      .setName('verteidigung')
      .setDescription('Meldet eine Verteidigung im staatlichen Channel')
      .setDMPermission(false)
      .addStringOption((option) =>
        option
          .setName('wer_hat_angegriffen')
          .setDescription('Wer hat angegriffen?')
          .setRequired(true)
          .setMaxLength(120),
      )
      .addStringOption((option) =>
        option
          .setName('wann_wurde_angegriffen')
          .setDescription('Wann wurde angegriffen?')
          .setRequired(true)
          .setMaxLength(120),
      )
      .addStringOption((option) =>
        option
          .setName('details')
          .setDescription('Frei formulierbare Details')
          .setRequired(false)
          .setMaxLength(500),
      )
      .addMentionableOption((option) =>
        option
          .setName('ping')
          .setDescription('Ping frei auswaehlen: Rolle oder Member')
          .setRequired(false),
      ),

    new SlashCommandBuilder()
      .setName('eintragen')
      .setDescription('Traegt einen Spieler in eine Anmeldung ein')
      .setDMPermission(false)
      .addUserOption((option) =>
        option
          .setName('spieler')
          .setDescription('Wen moechtest du eintragen?')
          .setRequired(true),
      )
      .addStringOption((option) =>
        option
          .setName('nachrichten_id')
          .setDescription('Welche Nachrichten-ID soll bearbeitet werden?')
          .setRequired(true)
          .setMaxLength(40),
      )
      .addBooleanOption((option) =>
        option
          .setName('auswechselspieler')
          .setDescription('Spieler als Auswechselspieler eintragen')
          .setRequired(false),
      ),

    new SlashCommandBuilder()
      .setName('austragen')
      .setDescription('Entfernt einen Spieler aus einer Anmeldung')
      .setDMPermission(false)
      .addUserOption((option) =>
        option
          .setName('spieler')
          .setDescription('Wen moechtest du austragen?')
          .setRequired(true),
      )
      .addStringOption((option) =>
        option
          .setName('nachrichten_id')
          .setDescription('Welche Nachrichten-ID soll bearbeitet werden?')
          .setRequired(true)
          .setMaxLength(40),
      ),

    new SlashCommandBuilder()
      .setName('say')
      .setDescription('Schreibt eine Nachricht als Bot')
      .setDMPermission(false)
      .addStringOption((option) =>
        option
          .setName('nachricht')
          .setDescription('Optional: leer lassen fuer Textfenster mit Shift + Enter')
          .setRequired(false)
          .setMaxLength(2000),
      )
      .addChannelOption((option) =>
        option
          .setName('channel')
          .setDescription('Optionaler Ziel-Channel')
          .addChannelTypes(ChannelType.GuildAnnouncement, ChannelType.GuildText)
          .setRequired(false),
      )
      .addMentionableOption((option) =>
        option
          .setName('ping')
          .setDescription('Mit {ping} im Text einfuegen, sonst vorangestellt')
          .setRequired(false),
      )
      .addUserOption((option) =>
        option
          .setName('person_1')
          .setDescription('Mit {person_1} im Text einfuegen')
          .setRequired(false),
      )
      .addUserOption((option) =>
        option
          .setName('person_2')
          .setDescription('Mit {person_2} im Text einfuegen')
          .setRequired(false),
      )
      .addUserOption((option) =>
        option
          .setName('person_3')
          .setDescription('Mit {person_3} im Text einfuegen')
          .setRequired(false),
      )
      .addUserOption((option) =>
        option
          .setName('person_4')
          .setDescription('Mit {person_4} im Text einfuegen')
          .setRequired(false),
      )
      .addUserOption((option) =>
        option
          .setName('person_5')
          .setDescription('Mit {person_5} im Text einfuegen')
          .setRequired(false),
      )
      .addRoleOption((option) =>
        option
          .setName('rolle')
          .setDescription('Mit {rolle} im Text einfuegen')
          .setRequired(false),
      )
      .addBooleanOption((option) =>
        option
          .setName('pings')
          .setDescription('Freie Erwaehnungen im Text wirklich ausloesen')
          .setRequired(false),
      ),

    new SlashCommandBuilder()
      .setName('embed')
      .setDescription('Erstellt eine Embed-Nachricht als Bot')
      .setDMPermission(false)
      .addStringOption((option) =>
        option
          .setName('text')
          .setDescription('Optional: leer lassen fuer Textfenster mit Shift + Enter')
          .setRequired(false)
          .setMaxLength(4000),
      )
      .addStringOption((option) =>
        option
          .setName('titel')
          .setDescription('Optionaler Embed-Titel')
          .setRequired(false)
          .setMaxLength(256),
      )
      .addChannelOption((option) =>
        option
          .setName('channel')
          .setDescription('Optionaler Ziel-Channel')
          .addChannelTypes(ChannelType.GuildAnnouncement, ChannelType.GuildText)
          .setRequired(false),
      )
      .addMentionableOption((option) =>
        option
          .setName('ping')
          .setDescription('Mit {ping} im Embed einfuegen und wirklich pingen')
          .setRequired(false),
      )
      .addStringOption((option) =>
        option
          .setName('farbe')
          .setDescription('Hex-Farbe, z.B. #8b5cf6')
          .setRequired(false)
          .setMaxLength(7),
      )
      .addUserOption((option) =>
        option
          .setName('person_1')
          .setDescription('Mit {person_1} im Text einfuegen')
          .setRequired(false),
      )
      .addUserOption((option) =>
        option
          .setName('person_2')
          .setDescription('Mit {person_2} im Text einfuegen')
          .setRequired(false),
      )
      .addUserOption((option) =>
        option
          .setName('person_3')
          .setDescription('Mit {person_3} im Text einfuegen')
          .setRequired(false),
      )
      .addUserOption((option) =>
        option
          .setName('person_4')
          .setDescription('Mit {person_4} im Text einfuegen')
          .setRequired(false),
      )
      .addUserOption((option) =>
        option
          .setName('person_5')
          .setDescription('Mit {person_5} im Text einfuegen')
          .setRequired(false),
      )
      .addRoleOption((option) =>
        option
          .setName('rolle')
          .setDescription('Mit {rolle} im Text einfuegen')
          .setRequired(false),
      )
      .addBooleanOption((option) =>
        option
          .setName('pings')
          .setDescription('Freie Erwaehnungen im Text wirklich ausloesen')
          .setRequired(false),
      ),

    new SlashCommandBuilder()
      .setName('purge')
      .setDescription('Loescht Nachrichten im aktuellen Channel')
      .setDMPermission(false)
      .addIntegerOption((option) =>
        option
          .setName('anzahl')
          .setDescription('Wie viele Nachrichten sollen geloescht werden?')
          .setRequired(true)
          .setMinValue(1)
          .setMaxValue(100),
      ),

    new SlashCommandBuilder()
      .setName('bearbeiten')
      .setDescription('Bearbeitet eine bestehende Event-Anmeldung')
      .setDMPermission(false)
      .addStringOption((option) =>
        option
          .setName('nachrichten_id')
          .setDescription('Welche Nachrichten-ID soll bearbeitet werden?')
          .setRequired(true)
          .setMaxLength(40),
      )
      .addStringOption((option) =>
        option
          .setName('titel')
          .setDescription('Neuer Name des Events')
          .setRequired(false)
          .setMaxLength(100),
      )
      .addStringOption((option) =>
        option
          .setName('platz_1')
          .setDescription('Neuer Gewinn fuer Verlosung Platz 1')
          .setRequired(false)
          .setMaxLength(200),
      )
      .addStringOption((option) =>
        option
          .setName('platz_2')
          .setDescription('Neuer Gewinn fuer Verlosung Platz 2')
          .setRequired(false)
          .setMaxLength(200),
      )
      .addStringOption((option) =>
        option
          .setName('platz_3')
          .setDescription('Neuer Gewinn fuer Verlosung Platz 3')
          .setRequired(false)
          .setMaxLength(200),
      )
      .addStringOption((option) =>
        option
          .setName('wann')
          .setDescription('Neues Datum und Uhrzeit, z.B. 07.06.2026 20:00')
          .setRequired(false)
          .setMaxLength(80),
      )
      .addStringOption((option) =>
        option
          .setName('auslosung')
          .setDescription('Neue Auslosung fuer Verlosungen, z.B. 21.06.2026 23:00')
          .setRequired(false)
          .setMaxLength(80),
      )
      .addStringOption((option) =>
        option
          .setName('beschreibung')
          .setDescription('Neue Beschreibung oder neuer Ablauf')
          .setRequired(false)
          .setMaxLength(900),
      )
      .addStringOption((option) =>
        option
          .setName('treffpunkt')
          .setDescription('Neuer Treffpunkt, "-" entfernt ihn')
          .setRequired(false)
          .setMaxLength(120),
      )
      .addChannelOption((option) =>
        option
          .setName('channel')
          .setDescription('Neuer Channel fuer die Event-Anmeldung')
          .addChannelTypes(ChannelType.GuildAnnouncement, ChannelType.GuildText)
          .setRequired(false),
      )
      .addIntegerOption((option) =>
        option
          .setName('max_teilnehmer')
          .setDescription('Neues Teilnehmerlimit, 0 entfernt das Limit')
          .setRequired(false)
          .setMinValue(0)
          .setMaxValue(200),
      )
      .addBooleanOption((option) =>
        option
          .setName('auswechselspieler')
          .setDescription('Auswechselspieler-Liste aktivieren oder deaktivieren')
          .setRequired(false),
      )
      .addIntegerOption((option) =>
        option
          .setName('max_auswechselspieler')
          .setDescription('Neues Auswechselspieler-Limit, 0 deaktiviert die Liste')
          .setRequired(false)
          .setMinValue(0)
          .setMaxValue(50),
      )
      .addMentionableOption((option) =>
        option
          .setName('ping')
          .setDescription('Ping frei auswaehlen: Rolle oder Member')
          .setRequired(false),
      ),

    new SlashCommandBuilder()
      .setName('verlosung')
      .setDescription('Erstellt eine gespeicherte Verlosung')
      .setDMPermission(false)
      .addStringOption((option) =>
        option
          .setName('platz_1')
          .setDescription('Gewinn fuer Platz 1')
          .setRequired(true)
          .setMaxLength(200),
      )
      .addStringOption((option) =>
        option
          .setName('platz_2')
          .setDescription('Gewinn fuer Platz 2')
          .setRequired(true)
          .setMaxLength(200),
      )
      .addStringOption((option) =>
        option
          .setName('platz_3')
          .setDescription('Gewinn fuer Platz 3')
          .setRequired(true)
          .setMaxLength(200),
      )
      .addStringOption((option) =>
        option
          .setName('auslosung')
          .setDescription('Auslosungsdatum und Uhrzeit, z.B. 18.06.2026 23:00')
          .setRequired(true)
          .setMaxLength(80),
      )
      .addChannelOption((option) =>
        option
          .setName('channel')
          .setDescription('Optionaler Verlosungs-Channel')
          .addChannelTypes(ChannelType.GuildAnnouncement, ChannelType.GuildText)
          .setRequired(false),
      )
      .addMentionableOption((option) =>
        option
          .setName('ping')
          .setDescription('Ping frei auswaehlen: Rolle oder Member')
          .setRequired(false),
      ),

    new SlashCommandBuilder()
      .setName('auszahlen')
      .setDescription('Zählt die Event-Nachweise in diesem Logbuch-Thread aus')
      .setDMPermission(false)
      .addBooleanOption((option) =>
        option
          .setName('bilder_pruefen')
          .setDescription('Screenshots gegen den Text prüfen (dauert länger), Standard: ja')
          .setRequired(false),
      )
      .addBooleanOption((option) =>
        option
          .setName('abhaken')
          .setDescription('Gezählte Beiträge mit dem Häkchen markieren, Standard: ja')
          .setRequired(false),
      ),

    new SlashCommandBuilder()
      .setName('sammelauszahlung')
      .setDescription('Zählt alle Logbuch-Threads auf einmal aus')
      .setDMPermission(false)
      .addBooleanOption((option) =>
        option
          .setName('bilder_pruefen')
          .setDescription('Screenshots gegen den Text prüfen (dauert deutlich länger), Standard: ja')
          .setRequired(false),
      )
      .addBooleanOption((option) =>
        option
          .setName('abhaken')
          .setDescription('Gezählte Beiträge mit dem Häkchen markieren, Standard: ja')
          .setRequired(false),
      ),

    // Dasselbe wie /sammelauszahlung, nur ohne Bildpruefung.
    //
    // Es gibt die Einstellung "bilder_pruefen: false" zwar schon, aber sie
    // ist versteckt und man muss sie jedes Mal von Hand setzen. Als eigener
    // Befehl ist klar, was passiert - und der Name sagt es auch: ausgewertet
    // wird der TEXT, nicht das Bild.
    new SlashCommandBuilder()
      .setName('sammelauswertung')
      .setDescription('Wie /sammelauszahlung, aber nur nach Text - ohne Bilder anzusehen (schnell)')
      .setDMPermission(false)
      .addBooleanOption((option) =>
        option
          .setName('abhaken')
          .setDescription('Gezählte Beiträge mit dem Häkchen markieren, Standard: ja')
          .setRequired(false),
      ),

    new SlashCommandBuilder()
      .setName('top')
      .setDescription('Zeigt, wer sich am häufigsten für Events angemeldet hat')
      .setDMPermission(false),

    new SlashCommandBuilder()
      .setName('editor')
      .setDescription('Editor-Rechte verwalten')
      .setDMPermission(false)
      .addSubcommand((subcommand) =>
        subcommand
          .setName('hinzufuegen')
          .setDescription('Gibt einem Member Editor-Rechte')
          .addUserOption((option) =>
            option
              .setName('member')
              .setDescription('Wer soll Editor-Rechte bekommen?')
              .setRequired(true),
          ),
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName('entfernen')
          .setDescription('Entfernt Editor-Rechte von einem Member')
          .addUserOption((option) =>
            option
              .setName('member')
              .setDescription('Wem sollen Editor-Rechte entfernt werden?')
              .setRequired(true),
          ),
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName('liste')
          .setDescription('Zeigt alle eingetragenen Editoren'),
      ),

    new SlashCommandBuilder()
      .setName('admin')
      .setDescription('Admin-Rechte verwalten (nur Owner und Co-Owner)')
      .setDMPermission(false)
      .addSubcommand((subcommand) =>
        subcommand
          .setName('hinzufuegen')
          .setDescription('Gibt einem Member Admin-Rechte')
          .addUserOption((option) =>
            option
              .setName('member')
              .setDescription('Wer soll Admin werden?')
              .setRequired(true),
          ),
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName('entfernen')
          .setDescription('Entfernt Admin-Rechte von einem Member')
          .addUserOption((option) =>
            option
              .setName('member')
              .setDescription('Wem sollen Admin-Rechte entfernt werden?')
              .setRequired(true),
          ),
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName('liste')
          .setDescription('Zeigt alle Rechte-Stufen auf einen Blick'),
      ),

    // Rechtsklick auf die Anmeldungs-Nachricht -> Apps -> Info. Kevins Ansage:
    // kein /info-Befehl, sondern direkt an der Nachricht - dort steht die
    // Anmeldung ja schon, man muss die ID nicht erst raussuchen.
    new ContextMenuCommandBuilder()
      .setName('Info')
      .setType(ApplicationCommandType.Message),
  ];
}

module.exports = {
  buildCommands,
};
