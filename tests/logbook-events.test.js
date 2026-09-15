const { check, finish, section } = require('./lib');
const { findEventsInImageText } = require('../src/logbook-events');

// Katalog-Abgleich fuer Text, der aus einem Bild gelesen wurde. Jeder Eintrag
// hier ist an einem echten, gemessenen Fall festgemacht - kein Rateweg.

section('RP-Fabrik auch auf Englisch');
// Kevins Meldung (24.08.): das Spiel zeigt den Kasten bei manchen Spielern
// auf Englisch an. Echter Rohtext aus dem Ticket, nicht erfunden.
check('RP Ticket Factory', findEventsInImageText(
  'RP Ticket Factory 21 Met 20 Sakura 20 EL EGNU 17 Unknown 6 Valshalls gta5grand.com tel: 218007 981',
).some((e) => e.key === 'rp-fabrik'));
check('deutsch bleibt weiter erkannt', findEventsInImageText('RP Ticket Fabrik').some((e) => e.key === 'rp-fabrik'));

section('Gießerei auch auf Englisch');
check('Seizure of a foundry', findEventsInImageText(
  'gta5grand.com ID: 218007 784 Seizure of a foundry 5839 EL EGNU 3002 Unknown 1038 Amnesty 10:20',
).some((e) => e.key === 'giesserei'));
check('deutsch bleibt weiter erkannt', findEventsInImageText('Uebernahme der Giesserei').some((e) => e.key === 'giesserei'));

section('SK auf dem Abschlussbildschirm');
// Vorher fehlte das komplett - siehe Kommentar bei "sk" in logbook-events.js.
check('STAATLICHE KONTROLLE', findEventsInImageText('STAATLICHE KONTROLLE').some((e) => e.key === 'sk'));

section('Die Ressourcenkrieg-Gewinnmeldung bleibt beim 40er, nicht Bizwar');
// Frueher zweimal falsch: erst bei Bizwar (wegen "Geschaeft"), dann ganz
// rausgeworfen. Siehe Kommentar bei "40er".
check('Kampf ums Geschaeft -> 40er', findEventsInImageText(
  'Kampf ums Geschäft für inoffizielle Organisationen',
).some((e) => e.key === '40er'));
check('  nicht Bizwar', !findEventsInImageText(
  'Kampf ums Geschäft für inoffizielle Organisationen',
).some((e) => e.key === 'bizwar'));
check('echtes Bizwar bleibt erkannt', findEventsInImageText('Uebernahme des Geschaefts').some((e) => e.key === 'bizwar'));

finish();
