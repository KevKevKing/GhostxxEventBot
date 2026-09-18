const { check, equal, finish, section } = require('./lib');
const { verarbeiteAeusserung } = require('../programm');

section('Erfolgreicher Durchlauf');
(async () => {
  const gesprochen = [];
  const ergebnis = await verarbeiteAeusserung('C:/temp/aufnahme.wav', {
    transkribieren: async () => ({ ok: true, text: 'Wie geht es dir?' }),
    antworten: async (text) => {
      check('Text kommt bei antworten() an', text === 'Wie geht es dir?');
      return { ok: true, text: 'Mir geht es gut.' };
    },
    sprechen: async (text) => { gesprochen.push(text); return { ok: true }; },
  });

  check('ok', ergebnis.ok === true);
  equal('genau ein Satz gesprochen', gesprochen.length, 1);
  equal('die echte Antwort wurde gesprochen', gesprochen[0], 'Mir geht es gut.');

  section('Transkription schlaegt fehl -> feste Antwort, kein Ollama-Aufruf');
  const gesprochen2 = [];
  let ollamaAufgerufen = false;
  const ergebnis2 = await verarbeiteAeusserung('C:/temp/aufnahme.wav', {
    transkribieren: async () => ({ ok: false, grund: 'kein_text' }),
    antworten: async () => { ollamaAufgerufen = true; return { ok: true, text: 'x' }; },
    sprechen: async (text) => { gesprochen2.push(text); return { ok: true }; },
  });
  check('nicht ok', ergebnis2.ok === false);
  check('Ollama wird nicht aufgerufen', ollamaAufgerufen === false);
  equal('feste Antwort fuer kein_text gesprochen', gesprochen2[0], require('../feste-antworten').textFuer('kein_text'));

  section('Ollama nicht erreichbar -> feste Antwort');
  const gesprochen3 = [];
  const ergebnis3 = await verarbeiteAeusserung('C:/temp/aufnahme.wav', {
    transkribieren: async () => ({ ok: true, text: 'Test' }),
    antworten: async () => ({ ok: false, grund: 'nicht_erreichbar' }),
    sprechen: async (text) => { gesprochen3.push(text); return { ok: true }; },
  });
  check('nicht ok', ergebnis3.ok === false);
  equal('feste Antwort fuer nicht_erreichbar gesprochen', gesprochen3[0], require('../feste-antworten').textFuer('nicht_erreichbar'));

  section('Ollama braucht zu lange -> feste Timeout-Antwort');
  const gesprochen4 = [];
  const langsamesAntworten = () => new Promise((resolve) => {
    setTimeout(() => resolve({ ok: true, text: 'zu spaet' }), 200);
  });
  const ergebnis4 = await verarbeiteAeusserung('C:/temp/aufnahme.wav', {
    transkribieren: async () => ({ ok: true, text: 'Test' }),
    antworten: langsamesAntworten,
    sprechen: async (text) => { gesprochen4.push(text); return { ok: true }; },
    ollamaTimeoutMs: 20,
  });
  check('nicht ok bei Zeitueberschreitung', ergebnis4.ok === false);
  equal('feste Timeout-Antwort gesprochen', gesprochen4[0], require('../feste-antworten').textFuer('timeout_ollama'));

  section('transkribieren wirft synchron -> kein Absturz');
  const ergebnis5 = await verarbeiteAeusserung('C:/temp/aufnahme.wav', {
    transkribieren: () => { throw new Error('kaputt'); },
    antworten: async () => ({ ok: true, text: 'x' }),
    sprechen: async () => ({ ok: true }),
  });
  check('nicht ok statt Wurf', ergebnis5.ok === false);
  equal('feste Antwort fuer unerwarteter_fehler', ergebnis5.gesagt, require('../feste-antworten').textFuer('unerwarteter_fehler'));

  section('antworten wirft synchron -> kein Absturz');
  const ergebnis6 = await verarbeiteAeusserung('C:/temp/aufnahme.wav', {
    transkribieren: async () => ({ ok: true, text: 'Test' }),
    antworten: () => { throw new Error('kaputt'); },
    sprechen: async () => ({ ok: true }),
  });
  check('nicht ok statt Wurf', ergebnis6.ok === false);
  equal('feste Antwort fuer unerwarteter_fehler', ergebnis6.gesagt, require('../feste-antworten').textFuer('unerwarteter_fehler'));

  section('sprechen wirft synchron -> kein Absturz, ehrliches ok:false');
  const ergebnis7 = await verarbeiteAeusserung('C:/temp/aufnahme.wav', {
    transkribieren: async () => ({ ok: true, text: 'Test' }),
    antworten: async () => ({ ok: true, text: 'Antwort' }),
    sprechen: () => { throw new Error('kaputt'); },
  });
  check('nicht ok statt Wurf', ergebnis7.ok === false);
  equal('gesagt ist leer statt der Antwort', ergebnis7.gesagt, '');

  section('transkribieren liefert undefined -> kein Absturz beim Zugriff auf .ok');
  const ergebnis8 = await verarbeiteAeusserung('C:/temp/aufnahme.wav', {
    transkribieren: async () => undefined,
    antworten: async () => ({ ok: true, text: 'x' }),
    sprechen: async () => ({ ok: true }),
  });
  check('nicht ok statt Absturz', ergebnis8.ok === false);

  section('sprechen scheitert bei sonst erfolgreicher Kette -> ehrliches ok:false');
  const ergebnis9 = await verarbeiteAeusserung('C:/temp/aufnahme.wav', {
    transkribieren: async () => ({ ok: true, text: 'Test' }),
    antworten: async () => ({ ok: true, text: 'Antwort' }),
    sprechen: async () => ({ ok: false, grund: 'piper_fehlgeschlagen' }),
  });
  check('nicht ok, obwohl Transkription und Antwort erfolgreich waren', ergebnis9.ok === false);
  equal('gesagt ist leer statt der Antwort', ergebnis9.gesagt, '');

  finish();
})();
