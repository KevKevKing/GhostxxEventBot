const { check, finish, section, useTempData } = require('./lib');

// Die Warteschlange liegt jetzt auf der Platte - eigenes Datenverzeichnis,
// damit der Test niemals data/ des echten Bots anfasst. Muss VOR dem require
// des Moduls stehen, weil config.dataDir beim Laden ausgelesen wird.
const temp = useTempData();

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

  section('Fehlschlag bei sofortigem Versand');
  const fehlerGesendet = [];
  benachrichtigung.setBenachrichtigungClient({
    users: {
      fetch: async (id) => ({
        id,
        send: async (payload) => { throw new Error('Discord ist gerade nicht erreichbar'); },
      }),
    },
  });

  const jetzta = new Date('2026-09-17T14:00:00+02:00');
  const fehler = await benachrichtigung.benachrichtige(
    { problem: { titel: 'Fehlversuch' }, ergebnis: { ok: true, branch: 'x', zusammenfassung: 'y' } },
    { now: jetzta },
  );
  check('Versand schlug fehl, meldet false', fehler === false);

  section('Fehlgeschlagene Warteschlangen-Abarbeitung');
  benachrichtigung.setBenachrichtigungClient({
    users: {
      fetch: async (id) => ({
        id,
        send: async (payload) => { throw new Error('Discord ist gerade nicht erreichbar'); },
      }),
    },
  });

  const nachtsb = new Date('2026-09-18T03:00:00+02:00');
  await benachrichtigung.benachrichtige(
    { problem: { titel: 'Warteschlangen-Fehler' }, ergebnis: { ok: true, branch: 'x', zusammenfassung: 'y' } },
    { now: nachtsb },
  );
  const wartend = await benachrichtigung.ladeWarteschlange();
  check('Nachtruhe schiebt in Warteschlange', wartend.length === 1, `tatsaechlich ${wartend.length}`);
  check('Und zwar den richtigen Eintrag', wartend[0]?.problem?.titel === 'Warteschlangen-Fehler');

  const morgensb = new Date('2026-09-18T10:30:00+02:00');
  const fehlgeschlagenZahl = await benachrichtigung.sendeAusstehende({ now: morgensb });
  check('Fehlgeschlagene Sendungen zaehlen nicht als Erfolg', fehlgeschlagenZahl === 0);

  section('Warteschlange ueberlebt einen Neustart');
  // Ein Absturz zwischen 2 und 10 Uhr hat frueher jede wartende DM fuer immer
  // verloren - und der Gedaechtnis-Eintrag blockte trotzdem 14 Tage lang.
  const nachtsc = new Date('2026-09-18T03:30:00+02:00');
  await benachrichtigung.benachrichtige(
    { problem: { titel: 'Ueberlebt den Neustart' }, ergebnis: { ok: true, branch: 'x', zusammenfassung: 'y' } },
    { now: nachtsc },
  );

  // "Neustart": Speicher vergessen, danach wird aus der Datei geladen.
  benachrichtigung.vergisWarteschlange();
  const nachNeustart = await benachrichtigung.ladeWarteschlange();
  check('Nach dem Neustart noch da', nachNeustart.length === 1, `tatsaechlich ${nachNeustart.length}`);
  check('Mit demselben Problem', nachNeustart[0]?.problem?.titel === 'Ueberlebt den Neustart');

  const zugestellt = [];
  benachrichtigung.setBenachrichtigungClient({
    users: { fetch: async (id) => ({ id, send: async (p) => { zugestellt.push(p); } }) },
  });
  const anzahlNachNeustart = await benachrichtigung.sendeAusstehende({ now: new Date('2026-09-18T11:00:00+02:00') });
  check('Nach dem Neustart zugestellt', anzahlNachNeustart === 1);
  check('Warteschlange danach leer', (await benachrichtigung.ladeWarteschlange()).length === 0);

  temp.cleanup();
  finish();
})();
