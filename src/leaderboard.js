const { alleEvents, teilnehmer } = require('./event-history');

// Rangliste der fleissigsten Anmelder.
//
// Gezaehlt wird ueber alle Anmeldungen, auch die archivierten - sonst waere die
// Liste nach drei Tagen leer. Das Archiv liegt in mehreren Dateien und aendert
// sich selten, deshalb wird das Ergebnis kurz zwischengespeichert statt bei
// jedem Knopfdruck neu ueber gut zweitausend Eintraege zu laufen.

const CACHE_MS = 5 * 60 * 1000;
const PAGE_SIZE = 10;

let cache = { at: 0, ranks: null, total: 0, events: 0 };

/** Zaehlt Anmeldungen je Person ueber aktive und archivierte Events. */
async function buildRanks(now = Date.now()) {
  if (cache.ranks && now - cache.at < CACHE_MS) return cache;

  // Aktive und archivierte Anmeldungen kommen aus event-history - dieselbe
  // Quelle, aus der auch das Nachschlagen zaehlt. Lagen die zwei Zaehlungen
  // getrennt, waeren sie irgendwann auseinandergelaufen.
  const alle = await alleEvents(now);

  const zaehler = new Map();
  for (const event of alle) {
    for (const userId of teilnehmer(event)) {
      zaehler.set(userId, (zaehler.get(userId) || 0) + 1);
    }
  }

  const ranks = [...zaehler.entries()]
    .map(([userId, count]) => ({ userId, count }))
    .sort((a, b) => b.count - a.count || a.userId.localeCompare(b.userId));

  cache = {
    at: now,
    ranks,
    total: ranks.reduce((summe, eintrag) => summe + eintrag.count, 0),
    events: alle.length,
  };

  return cache;
}

function getPageCount(ranks) {
  return Math.max(1, Math.ceil(ranks.length / PAGE_SIZE));
}

function clampPage(page, ranks) {
  const letzte = getPageCount(ranks);
  if (!Number.isFinite(page) || page < 1) return 1;
  return Math.min(Math.trunc(page), letzte);
}

const MEDALS = ['🥇', '🥈', '🥉'];

function formatRow(eintrag, platz, guild) {
  const marke = MEDALS[platz - 1] || `\`${String(platz).padStart(2, ' ')}.\``;

  // Wer den Server verlassen hat, steht nicht mehr im Zwischenspeicher.
  const member = guild?.members?.cache?.get(eintrag.userId);
  const name = member
    ? `<@${eintrag.userId}>`
    : `<@${eintrag.userId}> *(nicht mehr im Server)*`;

  return `${marke} ${name} — **${eintrag.count}**`;
}

/** Baut eine Seite der Rangliste. Seiten zaehlen ab 1. */
async function buildLeaderboardPage(page, guild) {
  const { ranks, total, events } = await buildRanks();
  const seite = clampPage(page, ranks);
  const seiten = getPageCount(ranks);
  const start = (seite - 1) * PAGE_SIZE;
  const ausschnitt = ranks.slice(start, start + PAGE_SIZE);

  const zeilen = ausschnitt.length
    ? ausschnitt.map((eintrag, index) => formatRow(eintrag, start + index + 1, guild))
    : ['Noch keine Anmeldungen erfasst.'];

  return {
    page: seite,
    pageCount: seiten,
    isFirst: seite <= 1,
    isLast: seite >= seiten,
    text: zeilen.join('\n'),
    footer: `Platz ${start + 1}–${start + ausschnitt.length} von ${ranks.length} · ${total} Anmeldungen aus ${events} Events`,
  };
}

function invalidateCache() {
  cache = { at: 0, ranks: null, total: 0, events: 0 };
}

module.exports = {
  PAGE_SIZE,
  buildLeaderboardPage,
  buildRanks,
  clampPage,
  getPageCount,
  invalidateCache,
};
