const { check, finish, section } = require('./lib');
const { fuerAnzeige } = require('../src/logbook-vision');

// fuerAnzeige() saeubert Rohtext vom Vision-Modell, bevor er in eine
// Discord-Nachricht geht. Kevins Meldung (30.08.): eine Auszahlungsnachricht
// zitierte woertlich eine Wiederholungsschleife des Modells ("10 EL EGNU"
// ueber zehnmal, einmal mit "markdown" mittendrin) - echte Faelle aus
// Ticket #296 (dastin744), nicht erfunden.

section('Wiederholungsschleifen werden erkannt, nicht roh gezeigt');
check('kurze Schleife mit Fremdwort mittendrin', fuerAnzeige(
  '14:10 10 EL EGNU 10 EL EGNU markdown UEB WWW.UEBU.NET 10 EL EGNU 10 EL EGNU',
) === 'wirkt wie eine Wiederholungsschleife, nicht lesbar');
check('lange Schleife', fuerAnzeige(
  'UEK WORLD CUP FINALS 13:40 El EGNU 10 EL EGNU Lie Brennan 9 EL EGNU 10 EL EGNU 10 EL EGNU '
  + '10 EL EGNU 10 EL EGNU 10 EL EGNU 10 EL EGNU 10 EL EGNU 10 EL EGNU 10 EL EGNU 10 EL EGNU '
  + '10 EL EGNU 10 EL EGNU',
) === 'wirkt wie eine Wiederholungsschleife, nicht lesbar');

section('Echte, legitime Lesungen bleiben unangetastet');
check('kurzer Wappen-Fund', fuerAnzeige('EL EGNU 14:30 Unknown') === 'EL EGNU 14:30 Unknown');
check('RP-Fabrik auf Englisch', fuerAnzeige(
  'RP Ticket Factory 21 Met 20 Sakura 20 EL EGNU 17 Unknown 6 Valshalls gta5grand.com tel: 218007 981',
) === 'RP Ticket Factory 21 Met 20 Sakura 20 EL EGNU 17 Unknown 6 Valshalls gta5grand.com tel: 218007 981');
check('lange Lesung mit mehrfachem "EL EGNU", aber kein Loop', fuerAnzeige(
  'gta5grand.com ID: 218007 784 Seizure of a foundry 5839 EL EGNU 3002 Unknown 1038 Amnesty 10:20 '
  + 'EL EGNU 3200 Amnesty 15 Unknown gewinner staatliche kontrolle',
).includes('Wiederholungsschleife') === false);
check('kurzer, knapper Text (unter 8 Woertern) loest nie aus', fuerAnzeige('EGNU 10 EL EGNU 10') === 'EGNU 10 EL EGNU 10');

section('Weiterhin: leer bleibt leer, backticks und lange Texte gekuerzt');
check('leer', fuerAnzeige('') === 'nichts');
check('nur Leerraum', fuerAnzeige('   ') === 'nichts');
check('Backticks raus, Inhalt bleibt', fuerAnzeige('```leer```') === 'leer');
check('nur Backticks, sonst leer', fuerAnzeige('```') === 'nichts');
check('sehr langer echter Text wird gekuerzt', fuerAnzeige('a'.repeat(300)).endsWith('…'));

finish();
