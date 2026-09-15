const { normalizeText } = require('./text-match');

// Eine SK-Meldung per Nachricht statt per Slash-Command.
//
// Der Anlass steht in der sk-anmeldung:
//
//   [21:07] ghost_muffin1  "ghost wir haben angegriffen um 21:07 gegen Nemesis"
//   [21:07] Ghostxx        "Lass uns lieber im Chat quatschen."
//
// Danach musste die Meldung von Hand ueber /angriff nachgereicht werden -
// waehrend die Inkzeit schon lief. Genau dann hat niemand Lust, ein Formular
// auszufuellen.
//
// Deterministisch, ohne Sprachmodell: eine Meldung legt eine Anmeldung an, an
// der zehn Leute haengen. Das darf nicht davon abhaengen, ob die Grafikkarte
// gerade frei ist.

const ANGRIFF = 'attack';
const VERTEIDIGUNG = 'defense';

// Ohne eins dieser Woerter ist es keine Meldung.
const THEMA = /\b(angriff|angriffe|angegriffen|angreifen|greifen|greift|greif|verteidigung|verteidigen|verteidigt)\b/;

// Was daraus eine VERTEIDIGUNG macht. "uns" ist das entscheidende Wort:
// "wir haben Nemesis angegriffen" gegen "Nemesis hat uns angegriffen".
const DEFENSIV = /\buns\b|\bwurden angegriffen\b|\bwerden angegriffen\b|\bverteidig/;

// Fragen sind keine Meldungen. "wer hat uns gestern angegriffen" darf keine
// Anmeldung anlegen.
const FRAGEWORT = /^(wer|wen|wem|wann|wie|was|warum|wieso|weshalb|welche|welcher|welches|gibt|ist|sind|hat|haben|war|waren|kann|koennen|koennte|darf|soll)\b/;

// Anrede am Anfang, damit "ghost wer hat uns angegriffen?" als Frage erkannt wird.
const ANREDE = /^\s*(?:@?ghost(?:xx)?|hey|hallo|moin|servus)[\s,:!-]*/i;

// Woerter, die nie zum Gegnernamen gehoeren.
const KEIN_GEGNER = new Set([
  'um', 'uhr', 'wir', 'uns', 'sie', 'er', 'ich', 'mich', 'mir', 'du',
  'heute', 'gestern', 'gerade', 'eben', 'jetzt', 'grade', 'vorhin', 'soeben',
  'angegriffen', 'angriff', 'angreifen', 'verteidigung', 'verteidigen',
  'greifen', 'greift', 'greif', 'haben', 'hat', 'wurden', 'werden', 'wurde',
  'und', 'an', 'im', 'in', 'der', 'die', 'das', 'ein', 'eine', 'einen',
  'mit', 'ohne', 'ping', 'bitte', 'mal', 'nochmal', 'gegen', 'von', 'vom',
  'erstell', 'erstelle', 'mach', 'mache', 'leg', 'lege', 'melde', 'meld',
  'sk', 'turf', 'meldung', 'anmeldung', 'event', 'mir', 'uns',
]);

const MAX_GEGNER_WOERTER = 3;

/** Die Anrede vorne weg - sonst steht das Fragewort nie am Satzanfang. */
function ohneAnrede(text) {
  return String(text || '').replace(ANREDE, '');
}

/** Uhrzeit aus dem Text: "21:07", "21.07", "21 Uhr". */
function zeitAus(text) {
  const roh = String(text || '');

  const mitMinute = roh.match(/\b(\d{1,2})[:.](\d{2})\b/);
  if (mitMinute) {
    const stunde = Number(mitMinute[1]);
    const minute = Number(mitMinute[2]);
    if (stunde <= 23 && minute <= 59) {
      return `${String(stunde).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    }
  }

  const volleStunde = roh.match(/\b(\d{1,2})\s*uhr\b/i);
  if (volleStunde) {
    const stunde = Number(volleStunde[1]);
    if (stunde <= 23) return `${String(stunde).padStart(2, '0')}:00`;
  }

  return '';
}

/** Sieht dieses Wort nach einem Namen aus - oder ist es Fuellwerk? */
function taugtAlsGegner(wort) {
  const sauber = wort.replace(/[^\p{L}\p{N}'._-]/gu, '');
  if (sauber.length < 2) return '';
  if (/^\d+$/.test(sauber)) return '';
  if (KEIN_GEGNER.has(normalizeText(sauber))) return '';
  return sauber;
}

/** Bis zu drei Woerter ab einer Stelle einsammeln, solange sie taugen. */
function namenAb(woerter, start) {
  const teile = [];
  for (let i = start; i < woerter.length && teile.length < MAX_GEGNER_WOERTER; i += 1) {
    const gut = taugtAlsGegner(woerter[i]);
    if (!gut) break;
    teile.push(gut);
  }
  return teile.join(' ');
}

/**
 * Gegen wen geht es?
 *
 * "gegen Nemesis", "von Elegnu", und beim Angriff auch die Form ohne
 * Vorwort: "wir haben Nemesis angegriffen".
 */
function gegnerAus(text, art) {
  const roh = ohneAnrede(text);
  const woerter = roh.split(/\s+/).filter(Boolean);
  const klein = woerter.map((w) => normalizeText(w));

  for (const vorwort of ['gegen', 'von', 'vom']) {
    const stelle = klein.indexOf(vorwort);
    if (stelle >= 0) {
      const name = namenAb(woerter, stelle + 1);
      if (name) return name;
    }
  }

  // "Nemesis hat uns angegriffen", "Nemesis greift uns an" - beim Verteidigen
  // steht der Angreifer vor dem Verb.
  if (art === VERTEIDIGUNG) {
    const stelle = klein.findIndex((w) => ['hat', 'haben', 'greift', 'greifen'].includes(w));
    if (stelle > 0) {
      const name = taugtAlsGegner(woerter[stelle - 1]);
      if (name) return name;
    }
  }

  // "wir haben Nemesis angegriffen" - der Name steht direkt vor dem Verb.
  if (art === ANGRIFF) {
    const stelle = klein.indexOf('angegriffen');
    if (stelle > 0) {
      const name = taugtAlsGegner(woerter[stelle - 1]);
      if (name) return name;
    }

    // "wir greifen Elegnu an" - hier steht er dahinter.
    const verb = klein.findIndex((w) => ['greifen', 'greift', 'greif'].includes(w));
    if (verb >= 0) {
      const name = namenAb(woerter, verb + 1);
      if (name) return name;
    }
  }

  return '';
}

/**
 * Ist das eine SK-Meldung? Und wenn ja, was fehlt noch?
 *
 * Gibt null zurueck, wenn es keine ist - dann laeuft alles weiter wie bisher.
 */
function parseSkMeldung(text) {
  const roh = ohneAnrede(text).trim();
  if (!roh) return null;

  const klein = normalizeText(roh);
  if (!THEMA.test(klein)) return null;

  // Fragen und Rueckblicke sind keine Meldungen.
  if (roh.includes('?')) return null;
  if (FRAGEWORT.test(klein)) return null;

  const art = DEFENSIV.test(klein) ? VERTEIDIGUNG : ANGRIFF;
  const gegner = gegnerAus(roh, art);
  const zeit = zeitAus(roh);

  const fehlt = [];
  if (!gegner) fehlt.push('gegner');
  if (!zeit) fehlt.push('zeit');

  return { art, gegner, zeit, fehlt };
}

// Fehlt etwas, merkt sich Ghostxx die halbe Meldung kurz und nimmt die
// Nachreichung entgegen: "gegen wen?" - "Nemesis". Nach zehn Minuten ist sie
// vergessen, damit eine liegengebliebene Meldung nicht Stunden spaeter noch
// etwas ausloest.
const HALTBAR_MS = 10 * 60 * 1000;
const offen = new Map();

function merkeOffen(userId, meldung, jetzt = Date.now()) {
  offen.set(userId, { ...meldung, wann: jetzt });
}

function vergissOffen(userId) {
  offen.delete(userId);
}

function offeneMeldung(userId, jetzt = Date.now()) {
  const eintrag = offen.get(userId);
  if (!eintrag) return null;
  if (jetzt - eintrag.wann > HALTBAR_MS) {
    offen.delete(userId);
    return null;
  }
  return eintrag;
}

/**
 * Ergaenzt eine angefangene Meldung um das, was gefehlt hat.
 *
 * Bewusst eng: nur eine Uhrzeit, oder ein kurzer Name ohne Satzbau. Alles
 * andere ist eher ein neuer Satz als eine Antwort.
 */
function ergaenzeOffene(userId, text, jetzt = Date.now()) {
  const angefangen = offeneMeldung(userId, jetzt);
  if (!angefangen) return null;

  const roh = ohneAnrede(text).trim();
  if (!roh) return null;

  const ergaenzt = { ...angefangen };

  if (!ergaenzt.zeit) {
    const zeit = zeitAus(roh);
    if (zeit) ergaenzt.zeit = zeit;
  }

  if (!ergaenzt.gegner) {
    const woerter = roh.split(/\s+/).filter(Boolean);
    const ausVorwort = gegnerAus(roh, ergaenzt.art);
    if (ausVorwort) {
      ergaenzt.gegner = ausVorwort;
    } else if (woerter.length <= MAX_GEGNER_WOERTER && !zeitAus(roh)) {
      const name = namenAb(woerter, 0);
      if (name) ergaenzt.gegner = name;
    }
  }

  const fehlt = [];
  if (!ergaenzt.gegner) fehlt.push('gegner');
  if (!ergaenzt.zeit) fehlt.push('zeit');
  ergaenzt.fehlt = fehlt;

  // Nichts dazugelernt? Dann war es keine Antwort, sondern etwas anderes.
  if (fehlt.length === angefangen.fehlt.length) return null;

  return ergaenzt;
}

/** Was Ghostxx nachfragt, wenn etwas fehlt. */
function frageNach(meldung) {
  const wen = meldung.art === ANGRIFF ? 'Wen habt ihr angegriffen' : 'Wer hat angegriffen';

  if (meldung.fehlt.length === 2) {
    return `${wen}, und um wie viel Uhr? Zum Beispiel: "gegen Nemesis um 21:07".`;
  }
  if (meldung.fehlt.includes('gegner')) {
    return `${wen}?`;
  }
  return 'Um wie viel Uhr war das?';
}

module.exports = {
  ANGRIFF,
  VERTEIDIGUNG,
  ergaenzeOffene,
  frageNach,
  gegnerAus,
  merkeOffen,
  offeneMeldung,
  parseSkMeldung,
  vergissOffen,
  zeitAus,
};
