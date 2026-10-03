const { check, equal, finish, section } = require('./lib');

process.env.OLLAMA_URL = 'http://127.0.0.1:11434';
process.env.OLLAMA_MODELL = 'qwen3.5:9b';
process.env.OLLAMA_MODELL_KLEIN = 'qwen3.5:2b';

const { antworte, pickModel } = require('../ollama-client');

section('pickModel: waehlt nach Grafikkarten-Auslastung');
(async () => {
  const grossesModellVoll = async (url) => {
    if (String(url).includes('/api/ps')) {
      return {
        ok: true,
        json: async () => ({
          models: [{ name: 'qwen3.5:9b', size: 1000, size_vram: 900 }],
        }),
      };
    }
    return { ok: true, json: async () => ({}) };
  };
  equal('bleibt beim grossen Modell (90% auf GPU)', await pickModel({ fetchImpl: grossesModellVoll }), 'qwen3.5:9b');

  const grossesModellVerdraengt = async (url) => {
    if (String(url).includes('/api/ps')) {
      return {
        ok: true,
        json: async () => ({
          models: [{ name: 'qwen3.5:9b', size: 1000, size_vram: 300 }],
        }),
      };
    }
    return { ok: true, json: async () => ({}) };
  };
  equal('wechselt zum kleinen Modell (30% auf GPU)', await pickModel({ fetchImpl: grossesModellVerdraengt }), 'qwen3.5:2b');

  const nichtsGeladen = async () => ({ ok: true, json: async () => ({ models: [] }) });
  equal('bleibt beim grossen Modell ohne geladenes Modell', await pickModel({ fetchImpl: nichtsGeladen }), 'qwen3.5:9b');

  const nichtErreichbar = async () => { throw new Error('ECONNREFUSED'); };
  equal('bleibt beim grossen Modell wenn Ollama nicht antwortet', await pickModel({ fetchImpl: nichtErreichbar }), 'qwen3.5:9b');

  section('antworte: echte Antwort');
  const echteAntwort = async (url) => {
    if (String(url).includes('/api/ps')) return { ok: true, json: async () => ({ models: [] }) };
    return { ok: true, json: async () => ({ message: { content: 'Mir geht es gut.' } }) };
  };
  const ergebnis = await antworte('Wie geht es dir?', { fetchImpl: echteAntwort });
  check('ok', ergebnis.ok === true);
  equal('Text kommt durch', ergebnis.text, 'Mir geht es gut.');

  section('antworte: Ollama nicht erreichbar');
  const nichtErreichbar2 = async () => { throw new Error('ECONNREFUSED'); };
  const fehlerErgebnis = await antworte('Test', { fetchImpl: nichtErreichbar2 });
  check('nicht ok', fehlerErgebnis.ok === false);
  equal('Grund ist nicht_erreichbar', fehlerErgebnis.grund, 'nicht_erreichbar');

  section('antworte: leere Antwort vom Modell');
  const leereAntwort = async (url) => {
    if (String(url).includes('/api/ps')) return { ok: true, json: async () => ({ models: [] }) };
    return { ok: true, json: async () => ({ message: { content: '   ' } }) };
  };
  const leerErgebnis = await antworte('Test', { fetchImpl: leereAntwort });
  check('nicht ok bei leerer Antwort', leerErgebnis.ok === false);
  equal('Grund ist leer', leerErgebnis.grund, 'leer');

  section('antworte: kaputtes JSON vom Modell');
  const kaputterJSON = async (url) => {
    if (String(url).includes('/api/ps')) return { ok: true, json: async () => ({ models: [] }) };
    return {
      ok: true,
      json: async () => { throw new Error('SyntaxError: invalid JSON'); },
    };
  };
  const jsonErgebnis = await antworte('Test', { fetchImpl: kaputterJSON });
  check('nicht ok bei kaputtem JSON', jsonErgebnis.ok === false);
  equal('Grund ist nicht_erreichbar', jsonErgebnis.grund, 'nicht_erreichbar');

  finish();
})();
