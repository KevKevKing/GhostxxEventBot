const TIME_ZONE = 'Europe/Berlin';

const berlinFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

function getBerlinParts(date = new Date()) {
  const parts = Object.fromEntries(
    berlinFormatter.formatToParts(date).map((part) => [part.type, part.value]),
  );

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

function getBerlinDateStamp(date = new Date()) {
  const parts = getBerlinParts(date);
  return [
    parts.year,
    String(parts.month).padStart(2, '0'),
    String(parts.day).padStart(2, '0'),
  ].join('-');
}

function parseDateStamp(dateStamp) {
  const [year, month, day] = dateStamp.split('-').map(Number);
  return { year, month, day };
}

function getWeekdayForDateStamp(dateStamp) {
  const { year, month, day } = parseDateStamp(dateStamp);
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0)).getUTCDay();
}

function parseTime(time) {
  const [hour, minute] = time.split(':').map(Number);
  return { hour, minute };
}

function berlinTimeToDate(dateStamp, time) {
  const target = { ...parseDateStamp(dateStamp), ...parseTime(time), second: 0 };
  let utc = new Date(Date.UTC(target.year, target.month - 1, target.day, target.hour, target.minute));

  for (let i = 0; i < 4; i += 1) {
    const current = getBerlinParts(utc);
    const currentAsUtc = Date.UTC(
      current.year,
      current.month - 1,
      current.day,
      current.hour,
      current.minute,
      current.second,
    );
    const targetAsUtc = Date.UTC(
      target.year,
      target.month - 1,
      target.day,
      target.hour,
      target.minute,
      target.second,
    );
    const diff = currentAsUtc - targetAsUtc;
    if (diff === 0) break;
    utc = new Date(utc.getTime() - diff);
  }

  return utc;
}

function toUnixSeconds(dateOrIso) {
  return Math.floor(new Date(dateOrIso).getTime() / 1000);
}

function addDaysToStamp(dateStamp, days) {
  const { year, month, day } = parseDateStamp(dateStamp);
  const utc = new Date(Date.UTC(year, month - 1, day + days, 12, 0, 0));
  return getBerlinDateStamp(utc);
}

module.exports = {
  TIME_ZONE,
  addDaysToStamp,
  berlinTimeToDate,
  getBerlinDateStamp,
  getWeekdayForDateStamp,
  toUnixSeconds,
};
