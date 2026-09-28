const { check, equal, finish, section } = require('./lib');
const { uebersetzeInsDeutsche } = require('../code-recherche/uebersetzung');

async function haupt() {
  section('Leerer Text');
  equal('leerer String', (await uebersetzeInsDeutsche('')).grund, 'leerer_text');
  equal('nur Leerzeichen', (await uebersetzeInsDeutsche('   ')).grund, 'leerer_text');

  section('Erfolgreiche Uebersetzung');
  const erfolg = await uebersetzeInsDeutsche('Hello world', {
    abrufen: async () => ({ status: 200, daten: { message: { content: 'Hallo Welt' } } }),
  });
  check('ok', erfolg.ok);
  equal('Text', erfolg.text, 'Hallo Welt');

  section('Ollama nicht erreichbar');
  const nichtErreichbar = await uebersetzeInsDeutsche('irgendwas', {
    abrufen: async () => ({ status: 500, daten: null }),
  });
  equal('grund', nichtErreichbar.grund, 'ollama_nicht_erreichbar');

  section('Leere Antwort vom Modell');
  const leereAntwort = await uebersetzeInsDeutsche('irgendwas', {
    abrufen: async () => ({ status: 200, daten: { message: { content: '' } } }),
  });
  equal('grund', leereAntwort.grund, 'keine_antwort');

  section('Wirft nie, auch nicht bei synchronem Wurf');
  const wirftSynchron = await uebersetzeInsDeutsche('irgendwas', {
    abrufen: () => { throw new Error('kaputt'); },
  });
  equal('grund', wirftSynchron.grund, 'unerwarteter_fehler');

  finish();
}

haupt();
