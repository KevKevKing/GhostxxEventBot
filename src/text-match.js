const UMLAUT_MAP = {
  ä: 'ae',
  ö: 'oe',
  ü: 'ue',
  ß: 'ss',
};

function normalizeText(input) {
  return String(input || '')
    .toLowerCase()
    .replace(/[äöüß]/g, (char) => UMLAUT_MAP[char])
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function normalizeCompact(input) {
  return normalizeText(input).replaceAll(' ', '');
}

// 0 = kein Treffer, hoeher = besser. Bewusst simpel gehalten: exakte Treffer
// sollen immer vor Teiltreffern liegen, damit "40er" nie "40er Ersatz" gewinnt.
function scoreMatch(candidate, query) {
  const target = normalizeCompact(candidate);
  const needle = normalizeCompact(query);

  if (!target || !needle) return 0;
  if (target === needle) return 100;
  if (target.startsWith(needle)) return 70;
  if (target.includes(needle)) return 50;
  if (needle.includes(target) && target.length >= 3) return 30;

  return 0;
}

// Nimmt die Treffer mit der hoechsten Punktzahl. Bleibt mehr als einer uebrig,
// ist die Eingabe mehrdeutig und der Aufrufer muss nachfragen statt zu raten.
function pickBestMatches(items, query, getText) {
  const scored = items
    .map((item) => ({ item, score: scoreMatch(getText(item), query) }))
    .filter((entry) => entry.score > 0);

  if (!scored.length) return [];

  const topScore = Math.max(...scored.map((entry) => entry.score));
  return scored.filter((entry) => entry.score === topScore).map((entry) => entry.item);
}

module.exports = {
  normalizeCompact,
  normalizeText,
  pickBestMatches,
  scoreMatch,
};
