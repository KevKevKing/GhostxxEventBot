const { Events } = require('discord.js');
const { config } = require('./config');
const { alleTickets, personZuTicket, zaehltMit } = require('./logbuch-tickets');
const { entfetten, fuerKonsole, zuKanalname } = require('./ticket-namen');
const { logBotEvent } = require('./logger');
const { istAn } = require('./steuerung');

// Ghostxx raeumt die Namen der uebernommenen Logbuch-Tickets auf.
//
// Der Ticketbot hinterlaesst "danny-imucupancium-156215" oder gleich
// "63-ghost_muffin1-ghost_muffin1". Untereinander im Logbuch-Bereich erkennt
// man daran niemanden. Daraus wird der Name, den Discord sowieso anzeigt:
//
//   𝗗𝗮𝗻𝗻𝘆·𝗜𝗺𝘂𝗰𝘂𝗽𝗮𝗻𝗰𝗶𝘂𝗺│156215
//
// Warum das so aussieht und nicht wie "Danny Imucupancium | 156215", steht in
// ticket-namen.js - kurz: Discord schreibt klein und frisst Leerzeichen.
//
// Umbenannt wird nur, wenn der Mensch dahinter sicher feststeht. Ein Ticket,
// das niemandem zuzuordnen ist, bleibt wie es ist - ein falscher Name waere
// schlimmer als ein haesslicher.

// Discord erlaubt zwei Umbenennungen pro zehn Minuten und Kanal. Der Ticketbot
// hat beim Uebernehmen schon eine verbraucht, unsere ist die zweite - das geht
// gerade so auf. Beim Durchgang nach dem Start koennen es aber viele auf einmal
// sein, deshalb dazwischen eine Pause.
const PAUSE_MS = 2000;

/**
 * Einen Kanal aufraeumen, falls noetig.
 * Gibt den neuen Namen zurueck, oder '' wenn nichts zu tun war.
 */
async function raeumeAuf(guild, kanal) {
  if (!zaehltMit(kanal)) return '';

  // Bewusst kein "schon aufgeraeumt, fertig": steht dort der falsche Name,
  // muss er wieder weg. Genau das ist einmal passiert - das Ticket von Sascha
  // Scholz trug den Namen von Ghost, weil Ghost es sich vorgenommen hatte.
  const person = personZuTicket(guild, kanal);
  if (!person) return '';

  const neu = zuKanalname(person.displayName);
  if (!neu || neu === kanal.name) return '';

  await kanal.setName(neu, 'Logbuch-Ticket aufgeraeumt');
  return neu;
}

/**
 * Die Tickets alphabetisch stellen.
 *
 * Discord sortiert Kanaele nach einer Position, nicht nach dem Namen - neue
 * Tickets landen deshalb dort, wo der Ticketbot sie hinlegt. Bei ueber dreissig
 * Logbuechern findet man so niemanden wieder.
 *
 * Sortiert wird nach dem entfetteten Namen: die mathematischen Buchstaben
 * haetten sonst ihre eigene Reihenfolge, und Grossbuchstaben kaemen komplett
 * vor den kleinen.
 *
 * Alles in einem Aufruf. Die Positionen einzeln zu setzen waere derselbe
 * Aerger wie beim Umbenennen - Discord bremst das aus.
 */
async function sortiereTickets(guild) {
  if (!guild?.channels?.setPositions) return 0;

  const tickets = await alleTickets(guild, { nurGezaehlte: true });
  if (tickets.length < 2) return 0;

  // Pro Kategorie getrennt sortieren.
  //
  // Seit es "Logbuch" UND "Logbuch 2" gibt, kamen hier Tickets aus zwei
  // Kategorien zusammen. Discord zaehlt Positionen aber INNERHALB einer
  // Kategorie - alle in einen Topf zu werfen und 0..n zu vergeben, mischt
  // zwei unabhaengige Reihenfolgen durcheinander.
  const jeKategorie = new Map();
  for (const ticket of tickets) {
    if (!jeKategorie.has(ticket.parentId)) jeKategorie.set(ticket.parentId, []);
    jeKategorie.get(ticket.parentId).push(ticket);
  }

  const alphabetisch = (a, b) => (
    entfetten(a.name).toLowerCase().localeCompare(entfetten(b.name).toLowerCase(), 'de')
  );

  const auftrag = [];
  let betroffen = 0;

  for (const gruppe of jeKategorie.values()) {
    if (gruppe.length < 2) continue;

    const sortiert = [...gruppe].sort(alphabetisch);

    // Steht es schon richtig, nichts anfassen.
    //
    // Verglichen wird die REIHENFOLGE, nicht die absoluten Positionszahlen.
    // Die alte Pruefung verlangte lueckenlose Positionen ab der ersten und
    // verglich gegen die Cache-Reihenfolge - beides trifft im Alltag nie zu.
    // Folge: Er hat jede Minute dieselbe Sortierung an Discord geschickt.
    const nachPosition = [...gruppe].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    const schonRichtig = nachPosition.every((kanal, i) => kanal.id === sortiert[i].id);
    if (schonRichtig) continue;

    // Die vorhandenen Positionen weiterbenutzen, nur anders verteilt - so
    // bleibt der Block dort stehen, wo er in der Kanalliste liegt.
    const plaetze = nachPosition.map((k) => k.position ?? 0);
    sortiert.forEach((kanal, i) => auftrag.push({ channel: kanal.id, position: plaetze[i] }));
    betroffen += sortiert.length;
  }

  if (!auftrag.length) return 0;

  await guild.channels.setPositions(auftrag);
  return betroffen;
}

/** Alle uebernommenen Tickets einmal durchgehen. */
async function alleAufraeumen(guild) {
  const tickets = await alleTickets(guild, { nurGezaehlte: true });
  const geaendert = [];

  for (const kanal of tickets) {
    try {
      const alt = kanal.name;
      const neu = await raeumeAuf(guild, kanal);
      if (neu) {
        geaendert.push(`${alt} → ${neu}`);
        await new Promise((r) => setTimeout(r, PAUSE_MS));
      }
    } catch (error) {
      console.warn(`Ticket "${kanal.name}" konnte nicht umbenannt werden: ${error.message}`);
    }
  }

  return geaendert;
}

// Jede Minute nachsehen, ob Namen oder Reihenfolge nicht mehr stimmen.
//
// Die Ereignisse (ChannelUpdate/ChannelCreate) fangen den Normalfall ab, aber
// nicht alles: verpasste Ereignisse waehrend eines Neustarts, Umbenennungen
// von Hand, ein Anzeigename der sich geaendert hat. Der Takt raeumt das nach.
//
// Kostet fast nichts, solange nichts zu tun ist: gelesen wird aus dem
// Zwischenspeicher, und sowohl raeumeAuf als auch sortiereTickets pruefen
// vorher, ob ueberhaupt etwas anders waere.
const TAKT_MS = 60 * 1000;

// Laeuft gerade schon ein Durchgang? Bei vielen Umbenennungen dauert einer
// laenger als eine Minute (2 Sekunden Pause pro Ticket, plus Discords eigene
// Bremse). Zwei gleichzeitig wuerden sich gegenseitig ins Gehege kommen.
let laeuftDurchgang = false;

async function taktDurchgang(client) {
  if (!istAn('logbuchSortieren')) return;
  if (laeuftDurchgang) return;
  laeuftDurchgang = true;

  try {
    const guild = client.guilds.cache.get(config.guildId);
    if (!guild) return;

    const geaendert = await alleAufraeumen(guild);
    if (geaendert.length) {
      for (const zeile of geaendert) console.log(`Ticket aufgeraeumt: ${fuerKonsole(zeile)}`);
      // KEIN .catch() hier - logBotEvent gibt nichts zurueck. Genau daran ist
      // der Bot am 16.08. gestorben, mitten in einer Sammelauszahlung.
      logBotEvent({
        title: 'Logbuch-Tickets aufgeraeumt',
        description: geaendert.slice(0, 15).map(fuerKonsole).join('\n').slice(0, 1900),
        color: 'update',
      });
    }

    // Auch ohne Umbenennung sortieren: neue Tickets legt der Ticketbot hinten
    // an, egal wie sie heissen.
    const sortiert = await sortiereTickets(guild).catch(() => 0);
    if (sortiert) console.log(`${sortiert} Logbuch-Tickets alphabetisch sortiert.`);
  } catch (error) {
    console.warn('Ticket-Takt:', error.message);
  } finally {
    laeuftDurchgang = false;
  }
}

function registerTicketAufraeumer(client) {
  // Der Ticketbot benennt beim Uebernehmen um - genau dann sind wir dran.
  // Ein Ticket kann auch per Verschieben in die Kategorie kommen, das ist
  // ebenfalls ein channelUpdate.
  client.on(Events.ChannelUpdate, async (vorher, nachher) => {
    try {
      if (!istAn('logbuchSortieren')) return;
      if (vorher.name === nachher.name && vorher.parentId === nachher.parentId) return;
      const guild = nachher.guild;
      if (guild?.id !== config.guildId) return;

      const neu = await raeumeAuf(guild, nachher);
      if (neu) {
        // Ohne Fettbuchstaben: die Konsole laeuft ueber PowerShell und macht
        // aus ihnen Fragezeichen.
        console.log(`Ticket aufgeraeumt: ${fuerKonsole(vorher.name)} -> ${fuerKonsole(neu)}`);
        await sortiereTickets(guild).catch(() => null);
      }
    } catch (error) {
      console.warn('Ticket-Aufraeumer:', error.message);
    }
  });

  client.on(Events.ChannelCreate, async (kanal) => {
    try {
      if (!istAn('logbuchSortieren')) return;
      if (kanal.guild?.id !== config.guildId) return;
      const neu = await raeumeAuf(kanal.guild, kanal);
      if (neu) console.log(`Ticket aufgeraeumt: ${fuerKonsole(kanal.name)} -> ${fuerKonsole(neu)}`);
    } catch (error) {
      console.warn('Ticket-Aufraeumer:', error.message);
    }
  });

  const takt = setInterval(() => {
    // Bewusst ohne await und mit eigenem catch: ein Fehler hier darf den
    // Timer nicht abreissen und schon gar nicht den Bot mitnehmen.
    taktDurchgang(client).catch((error) => {
      console.warn('Ticket-Takt:', error.message);
    });
  }, TAKT_MS);
  takt.unref?.();

  console.log('Ticket-Aufraeumer laeuft (Namen und Reihenfolge jede Minute).');
  return takt;
}

/** Einmal beim Start durchgehen - faengt alles nach, was der Bot verpasst hat. */
async function ticketsBeimStartAufraeumen(guild) {
  if (!guild) return 0;
  if (!istAn('logbuchSortieren')) return 0;

  const geaendert = await alleAufraeumen(guild);

  // Sortieren auch dann, wenn kein Name geaendert wurde - der Ticketbot legt
  // neue Tickets hinten an, egal wie sie heissen.
  const sortiert = await sortiereTickets(guild).catch((error) => {
    console.warn('Tickets sortieren fehlgeschlagen:', error.message);
    return 0;
  });
  if (sortiert) console.log(`${sortiert} Logbuch-Tickets alphabetisch sortiert.`);

  if (!geaendert.length) return 0;

  console.log(`${geaendert.length} Logbuch-Ticket(s) aufgeraeumt.`);
  logBotEvent({
    title: 'Logbuch-Tickets aufgeraeumt',
    description: geaendert.slice(0, 15).join('\n').slice(0, 1900),
    color: 'update',
  });
  return geaendert.length;
}

module.exports = {
  alleAufraeumen,
  raeumeAuf,
  registerTicketAufraeumer,
  sortiereTickets,
  ticketsBeimStartAufraeumen,
};
