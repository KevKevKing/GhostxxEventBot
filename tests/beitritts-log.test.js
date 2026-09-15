const { check, equal, finish, section } = require('./lib');
const { protokolliereVersuch, vollMoment, baueInfoText } = require('../src/beitritts-log');

section('Protokollieren');
let event = { beitrittsLog: [] };
event = protokolliereVersuch(event, 'u1', 'beigetreten', new Date('2026-08-17T20:30:00.100Z'));
event = protokolliereVersuch(event, 'u2', 'beigetreten', new Date('2026-08-17T20:30:01.500Z'));
equal('zwei Eintraege', event.beitrittsLog.length, 2);

// Wiederholtes Klicken (z.B. auf "schon dabei") darf die Statistik nicht
// mit Duplikaten vollmuellen - nur der erste Versuch zaehlt.
event = protokolliereVersuch(event, 'u1', 'beigetreten', new Date('2026-08-17T20:30:05.000Z'));
equal('kein zweiter Eintrag fuer u1', event.beitrittsLog.length, 2);
equal('die erste Zeit bleibt stehen', event.beitrittsLog[0].zeit, '2026-08-17T20:30:00.100Z');

section('Der exakte Voll-Moment');
// Drei Plaetze, die ersten zwei Versuche sind "beigetreten", der dritte ist
// die Auswechselbank (zaehlt nicht fuer den Hauptplatz).
let e2 = { maxParticipants: 2, beitrittsLog: [] };
equal('noch nicht voll', vollMoment(e2), null);

e2 = protokolliereVersuch(e2, 'a', 'beigetreten', new Date('2026-08-17T20:00:02.000Z'));
equal('erst einer, noch nicht voll', vollMoment(e2), null);

e2 = protokolliereVersuch(e2, 'b', 'beigetreten', new Date('2026-08-17T20:00:05.500Z'));
equal('genau der Moment des zweiten Beitritts', vollMoment(e2), '2026-08-17T20:00:05.500Z');

// Kommt spaeter noch wer auf die Auswechselbank, aendert das am
// Voll-Moment nichts - der ist an den HAUPTplaetzen festgemacht.
e2 = protokolliereVersuch(e2, 'c', 'ersatzbank', new Date('2026-08-17T20:00:09.000Z'));
equal('Ersatzbank aendert den Voll-Moment nicht', vollMoment(e2), '2026-08-17T20:00:05.500Z');

// Reihenfolge im Log ist nicht garantiert die zeitliche - vollMoment sortiert
// selbst nach der Zeit, nicht nach der Reihenfolge im Array.
let e3 = { maxParticipants: 2, beitrittsLog: [] };
e3.beitrittsLog = [
  { userId: 'x', zeit: '2026-08-17T20:00:03.000Z', ergebnis: 'beigetreten' },
  { userId: 'y', zeit: '2026-08-17T20:00:01.000Z', ergebnis: 'beigetreten' },
];
equal('nimmt die spaetere der beiden echten Zeiten', vollMoment(e3), '2026-08-17T20:00:03.000Z');

section('Info-Text');
const e4 = {
  openAt: '2026-08-17T20:00:00.000Z',
  beitrittsLog: [
    { userId: '1', zeit: '2026-08-17T20:00:02.347Z', ergebnis: 'beigetreten' },
    { userId: '2', zeit: '2026-08-17T20:00:01.000Z', ergebnis: 'beigetreten' },
    { userId: '3', zeit: '2026-08-17T20:00:05.000Z', ergebnis: 'ersatzbank' },
    { userId: '4', zeit: '2026-08-17T20:00:09.900Z', ergebnis: 'zu_spaet' },
  ],
};
const text = baueInfoText(e4);
const zeilen = text.split('\n');

equal('vier Zeilen', zeilen.length, 4);
// Chronologisch sortiert, nicht in Einfuegereihenfolge: userId 2 kam zuerst.
check('erste Zeile ist der fruehste Beitritt', zeilen[0].startsWith('1. <@2> mit 1.000 Sekunden'), zeilen[0]);
check('zweite Zeile', zeilen[1].startsWith('2. <@1> mit 2.347 Sekunden'), zeilen[1]);
check('Auswechselspieler markiert', zeilen[2].includes('(Auswechselspieler)'), zeilen[2]);
check('zu spaet markiert', zeilen[3].includes('leider zu spät'), zeilen[3]);

equal('leeres Protokoll', baueInfoText({ beitrittsLog: [] }), 'Für diese Anmeldung gibt es noch keine Statistik.');
equal('  auch ganz ohne Feld', baueInfoText({}), 'Für diese Anmeldung gibt es noch keine Statistik.');

finish();
