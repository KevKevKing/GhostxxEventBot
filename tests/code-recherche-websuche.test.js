const { check, equal, finish, section } = require('./lib');
const { sucheCode } = require('../code-recherche/websuche');

// Prototyp-Test: sucheCode() bekommt abrufen() injiziert, damit der Test
// keinen echten Netzwerkzugriff braucht (schnell, deterministisch, funktioniert
// auch ohne Internetverbindung).

async function haupt() {
  section('Leere Anfrage');
  equal('leerer String', (await sucheCode('')).ok, false);
  equal('nur Leerzeichen', (await sucheCode('   ')).ok, false);
  equal('kein String', (await sucheCode(null)).ok, false);

  section('Erfolgreiche Antwort');
  const erfolg = await sucheCode('node.js readFileSync', {
    abrufen: async () => ({
      status: 200,
      inhalt: JSON.stringify({ AbstractText: 'Liest eine Datei synchron.', AbstractURL: 'https://example.com/fs' }),
    }),
  });
  check('ok', erfolg.ok);
  equal('Text', erfolg.text, 'Liest eine Datei synchron.');
  equal('Quelle', erfolg.quelle, 'https://example.com/fs');

  section('Keine Antwort gefunden');
  const leer = await sucheCode('etwas ganz obskures', {
    abrufen: async () => ({ status: 200, inhalt: JSON.stringify({}) }),
  });
  equal('grund', leer.grund, 'keine_antwort_gefunden');

  section('Abruf schlaegt fehl');
  const fehlerStatus = await sucheCode('irgendwas', {
    abrufen: async () => ({ status: 500, inhalt: '' }),
  });
  equal('grund bei Fehlerstatus', fehlerStatus.grund, 'abruf_fehlgeschlagen');

  const wirftSynchron = await sucheCode('irgendwas', {
    abrufen: () => { throw new Error('kaputt'); },
  });
  equal('grund bei synchronem Wurf', wirftSynchron.grund, 'unerwarteter_fehler');

  const kaputtesJson = await sucheCode('irgendwas', {
    abrufen: async () => ({ status: 200, inhalt: 'kein-json' }),
  });
  equal('grund bei kaputtem JSON', kaputtesJson.grund, 'antwort_nicht_lesbar');

  finish();
}

haupt();
