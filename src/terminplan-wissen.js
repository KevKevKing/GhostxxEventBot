const { EVENT_SLOTS } = require('./schedule-data');
const { addDaysToStamp, berlinTimeToDate, getBerlinDateStamp, getWeekdayForDateStamp } = require('./time');
const { normalizeText } = require('./text-match');

// "Wann ist der naechste 40er?"
//
// Der komplette Terminplan liegt im Code - 49 Termine am Tag, 13 Eventarten -
// und trotzdem konnte er die Frage nicht beantworten. Sie ging ans Sprachmodell,
// das keinen Kalender hat und deshalb erfunden hat.
//
// Ein Sprachmodell weiss auch nicht, wie spaet es ist. Das steht hier mit drin,
// weil es dieselbe Sorte Frage ist: beantwortbar, aber nicht durch Raten.

const WOCHENTAGE = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];

/** Findet die Eventart, die gemeint ist. */
function findeEventArt(text) {
  const t = normalizeText(text);
  const titel = [...new Set(EVENT_SLOTS.map((s) => s.title))];

  // Laengster Treffer gewinnt, damit "waffenteile" nicht als "waffen" durchgeht.
  const treffer = titel
    .filter((name) => t.includes(normalizeText(name).split(' ')[0]))
    .sort((a, b) => b.length - a.length);

  if (treffer.length) return treffer[0];

  // Kuerzel, die im Plan nicht so heissen.
  for (const [muster, name] of [
    [/\bwf\b|waffenfabrik/, 'Waffenfabrik'],
    [/\brp\b/, 'RP-Fabrik'],
    [/\bbiz\s?war\b/, 'BizWar'],
    [/\bbank\b/, 'Bank-Event'],
    [/\bft\b|flugzeugtraeger|flugzeugträger/, 'Flugzeugtraeger'],
    [/\bgefaengnis\b|\bgefängnis\b|knast/, 'Angriff auf das Gefaengnis'],
    [/\bgiesserei\b|\bgießerei\b/, 'Giesserei'],
    [/\bhafen\b/, 'Hafen'],
  ]) {
    if (muster.test(t)) return name;
  }

  return '';
}

/**
 * Die naechsten Termine einer Eventart - oder ueberhaupt.
 * Schaut bis zu sieben Tage voraus, damit auch Wochenevents gefunden werden.
 */
function naechsteTermine(eventArt, { jetzt = new Date(), anzahl = 3 } = {}) {
  const gefunden = [];

  for (let tag = 0; tag < 8 && gefunden.length < anzahl * 3; tag += 1) {
    const stempel = addDaysToStamp(getBerlinDateStamp(jetzt), tag);
    const wochentag = getWeekdayForDateStamp(stempel);

    for (const slot of EVENT_SLOTS) {
      if (slot.days && !slot.days.includes(wochentag)) continue;
      if (eventArt && slot.title !== eventArt) continue;

      const start = berlinTimeToDate(stempel, slot.start);
      if (start <= jetzt) continue;

      gefunden.push({
        titel: slot.title,
        start,
        anmeldungAb: berlinTimeToDate(stempel, slot.signupStart),
        wochentag: WOCHENTAGE[start.getDay()],
        heute: tag === 0,
      });
    }
  }

  return gefunden.sort((a, b) => a.start - b.start).slice(0, anzahl);
}

function uhrzeit(datum) {
  return datum.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' });
}

function inWieLange(von, bis) {
  const min = Math.round((bis - von) / 60000);
  if (min < 60) return `in ${min} Minuten`;
  const std = Math.floor(min / 60);
  const rest = min % 60;
  if (std < 24) return rest ? `in ${std} Std ${rest} Min` : `in ${std} Stunden`;
  return `in ${Math.round(std / 24)} Tagen`;
}

/** Erkennt Terminfragen. Gibt null zurueck, wenn es keine ist. */
function parseTerminFrage(text) {
  const roh = String(text || '').trim();
  const t = normalizeText(roh);

  if (/\bwie\s+(spaet|spät)\b|\buhrzeit\b|\bwelcher tag\b|\bwelches datum\b|\bwelchen tag\b/.test(t)) {
    return { art: 'uhrzeit' };
  }

  const fragtWann = /\bwann\b/.test(t);
  const fragtNaechste = /\bnaechst|\bnächst|\bals naechstes|\bals nächstes/.test(t);
  if (!fragtWann && !fragtNaechste) return null;

  // "wann war X dabei" ist eine Frage an das Archiv, nicht an den Plan.
  if (/\b(war|warst|zuletzt|letzte[sn]?\s+mal)\b/.test(t)) return null;

  return { art: 'termin', eventArt: findeEventArt(roh) };
}

function antworteTermin(frage, jetzt = new Date()) {
  if (frage.art === 'uhrzeit') {
    const datum = jetzt.toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Berlin' });
    return `${datum}, ${uhrzeit(jetzt)} Uhr.`;
  }

  const termine = naechsteTermine(frage.eventArt, { jetzt, anzahl: frage.eventArt ? 3 : 4 });

  if (!termine.length) {
    return frage.eventArt
      ? `${frage.eventArt} steht in den nächsten Tagen nicht im Plan.`
      : 'In den nächsten Tagen steht nichts im Plan.';
  }

  const naechster = termine[0];
  const kopf = frage.eventArt
    ? `Nächster **${naechster.titel}**: ${naechster.heute ? 'heute' : naechster.wochentag} um ${uhrzeit(naechster.start)} (${inWieLange(jetzt, naechster.start)}), Anmeldung ab ${uhrzeit(naechster.anmeldungAb)}.`
    : `Als nächstes: **${naechster.titel}** ${naechster.heute ? 'heute' : naechster.wochentag} um ${uhrzeit(naechster.start)} (${inWieLange(jetzt, naechster.start)}).`;

  const weitere = termine.slice(1)
    .map((t) => `${t.titel} ${t.heute ? 'heute' : t.wochentag} ${uhrzeit(t.start)}`)
    .join(' · ');

  return weitere ? `${kopf}\nDanach: ${weitere}` : kopf;
}

module.exports = {
  antworteTermin,
  findeEventArt,
  naechsteTermine,
  parseTerminFrage,
};
