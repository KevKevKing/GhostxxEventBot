const fs = require('node:fs/promises');
const path = require('node:path');
const { Events } = require('discord.js');
const { config } = require('./config');
const { writeFileAtomic } = require('./atomic-write');
const { normalizeText } = require('./text-match');

// Wer hiess frueher wie.
//
// Der Bot sah Umbenennungen schon immer - der Server-Log schreibt sie mit.
// Gemerkt hat er sie sich nie. Folge: Wird jemand umbenannt, findet ihn die
// Namenssuche unter dem alten Namen nicht mehr, obwohl im Logbuch und in alten
// Nachrichten noch der alte steht.
//
// Ein echtes Beispiel aus dem Logbuch: Der Thread heisst "Orhan
// Schimpansenfliege | 196034", angelegt hat ihn "Lenny Lonee | 196034".
// Derselbe Mensch. Verlaesslich ist dabei nicht der Name, sondern die
// Spielernummer dahinter.

const datei = path.join(config.dataDir, 'namen.json');

// "Ghost Muffiin | 266391", "Dennis Wesh I 142391" - die Nummer am Ende ist die
// Spieler-ID im Spiel und bleibt bei einer Umbenennung gleich.
const NUMMER = /[|I]\s*(\d{4,7})\s*$/;

let speicher = null;
let schreibt = null;

/** Die Spielernummer aus einem Anzeigenamen, falls vorhanden. */
function spielerNummer(name) {
  const treffer = String(name || '').match(NUMMER);
  return treffer ? treffer[1] : '';
}

async function laden() {
  if (speicher) return speicher;

  try {
    const roh = await fs.readFile(datei, 'utf8');
    const daten = JSON.parse(roh);
    speicher = new Map(Object.entries(daten.leute || {}));
  } catch {
    speicher = new Map();
  }

  return speicher;
}

function speichernSpaeter() {
  if (schreibt) return;
  schreibt = setTimeout(async () => {
    schreibt = null;
    try {
      await fs.mkdir(config.dataDir, { recursive: true });
      const leute = Object.fromEntries(speicher || []);
      await writeFileAtomic(datei, JSON.stringify({ leute }, null, 2));
    } catch (error) {
      console.error('Namensgedaechtnis konnte nicht gespeichert werden:', error.message);
    }
  }, 2000);
  schreibt.unref?.();
}

/**
 * Haelt den aktuellen Namen fest. Ist er neu, kommt er oben auf die Liste.
 * @returns {{neu: boolean, vorher: string}}
 */
async function merkeNamen(userId, name) {
  const map = await laden();
  const sauber = String(name || '').trim();
  if (!userId || !sauber) return { neu: false, vorher: '' };

  const eintrag = map.get(String(userId)) || { namen: [], nummer: '' };
  const aktuell = eintrag.namen[0]?.name || '';

  if (aktuell === sauber) return { neu: false, vorher: aktuell };

  eintrag.namen.unshift({ name: sauber, seit: new Date().toISOString() });
  // Mehr als zehn fruehere Namen braucht niemand.
  eintrag.namen = eintrag.namen.slice(0, 10);
  eintrag.nummer = spielerNummer(sauber) || eintrag.nummer;

  map.set(String(userId), eintrag);
  speichernSpaeter();

  return { neu: Boolean(aktuell), vorher: aktuell };
}

async function frühereNamen(userId) {
  const map = await laden();
  const eintrag = map.get(String(userId));
  if (!eintrag) return [];
  return eintrag.namen.slice(1).map((n) => n.name);
}

/**
 * Der letzte bekannte Name zu einer Discord-ID - ohne await, direkt aus dem
 * Zwischenspeicher.
 *
 * Fuer personZuTicket() in logbuch-tickets.js gedacht: das ist ueberall
 * synchron aufgerufen (Ticket-Aufraeumer, Bild-Vorablesen, Dashboard), ein
 * echtes await haette dort viele Stellen umgebaut. Der Zwischenspeicher ist
 * spaetestens Sekunden nach dem Start gefuellt (siehe grundstandAufbauen),
 * das kurze Fenster davor liefert einfach null - nicht schlimmer als vorher.
 *
 * Bewusst KEIN Sonderfall fuer "gerade noch nicht geladen": das Ticket
 * bliebe dann einfach wie gehabt "ohne erkennbaren Besitzer", bis der naechste
 * Aufruf den Zwischenspeicher schon hat.
 */
function letzterNameSync(userId) {
  if (!speicher) return null;
  const eintrag = speicher.get(String(userId));
  return eintrag?.namen[0]?.name || null;
}

/**
 * Wie letzterNameSync(), nur ueber die Spielernummer statt die Discord-ID -
 * fuer den Fall, dass in den Kanalrechten gar keine ID mehr steht (siehe
 * personZuTicket() in logbuch-tickets.js): Discord entfernt das Kanalrecht
 * durchaus, wenn jemand geht - dann bleibt nur noch die Nummer im
 * (aufgeraeumten) Ticketnamen selbst uebrig.
 *
 * Gibt null zurueck, wenn die Nummer mehrdeutig ist (zwei Personen mit
 * derselben Nummer im Gedaechtnis) - dann lieber nichts behaupten.
 */
function letzterNameNachNummerSync(nummer) {
  if (!speicher || !nummer) return null;
  let treffer = null;
  for (const [userId, eintrag] of speicher) {
    if (eintrag.nummer !== nummer) continue;
    if (treffer) return null;
    treffer = { userId, name: eintrag.namen[0]?.name || '' };
  }
  return treffer?.name ? treffer : null;
}

/**
 * Wer hiess mal so? Sucht ueber alle gemerkten Namen und ueber die
 * Spielernummer - die bleibt bei einer Umbenennung gleich.
 */
async function findePerson(suche) {
  const map = await laden();
  const text = normalizeText(suche);
  if (!text) return [];

  const nummer = spielerNummer(suche) || (/^\d{4,7}$/.test(suche.trim()) ? suche.trim() : '');
  const treffer = [];

  for (const [userId, eintrag] of map) {
    if (nummer && eintrag.nummer === nummer) {
      treffer.push({ userId, name: eintrag.namen[0]?.name || '', ueber: 'nummer' });
      continue;
    }

    const passt = eintrag.namen.find((n) => normalizeText(n.name).includes(text));
    if (passt) {
      treffer.push({
        userId,
        name: eintrag.namen[0]?.name || '',
        ueber: passt.name === eintrag.namen[0]?.name ? 'aktuell' : 'frueher',
        frueher: passt.name,
      });
    }
  }

  return treffer;
}

/** Alle aktuellen Namen einmal einlesen, damit es einen Ausgangsstand gibt. */
async function grundstandAufbauen(guild) {
  if (!guild?.members?.cache) return 0;

  let neu = 0;
  for (const member of guild.members.cache.values()) {
    const r = await merkeNamen(member.id, member.displayName || member.user?.username || '');
    if (r.neu) neu += 1;
  }

  return neu;
}

function registerNamensGedaechtnis(client) {
  client.on(Events.GuildMemberUpdate, async (alt, neu) => {
    const alterName = alt?.displayName || alt?.user?.username || '';
    const neuerName = neu?.displayName || neu?.user?.username || '';
    if (!neuerName || alterName === neuerName) return;

    await merkeNamen(neu.id, neuerName).catch(() => null);
  });

  client.on(Events.GuildMemberAdd, async (member) => {
    await merkeNamen(member.id, member.displayName || member.user?.username || '').catch(() => null);
  });

  console.log('Namensgedaechtnis aktiv.');
}

module.exports = {
  findePerson,
  frühereNamen,
  grundstandAufbauen,
  letzterNameNachNummerSync,
  letzterNameSync,
  merkeNamen,
  registerNamensGedaechtnis,
  spielerNummer,
};
