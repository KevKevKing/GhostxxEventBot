const { config } = require('./config');

const NORMAL_LIMIT = 25;
const FORTY_LIMIT = 10;

// Der Hafen laeuft mehrmals taeglich, immer zur zehnten Minute. Er stand
// bisher nur im Logbuch (also auszahlbar), aber nicht im Terminplan - es gab
// also nie eine Anmeldung dafuer.
const HAFEN_ZEITEN = ['01:10', '04:10', '07:10', '10:10', '13:10', '16:10', '19:10', '22:10'];

function makeHafenSlots() {
  return HAFEN_ZEITEN.map((start) => {
    const [stunde, minute] = start.split(':').map(Number);
    const verschoben = (minuten) => {
      const gesamt = (stunde * 60 + minute + minuten + 24 * 60) % (24 * 60);
      return `${String(Math.floor(gesamt / 60)).padStart(2, '0')}:${String(gesamt % 60).padStart(2, '0')}`;
    };

    return {
      title: 'Hafen',
      slug: 'hafen',
      signupStart: verschoben(-25),
      start,
      signupEnd: verschoben(5),
      maxParticipants: NORMAL_LIMIT,
      pingRoleId: config.eventRoleId,
    };
  });
}

function makeFortySlots() {
  return Array.from({ length: 24 }, (_, hour) => {
    const hh = String(hour).padStart(2, '0');
    return {
      title: '40er',
      slug: '40er',
      signupStart: `${hh}:30`,
      start: `${hh}:40`,
      signupEnd: `${hh}:45`,
      maxParticipants: FORTY_LIMIT,
      pingRoleId: config.fortyEventRoleId,
    };
  });
}

const EVENT_SLOTS = [
  ...makeFortySlots(),
  ...makeHafenSlots(),

  {
    title: '50er',
    slug: '50er',
    signupStart: '20:25',
    start: '20:50',
    signupEnd: '20:55',
    maxParticipants: NORMAL_LIMIT,
    pingRoleId: config.eventRoleId,
  },
  {
    title: 'Angriff auf das Gefaengnis',
    slug: 'angriff-gefaengnis',
    signupStart: '19:55',
    start: '20:20',
    signupEnd: '20:25',
    maxParticipants: NORMAL_LIMIT,
    pingRoleId: config.eventRoleId,
    days: [5],
  },
  {
    title: 'Bank-Event',
    slug: 'bank-event',
    signupStart: '21:05',
    start: '21:30',
    signupEnd: '21:35',
    maxParticipants: NORMAL_LIMIT,
    pingRoleId: config.eventRoleId,
    days: [1, 3, 6],
  },
  {
    title: 'BizWar',
    slug: 'bizwar',
    signupStart: '00:40',
    start: '01:05',
    signupEnd: '01:10',
    maxParticipants: NORMAL_LIMIT,
    pingRoleId: config.eventRoleId,
  },
  {
    title: 'BizWar',
    slug: 'bizwar',
    signupStart: '18:40',
    start: '19:05',
    signupEnd: '19:10',
    maxParticipants: NORMAL_LIMIT,
    pingRoleId: config.eventRoleId,
  },
  {
    title: 'Flugzeugtraeger',
    slug: 'flugzeugtraeger',
    signupStart: '21:05',
    start: '21:30',
    signupEnd: '21:35',
    maxParticipants: NORMAL_LIMIT,
    pingRoleId: config.eventRoleId,
    days: [0, 2, 4, 5],
  },
  {
    title: 'Giesserei',
    slug: 'giesserei',
    signupStart: '13:55',
    start: '14:20',
    signupEnd: '14:25',
    maxParticipants: NORMAL_LIMIT,
    pingRoleId: config.eventRoleId,
  },
  {
    title: 'Hotel',
    slug: 'hotel',
    signupStart: '01:55',
    start: '02:20',
    signupEnd: '02:25',
    maxParticipants: NORMAL_LIMIT,
    pingRoleId: config.eventRoleId,
  },
  // Die Anmeldung laeuft bis xx:45, nicht nur bis zum Start um xx:30.
  //
  // Im Spiel kann man sich bis xx:45 einschreiben (das ist die inkEnd-Zeit,
  // die auch in der Anmeldung steht). Vorher machte Ghostxx um xx:30 zu -
  // wer zwischen Start und Einschreibeschluss noch dazukam, konnte sich nicht
  // mehr eintragen, obwohl er ingame regulaer mitspielen durfte.
  {
    title: 'RP-Fabrik',
    slug: 'rp-fabrik',
    signupStart: '10:15',
    start: '10:30',
    signupEnd: '10:45',
    inkEnd: '10:45',
    maxParticipants: NORMAL_LIMIT,
    pingRoleId: config.eventRoleId,
  },
  {
    title: 'RP-Fabrik',
    slug: 'rp-fabrik',
    signupStart: '16:15',
    start: '16:30',
    signupEnd: '16:45',
    inkEnd: '16:45',
    maxParticipants: NORMAL_LIMIT,
    pingRoleId: config.eventRoleId,
  },
  {
    title: 'RP-Fabrik',
    slug: 'rp-fabrik',
    signupStart: '22:15',
    start: '22:30',
    signupEnd: '22:45',
    inkEnd: '22:45',
    maxParticipants: NORMAL_LIMIT,
    pingRoleId: config.eventRoleId,
  },
  {
    title: 'Waffenfabrik',
    slug: 'waffenfabrik',
    signupStart: '02:55',
    start: '03:20',
    signupEnd: '03:25',
    maxParticipants: NORMAL_LIMIT,
    pingRoleId: config.eventRoleId,
  },
  {
    title: 'Waffenfabrik',
    slug: 'waffenfabrik',
    signupStart: '06:55',
    start: '07:20',
    signupEnd: '07:25',
    maxParticipants: NORMAL_LIMIT,
    pingRoleId: config.eventRoleId,
  },
  {
    title: 'Waffenfabrik',
    slug: 'waffenfabrik',
    signupStart: '09:55',
    start: '10:20',
    signupEnd: '10:25',
    maxParticipants: NORMAL_LIMIT,
    pingRoleId: config.eventRoleId,
  },
  {
    title: 'Waffenfabrik',
    slug: 'waffenfabrik',
    signupStart: '21:55',
    start: '22:20',
    signupEnd: '22:25',
    maxParticipants: NORMAL_LIMIT,
    pingRoleId: config.eventRoleId,
  },
  {
    title: 'Waffenteile Event',
    slug: 'waffenteile-event',
    signupStart: '20:05',
    start: '20:30',
    signupEnd: '20:35',
    maxParticipants: NORMAL_LIMIT,
    pingRoleId: config.eventRoleId,
  },
  {
    title: 'Weinberge',
    slug: 'weinberge',
    signupStart: '19:50',
    start: '20:15',
    signupEnd: '20:20',
    maxParticipants: NORMAL_LIMIT,
    pingRoleId: config.eventRoleId,
  },
];

module.exports = {
  EVENT_SLOTS,
};
