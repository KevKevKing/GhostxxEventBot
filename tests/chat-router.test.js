const { check, equal, finish, section, useTempData } = require('./lib');

const temp = useTempData();
const { config } = require('../src/config');
const {
  detectIntent,
  executePlan,
  needsConfirmation,
  prepareIntent,
  resolveEventFromContext,
} = require('../src/chat-router');
const { getEvent, saveEvent } = require('../src/storage');

const OWNER = config.ownerId;
const FREMD = '999000000000000003';
const A = '111111111111111111';
const B = '222222222222222222';
const C = '333333333333333333';

const guild = {
  members: {
    fetch: async (id) => ({ id, user: { id, username: `u${id.slice(-3)}`, bot: false }, displayName: `u${id.slice(-3)}` }),
    search: async () => ({ size: 0, values: () => [] }),
    cache: new Map(),
  },
};
const stiller = { channels: { fetch: async () => null } };

(async () => {
  section('Wann wird bestaetigt');
  const vomParser = { action: 'swap', event: '40er', out: A, in: B, source: 'parser' };
  const vomModell = { action: 'swap', event: '40er', out: A, in: B, source: 'model' };
  // Der Parser fragt nicht mehr vorher - bis hierher sind Person und Anmeldung
  // aufgeloest. Was schiefgeht, holt der Rueckgaengig-Knopf zurueck.
  check('Parser im Eventkanal: nein', !needsConfirmation(vomParser, config.eventChannelId));
  check('Parser im Meldungskanal: nein', !needsConfirmation(vomParser, config.stateChannelId));
  check('Parser im Chatkanal: nein', !needsConfirmation(vomParser, config.chatChannelId));
  // Geratene Absichten bekommen ueberall einen Knopf - das Modell hat im Test
  // schon eintragen und austragen verwechselt.
  check('Modell im Chatkanal: ja', needsConfirmation(vomModell, config.chatChannelId));
  check('Modell im Eventkanal: ja', needsConfirmation(vomModell, config.eventChannelId));
  check('Listen nie', !needsConfirmation({ action: 'list', source: 'parser' }, config.eventChannelId));

  section('Rueckgaengig-Plan');
  const { buildUndoPlan } = require('../src/chat-router');
  const tauschZurueck = buildUndoPlan({ action: 'swap', eventId: 'e1', outId: A, inId: B });
  check('Tausch dreht sich um', tauschZurueck.outId === B && tauschZurueck.inId === A, JSON.stringify(tauschZurueck));

  const eintragZurueck = buildUndoPlan({ action: 'add', eventId: 'e1', playerId: A });
  check('Eintragen -> Austragen', eintragZurueck.action === 'remove' && eintragZurueck.playerId === A);

  const austragZurueck = buildUndoPlan({ action: 'remove', eventId: 'e1', playerId: A }, { status: 'removed_main' });
  check('Austragen -> Eintragen', austragZurueck.action === 'add' && austragZurueck.substitute === false);

  const bankZurueck = buildUndoPlan({ action: 'remove', eventId: 'e1', playerId: A }, { status: 'removed_substitute' });
  check('von der Bank -> auf die Bank zurueck', bankZurueck.substitute === true);

  section('Anmeldung aus dem Kontext');
  const jetzt = new Date().toISOString();
  await saveEvent({ id: 'k1', title: 'Angriff gemeldet', kind: 'state', status: 'open', attendees: [], substitutes: [], maxParticipants: 10, maxSubstitutes: 3, channelId: 'kanalA', messageId: 'msg1', createdAt: jetzt, startAt: jetzt });
  // Karteileiche: offen, aber Monate alt - darf nicht mitzaehlen.
  await saveEvent({ id: 'k0', title: 'Angriff gemeldet', kind: 'state', status: 'open', attendees: [], substitutes: [], channelId: 'kanalA', messageId: 'alt', createdAt: '2026-06-01T10:00:00.000Z' });

  let r = await resolveEventFromContext({ channelId: 'kanalA' });
  equal('genau die aktuelle im Kanal', r.ok && r.event.id, 'k1');
  r = await resolveEventFromContext({ repliedMessageId: 'msg1', channelId: 'egal' });
  equal('Antwort schlaegt Kanal', r.ok && r.via, 'reply');
  r = await resolveEventFromContext({ channelId: 'leererKanal' });
  check('leerer Kanal fragt nach', !r.ok && /Welches Event/.test(r.text), r.text);

  await saveEvent({ id: 'k2', title: '50er', status: 'open', attendees: [], substitutes: [], channelId: 'kanalA', messageId: 'msg2', createdAt: jetzt, startAt: jetzt });
  r = await resolveEventFromContext({ channelId: 'kanalA' });
  check('mehrere offene -> fragt nach', !r.ok && /Welche Anmeldung/.test(r.text), r.text);

  section('Vom Satz bis zur geaenderten Liste');
  await saveEvent({ id: 'w1', title: '40er', slug: '40er', status: 'open', attendees: [A, C], substitutes: [], maxParticipants: 2, maxSubstitutes: 0, channelId: 'x', messageId: '', createdAt: jetzt, startAt: jetzt });

  const satz = `Tausche aus dem Event (40er) <@${A}> mit <@${B}>`;
  const intent = detectIntent(satz);
  check('Satz erkannt', intent?.action === 'swap', JSON.stringify(intent));

  const ohneRechte = await prepareIntent(intent, { guild, member: { id: FREMD, roles: { cache: new Map() } }, channelId: 'x' });
  check('ohne Rechte abgelehnt', !ohneRechte.ok && /darfst/.test(ohneRechte.text), ohneRechte.text);

  const mitRechten = await prepareIntent(intent, { guild, member: { id: OWNER, roles: { cache: new Map() } }, channelId: 'x' });
  check('mit Rechten vorbereitet', mitRechten.ok && mitRechten.plan?.action === 'swap', JSON.stringify(mitRechten));

  // Mitschreiben, was ins Log geht.
  const logs = [];
  const { setLogClient } = require('../src/logger');
  setLogClient({
    channels: { fetch: async () => ({ isTextBased: () => true, send: async (p) => logs.push(p) }) },
  });

  const ergebnis = await executePlan(mitRechten.plan, stiller, { actorId: OWNER, via: 'chat' });
  check('ausgefuehrt', ergebnis.ok, ergebnis.text);
  equal('Liste getauscht', (await getEvent('w1')).attendees, [B, C]);

  section('Aenderung wird protokolliert');
  // Ohne Protokoll ist "wer hat mich rausgeworfen?" nicht beantwortbar.
  await new Promise((r) => setTimeout(r, 1500));
  const eintrag = logs.flatMap((p) => p.embeds.map((e) => e.data))
    .find((e) => (e.title || '').startsWith('Anmeldung:'));
  check('Eintrag geschrieben', Boolean(eintrag), JSON.stringify(logs.length));
  if (eintrag) {
    const felder = Object.fromEntries((eintrag.fields || []).map((f) => [f.name, f.value]));
    check('  nennt das Event', (felder.Event || '').includes('40er'), felder.Event);
    check('  nennt den Ausloeser', (felder.Von || '').includes(OWNER), felder.Von);
    check('  nennt beide Betroffenen', (felder.Betroffen || '').includes(A) && (felder.Betroffen || '').includes(B), felder.Betroffen);
    check('  nennt den Weg', (felder.Wie || '').includes('Chat'), felder.Wie);
  }

  section('Selbstbezug loest den Schreiber auf');
  const selbst = detectIntent('trag mich ein', { hasReply: true, selfId: OWNER });
  check('als Absicht erkannt', selbst?.action === 'add' && selbst.player === OWNER, JSON.stringify(selbst));

  section('Geschlossene Anmeldung');
  await saveEvent({ id: 'z1', title: 'Hotel', slug: 'hotel', status: 'closed', attendees: [A], substitutes: [], createdAt: jetzt, startAt: jetzt });
  const zu = await prepareIntent(
    { action: 'remove', event: 'Hotel', player: A, source: 'parser' },
    { guild, member: { id: OWNER, roles: { cache: new Map() } }, channelId: 'x' },
  );
  check('wird abgelehnt', !zu.ok && /(geschlossen|läuft keine Anmeldung)/.test(zu.text), zu.text);

  temp.cleanup();
  finish();
})();
