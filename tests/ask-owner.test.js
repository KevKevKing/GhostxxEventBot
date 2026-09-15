const { check, finish, section, useTempData } = require('./lib');

const temp = useTempData();
const { config } = require('../src/config');
const { askOwner, setAskClient } = require('../src/ask-owner');

const gesendet = [];
setAskClient({
  channels: {
    fetch: async (id) => (id === config.botHomeChannelId
      ? { isTextBased: () => true, send: async (p) => { gesendet.push(p); } }
      : null),
  },
});

function pings() {
  return gesendet.filter((p) => p.content?.includes(config.notifyUserId)).length;
}

(async () => {
  section('Rueckfrage landet im Rueckzugskanal');
  await askOwner({
    question: 'Wer ist "Pascal"?',
    detail: 'Ich finde niemanden mit dem Namen.',
    key: 'unbekannt:Pascal',
    message: {
      id: '111', guildId: config.guildId, channelId: config.eventChannelId,
      author: { id: '999' }, content: 'trag Pascal beim 40er ein',
    },
  });
  check('eine Nachricht gesendet', gesendet.length === 1, `${gesendet.length}`);
  check('mit Erwähnung', gesendet[0]?.content?.includes(config.notifyUserId));
  const embed = gesendet[0]?.embeds?.[0]?.data;
  check('Frage im Embed', embed?.description?.includes('Pascal'));
  const felder = (embed?.fields || []).map((f) => f.name);
  check('zeigt wer gefragt hat', felder.includes('Von'));
  check('zeigt wo', felder.includes('Wo'));
  check('hat Sprungmarke', (embed?.fields || []).some((f) => f.value?.includes('discord.com/channels')));

  section('Er darf frei fragen und erwaehnen');
  // Bewusst keine Obergrenze: er soll fragen so oft er will.
  const vorher = gesendet.length;
  for (let i = 0; i < 20; i += 1) {
    await askOwner({ question: `Frage ${i}`, key: `frage-${i}` });
  }
  check('alle 20 Fragen gepostet', gesendet.length === vorher + 20, `${gesendet.length - vorher}`);
  check('jede mit Erwähnung', pings() === gesendet.length, `${pings()} von ${gesendet.length}`);

  section('Schutz gegen Endlosschleifen');
  // Kein Drosseln, sondern Absicherung: ein Programmfehler soll nicht
  // hundertfach dasselbe pingen.
  const stand = gesendet.length;
  for (let i = 0; i < 50; i += 1) {
    await askOwner({ question: 'Wer ist "Pascal"?', key: 'schleife' });
  }
  check('identische Frage nur einmal', gesendet.length === stand + 1, `${gesendet.length - stand} mal`);

  section('Andere Frage kommt sofort durch');
  await askOwner({ question: 'Wer ist "Johannes"?', key: 'unbekannt:Johannes' });
  check('durchgelassen', gesendet.length === stand + 2);
  check('  mit Erwähnung', gesendet.at(-1).content.includes(config.notifyUserId));

  section('Ohne Frage passiert nichts');
  const letzterStand = gesendet.length;
  await askOwner({ question: '' });
  check('leere Frage ignoriert', gesendet.length === letzterStand);

  temp.cleanup();
  finish();
})();
