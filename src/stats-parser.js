const { extractUserId } = require('./member-resolver');

// Erkennt Nachfragen zu den Anmeldungen, bevor das Modell drankommt.
//
// Dasselbe Muster wie beim Intent-Parser: was sich eindeutig aus dem Satz
// ablesen laesst, wird abgelesen. Das Modell wird nur gebraucht, wenn die Frage
// schief formuliert ist - und laeuft die Grafikkarte gerade voll, funktioniert
// das Nachschlagen hier trotzdem.

const ZEITRAEUME = [
  // Laengere Ausdruecke zuerst, sonst schluckt "monat" das "letzten monat".
  [/\b(letzten|vergangenen|vorigen)\s+monat\b/i, 'letzter_monat'],
  [/\b(diese[nr]?|dieser)\s+woche\b|\bletzte[nr]?\s+woche\b|\b(die\s+)?letzten\s+7\s+tage\b/i, 'woche'],
  [/\b(diese[nr]?|aktuellen|laufenden)\s+monat\b|\bim\s+monat\b/i, 'monat'],
  [/\b(diese[sm]?)\s+jahr\b|\bim\s+jahr\b/i, 'jahr'],
  [/\binsgesamt\b|\bgesamt\b|\ballem\b|\bueberhaupt\b|\büberhaupt\b/i, null],
];

// "wie oft", "wie viele", "wie vielen", "wieviele", "wie häufig".
//
// Die gebeugte Form hat gefehlt: "bei wie vielen Events war Cell Yeat dabei"
// lief ins Leere, weil nach "viele" ein "n" kam. Die Frage blieb unbeantwortet
// und landete stattdessen als angebliche Tatsache im Gedaechtnis.
const WIE_VIELE = /\b(wie\s+(oft|viele?n?|haeufig|häufig)|wieviele?n?)\b/i;

function findeZeitraum(text) {
  for (const [muster, wert] of ZEITRAEUME) {
    if (muster.test(text)) return { gefunden: true, zeitraum: wert };
  }
  return { gefunden: false, zeitraum: null };
}

// Wer ist gemeint? "ich"/"mich" bin ich selbst, sonst eine Erwaehnung oder ein
// Name. Ohne Angabe: der Fragende - "wie oft war ich dabei" und "wie oft war
// ich im 40er" sollen beide gehen.
const SELBST = /\b(ich|mich|mir|meine|meiner|selbst)\b/i;

function findeSpieler(text) {
  const erwaehnung = text.match(/<@!?(\d{17,25})>/);
  if (erwaehnung) return { userId: erwaehnung[1], name: null };

  const roheId = text.match(/\b(\d{17,25})\b/);
  if (roheId) return { userId: roheId[1], name: null };

  if (SELBST.test(text)) return { userId: null, name: null, selbst: true };

  const name = nameNachVerb(text);
  if (name) return { userId: null, name };

  const vonName = text.match(/\bvon\s+([A-Za-zÄÖÜäöüß][\w.\-]{1,30})/i);
  if (vonName) return { userId: null, name: vonName[1].trim() };

  return { userId: null, name: null, selbst: true };
}

// Woerter, die den Namen beenden. Alles bis dorthin gehoert zur Person.
const NAME_ENDE = new Set([
  'dabei', 'gespielt', 'gemacht', 'mitgemacht', 'teilgenommen', 'mitgespielt',
  'angemeldet', 'schon', 'insgesamt', 'zuletzt', 'bisher', 'eigentlich',
  'diesen', 'diesem', 'dieser', 'letzten', 'letzte', 'diese', 'im', 'in',
  'beim', 'bei', 'mit', 'am', 'an', 'auf', 'und', 'oder', 'bis',
]);

// Woerter, die nie ein Name sind, direkt hinter dem Verb.
const KEIN_NAME = new Set([
  'ich', 'mich', 'man', 'es', 'das', 'der', 'die', 'den', 'dem', 'ein', 'eine',
  'wer', 'was', 'wie', 'er', 'sie', 'du', 'wir', 'ihr', 'mehr', 'noch',
]);

/**
 * Liest den Namen hinter einem Verb: "war Pascal dabei", "hat johannes
 * gespielt", "ist fedex wave angemeldet".
 *
 * Vorher gab es dafuer nur ein Muster fuer "war X dabei". Auf "wie viele
 * events hat johannes gespielt" fand es nichts - und der Aufrufer nahm dann
 * stillschweigend an, der Fragende sei gemeint. Ghostxx hat daraufhin im
 * Leitungschat dreimal Kevins eigene Zahlen ausgegeben, obwohl nach Johannes,
 * Fedex und anderen gefragt wurde.
 */
function nameNachVerb(text) {
  const treffer = text.match(/\b(?:war|warst|waren|hat|hatte|hatten|ist|sind)\s+(.+)$/i);
  if (!treffer) return '';

  const woerter = treffer[1].trim().split(/\s+/);
  const gesammelt = [];

  for (const wort of woerter) {
    const sauber = wort.replace(/[.,!?;:]+$/, '');
    const klein = sauber.toLowerCase();

    if (NAME_ENDE.has(klein)) break;
    // Direkt hinter dem Verb steht kein Fuellwort - dann ist kein Name gemeint.
    if (!gesammelt.length && KEIN_NAME.has(klein)) return '';
    if (gesammelt.length && KEIN_NAME.has(klein)) break;
    if (!/[a-zäöüß]/i.test(sauber)) break;

    gesammelt.push(sauber);
    // Namen wie "Ghost Muffiin | 266391" haben hoechstens drei Teile.
    if (gesammelt.length >= 3) break;
  }

  return gesammelt.join(' ');
}

// Eventart aus dem Satz. Nur was hier steht, gilt - sonst wuerde "wie oft war
// ich dabei" das Wort "dabei" als Eventnamen lesen.
const EVENT_MUSTER = [
  [/\b40er\b/i, '40er'],
  [/\b50er\b/i, '50er'],
  [/\bbiz\s?war\b/i, 'BizWar'],
  [/\bfam\s?war\b/i, 'FamWar'],
  [/\brp[\s-]?fabrik\b/i, 'RP-Fabrik'],
  [/\bwaffen\s?fabrik\b|\bwf\b/i, 'Waffenfabrik'],
  [/\bweinberg\w*\b/i, 'Weinberge'],
  [/\bgie(ss|ß)erei\b/i, 'Giesserei'],
  [/\bhafen\b/i, 'Hafen'],
  [/\bbank\w*\b/i, 'Bank'],
  [/\bekz\b/i, 'EKZ'],
  [/\bsk\b/i, 'SK'],
  [/\braid\b/i, 'Raid'],
  [/\bangriff\w*\b/i, 'Angriff'],
  [/\bverteidigung\w*\b/i, 'Verteidigung'],
];

// Woerter, mit denen ein Discord-Name nicht anfaengt. "der aktuelle Praesident
// von Frankreich" ist eine Wissensfrage, "Fedex Wave" ein Mensch.
const KEIN_NAME_ANFANG = /^(der|die|das|den|dem|ein|eine|einer|unser|unsere|euer|eure|mein|meine|dein|deine|sein|seine|ihr|ihre)\b/i;

/** Sieht das nach einem Discord-Namen aus - und nicht nach einer Wissensfrage? */
function istNameHaft(wert) {
  const name = String(wert || '').trim();
  if (name.length < 2 || name.length > 40) return false;
  if (KEIN_NAME_ANFANG.test(name)) return false;
  // Namen sind kurz. "Ghost Muffiin | 266391" hat drei Teile, mehr nicht.
  if (name.split(/\s+/).length > 3) return false;
  if (!/[a-zäöüß]/i.test(name)) return false;
  return true;
}

function findeEvent(text) {
  for (const [muster, name] of EVENT_MUSTER) {
    if (muster.test(text)) return name;
  }
  return null;
}

/**
 * Was fuer eine Frage ist das?
 *
 * Gibt null zurueck, wenn es keine Nachfrage zu Anmeldungen ist - dann laeuft
 * alles weiter wie bisher.
 */
function parseStatsFrage(text) {
  const roh = String(text || '').trim();
  if (roh.length < 5) return null;

  const zeitraum = findeZeitraum(roh);
  const event = findeEvent(roh);

  // "wer war am haeufigsten dabei" - nach Personen gefragt, nicht nach einer.
  if (/\bwer\b/i.test(roh) && /\b(am\s+(meisten|haeufigsten|häufigsten|oeftesten|öftesten)|die\s+meisten|top|fleissigsten|fleißigsten)\b/i.test(roh)) {
    return { art: 'bestenliste', zeitraum: zeitraum.zeitraum, event };
  }

  // "wer ist Fedex Wave" / "wer ist @X"
  //
  // Im Leitungschat kam darauf "Der Begriff existiert so nicht" - dabei steht
  // die Person auf demselben Server. Das gehoert deterministisch beantwortet,
  // nicht geraten.
  const werIst = roh.match(/\bwer\s+(?:ist|war)\s+(?:eigentlich\s+)?(.+?)\s*\??$/i);
  if (werIst) {
    const wen = werIst[1].trim();
    // "wer ist dabei" / "wer ist angemeldet" fragt nach der Teilnehmerliste,
    // nicht nach einer Person.
    if (!/^(dabei|angemeldet|drin|da|online|hier|das|es|los|dran)$/i.test(wen)) {
      // Was hinter "wer ist" steht, IST der Name - nicht erst nach Mustern
      // suchen. Sonst faellt "wer ist Fedex Wave" auf den Fragenden zurueck.
      const erwaehnung = wen.match(/<@!?(\d{17,25})>/) || wen.match(/^(\d{17,25})$/);
      if (erwaehnung) return { art: 'person', spieler: { userId: erwaehnung[1], name: null } };

      // Aber nur, wenn es auch nach einem Namen aussieht. "wer ist der
      // aktuelle Praesident von Frankreich" ist Allgemeinwissen und gehoert
      // ans Modell, nicht in die Mitgliedersuche.
      if (istNameHaft(wen)) return { art: 'person', spieler: { userId: null, name: wen } };
    }
  }

  // "wann war ich zuletzt dabei", "letzte events von Pascal"
  if (
    /\b(wann)\b.*\b(zuletzt|letzte[sn]?|das\s+letzte\s+mal)\b/i.test(roh) ||
    /\b(letzten|letzte)\s+(events?|anmeldungen|teilnahmen)\b/i.test(roh)
  ) {
    return { art: 'letzte', spieler: findeSpieler(roh), event, zeitraum: zeitraum.zeitraum };
  }

  // "wie viele logs hat X" - Nachweise im Logbuch, nicht Event-Anmeldungen.
  // Darauf kam frueher eine erfundene Datenschutzregel.
  if (/\b(logs?|nachweise?|logbuch|beitraege|beiträge)\b/i.test(roh)
    && WIE_VIELE.test(roh)) {
    return { art: 'logs', spieler: findeSpieler(roh) };
  }

  // "wie oft war ich diesen Monat dabei"
  if (WIE_VIELE.test(roh)) {
    // "wie viele Events gab es" ist eine Frage nach dem Betrieb, nicht nach
    // einer Person.
    if (/\b(events?|anmeldungen)\s+(gab|gibt|liefen|waren)\b/i.test(roh)) {
      return { art: 'uebersicht', zeitraum: zeitraum.zeitraum, event };
    }
    // "wie viele Leute passen in den 40er" fragt nach der Groesse, nicht nach
    // Teilnahmen. Es braucht ein Wort, das jemanden dabei sein laesst.
    if (!/\b(war|warst|waren|bin|dabei|angemeldet|mitgemacht|teilgenommen|mitgespielt|gespielt)\b/i.test(roh)) {
      return null;
    }

    return { art: 'teilnahmen', spieler: findeSpieler(roh), event, zeitraum: zeitraum.zeitraum };
  }

  // "welche events gab es diesen monat", "wie liefs diesen monat"
  if (/\bwelche\s+events?\b/i.test(roh) || /\b(event)?(statistik|uebersicht|übersicht|bilanz)\b/i.test(roh)) {
    return { art: 'uebersicht', zeitraum: zeitraum.zeitraum, event };
  }

  return null;
}

module.exports = {
  extractUserId,
  findeEvent,
  findeSpieler,
  findeZeitraum,
  parseStatsFrage,
};
