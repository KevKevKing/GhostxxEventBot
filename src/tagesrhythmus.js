const { EVENT_SLOTS } = require('./schedule-data');
const { alleEvents, eventZeit, teilnehmer } = require('./event-history');
const { getBerlinDateStamp, getWeekdayForDateStamp } = require('./time');
const { offeneAbholen, satz } = require('./meilenstein');

// Morgens ein Ausblick, abends ein Rueckblick.
//
// Ghostxx sagte bisher genau eine Sache von selbst: "hier fehlen noch Leute",
// dreimal am Tag. Sonst war er still, bis ihn jemand ansprach.
//
// Zwei feste Zeitpunkte statt staendigem Dazwischenreden. Das ist der ganze
// Trick: planbar, nicht zufaellig. Wer es nicht lesen will, scrollt vorbei.

const MORGENS = '10:30';
const ABENDS = '23:15';

const WOCHENTAGE = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];

// Im Zeitplan stehen die Namen ohne Umlaute, weil der Code sie umschrieben
// haelt. In einer Nachricht an die Familie gehoeren sie hin.
const SCHOEN = {
  Flugzeugtraeger: 'Flugzeugträger',
  Giesserei: 'Gießerei',
  'Angriff auf das Gefaengnis': 'Angriff auf das Gefängnis',
};

function schoenerName(titel) {
  return SCHOEN[titel] || titel;
}

/** Nur die Events, die es heute ueberhaupt gibt - nicht die taeglichen. */
function besonderesHeute(datum = getBerlinDateStamp()) {
  const tag = getWeekdayForDateStamp(datum);

  const gefunden = EVENT_SLOTS
    .filter((slot) => Array.isArray(slot.days) && slot.days.includes(tag))
    .map((slot) => ({ titel: slot.title, start: slot.start }));

  // Dieselbe Eventart kann mehrere Termine haben - einmal nennen reicht.
  const zusammen = new Map();
  for (const e of gefunden) {
    if (!zusammen.has(e.titel)) zusammen.set(e.titel, []);
    zusammen.get(e.titel).push(e.start);
  }

  return [...zusammen.entries()]
    .map(([titel, zeiten]) => ({ titel, zeiten: zeiten.sort() }))
    .sort((a, b) => a.zeiten[0].localeCompare(b.zeiten[0]));
}

/** Was lief an einem Tag - Anzahl, Teilnahmen, die aktivsten Leute. */
async function tagesbilanz(datum, now = Date.now()) {
  const events = (await alleEvents(now)).filter((event) => {
    if (event.status === 'cancelled') return false;
    const zeit = eventZeit(event);
    return zeit && getBerlinDateStamp(new Date(zeit)) === datum;
  });

  const proPerson = new Map();
  let teilnahmen = 0;
  let volle = 0;

  for (const event of events) {
    const leute = teilnehmer(event);
    teilnahmen += leute.length;
    if (event.maxParticipants && leute.length >= event.maxParticipants) volle += 1;
    for (const id of leute) proPerson.set(id, (proPerson.get(id) || 0) + 1);
  }

  const beste = [...proPerson.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([id, anzahl]) => ({ id, anzahl }));

  return { events: events.length, teilnahmen, volle, leute: proPerson.size, beste };
}

function morgenText(datum = getBerlinDateStamp()) {
  const tag = WOCHENTAGE[getWeekdayForDateStamp(datum)];
  const besonders = besonderesHeute(datum);

  const zeilen = [`**${tag}.**`];

  if (besonders.length) {
    zeilen.push('Heute gibt es zusätzlich:');
    for (const e of besonders) {
      zeilen.push(`• ${schoenerName(e.titel)} — ${e.zeiten.join(', ')} Uhr`);
    }
  } else {
    zeilen.push('Heute läuft nur das normale Programm.');
  }

  return zeilen.join('\n');
}

function abendText(bilanz, nachzureichen = []) {
  if (!bilanz.events) return '';

  const zeilen = [];
  zeilen.push(`**Der Tag in Zahlen** — ${bilanz.events} Anmeldungen, ${bilanz.teilnahmen} Teilnahmen von ${bilanz.leute} Leuten.`);

  if (bilanz.volle) {
    zeilen.push(`${bilanz.volle} davon waren voll besetzt.`);
  }

  if (bilanz.beste.length && bilanz.beste[0].anzahl >= 3) {
    const liste = bilanz.beste
      .filter((b) => b.anzahl >= 3)
      .map((b) => `<@${b.id}> (${b.anzahl})`)
      .join(', ');
    zeilen.push(`Am fleißigsten: ${liste}`);
  }

  if (nachzureichen.length) {
    zeilen.push('');
    zeilen.push('**Außerdem heute geschafft:**');
    for (const m of nachzureichen.slice(0, 10)) zeilen.push(`• ${satz(m)}`);
    if (nachzureichen.length > 10) zeilen.push(`… und ${nachzureichen.length - 10} weitere.`);
  }

  return zeilen.join('\n');
}

/** Der Abendrueckblick inklusive der Meilensteine, die tagsueber nicht passten. */
async function abendRueckblick(datum = getBerlinDateStamp(), now = Date.now()) {
  const bilanz = await tagesbilanz(datum, now);
  const offen = await offeneAbholen();
  return abendText(bilanz, offen);
}

module.exports = {
  ABENDS,
  MORGENS,
  abendRueckblick,
  abendText,
  besonderesHeute,
  morgenText,
  schoenerName,
  tagesbilanz,
};
