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

  finish();
})();
