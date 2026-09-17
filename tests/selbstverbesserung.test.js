const { check, finish, section } = require('./lib');
const { tick } = require('../src/selbstverbesserung');

section('Kein Problem -> nichts passiert');
(async () => {
  const aufrufe = [];
  await tick({
    beobachten: { erkenneProblem: async () => null, crashSchleifeErkannt: async () => null },
    limit: { darfLaufen: async () => ({ erlaubt: true }), vermerkeLauf: async () => aufrufe.push('vermerkeLauf') },
    session: { starteSession: async () => { aufrufe.push('starteSession'); return { ok: true, branch: 'x', zusammenfassung: 'y' }; } },
    benachrichtigung: { benachrichtige: async () => aufrufe.push('benachrichtige'), sendeAusstehende: async () => 0 },
    gedaechtnis: { neuerEintrag: async () => { aufrufe.push('neuerEintrag'); return { id: '1' }; }, vermerkeSession: async () => aufrufe.push('vermerkeSession') },
  });
  check('Nichts ausgeloest', aufrufe.length === 0);

  section('Problem gefunden und Limit erlaubt -> volle Kette');
  const aufrufe2 = [];
  await tick({
    beobachten: { erkenneProblem: async () => ({ titel: 'X', belege: [] }), crashSchleifeErkannt: async () => null },
    limit: { darfLaufen: async () => ({ erlaubt: true }), vermerkeLauf: async () => aufrufe2.push('vermerkeLauf') },
    session: { starteSession: async (problem) => { aufrufe2.push(`starteSession:${problem.titel}`); return { ok: true, branch: 'b', zusammenfassung: 'z' }; } },
    benachrichtigung: { benachrichtige: async () => aufrufe2.push('benachrichtige'), sendeAusstehende: async () => 0 },
    gedaechtnis: { neuerEintrag: async () => { aufrufe2.push('neuerEintrag'); return { id: '42' }; }, vermerkeSession: async (id) => aufrufe2.push(`vermerkeSession:${id}`) },
  });
  check('Eintrag angelegt', aufrufe2.includes('neuerEintrag'));
  check('Session gestartet mit richtigem Titel', aufrufe2.includes('starteSession:X'));
  check('Session vermerkt', aufrufe2.includes('vermerkeSession:42'));
  check('Benachrichtigt', aufrufe2.includes('benachrichtige'));
  check('Lauf gezaehlt', aufrufe2.includes('vermerkeLauf'));

  section('Tageslimit erreicht -> keine Session');
  const aufrufe3 = [];
  await tick({
    beobachten: { erkenneProblem: async () => ({ titel: 'X', belege: [] }), crashSchleifeErkannt: async () => null },
    limit: { darfLaufen: async () => ({ erlaubt: false, grund: 'tageslimit' }), vermerkeLauf: async () => aufrufe3.push('vermerkeLauf') },
    session: { starteSession: async () => { aufrufe3.push('starteSession'); return { ok: true }; } },
    benachrichtigung: { benachrichtige: async () => aufrufe3.push('benachrichtige'), sendeAusstehende: async () => 0 },
    gedaechtnis: { neuerEintrag: async () => { aufrufe3.push('neuerEintrag'); return { id: '1' }; }, vermerkeSession: async () => aufrufe3.push('vermerkeSession') },
  });
  check('Keine Session bei erreichtem Limit', !aufrufe3.includes('starteSession'));

  section('Session wirft -> Eintrag wird ignoriert statt liegen zu bleiben');
  const aufrufe4 = [];
  let tickHatGeworfen = false;
  try {
    await tick({
      beobachten: { erkenneProblem: async () => ({ titel: 'X', belege: [] }), crashSchleifeErkannt: async () => null },
      limit: { darfLaufen: async () => ({ erlaubt: true }), vermerkeLauf: async () => aufrufe4.push('vermerkeLauf') },
      session: { starteSession: async () => { throw new Error('kaputt'); } },
      benachrichtigung: { benachrichtige: async () => aufrufe4.push('benachrichtige'), sendeAusstehende: async () => 0 },
      gedaechtnis: {
        neuerEintrag: async () => { aufrufe4.push('neuerEintrag'); return { id: '99' }; },
        vermerkeSession: async () => aufrufe4.push('vermerkeSession'),
        vermerkeEntscheidung: async (id, { status }) => aufrufe4.push(`vermerkeEntscheidung:${id}:${status}`),
      },
    });
  } catch {
    tickHatGeworfen = true;
  }
  check('tick() wirft selbst nicht weiter', !tickHatGeworfen);
  check('Eintrag auf ignoriert gesetzt', aufrufe4.includes('vermerkeEntscheidung:99:ignoriert'));
  check('Kein Lauf gezaehlt trotz Fehler', !aufrufe4.includes('vermerkeLauf'));
  check('Keine Benachrichtigung trotz Fehler', !aufrufe4.includes('benachrichtige'));

  finish();
})();
