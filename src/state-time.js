const { addDaysToStamp, berlinTimeToDate, getBerlinDateStamp } = require('./time');

function padTime(value) {
  return String(value).padStart(2, '0');
}

function parseStateStartedAt(input, now = new Date()) {
  const text = String(input || '').trim();
  const match = text.match(
    /(?:(\d{1,2})[.\-/](\d{1,2})(?:[.\-/](\d{2,4}))?\s+)?(\d{1,2})[:.](\d{2})/,
  );

  if (!match) return null;

  const [, day, month, year, hour, minute] = match;
  let dateStamp = getBerlinDateStamp(now);

  if (day && month) {
    const currentYear = dateStamp.slice(0, 4);
    const parsedYear = year
      ? String(year.length === 2 ? `20${year}` : year)
      : currentYear;

    dateStamp = [
      parsedYear,
      padTime(month),
      padTime(day),
    ].join('-');
  }

  let startedAt = berlinTimeToDate(dateStamp, `${padTime(hour)}:${padTime(minute)}`);

  if (!day && startedAt.getTime() - now.getTime() > 30 * 60 * 1000) {
    startedAt = berlinTimeToDate(addDaysToStamp(dateStamp, -1), `${padTime(hour)}:${padTime(minute)}`);
  }

  return startedAt;
}

function getStateInkEndAt(input, now = new Date()) {
  const startedAt = parseStateStartedAt(input, now);
  if (!startedAt) return null;
  return new Date(startedAt.getTime() + 30 * 60 * 1000);
}

// Wie lange eine staatliche Meldung offen bleibt, wenn die Zeitangabe nicht
// lesbar war (z.B. "TEST" statt "20:15"). Dann gibt es keine Inkzeit, an der
// man sich orientieren koennte.
const STATE_FALLBACK_HOURS = 12;

/**
 * Wann eine staatliche Meldung automatisch schliesst.
 *
 * Normalfall ist das Ende der Inkzeit. Liess sich die Startzeit nicht lesen,
 * greift eine Frist ab dem Erstellen - sonst bliebe die Meldung fuer immer offen.
 */
function getStateCloseAt({ stateInkEndAt, createdAt = new Date() }) {
  if (stateInkEndAt) {
    const inkEnd = stateInkEndAt instanceof Date ? stateInkEndAt : new Date(stateInkEndAt);
    if (!Number.isNaN(inkEnd.getTime())) return inkEnd.toISOString();
  }

  const created = createdAt instanceof Date ? createdAt : new Date(createdAt);
  const base = Number.isNaN(created.getTime()) ? new Date() : created;
  return new Date(base.getTime() + STATE_FALLBACK_HOURS * 60 * 60 * 1000).toISOString();
}

module.exports = {
  STATE_FALLBACK_HOURS,
  getStateCloseAt,
  getStateInkEndAt,
  parseStateStartedAt,
};

