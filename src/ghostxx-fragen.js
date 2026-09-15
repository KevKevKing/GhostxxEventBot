const fs = require('node:fs/promises');
const path = require('node:path');
const { ChannelType } = require('discord.js');
const { config } = require('./config');
const { writeFileAtomic } = require('./atomic-write');
const knowledge = require('./knowledge');
const { alleTickets, personZuTicket } = require('./logbuch-tickets');
const { EVENTS } = require('./logbook-events');
const { satzFuer } = require('./auszahlung-saetze');
const { normalizeText } = require('./text-match');

// Was Ghostxx nicht weiss - und woran man es merkt.
//
// Er fragt nicht ins Blaue ("erzaehl mir was ueber die Familie"), sondern nur
// dort, wo eine echte Luecke im Betrieb steht: ein Ticket ohne Besitzer, ein
// Event ohne Auszahlungssatz, eine Anmeldung ohne Termin. Fragen ohne Anlass
// beantwortet nach dem dritten Mal niemand mehr.
//
// Die Antwort landet im Gedaechtnis - dasselbe, das im Zuhause-Kanal gefuellt
// wird. Nur eben gezielt statt zufaellig.

/**
 * Woran erkennt man, dass etwas fehlt?
 *
 * Jede Frage braucht:
 *   id      damit eine beantwortete Frage nicht wiederkommt
 *   frage   was er wissen will, in einem Satz
 *   warum   weshalb er fragt - sonst wirkt es beliebig
 */
const datei = path.join(config.dataDir, 'ghostxx-fragen.json');

/**
 * Welche Fragen sind beantwortet?
 *
 * Bewusst ueber die Kennung der Frage, nicht ueber den Text der Antwort.
 * Vorher wurde geprueft, ob im Gedaechtnis irgendwo "50er auszahlung"
 * vorkommt - gespeichert stand dort aber "Was wird fuer 50er ausgezahlt -
 * Win und Lose: ...". Der Stichwortabgleich traf nie, und nach jedem
 * Neuladen standen dieselben elf Fragen wieder da, obwohl Kevin sie alle
 * beantwortet hatte.
 */
async function beantworteteFragen() {
  try {
    const roh = await fs.readFile(datei, 'utf8');
    return new Set(JSON.parse(roh).beantwortet || []);
  } catch {
    return new Set();
  }
}

async function merkeBeantwortet(id) {
  if (!id) return;
  const menge = await beantworteteFragen();
  menge.add(id);
  await writeFileAtomic(datei, JSON.stringify({ beantwortet: [...menge] }, null, 2)).catch(() => null);
}

async function offeneFragen(client) {
  const fragen = [];
  const gewusst = await knowledge.list().catch(() => []);
  const bekannt = gewusst.map((f) => normalizeText(f.text));
  const erledigt = await beantworteteFragen();

  const schonBeantwortet = (stichwort) => bekannt.some((t) => t.includes(normalizeText(stichwort)));

  const guild = client?.guilds?.cache?.get(config.guildId);

  // 1. Tickets, deren Besitzer er nicht bestimmen kann.
  if (guild) {
    const tickets = await alleTickets(guild, { nurGezaehlte: true }).catch(() => []);
    for (const kanal of tickets) {
      if (personZuTicket(guild, kanal)) continue;
      if (schonBeantwortet(kanal.name)) continue;
      fragen.push({
        id: `ticket:${kanal.id}`,
        frage: `Wem gehört das Ticket "${kanal.name}"?`,
        warum: 'Weder Benutzername noch Spielernummer im Namen führen zu jemandem — bei der Auszahlung fällt es sonst hinten runter.',
      });
    }
  }

  // 2. Events ohne Auszahlungssatz.
  //
  // Die Saetze stehen im Kanal auszahlung-info und sind im Code hinterlegt.
  // Kommt ein Event dazu, fehlt seiner - und bei der Auszahlung steht dann
  // "kein Satz hinterlegt".
  for (const event of EVENTS) {
    const satz = satzFuer(event.key);
    if (satz && (satz.vonHand || satz.win !== null)) continue;
    if (schonBeantwortet(`${event.label} auszahlung`)) continue;
    fragen.push({
      id: `satz:${event.key}`,
      frage: `Was wird für ${event.label} ausgezahlt — Win und Lose?`,
      warum: 'Steht bei mir kein Betrag, muss jemand die Tabelle danebenlegen und selbst rechnen.',
    });
  }

  // 3. Seine Umgebung.
  //
  // Er sieht Rollen und Kanaele, weiss aber nicht, wofuer sie da sind. Das
  // Thema wird hier FEST gefunden - eine echte Rolle, ein echter Kanal - und
  // nicht vom Sprachmodell erfunden. Sonst fragt er nach Dingen, die es nicht
  // gibt, und das faellt beim dritten Mal auf.
  //
  // Hoechstens zwei davon gleichzeitig. Wer zehn Fragen auf einmal sieht,
  // beantwortet keine.
  if (guild) {
    const umgebung = [];

    const rollen = [...guild.roles.cache.values()]
      .filter((r) => !r.managed && r.id !== guild.id && r.members.size >= 3)
      .sort((a, b) => b.members.size - a.members.size);

    for (const rolle of rollen) {
      if (umgebung.length >= 1) break;
      if (schonBeantwortet(rolle.name)) continue;
      umgebung.push({
        id: `rolle:${rolle.id}`,
        frage: `Wofür ist die Rolle "${rolle.name}" da?`,
        warum: `${rolle.members.size} Leute haben sie, und ich weiß nicht, was sie bedeutet.`,
      });
    }

    const kanaele = [...guild.channels.cache.values()]
      .filter((c) => c.type === ChannelType.GuildText && !config.logbookTicketCategoryIds.includes(c.parentId))
      .sort((a, b) => a.name.localeCompare(b.name, 'de'));

    for (const kanal of kanaele) {
      if (umgebung.length >= 2) break;
      if (schonBeantwortet(kanal.name)) continue;
      umgebung.push({
        id: `kanal:${kanal.id}`,
        frage: `Was gehört in den Kanal "${kanal.name}"?`,
        warum: 'Ich sehe ihn, weiß aber nicht, wofür er gedacht ist.',
      });
    }

    fragen.push(...umgebung);
  }

  // Beantwortete fliegen raus - erst hier, damit die Zaehlung oben (nur zwei
  // Umgebungsfragen gleichzeitig) sich nicht dauernd verschiebt.
  //
  // Zwei Wege, und beide werden gebraucht:
  //   - die Kennung, sauber und eindeutig
  //   - der Fragetext im Gedaechtnis, fuer alles was beantwortet wurde, bevor
  //     es die Kennung gab. Ohne das standen elf schon beantwortete Fragen
  //     nach jedem Neuladen wieder da.
  return fragen
    .filter((f) => !erledigt.has(f.id) && !stehtImGedaechtnis(f.frage, bekannt))
    .slice(0, 6);
}

/** Faengt eine gespeicherte Aussage mit genau dieser Frage an? */
function stehtImGedaechtnis(frage, bekannt) {
  const anfang = normalizeText(String(frage || '').replace(/\?$/, '')).trim();
  if (anfang.length < 10) return false;
  return bekannt.some((satz) => satz.startsWith(anfang));
}

/**
 * Eine Antwort ins Gedaechtnis.
 *
 * Bewusst mit der Frage davor: "80k" allein ist in zwei Wochen wertlos,
 * "Fuer die Bank gibt es 80k Win" nicht.
 */
async function beantworte(frage, antwort, userId = '', id = '') {
  const text = String(antwort || '').trim();
  if (text.length < 2) return { ok: false, reason: 'zu_kurz' };

  const satz = `${String(frage || '').replace(/\?$/, '')}: ${text}`;
  const ergebnis = await knowledge.remember(satz, userId);

  // Auch wenn das Wissen schon bekannt war: die Frage ist beantwortet und
  // soll nicht wiederkommen.
  if (ergebnis.ok || ergebnis.reason === 'schon_bekannt') {
    await merkeBeantwortet(id);
    return { ...ergebnis, ok: true };
  }

  return ergebnis;
}

module.exports = { beantworte, beantworteteFragen, merkeBeantwortet, offeneFragen };
