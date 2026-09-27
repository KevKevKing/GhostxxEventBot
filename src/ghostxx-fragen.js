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
const { chat } = require('./ollama');

// Was Ghostxx nicht weiss - und woran man es merkt.
//
// Er fragt nicht ins Blaue ("erzaehl mir was ueber die Familie"), sondern nur
// dort, wo eine echte Luecke im Betrieb steht: ein Ticket ohne Besitzer, ein
// Event ohne Auszahlungssatz, eine Anmeldung ohne Termin. Fragen ohne Anlass
// beantwortet nach dem dritten Mal niemand mehr.
//
// Die Antwort landet im Gedaechtnis - dasselbe, das im Zuhause-Kanal gefuellt
// wird. Nur eben gezielt statt zufaellig.
//
// Eine dritte, fruehere Kategorie (unbekannte Rollen/Kanaele, z.B. "Wofuer ist
// die Rolle '3 Probe' da?") gibt es nicht mehr als Frage: Kevin fand das zu
// simpel geraten fuer Namen, die sich selbst erklaeren. Stattdessen versucht
// Ghostxx jetzt selbst zu verstehen (siehe versucheUmgebungZuVerstehen unten)
// und fragt bei diesen beiden nie mehr nach - weder im Dashboard (das gibt es
// dafuer nicht mehr) noch per DM.

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

// Marker, mit dem das Modell antwortet, wenn es sich NICHT sicher genug ist.
// Grossgeschrieben und einzeln geprueft (nicht als Teil eines Satzes), damit
// ein Modell, das trotzdem drumherum redet, nicht versehentlich als "sicher"
// durchgeht.
const UNSICHER_MARKER = 'UNBEKANNT';

function baueRatePrompt(art, name) {
  const gegenstand = art === 'rolle' ? 'eine Discord-Rolle' : 'einen Discord-Kanal';
  const pronomen = art === 'rolle' ? 'sie' : 'er';
  return `Auf einem deutschen GTA-Rollenspiel-Server (Familie "Unknown") gibt es `
    + `${gegenstand} namens "${name}". Laesst sich allein aus dem Namen mit `
    + `ausreichender Sicherheit ableiten, wofuer ${pronomen} vermutlich da ist? `
    + `Wenn ja: antworte in einem kurzen Satz auf Deutsch, was du vermutest. `
    + `Wenn du dir nicht wirklich sicher bist, antworte NUR mit dem Wort ${UNSICHER_MARKER}.`;
}

/**
 * Versucht, eine Rolle/einen Kanal allein am Namen zu verstehen - statt wie
 * frueher bei jedem unbekannten Namen nachzufragen (siehe Modulkommentar
 * oben). Wirft nie: ein Ollama-Fehler bedeutet einfach "nicht verstanden",
 * keinen Absturz der aufrufenden Schleife.
 *
 * @returns {Promise<string|null>} die Vermutung, oder null wenn keine sichere
 *   Vermutung moeglich war.
 */
async function versucheZuVerstehen(art, name, { chatFn = chat } = {}) {
  try {
    const ergebnis = await chatFn({
      messages: [{ role: 'user', content: baueRatePrompt(art, name) }],
      temperature: 0.2,
      numPredict: 80,
    });
    if (!ergebnis?.ok) return null;

    const text = String(ergebnis.content || '').trim();
    if (!text || text.toUpperCase().includes(UNSICHER_MARKER)) return null;
    return text;
  } catch {
    return null;
  }
}

/**
 * Geht die Umgebung durch (Rollen/Kanaele, die er noch nicht kennt) und
 * versucht JEDEN davon selbst zu verstehen statt zu fragen. Eine sichere
 * Vermutung landet direkt im Gedaechtnis, alles andere verfaellt einfach -
 * es gibt seit der Dashboard-Kachel-Entfernung keinen Ort mehr, an dem eine
 * solche Frage angezeigt werden koennte.
 *
 * Bewusst auf hoechstens zwei Namen pro Aufruf begrenzt (ein Ollama-Aufruf
 * pro Name) - das laeuft im selben gedrosselten Takt wie die DM-Erinnerung
 * (siehe frage-erinnerung.js), nicht bei jedem Dashboard-Refresh wie frueher.
 */
async function versucheUmgebungZuVerstehen(client, { versuchen = versucheZuVerstehen } = {}) {
  const guild = client?.guilds?.cache?.get(config.guildId);
  if (!guild) return { versucht: 0, gelernt: 0 };

  const gewusst = await knowledge.list().catch(() => []);
  const bekannt = gewusst.map((f) => normalizeText(f.text));
  const schonBeantwortet = (stichwort) => bekannt.some((t) => t.includes(normalizeText(stichwort)));

  let versucht = 0;
  let gelernt = 0;

  const rollen = [...guild.roles.cache.values()]
    .filter((r) => !r.managed && r.id !== guild.id && r.members.size >= 3)
    .sort((a, b) => b.members.size - a.members.size);

  for (const rolle of rollen) {
    if (versucht >= 1) break;
    if (schonBeantwortet(rolle.name)) continue;
    versucht += 1;
    const vermutung = await versuchen('rolle', rolle.name);
    if (!vermutung) continue;
    const ergebnis = await knowledge.remember(`Rolle "${rolle.name}": ${vermutung}`, 'ghostxx-selbst').catch(() => null);
    if (ergebnis?.ok) gelernt += 1;
  }

  const kanaele = [...guild.channels.cache.values()]
    .filter((c) => c.type === ChannelType.GuildText && !config.logbookTicketCategoryIds.includes(c.parentId))
    .sort((a, b) => a.name.localeCompare(b.name, 'de'));

  for (const kanal of kanaele) {
    if (versucht >= 2) break;
    if (schonBeantwortet(kanal.name)) continue;
    versucht += 1;
    const vermutung = await versuchen('kanal', kanal.name);
    if (!vermutung) continue;
    const ergebnis = await knowledge.remember(`Kanal "${kanal.name}": ${vermutung}`, 'ghostxx-selbst').catch(() => null);
    if (ergebnis?.ok) gelernt += 1;
  }

  return { versucht, gelernt };
}

// Welche Frage wurde einer Person zuletzt per DM gestellt - damit ihre
// naechste DM-Antwort ohne Befehl/Format als Antwort darauf zaehlt (siehe
// message-handler.js). Bewusst im Speicher, nicht auf Platte: geht beim
// Neustart verloren, dann wird die naechste DM einfach wieder normaler Chat -
// kein Datenverlust, nur eine verpasste Zuordnung im seltenen Fall.
const gestellteFragen = new Map();

function merkeGestellt(userId, frage) {
  if (!userId || !frage) return;
  gestellteFragen.set(userId, frage);
}

function holeGestellte(userId) {
  return gestellteFragen.get(userId) || null;
}

function loescheGestellte(userId) {
  gestellteFragen.delete(userId);
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

module.exports = {
  beantworte,
  beantworteteFragen,
  holeGestellte,
  loescheGestellte,
  merkeBeantwortet,
  merkeGestellt,
  offeneFragen,
  versucheUmgebungZuVerstehen,
  versucheZuVerstehen,
};
