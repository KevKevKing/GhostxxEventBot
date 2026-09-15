const { check, finish, section, useTempData } = require('./lib');

const temp = useTempData();
const { saveEvent } = require('../src/storage');
const { prepareIntent } = require('../src/chat-router');

// Die Anmeldung als Entscheidungshilfe.
//
// Auf dem echten Server heissen viele aehnlich ("Ghost Muffiin | 266391",
// "Ghost Rider | 118204"). Frueher musste er bei jedem solchen Namen
// zurueckfragen. Jetzt zaehlt die Richtung: wer rausgeht, steht in der Liste -
// wer reinkommt, steht nicht drin.

const GHOST_DRIN = '900000000000000001';
const GHOST_DRAUSSEN = '900000000000000002';
const JOHANNES = '900000000000000003';
const NOX = '900000000000000004';
const CHEF = '900000000000000005';

// Zwei Leute mit "Ghost" im Namen - genau der Fall, der vorher scheiterte.
const MITGLIEDER = [
  { id: GHOST_DRIN, displayName: 'Ghost Muffiin | 266391', user: { username: 'ghostmuffiin' } },
  { id: GHOST_DRAUSSEN, displayName: 'Ghost Rider | 118204', user: { username: 'ghostrider' } },
  { id: JOHANNES, displayName: 'Johannes Conti | 445120', user: { username: 'jconti' } },
  { id: NOX, displayName: 'Nox Erotica | 771003', user: { username: 'noxerotica' } },
  { id: CHEF, displayName: 'Chef', user: { username: 'chef' } },
];

const guild = {
  members: {
    cache: new Map(MITGLIEDER.map((m) => [m.id, m])),
    fetch: async (id) => MITGLIEDER.find((m) => m.id === id) || null,
    search: async () => null,
  },
};

const member = { id: CHEF, roles: { cache: new Map() } };

async function anlegen(attendees, substitutes = []) {
  const jetzt = new Date().toISOString();
  await saveEvent({
    id: 'e1',
    title: '40er',
    status: 'open',
    attendees,
    substitutes,
    maxParticipants: 10,
    maxSubstitutes: 3,
    channelId: 'kanalA',
    messageId: 'm1',
    createdAt: jetzt,
    startAt: jetzt,
  });
}

(async () => {
  const { addAdmin } = require('../src/permissions');
  await addAdmin(CHEF);

  const kontext = { guild, member, channelId: 'kanalA', repliedMessageId: '', authorId: CHEF };

  section('Tausch: die Richtung entscheidet');
  await anlegen([GHOST_DRIN, JOHANNES, NOX]);

  // "Ghost" passt auf zwei Leute. Rausgehen kann nur der, der drinsteht.
  const tausch = await prepareIntent(
    { action: 'swap', event: '40er', needsEvent: false, out: 'Ghost', in: 'Nox', source: 'parser' },
    kontext,
  );
  check('loest ohne Rueckfrage auf', tausch.ok, tausch.text);
  check('  raus = der Angemeldete', tausch.plan?.outId === GHOST_DRIN, tausch.plan?.outId);

  section('Andersherum: wer reinkommt, steht nicht drin');
  await anlegen([GHOST_DRAUSSEN, JOHANNES]);
  const rein = await prepareIntent(
    { action: 'swap', event: '40er', needsEvent: false, out: 'Johannes', in: 'Ghost', source: 'parser' },
    kontext,
  );
  check('loest auf', rein.ok, rein.text);
  check('  rein = der NICHT Angemeldete', rein.plan?.inId === GHOST_DRIN, rein.plan?.inId);

  section('Austragen: nur wer drin ist');
  await anlegen([GHOST_DRAUSSEN, NOX]);
  const raus = await prepareIntent(
    { action: 'remove', event: '40er', needsEvent: false, player: 'Ghost', source: 'parser' },
    kontext,
  );
  check('loest auf', raus.ok, raus.text);
  check('  trifft den Angemeldeten', raus.plan?.playerId === GHOST_DRAUSSEN, raus.plan?.playerId);

  section('Eintragen: nur wer draussen ist');
  await anlegen([GHOST_DRIN, NOX]);
  const ein = await prepareIntent(
    { action: 'add', event: '40er', needsEvent: false, player: 'Ghost', source: 'parser' },
    kontext,
  );
  check('loest auf', ein.ok, ein.text);
  check('  trifft den anderen', ein.plan?.playerId === GHOST_DRAUSSEN, ein.plan?.playerId);

  section('Die Ersatzbank zaehlt mit');
  await anlegen([NOX], [GHOST_DRIN]);
  const bank = await prepareIntent(
    { action: 'remove', event: '40er', needsEvent: false, player: 'Ghost', source: 'parser' },
    kontext,
  );
  check('Ersatzspieler gilt als angemeldet', bank.plan?.playerId === GHOST_DRIN, bank.plan?.playerId);

  section('Bleibt es unklar, wird gefragt');
  // Beide Ghosts stehen drin - die Anmeldung hilft nicht weiter. Dann lieber
  // nachhaken als den Falschen austragen.
  await anlegen([GHOST_DRIN, GHOST_DRAUSSEN, NOX]);
  const unklar = await prepareIntent(
    { action: 'remove', event: '40er', needsEvent: false, player: 'Ghost', source: 'parser' },
    kontext,
  );
  check('fragt weiterhin nach', !unklar.ok, JSON.stringify(unklar.plan));
  check('  nennt beide', /Muffiin/.test(unklar.text) && /Rider/.test(unklar.text), unklar.text);

  section('Keiner von beiden drin -> auch fragen');
  await anlegen([NOX, JOHANNES]);
  const keiner = await prepareIntent(
    { action: 'remove', event: '40er', needsEvent: false, player: 'Ghost', source: 'parser' },
    kontext,
  );
  check('fragt nach', !keiner.ok, JSON.stringify(keiner.plan));

  section('Eindeutige Namen laufen wie vorher');
  await anlegen([JOHANNES, NOX]);
  const klar = await prepareIntent(
    { action: 'remove', event: '40er', needsEvent: false, player: 'Johannes', source: 'parser' },
    kontext,
  );
  check('unveraendert', klar.ok && klar.plan?.playerId === JOHANNES, klar.text);

  temp.cleanup();
  finish();
})();
