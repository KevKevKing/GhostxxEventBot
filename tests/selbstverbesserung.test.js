const { check, finish, section } = require('./lib');
const { aktuellerLauf, tick } = require('../src/selbstverbesserung');

section('Schalter aus -> komplett untaetig');
(async () => {
  const aufrufeAus = [];
  await tick({
    schalterAn: () => false,
    beobachten: {
      erkenneProblem: async () => { aufrufeAus.push('erkenneProblem'); return { titel: 'X', belege: [] }; },
      crashSchleifeErkannt: async () => { aufrufeAus.push('crashSchleifeErkannt'); return null; },
      parserFehlschlagErkannt: async () => null,
    },
    limit: { darfLaufen: async () => ({ erlaubt: true }), vermerkeLauf: async () => aufrufeAus.push('vermerkeLauf') },
    session: { starteSession: async () => { aufrufeAus.push('starteSession'); return { ok: true }; } },
    benachrichtigung: {
      benachrichtige: async () => aufrufeAus.push('benachrichtige'),
      sendeAusstehende: async () => { aufrufeAus.push('sendeAusstehende'); return 0; },
    },
    gedaechtnis: { neuerEintrag: async () => { aufrufeAus.push('neuerEintrag'); return { id: '1' }; } },
  });
  check('Bei ausgeschaltetem Schalter passiert gar nichts', aufrufeAus.length === 0);
  check('Auch keine nachgereichten DMs', !aufrufeAus.includes('sendeAusstehende'));

  section('Kein Problem -> nichts passiert');
  const aufrufe = [];
  await tick({
    schalterAn: () => true,
    beobachten: { erkenneProblem: async () => null, crashSchleifeErkannt: async () => null, parserFehlschlagErkannt: async () => null },
    limit: { darfLaufen: async () => ({ erlaubt: true }), vermerkeLauf: async () => aufrufe.push('vermerkeLauf') },
    session: { starteSession: async () => { aufrufe.push('starteSession'); return { ok: true, branch: 'x', zusammenfassung: 'y' }; } },
    benachrichtigung: { benachrichtige: async () => aufrufe.push('benachrichtige'), sendeAusstehende: async () => 0 },
    gedaechtnis: { neuerEintrag: async () => { aufrufe.push('neuerEintrag'); return { id: '1' }; }, vermerkeSession: async () => aufrufe.push('vermerkeSession') },
  });
  check('Nichts ausgeloest', aufrufe.length === 0);

  section('Problem gefunden und Limit erlaubt -> volle Kette');
  const aufrufe2 = [];
  await tick({
    schalterAn: () => true,
    beobachten: { erkenneProblem: async () => ({ titel: 'X', belege: [] }), crashSchleifeErkannt: async () => null, parserFehlschlagErkannt: async () => null },
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
    schalterAn: () => true,
    beobachten: { erkenneProblem: async () => ({ titel: 'X', belege: [] }), crashSchleifeErkannt: async () => null, parserFehlschlagErkannt: async () => null },
    limit: { darfLaufen: async () => ({ erlaubt: false, grund: 'tageslimit' }), vermerkeLauf: async () => aufrufe3.push('vermerkeLauf') },
    session: { starteSession: async () => { aufrufe3.push('starteSession'); return { ok: true }; } },
    benachrichtigung: { benachrichtige: async () => aufrufe3.push('benachrichtige'), sendeAusstehende: async () => 0 },
    gedaechtnis: { neuerEintrag: async () => { aufrufe3.push('neuerEintrag'); return { id: '1' }; }, vermerkeSession: async () => aufrufe3.push('vermerkeSession') },
  });
  check('Keine Session bei erreichtem Limit', !aufrufe3.includes('starteSession'));
  check('Fund wird trotzdem vermerkt statt still verworfen', aufrufe3.includes('neuerEintrag'));
  check('Kevin bekommt eine Meldung', aufrufe3.includes('benachrichtige'));
  check('Kein Lauf gezaehlt, es lief ja nichts', !aufrufe3.includes('vermerkeLauf'));

  section('Tageslimit-Meldung nennt den Grund');
  let gemeldet = null;
  await tick({
    schalterAn: () => true,
    beobachten: { erkenneProblem: async () => ({ titel: 'X', belege: [] }), crashSchleifeErkannt: async () => null, parserFehlschlagErkannt: async () => null },
    limit: { darfLaufen: async () => ({ erlaubt: false, grund: 'tageslimit' }), vermerkeLauf: async () => {} },
    session: { starteSession: async () => ({ ok: true }) },
    benachrichtigung: { benachrichtige: async (e) => { gemeldet = e; }, sendeAusstehende: async () => 0 },
    gedaechtnis: { neuerEintrag: async () => ({ id: '7' }), vermerkeSession: async () => {} },
  });
  check('Meldung sagt Tageslimit', String(gemeldet?.ergebnis?.fehler || '').includes('Tageslimit erreicht'));
  check('Meldung ist kein Erfolg', gemeldet?.ergebnis?.ok === false);

  section('Session wirft -> Eintrag wird ignoriert statt liegen zu bleiben');
  const aufrufe4 = [];
  let tickHatGeworfen = false;
  try {
    await tick({
      schalterAn: () => true,
    beobachten: { erkenneProblem: async () => ({ titel: 'X', belege: [] }), crashSchleifeErkannt: async () => null, parserFehlschlagErkannt: async () => null },
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
  // Der Versuch zaehlt, nicht der Erfolg: sonst wuerde ein dauerhafter Fehler
  // endlos ungezaehlte Sessions ausloesen und nie ans Tageslimit stossen.
  check('Lauf trotz Fehler gezaehlt', aufrufe4.includes('vermerkeLauf'));
  check('Gezaehlt wurde vor dem Start', aufrufe4.indexOf('vermerkeLauf') === aufrufe4.indexOf('neuerEintrag') + 1);
  check('Keine Benachrichtigung trotz Fehler', !aufrufe4.includes('benachrichtige'));

  section('Dashboard sieht die laufende Session');
  check('Vorher laeuft nichts', aktuellerLauf().laeuft === false);

  let waehrendDerSession = null;
  await tick({
    schalterAn: () => true,
    beobachten: { erkenneProblem: async () => ({ titel: 'Laufendes Problem', belege: [] }), crashSchleifeErkannt: async () => null, parserFehlschlagErkannt: async () => null },
    limit: { darfLaufen: async () => ({ erlaubt: true }), vermerkeLauf: async () => {} },
    session: {
      starteSession: async () => {
        waehrendDerSession = aktuellerLauf();
        return { ok: true, branch: 'b', zusammenfassung: 'z' };
      },
    },
    benachrichtigung: { benachrichtige: async () => {}, sendeAusstehende: async () => 0 },
    gedaechtnis: { neuerEintrag: async () => ({ id: '5' }), vermerkeSession: async () => {} },
  });
  check('Waehrend der Session als laufend gemeldet', waehrendDerSession?.laeuft === true);
  check('Mit dem Problemtitel', waehrendDerSession?.problem === 'Laufendes Problem');
  check('Danach wieder aus', aktuellerLauf().laeuft === false);

  // Eine geworfene Session darf die Anzeige nicht haengen lassen.
  await tick({
    schalterAn: () => true,
    beobachten: { erkenneProblem: async () => ({ titel: 'Kaputtes Problem', belege: [] }), crashSchleifeErkannt: async () => null, parserFehlschlagErkannt: async () => null },
    limit: { darfLaufen: async () => ({ erlaubt: true }), vermerkeLauf: async () => {} },
    session: { starteSession: async () => { throw new Error('kaputt'); } },
    benachrichtigung: { benachrichtige: async () => {}, sendeAusstehende: async () => 0 },
    gedaechtnis: { neuerEintrag: async () => ({ id: '6' }), vermerkeSession: async () => {}, vermerkeEntscheidung: async () => {} },
  });
  check('Auch nach einem Fehler wieder aus', aktuellerLauf().laeuft === false);

  section('Kein Fehler/Absturz, aber Parser-Fund -> volle Kette laeuft trotzdem');
  const aufrufe5 = [];
  await tick({
    schalterAn: () => true,
    beobachten: {
      erkenneProblem: async () => null,
      crashSchleifeErkannt: async () => null,
      parserFehlschlagErkannt: async () => ({ titel: 'Parser erkennt "swap" wiederholt nicht', belege: [] }),
    },
    limit: { darfLaufen: async () => ({ erlaubt: true }), vermerkeLauf: async () => aufrufe5.push('vermerkeLauf') },
    session: { starteSession: async (problem) => { aufrufe5.push(`starteSession:${problem.titel}`); return { ok: true, branch: 'b', zusammenfassung: 'z' }; } },
    benachrichtigung: { benachrichtige: async () => aufrufe5.push('benachrichtige'), sendeAusstehende: async () => 0 },
    gedaechtnis: { neuerEintrag: async () => { aufrufe5.push('neuerEintrag'); return { id: '77' }; }, vermerkeSession: async (id) => aufrufe5.push(`vermerkeSession:${id}`) },
  });
  check('Dritte Quelle wird abgefragt und ausgeloest', aufrufe5.includes('starteSession:Parser erkennt "swap" wiederholt nicht'));
  check('Laeuft durch dieselbe Kette wie die anderen beiden Quellen', aufrufe5.includes('neuerEintrag') && aufrufe5.includes('benachrichtige'));

  section('bearbeiteProblem(): zwei echte Anlaesse gleichzeitig -> der zweite wird abgelehnt');
  const { bearbeiteProblem } = require('../src/selbstverbesserung');
  let ergebnisZweiter = null;
  const gedaechtnisAufrufeZweiter = [];
  const ergebnisErster = await bearbeiteProblem(
    { titel: 'Erstes Problem', belege: [] },
    {
      limit: { darfLaufen: async () => ({ erlaubt: true }), vermerkeLauf: async () => {} },
      session: {
        starteSession: async () => {
          // Waehrend die erste Session "laeuft" (laufendesProblem ist
          // gesetzt), einen zweiten echten Anlass simulieren - egal ob der
          // in Wirklichkeit von tick() oder von einem angenommenen
          // Code-Vorschlag kaeme, bearbeiteProblem darf ihn nicht parallel
          // durchlassen.
          ergebnisZweiter = await bearbeiteProblem(
            { titel: 'Zweites Problem', belege: [] },
            {
              limit: { darfLaufen: async () => ({ erlaubt: true }), vermerkeLauf: async () => {} },
              session: { starteSession: async () => { gedaechtnisAufrufeZweiter.push('starteSession'); return { ok: true }; } },
              benachrichtigung: { benachrichtige: async () => {}, sendeAusstehende: async () => 0 },
              gedaechtnis: { neuerEintrag: async () => { gedaechtnisAufrufeZweiter.push('neuerEintrag'); return { id: 'z' }; }, vermerkeSession: async () => {} },
            },
          );
          return { ok: true, branch: 'b', zusammenfassung: 'z' };
        },
      },
      benachrichtigung: { benachrichtige: async () => {}, sendeAusstehende: async () => 0 },
      gedaechtnis: { neuerEintrag: async () => ({ id: 'e' }), vermerkeSession: async () => {} },
    },
  );
  check('Erster Aufruf laeuft normal durch', ergebnisErster.ok === true);
  check('Zweiter Aufruf sofort abgelehnt', ergebnisZweiter?.ok === false && ergebnisZweiter?.uebersprungen === true);
  check('Zweiter Aufruf legt keinen Gedaechtnis-Eintrag an', !gedaechtnisAufrufeZweiter.includes('neuerEintrag'));
  check('Zweiter Aufruf startet keine Session', !gedaechtnisAufrufeZweiter.includes('starteSession'));
  check('Nach beiden Aufrufen wieder nichts am Laufen', aktuellerLauf().laeuft === false);

  finish();
})();
