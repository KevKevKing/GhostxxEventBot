const { check, finish, section } = require('./lib');
const benachrichtigung = require('../src/selbstverbesserung-benachrichtigung');
const { config } = require('../src/config');

section('Sofortiger Versand ausserhalb der Nachtruhe');
(async () => {
  const gesendet = [];
  benachrichtigung.setBenachrichtigungClient({
    users: {
      fetch: async (id) => ({
        id,
        send: async (payload) => { gesendet.push(payload); },
      }),
    },
  });

  const jetzt = new Date('2026-09-17T14:00:00+02:00');
  const ok = await benachrichtigung.benachrichtige(
    { problem: { titel: 'Testproblem' }, ergebnis: { ok: true, branch: 'x', zusammenfassung: 'y' } },
    { now: jetzt },
  );
  check('Wurde sofort gesendet', ok === true);
  check('Genau eine DM', gesendet.length === 1);
  check('Enthaelt den Titel', JSON.stringify(gesendet[0]).includes('Testproblem'));

  section('Waehrend der Nachtruhe zurueckgehalten, danach zugestellt');
  const nachts = new Date('2026-09-18T03:00:00+02:00');
  const zurueckgehalten = await benachrichtigung.benachrichtige(
    { problem: { titel: 'Nachtproblem' }, ergebnis: { ok: true, branch: 'x', zusammenfassung: 'y' } },
    { now: nachts },
  );
  check('Nicht sofort gesendet', zurueckgehalten === false);
  check('Noch keine zweite DM', gesendet.length === 1);

  const morgens = new Date('2026-09-18T10:30:00+02:00');
  const anzahl = await benachrichtigung.sendeAusstehende({ now: morgens });
  check('Nachtrag zugestellt', anzahl === 1);
  check('Jetzt zwei DMs insgesamt', gesendet.length === 2);

  finish();
})();
