const { check, equal, finish, section } = require('./lib');
const { sucheCode } = require('../code-recherche/websuche');

// Prototyp-Test: sucheCode() bekommt abrufen() injiziert, damit der Test
// keinen echten Netzwerkzugriff braucht (schnell, deterministisch, funktioniert
// auch ohne Internetverbindung und ohne echten API-Schluessel).

async function haupt() {
  section('Leere Anfrage');
  equal('leerer String', (await sucheCode('')).ok, false);
  equal('nur Leerzeichen', (await sucheCode('   ')).ok, false);
  equal('kein String', (await sucheCode(null)).ok, false);

  section('Kein API-Schluessel');
  {
    const alterSchluessel = process.env.TAVILY_API_KEY;
    delete process.env.TAVILY_API_KEY;
    const ohneSchluessel = await sucheCode('irgendwas', { abrufen: async () => ({ status: 200, daten: {} }) });
    equal('grund', ohneSchluessel.grund, 'kein_api_schluessel');
    if (alterSchluessel !== undefined) process.env.TAVILY_API_KEY = alterSchluessel;
  }

  // Ab hier braucht sucheCode() einen (nicht echten) Schluessel, damit die
  // Pruefung oben nicht erneut greift - abrufen() ist injiziert, der Wert
  // wird also nie wirklich an Tavily geschickt.
  process.env.TAVILY_API_KEY = 'test-schluessel';

  // Ab hier immer eine gefaelschte uebersetzen()-Funktion mitgeben - sonst
  // wuerde jeder Testlauf einen echten Ollama-Aufruf machen (langsam, und
  // schlaegt fehl, wenn gerade kein Ollama laeuft).
  const keineUebersetzung = async () => ({ ok: false, grund: 'nicht_gebraucht_im_test' });

  section('Erfolgreiche Antwort ueber "answer" (Uebersetzung schlaegt fehl -> Original bleibt)');
  const erfolg = await sucheCode('node.js readFileSync', {
    abrufen: async () => ({
      status: 200,
      daten: { answer: 'Liest eine Datei synchron.', results: [{ url: 'https://example.com/fs', content: '...' }] },
    }),
    uebersetzen: keineUebersetzung,
  });
  check('ok', erfolg.ok);
  equal('Text (englisches Original, da Uebersetzung fehlschlug)', erfolg.text, 'Liest eine Datei synchron.');
  equal('Quelle', erfolg.quelle, 'https://example.com/fs');
  equal('kein original-Feld, wenn nicht uebersetzt wurde', erfolg.original, undefined);

  section('Erfolgreiche Antwort nur ueber Trefferliste (kein "answer")');
  const nurTreffer = await sucheCode('seltene frage', {
    abrufen: async () => ({
      status: 200,
      daten: { results: [{ url: 'https://example.com/x', content: 'Trefferinhalt.' }] },
    }),
    uebersetzen: keineUebersetzung,
  });
  check('ok', nurTreffer.ok);
  equal('Text aus Trefferliste', nurTreffer.text, 'Trefferinhalt.');

  section('Antwort wird ins Deutsche uebersetzt, wenn die Uebersetzung klappt');
  const uebersetzt = await sucheCode('node.js readFileSync', {
    abrufen: async () => ({ status: 200, daten: { answer: 'Reads a file synchronously.', results: [] } }),
    uebersetzen: async (text) => ({ ok: true, text: `[DE] ${text}` }),
  });
  check('ok', uebersetzt.ok);
  equal('deutscher Text', uebersetzt.text, '[DE] Reads a file synchronously.');
  equal('Original mitgeliefert', uebersetzt.original, 'Reads a file synchronously.');

  section('Keine Antwort gefunden');
  const leer = await sucheCode('etwas ganz obskures', {
    abrufen: async () => ({ status: 200, daten: { results: [] } }),
  });
  equal('grund', leer.grund, 'keine_antwort_gefunden');

  section('Abruf schlaegt fehl');
  const fehlerStatus = await sucheCode('irgendwas', {
    abrufen: async () => ({ status: 401, daten: null }),
  });
  equal('grund bei Fehlerstatus', fehlerStatus.grund, 'abruf_fehlgeschlagen');

  const wirftSynchron = await sucheCode('irgendwas', {
    abrufen: () => { throw new Error('kaputt'); },
  });
  equal('grund bei synchronem Wurf', wirftSynchron.grund, 'unerwarteter_fehler');

  finish();
}

haupt();
