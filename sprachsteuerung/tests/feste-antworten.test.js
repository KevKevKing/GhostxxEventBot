const { check, finish, section } = require('./lib');
const { textFuer } = require('../feste-antworten');

section('Jeder bekannte Grund hat einen eigenen Satz');
const bekannt = [
  'nicht_erreichbar', 'zeitueberschreitung', 'leer', 'fehlgeschlagen',
  'kein_text', 'piper_fehlgeschlagen', 'wiedergabe_fehlgeschlagen', 'timeout_ollama',
  'unerwarteter_fehler', 'programm_unbekannt', 'programm_fehlgeschlagen',
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

section('neue Grund-Werte fuer Baustein 2 (Programme starten)');
check('programm_unbekannt hat einen Text', textFuer('programm_unbekannt').length > 0);
check('programm_unbekannt ist nicht der Standard-Fallback', textFuer('programm_unbekannt') !== textFuer('ein-grund-den-es-nicht-gibt'));
check('programm_fehlgeschlagen hat einen Text', textFuer('programm_fehlgeschlagen').length > 0);
check('programm_fehlgeschlagen ist nicht der Standard-Fallback', textFuer('programm_fehlgeschlagen') !== textFuer('ein-grund-den-es-nicht-gibt'));

finish();
