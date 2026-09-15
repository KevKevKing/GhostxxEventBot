const { config } = require('./config');
const { spielerNummer } = require('./namens-gedaechtnis');
const { normalizeText } = require('./text-match');

// Wie viele Nachweise hat wer im Logbuch?
//
// Im Leitungschat gefragt: "wie viele logs hat @X gemacht?" Antwort war
// "Log-Zahlen zu privaten Nutzern sollten niemandem ausser Admins bekannt
// sein" - eine Regel, die es nicht gibt und die er sich ausgedacht hat, weil
// er die Zahl nicht wusste. Zaehlbar ist sie: jeder hat seinen Thread.
//
// Die Zuordnung Thread -> Mensch laeuft ueber die SPIELERNUMMER im Namen, nicht
// ueber den Namen selbst. Grund: Im Logbuch steht ein Thread "Orhan
// Schimpansenfliege | 196034", angelegt von "Lenny Lonee | 196034" - derselbe
// Mensch nach einer Umbenennung. Die Nummer bleibt, der Name nicht.

// Threads, die keinem Menschen gehoeren.
const KEINE_PERSON = [/^vorlage/i, /belohnung/i, /^info/i, /^regel/i];

// 60 Threads mit je bis zu 100 Nachrichten abzufragen dauert. Die Zahl aendert
// sich langsam, deshalb wird sie zwischengespeichert.
const CACHE_MS = 10 * 60 * 1000;
let cache = { at: 0, threads: null };

function istPersonenThread(name) {
  return !KEINE_PERSON.some((muster) => muster.test(name || ''));
}

function bilderIn(message) {
  return [...(message.attachments?.values() || [])]
    .filter((a) => (a.contentType || '').startsWith('image/')).length;
}

/**
 * Liest alle Logbuch-Threads und zaehlt die Nachweise.
 * Wirft nie - ohne Zahlen antwortet er eben "weiss ich nicht".
 */
async function ladeThreads(client, jetzt = Date.now(), nurAusCache = false) {
  if (cache.threads && jetzt - cache.at < CACHE_MS) return cache.threads;

  // Beim ersten Mal dauert das Einlesen ueber 30 Sekunden - 60 Threads mit je
  // bis zu 100 Nachrichten. Fuer eine beilaeufige Angabe ("wer ist X" nennt die
  // Nachweise mit) ist das zu lang; dort wird die Zahl lieber weggelassen, als
  // dass die ganze Antwort darauf wartet.
  if (nurAusCache) return null;

  try {
    const forum = await client.channels.fetch(config.logbookChannelId).catch(() => null);
    if (!forum?.threads) return cache.threads || [];

    const aktiv = await forum.threads.fetchActive().catch(() => ({ threads: new Map() }));
    const alt = await forum.threads.fetchArchived({ limit: 100 }).catch(() => ({ threads: new Map() }));

    const ergebnis = [];
    for (const thread of [...aktiv.threads.values(), ...alt.threads.values()]) {
      if (!istPersonenThread(thread.name)) continue;

      const batch = await thread.messages.fetch({ limit: 100 }).catch(() => null);
      if (!batch) continue;

      const nachrichten = [...batch.values()];
      const nachweise = nachrichten.reduce((summe, m) => summe + (bilderIn(m) ? 1 : 0), 0);
      const letzte = nachrichten
        .filter((m) => bilderIn(m))
        .sort((a, b) => b.createdTimestamp - a.createdTimestamp)[0];

      ergebnis.push({
        name: thread.name,
        nummer: spielerNummer(thread.name),
        ownerId: thread.ownerId || '',
        url: thread.url,
        nachweise,
        letzterAm: letzte ? new Date(letzte.createdTimestamp) : null,
      });
    }

    cache = { at: jetzt, threads: ergebnis };
    return ergebnis;
  } catch (error) {
    console.error('Logbuch-Zahlen konnten nicht gelesen werden:', error.message);
    return cache.threads || [];
  }
}

/**
 * Der Logbuch-Thread einer Person.
 *
 * Reihenfolge der Zuordnung: Spielernummer, dann Ersteller, dann Namensteil.
 * Die Nummer zuerst, weil sie eine Umbenennung ueberlebt.
 */
async function threadVonPerson(client, member, { nurAusCache = false } = {}) {
  if (!member) return null;

  const threads = await ladeThreads(client, Date.now(), nurAusCache);
  if (!threads) return null;

  const anzeige = member.displayName || member.user?.username || '';
  const nummer = spielerNummer(anzeige);

  if (nummer) {
    const perNummer = threads.find((t) => t.nummer && t.nummer === nummer);
    if (perNummer) return perNummer;
  }

  const perOwner = threads.find((t) => t.ownerId === member.id);
  if (perOwner) return perOwner;

  // Letzter Versuch ueber den Namen ohne Nummer - "Ghost Muffin" gegen
  // "! Ghost Muffiin | 266391".
  const kern = normalizeText(anzeige.replace(NUMMER_WEG, '')).replace(/[^a-z ]/g, '').trim();
  if (kern.length < 4) return null;

  return threads.find((t) => normalizeText(t.name).includes(kern.slice(0, 8))) || null;
}

const NUMMER_WEG = /[|I]\s*\d{4,7}\s*$/;

/** Rangliste nach Nachweisen. */
async function bestenliste(client, limit = 5) {
  const threads = await ladeThreads(client);
  return [...threads].sort((a, b) => b.nachweise - a.nachweise).slice(0, limit);
}

async function gesamtzahlen(client) {
  const threads = await ladeThreads(client);
  if (!threads.length) return null;

  const summe = threads.reduce((s, t) => s + t.nachweise, 0);
  return {
    threads: threads.length,
    nachweise: summe,
    schnitt: Math.round(summe / threads.length),
  };
}

function invalidateCache() {
  cache = { at: 0, threads: null };
}

module.exports = {
  bestenliste,
  gesamtzahlen,
  invalidateCache,
  ladeThreads,
  threadVonPerson,
};
