const { pickBestMatches } = require('./text-match');

const MENTION_PATTERN = /^<@!?(\d{17,25})>$/;
const RAW_ID_PATTERN = /^\d{17,25}$/;

function extractUserId(input) {
  const text = String(input || '').trim();
  const mention = text.match(MENTION_PATTERN);
  if (mention) return mention[1];
  if (RAW_ID_PATTERN.test(text)) return text;
  return '';
}

function stripMentionDecoration(input) {
  return String(input || '')
    .trim()
    .replace(/^@/, '')
    .replace(/#\d{4}$/, '')
    .trim();
}

function describeMember(member) {
  const nickname = member.nickname || member.displayName || '';
  const username = member.user?.username || '';
  if (nickname && nickname !== username) return `${nickname} (${username})`;
  return username || nickname || member.id;
}

/**
 * Loest "@Name", eine rohe ID oder einen freien Namen zu genau einem Guild-Member auf.
 *
 * Braucht das GuildMembers-Intent, sonst ist der Member-Cache leer und die
 * Namenssuche findet nichts. Bei mehreren gleich guten Treffern wird bewusst
 * nicht geraten, sondern 'ambiguous' zurueckgegeben.
 */
async function resolveMember(guild, input) {
  const raw = String(input || '').trim();
  if (!guild || !raw) return { ok: false, reason: 'empty', candidates: [] };

  const directId = extractUserId(raw);
  if (directId) {
    const member = await guild.members.fetch(directId).catch(() => null);
    if (member) return { ok: true, member };
    return { ok: false, reason: 'not_found', candidates: [], query: raw };
  }

  const query = stripMentionDecoration(raw);
  if (!query) return { ok: false, reason: 'empty', candidates: [] };

  // Beide Quellen zusammen, nicht entweder-oder:
  //
  // Discords Suche findet nur Namensanfaenge. Bei Namen wie "Ghost Muffiin |
  // 266391" liefert sie zu "Muffiin" nichts, obwohl die Person existiert - und
  // hier heissen fast alle "Vorname Nachname | Nummer". Der Zwischenspeicher
  // deckt Teiltreffer ab, dafuer ist er nur so vollstaendig wie das, was beim
  // Start geladen wurde. Zusammen fangen sie sich gegenseitig auf.
  const searched = await guild.members.search({ query, limit: 25 }).catch(() => null);

  const pool = new Map();
  for (const member of guild.members.cache.values()) pool.set(member.id, member);
  if (searched) for (const member of searched.values()) pool.set(member.id, member);

  const kandidaten = [...pool.values()];
  const byNickname = pickBestMatches(kandidaten, query, (member) => member.nickname || '');
  const byDisplay = pickBestMatches(kandidaten, query, (member) => member.displayName || '');
  const byUsername = pickBestMatches(kandidaten, query, (member) => member.user?.username || '');

  const merged = new Map();
  for (const member of [...byNickname, ...byDisplay, ...byUsername]) {
    merged.set(member.id, member);
  }

  const matches = [...merged.values()].filter((member) => !member.user?.bot);

  if (!matches.length) return { ok: false, reason: 'not_found', candidates: [], query: raw };
  if (matches.length === 1) return { ok: true, member: matches[0] };

  return { ok: false, reason: 'ambiguous', candidates: matches.slice(0, 5), query: raw };
}

module.exports = {
  describeMember,
  extractUserId,
  resolveMember,
};
