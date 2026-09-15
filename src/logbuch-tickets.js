const { ChannelType, OverwriteType } = require('discord.js');
const { config } = require('./config');
const { entfetten, nummerAus } = require('./ticket-namen');
const { normalizeText } = require('./text-match');
const { letzterNameNachNummerSync, letzterNameSync } = require('./namens-gedaechtnis');

// Das Logbuch zieht vom Forum auf Tickets um.
//
// Ein Ticket ist ein normaler Textkanal in einer der Logbuch-Kategorien und
// heisst "<Nummer>-<Discord-Benutzername>", zum Beispiel "58-ghost_muffin1".
//
// Wichtig ist der Unterschied zum Forum: dort stand die SPIELERNUMMER im
// Threadnamen ("Ghost Muffiin | 266391"), hier steht der DISCORD-BENUTZERNAME.
// Das ist der Name ohne Leerzeichen und Sonderzeichen, nicht der Anzeigename -
// aus "! Ghost Muffiin | 266391" wird "ghost_muffin1".

// Ein Ticket heisst nicht immer gleich. Es durchlaeuft drei Namen:
//
//   frisch:       64-dannyd5117              <Ticketnummer>-<Benutzername>
//   uebernommen:  danny-imucupancium-156215  vom Ticketbot umbenannt
//   aufgeraeumt:  𝗗𝗮𝗻𝗻𝘆·𝗜𝗺𝘂𝗰𝘂𝗽𝗮𝗻𝗰𝗶𝘂𝗺│156215   von Ghostxx, siehe ticket-namen.js
//
// Deshalb wird nicht am Namen entschieden, ob es ein Ticket ist, sondern an der
// Kategorie. Der Name dient nur dazu, den Menschen zu finden - und dafuer gibt
// es alle drei Wege.
const OVERWRITE_MEMBER = OverwriteType.Member;

const FRISCH = /^(\d+)-(.+)$/;
// Die Spielernummer steht am Ende. Vor ihr steht ein Bindestrich (Ticketbot)
// oder ein Strich (aufgeraeumt) - jedenfalls keine weitere Ziffer.
const GECLAIMED = /(?:^|[^0-9])(\d{4,7})$/;

/** Ist das ein Logbuch-Ticket? Entscheidet die Kategorie, nicht der Name. */
function istTicket(channel) {
  if (!channel) return false;
  if (channel.type !== ChannelType.GuildText) return false;
  if (!config.logbookTicketCategoryIds.length) return false;
  return config.logbookTicketCategoryIds.includes(channel.parentId);
}

/**
 * Zaehlt dieses Ticket bei der Sammelauszahlung mit?
 *
 * Nur die uebernommenen. In "erstelltes Logbuch" liegen die frischen, um die
 * sich noch niemand gekuemmert hat, in "Geschlossene Logbuch" die erledigten.
 * Wer ein Ticket uebernimmt, sagt damit: das hier ist dran.
 *
 * Es gibt seit dem 16.08.2026 zwei "Logbuch"-Kategorien ("Logbuch" und
 * "Logbuch 2") - beide zaehlen gleich, kein Unterschied zwischen ihnen.
 */
function zaehltMit(channel) {
  if (!istTicket(channel)) return false;
  if (!config.logbookClaimedCategoryIds.length) return true;
  return config.logbookClaimedCategoryIds.includes(channel.parentId);
}

/** Benutzername so, wie Discord ihn in einen Kanalnamen schreiben wuerde. */
function punktlos(benutzername) {
  return String(benutzername || '').toLowerCase().replace(/\./g, '');
}

/** Der Discord-Benutzername aus einem frischen Ticket. */
function benutzernameAus(kanalName) {
  const treffer = String(kanalName || '').match(FRISCH);
  return treffer ? treffer[2].toLowerCase() : '';
}

/** Die Spielernummer aus einem geclaimten Ticket. */
function spielernummerAus(kanalName) {
  const name = String(kanalName || '');
  // Ein frisches Ticket faengt mit der Ticketnummer an - die ist nicht gemeint.
  if (FRISCH.test(name)) return '';
  const treffer = name.match(GECLAIMED);
  return treffer ? treffer[1] : '';
}

function ticketnummer(kanalName) {
  const treffer = String(kanalName || '').match(FRISCH);
  return treffer ? Number(treffer[1]) : null;
}

/**
 * Alle Tickets auf dem Server.
 *
 * Mit `nurGezaehlte` nur die uebernommenen - das braucht die Sammelauszahlung.
 */
async function alleTickets(guild, { nurGezaehlte = false } = {}) {
  if (!guild?.channels) return [];

  const kanaele = guild.channels.cache?.size
    ? [...guild.channels.cache.values()]
    : [...(await guild.channels.fetch().catch(() => new Map())).values()];

  return kanaele.filter(nurGezaehlte ? zaehltMit : istTicket);
}

/**
 * Wem gehoert dieses Ticket? Steht in den Kanalrechten.
 *
 * Der Ticketbot traegt den Besitzer beim Aufmachen als eigene Berechtigung
 * ein. Das ist die einzige Angabe, die keine Umbenennung anfasst - und die
 * einzige, die nicht geraten ist.
 *
 * Warum das noetig ist: das Ticket von Sascha Scholz hiess zwischendurch
 * "66-ghost_muffin1-chrismo_", weil Ghost es sich vorgenommen hatte. Nach dem
 * Namen gelesen waere es Ghosts Logbuch gewesen - und Saschas Nachweise
 * haetten bei Ghost gezaehlt.
 */
function besitzerAusRechten(guild, kanal) {
  const rechte = kanal?.permissionOverwrites?.cache;
  if (!rechte) return null;

  const mitgliedEintraege = [...rechte.values()].filter((eintrag) => eintrag.type === OVERWRITE_MEMBER);

  const menschen = mitgliedEintraege
    .map((eintrag) => guild.members.cache.get(eintrag.id))
    .filter((m) => m && !m.user?.bot);

  // Genau einer. Sind es mehrere, ist nicht klar wer gemeint ist - dann lieber
  // die Namen befragen, als sich einen aussuchen.
  if (menschen.length === 1) return menschen[0];
  if (menschen.length > 1) return null;

  // Niemand davon steht noch im Zwischenspeicher als MENSCH - entweder ist
  // der Kanal wirklich ohne Menschen, oder die Person hat den Server
  // verlassen. Discord loescht die Kanalrechte NICHT automatisch, wenn
  // jemand geht - die ID bleibt stehen, nur ueber den Zwischenspeicher
  // aufloesen laesst sie sich nicht mehr.
  //
  // Bots ausdruecklich ausschliessen: der Ticketbot traegt selbst ein
  // Kanalrecht ein und LOEST sich ueber den Zwischenspeicher normal auf -
  // waere er der einzige Eintrag, saehe das genauso aus wie "jemand
  // Unaufloesbares", ist aber kein Mensch, der gegangen ist. Nur echt
  // unaufloesbare IDs (Zwischenspeicher kennt sie ueberhaupt nicht) zaehlen.
  const unaufgeloest = mitgliedEintraege.filter((eintrag) => !guild.members.cache.get(eintrag.id));

  // Kevins Meldung (25.08.): genau das liess Tickets dauerhaft als "ohne
  // erkennbaren Besitzer" haengen, und die "Er fragt"-Funktion stellte
  // deswegen eine Frage, auf die nie eine gute Antwort kommen konnte - die
  // Person war ja weg. Das Namensgedaechtnis kennt trotzdem noch den letzten
  // bekannten Namen. Genau EIN eindeutiger, nicht aufloesbarer Eintrag reicht
  // (mehrere waeren wieder mehrdeutig, wie oben).
  if (unaufgeloest.length === 1) {
    const letzterName = letzterNameSync(unaufgeloest[0].id);
    if (letzterName) {
      return {
        id: unaufgeloest[0].id,
        displayName: letzterName,
        user: { username: '', bot: false },
        hatVerlassen: true,
      };
    }
  }

  return null;
}

/**
 * Wem gehoert dieses Ticket?
 *
 * Zuerst die Kanalrechte, dann der Name. Der Name aendert sich dreimal im
 * Leben eines Tickets, die Rechte nie.
 */
function personZuTicket(guild, kanal) {
  if (!guild?.members?.cache) return null;
  const leute = [...guild.members.cache.values()];

  const ausRechten = besitzerAusRechten(guild, kanal);
  if (ausRechten) return ausRechten;

  // Frisches Ticket: der Discord-Benutzername steht hinter der Ticketnummer.
  const benutzername = benutzernameAus(kanal?.name);
  if (benutzername) {
    const treffer = leute.find((m) => (m.user?.username || '').toLowerCase() === benutzername);
    if (treffer) return treffer;

    // Punkte im Benutzernamen laesst Discord im Kanalnamen weg: aus "finn.443"
    // wird "77-finn443". Nur gelten lassen, wenn es dabei bei einem bleibt.
    const ohnePunkt = leute.filter((m) => punktlos(m.user?.username) === benutzername);
    if (ohnePunkt.length === 1) return ohnePunkt[0];

    // Beim Uebernehmen schiebt der Ticketbot sich noch dazwischen:
    //   66-chrismo_  ->  66-ghost_muffin1-chrismo_
    // Hinten steht der Besitzer, vorne der, der es sich vorgenommen hat.
    // Deshalb von hinten suchen - und nur exakte Benutzernamen zaehlen lassen.
    const stuecke = benutzername.split('-').filter(Boolean);
    for (let i = stuecke.length - 1; i >= 0; i -= 1) {
      const genau = leute.find((m) => punktlos(m.user?.username) === stuecke[i]);
      if (genau) return genau;
    }
  }

  // Uebernommenes Ticket: hinten steht die Spielernummer. Die ist der
  // verlaesslichste Anker ueberhaupt - sie ueberlebt jede Umbenennung.
  const nummer = spielernummerAus(kanal?.name);
  if (nummer) {
    const treffer = leute.find((m) => nummerAus(m.displayName || '') === nummer);
    if (treffer) return treffer;
  }

  // Letzter Versuch ueber den Namen: "danny-imucupancium-156215" gegen
  // "Danny Imucupancium | 156215". Aufgeraeumte Namen stehen in mathematischen
  // Buchstaben da - die muessen vorher zurueckuebersetzt werden.
  const kern = normalizeText(entfetten(String(kanal?.name || ''))
    .replace(/[^0-9]?\d{4,7}$/, '')
    .replace(/^\d+-/, '')
    .replace(/[-·│]/g, ' '));
  if (kern.length >= 5) {
    const treffer = leute.find((m) => normalizeText(m.displayName || '').includes(kern));
    if (treffer) return treffer;
  }

  // Ganz letzter Versuch: die Person hat den Server verlassen UND Discord hat
  // beim Gehen gleich das Kanalrecht mit entfernt - dann steht in den
  // Kanalrechten am Ende gar keine menschliche ID mehr, nur noch der
  // Ticketbot (siehe besitzerAusRechten). Kevins Fall vom 25.08.: bei allen
  // fuenf gemeldeten Tickets war genau das passiert.
  //
  // Die Spielernummer im (aufgeraeumten) Ticketnamen bleibt trotzdem stehen -
  // sie ueberlebt ja auch jede Umbenennung zu Lebzeiten. Das Namensgedaechtnis
  // kennt zu dieser Nummer noch den letzten bekannten Namen.
  if (nummer) {
    const gefunden = letzterNameNachNummerSync(nummer);
    if (gefunden) {
      return {
        id: gefunden.userId,
        displayName: gefunden.name,
        user: { username: '', bot: false },
        hatVerlassen: true,
      };
    }
  }

  return null;
}

/** Das Ticket einer Person, falls es eins gibt. */
async function ticketVonPerson(guild, member) {
  if (!member?.user?.username) return null;

  const tickets = await alleTickets(guild);
  return tickets.find((k) => personZuTicket(guild, k)?.id === member.id) || null;
}

module.exports = {
  alleTickets,
  benutzernameAus,
  istTicket,
  personZuTicket,
  ticketVonPerson,
  spielernummerAus,
  ticketnummer,
  zaehltMit,
};
