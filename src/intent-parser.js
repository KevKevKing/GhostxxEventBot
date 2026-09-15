const { normalizeText } = require('./text-match');

// Deterministische Vorstufe vor dem Sprachmodell.
//
// Die typischen Befehle ("tausche im 40er @A mit @B") sind sehr regelmaessig
// gebaut. Die hier zu erkennen kostet unter einer Millisekunde und kann sich
// nicht "verraten" - das Sprachmodell braucht rund 5 bis 15 Sekunden und hat im
// Test genau bei so einem Satz die Aktion verwechselt (eintragen statt
// austragen). Was hier nicht sicher erkannt wird, geht ans Modell weiter.
//
// Grundsatz: im Zweifel NICHT erkennen. Ein falsch verstandener Befehl ist
// deutlich teurer als eine Rueckfrage.

const MENTION = /<@!?(\d{17,25})>/g;

// Als ganze Woerter geprueft, nicht als Teilstrings: "auswechselspieler"
// enthaelt "wechsel" und wurde sonst faelschlich als Tausch erkannt.
const SWAP_VERBS = [
  'tausche', 'tausch', 'tauschen', 'tauscht', 'austauschen', 'austausch',
  'wechsle', 'wechsel', 'wechseln', 'auswechseln',
  'ersetze', 'ersetz', 'ersetzen',
  'rotiere', 'rotier', 'swap', 'swappe', 'switch', 'switche',
];
const ADD_VERBS = [
  'eintragen', 'eintrag', 'pack', 'packe', 'setz', 'setze', 'fuege', 'fueg',
  'adde', 'add', 'anmelden', 'anmelde', 'melde', 'joine',
];
const REMOVE_VERBS = [
  'austragen', 'austrag', 'entferne', 'entfern', 'entfernen', 'entnimm',
  'loesche', 'loesch', 'kick', 'kicke', 'rausnehmen', 'rauswerfen',
  'streiche', 'streich', 'abmelden', 'abmelde',
];
const LIST_VERBS = ['teilnehmer', 'liste', 'zeig', 'zeige', 'angemeldet', 'dabei'];

// Trennbare Verben: "trag ... ein" / "nimm ... raus". Der Wortstamm steht vorn,
// die Vorsilbe irgendwo dahinter.
//
// Hier stehen bewusst die Verben, deren Richtung erst die Vorsilbe festlegt:
// "hol ihn rein" ist ein Eintrag, "hol ihn raus" ein Austrag. Sie in eine der
// festen Listen zu stecken haette die Haelfte der Faelle verdreht.
const SEPARABLE_STEMS = [
  'trag', 'trage', 'nimm', 'nehm', 'nehme', 'mach', 'schreib',
  'hol', 'hole', 'bring', 'bringe', 'schmeiss', 'schmeisse',
  'wirf', 'werf', 'werfe', 'tu', 'tue', 'stell', 'stelle',
  // "lege" braucht die Vorsilbe: ohne sie wurde "ich lege mich schlafen" als
  // Eintrag gelesen, weil "mich" schon als Person zaehlt.
  'leg', 'lege',
];
const ADD_PARTICLES = ['ein', 'rein', 'dazu', 'mit'];
const REMOVE_PARTICLES = ['aus', 'raus', 'weg', 'runter'];

const SUBSTITUTE_WORDS = ['auswechselspieler', 'ersatz', 'ersatzspieler', 'bank', 'sub'];

// Selbstbezug: "trag mich ein", "nimm mich raus".
const SELF_WORDS = ['mich', 'mir', 'meinereiner', 'selbst'];

// Woerter, die niemals Teil eines Eventnamens sind.
const STOPWORDS = new Set([
  'aus', 'dem', 'den', 'der', 'die', 'das', 'im', 'in', 'ins', 'beim', 'bei', 'vom', 'von',
  'event', 'events', 'anmeldung', 'liste', 'mit', 'gegen', 'und', 'fuer', 'zum', 'zur',
  'mal', 'bitte', 'kannst', 'du', 'mir', 'ich', 'ein', 'eintragen', 'austragen', 'raus',
  'rein', 'nimm', 'trag', 'trage', 'pack', 'packe', 'tausche', 'tausch', 'wechsle',
  'entferne', 'setz', 'setze', 'wer', 'alles', 'dabei', 'ist', 'sind', 'am', 'auf',
  'heute', 'gleich', 'jetzt', 'noch', 'auswechselspieler', 'ersatz', 'ersatzspieler', 'sub',
]);

function extractMentions(text) {
  const ids = [];
  for (const match of String(text || '').matchAll(MENTION)) {
    ids.push(match[1]);
  }
  return ids;
}

function toWords(normalized) {
  return normalized.split(' ').filter(Boolean);
}

// --- Namen im Tausch ohne @Erwaehnung ---------------------------------------

// Was zwischen den beiden Namen stehen kann.
const SWAP_CONNECTORS = /\s+(?:und|gegen|mit|durch|fuer|für|statt|anstelle\s+von|anstatt)\s+/i;

// Woerter, die vor einem Namen stehen duerfen und nicht dazugehoeren.
const NAME_NOISE = new Set([
  'mal', 'bitte', 'eben', 'kurz', 'schnell', 'doch',
  'den', 'die', 'das', 'dem', 'der', 'einen', 'einem', 'eine',
  'aus', 'im', 'in', 'beim', 'bei', 'vom', 'von', 'zum', 'zur',
  'event', 'events', 'anmeldung', 'liste',
]);

/**
 * Schaelt einen Namen aus seinem Umfeld.
 *
 * "aus dem Event (40er) GhostMuffiin" -> "GhostMuffiin". Es wird nur von vorne
 * abgetragen und nur, was sicher nicht zum Namen gehoert: Fuellwoerter,
 * Klammerausdruecke und Eventkuerzel wie "40er".
 */
function schaeleName(roh, eventName = '') {
  const wert = String(roh || '').replace(/\([^)]*\)/g, ' ').trim();
  let woerter = wert.split(/\s+/).filter(Boolean);

  // Woerter des erkannten Events - "wechsle beim Bank-Event Nox mit Fedex"
  // haette sonst "Bank-Event Nox" als Namen gelesen.
  const eventWoerter = new Set(
    normalizeText(eventName).split(/[\s-]+/).filter(Boolean),
  );

  while (woerter.length > 1) {
    const erstes = normalizeText(woerter[0]);
    // Eventkuerzel: "40er", "50er". Ein Name faengt nicht mit einer Zahl an.
    const istEventKuerzel = /^\d+\w*$/.test(erstes);
    const gehoertZumEvent = eventWoerter.size
      && normalizeText(woerter[0]).split(/[\s-]+/).every((teil) => eventWoerter.has(teil));

    if (!NAME_NOISE.has(erstes) && !istEventKuerzel && !gehoertZumEvent) break;
    woerter = woerter.slice(1);
  }

  return woerter.join(' ').replace(/[.,!?;:]+$/, '').trim();
}

/**
 * Liest "tausche Ghost und johannes" - zwei Namen ohne Erwaehnung.
 *
 * Bewusst streng: es braucht das Verb vorne, genau ein Verbindungswort und auf
 * beiden Seiten etwas, das wie ein Name aussieht. Alles andere geht weiter ans
 * Modell, statt hier geraten zu werden.
 */
function extractSwapNames(raw, eventName = '') {
  const text = String(raw || '').trim();

  // Alles vor dem Tauschverb abschneiden, inklusive Anrede ("ghost tausche ...").
  const verb = text.match(/\b(tausche?n?|wechs(?:le|el)|ersetz(?:e|en)?|swap)\b/i);
  if (!verb) return null;

  const rest = text.slice(verb.index + verb[0].length);

  const teile = rest.split(SWAP_CONNECTORS);
  // Genau zwei Seiten. Bei "A und B und C" waere unklar, wer wen ersetzt.
  if (teile.length !== 2) return null;

  const sauber = teile.map((teil) => schaeleName(teil, eventName));
  if (!sauber.every(istNameHaft)) return null;

  return { out: sauber[0], in: sauber[1] };
}

// Verben, hinter denen beim Ein- und Austragen der Name steht.
const PERSON_VERBEN = /\b(trag|trage|nimm|nehm|nehme|pack|packe|setz|setze|hol|hole|bring|bringe|schmeiss|schmeisse|wirf|werf|werfe|stell|stelle|leg|lege|entferne|entfern|kick|kicke|streich|streiche|loesche|loesch|adde|melde|meld)\b/i;

/**
 * Liest den Namen aus "nimm Johannes aus dem Bank-Event raus".
 *
 * Bewusst streng: Der Name muss direkt hinter dem Verb stehen, und alles ab dem
 * ersten Fuellwort gehoert nicht mehr dazu. Was hier nicht sauber aufgeht,
 * bekommt das Modell - lieber nichts erkennen als den falschen Menschen
 * austragen.
 */
function extractPersonName(raw, eventName = '') {
  const text = String(raw || '').trim();
  const verb = text.match(PERSON_VERBEN);
  if (!verb) return '';

  const rest = text.slice(verb.index + verb[0].length).trim();
  if (!rest) return '';

  const geschaelt = schaeleName(rest, eventName);
  if (!geschaelt) return '';

  // Nur bis zum ersten Wort, das den Namen beendet.
  const woerter = [];
  for (const wort of geschaelt.split(/\s+/)) {
    const klein = normalizeText(wort);
    if (NAME_ENDE_PERSON.has(klein)) break;
    woerter.push(wort);
    if (woerter.length >= 3) break;
  }

  const name = woerter.join(' ').replace(/[.,!?;:]+$/, '').trim();
  if (!istNameHaft(name)) return '';

  // Faengt es mit einem Fuellwort an, ist es kein Name: "pack schon mal
  // zusammen" hatte sonst "schon mal zusammen" als Person gelesen.
  const erstes = normalizeText(name.split(/\s+/)[0]);
  if (KEIN_NAMENSANFANG.has(erstes)) return '';

  return name;
}

const KEIN_NAMENSANFANG = new Set([
  'schon', 'noch', 'wieder', 'alles', 'etwas', 'nichts', 'was', 'wer', 'wie',
  'nicht', 'zusammen', 'weiter', 'gerne', 'kurz', 'lieber', 'einfach',
  'es', 'ihn', 'sie', 'ihm', 'ihr', 'dich', 'euch', 'uns', 'dir', 'denen',
  'hier', 'dort', 'heute', 'morgen', 'gestern', 'gleich', 'sofort',
]);

// Woerter, an denen der Name aufhoert.
const NAME_ENDE_PERSON = new Set([
  'ein', 'raus', 'rein', 'aus', 'weg', 'dazu', 'mit', 'runter', 'bitte',
  'im', 'in', 'beim', 'bei', 'vom', 'von', 'zum', 'zur', 'am', 'an', 'auf',
  'als', 'fuer', 'und', 'oder', 'nochmal', 'wieder', 'jetzt', 'gleich',
  'auswechselspieler', 'ersatz', 'ersatzspieler', 'sub', 'bank',
]);

/** Sieht das nach einem Namen aus - und nicht nach einem halben Satz? */
function istNameHaft(wert) {
  if (!wert) return false;
  // Discord-Namen sind selten laenger als drei Woerter.
  const woerter = wert.split(/\s+/);
  if (woerter.length > 3) return false;
  if (wert.length < 2 || wert.length > 40) return false;
  // Buchstaben muessen dabei sein, sonst ist es eine Zahl oder Satzzeichen.
  if (!/[a-zäöüß]/i.test(wert)) return false;
  // Kein Fuellwort, das uebrig geblieben ist.
  if (STOPWORDS.has(normalizeText(wert))) return false;
  return true;
}

// Abstand zweier Woerter, abgebrochen sobald er zu gross wird.
function editDistance(a, b, max = 1) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);

  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    let best = i;

    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
      if (current[j] < best) best = current[j];
    }

    if (best > max) return max + 1;
    previous = current;
  }

  return previous[b.length];
}

// Wortweise statt per includes(), damit Teilwoerter nicht mitzaehlen.
// Ab fuenf Buchstaben wird ein Tippfehler verziehen ("weechsel" -> "wechsel"),
// darunter nicht - sonst wuerde "aus" auf "raus" passen.
// Woerter, die NIE als Tippfehler eines Verbs durchgehen duerfen.
//
// "ersatz" und "ersetz" unterscheiden sich in genau einem Buchstaben. Die
// Tippfehler-Toleranz hat "trag @X als Ersatz ein" deshalb als Tauschversuch
// gelesen - und weil dabei die zweite Person fehlt, kam gar nichts zurueck.
// Ein voellig normaler Satz, der stumm ins Leere lief.
const SCHUTZWOERTER = new Set([
  'ersatz', 'ersatzspieler', 'ersatzbank', 'auswechselspieler',
]);

function hasWord(words, needles) {
  if (needles.some((needle) => words.includes(needle))) return true;

  const fuzzyfaehig = words.filter((word) => !SCHUTZWOERTER.has(word));

  return needles.some((needle) => {
    if (needle.length < 5 || needle.includes(' ')) return false;
    return fuzzyfaehig.some((word) => word.length >= 5 && editDistance(word, needle, 1) <= 1);
  });
}

function containsAny(normalized, needles) {
  return needles.some((needle) => normalized.includes(needle));
}

// Sucht den Eventnamen: bekannte Slugs zuerst, sonst Woerter die wie ein
// Eventname aussehen (z.B. "40er", "Bank-Event").
function extractEventName(text, knownEvents = []) {
  const normalized = normalizeText(text);

  // Bekannte Events gewinnen immer - laengster Treffer zuerst, damit
  // "bank event" nicht nur als "bank" erkannt wird.
  const sorted = [...knownEvents].sort((a, b) => normalizeText(b).length - normalizeText(a).length);
  for (const candidate of sorted) {
    const needle = normalizeText(candidate);
    if (needle && normalized.includes(needle)) return candidate;
  }

  // Klammerform: "aus dem Event (40er)"
  const bracket = String(text).match(/\(([^)]{1,40})\)/);
  if (bracket) {
    const inner = bracket[1].trim();
    if (inner && !normalizeText(inner).split(' ').every((word) => STOPWORDS.has(word))) {
      return inner;
    }
  }

  // Zahlwoerter wie "40er", "50er"
  const numeric = normalized.match(/\b(\d{1,3}er)\b/);
  if (numeric) return numeric[1];

  return '';
}

function detectAction(normalized) {
  const words = toWords(normalized);

  if (hasWord(words, SWAP_VERBS)) return 'swap';

  let wantsAdd = hasWord(words, ADD_VERBS);
  let wantsRemove = hasWord(words, REMOVE_VERBS);

  // Trennbare Verben: "trag @X beim 50er ein" -> Stamm "trag" + Vorsilbe "ein".
  if (hasWord(words, SEPARABLE_STEMS)) {
    if (hasWord(words, ADD_PARTICLES)) wantsAdd = true;
    if (hasWord(words, REMOVE_PARTICLES)) wantsRemove = true;
  }

  // Beides erkannt -> zu unsicher, ans Modell weiterreichen.
  if (wantsAdd && wantsRemove) return '';
  if (wantsAdd) return 'add';
  if (wantsRemove) return 'remove';

  if (hasWord(words, LIST_VERBS)) return 'list';
  if (normalized.startsWith('wer ist') || normalized.startsWith('wer sind')) return 'list';

  return '';
}

/**
 * Versucht, aus einer Nachricht eine konkrete Aktion zu lesen.
 * Gibt null zurueck, wenn nichts sicher erkannt wurde - dann uebernimmt das
 * Sprachmodell.
 */
function parseIntent(text, options = {}) {
  const { knownEvents = [], hasReply = false, selfId = '' } = options;
  const raw = String(text || '').trim();
  if (!raw) return null;

  const normalized = normalizeText(raw);
  const action = detectAction(normalized);
  if (!action) return null;

  const mentions = extractMentions(raw);

  // "trag mich ein" - wer gemeint ist, steht fest. Das braucht kein
  // Sprachmodell und soll nicht 15 Sekunden dauern.
  if (!mentions.length && selfId && hasWord(toWords(normalized), SELF_WORDS)) {
    mentions.push(selfId);
  }
  const event = extractEventName(raw, knownEvents);
  const asSubstitute = containsAny(normalized, SUBSTITUTE_WORDS);

  // Fehlt der Eventname, ist der Befehl nicht ungueltig - er ist unvollstaendig.
  // Welche Anmeldung gemeint ist, ergibt sich meist aus dem Kanal oder aus der
  // Nachricht, auf die geantwortet wurde. Das loest der Aufrufer auf.
  const needsEvent = !event;

  if (action === 'swap') {
    if (mentions.length === 2) {
      return {
        action: 'swap',
        event,
        needsEvent,
        out: mentions[0],
        in: mentions[1],
        source: 'parser',
        confidence: 'high',
      };
    }

    // "tausche Ghost und johannes" - ohne @Erwaehnung.
    //
    // Frueher wurde das abgelehnt, weil Namen als zu unsicher galten. Das
    // stammt aus der Zeit, bevor beim Start alle Mitglieder geladen wurden:
    // heute loest die Namenssuche eindeutig auf oder fragt zurueck. Ein
    // falscher Tausch entsteht dadurch nicht - schlimmstenfalls eine Rueckfrage.
    const namen = extractSwapNames(raw, event);
    if (namen) {
      return {
        action: 'swap',
        event,
        needsEvent,
        out: namen.out,
        in: namen.in,
        source: 'parser',
        // Namen muessen erst aufgeloest werden, Erwaehnungen nicht.
        confidence: 'medium',
      };
    }

    return null;
  }

  if (action === 'add' || action === 'remove') {
    if (mentions.length === 1) {
      return {
        action,
        event,
        needsEvent,
        player: mentions[0],
        substitute: action === 'add' ? asSubstitute : undefined,
        source: 'parser',
        confidence: 'high',
      };
    }

    // "nimm Johannes aus dem Bank-Event raus" - ohne @Erwaehnung.
    //
    // Beim Tauschen war das schon erlaubt, hier nicht - deshalb ging genau
    // dieser Satz ans Sprachmodell, und das greift nur in drei von fuenf
    // Faellen zum Werkzeug. Gemessen, mit und ohne Laengengrenze gleich.
    //
    // Dasselbe Sicherheitsnetz wie beim Tausch: Der Name wird danach
    // aufgeloest, und bei Unklarheit fragt er zurueck statt zu raten.
    if (!mentions.length) {
      const name = extractPersonName(raw, event);
      if (name) {
        return {
          action,
          event,
          needsEvent,
          player: name,
          substitute: action === 'add' ? asSubstitute : undefined,
          source: 'parser',
          confidence: 'medium',
        };
      }
    }

    return null;
  }

  if (action === 'list') {
    if (mentions.length) return null;

    // Bei Tausch und Eintragen sind die @Erwaehnungen ein starkes Zeichen, dass
    // wirklich ein Befehl gemeint ist. Eine Listenfrage hat die nicht - "wer ist
    // der beste spieler?" waere sonst eine Anfrage. Ohne Eventnamen zaehlt sie
    // deshalb nur, wenn direkt auf eine Anmeldung geantwortet wurde.
    if (needsEvent && !hasReply) return null;

    return { action: 'list', event, needsEvent, source: 'parser', confidence: 'high' };
  }

  return null;
}

/**
 * Sieht die Nachricht nach einem Befehlsversuch aus, auch wenn sie unvollstaendig ist?
 *
 * Damit der Bot auf "tausche mal eben" nicht mit "lass uns woanders quatschen"
 * antwortet - das war der Fehler, der beim ersten Test aufgefallen ist.
 */
function looksLikeCommand(text) {
  const words = toWords(normalizeText(text));
  if (hasWord(words, SWAP_VERBS)) return true;
  if (hasWord(words, ADD_VERBS)) return true;
  if (hasWord(words, REMOVE_VERBS)) return true;
  if (hasWord(words, LIST_VERBS)) return true;
  if (hasWord(words, SEPARABLE_STEMS) && hasWord(words, [...ADD_PARTICLES, ...REMOVE_PARTICLES])) return true;
  return false;
}

module.exports = {
  extractEventName,
  extractMentions,
  looksLikeCommand,
  parseIntent,
};
