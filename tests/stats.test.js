const { check, finish, section, useTempData } = require('./lib');

const temp = useTempData();
const { parseStatsFrage } = require('../src/stats-parser');
const { zeitraumStart } = require('../src/stats');

section('Teilnahmen zaehlen');
for (const [text, zeitraum] of [
  ['wie oft war ich diesen Monat dabei?', 'monat'],
  ['wie oft war ich letzten monat dabei', 'letzter_monat'],
  ['wie oft war ich diese woche dabei', 'woche'],
  ['wie oft war ich dieses jahr dabei', 'jahr'],
  ['wie oft war ich insgesamt dabei', null],
  ['wie oft war ich dabei', null],
]) {
  const f = parseStatsFrage(text);
  check(`"${text}"`, f?.art === 'teilnahmen' && f.zeitraum === zeitraum, JSON.stringify(f));
}

section('Wer ist gemeint');
const mitErwaehnung = parseStatsFrage('wie oft war <@286819354589265920> diesen monat dabei');
check('Erwaehnung', mitErwaehnung?.spieler?.userId === '286819354589265920', JSON.stringify(mitErwaehnung));

const mitName = parseStatsFrage('wie oft war Pascal dabei');
check('freier Name', mitName?.spieler?.name === 'Pascal', JSON.stringify(mitName?.spieler));

const selbst = parseStatsFrage('wie oft war ich dabei');
check('"ich" ist der Fragende', selbst?.spieler?.selbst === true, JSON.stringify(selbst?.spieler));

section('Name nach jedem Verb, nicht nur nach "war"');
// Im Leitungschat gefragt: "wie viel events hat johannes schon gespielt?"
// Geantwortet hat er mit KEVINS Zahlen - die Namenserkennung kannte nur
// "war X dabei", fand nichts und nahm still den Fragenden an. Dreimal
// hintereinander die falsche Person.
for (const [text, erwartet] of [
  ['wie viel events hat johannes schon gespielt ?', 'johannes'],
  ['wie viele events hat fedex wave gespielt', 'fedex wave'],
  ['wie oft hat Ghost Muffiin mitgemacht', 'Ghost Muffiin'],
  ['wann war Johannes Conti zuletzt dabei', 'Johannes Conti'],
  ['wie oft ist Nox angemeldet gewesen', 'Nox'],
]) {
  const r = parseStatsFrage(text);
  check(`"${text.slice(0, 42)}" -> ${erwartet}`, r?.spieler?.name === erwartet, JSON.stringify(r?.spieler));
}

// Und der Fragende bleibt gemeint, wenn kein Name dasteht.
for (const text of [
  'wie oft war ich dabei',
  'wie viele events war ich da ?',
  'wie oft war ich diesen monat dabei',
  'wie oft war er dabei',
]) {
  const r = parseStatsFrage(text);
  check(`"${text}" -> ich`, r?.spieler?.selbst === true || r?.spieler?.name === null, JSON.stringify(r?.spieler));
}

section('Wer ist X');
// "wer ist Fedex Wave" hat er mit "Der Begriff existiert so nicht" beantwortet.
for (const [text, erwartet] of [
  ['wer ist Fedex Wave', 'Fedex Wave'],
  ['wer ist eigentlich Pascal?', 'Pascal'],
  ['wer ist Johannes Conti', 'Johannes Conti'],
]) {
  const r = parseStatsFrage(text);
  check(`"${text}"`, r?.art === 'person' && r.spieler.name === erwartet, JSON.stringify(r));
}

const werMention = parseStatsFrage('wer ist <@286819354589265920>');
check('mit Erwaehnung', werMention?.art === 'person' && werMention.spieler.userId === '286819354589265920');

// Wissensfragen gehoeren ans Modell, nicht in die Mitgliedersuche.
for (const text of [
  'wer ist der aktuelle Präsident von Frankreich',
  'wer ist die beste Familie auf dem Server',
  'wer ist dabei',
]) {
  check(`"${text}" bleibt beim Modell`, parseStatsFrage(text)?.art !== 'person', JSON.stringify(parseStatsFrage(text)));
}

section('Eventart erkennen');
for (const [text, event] of [
  ['wie oft war ich im 40er dabei', '40er'],
  ['wie oft war ich beim bizwar dabei', 'BizWar'],
  ['wie oft war ich bei der waffenfabrik', 'Waffenfabrik'],
  ['wie oft war ich beim hafen dabei', 'Hafen'],
  ['wie oft war ich bei der bank dabei', 'Bank'],
  ['wie oft war ich dabei', null],
]) {
  const f = parseStatsFrage(text);
  check(`"${text}" -> ${event}`, f?.event === event, JSON.stringify(f?.event));
}

section('Letzte Teilnahmen');
for (const text of [
  'wann war ich zuletzt dabei',
  'wann war Pascal das letzte mal dabei',
  'zeig mir die letzten events von Pascal',
]) {
  check(`"${text}"`, parseStatsFrage(text)?.art === 'letzte', JSON.stringify(parseStatsFrage(text)));
}

section('Bestenliste');
for (const text of [
  'wer war am haeufigsten dabei',
  'wer war diesen monat am meisten im 40er',
  'wer sind die fleissigsten',
]) {
  check(`"${text}"`, parseStatsFrage(text)?.art === 'bestenliste', JSON.stringify(parseStatsFrage(text)));
}

section('Uebersicht');
for (const text of [
  'welche events gab es diesen monat',
  'wie viele events gab es letzten monat',
  'zeig mir die statistik',
]) {
  check(`"${text}"`, parseStatsFrage(text)?.art === 'uebersicht', JSON.stringify(parseStatsFrage(text)));
}

section('Normales Gerede bleibt unberuehrt');
// Das Wichtigste hier: der Parser darf nicht alles an sich reissen. Greift er
// zu breit, beantwortet der Bot Geplauder mit Zahlen.
for (const text of [
  'hey wie gehts dir?',
  'was weißt du über Pascal',
  'wer ist der aktuelle Präsident von Frankreich',
  'wie ist das wetter',
  'tausch im 40er den GhostMuffiin gegen Pascal',
  'trag mich beim 40er ein',
  'wie heißt du eigentlich',
  'was kannst du alles',
  'wann ist der nächste 40er',
  'wie spät ist es',
  'merk dir dass der 40er stuendlich laeuft',
  'wie viele leute passen in den 40er',
]) {
  check(`"${text}"`, parseStatsFrage(text) === null, JSON.stringify(parseStatsFrage(text)));
}

section('Zeitraeume rechnen richtig');
// 15. Maerz 2026, 12 Uhr Ortszeit.
const bezug = new Date(2026, 2, 15, 12, 0, 0).getTime();
const monat = new Date(zeitraumStart('monat', bezug));
check('Monat beginnt am Ersten', monat.getDate() === 1 && monat.getMonth() === 2, monat.toISOString());

const letzter = new Date(zeitraumStart('letzter_monat', bezug));
check('Vormonat ist Februar', letzter.getMonth() === 1 && letzter.getDate() === 1, letzter.toISOString());

const jahr = new Date(zeitraumStart('jahr', bezug));
check('Jahr beginnt im Januar', jahr.getMonth() === 0 && jahr.getDate() === 1, jahr.toISOString());

const woche = zeitraumStart('woche', bezug);
check('Woche sind 7 Tage', bezug - woche === 7 * 24 * 60 * 60 * 1000);
check('ohne Angabe kein Filter', zeitraumStart(null, bezug) === null);

temp.cleanup();
finish();
