const { check, equal, finish, section, useTempData } = require('./lib');

useTempData();
const { config } = require('../src/config');
const { behandleSkMeldung } = require('../src/sk-meldung-anlegen');
const { vergissOffen } = require('../src/sk-meldung');
const { listEvents } = require('../src/storage');

// Der Weg von der Nachricht zur Anmeldung. Der Parser wird in
// sk-meldung.test.js geprueft - hier geht es darum, was danach passiert.

const OWNER = config.ownerId;
const FREMD = '999000000000000009';

function nachricht(text, { userId = OWNER, channelId = config.stateChannelId } = {}) {
  const gesendet = [];
  return {
    gesendet,
    author: { id: userId },
    member: { id: userId, roles: { cache: new Map() } },
    channelId,
    channel: {
      send: async (payload) => {
        gesendet.push(payload);
        return { id: `m${gesendet.length}` };
      },
    },
  };
}

const antworten = [];
const werkzeuge = {
  reply: async (_m, text) => { antworten.push(text); },
  merken: async () => {},
};

function letzteAntwort() {
  return antworten[antworten.length - 1] || '';
}

(async () => {
  section('Wo gemeldet werden darf');
  const woanders = nachricht('wir haben angegriffen um 21:07 gegen Nemesis', {
    channelId: config.chatChannelId,
  });
  equal('nicht im Chatkanal', await behandleSkMeldung(woanders, 'wir haben angegriffen um 21:07 gegen Nemesis', werkzeuge), false);
  equal('  und nichts gepostet', woanders.gesendet.length, 0);

  const kein = nachricht('hey wie gehts');
  equal('Smalltalk faellt durch', await behandleSkMeldung(kein, 'hey wie gehts', werkzeuge), false);

  section('Wer melden darf');
  vergissOffen(FREMD);
  const fremd = nachricht('wir haben angegriffen um 21:07 gegen Nemesis', { userId: FREMD });
  equal('Fremder wird behandelt', await behandleSkMeldung(fremd, 'wir haben angegriffen um 21:07 gegen Nemesis', werkzeuge), true);
  equal('  aber nichts angelegt', fremd.gesendet.length, 0);
  check('  und bekommt Bescheid', /Turf-Leader/.test(letzteAntwort()), letzteAntwort());

  section('Angriff anlegen');
  vergissOffen(OWNER);
  const angriff = nachricht('x');
  equal('behandelt', await behandleSkMeldung(angriff, 'ghost wir haben angegriffen um 21:07 gegen Nemesis', werkzeuge), true);
  equal('eine Nachricht gepostet', angriff.gesendet.length, 1);

  const embed = angriff.gesendet[0].embeds[0];
  equal('Titel', embed.data.title, 'Angriff gemeldet');
  equal('Gegnerfeld', embed.data.fields[0].name, 'Wer wurde angegriffen');
  // Die Oberflaeche setzt die Werte fett - so steht es auch in den echten
  // Meldungen im Kanal.
  equal('  Wert', embed.data.fields[0].value, '**Nemesis**');
  equal('Zeitfeld', embed.data.fields[1].value, '**21:07**');
  check('Knoepfe dabei', angriff.gesendet[0].components.length > 0);
  check('Rolle wird gepingt', angriff.gesendet[0].content === `<@&${config.giveawayPingRoleId}>`);

  const gespeichert = (await listEvents()).filter((e) => e.kind === 'state');
  equal('Anmeldung gespeichert', gespeichert.length, 1);
  equal('  offen', gespeichert[0].status, 'open');
  equal('  Angriff', gespeichert[0].stateType, 'attack');
  equal('  zehn Plaetze', gespeichert[0].maxParticipants, 10);
  equal('  fuenf Auswechselspieler', gespeichert[0].maxSubstitutes, 5);
  check('  Nachricht verknuepft', gespeichert[0].messageId === 'm1');
  check('  Inkzeit gesetzt', Boolean(gespeichert[0].stateInkEndAt));

  section('Verteidigung anlegen');
  vergissOffen(OWNER);
  const verteidigung = nachricht('x');
  await behandleSkMeldung(verteidigung, 'Elegnu hat uns angegriffen um 16:35', werkzeuge);
  const vEmbed = verteidigung.gesendet[0].embeds[0];
  equal('Titel', vEmbed.data.title, 'Verteidigung gemeldet');
  equal('Feldname dreht sich um', vEmbed.data.fields[0].name, 'Wer hat angegriffen');
  equal('  Wert', vEmbed.data.fields[0].value, '**Elegnu**');

  section('Nachfragen statt raten');
  // Fehlt etwas, wird nichts angelegt - eine Anmeldung ohne Gegner haette
  // niemandem geholfen.
  vergissOffen(OWNER);
  const halb = nachricht('x');
  equal('behandelt', await behandleSkMeldung(halb, 'wir wurden angegriffen um 16:35', werkzeuge), true);
  equal('  nichts angelegt', halb.gesendet.length, 0);
  check('  fragt nach dem Gegner', /Wer hat angegriffen\?/.test(letzteAntwort()), letzteAntwort());

  // Die Nachreichung vervollstaendigt die angefangene Meldung.
  const nachgereicht = nachricht('x');
  equal('behandelt', await behandleSkMeldung(nachgereicht, 'Elegnu', werkzeuge), true);
  equal('  jetzt angelegt', nachgereicht.gesendet.length, 1);
  equal('  mit dem nachgereichten Gegner', nachgereicht.gesendet[0].embeds[0].data.fields[0].value, '**Elegnu**');
  equal('  und der alten Zeit', nachgereicht.gesendet[0].embeds[0].data.fields[1].value, '**16:35**');

  // Danach ist die Meldung abgehakt - ein weiteres Wort legt nichts mehr an.
  const danach = nachricht('x');
  equal('nichts Offenes mehr', await behandleSkMeldung(danach, 'Nemesis', werkzeuge), false);
  equal('  nichts angelegt', danach.gesendet.length, 0);

  finish();
})();
