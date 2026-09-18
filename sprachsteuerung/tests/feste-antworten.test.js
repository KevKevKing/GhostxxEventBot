const { check, finish, section } = require('./lib');
const { textFuer } = require('../feste-antworten');

section('Jeder bekannte Grund hat einen eigenen Satz');
const bekannt = [
  'nicht_erreichbar', 'zeitueberschreitung', 'leer', 'fehlgeschlagen',
  'kein_text', 'piper_fehlgeschlagen', 'wiedergabe_fehlgeschlagen', 'timeout_ollama',
  'unerwarteter_fehler',
];
const gesehen = new Set();
for (const grund of bekannt) {
  const text = textFuer(grund);
  check(`${grund} hat einen Text`, typeof text === 'string' && text.length > 5);
  check(`${grund} ist nicht doppelt`, !gesehen.has(text));
  gesehen.add(text);
}

section('Unbekannter Grund faellt nicht auseinander');
check('generischer Text statt Wurf', typeof textFuer('irgendwas-unbekanntes') === 'string');

finish();
