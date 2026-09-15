const { check, equal, finish, section, useTempData } = require('./lib');

const temp = useTempData();
const { judge, parseModelJson } = require('../src/visa');
const { parseSettingChange } = require('../src/bot-settings');

const regeln = { visaMinYears: 15, visaMaxId: 300000 };

section('Aufnahmeregeln');
// Echte Faelle aus dem Abstimmungskanal.
equal('Visum 9 -> ablehnen', judge({ visum: 9, id: 295024 }, regeln).verdict, 'ablehnen');
equal('Visum 28 -> annehmen', judge({ visum: 28, id: 292872 }, regeln).verdict, 'ok');
equal('Visum 12 -> ablehnen', judge({ visum: 12, id: 162217 }, regeln).verdict, 'ablehnen');
equal('ID zu hoch -> ablehnen', judge({ visum: 20, id: 310000 }, regeln).verdict, 'ablehnen');
equal('genau an der Grenze -> annehmen', judge({ visum: 15, id: 300000 }, regeln).verdict, 'ok');
equal('knapp drunter -> ablehnen', judge({ visum: 14, id: 250000 }, regeln).verdict, 'ablehnen');

section('Unlesbares wird nicht geraten');
equal('Visum unlesbar', judge({ visum: null, id: 295024 }, regeln).verdict, 'unsicher');
equal('ID unlesbar', judge({ visum: 20, id: null }, regeln).verdict, 'unsicher');
equal('beides unlesbar', judge({ visum: null, id: null }, regeln).verdict, 'unsicher');
// Ein klarer Ablehnungsgrund schlaegt Unsicherheit.
equal('Visum zu klein trotz unlesbarer ID', judge({ visum: 3, id: null }, regeln).verdict, 'ablehnen');

section('Geaenderte Regeln wirken sofort');
equal('Visum 16 bei Grenze 15', judge({ visum: 16, id: 100 }, regeln).verdict, 'ok');
equal('Visum 16 bei Grenze 20', judge({ visum: 16, id: 100 }, { visaMinYears: 20, visaMaxId: 300000 }).verdict, 'ablehnen');

section('Antwort des Modells auslesen');
check('JSON aus Geschwaetz', parseModelJson('Hier:\n{"name":"LARS","visum":28,"id":292872}\nPasst.')?.visum === 28);
check('kein JSON -> null', parseModelJson('weiss nicht') === null);
check('kaputtes JSON -> null', parseModelJson('{"visum": }') === null);

section('Regeln per Chat ansagen');
equal('"Visum ist jetzt 18"', parseSettingChange('Ghost, Visum ist jetzt 18'), { visaMinYears: 18 });
equal('"ID Grenze auf 320000"', parseSettingChange('ID Grenze auf 320000'), { visaMaxId: 320000 });
equal('mit Tausenderpunkt', parseSettingChange('ID Grenze auf 325.000'), { visaMaxId: 325000 });
equal('beides in einem Satz', parseSettingChange('Visum ist jetzt 18 und ID auf 310000'), { visaMinYears: 18, visaMaxId: 310000 });
// Fragen duerfen die Regel nicht ueberschreiben.
check('Frage ist keine Ansage', parseSettingChange('wie hoch ist das visum grade?') === null);

temp.cleanup();
finish();
