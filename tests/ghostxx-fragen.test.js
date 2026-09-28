const { check, equal, finish, section, useTempData } = require('./lib');

const temp = useTempData();
const { config } = require('../src/config');
const knowledge = require('../src/knowledge');
const {
  beantworte,
  holeGestellte,
  loescheGestellte,
  merkeGestellt,
  offeneFragen,
  versucheUmgebungZuVerstehen,
  versucheZuVerstehen,
} = require('../src/ghostxx-fragen');

function rolle(id, name, mitgliederAnzahl) {
  return { id, name, managed: false, members: { size: mitgliederAnzahl } };
}

function kanal(id, name) {
  // ChannelType.GuildText ist 0.
  return { id, name, type: 0, parentId: null };
}

function guildMit({ rollen = [], kanaele = [] } = {}) {
  return {
    id: config.guildId,
    roles: { cache: new Map(rollen.map((r) => [r.id, r])) },
    channels: { cache: new Map(kanaele.map((k) => [k.id, k])) },
  };
}

function clientMit(guild) {
  return { guilds: { cache: new Map([[config.guildId, guild]]) } };
}

(async () => {
  section('versucheZuVerstehen: gibt die Vermutung zurueck, wenn sicher');
  const sicher = await versucheZuVerstehen('rolle', '3 Probe', {
    chatFn: async () => ({ ok: true, content: 'Vermutlich Leute in der dritten Probezeit-Stufe.' }),
  });
  equal('Vermutung', sicher, 'Vermutlich Leute in der dritten Probezeit-Stufe.');

  section('versucheZuVerstehen: UNBEKANNT wird als "keine Vermutung" gewertet');
  const unsicher = await versucheZuVerstehen('kanal', 'xyz-123', {
    chatFn: async () => ({ ok: true, content: 'UNBEKANNT' }),
  });
  equal('keine Vermutung', unsicher, null);

  section('versucheZuVerstehen: Ollama-Fehler wird nie geworfen');
  equal('ok:false', await versucheZuVerstehen('rolle', 'x', { chatFn: async () => ({ ok: false }) }), null);
  equal('wirft synchron', await versucheZuVerstehen('rolle', 'x', { chatFn: () => { throw new Error('kaputt'); } }), null);

  section('versucheUmgebungZuVerstehen: lernt still, fragt nie');
  const guild = guildMit({
    rollen: [rolle('r1', '3 Probe', 5)],
    kanaele: [kanal('k1', 'event-bot-anliegen')],
  });
  const versuche = [];
  const ergebnis = await versucheUmgebungZuVerstehen(clientMit(guild), {
    versuchen: async (art, name) => {
      versuche.push({ art, name });
      return art === 'rolle' ? 'Leute auf Probe.' : null;
    },
  });
  equal('zwei versucht (eine Rolle, ein Kanal)', ergebnis.versucht, 2);
  equal('eine davon gelernt', ergebnis.gelernt, 1);
  const gewusst = await knowledge.list();
  check('Rolle steht im Gedaechtnis', gewusst.some((f) => f.text.includes('3 Probe') && f.text.includes('Leute auf Probe')));
  check('Kanal steht NICHT im Gedaechtnis (keine Vermutung)', !gewusst.some((f) => f.text.includes('event-bot-anliegen')));

  section('versucheUmgebungZuVerstehen: bereits gelernte Rolle wird uebersprungen');
  // Die Rolle wurde eben gelernt (steht im Gedaechtnis) und wird deshalb nicht
  // nochmal versucht - der Kanal hat weiterhin keine Vermutung und bleibt
  // offen, wird also erneut versucht (kein Dauer-Merken von "weiss ich nicht").
  const versuche2 = [];
  const nochmal = await versucheUmgebungZuVerstehen(clientMit(guild), {
    versuchen: async (art, name) => { versuche2.push({ art, name }); return null; },
  });
  equal('nur noch der Kanal wird versucht', nochmal.versucht, 1);
  equal('Rolle nicht erneut angefragt', versuche2.some((v) => v.art === 'rolle'), false);

  section('offeneFragen: keine Rollen-/Kanalfragen mehr (Kategorie 3 entfernt)');
  const fragen = await offeneFragen(clientMit(guild));
  check('keine rolle:-Frage', !fragen.some((f) => f.id.startsWith('rolle:')));
  check('keine kanal:-Frage', !fragen.some((f) => f.id.startsWith('kanal:')));

  section('Gestellte Frage merken/holen/loeschen');
  equal('anfangs nichts gestellt', holeGestellte('u1'), null);
  merkeGestellt('u1', { id: 'satz:x', frage: 'Was?' });
  equal('gestellte Frage da', holeGestellte('u1')?.id, 'satz:x');
  loescheGestellte('u1');
  equal('nach dem Loeschen wieder nichts', holeGestellte('u1'), null);

  section('beantworte: zu kurze Antwort wird abgelehnt');
  equal('zu_kurz', (await beantworte('Frage?', 'x')).reason, 'zu_kurz');

  section('beantworte: merkt sich die Antwort mit der Frage davor');
  const gemerkt = await beantworte('Was wird fuer die Bank ausgezahlt?', '80k Win', 'u1', 'satz:bank');
  check('ok', gemerkt.ok);
  const wissen = await knowledge.list();
  check('Satz enthaelt Frage und Antwort', wissen.some((f) => f.text.includes('Was wird fuer die Bank ausgezahlt') && f.text.includes('80k Win')));

  finish();
})();
